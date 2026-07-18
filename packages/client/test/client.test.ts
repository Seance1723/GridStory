import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGridStoryClient, type LogicalContentArchive } from '../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GridStoryClient browser compatibility', () => {
  it('calls the default global fetch with the global receiver', async () => {
    const browserLikeFetch = vi.fn(function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', browserLikeFetch);
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      scope: {
        organizationId: 'acme',
        workspaceId: 'marketing',
        siteId: 'website',
        environmentId: 'preview',
        locale: 'fr',
      },
    });

    await expect(client.getSchemas()).resolves.toEqual([]);
    expect(browserLikeFetch).toHaveBeenCalledOnce();
    const request = browserLikeFetch.mock.calls[0];
    const headers = new Headers(request?.[1]?.headers);
    expect(headers.get('x-gridstory-organization')).toBe('acme');
    expect(headers.get('x-gridstory-workspace')).toBe('marketing');
    expect(headers.get('x-gridstory-site')).toBe('website');
    expect(headers.get('x-gridstory-environment')).toBe('preview');
    expect(headers.get('x-gridstory-locale')).toBe('fr');
  });

  it('sends typed schema planning and exact deployment approval requests', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ plan: { id: 'migration_test' }, impact: {} }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.planSchema();
    await client.deploySchema({ expectedPlanId: 'migration_test', approved: true });

    expect(requests.map((request) => request.url)).toEqual([
      'http://gridstory.test/api/v1/schema-lifecycle/plan',
      'http://gridstory.test/api/v1/schema-lifecycle/deploy',
    ]);
    expect(requests.map((request) => request.init?.method)).toEqual(['POST', 'POST']);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      expectedPlanId: 'migration_test',
      approved: true,
    });
  });

  it('requests the scoped design-system manifest through the management boundary', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'design', version: 1, name: 'Design' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: fetchMock,
    });

    await expect(client.getDesignSystem()).resolves.toMatchObject({ id: 'design', version: 1 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://gridstory.test/api/v1/design-system');
  });

  it('sends the shared query contract to management and published delivery endpoints', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(
          JSON.stringify({
            edges: [],
            nodes: [],
            pageInfo: {
              startCursor: null,
              endCursor: null,
              hasNextPage: false,
              hasPreviousPage: false,
            },
            totalCount: 0,
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const query = {
      contentType: 'page',
      filter: { path: 'data.title', operator: 'contains' as const, value: 'React' },
      sort: [{ path: 'updatedAt', direction: 'desc' as const }],
      first: 10,
    };

    await client.queryContent(query);
    await client.queryPublishedContent(query);

    expect(requests.map((request) => request.url)).toEqual([
      'http://gridstory.test/api/v1/content/query',
      'http://gridstory.test/api/v1/delivery/query',
    ]);
    expect(requests.every((request) => request.init?.method === 'POST')).toBe(true);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(query);
  });

  it('sends locale management and published fallback requests with explicit locale scope', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getTranslationCompleteness('source-1');
    await client.createTranslation('source-1', 'fr', { title: 'Bonjour' });
    await client.getLocalizedContent('group-1', { locale: 'fr-CA' });
    await client.getLocalizedRoute('/fr-ca/articles/bonjour', { locale: 'fr-CA' });

    expect(requests.map((request) => request.url)).toEqual([
      'http://gridstory.test/api/v1/content/source-1/translations',
      'http://gridstory.test/api/v1/content/source-1/translations',
      'http://gridstory.test/api/v1/delivery/localized/group-1',
      'http://gridstory.test/api/v1/delivery/localized-routes/fr-ca/articles/bonjour',
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      locale: 'fr',
      data: { title: 'Bonjour' },
    });
    expect(new Headers(requests[2]?.init?.headers).get('x-gridstory-locale')).toBe('fr-CA');
  });

  it('supports webhook operations, drain, replay, and empty delete responses', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ id: 'operation' }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.saveWebhook({
      url: 'https://hooks.example.test/gridstory',
      eventTypes: ['content.published'],
    });
    await client.drainOperations(10);
    await client.replayJob('job-1');
    await client.deleteWebhook('webhook-1');

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['http://gridstory.test/api/v1/operations/webhooks', 'POST'],
      ['http://gridstory.test/api/v1/operations/drain', 'POST'],
      ['http://gridstory.test/api/v1/operations/jobs/job-1/replay', 'POST'],
      ['http://gridstory.test/api/v1/operations/webhooks/webhook-1', 'DELETE'],
    ]);
  });

  it('sends typed logical export, dry-run, and explicit replacement requests', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const archive = {
      manifest: {
        kind: 'manifest',
        format: 'gridstory.logical-content',
        version: 1,
        sourceScope: {
          organizationId: 'local',
          tenantId: 'default',
          workspaceId: 'default',
          siteId: 'default',
          environmentId: 'development',
          locale: 'en',
        },
        exportedAt: '2026-07-17T00:00:00.000Z',
        entryCount: 0,
        archiveChecksum: 'checksum',
      },
      entries: [],
    } satisfies LogicalContentArchive;
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify(archive), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.exportContentArchive();
    await client.importContentArchive(archive);
    await client.importContentArchive(archive, {
      dryRun: false,
      conflictPolicy: 'replace',
      allowSchemaMismatch: true,
    });
    await client.verifyAudit();
    await client.exportAudit();
    await client.getOperationsDashboard();

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['http://gridstory.test/api/v1/portability/export', undefined],
      ['http://gridstory.test/api/v1/portability/import', 'POST'],
      [
        'http://gridstory.test/api/v1/portability/import?dryRun=false&conflictPolicy=replace&allowSchemaMismatch=true',
        'POST',
      ],
      ['http://gridstory.test/api/v1/audit/verify', undefined],
      ['http://gridstory.test/api/v1/audit/export', undefined],
      ['http://gridstory.test/api/v1/operations/summary', undefined],
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual(archive);
  });
});
