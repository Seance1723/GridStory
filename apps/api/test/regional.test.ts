import {
  emptyGovernanceDocument,
  type RegionalFailoverAdapter,
  type RegionalReadAdapter,
  InMemoryGovernanceRepository,
} from '@gridstory/core';
import type { ContentEntry, ContentScope } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const scope: ContentScope = {
  organizationId: 'local',
  tenantId: 'default',
  workspaceId: 'default',
  siteId: 'default',
  environmentId: 'development',
  locale: 'en',
};

function headers(actor: string, roles: string) {
  return {
    'content-type': 'application/json',
    'x-gridstory-actor': actor,
    'x-gridstory-roles': roles,
  };
}

function regionalPage(inputScope: ContentScope): ContentEntry {
  const timestamp = new Date().toISOString();
  return {
    ...inputScope,
    id: 'regional-welcome',
    contentType: 'page',
    status: 'published',
    draftRevisionId: 'regional-revision-1',
    publishedRevisionId: 'regional-revision-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    data: {
      title: 'Regional welcome',
      slug: 'welcome',
      blocks: [
        {
          id: 'regional-hero',
          component: 'gridstory.hero',
          version: 1,
          props: {
            eyebrow: 'Regional',
            heading: 'Regional welcome',
            body: 'Published replica fixture.',
            tone: 'indigo',
          },
        },
      ],
    },
  };
}

class ApiReadAdapter implements RegionalReadAdapter {
  readonly name = 'reader-api';
  hostileTenant = false;

  open(input: Parameters<RegionalReadAdapter['open']>[0]) {
    const entry = regionalPage({
      ...input.scope,
      ...(this.hostileTenant ? { tenantId: 'other-tenant' } : {}),
    });
    return {
      reader: {
        list: () => [structuredClone(entry)],
        getBySlug: () => structuredClone(entry),
        getTranslationGroup: () => 'regional-translation',
        listTranslationVariants: () => [structuredClone(entry)],
      },
      evidence: {
        ...input.scope,
        adapter: this.name,
        servedRegion: input.region,
        role: 'replica',
        topologyVersion: input.topologyVersion,
        observedAt: new Date().toISOString(),
        lagMs: 200,
        watermark: 'provider-position-must-not-be-exposed',
        residencyEvidenceReference: 'placement://eu-west-1',
      },
    };
  }
}

class ApiFailoverAdapter implements RegionalFailoverAdapter {
  readonly name = 'failover-api';

  preflight(input: Parameters<RegionalFailoverAdapter['preflight']>[0]) {
    return {
      ...input.scope,
      adapter: this.name,
      requestId: input.requestId,
      sourceRegion: input.sourceRegion,
      targetRegion: input.targetRegion,
      topologyVersion: input.topologyVersion,
      checkedAt: new Date().toISOString(),
      ready: true,
      caughtUp: true,
      replicationLagMs: 0,
      estimatedDataLossMs: 0,
      evidenceDigest: 'a'.repeat(64),
    };
  }

  execute(input: Parameters<RegionalFailoverAdapter['execute']>[0]) {
    return this.result(input);
  }

  reconcile(input: Parameters<RegionalFailoverAdapter['reconcile']>[0]) {
    return this.result(input);
  }

  private result(input: Parameters<RegionalFailoverAdapter['execute']>[0]) {
    return {
      ...input.scope,
      adapter: this.name,
      requestId: input.requestId,
      sourceRegion: input.sourceRegion,
      targetRegion: input.targetRegion,
      topologyVersion: input.topologyVersion,
      outcome: 'succeeded',
      activeRegion: input.targetRegion,
      sourceWritable: false,
      targetWritable: true,
      completedAt: new Date().toISOString(),
      evidenceDigest: 'b'.repeat(64),
    };
  }
}

