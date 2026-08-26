import { EnterpriseIdentityService, InMemoryIdentityRepository } from '@gridstory/core';
import { welcomePage } from '@gridstory/example-kit/manifests';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer, resolveIdentityCookieSecurity } from '../src/server.js';

const identityScope = { organizationId: 'org-enterprise', tenantId: 'tenant-enterprise' };
const scopeHeaders = {
  'content-type': 'application/json',
  'x-gridstory-organization': identityScope.organizationId,
  'x-gridstory-tenant': identityScope.tenantId,
  'x-gridstory-workspace': 'workspace-main',
  'x-gridstory-site': 'site-main',
  'x-gridstory-environment': 'production',
  'x-gridstory-locale': 'en',
};

async function productionIdentityFixture(roleId = 'admin') {
  const repository = new InMemoryIdentityRepository();
  const identity = new EnterpriseIdentityService({ repository });
  await identity.configureProvider(identityScope, 'bootstrap', {
    id: 'enterprise-oidc',
    protocol: 'oidc',
    issuer: 'https://identity.example.test',
    displayName: 'Enterprise OIDC',
    enabled: true,
    allowJitProvisioning: true,
  });
  await identity.upsertGroupRoleMapping(identityScope, 'bootstrap', {
    id: 'admin-mapping',
    externalGroup: 'gridstory-admins',
    roleId,
    createdBy: 'bootstrap',
  });
  const session = await identity.completeFederation(identityScope, {
    identity: {
      providerId: 'enterprise-oidc',
      protocol: 'oidc',
      issuer: 'https://identity.example.test',
      subject: 'admin-subject',
      email: 'admin@example.test',
      emailVerified: true,
      displayName: 'Enterprise Admin',
      groups: ['gridstory-admins'],
      authenticatedAt: new Date().toISOString(),
      strength: 'multi-factor',
    },
  });
  const directoryCredential = await identity.issueDirectoryCredential(
    identityScope,
    session.principal.id,
    'SCIM integration test',
  );
  return { repository, identity, session, directoryCredential };
}

