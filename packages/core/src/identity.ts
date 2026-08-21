import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AuthorizationGrant,
  OidcIdentity,
  Principal,
  ScopedTokenClaims,
  ServiceAccount,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';

export interface OidcTokenVerifier {
  /** Implementations must verify signature, issuer, audience, expiry, and nonce before returning. */
  verify(idToken: string): Promise<OidcIdentity>;
}

export interface IdentityServiceOptions {
  trustedIssuers: string[];
  audiences: string[];
  groupRoleMap?: Record<string, string[]>;
  sessionTtlSeconds?: number;
  serviceTokenTtlSeconds?: number;
  now?: () => Date;
  createId?: () => string;
  createSecret?: () => string;
}

export interface OidcSessionResult {
  identity: OidcIdentity;
  session: LegacyIdentitySession;
  principal: Principal;
}

/** @deprecated Use EnterpriseIdentityService for durable production sessions. */
export interface LegacyIdentitySession {
  id: string;
  principalId: string;
  tenantId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  authenticationMethod: 'oidc';
  revokedAt?: string;
}

export interface IssuedServiceToken {
  token: string;
  claims: ScopedTokenClaims;
}

interface StoredToken {
  claims: ScopedTokenClaims;
  secretHash: Buffer;
  revokedAt?: string;
}

function includesAudience(actual: string[], expected: string[]): boolean {
  return actual.some((audience) => expected.includes(audience));
}

