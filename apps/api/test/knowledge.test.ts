import type { KnowledgeAgentRuntimeAdapter } from '@gridstory/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const baseHeaders = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'knowledge-tenant',
  'x-gridstory-environment': 'knowledge-test',
};

function headers(actor: string, roles: string) {
  return { ...baseHeaders, 'x-gridstory-actor': actor, 'x-gridstory-roles': roles };
}

describe('knowledge and reviewed-agent HTTP workflow', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('keeps graph reads private and executes only an explicitly human-reviewed draft plan', async () => {
    const runtime: KnowledgeAgentRuntimeAdapter = {
      id: 'knowledge-runtime',
      modelId: 'small',
      async run(input) {
        await input.invokeTool({
          id: 'content-call',
          tool: 'content.get',
          input: { entryId: input.target.id, fieldPaths: ['title'] },
        });
        return {
          contract: 'gridstory.agent-draft-plan.v1',
          summary: 'Use a concise title.',
          targetEntryId: input.target.id,
          expectedDraftRevisionId: input.target.revisionId,
          changes: [{ fieldPath: 'title', value: 'Reviewed knowledge title', rationale: 'Clear.' }],
        };
      },
    };
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      ai: {
        providers: [
          {
            id: 'knowledge-runtime',
            estimate: () => ({ inputTokens: 1, outputTokens: 1, costMicros: 1 }),
            generate: () => ({
              output: '',
              inputTokens: 1,
              outputTokens: 1,
              costMicros: 1,
              finishReason: 'stop',
            }),
          },
        ],
      },
      knowledge: { runtimes: [runtime] },
    });
    const publisher = headers('publisher-a', 'publisher');
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: publisher,
      payload: {
        contentType: 'page',
        data: {
          title: 'Original knowledge title',
          slug: 'knowledge-title',
          topics: ['engineering'],
          blocks: [
            {
              id: 'knowledge-hero',
              component: 'gridstory.hero',
              version: 1,
              props: {
                eyebrow: 'Knowledge',
                heading: 'Original knowledge title',
                body: 'A bounded reviewed operation fixture.',
                tone: 'indigo',
              },
            },
          ],
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const entry = created.json();

    const denied = await server.inject({
      method: 'POST',
      url: '/api/v1/knowledge/graph',
      headers: headers('delivery-a', 'delivery'),
      payload: { seedEntryIds: [entry.id] },
    });
    expect(denied.statusCode).toBe(403);

    const graph = await server.inject({
      method: 'POST',
      url: '/api/v1/knowledge/graph',
      headers: headers('viewer-a', 'viewer'),
      payload: { seedEntryIds: [entry.id] },
    });
    expect(graph.statusCode, graph.body).toBe(200);
    expect(graph.headers['cache-control']).toBe('private, no-store');
    expect(graph.json()).toMatchObject({ seedEntryIds: [entry.id], perspective: 'draft' });

    await server.inject({
      method: 'PUT',
      url: '/api/v1/ai/policy',
      headers: publisher,
      payload: {
        expectedVersion: 0,
        models: [
          {
            providerId: 'knowledge-runtime',
            modelId: 'small',
            enabled: true,
            maximumInputTokens: 1_000,
            maximumOutputTokens: 200,
            inputCostMicrosPerMillion: 1,
            outputCostMicrosPerMillion: 1,
          },
        ],
        budgets: {
          dailyRequests: 10,
          dailyInputTokens: 10_000,
          dailyOutputTokens: 10_000,
          dailyCostMicros: 10_000,
        },
      },
    });
    const prompt = await server.inject({
      method: 'POST',
      url: '/api/v1/ai/prompts',
      headers: publisher,
      payload: {
        expectedVersion: 1,
        promptId: 'knowledge-plan',
        version: 1,
        name: 'Knowledge plan',
        purpose: 'Plan one reviewed draft change.',
        instructions: 'Return only the fixed GridStory plan contract.',
        allowedModels: [{ providerId: 'knowledge-runtime', modelId: 'small' }],
        maximumOutputTokens: 100,
        maximumCostMicros: 100,
        timeoutMs: 1_000,
        retrieval: {
          perspective: 'draft',
          maximumSources: 1,
          rules: [{ contentType: 'page', fieldPaths: ['title'] }],
        },
      },
    });
    expect(prompt.statusCode, prompt.body).toBe(201);
    const active = await server.inject({
      method: 'POST',
      url: '/api/v1/ai/prompts/knowledge-plan/versions/1/activate',
      headers: publisher,
      payload: { expectedVersion: 2 },
    });
    expect(active.statusCode, active.body).toBe(200);
    const enabled = await server.inject({
      method: 'POST',
      url: '/api/v1/ai/kill-switch',
      headers: publisher,
      payload: { expectedVersion: 3, state: 'enabled', reason: 'Knowledge API fixture.' },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);

    const policy = await server.inject({
      method: 'PUT',
      url: '/api/v1/knowledge/agent/policy',
      headers: publisher,
      payload: {
        expectedVersion: 0,
        policy: {
          enabled: true,
          adapterId: 'knowledge-runtime',
          modelId: 'small',
          promptId: 'knowledge-plan',
          promptVersion: 1,
          fieldRules: [{ contentType: 'page', fieldPaths: ['title'] }],
          tools: ['content.get'],
          maximumToolCalls: 2,
          timeoutMs: 1_000,
          planLifetimeSeconds: 300,
        },
      },
    });
    expect(policy.statusCode, policy.body).toBe(200);
    const planned = await server.inject({
      method: 'POST',
      url: '/api/v1/knowledge/agent/plans',
      headers: headers('author-a', 'author'),
      payload: {
        expectedVersion: 1,
        targetEntryId: entry.id,
        goal: 'Improve editor@example.test title.',
      },
    });
    expect(planned.statusCode, planned.body).toBe(201);
    const plan = planned.json().plans[0];
    expect(plan.goal).not.toContain('editor@example.test');
    expect(plan.toolTrace[0]).not.toHaveProperty('output');

    const authorReviewDenied = await server.inject({
      method: 'POST',
      url: `/api/v1/knowledge/agent/plans/${plan.id}/review`,
      headers: headers('author-a', 'author'),
      payload: { expectedVersion: 2, digest: plan.digest, decision: 'approved' },
    });
    expect(authorReviewDenied.statusCode).toBe(403);
    const reviewed = await server.inject({
      method: 'POST',
      url: `/api/v1/knowledge/agent/plans/${plan.id}/review`,
      headers: publisher,
      payload: { expectedVersion: 2, digest: plan.digest, decision: 'approved' },
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    const executed = await server.inject({
      method: 'POST',
      url: `/api/v1/knowledge/agent/plans/${plan.id}/execute`,
      headers: publisher,
      payload: { expectedVersion: 3, digest: plan.digest, idempotencyKey: 'knowledge-exec-a' },
    });
    expect(executed.statusCode, executed.body).toBe(200);
    const updated = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${entry.id}`,
      headers: publisher,
    });
    expect(updated.json().data.title).toBe('Reviewed knowledge title');
  });
});
