import type {
  AiGenerateInput,
  AiProviderRequest,
  ContentSchemaDefinition,
  ContentScope,
} from '@gridstory/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AiAuthoringService,
  AiGatewayService,
  type AiProviderAdapter,
  type AiSemanticAdapter,
  type AiSemanticAdapterResult,
  ContentService,
  InMemoryAiAuthoringRepository,
  InMemoryAiGatewayRepository,
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
  fields: [
    {
      id: 'page.title',
      name: 'title',
      label: 'Title',
      type: 'text',
      required: true,
      maxLength: 80,
    },
    {
      id: 'page.slug',
      name: 'slug',
      label: 'Slug',
      type: 'slug',
      required: true,
      pattern: '^[a-z0-9-]+$',
    },
    { id: 'page.private', name: 'privateNotes', label: 'Private', type: 'text', required: false },
  ],
};
const generateRequest: AiGenerateInput = {
  requestId: '018daf23-89b3-7cf8-a4f1-94064c96df90',
  promptId: 'title',
  providerId: 'test-provider',
  modelId: 'small',
  input: 'Suggest a better title.',
  sourceIds: ['page-a'],
};

interface Harness {
  contentRepository: SqliteContentRepository;
  content: ContentService;
  authoring: AiAuthoringService;
  semantic: TestSemanticAdapter;
  capturedProviderRequests: AiProviderRequest[];
  setOutput(value: string, finishReason?: 'stop' | 'length' | 'content-filter' | 'unknown'): void;
}

class TestSemanticAdapter implements AiSemanticAdapter {
  readonly id = 'semantic-test';
  readonly modelId = 'embedding-small';
  documents: Array<{ fields: Array<{ path: string; value: string }> }> = [];
  query = '';
  result: AiSemanticAdapterResult = {
    ...scope,
    adapterId: this.id,
    modelId: this.modelId,
    indexVersion: 'index-1',
    perspective: 'draft',
    hits: [],
  };

  upsert(input: Parameters<AiSemanticAdapter['upsert']>[0]) {
    if (input.document) this.documents = [structuredClone(input.document)];
    return {
      ...input.scope,
      adapterId: this.id,
      modelId: this.modelId,
      indexVersion: 'index-1',
      perspective: input.perspective,
      indexedDocuments: input.document ? 1 : 0,
    };
  }

  rebuild(input: Parameters<AiSemanticAdapter['rebuild']>[0]) {
    this.documents = structuredClone(input.documents);
    return {
      ...input.scope,
      adapterId: this.id,
      modelId: this.modelId,
      indexVersion: 'index-1',
      perspective: input.perspective,
      indexedDocuments: input.documents.length,
    };
  }

  search(input: Parameters<AiSemanticAdapter['search']>[0]) {
    this.query = input.query;
    return structuredClone(this.result);
  }
}

const openRepositories: SqliteContentRepository[] = [];

