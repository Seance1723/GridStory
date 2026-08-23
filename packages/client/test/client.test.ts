import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  type SignedPluginManifest,
} from '@gridstory/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGridStoryClient, type LogicalContentArchive } from '../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GridStoryClient browser compatibility', () => {
  it('sends typed migration planning, execution, state, and cutover contracts', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'migration-tenant',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getMigrations();
    await client.saveMigrationRecipe({
      id: 'contentful page',
      name: 'Contentful page',
      provider: 'contentful',
      sourceType: 'contentful.Entry.page',
      targetContentType: 'page',
      publicationMode: 'draft',
      fields: [
        { sourcePath: 'fields.title', targetField: 'title', transform: 'string', required: true },
      ],
    });
    await client.createMigrationProject({
      id: 'cutover-1',
      name: 'Cutover',
      sourceId: 'contentful-main',
      recipeIds: ['contentful page'],
      mode: 'dual-run',
    });
    await client.setMigrationProjectState('cutover 1', 'paused');
    await client.createMigrationPlan('cutover 1');
    await client.executeMigrationPlan('plan 1', 'a'.repeat(64));
    await client.validateMigrationCutover('cutover 1');

    expect(requests.map(({ url }) => url)).toEqual([
      'https://cms.example.test/api/v1/migrations',
      'https://cms.example.test/api/v1/migrations/recipes/contentful%20page',
      'https://cms.example.test/api/v1/migrations/projects',
      'https://cms.example.test/api/v1/migrations/projects/cutover%201/state',
      'https://cms.example.test/api/v1/migrations/projects/cutover%201/plans',
      'https://cms.example.test/api/v1/migrations/plans/plan%201/execute',
      'https://cms.example.test/api/v1/migrations/projects/cutover%201/cutover-reports',
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).not.toHaveProperty('id');
    expect(JSON.parse(String(requests[5]?.init?.body))).toEqual({ digest: 'a'.repeat(64) });
  });

  it('sends evidence-bound marketplace publisher, review, decision, and install contracts', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'marketplace-tenant',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const manifest: SignedPluginManifest = {
      format: PLUGIN_MANIFEST_FORMAT,
      manifestVersion: PLUGIN_MANIFEST_VERSION,
      id: 'com.example.marketplace',
      name: 'Marketplace client plugin',
      description: 'Typed client fixture.',
      version: '1.0.0',
      publisher: { id: 'example', name: 'Example' },
      sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
      package: { sha256: 'f'.repeat(64), sizeBytes: 2_048 },
      runtimes: { server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION } },
      requestedCapabilities: [{ capability: 'content.read' }],
      operations: ['read'],
      marketplace: {
        categories: ['authoring'],
        keywords: ['editorial'],
        homepageUrl: 'https://example.com/plugin',
        documentationUrl: 'https://docs.example.com/plugin',
        repositoryUrl: 'https://code.example.com/plugin',
        compatibility: {
          gridstory: { minVersion: '0.0.0', maxVersionExclusive: '1.0.0' },
          testedRuntimes: [
            {
              runtime: 'node',
              version: '22.14.0',
              testedAt: '2026-08-23T12:00:00.000Z',
              evidenceUrl: 'https://ci.example.com/runs/123',
            },
          ],
        },
        support: {
          status: 'maintained',
          policyUrl: 'https://example.com/support-policy',
          contactUrl: 'https://example.com/support',
        },
      },
      signature: { algorithm: 'ed25519', keyId: 'release-1', value: 'A'.repeat(88) },
    };

    await client.getMarketplace();
    await client.registerMarketplacePublisher({
      id: 'example',
      displayName: 'Example',
      domain: 'example.com',
      websiteUrl: 'https://example.com',
      supportUrl: 'https://support.example.com',
      key: {
        keyId: 'release-1',
        algorithm: 'ed25519',
        publicKey: `-----BEGIN PUBLIC KEY-----\n${'A'.repeat(100)}\n-----END PUBLIC KEY-----`,
      },
    });
    await client.issueMarketplacePublisherChallenge('example publisher');
    await client.verifyMarketplacePublisherDomain('example publisher');
    await client.approveMarketplacePublisher('example publisher', {
      evidenceReference: 'publisher-review:client',
      reason: 'Reviewed.',
    });
    await client.submitMarketplaceRelease({
      manifest,
      artifactReference: 'scanner://client-fixture/plugin-1.0.0',
    });
    await client.reviewMarketplaceRelease('release one');
    await client.decideMarketplaceRelease('release one', 'approve', 'Approved.');
    await client.installMarketplaceRelease({
      releaseId: 'release one',
      grantedCapabilities: [{ capability: 'content.read' }],
      reason: 'Install reviewed release.',
    });
    await client.suspendMarketplacePublisher('example publisher', 'Trust incident.');

    expect(requests.map(({ url }) => url)).toEqual([
      'https://cms.example.test/api/v1/marketplace',
      'https://cms.example.test/api/v1/marketplace/publishers',
      'https://cms.example.test/api/v1/marketplace/publishers/example%20publisher/challenge',
      'https://cms.example.test/api/v1/marketplace/publishers/example%20publisher/verify-domain',
      'https://cms.example.test/api/v1/marketplace/publishers/example%20publisher/approve',
      'https://cms.example.test/api/v1/marketplace/releases',
      'https://cms.example.test/api/v1/marketplace/releases/release%20one/review',
      'https://cms.example.test/api/v1/marketplace/releases/release%20one/approve',
      'https://cms.example.test/api/v1/marketplace/releases/release%20one/install',
      'https://cms.example.test/api/v1/marketplace/publishers/example%20publisher/suspend',
    ]);
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({});
    expect(JSON.parse(String(requests[4]?.init?.body))).toEqual({
      evidenceReference: 'publisher-review:client',
      reason: 'Reviewed.',
    });
    expect(JSON.parse(String(requests[8]?.init?.body))).toEqual({
      grantedCapabilities: [{ capability: 'content.read' }],
      reason: 'Install reviewed release.',
    });
  });

  it('sends guarded governance workflow contracts without client-supplied reauthentication time', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'tenant-governed',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getGovernance();
    await client.createDataSubject('subject@example.test');
    await client.createRetentionPlan();
    await client.approveGovernancePlan('plan one', {
      digest: 'a'.repeat(64),
      reason: 'Approved after review.',
      backup: {
        reference: 'backup://tenant-governed/2026-08-23',
        sha256: 'b'.repeat(64),
        verifiedAt: '2026-08-23T00:00:00.000Z',
      },
    });
    await client.processGovernancePlans();

    expect(requests.map(({ url }) => url)).toEqual([
      'https://cms.example.test/api/v1/governance',
      'https://cms.example.test/api/v1/governance/subjects',
      'https://cms.example.test/api/v1/governance/retention/plans',
      'https://cms.example.test/api/v1/governance/plans/plan%20one/approve',
      'https://cms.example.test/api/v1/governance/plans/process',
    ]);
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({
      digest: 'a'.repeat(64),
      reason: 'Approved after review.',
      backup: {
        reference: 'backup://tenant-governed/2026-08-23',
        sha256: 'b'.repeat(64),
        verifiedAt: '2026-08-23T00:00:00.000Z',
      },
    });
  });

  it('uses cookie-backed production identity without emitting development actor headers', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'tenant-enterprise',
      actorId: 'must-not-leak',
      developmentIdentityHeaders: false,
      scope: { organizationId: 'org-enterprise' },
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getIdentity();
    await client.issueDirectoryCredential('Workforce directory');
    await client.createBreakGlassCredential({
      name: 'Emergency operator',
      roleId: 'admin',
      expiresAt: '2026-08-22T00:00:00.000Z',
      incidentId: 'INC-1',
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://cms.example.test/api/v1/identity',
      'https://cms.example.test/api/v1/identity/directory-credentials',
      'https://cms.example.test/api/v1/identity/break-glass',
    ]);
    for (const request of requests) {
      expect(request.init?.credentials).toBe('include');
      expect(new Headers(request.init?.headers).has('x-gridstory-actor')).toBe(false);
    }
    expect(client.federationStartUrl('workforce oidc')).toBe(
      'https://cms.example.test/api/v1/identity/federation/workforce%20oidc/start?organizationId=org-enterprise&tenantId=tenant-enterprise',
    );
  });

  it('sends the typed plugin lifecycle and invocation contracts', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ output: {}, warnings: [] }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const manifest: SignedPluginManifest = {
      format: PLUGIN_MANIFEST_FORMAT,
      manifestVersion: PLUGIN_MANIFEST_VERSION,
      id: 'com.example.client',
      name: 'Client plugin',
      description: '',
      version: '1.0.0',
      publisher: { id: 'example', name: 'Example' },
      sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
      package: { sha256: 'c'.repeat(64), sizeBytes: 100 },
      runtimes: { server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION } },
      requestedCapabilities: [{ capability: 'content.read' }],
      operations: ['read'],
      signature: { algorithm: 'ed25519', keyId: 'release-1', value: 'A'.repeat(88) },
    };

    await client.installPlugin({
      manifest,
      artifactDigest: manifest.package.sha256,
      grantedCapabilities: [{ capability: 'content.read' }],
      reason: 'Approved.',
    });
    await client.enablePlugin(manifest.id, 'Healthy.');
    await client.invokePlugin(manifest.id, 'read', 'content.read', { id: 'entry-1' });
    await client.previewPluginUninstall(manifest.id);
    await client.uninstallPlugin(manifest.id, 'Finished.');

    expect(requests.map(({ url }) => url)).toEqual([
      'http://gridstory.test/api/v1/plugins/install',
      'http://gridstory.test/api/v1/plugins/com.example.client/enable',
      'http://gridstory.test/api/v1/plugins/com.example.client/invoke',
      'http://gridstory.test/api/v1/plugins/com.example.client/uninstall-preview',
      'http://gridstory.test/api/v1/plugins/com.example.client',
    ]);
    expect(requests.map(({ init }) => init?.method ?? 'GET')).toEqual([
      'POST',
      'POST',
      'POST',
      'GET',
      'DELETE',
    ]);
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      operation: 'read',
      capability: 'content.read',
      input: { id: 'entry-1' },
    });
  });

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

  it('requests saved and candidate quality reports through private management routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ passed: true, findings: [] }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getContentQuality('entry/1', { channel: 'email' });
    await client.assessContentQuality('entry/1', { title: 'Candidate' }, { channel: 'web' });
    await client.publish('entry/1', 'revision-1', undefined, 'email');

    expect(requests.map((request) => request.url)).toEqual([
      'http://gridstory.test/api/v1/content/entry%2F1/quality?channel=email',
      'http://gridstory.test/api/v1/content/entry%2F1/quality?channel=web',
      'http://gridstory.test/api/v1/content/entry%2F1/publish',
    ]);
    expect(requests.map((request) => request.init?.method)).toEqual([undefined, 'POST', 'POST']);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ data: { title: 'Candidate' } });
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      expectedRevisionId: 'revision-1',
      channel: 'email',
    });
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

  it('isolates management session creation from token-authenticated preview requests', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'tenant',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        if (String(input).endsWith('/preview/sessions')) {
          return new Response(
            JSON.stringify({
              token: 'gsp_token',
              sessionId: 'session-1',
              previewUrl: 'https://preview.example.test/',
              origin: 'https://preview.example.test',
              protocolVersion: 1,
              expiresAt: '2026-07-23T12:00:00.000Z',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        }
        if (String(input).includes('/preview/content/')) {
          return new Response(JSON.stringify({ id: 'page-1' }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ accepted: true, sequence: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const grant = await client.createPreviewSession({
      previewUrl: 'https://preview.example.test/',
      route: '/welcome',
      mode: 'iframe',
      entryId: 'page-1',
    });
    await client.getPreviewContent('page-1', grant.token);
    await client.acceptPreviewMessage(grant.sessionId, grant.token, {
      type: 'gridstory.preview.ready',
      protocolVersion: 1,
      sessionId: grant.sessionId,
      sequence: 1,
      nonce: 'nonce-0000000001',
      payload: { route: '/welcome' },
    });
    await client.revokePreviewSession(grant.sessionId, grant.token);
    await client.revokePreviewSession(grant.sessionId);

    const creationHeaders = new Headers(requests[0]?.init?.headers);
    const tokenHeaders = new Headers(requests[1]?.init?.headers);
    const managementRevokeHeaders = new Headers(requests[4]?.init?.headers);
    expect(creationHeaders.get('x-gridstory-tenant')).toBe('tenant');
    expect(tokenHeaders.get('authorization')).toBe('Bearer gsp_token');
    expect(tokenHeaders.has('x-gridstory-tenant')).toBe(false);
    expect(managementRevokeHeaders.get('x-gridstory-tenant')).toBe('tenant');
  });
  it('routes scoped collaboration and presence requests with typed payloads', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'tenant',
      actorId: 'author',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ threads: [], presence: [] }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getCollaboration('page-1');
    await client.submitCollaborationOperation('page-1', {
      id: 'operation-1',
      branchId: 'main',
      actorSequence: 4,
      dependencies: ['operation-0'],
      target: { field: 'story', nodeId: 'paragraph-1', property: 'text' },
      value: 'Updated paragraph',
    });
    await client.createCollaborationBranch('page-1', {
      name: 'Campaign',
      parentBranchId: 'main',
    });
    await client.createCollaborationSuggestion('page-1', {
      branchId: 'campaign',
      target: { field: 'title' },
      value: 'Suggested title',
    });
    await client.reviewCollaborationSuggestion('page-1', 'suggestion-1', 'accept');
    await client.mergeCollaborationBranch('page-1', 'campaign');
    await client.resolveCollaborationConflict('page-1', 'conflict-1', {
      operationId: 'operation-1',
    });
    await client.createCommentThread('page-1', {
      target: { field: 'story', nodeId: 'paragraph-1' },
      body: 'Review @editor',
      assigneeId: 'editor',
      dueAt: '2026-08-01T12:00:00.000Z',
    });
    await client.replyToComment('page-1', 'thread-1', 'Done.');
    await client.updateCommentThread('page-1', 'thread-1', {
      assigneeId: null,
      dueAt: null,
      resolved: true,
    });
    await client.heartbeatPresence('page-1', {
      displayName: 'Author',
      field: 'story',
      nodeId: 'paragraph-1',
    });
    await client.leavePresence('page-1');

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['http://gridstory.test/api/v1/content/page-1/collaboration', undefined],
      ['http://gridstory.test/api/v1/content/page-1/collaboration/operations', 'POST'],
      ['http://gridstory.test/api/v1/content/page-1/collaboration/branches', 'POST'],
      ['http://gridstory.test/api/v1/content/page-1/collaboration/suggestions', 'POST'],
      [
        'http://gridstory.test/api/v1/content/page-1/collaboration/suggestions/suggestion-1',
        'PATCH',
      ],
      ['http://gridstory.test/api/v1/content/page-1/collaboration/merges', 'POST'],
      ['http://gridstory.test/api/v1/content/page-1/collaboration/conflicts/conflict-1', 'PATCH'],
      ['http://gridstory.test/api/v1/content/page-1/comments', 'POST'],
      ['http://gridstory.test/api/v1/content/page-1/comments/thread-1/replies', 'POST'],
      ['http://gridstory.test/api/v1/content/page-1/comments/thread-1', 'PATCH'],
      ['http://gridstory.test/api/v1/content/page-1/presence', 'PUT'],
      ['http://gridstory.test/api/v1/content/page-1/presence', 'DELETE'],
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      id: 'operation-1',
      branchId: 'main',
      actorSequence: 4,
      dependencies: ['operation-0'],
      target: { field: 'story', nodeId: 'paragraph-1', property: 'text' },
      value: 'Updated paragraph',
    });
    expect(JSON.parse(String(requests[7]?.init?.body))).toMatchObject({
      target: { field: 'story', nodeId: 'paragraph-1' },
      body: 'Review @editor',
      assigneeId: 'editor',
    });
    expect(JSON.parse(String(requests[9]?.init?.body))).toEqual({
      assigneeId: null,
      dueAt: null,
      resolved: true,
    });
    expect(new Headers(requests[10]?.init?.headers).get('x-gridstory-actor')).toBe('author');
  });

  it('routes component lifecycle inspection and migration through typed management calls', async () => {
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

    await client.getComponentUsage('acme.hero');
    await client.getComponentMigration('acme.hero');
    await client.getComponentVisualRegression('acme.hero');
    await client.migrateEntryComponent('entry/1', 'acme.hero', 'revision-1');

    expect(requests.map((request) => request.url)).toEqual([
      'http://gridstory.test/api/v1/components/acme.hero/usage',
      'http://gridstory.test/api/v1/components/acme.hero/migration',
      'http://gridstory.test/api/v1/components/acme.hero/visual-regression',
      'http://gridstory.test/api/v1/content/entry%2F1/components/acme.hero/migrate',
    ]);
    expect(requests[3]?.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({
      expectedRevisionId: 'revision-1',
    });
  });

  it('routes resumable asset management with binary part bodies', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        if (String(input).endsWith('/delivery')) {
          return new Response(
            JSON.stringify({
              assetId: 'asset/1',
              revisionId: 'revision-1',
              url: '/api/v1/assets/asset%2F1/content?token=signed',
              expiresAt: '2026-07-24T00:01:00.000Z',
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.listAssets();
    const delivery = await client.createAssetDelivery('asset/1', { ttlSeconds: 60 });
    expect(delivery.url).toBe('http://gridstory.test/api/v1/assets/asset%2F1/content?token=signed');
    await client.startAssetUpload({
      filename: 'hero.jpg',
      mediaType: 'image/jpeg',
      size: 4,
      kind: 'image',
      metadata: { title: 'Hero' },
    });
    await client.getAssetUpload('upload/1');
    await client.uploadAssetPart('upload/1', 2, new Uint8Array([1, 2, 3, 4]));
    await client.completeAssetUpload('upload/1', [{ partNumber: 2, etag: 'etag', size: 4 }]);
    await client.updateAsset('asset/1', { focalPoint: { x: 0.25, y: 0.75 } });
    await client.createAssetRendition('asset/1', {
      id: 'card',
      width: 640,
      fit: 'cover',
      format: 'webp',
      quality: 80,
    });
    await client.getAssetUsage('asset/1');
    await client.abortAssetUpload('upload/1');

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['http://gridstory.test/api/v1/assets', undefined],
      ['http://gridstory.test/api/v1/assets/asset%2F1/delivery', 'POST'],
      ['http://gridstory.test/api/v1/assets/uploads', 'POST'],
      ['http://gridstory.test/api/v1/assets/uploads/upload%2F1', undefined],
      ['http://gridstory.test/api/v1/assets/uploads/upload%2F1/parts/2', 'PUT'],
      ['http://gridstory.test/api/v1/assets/uploads/upload%2F1/complete', 'POST'],
      ['http://gridstory.test/api/v1/assets/asset%2F1', 'PATCH'],
      ['http://gridstory.test/api/v1/assets/asset%2F1/renditions', 'POST'],
      ['http://gridstory.test/api/v1/assets/asset%2F1/usage', undefined],
      ['http://gridstory.test/api/v1/assets/uploads/upload%2F1', 'DELETE'],
    ]);
    expect(new Headers(requests[4]?.init?.headers).get('content-type')).toBe(
      'application/octet-stream',
    );
    expect(requests[4]?.init?.body).toBeInstanceOf(ArrayBuffer);
    const uploadBody = requests[4]?.init?.body;
    if (!(uploadBody instanceof ArrayBuffer)) throw new Error('Expected binary upload body.');
    expect(uploadBody.byteLength).toBe(4);
  });
  it('sends workflow transitions, decisions, schedules, and cancellation through scoped management routes', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'default',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ stateId: 'draft' }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getContentWorkflow('entry/1');
    await client.requestWorkflowTransition('entry/1', 'submit-review', ['title']);
    await client.decideWorkflowApproval('entry/1', 'request/1', 'approved', 'Ready.');
    await client.scheduleWorkflowTransition('entry/1', {
      transitionId: 'publish',
      runAt: '2026-07-27T00:00:00.000Z',
      timeZone: 'Asia/Kolkata',
    });
    await client.cancelWorkflowSchedule('entry/1', 'schedule/1');
    await client.listWorkflowActions();
    await client.drainWorkflowActions(10);
    await client.replayWorkflowAction('action/1');

    expect(requests.map((request) => request.url)).toEqual([
      'http://gridstory.test/api/v1/content/entry%2F1/workflow',
      'http://gridstory.test/api/v1/content/entry%2F1/workflow/transitions/submit-review',
      'http://gridstory.test/api/v1/content/entry%2F1/workflow/approvals/request%2F1',
      'http://gridstory.test/api/v1/content/entry%2F1/workflow/schedules',
      'http://gridstory.test/api/v1/content/entry%2F1/workflow/schedules/schedule%2F1',
      'http://gridstory.test/api/v1/workflow-actions',
      'http://gridstory.test/api/v1/workflow-actions/drain',
      'http://gridstory.test/api/v1/workflow-actions/action%2F1/replay',
    ]);
    expect(requests.map((request) => request.init?.method)).toEqual([
      undefined,
      'POST',
      'POST',
      'POST',
      'DELETE',
      undefined,
      'POST',
      'POST',
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ changedFields: ['title'] });
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      decision: 'approved',
      comment: 'Ready.',
    });
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({
      transitionId: 'publish',
      runAt: '2026-07-27T00:00:00.000Z',
      timeZone: 'Asia/Kolkata',
    });
    expect(JSON.parse(String(requests[6]?.init?.body))).toEqual({ limit: 10 });
  });
  it('routes release creation, preview, scheduling, execution, and rollback with encoded IDs', async () => {
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

    await client.listReleases();
    await client.createRelease({
      name: 'Launch',
      entries: [
        { entryId: 'entry/1', revisionId: 'revision-1' },
        { entryId: 'entry/2', revisionId: 'revision-2' },
      ],
      rollbackPolicy: { mode: 'manual' },
    });
    await client.getRelease('release/1');
    await client.validateRelease('release/1', 'web');
    await client.previewRelease('release/1');
    await client.scheduleRelease('release/1', {
      runAt: '2026-07-27T00:00:00.000Z',
      timeZone: 'Asia/Kolkata',
    });
    await client.cancelReleaseSchedule('release/1');
    await client.executeRelease('release/1', 'web');
    await client.rollbackRelease('release/1', 'Rollback drill');
    await client.processDueReleases();

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['http://gridstory.test/api/v1/releases', undefined],
      ['http://gridstory.test/api/v1/releases', 'POST'],
      ['http://gridstory.test/api/v1/releases/release%2F1', undefined],
      ['http://gridstory.test/api/v1/releases/release%2F1/validate', 'POST'],
      ['http://gridstory.test/api/v1/releases/release%2F1/preview', undefined],
      ['http://gridstory.test/api/v1/releases/release%2F1/schedule', 'POST'],
      ['http://gridstory.test/api/v1/releases/release%2F1/schedule', 'DELETE'],
      ['http://gridstory.test/api/v1/releases/release%2F1/execute', 'POST'],
      ['http://gridstory.test/api/v1/releases/release%2F1/rollback', 'POST'],
      ['http://gridstory.test/api/v1/releases/process-due', 'POST'],
    ]);
    expect(JSON.parse(String(requests[5]?.init?.body))).toEqual({
      runAt: '2026-07-27T00:00:00.000Z',
      timeZone: 'Asia/Kolkata',
    });
    expect(JSON.parse(String(requests[8]?.init?.body))).toEqual({
      reason: 'Rollback drill',
    });
  });
  it('routes search, taxonomy, index, backlink, and related-content requests', async () => {
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

    await client.search({ text: 'launch', taxonomies: { topics: ['product'] } });
    await client.listTaxonomies();
    await client.getSearchIndexStatus();
    await client.rebuildSearchIndex('draft');
    await client.listBacklinks('entry/1', 'draft');
    await client.listRelatedContent('entry/1', { perspective: 'published', limit: 5 });

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['http://gridstory.test/api/v1/search', 'POST'],
      ['http://gridstory.test/api/v1/taxonomies', undefined],
      ['http://gridstory.test/api/v1/search/index/status', undefined],
      ['http://gridstory.test/api/v1/search/index/rebuild', 'POST'],
      ['http://gridstory.test/api/v1/content/entry%2F1/backlinks?perspective=draft', undefined],
      [
        'http://gridstory.test/api/v1/content/entry%2F1/related?perspective=published&limit=5',
        undefined,
      ],
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      text: 'launch',
      taxonomies: { topics: ['product'] },
    });
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({ perspective: 'draft' });
  });
  it('routes personalization draft, publish, preview, and edge decisions without profile state', async () => {
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
    const configuration = { purposes: [], attributes: [], audiences: [], decisions: [] };
    const decision = {
      resourceKey: 'hero',
      attributes: {},
      consent: { grantedPurposes: [], deniedPurposes: [], globalPrivacyControl: false },
    };

    await client.getPersonalization();
    await client.replacePersonalizationDraft({ expectedVersion: 0, configuration });
    await client.publishPersonalization({ expectedVersion: 1, expectedDraftRevision: 2 });
    await client.previewPersonalization({ ...decision, override: { variant: 'default' } });
    await client.decidePersonalization(decision);

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['http://gridstory.test/api/v1/personalization', undefined],
      ['http://gridstory.test/api/v1/personalization/draft', 'PUT'],
      ['http://gridstory.test/api/v1/personalization/publish', 'POST'],
      ['http://gridstory.test/api/v1/personalization/preview', 'POST'],
      ['http://gridstory.test/api/v1/personalization/decide', 'POST'],
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      expectedVersion: 0,
      configuration,
    });
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({
      ...decision,
      override: { variant: 'default' },
    });
  });

  it('routes governed experiment lifecycle, aggregate evidence, promotion, and allocation', async () => {
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
    const design = {
      id: 'hero-copy-test',
      name: 'Hero copy',
      hypothesis: 'Treatment improves signup rate.',
      target: { resourceKey: 'hero' },
      controlVariant: 'default',
      purposeId: 'experimentation',
      allocations: [
        { variant: 'default', weightBasisPoints: 5_000 },
        { variant: 'treatment', weightBasisPoints: 5_000 },
      ],
      metrics: [
        {
          key: 'signup-rate',
          name: 'Signup rate',
          role: 'primary' as const,
          direction: 'increase' as const,
          minimumSampleSize: 100,
        },
      ],
      minimumDurationHours: 24,
      maximumAllocationDeviationBasisPoints: 500,
    };
    const snapshot = {
      id: 'snapshot-1',
      evidenceId: 'warehouse-run-1',
      evidenceDigest: 'a'.repeat(64),
      observedAt: '2026-08-23T12:00:00.000Z',
      variantResults: [
        {
          variant: 'default',
          exposures: 100,
          observations: [{ metricKey: 'signup-rate', sampleSize: 100, value: 0.1 }],
        },
        {
          variant: 'treatment',
          exposures: 100,
          observations: [{ metricKey: 'signup-rate', sampleSize: 100, value: 0.12 }],
        },
      ],
    };

    await client.getExperiments();
    await client.saveExperimentDraft('hero/copy', { expectedVersion: 2, design });
    await client.transitionExperiment('hero/copy', {
      expectedVersion: 3,
      action: 'start',
      reason: 'Reviewed.',
    });
    await client.recordExperimentMetrics('hero/copy', { expectedVersion: 4, snapshot });
    await client.promoteExperimentWinner('hero/copy', {
      expectedVersion: 6,
      snapshotId: 'snapshot-1',
      winnerVariant: 'treatment',
      reason: 'Evidence supports treatment.',
    });
    await client.allocateExperiment('hero/copy', {
      attributes: {},
      consent: {
        grantedPurposes: ['experimentation'],
        deniedPurposes: [],
        globalPrivacyControl: false,
      },
      assignmentToken: '5e2d7f02-6f34-4c66-aac2-1e869bced27e',
    });

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['http://gridstory.test/api/v1/experiments', undefined],
      ['http://gridstory.test/api/v1/experiments/hero%2Fcopy', 'PUT'],
      ['http://gridstory.test/api/v1/experiments/hero%2Fcopy/transition', 'POST'],
      ['http://gridstory.test/api/v1/experiments/hero%2Fcopy/metrics', 'POST'],
      ['http://gridstory.test/api/v1/experiments/hero%2Fcopy/promote', 'POST'],
      ['http://gridstory.test/api/v1/experiments/hero%2Fcopy/allocate', 'POST'],
    ]);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ expectedVersion: 2, design });
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({
      expectedVersion: 4,
      snapshot,
    });
  });
});
