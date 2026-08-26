import {
  AuthorizationPolicy,
  createLocalTopology,
  EnterpriseIdentityService,
  InMemoryIdentityRepository,
} from '@gridstory/core';
import type {
  GroupRoleMapping,
  PlatformTopology,
  RequestContext,
  StudioContext,
  StudioDestinationId,
} from '@gridstory/schema';
import { studioContextSchema, studioTopologySchema } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import {
  StudioContextProjection,
  studioCapabilities,
  validateStudioTopology,
} from '../src/studio-context.js';

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required fixture value is missing.');
  return value;
}

const scope = {
  organizationId: 'local',
  tenantId: 'default',
  workspaceId: 'default',
  siteId: 'default',
  environmentId: 'development',
  locale: 'en',
};
const headers = {
  'x-gridstory-organization': 'local',
  'x-gridstory-tenant': 'default',
  'x-gridstory-workspace': 'default',
  'x-gridstory-site': 'default',
  'x-gridstory-environment': 'development',
  'x-gridstory-locale': 'en',
};
const identityScope = { organizationId: 'local', tenantId: 'default' };
const mapping = { id: 'mapping', externalGroup: 'editors', roleId: 'admin', createdBy: 'fixture' };
const topology = (): PlatformTopology => {
  const value = createLocalTopology();
  value.environments.push({
    id: 'locked',
    siteId: 'default',
    name: 'Locked secret name',
    status: 'locked',
    kind: 'production',
  });
  value.locales.push({
    siteId: 'default',
    code: 'fr',
    label: 'French',
    default: false,
    enabled: true,
  });
  value.locales.push({
    siteId: 'default',
    code: 'de',
    label: 'Disabled secret name',
    default: false,
    enabled: false,
  });
  value.workspaces.push({
    id: 'other-workspace',
    tenantId: 'default',
    name: 'Private workspace',
    status: 'active',
  });
  value.sites.push({
    id: 'private-site',
    workspaceId: 'other-workspace',
    name: 'Private site',
    status: 'active',
  });
  value.environments.push({
    id: 'private-env',
    siteId: 'private-site',
    name: 'Private environment',
    status: 'active',
    kind: 'development',
  });
  value.locales.push({
    siteId: 'private-site',
    code: 'en',
    label: 'Private locale',
    default: true,
    enabled: true,
  });
  value.organizations.push({ id: 'foreign-org', name: 'Foreign organization', status: 'active' });
  value.tenants.push({
    id: 'foreign-tenant',
    organizationId: 'foreign-org',
    name: 'Foreign tenant',
    status: 'active',
  });
  value.workspaces.push({
    id: 'foreign-workspace',
    tenantId: 'foreign-tenant',
    name: 'Foreign workspace',
    status: 'active',
  });
  value.sites.push({
    id: 'foreign-site',
    workspaceId: 'foreign-workspace',
    name: 'Foreign site',
    status: 'active',
  });
  value.environments.push({
    id: 'foreign-env',
    siteId: 'foreign-site',
    name: 'Foreign environment',
    status: 'active',
    kind: 'development',
  });
  value.locales.push({
    siteId: 'foreign-site',
    code: 'en',
    label: 'Foreign locale',
    default: true,
    enabled: true,
  });
  return value;
};
const context = (principal: RequestContext['principal']): RequestContext => ({
  ...scope,
  principal,
  perspective: 'draft',
});