describe('regional HTTP workflow', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('keeps default delivery unchanged, validates replica output, and governs failover', async () => {
    const governance = new InMemoryGovernanceRepository();
    const document = emptyGovernanceDocument(scope, new Date().toISOString());
    document.residencyPolicy = {
      homeRegion: 'us-east-1',
      requireAttestation: true,
      rules: [
        { resourceType: 'content', allowedRegions: ['local', 'us-east-1', 'eu-west-1'] },
        { resourceType: 'asset', allowedRegions: ['local'] },
        { resourceType: 'identity', allowedRegions: ['local'] },
        { resourceType: 'plugin', allowedRegions: ['local'] },
      ],
      updatedBy: 'security-a',
      updatedAt: new Date().toISOString(),
    };
    governance.save(document, null);
    const reads = new ApiReadAdapter();
    server = await buildServer({
      databasePath: ':memory:',
      governance: { repository: governance },
      regional: {
        localRegion: 'eu-west-1',
        readAdapters: [reads],
        failoverAdapters: [new ApiFailoverAdapter()],
      },
    });

    const defaultDelivery = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/welcome',
    });
    expect(defaultDelivery.statusCode, defaultDelivery.body).toBe(200);
    expect(defaultDelivery.headers['cache-control']).toContain('s-maxage=60');
    expect(defaultDelivery.headers['x-gridstory-consistency']).toBeUndefined();

    const viewer = await server.inject({
      method: 'GET',
      url: '/api/v1/regional',
      headers: headers('viewer-a', 'viewer'),
    });
    expect(viewer.statusCode).toBe(200);
    expect(viewer.headers['cache-control']).toBe('private, no-store');
    expect(viewer.json()).toMatchObject({ version: 0, state: 'disabled' });

    const viewerDenied = await server.inject({
      method: 'PUT',
      url: '/api/v1/regional/policy',
      headers: headers('viewer-a', 'viewer'),
      payload: {},
    });
    expect(viewerDenied.statusCode).toBe(403);

    const configured = await server.inject({
      method: 'PUT',
      url: '/api/v1/regional/policy',
      headers: headers('publisher-a', 'publisher'),
      payload: {
        expectedVersion: 0,
        state: 'enabled',
        activeControlRegion: 'us-east-1',
        activeControlEvidenceReference: 'placement://us-east-1',
        readPolicy: {
          mode: 'bounded-staleness',
          maximumLagMs: 5_000,
          failureMode: 'unavailable',
        },
        readRegions: [
          {
            region: 'eu-west-1',
            adapter: 'reader-api',
            enabled: true,
            residencyEvidenceReference: 'placement://eu-west-1',
          },
        ],
        failoverAdapter: 'failover-api',
      },
    });
    expect(configured.statusCode, configured.body).toBe(200);

    const regionalDelivery = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/welcome',
    });
    expect(regionalDelivery.statusCode, regionalDelivery.body).toBe(200);
    expect(regionalDelivery.json()).toMatchObject({
      id: 'regional-welcome',
      data: { title: 'Regional welcome' },
    });
    expect(regionalDelivery.headers).toMatchObject({
      'cache-control': 'private, no-store',
      'x-gridstory-served-region': 'eu-west-1',
      'x-gridstory-region-role': 'replica',
      'x-gridstory-consistency': 'bounded-staleness',
      'x-gridstory-replication-lag-ms': '200',
      'x-gridstory-topology-version': '2',
      'x-gridstory-cache-mode': 'private',
      'x-gridstory-fallback-used': 'false',
    });
    expect(regionalDelivery.headers['x-gridstory-watermark-digest']).toMatch(/^[a-f0-9]{64}$/);
    expect(regionalDelivery.body).not.toContain('provider-position-must-not-be-exposed');

    reads.hostileTenant = true;
    const hostile = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/welcome',
    });
    expect(hostile.statusCode).toBe(500);
    expect(hostile.json()).toMatchObject({ error: { code: 'tenant_scope_violation' } });
    expect(hostile.body).not.toContain('other-tenant');
    reads.hostileTenant = false;

    const publisherFailoverDenied = await server.inject({
      method: 'POST',
      url: '/api/v1/regional/failover/preflight',
      headers: headers('publisher-a', 'publisher'),
      payload: {},
    });
    expect(publisherFailoverDenied.statusCode).toBe(403);

    const preview = await server.inject({
      method: 'POST',
      url: '/api/v1/regional/failover/preflight',
      headers: headers('admin-a', 'admin'),
      payload: {
        expectedVersion: configured.json().version,
        requestId: '018daf23-89b3-7cf8-a4f1-94064c96df90',
        targetRegion: 'eu-west-1',
        mode: 'planned',
        reason: 'Planned API switchover.',
        expectedRpoSeconds: 0,
        expectedRtoSeconds: 120,
        backup: {
          reference: 'backup://regional/api-fixture',
          sha256: 'c'.repeat(64),
          verifiedAt: new Date().toISOString(),
        },
      },
    });
    expect(preview.statusCode, preview.body).toBe(201);
    const plan = preview.json().operations[0];

    const sameHuman = await server.inject({
      method: 'POST',
      url: `/api/v1/regional/failover/${plan.id}/approve`,
      headers: headers('admin-a', 'admin'),
      payload: {
        expectedVersion: preview.json().version,
        digest: plan.digest,
        reason: 'Self review.',
        acceptDataLoss: false,
      },
    });
    expect(sameHuman.statusCode).toBe(403);

    const approved = await server.inject({
      method: 'POST',
      url: `/api/v1/regional/failover/${plan.id}/approve`,
      headers: headers('admin-b', 'admin'),
      payload: {
        expectedVersion: preview.json().version,
        digest: plan.digest,
        reason: 'Independent readiness review.',
        acceptDataLoss: false,
      },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const completed = await server.inject({
      method: 'POST',
      url: `/api/v1/regional/failover/${plan.id}/execute`,
      headers: headers('admin-b', 'admin'),
      payload: { expectedVersion: approved.json().version },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json()).toMatchObject({
      activeControlRegion: 'eu-west-1',
      readPolicy: { mode: 'primary-only' },
      operations: [{ state: 'succeeded' }],
    });

    const isolated = await server.inject({
      method: 'GET',
      url: '/api/v1/regional',
      headers: {
        ...headers('viewer-a', 'viewer'),
        'x-gridstory-tenant': 'other-tenant',
      },
    });
    expect(isolated.json()).toMatchObject({ version: 0, state: 'disabled' });
  });
});
