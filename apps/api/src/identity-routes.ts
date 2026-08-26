import type {
  EnterpriseIdentityService,
  IdentityRepository,
  IdentityTenantScope,
} from '@gridstory/core';
import { GridStoryError } from '@gridstory/core';
import {
  type DirectoryGroup,
  type DirectoryUser,
  groupRoleMappingSchema,
  identityProviderSchema,
  type ScimGroupInput,
  type ScimUserInput,
  scimGroupInputSchema,
  scimPatchSchema,
  scimUserInputSchema,
  sessionPolicySchema,
} from '@gridstory/schema';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FederationAdapter, WebAuthnAdapter } from './identity-adapters.js';
import { bindRequestIdentity, bindRequestIdentityMode, requestContext } from './request-context.js';

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const FORBIDDEN_DEVELOPMENT_HEADERS = [
  'x-gridstory-actor',
  'x-gridstory-principal-type',
  'x-gridstory-roles',
] as const;

export interface IdentityRouteOptions {
  mode: 'development' | 'production';
  identity: EnterpriseIdentityService;
  identityRepository: IdentityRepository;
  adapters: Map<string, FederationAdapter>;
  webAuthn: WebAuthnAdapter;
  cookieName: string;
  secureCookies: boolean;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function scope(request: FastifyRequest, production: boolean): IdentityTenantScope {
  const query = request.query as { organizationId?: unknown; tenantId?: unknown };
  const organizationId =
    header(request, 'x-gridstory-organization') ??
    (typeof query.organizationId === 'string' ? query.organizationId : undefined);
  const tenantId =
    header(request, 'x-gridstory-tenant') ??
    (typeof query.tenantId === 'string' ? query.tenantId : undefined);
  if (production && (!organizationId || !tenantId)) {
    throw new GridStoryError(
      'Organization and tenant routing headers are required.',
      'invalid_scope',
      400,
    );
  }
  return { organizationId: organizationId ?? 'local', tenantId: tenantId ?? 'default' };
}

function bearer(request: FastifyRequest): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '');
  return match?.[1];
}

function sessionToken(request: FastifyRequest, cookieName: string): string | undefined {
  const authorization = bearer(request);
  if (authorization?.startsWith('gss_')) return authorization;
  return request.cookies[cookieName];
}

function setSessionCookie(
  reply: FastifyReply,
  options: IdentityRouteOptions,
  token: string,
  expiresAt: string,
): void {
  reply.setCookie(options.cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secureCookies,
    expires: new Date(expiresAt),
  });
}

function requireIdentityAdmin(request: FastifyRequest): void {
  const principal = requestContext(request, 'draft').principal;
  if (!principal.roles.some((role) => role === 'admin' || role === 'identity-admin')) {
    throw new GridStoryError('Identity administration requires an admin role.', 'forbidden', 403);
  }
}

function isPublicPath(request: FastifyRequest): boolean {
  // Use the router's selected handler, not a separately parsed raw URL or token prefix.
  const path = request.routeOptions.url;
  if (!path) return false;
  return (
    path === '/health' ||
    path === '/ready' ||
    path.startsWith('/api/v1/delivery/') ||
    path.startsWith('/api/v1/identity/federation/') ||
    (request.method === 'POST' && path === '/api/v1/identity/break-glass/activate') ||
    path.startsWith('/api/v1/scim/v2/')
  );
}

function isPreviewCredentialRequest(request: FastifyRequest): boolean {
  if (!bearer(request)?.startsWith('gsp_')) return false;
  const path = request.routeOptions.url;
  return (
    (request.method === 'GET' && path === '/api/v1/preview/content/:id') ||
    (request.method === 'POST' && path === '/api/v1/preview/sessions/:id/messages') ||
    (request.method === 'DELETE' && path === '/api/v1/preview/sessions/:id')
  );
}

function etag(version: number): string {
  return `W/"${version}"`;
}

function expectedVersion(request: FastifyRequest): number {
  const value = request.headers['if-match'];
  const raw = Array.isArray(value) ? value[0] : value;
  const match = /^W\/"(\d+)"$/.exec(raw ?? '');
  if (!match?.[1]) {
    throw new GridStoryError('A current weak If-Match ETag is required.', 'scim_precondition', 428);
  }
  return Number(match[1]);
}

