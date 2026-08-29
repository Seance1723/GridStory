import {
  BuiltInAssetContentInspector,
  createLocalTopology,
  InMemoryAssetStorageAdapter,
  type AssetMalwareScanner,
  type AssetRenditionAdapter,
} from '@gridstory/core';
import { configurationInventorySchema, resourceLimits } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const scopeHeaders = {
  'x-gridstory-organization': 'local',
  'x-gridstory-tenant': 'default',
  'x-gridstory-workspace': 'default',
  'x-gridstory-site': 'default',
  'x-gridstory-environment': 'development',
  'x-gridstory-locale': 'en',
  'x-gridstory-actor': 'configuration-fixture',
};

describe('configuration inventory route', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
  });

  async function server(options: Parameters<typeof buildServer>[0] = {}) {
    const value = await buildServer({ databasePath: ':memory:', seed: false, ...options });
    servers.push(value);
    return value;
  }

  it('returns exact private effective facts without raw configuration or topology', async () => {
    const topology = createLocalTopology();
    topology.sites.push({
      id: 'private-site',
      workspaceId: 'default',
      name: 'Private site name',
      status: 'active',
    });
    topology.environments.push({
      id: 'private-environment',
      siteId: 'private-site',
      name: 'Private environment name',
      kind: 'production',
      status: 'active',
    });
    topology.locales.push({
      code: 'fr',
      siteId: 'private-site',
      label: 'Private locale name',
      default: true,
      enabled: true,
    });
    const value = await server({ studioTopology: topology, locales: topology.locales });
    const response = await value.inject({
      method: 'GET',
      url: '/api/v1/configuration/inventory',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'admin' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const inventory = configurationInventorySchema.parse(response.json());
    expect(inventory.scope).toEqual({
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
    });
    expect(inventory.sections.localesAndEnvironments).toMatchObject({
      availability: 'available',
      coverage: 'configured',
      environments: [
        { id: 'development', kind: 'development' },
        { id: 'production', kind: 'production' },
      ],
      locales: [{ code: 'en', default: true }],
    });
    expect(inventory.sections.modelsAndRoutes).toMatchObject({
      availability: 'available',
      models: [
        { id: 'article', ownership: 'code', mutable: false },
        { id: 'page', ownership: 'code', mutable: false },
      ],
    });
    expect(inventory.sections.mediaPolicyAndProviders).toMatchObject({
      availability: 'available',
      policy: {
        maximumUploadBytes: resourceLimits.assets.maximumBytes,
        uploadPartBytes: resourceLimits.api.assetPartBodyBytes,
        maximumDimensionPixels: resourceLimits.assets.maximumDimensionPixels,
        maximumParts: resourceLimits.assets.maximumParts,
      },
      providers: [
        { kind: 'storage', mode: 'built-in-local' },
        { kind: 'content-inspection', mode: 'built-in' },
        { kind: 'rendition', mode: 'unavailable' },
        { kind: 'malware-scanning', mode: 'unavailable' },
      ],
    });
    for (const forbidden of [
      'Private site name',
      'Private environment name',
      'Private locale name',
      'databasePath',
      'databaseUrl',
      'allowedOrigins',
      'SigningSecret',
      'cookieName',
      'issuer',
      'endpoint',
      'InMemoryAssetStorageAdapter',
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it('captures only generic configured provider modes at server composition', async () => {
    const rendition: AssetRenditionAdapter = { create: async ({ source }) => source };
    const malware: AssetMalwareScanner = {
      scan: async () => ({ verdict: 'clean', provider: 'private-scanner-name' }),
    };
    const value = await server({
      assetStorage: new InMemoryAssetStorageAdapter(),
      assetContentInspector: new BuiltInAssetContentInspector(),
      assetRenditionAdapter: rendition,
      assetMalwareScanner: malware,
    });
    const response = await value.inject({
      method: 'GET',
      url: '/api/v1/configuration/inventory',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'viewer' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const inventory = configurationInventorySchema.parse(response.json());
    expect(inventory.sections.mediaPolicyAndProviders).toMatchObject({
      availability: 'available',
      providers: [
        { kind: 'storage', mode: 'configured' },
        { kind: 'content-inspection', mode: 'configured' },
        { kind: 'rendition', mode: 'configured' },
        { kind: 'malware-scanning', mode: 'configured' },
      ],
    });
    expect(response.body).not.toContain('private-scanner-name');
  });

  it('denies callers with no inventory section and rejects all request input', async () => {
    const value = await server();
    const denied = await value.inject({
      method: 'GET',
      url: '/api/v1/configuration/inventory',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'unmapped' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['cache-control']).toBe('private, no-store');
    expect(denied.body).not.toContain('modelsAndRoutes');

    const query = await value.inject({
      method: 'GET',
      url: '/api/v1/configuration/inventory?detail=all',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'admin' },
    });
    expect(query.statusCode).toBe(400);
    expect(query.headers['cache-control']).toBe('private, no-store');

    const body = await value.inject({
      method: 'GET',
      url: '/api/v1/configuration/inventory',
      headers: {
        ...scopeHeaders,
        'x-gridstory-roles': 'admin',
        'content-type': 'application/json',
      },
      payload: { reveal: true },
    });
    expect(body.statusCode).toBe(400);
    expect(body.headers['cache-control']).toBe('private, no-store');
  });

  it('rejects development identity at the production boundary without leaking facts', async () => {
    const value = await server({ identity: { mode: 'production' } });
    const response = await value.inject({
      method: 'GET',
      url: '/api/v1/configuration/inventory',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'admin' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).not.toContain('configuration-fixture');
  });
});
