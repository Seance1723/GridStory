import { describe, expect, it } from 'vitest';
import { createGridStoryClient } from '../src/index.js';

const scope = {
  organizationId: 'org',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'development',
  locale: 'en',
};
const inventory = (selectedScope = scope) => ({
  version: 1,
  scope: selectedScope,
  sections: {
    localesAndEnvironments: { availability: 'unavailable', reason: 'not-authorized' },
    modelsAndRoutes: { availability: 'unavailable', reason: 'not-authorized' },
    mediaPolicyAndProviders: { availability: 'unavailable', reason: 'not-authorized' },
  },
});

describe('configuration inventory client', () => {
  it('uses the bound private transport, signal and exact endpoint', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test/',
      tenantId: scope.tenantId,
      scope,
      fetch: async (input, init) => {
        request = { url: String(input), ...(init ? { init } : {}) };
        return Response.json(inventory());
      },
    });
    const controller = new AbortController();
    await expect(client.getConfigurationInventory({ signal: controller.signal })).resolves.toEqual(
      inventory(),
    );
    expect(request?.url).toBe('https://cms.example.test/api/v1/configuration/inventory');
    expect(request?.init?.credentials).toBe('include');
    expect(request?.init?.signal).toBe(controller.signal);
  });

  it('rejects malformed, expanded and wrong-scope responses', async () => {
    for (const body of [
      {},
      { ...inventory(), version: 2 },
      inventory({ ...scope, siteId: 'other' }),
      { ...inventory(), environment: { databaseUrl: 'private' } },
    ]) {
      const client = createGridStoryClient({
        baseUrl: 'https://cms.example.test',
        tenantId: scope.tenantId,
        scope,
        fetch: async () => Response.json(body),
      });
      await expect(client.getConfigurationInventory()).rejects.toMatchObject({
        status: 502,
        code: 'invalid_configuration_inventory',
      });
    }
  });
});