describe('Studio permission and topology projection', () => {
  it('omits undefined locale options at the canonical exact-optional boundary (BUG-0439)', () => {
    const catalog = topology();
    const input = {
      ...catalog,
      locales: catalog.locales.map((locale) => ({
        ...locale,
        fallbackLocale: undefined,
        fallbackLocales: undefined,
        routePrefix: undefined,
        required: undefined,
      })),
    };
    const result: PlatformTopology = validateStudioTopology(input, catalog.locales);
    for (const field of ['fallbackLocale', 'fallbackLocales', 'routePrefix', 'required']) {
      expect(
        Object.hasOwn(required(studioTopologySchema.parse(input).locales[0]), field),
        'pre-normalization regression control',
      ).toBe(true);
      expect(Object.hasOwn(required(result.locales[0]), field), field).toBe(false);
    }
  });
  it('supports operations-only scoped grants without content or metadata authority', () => {
    const current = context({
      id: 'operator',
      type: 'user',
      roles: [],
      authenticationMethod: 'session',
      grants: [
        {
          actions: ['operations.read'],
          ...identityScope,
          workspaceId: 'default',
          siteId: 'default',
          environmentIds: ['development'],
          locales: ['en'],
        },
      ],
    });
    const policy = new AuthorizationPolicy();
    const catalog = topology();
    const projection = new StudioContextProjection(
      policy,
      validateStudioTopology(catalog, catalog.locales),
    );
    const result = projection.project(current);
    expect(Object.entries(result.capabilities.screens).filter(([, allowed]) => allowed)).toEqual([
      ['operations', true],
    ]);
    expect(result.capabilities.operations['operations.manage']).toBe(false);
    expect(result.capabilities.operations['schema.read']).toBe(false);
    expect(result.selection.choices.map((choice) => choice.scope)).toEqual([scope]);
    expect(() => policy.assert(current, 'operations.read', { kind: 'platform' })).not.toThrow();
    expect(() => policy.assert(current, 'content.read', { kind: 'platform' })).toThrow();
    expect(JSON.stringify(result)).not.toMatch(
      /Private|Foreign|secret name|grants|roles|attributes|matchedGrant|reason/,
    );
    required(result.selection.choices[0]).labels.site = 'Changed by caller';
    expect(required(projection.project(current).selection.choices[0]).labels.site).toBe(
      'Default site',
    );
  });

  it('does not treat legacy production role names or empty permissions as authority', () => {
    const projection = new StudioContextProjection(new AuthorizationPolicy());
    const result = projection.project(
      context({ id: 'none', type: 'user', roles: ['viewer'], authenticationMethod: 'session' }),
    );
    expect(Object.values(result.capabilities.screens).every((allowed) => !allowed)).toBe(true);
    expect(result.selection).toEqual({ mode: 'current-only', choices: [] });
    const typed = studioCapabilities(
      context({
        id: 'typed',
        type: 'user',
        roles: [],
        authenticationMethod: 'session',
        grants: [
          {
            actions: ['content.read', 'content.create', 'content.draft.update'],
            contentTypes: ['page'],
          },
        ],
      }),
      new AuthorizationPolicy(),
    );
    expect(typed.operations['pages.list']).toBe(true);
    expect(typed.operations['pages.create']).toBe(true);
    for (const key of [
      'content.read',
      'content.draft.update',
      'preview.manage',
      'schema.read',
      'locales.read',
    ] as const)
      expect(typed.operations[key], key).toBe(false);
  });

  it('rejects duplicate/orphan/oversized topology and locale drift without echoing configuration', async () => {
    const catalog = topology();
    const invalid: unknown[] = [null, { ...catalog, secret: 'do-not-echo-this' }];
    const duplicate = structuredClone(catalog);
    duplicate.environments.push(required(duplicate.environments[0]));
    invalid.push(duplicate);
    const orphan = structuredClone(catalog);
    required(orphan.sites[0]).workspaceId = 'do-not-echo-this';
    invalid.push(orphan);
    const drift = structuredClone(catalog);
    required(drift.locales[0]).enabled = false;
    invalid.push(drift);
    const oversized = createLocalTopology();
    oversized.environments = Array.from({ length: 129 }, (_, index) => ({
      id: `env-${index}`,
      siteId: 'default',
      name: 'Environment',
      kind: 'development' as const,
      status: 'active' as const,
    }));
    oversized.locales.push({ ...required(oversized.locales[0]), code: 'fr', default: false });
    expect(() => validateStudioTopology(oversized, oversized.locales)).toThrow(/bounded topology/);
    for (const value of invalid) {
      expect(() => validateStudioTopology(value, catalog.locales)).toThrow(
        /^GRIDSTORY_STUDIO_TOPOLOGY_JSON must be a valid bounded topology consistent with configured locales\.$/,
      );
    }
    await expect(
      buildServer({
        databasePath: ':memory:',
        seed: false,
        studioTopology: orphan,
        locales: catalog.locales,
      }),
    ).rejects.toThrow(/bounded topology/);
  });

  it('excludes inactive ancestors, locked environments and disabled locales', () => {
    const catalog = topology();
    const admin = context({
      id: 'admin',
      type: 'user',
      roles: ['admin'],
      authenticationMethod: 'development',
    });
    const projection = new StudioContextProjection(
      new AuthorizationPolicy(),
      validateStudioTopology(catalog, catalog.locales),
    );
    expect(projection.project(admin).selection.choices).toHaveLength(4);
    for (const change of [
      { environmentId: 'locked' },
      { locale: 'de' },
      { siteId: 'private-site' },
      { environmentId: 'missing' },
    ]) {
      expect(() => projection.project({ ...admin, ...change })).toThrow(
        'Studio context is unavailable.',
      );
    }
    for (const entity of ['organizations', 'tenants', 'workspaces', 'sites'] as const) {
      const inactive = topology();
      // All entity status unions have one non-active state; configuration remains structurally valid.
      Object.assign(required(inactive[entity][0]), {
        status: entity === 'organizations' || entity === 'tenants' ? 'suspended' : 'archived',
      });
      expect(() =>
        new StudioContextProjection(
          new AuthorizationPolicy(),
          validateStudioTopology(inactive, inactive.locales),
        ).project(admin),
      ).toThrow('Studio context is unavailable.');
    }
  });
});

