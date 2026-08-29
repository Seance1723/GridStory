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

const overview = (selectedScope = scope) => ({
  version: 1,
  scope: selectedScope,
  generatedAt: '2026-08-29T00:00:00.000Z',
  widgets: {
    content: { availability: 'unavailable' },
    reviews: { availability: 'unavailable' },
    releases: { availability: 'unavailable' },
    operations: { availability: 'unavailable' },
  },
});

describe('editorial overview client', () => {
  it('uses the bound private transport, signal and exact endpoint', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test/',
      tenantId: scope.tenantId,
      scope,
      fetch: async (input, init) => {
        request = { url: String(input), ...(init ? { init } : {}) };
        return Response.json(overview());
      },
    });
    const controller = new AbortController();
    await expect(client.getEditorialOverview({ signal: controller.signal })).resolves.toEqual(
      overview(),
    );
    expect(request?.url).toBe('https://cms.example.test/api/v1/editorial/overview');
    expect(request?.init?.credentials).toBe('include');
    expect(request?.init?.signal).toBe(controller.signal);
    const headers = new Headers(request?.init?.headers);
    expect(headers.get('x-gridstory-site')).toBe(scope.siteId);
  });

  it('rejects malformed, expanded and wrong-scope responses', async () => {
    for (const body of [
      {},
      { ...overview(), version: 2 },
      overview({ ...scope, tenantId: 'other' }),
      { ...overview(), principal: { roles: ['admin'] } },
    ]) {
      const client = createGridStoryClient({
        baseUrl: 'https://cms.example.test',
        tenantId: scope.tenantId,
        scope,
        fetch: async () => Response.json(body),
      });
      await expect(client.getEditorialOverview()).rejects.toMatchObject({
        status: 502,
        code: 'invalid_editorial_overview',
      });
    }
  });
});