function scimUser(user: DirectoryUser, baseUrl: string) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.id,
    ...(user.externalId ? { externalId: user.externalId } : {}),
    userName: user.userName,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    active: user.active,
    emails: user.emails.map((value, index) => ({ value, primary: index === 0 })),
    groups: user.groupIds.map((value) => ({ value })),
    meta: {
      resourceType: 'User',
      created: user.createdAt,
      lastModified: user.updatedAt,
      version: etag(user.version),
      location: `${baseUrl}/Users/${encodeURIComponent(user.id)}`,
    },
  };
}

function scimGroup(group: DirectoryGroup, baseUrl: string) {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: group.id,
    ...(group.externalId ? { externalId: group.externalId } : {}),
    displayName: group.displayName,
    members: group.memberIds.map((value) => ({ value })),
    meta: {
      resourceType: 'Group',
      created: group.createdAt,
      lastModified: group.updatedAt,
      version: etag(group.version),
      location: `${baseUrl}/Groups/${encodeURIComponent(group.id)}`,
    },
  };
}

function filterResources<T extends DirectoryUser | DirectoryGroup>(
  resources: T[],
  filter: unknown,
): T[] {
  if (filter === undefined) return resources;
  if (typeof filter !== 'string') {
    throw new GridStoryError('SCIM filter is invalid.', 'scim_invalid_filter', 400);
  }
  const match = /^(userName|externalId|displayName)\s+eq\s+"([^"]{1,320})"$/i.exec(filter);
  if (!match?.[1] || match[2] === undefined) {
    throw new GridStoryError(
      'Only exact userName, externalId, or displayName SCIM filters are supported.',
      'scim_invalid_filter',
      400,
    );
  }
  const property = match[1] as 'userName' | 'externalId' | 'displayName';
  const expected = match[2].toLowerCase();
  return resources.filter((resource) => {
    const value =
      property === 'userName'
        ? 'userName' in resource
          ? resource.userName
          : undefined
        : resource[property];
    return typeof value === 'string' && value.toLowerCase() === expected;
  });
}

async function authenticateScim(
  request: FastifyRequest,
  options: IdentityRouteOptions,
): Promise<{ scope: IdentityTenantScope; actorId: string }> {
  const requestScope = scope(request, options.mode === 'production');
  const token = bearer(request);
  if (!token) throw new GridStoryError('SCIM bearer credential is required.', 'invalid_token', 401);
  const credential = await options.identity.authenticateDirectoryCredential(requestScope, token);
  return { scope: requestScope, actorId: credential.id };
}

function applyUserPatch(user: DirectoryUser, body: unknown): ScimUserInput {
  const patch = scimPatchSchema.parse(body);
  const draft: Record<string, unknown> = {
    userName: user.userName,
    ...(user.externalId ? { externalId: user.externalId } : {}),
    ...(user.displayName ? { displayName: user.displayName } : {}),
    active: user.active,
    emails: user.emails.map((value) => ({ value })),
  };
  for (const operation of patch.Operations) {
    const path = operation.path?.toLowerCase();
    if (!path && typeof operation.value === 'object' && operation.value !== null) {
      Object.assign(draft, operation.value);
      continue;
    }
    if (!path || !['username', 'externalid', 'displayname', 'active', 'emails'].includes(path)) {
      throw new GridStoryError('SCIM user patch path is unsupported.', 'scim_invalid_path', 400);
    }
    const canonical = {
      username: 'userName',
      externalid: 'externalId',
      displayname: 'displayName',
      active: 'active',
      emails: 'emails',
    }[path];
    if (!canonical) continue;
    if (operation.op === 'remove') delete draft[canonical];
    else draft[canonical] = operation.value;
  }
  return scimUserInputSchema.parse(draft);
}