async function harness(): Promise<Harness> {
  let output = JSON.stringify({
    contract: 'gridstory.authoring-suggestions.v1',
    suggestions: [{ fieldPath: 'title', value: 'A reviewed title', rationale: 'Concise.' }],
  });
  let finishReason: 'stop' | 'length' | 'content-filter' | 'unknown' = 'stop';
  const capturedProviderRequests: AiProviderRequest[] = [];
  const provider: AiProviderAdapter = {
    id: 'test-provider',
    estimate(request) {
      capturedProviderRequests.push(request);
      return { inputTokens: 20, outputTokens: 20, costMicros: 20 };
    },
    generate() {
      return {
        output,
        inputTokens: 20,
        outputTokens: 20,
        costMicros: 20,
        finishReason,
      };
    },
  };
  const gateway = new AiGatewayService({
    repository: new InMemoryAiGatewayRepository(),
    providers: [provider],
    clock: () => new Date('2026-08-24T08:00:00.000Z'),
  });
  await gateway.updatePolicy(scope, {
    expectedVersion: 0,
    models: [
      {
        providerId: 'test-provider',
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
  });
  await gateway.createPromptVersion(
    scope,
    {
      expectedVersion: 1,
      promptId: 'title',
      version: 1,
      name: 'Title',
      purpose: 'Suggest a title.',
      instructions: 'Return the fixed GridStory authoring contract.',
      allowedModels: [{ providerId: 'test-provider', modelId: 'small' }],
      maximumOutputTokens: 100,
      maximumCostMicros: 100,
      timeoutMs: 1_000,
      retrieval: {
        perspective: 'draft',
        maximumSources: 1,
        rules: [{ contentType: 'page', fieldPaths: ['title'] }],
      },
    },
    'publisher-a',
  );
  await gateway.activatePrompt(scope, 'title', 1, 2);
  await gateway.setState(
    scope,
    { expectedVersion: 3, state: 'enabled', reason: 'Focused authoring test.' },
    'publisher-a',
  );
  const contentRepository = new SqliteContentRepository({ filename: ':memory:' });
  openRepositories.push(contentRepository);
  const content = new ContentService({
    repository: contentRepository,
    schemas: [schema],
    componentManifests: [],
  });
  const semantic = new TestSemanticAdapter();
  const ids = [
    '018daf23-89b3-7cf8-a4f1-94064c96df91',
    '018daf23-89b3-7cf8-a4f1-94064c96df92',
    '018daf23-89b3-7cf8-a4f1-94064c96df93',
  ];
  const authoring = new AiAuthoringService({
    repository: new InMemoryAiAuthoringRepository(),
    gateway,
    content,
    semanticAdapters: [semantic],
    clock: () => new Date('2026-08-24T08:01:00.000Z'),
    createId: () => ids.shift() ?? '018daf23-89b3-7cf8-a4f1-94064c96dfff',
  });
  return {
    contentRepository,
    content,
    authoring,
    semantic,
    capturedProviderRequests,
    setOutput(value, reason = 'stop') {
      output = value;
      finishReason = reason;
    },
  };
}

async function createPage(content: ContentService) {
  return content.create({
    scope,
    id: 'page-a',
    contentType: 'page',
    data: {
      title: 'Original person@example.test',
      slug: 'original',
      privateNotes: 'api_key=never-index-this',
    },
    actor: { id: 'author-a' },
  });
}

async function enableAuthoring(authoring: AiAuthoringService, semantic = false) {
  return authoring.updatePolicy(scope, {
    expectedVersion: 0,
    state: 'enabled',
    actions: semantic
      ? []
      : [
          {
            id: 'title-action',
            name: 'Title action',
            enabled: true,
            promptId: 'title',
            contentType: 'page',
            targetFields: ['title'],
            maximumChanges: 1,
            evaluationRules: [
              {
                id: 'forbidden-term',
                fieldPath: 'title',
                kind: 'forbidden-term',
                term: 'unsafe',
              },
            ],
          },
        ],
    semantic: semantic
      ? {
          enabled: true,
          adapterId: 'semantic-test',
          modelId: 'embedding-small',
          perspectives: ['draft'],
          maximumResults: 10,
          minimumScore: 0,
          rules: [{ contentType: 'page', fieldPaths: ['title', 'slug'] }],
        }
      : { enabled: false },
  });
}

function sourceReader(content: ContentService) {
  return {
    async read({ id, perspective }: { id: string; perspective: 'draft' | 'published' }) {
      const entry = await content.get({ scope, id, perspective });
      return {
        ...scope,
        id,
        contentType: entry.contentType,
        revisionId: entry.draftRevisionId,
        data: entry.data,
      };
    },
  };
}

afterEach(async () => {
  await Promise.all(openRepositories.splice(0).map((repository) => repository.close()));
});

describe('AiAuthoringService', () => {
  it('creates evaluated provenance, requires human review, and never writes approved values', async () => {
    const test = await harness();
    const page = await createPage(test.content);
    await enableAuthoring(test.authoring);
    const proposed = await test.authoring.createProposal({
      scope,
      actorId: 'author-a',
      proposal: {
        actionId: 'title-action',
        targetEntryId: page.id,
        expectedDraftRevisionId: page.draftRevisionId,
        request: generateRequest,
      },
      sourceReader: sourceReader(test.content),
    });

    expect(test.capturedProviderRequests[0]?.outputContract).toBe(
      'gridstory.authoring-suggestions.v1',
    );
    expect(proposed.proposals[0]).toMatchObject({
      status: 'pending-review',
      target: { entryId: 'page-a', revisionId: page.draftRevisionId },
      changes: [{ fieldPath: 'title', value: 'A reviewed title' }],
      evaluation: { outcome: 'passed' },
      provenance: { promptId: 'title', promptVersion: 1, actorId: 'author-a' },
    });
    await expect(
      test.authoring.reviewProposal({
        scope,
        proposalId: proposed.proposals[0]?.id ?? '',
        actorId: 'automation-a',
        principalType: 'service-account',
        review: { expectedVersion: proposed.version, decision: 'approved' },
      }),
    ).rejects.toMatchObject({ code: 'ai_authoring_human_review_required' });
    const reviewed = await test.authoring.reviewProposal({
      scope,
      proposalId: proposed.proposals[0]?.id ?? '',
      actorId: 'publisher-a',
      principalType: 'user',
      review: { expectedVersion: proposed.version, decision: 'approved', reason: 'Reviewed.' },
    });
    expect(reviewed.proposals[0]).toMatchObject({
      status: 'approved',
      reviews: [{ actorId: 'publisher-a' }],
    });
    expect((await test.content.get({ scope, id: page.id })).data.title).toBe(
      'Original person@example.test',
    );
  });

  it('fails malformed output closed and keeps failed evaluation non-approvable', async () => {
    const test = await harness();
    const page = await createPage(test.content);
    await enableAuthoring(test.authoring);
    test.setOutput('{"suggestions":');
    await expect(
      test.authoring.createProposal({
        scope,
        actorId: 'author-a',
        proposal: {
          actionId: 'title-action',
          targetEntryId: page.id,
          expectedDraftRevisionId: page.draftRevisionId,
          request: generateRequest,
        },
        sourceReader: sourceReader(test.content),
      }),
    ).rejects.toMatchObject({ code: 'ai_authoring_output_invalid' });
    expect(JSON.stringify(await test.authoring.snapshot(scope))).not.toContain('suggestions');

    test.setOutput(
      JSON.stringify({
        contract: 'gridstory.authoring-suggestions.v1',
        suggestions: [{ fieldPath: 'title', value: 'Unsafe title' }],
      }),
    );
    const failed = await test.authoring.createProposal({
      scope,
      actorId: 'author-a',
      proposal: {
        actionId: 'title-action',
        targetEntryId: page.id,
        expectedDraftRevisionId: page.draftRevisionId,
        request: { ...generateRequest, requestId: '018daf23-89b3-7cf8-a4f1-94064c96df94' },
      },
      sourceReader: sourceReader(test.content),
    });
    expect(failed.proposals[0]).toMatchObject({
      status: 'evaluation-failed',
      evaluation: { outcome: 'failed' },
      changes: [],
    });
    expect(failed.proposals[0]?.action.evaluationRules).toEqual([
      {
        id: 'forbidden-term',
        fieldPath: 'title',
        kind: 'forbidden-term',
        term: 'unsafe',
      },
    ]);
    expect(JSON.stringify(failed)).not.toContain('Unsafe title');
    await expect(
      test.authoring.reviewProposal({
        scope,
        proposalId: failed.proposals[0]?.id ?? '',
        actorId: 'publisher-a',
        principalType: 'user',
        review: { expectedVersion: failed.version, decision: 'approved' },
      }),
    ).rejects.toMatchObject({ code: 'ai_authoring_proposal_not_reviewable' });
    const replacedPolicy = await test.authoring.updatePolicy(scope, {
      expectedVersion: failed.version,
      state: 'enabled',
      actions: [
        {
          id: 'title-action',
          name: 'Changed title action',
          enabled: true,
          promptId: 'title',
          contentType: 'page',
          targetFields: ['title'],
          maximumChanges: 1,
          evaluationRules: [],
        },
      ],
      semantic: { enabled: false },
    });
    expect(replacedPolicy.proposals[0]?.action.evaluationRules).toEqual([
      {
        id: 'forbidden-term',
        fieldPath: 'title',
        kind: 'forbidden-term',
        term: 'unsafe',
      },
    ]);
  });

  it('marks a proposal stale instead of approving against a changed draft', async () => {
    const test = await harness();
    const page = await createPage(test.content);
    await enableAuthoring(test.authoring);
    const proposed = await test.authoring.createProposal({
      scope,
      actorId: 'author-a',
      proposal: {
        actionId: 'title-action',
        targetEntryId: page.id,
        expectedDraftRevisionId: page.draftRevisionId,
        request: generateRequest,
      },
      sourceReader: sourceReader(test.content),
    });
    await test.content.updateDraft({
      scope,
      id: page.id,
      expectedRevisionId: page.draftRevisionId,
      data: { ...page.data, title: 'Concurrent title' },
      actor: { id: 'author-b' },
    });
    const reviewed = await test.authoring.reviewProposal({
      scope,
      proposalId: proposed.proposals[0]?.id ?? '',
      actorId: 'publisher-a',
      principalType: 'user',
      review: { expectedVersion: proposed.version, decision: 'approved' },
    });
    expect(reviewed.proposals[0]?.status).toBe('stale');
    expect(reviewed.proposals[0]?.reviews).toEqual([]);
  });

  it('indexes only allowlisted redacted fields and rejects hostile or stale semantic hits', async () => {
    const test = await harness();
    const page = await createPage(test.content);
    await enableAuthoring(test.authoring, true);
    await test.authoring.processSearchJob({
      scope,
      type: 'search.rebuild',
      payload: { perspective: 'draft' },
    });
    expect(test.semantic.documents[0]?.fields).toEqual([
      { path: 'title', value: 'Original [REDACTED_EMAIL]' },
      { path: 'slug', value: 'original' },
    ]);
    expect(JSON.stringify(test.semantic.documents)).not.toContain('never-index-this');
    test.semantic.result = {
      ...scope,
      adapterId: test.semantic.id,
      modelId: test.semantic.modelId,
      indexVersion: 'index-1',
      perspective: 'draft',
      hits: [
        {
          ...scope,
          entryId: page.id,
          contentType: page.contentType,
          perspective: 'draft',
          revisionId: page.draftRevisionId,
          score: 0.9,
          fieldPaths: ['title'],
        },
      ],
    };
    const result = await test.authoring.semanticSearch({
      scope,
      query: { text: 'person@example.test', perspective: 'draft', first: 5 },
      authorizer: { authorize() {} },
    });
    expect(test.semantic.query).toBe('[REDACTED_EMAIL]');
    expect(result.hits[0]).toMatchObject({ entryId: page.id, score: 0.9, fieldPaths: ['title'] });

    const validHit = test.semantic.result.hits[0];
    if (!validHit) throw new Error('Expected semantic hit fixture.');
    test.semantic.result.hits = [{ ...validHit, tenantId: 'tenant-b' }];
    await expect(
      test.authoring.semanticSearch({
        scope,
        query: { text: 'title', perspective: 'draft', first: 5 },
        authorizer: { authorize() {} },
      }),
    ).rejects.toMatchObject({ code: 'ai_semantic_result_invalid' });
    test.semantic.result.hits = [{ ...validHit, revisionId: 'stale-revision' }];
    await expect(
      test.authoring.semanticSearch({
        scope,
        query: { text: 'title', perspective: 'draft', first: 5 },
        authorizer: { authorize() {} },
      }),
    ).rejects.toMatchObject({ code: 'ai_semantic_result_stale' });
  });
});
