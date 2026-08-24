import type { AiGatewayDocument, ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ContentService,
  InMemoryKnowledgeRepository,
  KnowledgeService,
  type KnowledgeAgentRuntimeAdapter,
  SqliteContentRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};
const schema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  taxonomies: [
    {
      id: 'topics',
      name: 'Topics',
      hierarchical: false,
      terms: [{ id: 'launch', slug: 'launch', label: 'Launch' }],
    },
  ],
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    {
      id: 'page.related',
      name: 'related',
      label: 'Related',
      type: 'relation',
      targets: ['page'],
      multiple: true,
    },
    {
      id: 'page.topics',
      name: 'topics',
      label: 'Topics',
      type: 'taxonomy',
      taxonomy: 'topics',
      multiple: true,
    },
  ],
};
const actor = { id: 'publisher-a', roles: ['publisher'] };
const contentRepositories: SqliteContentRepository[] = [];

afterEach(() =>
  contentRepositories.splice(0).forEach((repository) => {
    repository.close();
  }),
);

async function createHarness() {
  const contentRepository = new SqliteContentRepository({ filename: ':memory:' });
  contentRepositories.push(contentRepository);
  const content = new ContentService({
    repository: contentRepository,
    schemas: [schema],
    componentManifests: [],
  });
  const a = await content.create({
    scope,
    id: 'page-a',
    contentType: 'page',
    data: {
      title: 'Original contact person@example.test',
      slug: 'page-a',
      related: [],
      topics: ['launch'],
    },
    actor,
  });
  const b = await content.create({
    scope,
    id: 'page-b',
    contentType: 'page',
    data: {
      title: 'Page B',
      slug: 'page-b',
      related: [],
      topics: ['launch'],
    },
    actor,
  });
  const c = await content.create({
    scope,
    id: 'page-c',
    contentType: 'page',
    data: {
      title: 'Page C',
      slug: 'page-c',
      related: [],
      topics: [],
    },
    actor,
  });
  const updatedA = await content.updateDraft({
    scope,
    id: a.id,
    expectedRevisionId: a.draftRevisionId,
    data: { ...a.data, related: [{ id: b.id, contentType: 'page' }] },
    actor,
  });
  await content.updateDraft({
    scope,
    id: b.id,
    expectedRevisionId: b.draftRevisionId,
    data: { ...b.data, related: [{ id: c.id, contentType: 'page' }] },
    actor,
  });
  await content.updateDraft({
    scope,
    id: c.id,
    expectedRevisionId: c.draftRevisionId,
    data: { ...c.data, related: [{ id: a.id, contentType: 'page' }] },
    actor,
  });
  return { contentRepository, content, a: updatedA };
}

function gateway(): AiGatewayDocument {
  return {
    ...scope,
    schemaVersion: 1,
    version: 4,
    state: 'enabled',
    models: [
      {
        providerId: 'runtime-a',
        modelId: 'small',
        enabled: true,
        maximumInputTokens: 1_000,
        maximumOutputTokens: 200,
        inputCostMicrosPerMillion: 1,
        outputCostMicrosPerMillion: 1,
      },
    ],
    budgets: {
      dailyRequests: 20,
      dailyInputTokens: 10_000,
      dailyOutputTokens: 10_000,
      dailyCostMicros: 10_000,
    },
    promptVersions: [
      {
        promptId: 'knowledge-plan',
        version: 1,
        name: 'Knowledge plan',
        purpose: 'Create one reviewed draft plan.',
        instructions: 'Return the fixed plan contract.',
        allowedModels: [{ providerId: 'runtime-a', modelId: 'small' }],
        maximumOutputTokens: 200,
        maximumCostMicros: 100,
        timeoutMs: 1_000,
        retrieval: {
          perspective: 'draft',
          maximumSources: 3,
          rules: [{ contentType: 'page', fieldPaths: ['title'] }],
        },
        createdBy: 'publisher-a',
        createdAt: '2026-08-24T08:00:00.000Z',
      },
    ],
    activePrompts: [{ promptId: 'knowledge-plan', version: 1 }],
    dailyUsage: [],
    receipts: [],
    stateEvents: [],
    updatedAt: '2026-08-24T08:00:00.000Z',
  };
}

