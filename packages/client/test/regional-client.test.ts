import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGridStoryClient } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('GridStoryClient regional controls', () => {
  it('sends typed private topology and failover operations to bounded paths', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'regional-tenant',
      actorId: 'operator-a',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ version: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.getRegionalTopology();
    await client.updateRegionalPolicy({
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
          adapter: 'reader-a',
          enabled: true,
          residencyEvidenceReference: 'placement://eu-west-1',
        },
      ],
      failoverAdapter: 'failover-a',
    });
    await client.preflightRegionalFailover({
      expectedVersion: 1,
      requestId: '018daf23-89b3-7cf8-a4f1-94064c96df90',
      targetRegion: 'eu-west-1',
      mode: 'planned',
      reason: 'Planned maintenance.',
      expectedRpoSeconds: 0,
      expectedRtoSeconds: 120,
      backup: {
        reference: 'backup://regional/client',
        sha256: 'a'.repeat(64),
        verifiedAt: '2026-08-24T08:00:00.000Z',
      },
    });
    await client.approveRegionalFailover('plan/a', {
      expectedVersion: 2,
      digest: 'b'.repeat(64),
      reason: 'Reviewed.',
      acceptDataLoss: false,
    });
    await client.executeRegionalFailover('plan/a', { expectedVersion: 3 });
    await client.reconcileRegionalFailover('plan/a', { expectedVersion: 4 });

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', 'https://cms.example.test/api/v1/regional'],
      ['PUT', 'https://cms.example.test/api/v1/regional/policy'],
      ['POST', 'https://cms.example.test/api/v1/regional/failover/preflight'],
      ['POST', 'https://cms.example.test/api/v1/regional/failover/plan%2Fa/approve'],
      ['POST', 'https://cms.example.test/api/v1/regional/failover/plan%2Fa/execute'],
      ['POST', 'https://cms.example.test/api/v1/regional/failover/plan%2Fa/reconcile'],
    ]);
    expect(requests[1]?.init?.headers).toMatchObject({
      'x-gridstory-tenant': 'regional-tenant',
      'x-gridstory-actor': 'operator-a',
    });
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({
      expectedVersion: 2,
      digest: 'b'.repeat(64),
      reason: 'Reviewed.',
      acceptDataLoss: false,
    });
  });
});