function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export class IdentityService {
  readonly #trustedIssuers: Set<string>;
  readonly #audiences: string[];
  readonly #groupRoleMap: Record<string, string[]>;
  readonly #sessionTtlSeconds: number;
  readonly #serviceTokenTtlSeconds: number;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #createSecret: () => string;
  readonly #sessions = new Map<string, LegacyIdentitySession>();
  readonly #serviceAccounts = new Map<string, ServiceAccount>();
  readonly #tokens = new Map<string, StoredToken>();

  constructor({
    trustedIssuers,
    audiences,
    groupRoleMap = {},
    sessionTtlSeconds = 8 * 60 * 60,
    serviceTokenTtlSeconds = 60 * 60,
    now = () => new Date(),
    createId = randomUUID,
    createSecret = () => randomBytes(32).toString('base64url'),
  }: IdentityServiceOptions) {
    if (trustedIssuers.length === 0)
      throw new Error('At least one trusted OIDC issuer is required.');
    if (audiences.length === 0) throw new Error('At least one OIDC audience is required.');
    this.#trustedIssuers = new Set(trustedIssuers);
    this.#audiences = audiences;
    this.#groupRoleMap = groupRoleMap;
    this.#sessionTtlSeconds = sessionTtlSeconds;
    this.#serviceTokenTtlSeconds = serviceTokenTtlSeconds;
    this.#now = now;
    this.#createId = createId;
    this.#createSecret = createSecret;
  }

  async authenticateOidc(
    idToken: string,
    tenantId: string,
    verifier: OidcTokenVerifier,
  ): Promise<OidcSessionResult> {
    const identity = await verifier.verify(idToken);
    const now = Math.floor(this.#now().getTime() / 1000);
    if (!this.#trustedIssuers.has(identity.issuer)) {
      throw new GridStoryError('OIDC issuer is not trusted.', 'invalid_identity', 401);
    }
    if (!includesAudience(identity.audience, this.#audiences)) {
      throw new GridStoryError('OIDC audience is not accepted.', 'invalid_identity', 401);
    }
    if (identity.expiresAt <= now || identity.issuedAt > now + 60) {
      throw new GridStoryError(
        'OIDC identity is expired or not yet valid.',
        'invalid_identity',
        401,
      );
    }
    const roles = [...new Set(identity.groups.flatMap((group) => this.#groupRoleMap[group] ?? []))];
    const principal: Principal = {
      id: `${identity.issuer}|${identity.subject}`,
      type: 'user',
      roles,
      roleAssignments: roles.map((roleId) => ({ roleId, tenantId })),
      authenticationMethod: 'oidc',
      attributes: {
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        groups: identity.groups,
      },
    };
    const createdAt = this.#now();
    const session: LegacyIdentitySession = {
      id: this.#createId(),
      principalId: principal.id,
      tenantId,
      createdAt: createdAt.toISOString(),
      lastSeenAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.#sessionTtlSeconds * 1000).toISOString(),
      authenticationMethod: 'oidc',
    };
    this.#sessions.set(session.id, session);
    return { identity, session: structuredClone(session), principal };
  }

  getSession(id: string): LegacyIdentitySession {
    const session = this.#sessions.get(id);
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= this.#now().getTime()) {
      throw new GridStoryError('Session is invalid or expired.', 'invalid_session', 401);
    }
    session.lastSeenAt = this.#now().toISOString();
    return structuredClone(session);
  }

  revokeSession(id: string): void {
    const session = this.#sessions.get(id);
    if (!session) throw new NotFoundError('Session was not found.');
    session.revokedAt = this.#now().toISOString();
  }

  createServiceAccount(input: {
    tenantId: string;
    name: string;
    grants: AuthorizationGrant[];
  }): ServiceAccount {
    if (input.grants.some((grant) => grant.tenantId !== input.tenantId)) {
      throw new GridStoryError(
        'Every service-account grant must be explicitly bound to the account tenant.',
        'invalid_scope',
        400,
      );
    }
    const account: ServiceAccount = {
      id: this.#createId(),
      tenantId: input.tenantId,
      name: input.name,
      status: 'active',
      grants: structuredClone(input.grants),
      createdAt: this.#now().toISOString(),
    };
    this.#serviceAccounts.set(account.id, account);
    return structuredClone(account);
  }

  issueServiceToken(
    serviceAccountId: string,
    ttlSeconds = this.#serviceTokenTtlSeconds,
  ): IssuedServiceToken {
    const account = this.#serviceAccounts.get(serviceAccountId);
    if (account?.status !== 'active') {
      throw new NotFoundError('Active service account was not found.');
    }
    const tokenId = this.#createId();
    const secret = this.#createSecret();
    const now = Math.floor(this.#now().getTime() / 1000);
    const claims: ScopedTokenClaims = {
      tokenId,
      issuer: 'gridstory',
      audience: ['gridstory-api'],
      subject: account.id,
      principalType: 'service-account',
      grants: structuredClone(account.grants),
      issuedAt: now,
      expiresAt: now + ttlSeconds,
    };
    this.#tokens.set(tokenId, { claims, secretHash: hashSecret(secret) });
    account.rotatedAt = this.#now().toISOString();
    return { token: `gst_${tokenId}.${secret}`, claims: structuredClone(claims) };
  }

  authenticateServiceToken(token: string): Principal {
    const match = /^gst_([^.]+)\.(.+)$/.exec(token);
    if (!match) throw new GridStoryError('Service token is invalid.', 'invalid_token', 401);
    const stored = this.#tokens.get(match[1] ?? '');
    const suppliedHash = hashSecret(match[2] ?? '');
    if (
      !stored ||
      stored.revokedAt ||
      stored.claims.expiresAt <= Math.floor(this.#now().getTime() / 1000) ||
      stored.secretHash.length !== suppliedHash.length ||
      !timingSafeEqual(stored.secretHash, suppliedHash)
    ) {
      throw new GridStoryError('Service token is invalid or expired.', 'invalid_token', 401);
    }
    return {
      id: stored.claims.subject,
      type: 'service-account',
      roles: [],
      grants: structuredClone(stored.claims.grants),
      authenticationMethod: 'service-token',
    };
  }

  revokeServiceToken(tokenId: string): void {
    const stored = this.#tokens.get(tokenId);
    if (!stored) throw new NotFoundError('Service token was not found.');
    stored.revokedAt = this.#now().toISOString();
  }
}
