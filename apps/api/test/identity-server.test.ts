import { EnterpriseIdentityService, InMemoryIdentityRepository } from '@gridstory/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
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

async function productionIdentityFixture() {
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
    roleId: 'admin',
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
  return { repository, session, directoryCredential };
}

describe('production enterprise identity API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('defaults production session cookies to Secure', () => {
    expect(resolveIdentityCookieSecurity('production', undefined)).toBe(true);
    expect(resolveIdentityCookieSecurity('development', undefined)).toBe(false);
    expect(resolveIdentityCookieSecurity('production', false)).toBe(true);
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
