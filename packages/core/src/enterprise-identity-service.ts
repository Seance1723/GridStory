import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type AuthenticationStrength,
  type DirectoryGroup,
  type DirectoryUser,
  type FederatedIdentity,
  federatedIdentitySchema,
  type GroupRoleMapping,
  groupRoleMappingSchema,
  type IdentityProvider,
  type IdentitySecurityEventAction,
  type IdentitySession,
  type IdentitySnapshot,
  identityProviderSchema,
  type Principal,
  type RoleAssignment,
  type ScimGroupInput,
  type ScimUserInput,
  type SessionPolicy,
  sessionPolicySchema,
  type WebAuthnCredential,
  webAuthnCredentialSchema,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';
import {
  emptyIdentityDocument,
  type IdentityDocument,
  type IdentityRepository,
  type IdentityTenantScope,
  InMemoryIdentityRepository,
  type StoredIdentitySession,
} from './identity-repository.js';

const WRITE_RETRIES = 4;
const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const SERVICE_CREDENTIAL_TTL_MS = 365 * 24 * 60 * 60 * 1_000;
const FEDERATION_TRANSACTION_TTL_MS = 10 * 60 * 1_000;

export interface EnterpriseIdentityServiceOptions {
  repository?: IdentityRepository;
  now?: () => Date;
  createId?: () => string;
  createSecret?: () => string;
}

export interface IssuedIdentitySession {
  token: string;
  session: IdentitySession;
  principal: Principal;
}

export interface IssuedIdentityCredential {
  id: string;
  token: string;
  expiresAt: string;
}

export interface FederationTransaction {
  token: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: string;
}

export interface FederatedSessionInput {
  identity: FederatedIdentity;
  actorId?: string;
}

export interface VerifiedWebAuthnRegistration {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
}

export interface VerifiedWebAuthnAuthentication {
  credentialId: string;
  newCounter: number;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function secretMatches(stored: string, supplied: string): boolean {
  const storedBytes = Buffer.from(stored, 'hex');
  const suppliedBytes = Buffer.from(digest(supplied), 'hex');
  return storedBytes.length === suppliedBytes.length && timingSafeEqual(storedBytes, suppliedBytes);
}

function tokenParts(token: string, prefix: string): { id: string; secret: string } | null {
  const expression = new RegExp(`^${prefix}_([^.]+)\\.(.+)$`);
  const match = expression.exec(token);
  return match?.[1] && match[2] ? { id: match[1], secret: match[2] } : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function publicSnapshot(document: IdentityDocument): IdentitySnapshot {
  return {
    organizationId: document.organizationId,
    tenantId: document.tenantId,
    version: document.version,
    providers: structuredClone(document.providers),
    users: structuredClone(document.users),
    groups: structuredClone(document.groups),
    mappings: structuredClone(document.mappings),
    sessions: document.sessions.map(({ secretHash: _secretHash, ...session }) => session),
    credentials: structuredClone(document.credentials),
    breakGlassAccounts: document.breakGlassAccounts.map(
      ({ secretHash: _secretHash, failedAttempts: _failedAttempts, ...account }) => account,
    ),
    policy: structuredClone(document.policy),
    securityEvents: structuredClone(document.securityEvents),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function assignment(mapping: GroupRoleMapping): RoleAssignment {
  return {
    roleId: mapping.roleId,
    organizationId: mapping.organizationId,
    tenantId: mapping.tenantId,
    ...(mapping.workspaceId ? { workspaceId: mapping.workspaceId } : {}),
    ...(mapping.siteId ? { siteId: mapping.siteId } : {}),
    ...(mapping.environmentIds ? { environmentIds: mapping.environmentIds } : {}),
    ...(mapping.locales ? { locales: mapping.locales } : {}),
    ...(mapping.contentTypes ? { contentTypes: mapping.contentTypes } : {}),
  };
}

function strengthRank(value: AuthenticationStrength): number {
  return {
    'single-factor': 0,
    'multi-factor': 1,
    'phishing-resistant': 2,
    'break-glass': 3,
  }[value];
}

export class EnterpriseIdentityService {
  readonly #repository: IdentityRepository;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #createSecret: () => string;

  constructor({
    repository = new InMemoryIdentityRepository(),
    now = () => new Date(),
    createId = randomUUID,
    createSecret = () => randomBytes(32).toString('base64url'),
  }: EnterpriseIdentityServiceOptions = {}) {
    this.#repository = repository;
    this.#now = now;
    this.#createId = createId;
    this.#createSecret = createSecret;
  }

  async #document(scope: IdentityTenantScope): Promise<IdentityDocument> {
    return (await this.#repository.get(scope)) ?? emptyIdentityDocument(scope);
  }

  async #mutate<T>(
    scope: IdentityTenantScope,
    operation: (document: IdentityDocument, now: Date) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const existing = await this.#repository.get(scope);
      const document = existing ?? emptyIdentityDocument(scope);
      const expectedVersion = existing?.version ?? null;
      const now = this.#now();
      const result = operation(document, now);
      document.version += 1;
      document.updatedAt = now.toISOString();
      if (document.createdAt === '1970-01-01T00:00:00.000Z') {
        document.createdAt = document.updatedAt;
      }
      try {
        await this.#repository.save(document, expectedVersion);
        return structuredClone(result);
      } catch (error) {
        if (!(error instanceof GridStoryError) || error.code !== 'identity_write_conflict') {
          throw error;
        }
      }
    }
    throw new GridStoryError(
      'Identity state changed too frequently. Retry the operation.',
      'identity_write_conflict',
      409,
    );
  }

  #event(
    document: IdentityDocument,
    now: Date,
    input: {
      action: IdentitySecurityEventAction;
      outcome: 'success' | 'denied' | 'error';
      actorId: string;
      subjectId?: string;
      reason?: string;
      incidentId?: string;
    },
  ): void {
    document.securityEvents.push({
      organizationId: document.organizationId,
      tenantId: document.tenantId,
      id: this.#createId(),
      sequence: (document.securityEvents.at(-1)?.sequence ?? 0) + 1,
      action: input.action,
      outcome: input.outcome,
      actorId: input.actorId,
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.incidentId ? { incidentId: input.incidentId } : {}),
      occurredAt: now.toISOString(),
    });
  }