describe('private Studio context HTTP contract', () => {
  let server: FastifyInstance | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function fixture(
    roleId = 'admin',
    restriction: Partial<GroupRoleMapping> = {},
    configured = true,
  ) {
    const repository = new InMemoryIdentityRepository();
    const identity = new EnterpriseIdentityService({ repository });
    await identity.configureProvider(identityScope, 'fixture', {
      id: 'oidc',
      protocol: 'oidc',
      issuer: 'https://identity.example.test',
      displayName: 'Fixture provider',
      enabled: true,
      allowJitProvisioning: true,
    });
    await identity.upsertGroupRoleMapping(identityScope, 'fixture', mapping);
    const issued = await identity.completeFederation(identityScope, {
      identity: {
        providerId: 'oidc',
        protocol: 'oidc',
        issuer: 'https://identity.example.test',
        subject: 'caller',
        groups: ['editors'],
        authenticatedAt: new Date().toISOString(),
        strength: 'multi-factor',
      },
    });
    const catalog = topology();
    server = await buildServer({
      databasePath: ':memory:',
      seed: true,
      locales: catalog.locales,
      ...(configured ? { studioTopology: catalog } : {}),
      identity: { mode: 'production', repository },
    });
    const cookie = { ...headers, cookie: `gridstory_session=${issued.token}` };
    const entries = await server.inject({
      method: 'GET',
      url: '/api/v1/content?contentType=page',
      headers: cookie,
    });
    expect(entries.statusCode).toBe(200);
    const entryId: string = entries.json()[0].id;
    await identity.upsertGroupRoleMapping(identityScope, 'fixture', {
      ...mapping,
      roleId,
      ...restriction,
    });
    return { identity, issued, cookie, entryId, server };
  }

  it('returns minimized no-store cookie/bearer projections and preserves legacy context', async () => {
    const fixtureValue = await fixture();
    for (const transport of [
      fixtureValue.cookie,
      { ...headers, authorization: `Bearer ${fixtureValue.issued.token}` },
    ]) {
      const result = await fixtureValue.server.inject({
        method: 'GET',
        url: '/api/v1/studio/context',
        headers: transport,
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers['cache-control']).toBe('private, no-store');
      const value = studioContextSchema.parse(result.json());
      expect(value.principalId).toBe(fixtureValue.issued.principal.id);
      expect(Object.values(value.capabilities.screens).every(Boolean)).toBe(true);
      expect(value.selection.choices).toHaveLength(4);
      expect(result.body).not.toMatch(
        /Private|Foreign|secret name|principal"|roles|grants|attributes|providers|topology|gss_/,
      );
    }
    const legacy = await fixtureValue.server.inject({
      method: 'GET',
      url: '/api/v1/context',
      headers: fixtureValue.cookie,
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().principal.id).toBe(fixtureValue.issued.principal.id);
  });

  it.each(['admin', 'viewer', 'author', 'unmapped'])(
    'matches actual reads for all 19 destinations with %s session',
    async (role) => {
      const value = await fixture(role);
      const projected = await value.server.inject({
        method: 'GET',
        url: '/api/v1/studio/context',
        headers: value.cookie,
      });
      expect(projected.statusCode).toBe(200);
      const result = projected.json<StudioContext>();
      const routes: Record<StudioDestinationId, string> = {
        pages: '/content?contentType=page',
        workflows: '/workflows',
        releases: '/releases',
        search: '/search/index/status',
        operations: '/operations/summary',
        identity: '/identity',
        'data-governance': '/governance',
        migrations: '/migrations',
        marketplace: '/marketplace',
        targeting: '/personalization',
        experiments: '/experiments',
        'ai-gateway': '/ai',
        knowledge: '/knowledge/agent',
        quality: `/content/${value.entryId}/quality`,
        federation: '/federation',
        fleet: '/fleet',
        regions: '/regional',
        components: '/components',
        assets: '/assets',
      };
      for (const [destination, path] of Object.entries(routes)) {
        const actual = await value.server.inject({
          method: 'GET',
          url: `/api/v1${path}`,
          headers: value.cookie,
        });
        expect(actual.statusCode, `${role}: ${path}`).toBe(
          result.capabilities.screens[destination as StudioDestinationId] ? 200 : 403,
        );
      }
      if (role === 'viewer' || role === 'unmapped') {
        for (const [operation, method, path, payload] of [
          ['pages.create', 'POST', '/content', { contentType: 'page', data: {} }],
          [
            'content.draft.update',
            'PUT',
            `/content/${value.entryId}/draft`,
            { expectedRevisionId: 'unknown', data: {} },
          ],
          [
            'content.publish',
            'POST',
            `/content/${value.entryId}/publish`,
            { expectedRevisionId: 'unknown' },
          ],
          ['operations.run', 'POST', '/operations/drain', {}],
        ] as const) {
          expect(result.capabilities.operations[operation]).toBe(false);
          const denied = await value.server.inject({
            method,
            url: `/api/v1${path}`,
            headers: value.cookie,
            payload,
          });
          expect(denied.statusCode, operation).toBe(403);
        }
      }
    },
  );

  it('keeps type-limited list access separate and refreshes changed mappings on every request', async () => {
    const value = await fixture('author', {
      siteId: 'default',
      environmentIds: ['development'],
      locales: ['en'],
      contentTypes: ['page'],
    });
    const response = await value.server.inject({
      method: 'GET',
      url: '/api/v1/studio/context',
      headers: value.cookie,
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<StudioContext>();
    expect(result.selection.choices.map((choice) => choice.scope)).toEqual([scope]);
    expect(result.capabilities.operations['pages.list']).toBe(true);
    expect(result.capabilities.operations['pages.create']).toBe(true);
    expect(result.capabilities.operations['content.read']).toBe(false);
    for (const [path, status] of [
      [`/content/${value.entryId}`, 403],
      ['/content?contentType=article', 403],
      ['/content?contentType=page', 200],
      ['/schemas', 403],
      ['/locales', 403],
    ] as const) {
      expect(
        (await value.server.inject({ method: 'GET', url: `/api/v1${path}`, headers: value.cookie }))
          .statusCode,
        path,
      ).toBe(status);
    }
    await value.identity.upsertGroupRoleMapping(identityScope, 'fixture', {
      ...mapping,
      roleId: 'unmapped',
    });
    const changed = await value.server.inject({
      method: 'GET',
      url: '/api/v1/studio/context',
      headers: value.cookie,
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().selection.choices).toEqual([]);
    expect(Object.values(changed.json().capabilities.operations).every((allowed) => !allowed)).toBe(
      true,
    );
  });

  it('fails closed for malformed scope/query, cross-tenant, missing, invalid and revoked sessions', async () => {
    const value = await fixture();
    const cases = [
      { headers, status: 401 },
      { headers: { ...headers, authorization: 'Bearer gss_invalid' }, status: 401 },
      { headers: { ...headers, authorization: 'Bearer gsp_invalid' }, status: 401 },
      { headers: { ...value.cookie, 'x-gridstory-tenant': 'foreign-tenant' }, status: 401 },
      { headers: { ...value.cookie, 'x-gridstory-organization': 'foreign-org' }, status: 401 },
      { headers: { ...value.cookie, 'x-gridstory-site': '../bad' }, status: 400 },
      { headers: { ...value.cookie, 'x-gridstory-site': 'unknown' }, status: 403 },
      { headers: { ...value.cookie, 'x-gridstory-environment': 'locked' }, status: 403 },
      { headers: { ...value.cookie, 'x-gridstory-locale': 'de' }, status: 403 },
    ];
    for (const candidate of cases) {
      const response = await value.server.inject({
        method: 'GET',
        url: '/api/v1/studio/context',
        headers: candidate.headers,
      });
      expect(response.statusCode).toBe(candidate.status);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).not.toMatch(/choices|capabilities|Locked secret|Foreign|Private/);
    }
    expect(
      (
        await value.server.inject({
          method: 'GET',
          url: '/api/v1/studio/context?tenantId=other',
          headers: value.cookie,
        })
      ).statusCode,
    ).toBe(400);
    await value.identity.revokeSession(
      identityScope,
      value.issued.principal.id,
      value.issued.session.id,
    );
    for (const transport of [
      value.cookie,
      { ...headers, authorization: `Bearer ${value.issued.token}` },
    ]) {
      const revoked = await value.server.inject({
        method: 'GET',
        url: '/api/v1/studio/context',
        headers: transport,
      });
      expect(revoked.statusCode).toBe(401);
      expect(revoked.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('returns only current context when configuration is absent, including explicit development', async () => {
    const value = await fixture('viewer', {}, false);
    const result = await value.server.inject({
      method: 'GET',
      url: '/api/v1/studio/context',
      headers: value.cookie,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().selection).toEqual({
      mode: 'current-only',
      choices: [{ scope, labels: { site: 'default', environment: 'development', locale: 'en' } }],
    });
    await value.server.close();
    server = undefined;
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      identity: { mode: 'development' },
    });
    const local = await server.inject({ method: 'GET', url: '/api/v1/studio/context' });
    expect(local.statusCode).toBe(200);
    expect(local.json().selection.choices).toHaveLength(1);
  });
});
