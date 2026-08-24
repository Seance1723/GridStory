import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGridStoryClient } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('GridStoryClient knowledge operations', () => {
  it('uses bounded private graph and reviewed-agent paths', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'https://cms.example.test',
      tenantId: 'knowledge-tenant',
      actorId: 'publisher-a',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ version: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    await client.exploreKnowledgeGraph({ seedEntryIds: ['page-a'] });
    await client.listKnowledgeRecommendations({ entryId: 'page-a' });
    await client.getKnowledgeAgent();
    await client.updateKnowledgeAgentPolicy({ expectedVersion: 0, policy: { enabled: false } });
    await client.createKnowledgeAgentPlan({
      expectedVersion: 1,
      targetEntryId: 'page-a',
      goal: 'Improve the title.',
    });
    await client.reviewKnowledgeAgentPlan('plan/a', {
      expectedVersion: 2,
      digest: 'a'.repeat(64),
      decision: 'approved',
    });
    await client.executeKnowledgeAgentPlan('plan/a', {
      expectedVersion: 3,
      digest: 'a'.repeat(64),
      idempotencyKey: 'execution-a',
    });

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['POST', 'https://cms.example.test/api/v1/knowledge/graph'],
      ['POST', 'https://cms.example.test/api/v1/knowledge/recommendations'],
      ['GET', 'https://cms.example.test/api/v1/knowledge/agent'],
      ['PUT', 'https://cms.example.test/api/v1/knowledge/agent/policy'],
      ['POST', 'https://cms.example.test/api/v1/knowledge/agent/plans'],
      ['POST', 'https://cms.example.test/api/v1/knowledge/agent/plans/plan%2Fa/review'],
      ['POST', 'https://cms.example.test/api/v1/knowledge/agent/plans/plan%2Fa/execute'],
    ]);
    expect(requests[0]?.init?.headers).toMatchObject({
      'x-gridstory-tenant': 'knowledge-tenant',
      'x-gridstory-actor': 'publisher-a',
    });
  });
});