  async snapshot(scope: IdentityTenantScope): Promise<IdentitySnapshot> {
    return publicSnapshot(await this.#document(scope));
  }

  async configureProvider(
    scope: IdentityTenantScope,
    actorId: string,
    input: Omit<IdentityProvider, keyof IdentityTenantScope | 'createdAt' | 'updatedAt'>,
  ): Promise<IdentityProvider> {
    return this.#mutate(scope, (document, now) => {
      const current = document.providers.find((provider) => provider.id === input.id);
      const provider = identityProviderSchema.parse({
        ...scope,
        ...input,
        createdAt: current?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      });
      const duplicate = document.providers.find(
        (candidate) =>
          candidate.id !== provider.id &&
          candidate.protocol === provider.protocol &&
          candidate.issuer === provider.issuer,
      );
      if (duplicate) {
        throw new GridStoryError(
          'Federation issuer is already configured.',
          'identity_conflict',
          409,
        );
      }
      if (current) Object.assign(current, provider);
      else document.providers.push(provider);
      this.#event(document, now, {
        action: 'identity.provider.configured',
        outcome: 'success',
        actorId,
        subjectId: provider.id,
        reason: current ? 'provider_updated' : 'provider_created',
      });
      return provider;
    });
  }

  async setSessionPolicy(
    scope: IdentityTenantScope,
    actorId: string,
    policy: SessionPolicy,
  ): Promise<SessionPolicy> {
    return this.#mutate(scope, (document, now) => {
      document.policy = sessionPolicySchema.parse(policy);
      this.#event(document, now, {
        action: 'identity.policy.updated',
        outcome: 'success',
        actorId,
        reason: 'policy_updated',
      });
      return document.policy;
    });
  }

  async upsertUser(
    scope: IdentityTenantScope,
    actorId: string,
    input: ScimUserInput,
    id = this.#createId(),
    expectedVersion?: number,
  ): Promise<DirectoryUser> {
    return this.#mutate(scope, (document, now) => {
      const duplicate = document.users.find(
        (user) =>
          user.id !== id &&
          (user.userName.toLowerCase() === input.userName.toLowerCase() ||
            (input.externalId && user.externalId === input.externalId)),
      );
      if (duplicate)
        throw new GridStoryError('Directory user already exists.', 'scim_conflict', 409);
      const current = document.users.find((user) => user.id === id);
      if (expectedVersion !== undefined && current?.version !== expectedVersion) {
        throw new GridStoryError(
          'Directory user version does not match.',
          'scim_precondition',
          412,
        );
      }
      const user: DirectoryUser = {
        ...scope,
        id,
        userName: input.userName,
        ...(input.externalId ? { externalId: input.externalId } : {}),
        ...(input.displayName ? { displayName: input.displayName } : {}),
        emails: unique(input.emails.map((email) => email.value.toLowerCase())),
        active: input.active,
        providerLinks: current?.providerLinks ?? [],
        federatedGroups: current?.federatedGroups ?? [],
        groupIds: current?.groupIds ?? [],
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      };
      if (current) Object.assign(current, user);
      else document.users.push(user);
      if (!user.active) this.#revokeUserSessions(document, user.id, actorId, now, 'user_disabled');
      this.#event(document, now, {
        action: current ? 'identity.user.updated' : 'identity.user.provisioned',
        outcome: 'success',
        actorId,
        subjectId: user.id,
      });
      return user;
    });
  }

  async deprovisionUser(
    scope: IdentityTenantScope,
    actorId: string,
    userId: string,
  ): Promise<DirectoryUser> {
    return this.#mutate(scope, (document, now) => {
      const user = document.users.find((candidate) => candidate.id === userId);
      if (!user) throw new NotFoundError('Directory user was not found.');
      user.active = false;
      user.version += 1;
      user.updatedAt = now.toISOString();
      this.#revokeUserSessions(document, user.id, actorId, now, 'user_deprovisioned');
      this.#event(document, now, {
        action: 'identity.user.deprovisioned',
        outcome: 'success',
        actorId,
        subjectId: user.id,
      });
      return user;
    });
  }

  async upsertGroup(
    scope: IdentityTenantScope,
    actorId: string,
    input: ScimGroupInput,
    id = this.#createId(),
    expectedVersion?: number,
  ): Promise<DirectoryGroup> {
    return this.#mutate(scope, (document, now) => {
      const memberIds = unique(input.members.map((member) => member.value));
      if (memberIds.some((memberId) => !document.users.some((user) => user.id === memberId))) {
        throw new GridStoryError('SCIM group contains an unknown user.', 'scim_invalid_value', 400);
      }
      const duplicate = document.groups.find(
        (group) =>
          group.id !== id &&
          (group.displayName.toLowerCase() === input.displayName.toLowerCase() ||
            (input.externalId && group.externalId === input.externalId)),
      );
      if (duplicate)
        throw new GridStoryError('Directory group already exists.', 'scim_conflict', 409);
      const current = document.groups.find((group) => group.id === id);
      if (expectedVersion !== undefined && current?.version !== expectedVersion) {
        throw new GridStoryError(
          'Directory group version does not match.',
          'scim_precondition',
          412,
        );
      }
      const group: DirectoryGroup = {
        ...scope,
        id,
        displayName: input.displayName,
        ...(input.externalId ? { externalId: input.externalId } : {}),
        memberIds,
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      };
      if (current) Object.assign(current, group);
      else document.groups.push(group);
      for (const user of document.users) {
        user.groupIds = memberIds.includes(user.id)
          ? unique([...user.groupIds, group.id])
          : user.groupIds.filter((groupId) => groupId !== group.id);
      }
      this.#event(document, now, {
        action: current ? 'identity.group.updated' : 'identity.group.provisioned',
        outcome: 'success',
        actorId,
        subjectId: group.id,
      });
      return group;
    });
  }

  async deprovisionGroup(
    scope: IdentityTenantScope,
    actorId: string,
    groupId: string,
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      const index = document.groups.findIndex((group) => group.id === groupId);
      if (index < 0) throw new NotFoundError('Directory group was not found.');
      document.groups.splice(index, 1);
      for (const user of document.users) {
        user.groupIds = user.groupIds.filter((candidate) => candidate !== groupId);
      }
      this.#event(document, now, {
        action: 'identity.group.deprovisioned',
        outcome: 'success',
        actorId,
        subjectId: groupId,
      });
    });
  }

  async upsertGroupRoleMapping(
    scope: IdentityTenantScope,
    actorId: string,
    input: Omit<GroupRoleMapping, keyof IdentityTenantScope | 'createdAt' | 'updatedAt'>,
  ): Promise<GroupRoleMapping> {
    return this.#mutate(scope, (document, now) => {
      const current = document.mappings.find((mapping) => mapping.id === input.id);
      const mapping = groupRoleMappingSchema.parse({
        ...scope,
        ...input,
        createdAt: current?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      });
      if (current) Object.assign(current, mapping);
      else document.mappings.push(mapping);
      this.#event(document, now, {
        action: 'identity.mapping.created',
        outcome: 'success',
        actorId,
        subjectId: mapping.id,
        reason: current ? 'mapping_updated' : 'mapping_created',
      });
      return mapping;
    });
  }

  async deleteGroupRoleMapping(
    scope: IdentityTenantScope,
    actorId: string,
    mappingId: string,
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      const index = document.mappings.findIndex((mapping) => mapping.id === mappingId);
      if (index < 0) throw new NotFoundError('Group role mapping was not found.');
      document.mappings.splice(index, 1);
      this.#event(document, now, {
        action: 'identity.mapping.deleted',
        outcome: 'success',
        actorId,
        subjectId: mappingId,
      });
    });
  }

  #userGroups(document: IdentityDocument, user: DirectoryUser, asserted: string[]): string[] {
    const directoryNames = document.groups
      .filter((group) => user.groupIds.includes(group.id) || group.memberIds.includes(user.id))
      .flatMap((group) => [
        group.id,
        group.displayName,
        ...(group.externalId ? [group.externalId] : []),
      ]);
    return unique([...user.federatedGroups, ...asserted, ...directoryNames]);
  }

  #principal(
    document: IdentityDocument,
    user: DirectoryUser,
    method: NonNullable<Principal['authenticationMethod']>,
    assertedGroups: string[] = [],
  ): Principal {
    const groups = this.#userGroups(document, user, assertedGroups);
    const mappings = document.mappings.filter((mapping) => groups.includes(mapping.externalGroup));
    return {
      id: user.id,
      type: 'user',
      roles: unique(mappings.map((mapping) => mapping.roleId)),
      roleAssignments: mappings.map(assignment),
      authenticationMethod: method,
      attributes: {
        userName: user.userName,
        ...(user.displayName ? { displayName: user.displayName } : {}),
        ...(user.emails[0] ? { email: user.emails[0] } : {}),
        groups,
      },
    };
  }

  #revokeUserSessions(
    document: IdentityDocument,
    userId: string,
    actorId: string,
    now: Date,
    reason: string,
  ): void {
    for (const session of document.sessions) {
      if (session.userId !== userId || session.revokedAt) continue;
      session.revokedAt = now.toISOString();
      session.revokedReason = reason;
      this.#event(document, now, {
        action: 'identity.session.revoked',
        outcome: 'success',
        actorId,
        subjectId: session.id,
        reason,
      });
    }
  }

  #issueSession(
    document: IdentityDocument,
    now: Date,
    input: {
      user?: DirectoryUser;
      principal: Principal;
      providerId?: string;
      method: 'oidc' | 'saml' | 'webauthn' | 'break-glass';
      strength: AuthenticationStrength;
      actorId: string;
      nonRenewable?: boolean;
      ttlSeconds?: number;
    },
  ): IssuedIdentitySession {
    const id = this.#createId();
    const secret = this.#createSecret();
    const absoluteTtl = input.ttlSeconds ?? document.policy.absoluteTtlSeconds;
    const idleTtl = Math.min(document.policy.idleTtlSeconds, absoluteTtl);
    const session: StoredIdentitySession = {
      organizationId: document.organizationId,
      tenantId: document.tenantId,
      id,
      ...(input.user ? { userId: input.user.id } : {}),
      principalId: input.principal.id,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      idleExpiresAt: new Date(now.getTime() + idleTtl * 1_000).toISOString(),
      expiresAt: new Date(now.getTime() + absoluteTtl * 1_000).toISOString(),
      reauthenticateAt: new Date(
        now.getTime() + Math.min(document.policy.reauthenticationSeconds, absoluteTtl) * 1_000,
      ).toISOString(),
      authenticationMethod: input.method,
      authenticationStrength: input.strength,
      nonRenewable: input.nonRenewable ?? false,
      secretHash: digest(secret),
    };
    document.sessions.push(session);
    if (input.user) {
      const active = document.sessions
        .filter(
          (candidate) =>
            candidate.userId === input.user?.id &&
            !candidate.revokedAt &&
            Date.parse(candidate.expiresAt) > now.getTime(),
        )
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      while (active.length > document.policy.maximumConcurrentSessions) {
        const oldest = active.shift();
        if (!oldest) break;
        oldest.revokedAt = now.toISOString();
        oldest.revokedReason = 'concurrent_session_limit';
        this.#event(document, now, {
          action: 'identity.session.revoked',
          outcome: 'success',
          actorId: input.actorId,
          subjectId: oldest.id,
          reason: 'concurrent_session_limit',
        });
      }
    }
    this.#event(document, now, {
      action: 'identity.session.created',
      outcome: 'success',
      actorId: input.actorId,
      subjectId: id,
      reason: input.method,
    });
    const { secretHash: _secretHash, ...publicSession } = session;
    return { token: `gss_${id}.${secret}`, session: publicSession, principal: input.principal };
  }

  async completeFederation(
    scope: IdentityTenantScope,
    input: FederatedSessionInput,
  ): Promise<IssuedIdentitySession> {
    const identity = federatedIdentitySchema.parse(input.identity);
    return this.#mutate(scope, (document, now) => {
      const provider = document.providers.find(
        (candidate) =>
          candidate.id === identity.providerId &&
          candidate.protocol === identity.protocol &&
          candidate.issuer === identity.issuer &&
          candidate.enabled,
      );
      if (!provider) {
        throw new GridStoryError('Federation provider is not trusted.', 'invalid_identity', 401);
      }
      let user = document.users.find((candidate) =>
        candidate.providerLinks.some(
          (link) => link.providerId === provider.id && link.subject === identity.subject,
        ),
      );
      if (!user && provider.allowJitProvisioning) {
        const id = this.#createId();
        user = {
          ...scope,
          id,
          userName: identity.email ?? `${provider.id}:${identity.subject}`,
          ...(identity.displayName ? { displayName: identity.displayName } : {}),
          emails: identity.email ? [identity.email.toLowerCase()] : [],
          active: true,
          providerLinks: [{ providerId: provider.id, subject: identity.subject }],
          federatedGroups: identity.groups,
          groupIds: [],
          version: 1,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        document.users.push(user);
        this.#event(document, now, {
          action: 'identity.user.provisioned',
          outcome: 'success',
          actorId: input.actorId ?? user.id,
          subjectId: user.id,
          reason: 'federation_jit',
        });
      }
      if (!user?.active) {
        throw new GridStoryError('Federated directory user is inactive.', 'invalid_identity', 401);
      }
      user.federatedGroups = identity.groups;
      user.updatedAt = now.toISOString();
      user.version += 1;
      const principal = this.#principal(document, user, identity.protocol, identity.groups);
      const result = this.#issueSession(document, now, {
        user,
        principal,
        providerId: provider.id,
        method: identity.protocol,
        strength: identity.strength,
        actorId: input.actorId ?? user.id,
      });
      this.#event(document, now, {
        action: 'identity.federation.succeeded',
        outcome: 'success',
        actorId: user.id,
        subjectId: provider.id,
        reason: identity.protocol,
      });
      return result;
    });
  }

  async recordFederationFailure(
    scope: IdentityTenantScope,
    providerId: string,
    reason: string,
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      this.#event(document, now, {
        action: 'identity.federation.failed',
        outcome: 'denied',
        actorId: 'anonymous',
        subjectId: providerId,
        reason,
      });
    });
  }

  async createFederationTransaction(
    scope: IdentityTenantScope,
    protocol: 'oidc' | 'saml',
  ): Promise<FederationTransaction> {
    return this.#mutate(scope, (document, now) => {
      const id = this.#createId();
      const state = this.#createSecret();
      const nonce = this.#createSecret();
      const codeVerifier = this.#createSecret();
      const expiresAt = new Date(now.getTime() + FEDERATION_TRANSACTION_TTL_MS).toISOString();
      document.federationTransactions = document.federationTransactions.filter(
        (transaction) => Date.parse(transaction.expiresAt) > now.getTime(),
      );
      document.federationTransactions.push({
        ...scope,
        id,
        protocol,
        stateHash: digest(state),
        nonce,
        codeVerifier,
        createdAt: now.toISOString(),
        expiresAt,
      });
      return { token: `gft_${id}.${state}`, nonce, codeVerifier, expiresAt };
    });
  }

  async consumeFederationTransaction(
    scope: IdentityTenantScope,
    protocol: 'oidc' | 'saml',
    token: string,
  ): Promise<{ nonce: string; codeVerifier: string }> {
    const parts = tokenParts(token, 'gft');
    if (!parts) throw new GridStoryError('Federation state is invalid.', 'invalid_identity', 401);
    const outcome = await this.#mutate(scope, (document, now) => {
      const transaction = document.federationTransactions.find(
        (candidate) => candidate.id === parts.id && candidate.protocol === protocol,
      );
      if (
        !transaction ||
        transaction.consumedAt ||
        Date.parse(transaction.expiresAt) <= now.getTime() ||
        !secretMatches(transaction.stateHash, parts.secret) ||
        !transaction.nonce ||
        !transaction.codeVerifier
      ) {
        return { denied: true as const, nonce: '', codeVerifier: '' };
      }
      transaction.consumedAt = now.toISOString();
      return {
        denied: false as const,
        nonce: transaction.nonce,
        codeVerifier: transaction.codeVerifier,
      };
    });
    if (outcome.denied) {
      throw new GridStoryError('Federation state is invalid or replayed.', 'invalid_identity', 401);
    }
    return { nonce: outcome.nonce, codeVerifier: outcome.codeVerifier };
  }

  async saveProtocolRequest(
    scope: IdentityTenantScope,
    key: string,
    value: string,
    ttlMs = FEDERATION_TRANSACTION_TTL_MS,
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      document.protocolRequests = document.protocolRequests.filter(
        (request) => request.key !== key && Date.parse(request.expiresAt) > now.getTime(),
      );
      document.protocolRequests.push({
        ...scope,
        key,
        value,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      });
    });
  }

  async getProtocolRequest(scope: IdentityTenantScope, key: string): Promise<string | null> {
    const document = await this.#document(scope);
    const request = document.protocolRequests.find(
      (candidate) =>
        candidate.key === key && Date.parse(candidate.expiresAt) > this.#now().getTime(),
    );
    return request?.value ?? null;
  }

  async removeProtocolRequest(scope: IdentityTenantScope, key: string): Promise<string | null> {
    return this.#mutate(scope, (document) => {
      const request = document.protocolRequests.find((candidate) => candidate.key === key);
      document.protocolRequests = document.protocolRequests.filter(
        (candidate) => candidate.key !== key,
      );
      return request?.value ?? null;
    });
  }

  async authenticateSession(
    scope: IdentityTenantScope,
    token: string,
    options: {
      minimumStrength?: AuthenticationStrength;
      requireRecentAuthentication?: boolean;
    } = {},
  ): Promise<{ session: IdentitySession; principal: Principal }> {
    const parts = tokenParts(token, 'gss');
    if (!parts) throw new GridStoryError('Session token is invalid.', 'invalid_session', 401);
    const outcome = await this.#mutate(scope, (document, now) => {
      const stored = document.sessions.find((session) => session.id === parts.id);
      if (!stored || !secretMatches(stored.secretHash, parts.secret) || stored.revokedAt) {
        throw new GridStoryError('Session token is invalid.', 'invalid_session', 401);
      }
      if (
        Date.parse(stored.expiresAt) <= now.getTime() ||
        Date.parse(stored.idleExpiresAt) <= now.getTime()
      ) {
        stored.revokedAt = now.toISOString();
        stored.revokedReason = 'expired';
        this.#event(document, now, {
          action: 'identity.session.expired',
          outcome: 'denied',
          actorId: stored.principalId,
          subjectId: stored.id,
        });
        return { error: 'expired' as const };
      }
      if (
        options.minimumStrength &&
        strengthRank(stored.authenticationStrength) < strengthRank(options.minimumStrength)
      ) {
        throw new GridStoryError(
          'A stronger authentication method is required.',
          'step_up_required',
          403,
        );
      }
      if (
        options.requireRecentAuthentication &&
        Date.parse(stored.reauthenticateAt) <= now.getTime()
      ) {
        throw new GridStoryError(
          'Recent authentication is required.',
          'reauthentication_required',
          403,
        );
      }
      const user = stored.userId
        ? document.users.find((candidate) => candidate.id === stored.userId)
        : undefined;
      if (stored.userId && !user?.active) {
        throw new GridStoryError('Session user is inactive.', 'invalid_session', 401);
      }
      stored.lastSeenAt = now.toISOString();
      stored.idleExpiresAt = new Date(
        Math.min(
          now.getTime() + document.policy.idleTtlSeconds * 1_000,
          Date.parse(stored.expiresAt),
        ),
      ).toISOString();
      const principal = user
        ? this.#principal(document, user, stored.authenticationMethod)
        : {
            id: stored.principalId,
            type: 'user' as const,
            roles: document.breakGlassAccounts
              .filter((account) => account.id === stored.principalId)
              .map((account) => account.roleId),
            roleAssignments: document.breakGlassAccounts
              .filter((account) => account.id === stored.principalId)
              .map((account) => ({
                roleId: account.roleId,
                organizationId: account.organizationId,
                tenantId: account.tenantId,
              })),
            authenticationMethod: 'break-glass' as const,
          };
      const { secretHash: _secretHash, ...session } = stored;
      return { session, principal, error: null };
    });
    if (outcome.error === 'expired') {
      throw new GridStoryError('Session has expired.', 'invalid_session', 401);
    }
    return { session: outcome.session, principal: outcome.principal };
  }

  async revokeSession(
    scope: IdentityTenantScope,
    actorId: string,
    sessionId: string,
    reason = 'logout',
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      const session = document.sessions.find((candidate) => candidate.id === sessionId);
      if (!session) throw new NotFoundError('Identity session was not found.');
      if (!session.revokedAt) {
        session.revokedAt = now.toISOString();
        session.revokedReason = reason;
      }
      this.#event(document, now, {
        action: 'identity.session.revoked',
        outcome: 'success',
        actorId,
        subjectId: sessionId,
        reason,
      });
    });
  }

  async createWebAuthnChallenge(
    scope: IdentityTenantScope,
    input: {
      userId: string;
      sessionId: string;
      kind: 'registration' | 'authentication';
      challenge: string;
    },
  ): Promise<{ id: string; challenge: string; expiresAt: string }> {
    return this.#mutate(scope, (document, now) => {
      const user = document.users.find((candidate) => candidate.id === input.userId);
      const session = document.sessions.find((candidate) => candidate.id === input.sessionId);
      if (!user?.active || session?.userId !== user.id || session.revokedAt) {
        throw new GridStoryError('Active identity session is required.', 'invalid_session', 401);
      }
      const challenge = {
        ...scope,
        id: this.#createId(),
        kind: input.kind,
        challenge: input.challenge,
        userId: user.id,
        sessionId: session.id,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
      } as const;
      document.challenges.push(challenge);
      return { id: challenge.id, challenge: challenge.challenge, expiresAt: challenge.expiresAt };
    });
  }

  async getWebAuthnChallenge(
    scope: IdentityTenantScope,
    challengeId: string,
  ): Promise<{
    id: string;
    kind: 'registration' | 'authentication';
    challenge: string;
    userId: string;
    sessionId: string;
    expiresAt: string;
  }> {
    const document = await this.#document(scope);
    const challenge = document.challenges.find(
      (candidate) =>
        candidate.id === challengeId &&
        !candidate.consumedAt &&
        Date.parse(candidate.expiresAt) > this.#now().getTime(),
    );
    if (!challenge) throw new NotFoundError('Active WebAuthn challenge was not found.');
    return {
      id: challenge.id,
      kind: challenge.kind,
      challenge: challenge.challenge,
      userId: challenge.userId,
      sessionId: challenge.sessionId,
      expiresAt: challenge.expiresAt,
    };
  }

  #consumeChallenge(
    document: IdentityDocument,
    now: Date,
    challengeId: string,
    kind: 'registration' | 'authentication',
  ) {
    const challenge = document.challenges.find(
      (candidate) => candidate.id === challengeId && candidate.kind === kind,
    );
    if (!challenge || challenge.consumedAt || Date.parse(challenge.expiresAt) <= now.getTime()) {
      throw new GridStoryError(
        'WebAuthn challenge is invalid or expired.',
        'invalid_challenge',
        401,
      );
    }
    challenge.consumedAt = now.toISOString();
    return challenge;
  }

  async completeWebAuthnRegistration(
    scope: IdentityTenantScope,
    actorId: string,
    challengeId: string,
    verified: VerifiedWebAuthnRegistration,
  ): Promise<WebAuthnCredential> {
    return this.#mutate(scope, (document, now) => {
      const challenge = this.#consumeChallenge(document, now, challengeId, 'registration');
      if (document.credentials.some((credential) => credential.id === verified.credentialId)) {
        throw new GridStoryError('WebAuthn credential already exists.', 'identity_conflict', 409);
      }
      const credential = webAuthnCredentialSchema.parse({
        ...scope,
        id: verified.credentialId,
        userId: challenge.userId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports ?? [],
        deviceType: verified.deviceType,
        backedUp: verified.backedUp,
        createdAt: now.toISOString(),
      });
      document.credentials.push(credential);
      this.#event(document, now, {
        action: 'identity.webauthn.registered',
        outcome: 'success',
        actorId,
        subjectId: credential.id,
      });
      return credential;
    });
  }

  async completeWebAuthnAuthentication(
    scope: IdentityTenantScope,
    actorId: string,
    challengeId: string,
    verified: VerifiedWebAuthnAuthentication,
  ): Promise<IdentitySession> {
    return this.#mutate(scope, (document, now) => {
      const challenge = this.#consumeChallenge(document, now, challengeId, 'authentication');
      const credential = document.credentials.find(
        (candidate) =>
          candidate.id === verified.credentialId &&
          candidate.userId === challenge.userId &&
          !candidate.revokedAt,
      );
      const session = document.sessions.find(
        (candidate) =>
          candidate.id === challenge.sessionId && candidate.userId === challenge.userId,
      );
      if (
        !credential ||
        !session ||
        session.revokedAt ||
        verified.newCounter < credential.counter
      ) {
        throw new GridStoryError('WebAuthn assertion is invalid.', 'invalid_identity', 401);
      }
      credential.counter = verified.newCounter;
      credential.lastUsedAt = now.toISOString();
      session.authenticationMethod = 'webauthn';
      session.authenticationStrength = 'phishing-resistant';
      session.reauthenticateAt = new Date(
        now.getTime() + document.policy.reauthenticationSeconds * 1_000,
      ).toISOString();
      this.#event(document, now, {
        action: 'identity.webauthn.verified',
        outcome: 'success',
        actorId,
        subjectId: credential.id,
      });
      const { secretHash: _secretHash, ...publicSession } = session;
      return publicSession;
    });
  }

  async revokeWebAuthnCredential(
    scope: IdentityTenantScope,
    actorId: string,
    credentialId: string,
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      const credential = document.credentials.find((candidate) => candidate.id === credentialId);
      if (!credential) throw new NotFoundError('WebAuthn credential was not found.');
      credential.revokedAt = now.toISOString();
      this.#event(document, now, {
        action: 'identity.webauthn.revoked',
        outcome: 'success',
        actorId,
        subjectId: credentialId,
      });
    });
  }

  async issueDirectoryCredential(
    scope: IdentityTenantScope,
    actorId: string,
    name: string,
    ttlMs = SERVICE_CREDENTIAL_TTL_MS,
  ): Promise<IssuedIdentityCredential> {
    return this.#mutate(scope, (document, now) => {
      const id = this.#createId();
      const secret = this.#createSecret();
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
      document.serviceCredentials.push({
        ...scope,
        id,
        name,
        secretHash: digest(secret),
        status: 'active',
        createdBy: actorId,
        createdAt: now.toISOString(),
        expiresAt,
      });
      return { id, token: `gsc_${id}.${secret}`, expiresAt };
    });
  }

  async authenticateDirectoryCredential(
    scope: IdentityTenantScope,
    token: string,
  ): Promise<{ id: string; name: string }> {
    const parts = tokenParts(token, 'gsc');
    if (!parts) throw new GridStoryError('Directory credential is invalid.', 'invalid_token', 401);
    return this.#mutate(scope, (document, now) => {
      const credential = document.serviceCredentials.find((candidate) => candidate.id === parts.id);
      if (
        credential?.status !== 'active' ||
        Date.parse(credential.expiresAt) <= now.getTime() ||
        !secretMatches(credential.secretHash, parts.secret)
      ) {
        throw new GridStoryError('Directory credential is invalid.', 'invalid_token', 401);
      }
      credential.lastUsedAt = now.toISOString();
      return { id: credential.id, name: credential.name };
    });
  }

  async createBreakGlassAccount(
    scope: IdentityTenantScope,
    input: {
      actorId: string;
      name: string;
      roleId: string;
      expiresAt: string;
      incidentId: string;
    },
  ): Promise<IssuedIdentityCredential> {
    return this.#mutate(scope, (document, now) => {
      if (Date.parse(input.expiresAt) <= now.getTime()) {
        throw new GridStoryError(
          'Break-glass expiry must be in the future.',
          'invalid_expiry',
          400,
        );
      }
      const id = this.#createId();
      const secret = this.#createSecret();
      document.breakGlassAccounts.push({
        ...scope,
        id,
        name: input.name,
        roleId: input.roleId,
        status: 'active',
        createdBy: input.actorId,
        createdAt: now.toISOString(),
        expiresAt: input.expiresAt,
        secretHash: digest(secret),
        failedAttempts: 0,
      });
      this.#event(document, now, {
        action: 'identity.break_glass.created',
        outcome: 'success',
        actorId: input.actorId,
        subjectId: id,
        incidentId: input.incidentId,
      });
      return { id, token: `gbg_${id}.${secret}`, expiresAt: input.expiresAt };
    });
  }

  async activateBreakGlass(
    scope: IdentityTenantScope,
    token: string,
    incidentId: string,
  ): Promise<IssuedIdentitySession> {
    const parts = tokenParts(token, 'gbg');
    if (!parts)
      throw new GridStoryError('Break-glass credential is invalid.', 'invalid_token', 401);
    const outcome = await this.#mutate(scope, (document, now) => {
      const account = document.breakGlassAccounts.find((candidate) => candidate.id === parts.id);
      const valid =
        account?.status === 'active' &&
        Date.parse(account.expiresAt) > now.getTime() &&
        secretMatches(account.secretHash, parts.secret);
      if (!account || !valid) {
        if (account?.status === 'active') {
          account.failedAttempts += 1;
          if (account.failedAttempts >= document.policy.maximumFailedBreakGlassAttempts) {
            account.status = 'revoked';
            account.revokedAt = now.toISOString();
          }
          this.#event(document, now, {
            action: 'identity.break_glass.failed',
            outcome: 'denied',
            actorId: account.id,
            subjectId: account.id,
            reason: 'invalid_or_expired_credential',
            incidentId,
          });
        }
        return { result: null, denied: true as const };
      }
      account.status = 'used';
      account.usedAt = now.toISOString();
      const principal: Principal = {
        id: account.id,
        type: 'user',
        roles: [account.roleId],
        roleAssignments: [{ roleId: account.roleId, ...scope }],
        authenticationMethod: 'break-glass',
        attributes: { incidentId, breakGlass: true },
      };
      const result = this.#issueSession(document, now, {
        principal,
        method: 'break-glass',
        strength: 'break-glass',
        actorId: account.id,
        nonRenewable: true,
        ttlSeconds: document.policy.breakGlassTtlSeconds,
      });
      this.#event(document, now, {
        action: 'identity.break_glass.activated',
        outcome: 'success',
        actorId: account.id,
        subjectId: result.session.id,
        incidentId,
      });
      return { result, denied: false as const };
    });
    if (outcome.denied || !outcome.result) {
      throw new GridStoryError('Break-glass credential is invalid.', 'invalid_token', 401);
    }
    return outcome.result;
  }

  async revokeBreakGlassAccount(
    scope: IdentityTenantScope,
    actorId: string,
    accountId: string,
    incidentId: string,
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      const account = document.breakGlassAccounts.find((candidate) => candidate.id === accountId);
      if (!account) throw new NotFoundError('Break-glass account was not found.');
      account.status = 'revoked';
      account.revokedAt = now.toISOString();
      for (const session of document.sessions) {
        if (session.principalId !== account.id || session.revokedAt) continue;
        session.revokedAt = now.toISOString();
        session.revokedReason = 'break_glass_revoked';
      }
      this.#event(document, now, {
        action: 'identity.break_glass.revoked',
        outcome: 'success',
        actorId,
        subjectId: accountId,
        incidentId,
      });
    });
  }
}