function applyGroupPatch(group: DirectoryGroup, body: unknown): ScimGroupInput {
  const patch = scimPatchSchema.parse(body);
  const draft: Record<string, unknown> = {
    ...(group.externalId ? { externalId: group.externalId } : {}),
    displayName: group.displayName,
    members: group.memberIds.map((value) => ({ value })),
  };
  for (const operation of patch.Operations) {
    const path = operation.path?.toLowerCase();
    if (!path && typeof operation.value === 'object' && operation.value !== null) {
      Object.assign(draft, operation.value);
      continue;
    }
    if (!path || !['externalid', 'displayname', 'members'].includes(path)) {
      throw new GridStoryError('SCIM group patch path is unsupported.', 'scim_invalid_path', 400);
    }
    const canonical = {
      externalid: 'externalId',
      displayname: 'displayName',
      members: 'members',
    }[path];
    if (!canonical) continue;
    if (operation.op === 'remove') {
      if (canonical === 'members') draft.members = [];
      else delete draft[canonical];
    } else draft[canonical] = operation.value;
  }
  return scimGroupInputSchema.parse(draft);
}

export async function registerIdentityRoutes(
  server: FastifyInstance,
  options: IdentityRouteOptions,
): Promise<void> {
  server.addHook('onRequest', async (request) => {
    bindRequestIdentityMode(request, options.mode);
    if (options.mode === 'development') return;
    if (FORBIDDEN_DEVELOPMENT_HEADERS.some((name) => header(request, name))) {
      throw new GridStoryError(
        'Development identity headers are disabled in production mode.',
        'invalid_identity',
        401,
      );
    }
    if (isPublicPath(request) || isPreviewCredentialRequest(request)) return;
    const requestScope = scope(request, true);
    const token = sessionToken(request, options.cookieName);
    if (!token)
      throw new GridStoryError('An authenticated session is required.', 'invalid_session', 401);
    const authenticated = await options.identity.authenticateSession(requestScope, token);
    bindRequestIdentity(request, {
      ...requestScope,
      principal: authenticated.principal,
      session: authenticated.session,
    });
  });

  server.get('/api/v1/identity', async (request) => {
    requireIdentityAdmin(request);
    return options.identity.snapshot(scope(request, options.mode === 'production'));
  });

  server.post('/api/v1/identity/providers', async (request, reply) => {
    requireIdentityAdmin(request);
    const context = requestContext(request, 'draft');
    const parsed = identityProviderSchema
      .omit({ organizationId: true, tenantId: true, createdAt: true, updatedAt: true })
      .parse(request.body);
    if (!options.adapters.has(parsed.id)) {
      throw new GridStoryError(
        'Provider has no matching trusted runtime adapter configuration.',
        'invalid_identity_configuration',
        400,
      );
    }
    const provider = await options.identity.configureProvider(
      { organizationId: context.organizationId, tenantId: context.tenantId },
      context.principal.id,
      parsed,
    );
    return reply.status(201).send(provider);
  });

  server.put('/api/v1/identity/session-policy', async (request) => {
    requireIdentityAdmin(request);
    const context = requestContext(request, 'draft');
    return options.identity.setSessionPolicy(
      { organizationId: context.organizationId, tenantId: context.tenantId },
      context.principal.id,
      sessionPolicySchema.parse(request.body),
    );
  });

  server.post('/api/v1/identity/group-role-mappings', async (request, reply) => {
    requireIdentityAdmin(request);
    const context = requestContext(request, 'draft');
    const parsed = groupRoleMappingSchema
      .omit({ organizationId: true, tenantId: true, createdAt: true, updatedAt: true })
      .parse(request.body);
    const mapping = await options.identity.upsertGroupRoleMapping(
      { organizationId: context.organizationId, tenantId: context.tenantId },
      context.principal.id,
      parsed,
    );
    return reply.status(201).send(mapping);
  });

  server.delete('/api/v1/identity/group-role-mappings/:id', async (request, reply) => {
    requireIdentityAdmin(request);
    const context = requestContext(request, 'draft');
    await options.identity.deleteGroupRoleMapping(
      { organizationId: context.organizationId, tenantId: context.tenantId },
      context.principal.id,
      (request.params as { id: string }).id,
    );
    return reply.status(204).send();
  });

  server.get('/api/v1/identity/federation/:providerId/start', async (request, reply) => {
    const requestScope = scope(request, options.mode === 'production');
    const providerId = (request.params as { providerId: string }).providerId;
    const provider = (await options.identity.snapshot(requestScope)).providers.find(
      (candidate) => candidate.id === providerId && candidate.enabled,
    );
    const adapter = options.adapters.get(providerId);
    if (!provider || !adapter || provider.protocol !== adapter.protocol) {
      throw new GridStoryError('Federation provider is unavailable.', 'invalid_identity', 404);
    }
    return reply.redirect(await adapter.start(requestScope));
  });

  server.get('/api/v1/identity/federation/:providerId/callback', async (request, reply) => {
    const requestScope = scope(request, options.mode === 'production');
    const providerId = (request.params as { providerId: string }).providerId;
    const adapter = options.adapters.get(providerId);
    if (adapter?.protocol !== 'oidc') {
      throw new GridStoryError('OIDC provider is unavailable.', 'invalid_identity', 404);
    }
    try {
      const identity = await adapter.complete(requestScope, { callbackUrl: request.url });
      const issued = await options.identity.completeFederation(requestScope, { identity });
      setSessionCookie(reply, options, issued.token, issued.session.expiresAt);
      return { session: issued.session, principal: issued.principal };
    } catch (error) {
      await options.identity.recordFederationFailure(
        requestScope,
        providerId,
        'oidc_callback_denied',
      );
      throw error;
    }
  });

  server.post('/api/v1/identity/federation/:providerId/callback', async (request, reply) => {
    const requestScope = scope(request, options.mode === 'production');
    const providerId = (request.params as { providerId: string }).providerId;
    const adapter = options.adapters.get(providerId);
    if (adapter?.protocol !== 'saml') {
      throw new GridStoryError('SAML provider is unavailable.', 'invalid_identity', 404);
    }
    try {
      const body = request.body as Record<string, string>;
      const identity = await adapter.complete(requestScope, { body });
      const issued = await options.identity.completeFederation(requestScope, { identity });
      setSessionCookie(reply, options, issued.token, issued.session.expiresAt);
      return { session: issued.session, principal: issued.principal };
    } catch (error) {
      await options.identity.recordFederationFailure(
        requestScope,
        providerId,
        'saml_callback_denied',
      );
      throw error;
    }
  });

  server.get('/api/v1/identity/session', async (request) => {
    const token = sessionToken(request, options.cookieName);
    if (!token)
      throw new GridStoryError('An authenticated session is required.', 'invalid_session', 401);
    return options.identity.authenticateSession(
      scope(request, options.mode === 'production'),
      token,
    );
  });

  server.delete('/api/v1/identity/session', async (request, reply) => {
    const requestScope = scope(request, options.mode === 'production');
    const token = sessionToken(request, options.cookieName);
    if (!token)
      throw new GridStoryError('An authenticated session is required.', 'invalid_session', 401);
    const authenticated = await options.identity.authenticateSession(requestScope, token);
    await options.identity.revokeSession(
      requestScope,
      authenticated.principal.id,
      authenticated.session.id,
      'logout',
    );
    reply.clearCookie(options.cookieName, { path: '/' });
    return reply.status(204).send();
  });

  server.post('/api/v1/identity/directory-credentials', async (request, reply) => {
    requireIdentityAdmin(request);
    const context = requestContext(request, 'draft');
    const name = (request.body as { name?: unknown })?.name;
    if (typeof name !== 'string' || !name.trim()) {
      throw new GridStoryError('Directory credential name is required.', 'invalid_request', 400);
    }
    return reply
      .status(201)
      .send(
        await options.identity.issueDirectoryCredential(
          { organizationId: context.organizationId, tenantId: context.tenantId },
          context.principal.id,
          name,
        ),
      );
  });

  server.post('/api/v1/identity/break-glass', async (request, reply) => {
    requireIdentityAdmin(request);
    const context = requestContext(request, 'draft');
    const body = request.body as Record<string, unknown>;
    for (const field of ['name', 'roleId', 'expiresAt', 'incidentId']) {
      if (typeof body[field] !== 'string' || !String(body[field]).trim()) {
        throw new GridStoryError(`${field} is required.`, 'invalid_request', 400);
      }
    }
    const credential = await options.identity.createBreakGlassAccount(
      { organizationId: context.organizationId, tenantId: context.tenantId },
      {
        actorId: context.principal.id,
        name: body.name as string,
        roleId: body.roleId as string,
        expiresAt: body.expiresAt as string,
        incidentId: body.incidentId as string,
      },
    );
    return reply.status(201).send(credential);
  });

  server.post('/api/v1/identity/break-glass/activate', async (request, reply) => {
    const requestScope = scope(request, options.mode === 'production');
    const body = request.body as { token?: unknown; incidentId?: unknown };
    if (typeof body.token !== 'string' || typeof body.incidentId !== 'string') {
      throw new GridStoryError(
        'Break-glass token and incident ID are required.',
        'invalid_request',
        400,
      );
    }
    const issued = await options.identity.activateBreakGlass(
      requestScope,
      body.token,
      body.incidentId,
    );
    setSessionCookie(reply, options, issued.token, issued.session.expiresAt);
    return { session: issued.session, principal: issued.principal };
  });

  server.delete('/api/v1/identity/break-glass/:id', async (request, reply) => {
    requireIdentityAdmin(request);
    const context = requestContext(request, 'draft');
    const incidentId = (request.body as { incidentId?: unknown })?.incidentId;
    if (typeof incidentId !== 'string') {
      throw new GridStoryError('Incident ID is required.', 'invalid_request', 400);
    }
    await options.identity.revokeBreakGlassAccount(
      { organizationId: context.organizationId, tenantId: context.tenantId },
      context.principal.id,
      (request.params as { id: string }).id,
      incidentId,
    );
    return reply.status(204).send();
  });

  server.post('/api/v1/identity/webauthn/registration/options', async (request) => {
    const context = requestContext(request, 'draft');
    const requestScope = { organizationId: context.organizationId, tenantId: context.tenantId };
    const token = sessionToken(request, options.cookieName);
    if (!token)
      throw new GridStoryError('An authenticated session is required.', 'invalid_session', 401);
    const authenticated = await options.identity.authenticateSession(requestScope, token, {
      requireRecentAuthentication: true,
    });
    const generated = await options.webAuthn.registrationOptions(
      await options.identity.snapshot(requestScope),
      authenticated.principal.id,
    );
    const stored = await options.identity.createWebAuthnChallenge(requestScope, {
      userId: authenticated.principal.id,
      sessionId: authenticated.session.id,
      kind: 'registration',
      challenge: generated.challenge,
    });
    return { challengeId: stored.id, options: generated };
  });

  server.post('/api/v1/identity/webauthn/registration/verify', async (request) => {
    const context = requestContext(request, 'draft');
    const requestScope = { organizationId: context.organizationId, tenantId: context.tenantId };
    const body = request.body as { challengeId?: unknown; response?: unknown };
    if (typeof body.challengeId !== 'string') {
      throw new GridStoryError('WebAuthn challenge ID is required.', 'invalid_request', 400);
    }
    const challenge = await options.identity.getWebAuthnChallenge(requestScope, body.challengeId);
    if (challenge.userId !== context.principal.id || challenge.kind !== 'registration') {
      throw new GridStoryError(
        'WebAuthn challenge does not match the user.',
        'invalid_identity',
        401,
      );
    }
    const verified = await options.webAuthn.verifyRegistration(
      body.response as RegistrationResponseJSON,
      challenge.challenge,
    );
    return options.identity.completeWebAuthnRegistration(
      requestScope,
      context.principal.id,
      challenge.id,
      verified,
    );
  });

  server.post('/api/v1/identity/webauthn/authentication/options', async (request) => {
    const context = requestContext(request, 'draft');
    const requestScope = { organizationId: context.organizationId, tenantId: context.tenantId };
    const token = sessionToken(request, options.cookieName);
    if (!token)
      throw new GridStoryError('An authenticated session is required.', 'invalid_session', 401);
    const authenticated = await options.identity.authenticateSession(requestScope, token);
    const generated = await options.webAuthn.authenticationOptions(
      await options.identity.snapshot(requestScope),
      authenticated.principal.id,
    );
    const stored = await options.identity.createWebAuthnChallenge(requestScope, {
      userId: authenticated.principal.id,
      sessionId: authenticated.session.id,
      kind: 'authentication',
      challenge: generated.challenge,
    });
    return { challengeId: stored.id, options: generated };
  });

  server.post('/api/v1/identity/webauthn/authentication/verify', async (request) => {
    const context = requestContext(request, 'draft');
    const requestScope = { organizationId: context.organizationId, tenantId: context.tenantId };
    const body = request.body as { challengeId?: unknown; response?: unknown };
    if (typeof body.challengeId !== 'string') {
      throw new GridStoryError('WebAuthn challenge ID is required.', 'invalid_request', 400);
    }
    const challenge = await options.identity.getWebAuthnChallenge(requestScope, body.challengeId);
    if (challenge.userId !== context.principal.id || challenge.kind !== 'authentication') {
      throw new GridStoryError(
        'WebAuthn challenge does not match the user.',
        'invalid_identity',
        401,
      );
    }
    const verified = await options.webAuthn.verifyAuthentication(
      body.response as AuthenticationResponseJSON,
      challenge.challenge,
      await options.identity.snapshot(requestScope),
    );
    return options.identity.completeWebAuthnAuthentication(
      requestScope,
      context.principal.id,
      challenge.id,
      verified,
    );
  });

  server.get('/api/v1/scim/v2/ServiceProviderConfig', async (request) => {
    await authenticateScim(request, options);
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: true },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'GridStory directory bearer credential',
          description:
            'Tenant-bound opaque bearer credential issued by a GridStory identity admin.',
          specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
          primary: true,
        },
      ],
    };
  });

  server.get('/api/v1/scim/v2/ResourceTypes', async (request) => {
    await authenticateScim(request, options);
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        { id: 'User', name: 'User', endpoint: '/Users', schema: SCIM_USER_SCHEMA },
        { id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCIM_GROUP_SCHEMA },
      ],
    };
  });

  server.get('/api/v1/scim/v2/Schemas', async (request) => {
    await authenticateScim(request, options);
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        { id: SCIM_USER_SCHEMA, name: 'User', description: 'GridStory directory user schema' },
        { id: SCIM_GROUP_SCHEMA, name: 'Group', description: 'GridStory directory group schema' },
      ],
    };
  });

  server.get('/api/v1/scim/v2/Users', async (request) => {
    const authenticated = await authenticateScim(request, options);
    const query = request.query as { filter?: unknown; startIndex?: unknown; count?: unknown };
    const baseUrl = '/api/v1/scim/v2';
    const filtered = filterResources(
      (await options.identity.snapshot(authenticated.scope)).users,
      query.filter,
    );
    const startIndex = Math.max(1, Number(query.startIndex ?? 1));
    const count = Math.min(100, Math.max(1, Number(query.count ?? 100)));
    const resources = filtered
      .slice(startIndex - 1, startIndex - 1 + count)
      .map((user) => scimUser(user, baseUrl));
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: filtered.length,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  });

  server.post('/api/v1/scim/v2/Users', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    const user = await options.identity.upsertUser(
      authenticated.scope,
      authenticated.actorId,
      scimUserInputSchema.parse(request.body),
    );
    return reply
      .status(201)
      .header('etag', etag(user.version))
      .send(scimUser(user, '/api/v1/scim/v2'));
  });

  server.get('/api/v1/scim/v2/Users/:id', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    const id = (request.params as { id: string }).id;
    const user = (await options.identity.snapshot(authenticated.scope)).users.find(
      (candidate) => candidate.id === id,
    );
    if (!user) throw new GridStoryError('SCIM user was not found.', 'not_found', 404);
    return reply.header('etag', etag(user.version)).send(scimUser(user, '/api/v1/scim/v2'));
  });

  server.put('/api/v1/scim/v2/Users/:id', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    const user = await options.identity.upsertUser(
      authenticated.scope,
      authenticated.actorId,
      scimUserInputSchema.parse(request.body),
      (request.params as { id: string }).id,
      expectedVersion(request),
    );
    return reply.header('etag', etag(user.version)).send(scimUser(user, '/api/v1/scim/v2'));
  });

  server.patch('/api/v1/scim/v2/Users/:id', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    const id = (request.params as { id: string }).id;
    const current = (await options.identity.snapshot(authenticated.scope)).users.find(
      (candidate) => candidate.id === id,
    );
    if (!current) throw new GridStoryError('SCIM user was not found.', 'not_found', 404);
    const user = await options.identity.upsertUser(
      authenticated.scope,
      authenticated.actorId,
      applyUserPatch(current, request.body),
      id,
      expectedVersion(request),
    );
    return reply.header('etag', etag(user.version)).send(scimUser(user, '/api/v1/scim/v2'));
  });

  server.delete('/api/v1/scim/v2/Users/:id', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    await options.identity.deprovisionUser(
      authenticated.scope,
      authenticated.actorId,
      (request.params as { id: string }).id,
    );
    return reply.status(204).send();
  });

  server.get('/api/v1/scim/v2/Groups', async (request) => {
    const authenticated = await authenticateScim(request, options);
    const query = request.query as { filter?: unknown; startIndex?: unknown; count?: unknown };
    const filtered = filterResources(
      (await options.identity.snapshot(authenticated.scope)).groups,
      query.filter,
    );
    const startIndex = Math.max(1, Number(query.startIndex ?? 1));
    const count = Math.min(100, Math.max(1, Number(query.count ?? 100)));
    const resources = filtered
      .slice(startIndex - 1, startIndex - 1 + count)
      .map((group) => scimGroup(group, '/api/v1/scim/v2'));
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: filtered.length,
      startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  });

  server.post('/api/v1/scim/v2/Groups', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    const group = await options.identity.upsertGroup(
      authenticated.scope,
      authenticated.actorId,
      scimGroupInputSchema.parse(request.body),
    );
    return reply
      .status(201)
      .header('etag', etag(group.version))
      .send(scimGroup(group, '/api/v1/scim/v2'));
  });

  server.get('/api/v1/scim/v2/Groups/:id', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    const id = (request.params as { id: string }).id;
    const group = (await options.identity.snapshot(authenticated.scope)).groups.find(
      (candidate) => candidate.id === id,
    );
    if (!group) throw new GridStoryError('SCIM group was not found.', 'not_found', 404);
    return reply.header('etag', etag(group.version)).send(scimGroup(group, '/api/v1/scim/v2'));
  });

  server.put('/api/v1/scim/v2/Groups/:id', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    const group = await options.identity.upsertGroup(
      authenticated.scope,
      authenticated.actorId,
      scimGroupInputSchema.parse(request.body),
      (request.params as { id: string }).id,
      expectedVersion(request),
    );
    return reply.header('etag', etag(group.version)).send(scimGroup(group, '/api/v1/scim/v2'));
  });

  server.patch('/api/v1/scim/v2/Groups/:id', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    const id = (request.params as { id: string }).id;
    const current = (await options.identity.snapshot(authenticated.scope)).groups.find(
      (candidate) => candidate.id === id,
    );
    if (!current) throw new GridStoryError('SCIM group was not found.', 'not_found', 404);
    const group = await options.identity.upsertGroup(
      authenticated.scope,
      authenticated.actorId,
      applyGroupPatch(current, request.body),
      id,
      expectedVersion(request),
    );
    return reply.header('etag', etag(group.version)).send(scimGroup(group, '/api/v1/scim/v2'));
  });

  server.delete('/api/v1/scim/v2/Groups/:id', async (request, reply) => {
    const authenticated = await authenticateScim(request, options);
    await options.identity.deprovisionGroup(
      authenticated.scope,
      authenticated.actorId,
      (request.params as { id: string }).id,
    );
    return reply.status(204).send();
  });
}