describe('production enterprise identity API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    if (server) await server.close();
    server = undefined;
  });

  it('defaults production session cookies to Secure', () => {
    expect(resolveIdentityCookieSecurity('production', undefined)).toBe(true);
    expect(resolveIdentityCookieSecurity('development', undefined)).toBe(false);
    expect(resolveIdentityCookieSecurity('production', false)).toBe(true);
  });

  it('never treats a preview-token prefix as management authentication', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      identity: { mode: 'production' },
    });
    const missingSession = await server.inject({
      method: 'GET',
      url: '/api/v1/context',
      headers: scopeHeaders,
    });
    expect(missingSession.statusCode).toBe(401);
    for (const authorization of [
      'Bearer gsp_invalid',
      'bearer gsp_invalid',
      'Bearer\tgsp_invalid',
    ]) {
      for (const url of ['/api/v1/context', '/api/v1/schemas']) {
        const response = await server.inject({
          method: 'GET',
          url,
          headers: { ...scopeHeaders, authorization },
        });
        expect(response.statusCode, `${url}: preview prefix is not a session`).toBe(401);
        expect(response.json()).toMatchObject({ error: { code: 'invalid_session' } });
        expect(response.json()).not.toHaveProperty('principal');
        expect(response.headers['cache-control']).toBe('private, no-store');
      }
    }
  });

  it('does not confuse public activation paths with private revocation methods', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      identity: { mode: 'production' },
    });
    for (const url of [
      '/api/v1/identity/break-glass/activate',
      '/api/v1/identity/break-glass/acti%76ate',
      '/api/v1/identity/break-glass/activate?source=preview',
    ]) {
      const response = await server.inject({ method: 'DELETE', url, headers: scopeHeaders });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().error.code).toBe('invalid_session');
    }
  });

  it('rejects alternate management paths, methods and credentials before handler execution', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      identity: { mode: 'production' },
    });
    const requests = [
      ['GET', '/api/v1/con%74ext'],
      ['GET', '/api/v1/context?next=/api/v1/preview/content/id'],
      ['GET', '/api/v1/identity'],
      ['HEAD', '/api/v1/context'],
      ['POST', '/graphql'],
      ['POST', '/api/v1/content'],
      ['PUT', '/api/v1/content/id/draft'],
      ['POST', '/api/v1/preview/sessions'],
      ['GET', '/api/v1/preview/sessions/id'],
      ['HEAD', '/api/v1/preview/content/id'],
      ['PUT', '/api/v1/preview/sessions/id/messages'],
      ['POST', '/api/v1/preview/sessions/id/messages/extra'],
      ['POST', '/api/v1/preview/sessions/id/messages/'],
      ['DELETE', '/api/v1/preview/sessions/id/messages'],
      ['GET', '/api/v1/preview/content/id/extra'],
    ] as const;
    for (const authorization of ['Bearer gsp_invalid', 'Bearer gss_invalid', 'Basic gsp_invalid']) {
      for (const [method, url] of requests) {
        const response = await server.inject({
          method,
          url,
          headers: { ...scopeHeaders, authorization },
          ...(['POST', 'PUT'].includes(method) ? { payload: {} } : {}),
        });
        expect(response.statusCode, `${method} ${url}`).toBe(401);
        if (url === '/graphql') {
          expect(response.json()).toEqual({
            data: null,
            errors: [
              {
                message:
                  authorization === 'Bearer gss_invalid'
                    ? 'Session token is invalid.'
                    : 'An authenticated session is required.',
              },
            ],
          });
        } else if (method !== 'HEAD') {
          expect(response.json().error.code).toBe('invalid_session');
        }
      }
    }
    for (const [method, url] of [
      ['GET', '/api/v1/preview/content/id'],
      ['GET', '/api/v1/pre%76iew/content/id?test=1'],
      ['POST', '/api/v1/preview/sessions/id/messages'],
      ['DELETE', '/api/v1/preview/sessions/id'],
    ] as const) {
      const response = await server.inject({
        method,
        url,
        headers: { authorization: 'Bearer gsp_invalid' },
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('invalid_preview_token');
    }
  });

  it('uses only a verified cookie identity when a preview prefix accompanies a workforce request', async () => {
    const fixture = await productionIdentityFixture('viewer');
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      identity: { mode: 'production', repository: fixture.repository },
    });
    const headers = {
      ...scopeHeaders,
      authorization: 'Bearer gsp_invalid',
      cookie: `gridstory_session=${fixture.session.token}`,
    };
    const context = await server.inject({ method: 'GET', url: '/api/v1/context', headers });
    expect(context.statusCode).toBe(200);
    expect(context.json().principal).toMatchObject({
      id: fixture.session.principal.id,
      roles: ['viewer'],
      authenticationMethod: 'oidc',
    });
    const forbidden = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: welcomePage },
    });
    expect(forbidden.statusCode).toBe(403);
    const foreign = await server.inject({
      method: 'GET',
      url: '/api/v1/context',
      headers: { ...headers, 'x-gridstory-tenant': 'foreign-tenant' },
    });
    expect(foreign.statusCode).toBe(401);
    await fixture.identity.revokeSession(
      identityScope,
      fixture.session.principal.id,
      fixture.session.session.id,
    );
    const revoked = await server.inject({ method: 'GET', url: '/api/v1/context', headers });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe('invalid_session');
  });

  it('preserves production preview grants, replay/origin/scope checks and both supported revocations', async () => {
    const fixture = await productionIdentityFixture();
    server = await buildServer({
      databasePath: ':memory:',
      seed: true,
      allowedOrigins: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
      allowedPreviewOrigins: ['http://localhost:5174'],
      identity: { mode: 'production', repository: fixture.repository },
    });
    const management = { ...scopeHeaders, cookie: `gridstory_session=${fixture.session.token}` };
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: management,
      payload: { contentType: 'page', data: welcomePage },
    });
    expect(created.statusCode).toBe(201);
    const entry = created.json();
    const previewServer = server;
    const createGrant = async () => {
      const response = await previewServer.inject({
        method: 'POST',
        url: '/api/v1/preview/sessions',
        headers: management,
        payload: {
          previewUrl: 'http://localhost:5174/',
          route: '/welcome',
          mode: 'standalone',
          entryId: entry.id,
          ttlSeconds: 15,
        },
      });
      expect(response.statusCode).toBe(201);
      return response.json();
    };
    const grant = await createGrant();
    const previewHeaders = {
      authorization: `Bearer ${grant.token}`,
      origin: 'http://localhost:5174',
    };
    const readPreview = (id = entry.id, headers = previewHeaders) =>
      previewServer.inject({
        method: 'GET',
        url: `/api/v1/preview/content/${id}`,
        headers,
      });
    const draft = await readPreview();
    expect(draft.statusCode).toBe(200);
    expect(draft.headers['cache-control']).toBe('private, no-store');
    expect(draft.json()).toMatchObject({ id: entry.id, data: welcomePage });
    const wrongEntry = await readPreview('another-entry');
    expect(wrongEntry.statusCode).toBe(403);
    expect(wrongEntry.json().error.code).toBe('preview_scope_denied');
    const wrongOrigin = await readPreview(entry.id, {
      ...previewHeaders,
      origin: 'http://localhost:5175',
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json().error.code).toBe('preview_origin_denied');
    const untrustedScope = await server.inject({
      method: 'GET',
      url: `/api/v1/preview/content/${entry.id}`,
      headers: { ...previewHeaders, 'x-gridstory-tenant': 'foreign-tenant' },
    });
    expect(untrustedScope.statusCode).toBe(200);
    expect(untrustedScope.json().id).toBe(entry.id); // Scope comes only from the verified grant.
    const message = {
      type: 'gridstory.preview.handshake',
      protocolVersion: 1,
      sessionId: grant.sessionId,
      sequence: 0,
      nonce: 'auth-preview-nonce-0001',
      payload: { origin: 'http://localhost:5173' },
    };
    const sendMessage = (id = grant.sessionId) =>
      previewServer.inject({
        method: 'POST',
        url: `/api/v1/preview/sessions/${id}/messages`,
        headers: previewHeaders,
        payload: message,
      });
    expect((await sendMessage()).statusCode).toBe(200);
    const replay = await sendMessage();
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe('preview_replay');
    expect((await sendMessage('foreign-session')).statusCode).toBe(403);
    const preflight = await server.inject({
      method: 'OPTIONS',
      url: `/api/v1/preview/sessions/${grant.sessionId}/messages`,
      headers: {
        origin: 'http://localhost:5174',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    const denyManagement = async (token: string) => {
      for (const [method, url] of [
        ['GET', '/api/v1/context'],
        ['GET', '/api/v1/schemas'],
        ['POST', '/api/v1/content'],
        ['PUT', `/api/v1/content/${entry.id}/draft`],
        ['POST', '/api/v1/preview/sessions'],
        ['POST', '/graphql'],
      ] as const) {
        const denied = await previewServer.inject({
          method,
          url,
          headers: { ...scopeHeaders, authorization: `Bearer ${token}` },
          ...(['POST', 'PUT'].includes(method)
            ? { payload: { contentType: 'page', data: welcomePage } }
            : {}),
        });
        expect(denied.statusCode, `${method} ${url}`).toBe(401);
        if (url === '/graphql') {
          expect(denied.json()).toEqual({
            data: null,
            errors: [{ message: 'An authenticated session is required.' }],
          });
        } else {
          expect(denied.json().error.code).toBe('invalid_session');
        }
      }
    };
    await denyManagement(grant.token);
    const selfRevoked = await server.inject({
      method: 'DELETE',
      url: `/api/v1/preview/sessions/${grant.sessionId}`,
      headers: previewHeaders,
    });
    expect(selfRevoked.statusCode).toBe(204);
    expect((await readPreview()).json().error.code).toBe('preview_expired');
    await denyManagement(grant.token);

    const managedGrant = await createGrant();
    const foreignRevocation = await server.inject({
      method: 'DELETE',
      url: `/api/v1/preview/sessions/${managedGrant.sessionId}`,
      headers: { ...management, 'x-gridstory-site': 'foreign-site' },
      payload: {},
    });
    expect(foreignRevocation.statusCode).toBe(403);
    expect(foreignRevocation.json().error.code).toBe('preview_scope_denied');
    const managedRevocation = await server.inject({
      method: 'DELETE',
      url: `/api/v1/preview/sessions/${managedGrant.sessionId}`,
      headers: management,
      payload: {},
    });
    expect(managedRevocation.statusCode).toBe(204);
    const expiredGrant = await createGrant();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16_000);
    const expired = await readPreview(entry.id, {
      ...previewHeaders,
      authorization: `Bearer ${expiredGrant.token}`,
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('preview_expired');
    await denyManagement(expiredGrant.token);
    vi.useRealTimers();

    const anonymousDraft = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/welcome',
      headers: scopeHeaders,
    });
    expect(anonymousDraft.statusCode).toBe(404);
    const published = await server.inject({ method: 'GET', url: '/api/v1/delivery/page/welcome' });
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe('published');
    expect(published.headers['cache-control']).toContain('public');
  });

  it('rejects development identity headers and authenticates a durable tenant-bound session', async () => {
    const fixture = await productionIdentityFixture();
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      identity: { mode: 'production', repository: fixture.repository },
    });

    const spoofed = await server.inject({
      method: 'GET',
      url: '/api/v1/context',
      headers: { ...scopeHeaders, 'x-gridstory-actor': 'spoofed-admin' },
    });
    expect(spoofed.statusCode).toBe(401);
    expect(spoofed.json().error.code).toBe('invalid_identity');

    const authenticated = await server.inject({
      method: 'GET',
      url: '/api/v1/context',
      headers: { ...scopeHeaders, authorization: `Bearer ${fixture.session.token}` },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toMatchObject({
      organizationId: identityScope.organizationId,
      tenantId: identityScope.tenantId,
      principal: {
        id: fixture.session.principal.id,
        roles: ['admin'],
        authenticationMethod: 'oidc',
      },
    });
  });

  it('implements tenant-bound SCIM users, groups, filtering, ETags, and deprovisioning', async () => {
    const fixture = await productionIdentityFixture();
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      identity: { mode: 'production', repository: fixture.repository },
    });
    const scimHeaders = {
      ...scopeHeaders,
      authorization: `Bearer ${fixture.directoryCredential.token}`,
    };
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/scim/v2/Users',
      headers: scimHeaders,
      payload: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        externalId: 'directory-user-1',
        userName: 'author@example.test',
        displayName: 'SCIM Author',
        active: true,
        emails: [{ value: 'author@example.test', primary: true }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('W/"1"');
    const user = created.json();

    const filtered = await server.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/Users?filter=userName%20eq%20%22author%40example.test%22',
      headers: scimHeaders,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({ totalResults: 1, itemsPerPage: 1 });

    const stale = await server.inject({
      method: 'PATCH',
      url: `/api/v1/scim/v2/Users/${user.id}`,
      headers: { ...scimHeaders, 'if-match': 'W/"99"' },
      payload: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      scimType: 'scim_precondition',
    });

    const deprovisioned = await server.inject({
      method: 'PATCH',
      url: `/api/v1/scim/v2/Users/${user.id}`,
      headers: { ...scimHeaders, 'if-match': created.headers.etag as string },
      payload: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      },
    });
    expect(deprovisioned.statusCode).toBe(200);
    expect(deprovisioned.json().active).toBe(false);
    expect(deprovisioned.headers.etag).toBe('W/"2"');

    const group = await server.inject({
      method: 'POST',
      url: '/api/v1/scim/v2/Groups',
      headers: scimHeaders,
      payload: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        externalId: 'directory-group-1',
        displayName: 'Authors',
        members: [{ value: user.id, display: 'SCIM Author' }],
      },
    });
    expect(group.statusCode).toBe(201);
    expect(group.json()).toMatchObject({ displayName: 'Authors', members: [{ value: user.id }] });

    const foreignTenant = await server.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/Users',
      headers: { ...scimHeaders, 'x-gridstory-tenant': 'tenant-other' },
    });
    expect(foreignTenant.statusCode).toBe(401);
    expect(foreignTenant.json().scimType).toBe('invalid_token');
  });
});