describe('KnowledgeService', () => {
  it('traverses cycles safely, filters unauthorized entries, and explains deterministic scores', async () => {
    const { contentRepository, content } = await createHarness();
    const service = new KnowledgeService({
      repository: new InMemoryKnowledgeRepository(),
      contentRepository,
      contentService: content,
      schemas: [schema],
      aiGateway: { snapshot: () => gateway() },
    });
    const graph = await service.exploreGraph({
      scope,
      query: { seedEntryIds: ['page-a'], maximumDepth: 3 },
      authorizer: { canRead: (entry) => entry.id !== 'page-c' },
    });
    expect(graph.nodes.some((node) => node.id === 'page-c')).toBe(false);
    expect(graph.nodes.some((node) => node.id === 'page-b')).toBe(true);
    expect(graph.paths.every((path) => new Set(path.nodeIds).size === path.nodeIds.length)).toBe(
      true,
    );

    const recommendations = await service.recommend({
      scope,
      query: { entryId: 'page-a', first: 10 },
    });
    const pageB = recommendations.recommendations.find((item) => item.entry.id === 'page-b');
    expect(pageB?.score).toBe(
      pageB?.contributions.reduce((total, contribution) => total + contribution.weight, 0),
    );
    expect(pageB?.contributions.map((item) => item.ruleId)).toEqual(
      expect.arrayContaining(['direct-relation', 'shared-taxonomy', 'same-content-type']),
    );
  });

  it('redacts the goal, mediates reads, and requires human review before idempotent draft execution', async () => {
    const { contentRepository, content, a } = await createHarness();
    let observedGoal = '';
    const runtime: KnowledgeAgentRuntimeAdapter = {
      id: 'runtime-a',
      modelId: 'small',
      async run(input) {
        observedGoal = input.goal;
        await input.invokeTool({
          id: 'call-a',
          tool: 'content.get',
          input: { entryId: 'page-a', fieldPaths: ['title'] },
        });
        return {
          contract: 'gridstory.agent-draft-plan.v1',
          summary: 'Use a clearer title.',
          targetEntryId: input.target.id,
          expectedDraftRevisionId: input.target.revisionId,
          changes: [{ fieldPath: 'title', value: 'Reviewed title', rationale: 'Clearer.' }],
        };
      },
    };
    const service = new KnowledgeService({
      repository: new InMemoryKnowledgeRepository(),
      contentRepository,
      contentService: content,
      schemas: [schema],
      aiGateway: { snapshot: () => gateway() },
      runtimes: [runtime],
      now: () => new Date('2026-08-24T08:05:00.000Z'),
      createId: () => 'deterministic-id',
    });
    const policy = await service.updatePolicy(
      scope,
      {
        expectedVersion: 0,
        policy: {
          enabled: true,
          adapterId: 'runtime-a',
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
      actor.id,
    );
    const planned = await service.createPlan({
      scope,
      request: {
        expectedVersion: policy.version,
        targetEntryId: a.id,
        goal: 'Improve person@example.test title.',
      },
      actorId: actor.id,
      authorizer: { canRead: () => true },
    });
    const plan = planned.plans[0];
    expect(observedGoal).not.toContain('person@example.test');
    expect(plan?.toolTrace[0]).not.toHaveProperty('output');
    if (!plan) throw new Error('Expected a planned operation.');
    const reviewed = await service.reviewPlan({
      scope,
      planId: plan.id,
      review: {
        expectedVersion: planned.version,
        digest: plan.digest,
        decision: 'approved',
        reason: 'Human reviewed.',
      },
      actorId: 'reviewer-a',
      principalType: 'user',
    });
    const execution = {
      expectedVersion: reviewed.version,
      digest: plan.digest,
      idempotencyKey: 'execution-a',
    };
    const receipt = await service.executePlan({
      scope,
      planId: plan.id,
      execution,
      actor,
      principalType: 'user',
    });
    expect((await content.get({ scope, id: a.id, perspective: 'draft' })).data.title).toBe(
      'Reviewed title',
    );
    expect(
      await service.executePlan({
        scope,
        planId: plan.id,
        execution,
        actor,
        principalType: 'user',
      }),
    ).toEqual(receipt);
  });

  it.each(['disabled', 'expired'] as const)(
    'revalidates a %s policy before resuming a pending mutation',
    async (mode) => {
      const { contentRepository, content, a } = await createHarness();
      const knowledgeRepository = new InMemoryKnowledgeRepository();
      let now = new Date('2026-08-24T08:05:00.000Z');
      const runtime: KnowledgeAgentRuntimeAdapter = {
        id: 'runtime-a',
        modelId: 'small',
        run(input) {
          return {
            contract: 'gridstory.agent-draft-plan.v1',
            summary: 'Use a clearer title.',
            targetEntryId: input.target.id,
            expectedDraftRevisionId: input.target.revisionId,
            changes: [{ fieldPath: 'title', value: 'Reviewed title', rationale: 'Clearer.' }],
          };
        },
      };
      const service = new KnowledgeService({
        repository: knowledgeRepository,
        contentRepository,
        contentService: content,
        schemas: [schema],
        aiGateway: { snapshot: () => gateway() },
        runtimes: [runtime],
        now: () => now,
        createId: () => 'recovery-id',
      });
      const policy = await service.updatePolicy(
        scope,
        {
          expectedVersion: 0,
          policy: {
            enabled: true,
            adapterId: 'runtime-a',
            modelId: 'small',
            promptId: 'knowledge-plan',
            promptVersion: 1,
            fieldRules: [{ contentType: 'page', fieldPaths: ['title'] }],
            tools: ['content.get'],
            maximumToolCalls: 1,
            timeoutMs: 1_000,
            planLifetimeSeconds: 300,
          },
        },
        actor.id,
      );
      const planned = await service.createPlan({
        scope,
        request: {
          expectedVersion: policy.version,
          targetEntryId: a.id,
          goal: 'Improve the title.',
        },
        actorId: actor.id,
        authorizer: { canRead: () => true },
      });
      const plan = planned.plans[0];
      if (!plan) throw new Error('Expected a planned operation.');
      const reviewed = await service.reviewPlan({
        scope,
        planId: plan.id,
        review: {
          expectedVersion: planned.version,
          digest: plan.digest,
          decision: 'approved',
        },
        actorId: 'reviewer-a',
        principalType: 'user',
      });
      const pending = {
        ...reviewed,
        version: reviewed.version + 1,
        policy: mode === 'disabled' ? ({ enabled: false } as const) : reviewed.policy,
        plans: reviewed.plans.map((candidate) =>
          candidate.id === plan.id
            ? {
                ...candidate,
                status: 'executing' as const,
                execution: {
                  state: 'pending' as const,
                  idempotencyKey: 'recovery-execution',
                  actorId: actor.id,
                  startedAt: now.toISOString(),
                },
              }
            : candidate,
        ),
        updatedAt: now.toISOString(),
        updatedBy: actor.id,
      };
      await knowledgeRepository.save(pending, reviewed.version);
      if (mode === 'expired') now = new Date('2026-08-24T08:11:00.000Z');

      await expect(
        service.executePlan({
          scope,
          planId: plan.id,
          execution: {
            expectedVersion: pending.version,
            digest: plan.digest,
            idempotencyKey: 'recovery-execution',
          },
          actor,
          principalType: 'user',
        }),
      ).rejects.toMatchObject({
        code:
          mode === 'disabled' ? 'knowledge_agent_policy_changed' : 'knowledge_agent_plan_expired',
      });
      expect((await content.get({ scope, id: a.id, perspective: 'draft' })).data.title).toBe(
        'Original contact person@example.test',
      );
    },
  );
});
