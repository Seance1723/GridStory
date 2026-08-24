import {
  aiAuthoringDocumentSchema,
  aiAuthoringPolicyInputSchema,
  aiAuthoringProviderOutputSchema,
  aiAuthoringReviewInputSchema,
  aiSemanticQuerySchema,
  aiSemanticSearchResponseSchema,
  resourceLimits,
  type AiAuthoringAction,
  type AiAuthoringDocument,
  type AiAuthoringPolicyInput,
  type AiAuthoringProposal,
  type AiAuthoringProposalInput,
  type AiAuthoringReviewInput,
  type AiSemanticPolicy,
  type AiSemanticQuery,
  type AiSemanticSearchResponse,
  type ContentEntry,
  type ContentPerspective,
  type ContentScope,
} from '@gridstory/schema';
import type { AiAuthoringRepository } from './ai-authoring-repository.js';
import { emptyAiAuthoringDocument } from './ai-authoring-repository.js';
import { redactAiText, type AiGatewayService, type AiSourceReader } from './ai-gateway-service.js';
import type { ContentService } from './content-service.js';
import { GridStoryError } from './errors.js';
import { assertSameContentScope, contentScopeKey } from './tenant-scope.js';
import type { Awaitable } from './types.js';

export interface AiSemanticIndexDocument extends ContentScope {
  entryId: string;
  contentType: string;
  perspective: ContentPerspective;
  revisionId: string;
  fields: Array<{ path: string; value: string }>;
}

export interface AiSemanticAdapterHit extends ContentScope {
  entryId: string;
  contentType: string;
  perspective: ContentPerspective;
  revisionId: string;
  score: number;
  fieldPaths: string[];
}

export interface AiSemanticAdapterResult extends ContentScope {
  adapterId: string;
  modelId: string;
  indexVersion: string;
  perspective: ContentPerspective;
  hits: AiSemanticAdapterHit[];
}

export interface AiSemanticAdapterIndexResult extends ContentScope {
  adapterId: string;
  modelId: string;
  indexVersion: string;
  perspective: ContentPerspective;
  indexedDocuments: number;
}

export interface AiSemanticAdapter {
  readonly id: string;
  readonly modelId: string;
  upsert(input: {
    scope: ContentScope;
    perspective: ContentPerspective;
    entryId: string;
    document: AiSemanticIndexDocument | null;
  }): Awaitable<AiSemanticAdapterIndexResult>;
  rebuild(input: {
    scope: ContentScope;
    perspective: ContentPerspective;
    documents: AiSemanticIndexDocument[];
  }): Awaitable<AiSemanticAdapterIndexResult>;
  search(input: {
    scope: ContentScope;
    perspective: ContentPerspective;
    query: string;
    first: number;
  }): Awaitable<AiSemanticAdapterResult>;
}

export interface AiSemanticHitAuthorizer {
  authorize(entry: ContentEntry): Awaitable<void>;
}

function authoringError(message: string, code: string, statusCode: number): GridStoryError {
  return new GridStoryError(message, code, statusCode);
}

function sameAction(left: AiAuthoringAction, right: AiAuthoringAction): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function activeSemanticPolicy(
  document: AiAuthoringDocument,
  perspective?: ContentPerspective,
): Extract<AiSemanticPolicy, { enabled: true }> {
  if (document.state !== 'enabled' || !document.semantic.enabled) {
    throw authoringError('AI semantic search is disabled.', 'ai_semantic_disabled', 503);
  }
  if (perspective && !document.semantic.perspectives.includes(perspective)) {
    throw authoringError(
      'That content perspective is not enabled for semantic search.',
      'ai_semantic_perspective_denied',
      403,
    );
  }
  return document.semantic;
}

function semanticRevision(
  entry: ContentEntry,
  perspective: ContentPerspective,
): string | undefined {
  return perspective === 'published' ? entry.publishedRevisionId : entry.draftRevisionId;
}

function evaluationMessage(
  rule: AiAuthoringAction['evaluationRules'][number],
  passed: boolean,
): string {
  const result = passed ? 'passed' : 'failed';
  switch (rule.kind) {
    case 'minimum-length':
      return `${rule.fieldPath} ${result} minimum length ${rule.minimum}.`;
    case 'maximum-length':
      return `${rule.fieldPath} ${result} maximum length ${rule.maximum}.`;
    case 'required-term':
      return `${rule.fieldPath} ${result} required-term evaluation.`;
    case 'forbidden-term':
      return `${rule.fieldPath} ${result} forbidden-term evaluation.`;
  }
}

export class AiAuthoringService {
  readonly #repository: AiAuthoringRepository;
  readonly #gateway: AiGatewayService;
  readonly #content: ContentService;
  readonly #semanticAdapters: ReadonlyMap<string, AiSemanticAdapter>;
  readonly #clock: () => Date;
  readonly #createId: () => string;

  constructor(options: {
    repository: AiAuthoringRepository;
    gateway: AiGatewayService;
    content: ContentService;
    semanticAdapters?: AiSemanticAdapter[];
    clock?: () => Date;
    createId?: () => string;
  }) {
    this.#repository = options.repository;
    this.#gateway = options.gateway;
    this.#content = options.content;
    const adapters = options.semanticAdapters ?? [];
    if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length) {
      throw new Error('AI semantic adapter IDs must be unique.');
    }
    this.#semanticAdapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    this.#clock = options.clock ?? (() => new Date());
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  async snapshot(scope: ContentScope): Promise<AiAuthoringDocument> {
    return (await this.#repository.get(scope)) ?? emptyAiAuthoringDocument(scope);
  }

  async #replace(
    scope: ContentScope,
    expectedVersion: number,
    change: (document: AiAuthoringDocument) => AiAuthoringDocument,
  ): Promise<AiAuthoringDocument> {
    const stored = await this.#repository.get(scope);
    const current = stored ?? emptyAiAuthoringDocument(scope);
    if (current.version !== expectedVersion) {
      throw authoringError(
        'AI authoring policy changed during this operation.',
        'ai_authoring_write_conflict',
        409,
      );
    }
    const timestamp = this.#clock().toISOString();
    const changed = change(current);
    const next = aiAuthoringDocumentSchema.parse({
      ...changed,
      version: current.version + 1,
      updatedAt: timestamp,
    });
    await this.#repository.save(next, stored ? current.version : null);
    return next;
  }

  async #mutate(
    scope: ContentScope,
    change: (document: AiAuthoringDocument) => AiAuthoringDocument,
  ): Promise<AiAuthoringDocument> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.snapshot(scope);
      try {
        return await this.#replace(scope, current.version, change);
      } catch (error) {
        if (!(error instanceof GridStoryError) || error.code !== 'ai_authoring_write_conflict') {
          throw error;
        }
      }
    }
    throw authoringError(
      'AI authoring policy remained busy during this operation.',
      'ai_authoring_write_conflict',
      409,
    );
  }

  #allowedField(contentType: string, path: string): boolean {
    const schema = this.#content.getSchemas().find((candidate) => candidate.id === contentType);
    const field = schema?.fields.find((candidate) => candidate.name === path);
    return field?.type === 'text' || field?.type === 'slug';
  }

  async updatePolicy(
    scope: ContentScope,
    rawInput: AiAuthoringPolicyInput,
  ): Promise<AiAuthoringDocument> {
    const input = aiAuthoringPolicyInputSchema.parse(rawInput);
    const gateway = await this.#gateway.snapshot(scope);
    for (const action of input.actions) {
      if (!gateway.promptVersions.some((prompt) => prompt.promptId === action.promptId)) {
        throw authoringError(
          'An AI authoring action references an unknown prompt.',
          'invalid_ai_authoring_policy',
          400,
        );
      }
      for (const path of action.targetFields) {
        if (!this.#allowedField(action.contentType, path)) {
          throw authoringError(
            'AI authoring actions may target only declared top-level text or slug fields.',
            'invalid_ai_authoring_policy',
            400,
          );
        }
      }
    }
    if (input.semantic.enabled) {
      const adapter = this.#semanticAdapters.get(input.semantic.adapterId);
      if (!adapter || adapter.modelId !== input.semantic.modelId) {
        throw authoringError(
          'The configured AI semantic adapter is unavailable.',
          'ai_semantic_adapter_unavailable',
          503,
        );
      }
      for (const rule of input.semantic.rules) {
        for (const path of rule.fieldPaths) {
          if (!this.#allowedField(rule.contentType, path)) {
            throw authoringError(
              'Semantic indexes may contain only declared top-level text or slug fields.',
              'invalid_ai_authoring_policy',
              400,
            );
          }
        }
      }
    }
    if (
      input.state === 'enabled' &&
      !input.actions.some((action) => action.enabled) &&
      !input.semantic.enabled
    ) {
      throw authoringError(
        'Enable at least one AI authoring action or semantic policy.',
        'invalid_ai_authoring_policy',
        400,
      );
    }
    return this.#replace(scope, input.expectedVersion, (document) => ({
      ...document,
      state: input.state,
      actions: structuredClone(input.actions),
      semantic: structuredClone(input.semantic),
    }));
  }

  async createProposal(input: {
    scope: ContentScope;
    actorId: string;
    proposal: AiAuthoringProposalInput;
    sourceReader: AiSourceReader;
  }): Promise<AiAuthoringDocument> {
    const initial = await this.snapshot(input.scope);
    if (initial.state !== 'enabled') {
      throw authoringError('AI authoring is disabled.', 'ai_authoring_disabled', 503);
    }
    const action = initial.actions.find(
      (candidate) => candidate.id === input.proposal.actionId && candidate.enabled,
    );
    if (!action) {
      throw authoringError(
        'The AI authoring action is unavailable.',
        'ai_authoring_action_unavailable',
        404,
      );
    }
    if (input.proposal.request.promptId !== action.promptId) {
      throw authoringError(
        'The AI request prompt does not match the authoring action.',
        'ai_authoring_prompt_mismatch',
        400,
      );
    }
    const target = await this.#content.get({
      scope: input.scope,
      id: input.proposal.targetEntryId,
      perspective: 'draft',
    });
    assertSameContentScope(input.scope, target, 'AI authoring target');
    if (
      target.contentType !== action.contentType ||
      target.draftRevisionId !== input.proposal.expectedDraftRevisionId
    ) {
      throw authoringError(
        'The AI authoring target changed or is not allowed by this action.',
        'ai_authoring_target_stale',
        409,
      );
    }
    const generated = await this.#gateway.execute({
      scope: input.scope,
      request: input.proposal.request,
      sourceReader: input.sourceReader,
      outputContract: 'gridstory.authoring-suggestions.v1',
    });
    if (generated.finishReason !== 'stop') {
      throw authoringError(
        'The AI provider did not return a complete authoring result.',
        'ai_authoring_output_incomplete',
        422,
      );
    }
    let output: ReturnType<typeof aiAuthoringProviderOutputSchema.parse>;
    try {
      output = aiAuthoringProviderOutputSchema.parse(JSON.parse(generated.output));
    } catch {
      throw authoringError(
        'The AI provider returned an invalid authoring result.',
        'ai_authoring_output_invalid',
        422,
      );
    }
    if (
      output.suggestions.length > action.maximumChanges ||
      output.suggestions.some((change) => !action.targetFields.includes(change.fieldPath))
    ) {
      throw authoringError(
        'The AI provider returned changes outside the action contract.',
        'ai_authoring_output_disallowed',
        422,
      );
    }
    const candidate = structuredClone(target.data);
    output.suggestions.forEach((change) => {
      candidate[change.fieldPath] = change.value;
    });
    const results: AiAuthoringProposal['evaluation']['results'] = [];
    try {
      await this.#content.validateCandidate({
        scope: input.scope,
        contentType: target.contentType,
        data: candidate,
      });
      results.push({
        ruleId: 'gridstory:content-schema',
        fieldPath: 'document',
        kind: 'content-schema',
        outcome: 'passed',
        message: 'The complete candidate passed the content schema.',
      });
    } catch {
      results.push({
        ruleId: 'gridstory:content-schema',
        fieldPath: 'document',
        kind: 'content-schema',
        outcome: 'failed',
        message: 'The complete candidate failed the content schema.',
      });
    }
    for (const rule of action.evaluationRules) {
      const candidateValue = candidate[rule.fieldPath];
      const value = typeof candidateValue === 'string' ? candidateValue : '';
      const normalized = value.toLocaleLowerCase('en-US').normalize('NFKC');
      let passed: boolean;
      switch (rule.kind) {
        case 'minimum-length':
          passed = value.length >= rule.minimum;
          break;
        case 'maximum-length':
          passed = value.length <= rule.maximum;
          break;
        case 'required-term':
          passed = normalized.includes(rule.term.toLocaleLowerCase('en-US').normalize('NFKC'));
          break;
        case 'forbidden-term':
          passed = !normalized.includes(rule.term.toLocaleLowerCase('en-US').normalize('NFKC'));
          break;
      }
      results.push({
        ruleId: rule.id,
        fieldPath: rule.fieldPath,
        kind: rule.kind,
        outcome: passed ? 'passed' : 'failed',
        message: evaluationMessage(rule, passed),
      });
    }
    const passed = results.every((result) => result.outcome === 'passed');
    const proposal: AiAuthoringProposal = {
      id: this.#createId(),
      status: passed ? 'pending-review' : 'evaluation-failed',
      action: { ...structuredClone(action), documentVersion: initial.version },
      target: {
        entryId: target.id,
        contentType: target.contentType,
        revisionId: target.draftRevisionId,
      },
      changes: passed ? structuredClone(output.suggestions) : [],
      evaluation: { outcome: passed ? 'passed' : 'failed', results },
      provenance: {
        requestId: generated.requestId,
        outputContract: 'gridstory.authoring-suggestions.v1',
        promptId: generated.promptId,
        promptVersion: generated.promptVersion,
        providerId: generated.providerId,
        modelId: generated.modelId,
        sources: structuredClone(generated.sources),
        usage: structuredClone(generated.usage),
        redactions: structuredClone(generated.redactions),
        finishReason: generated.finishReason,
        actorId: input.actorId,
        createdAt: this.#clock().toISOString(),
      },
      reviews: [],
    };
    return this.#mutate(input.scope, (document) => {
      if (document.state !== 'enabled') {
        throw authoringError(
          'AI authoring was disabled while the request was running.',
          'ai_authoring_disabled_during_request',
          503,
        );
      }
      const currentAction = document.actions.find((candidate) => candidate.id === action.id);
      if (!currentAction?.enabled || !sameAction(currentAction, action)) {
        throw authoringError(
          'The AI authoring action changed while the request was running.',
          'ai_authoring_action_changed',
          409,
        );
      }
      if (
        document.proposals.some(
          (candidate) => candidate.provenance.requestId === generated.requestId,
        )
      ) {
        throw authoringError(
          'That AI proposal already exists.',
          'ai_authoring_proposal_duplicate',
          409,
        );
      }
      return {
        ...document,
        proposals: [...document.proposals, proposal].slice(
          -resourceLimits.aiAuthoring.maximumProposals,
        ),
      };
    });
  }

  async reviewProposal(input: {
    scope: ContentScope;
    proposalId: string;
    actorId: string;
    principalType: 'user' | 'service-account' | 'anonymous';
    review: AiAuthoringReviewInput;
  }): Promise<AiAuthoringDocument> {
    if (input.principalType !== 'user') {
      throw authoringError(
        'AI authoring review requires a human user principal.',
        'ai_authoring_human_review_required',
        403,
      );
    }
    const review = aiAuthoringReviewInputSchema.parse(input.review);
    const current = await this.snapshot(input.scope);
    if (current.version !== review.expectedVersion) {
      throw authoringError(
        'AI authoring policy changed during this operation.',
        'ai_authoring_write_conflict',
        409,
      );
    }
    const proposal = current.proposals.find((candidate) => candidate.id === input.proposalId);
    if (!proposal) {
      throw authoringError(
        'The AI authoring proposal was not found.',
        'ai_authoring_proposal_not_found',
        404,
      );
    }
    if (proposal.status !== 'pending-review' || proposal.evaluation.outcome !== 'passed') {
      throw authoringError(
        'That AI authoring proposal cannot be reviewed.',
        'ai_authoring_proposal_not_reviewable',
        409,
      );
    }
    if (review.decision === 'approved') {
      const target = await this.#content.get({
        scope: input.scope,
        id: proposal.target.entryId,
        perspective: 'draft',
      });
      assertSameContentScope(input.scope, target, 'AI authoring review target');
      if (
        target.contentType !== proposal.target.contentType ||
        target.draftRevisionId !== proposal.target.revisionId
      ) {
        return this.#replace(input.scope, review.expectedVersion, (document) => ({
          ...document,
          proposals: document.proposals.map((candidate) =>
            candidate.id === proposal.id ? { ...candidate, status: 'stale' as const } : candidate,
          ),
        }));
      }
    }
    return this.#replace(input.scope, review.expectedVersion, (document) => ({
      ...document,
      proposals: document.proposals.map((candidate) =>
        candidate.id === proposal.id
          ? {
              ...candidate,
              status: review.decision,
              reviews: [
                {
                  decision: review.decision,
                  actorId: input.actorId,
                  occurredAt: this.#clock().toISOString(),
                  ...(review.reason ? { reason: review.reason } : {}),
                },
              ],
            }
          : candidate,
      ),
    }));
  }

  #semanticAdapter(policy: Extract<AiSemanticPolicy, { enabled: true }>): AiSemanticAdapter {
    const adapter = this.#semanticAdapters.get(policy.adapterId);
    if (!adapter || adapter.modelId !== policy.modelId) {
      throw authoringError(
        'The configured AI semantic adapter is unavailable.',
        'ai_semantic_adapter_unavailable',
        503,
      );
    }
    return adapter;
  }

  #semanticDocument(
    scope: ContentScope,
    entry: ContentEntry,
    perspective: ContentPerspective,
    policy: Extract<AiSemanticPolicy, { enabled: true }>,
  ): AiSemanticIndexDocument | null {
    assertSameContentScope(scope, entry, 'AI semantic index entry');
    const rule = policy.rules.find((candidate) => candidate.contentType === entry.contentType);
    const revisionId = semanticRevision(entry, perspective);
    if (!rule || !revisionId) return null;
    let characters = 0;
    const fields: AiSemanticIndexDocument['fields'] = [];
    for (const path of rule.fieldPaths) {
      const raw = entry.data[path];
      if (typeof raw !== 'string') continue;
      const redacted = redactAiText(raw).value;
      const remaining = resourceLimits.aiAuthoring.maximumSemanticSourceCharacters - characters;
      if (remaining <= 0) break;
      const value = redacted.slice(0, remaining);
      characters += value.length;
      fields.push({ path, value });
    }
    if (fields.length === 0) return null;
    return {
      ...scope,
      entryId: entry.id,
      contentType: entry.contentType,
      perspective,
      revisionId,
      fields,
    };
  }

  #assertIndexResult(
    scope: ContentScope,
    perspective: ContentPerspective,
    adapter: AiSemanticAdapter,
    result: AiSemanticAdapterIndexResult,
  ): void {
    assertSameContentScope(scope, result, 'AI semantic adapter index result');
    if (
      result.perspective !== perspective ||
      result.adapterId !== adapter.id ||
      result.modelId !== adapter.modelId ||
      !result.indexVersion ||
      !Number.isSafeInteger(result.indexedDocuments) ||
      result.indexedDocuments < 0
    ) {
      throw new Error('AI semantic adapter returned invalid index metadata.');
    }
  }

  async processSearchJob(input: {
    scope: ContentScope;
    type: 'search.index' | 'search.rebuild';
    payload: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const document = await this.snapshot(input.scope);
    if (document.state !== 'enabled' || !document.semantic.enabled) {
      return { semantic: 'disabled', indexedDocuments: 0 };
    }
    const policy = document.semantic;
    const adapter = this.#semanticAdapter(policy);
    try {
      if (input.type === 'search.rebuild') {
        if (input.payload.perspective !== 'draft' && input.payload.perspective !== 'published') {
          throw authoringError(
            'The semantic rebuild perspective is invalid.',
            'ai_semantic_job_invalid',
            400,
          );
        }
        const perspective = input.payload.perspective;
        if (!policy.perspectives.includes(perspective)) {
          return { semantic: 'perspective-disabled', perspective, indexedDocuments: 0 };
        }
        const entries = await this.#content.list({ scope: input.scope, perspective });
        const documents = entries.flatMap((entry) => {
          const semantic = this.#semanticDocument(input.scope, entry, perspective, policy);
          return semantic ? [semantic] : [];
        });
        const result = await adapter.rebuild({ scope: input.scope, perspective, documents });
        this.#assertIndexResult(input.scope, perspective, adapter, result);
        return {
          semantic: 'rebuilt',
          perspective,
          indexedDocuments: documents.length,
          adapterId: adapter.id,
          modelId: adapter.modelId,
          indexVersion: result.indexVersion,
        };
      }
      const eventType = typeof input.payload.eventType === 'string' ? input.payload.eventType : '';
      const entryId = typeof input.payload.entryId === 'string' ? input.payload.entryId : '';
      if (
        !entryId ||
        !['content.created', 'content.draft.updated', 'content.published'].includes(eventType)
      ) {
        throw authoringError('The semantic index job is invalid.', 'ai_semantic_job_invalid', 400);
      }
      const perspectives: ContentPerspective[] =
        eventType === 'content.published' ? ['draft', 'published'] : ['draft'];
      let indexedDocuments = 0;
      for (const perspective of perspectives) {
        if (!policy.perspectives.includes(perspective)) continue;
        let entry: ContentEntry | null = null;
        try {
          entry = await this.#content.get({ scope: input.scope, id: entryId, perspective });
        } catch (error) {
          if (!(error instanceof GridStoryError) || error.code !== 'not_found') throw error;
        }
        const semantic = entry
          ? this.#semanticDocument(input.scope, entry, perspective, policy)
          : null;
        const result = await adapter.upsert({
          scope: input.scope,
          perspective,
          entryId,
          document: semantic,
        });
        this.#assertIndexResult(input.scope, perspective, adapter, result);
        if (semantic) indexedDocuments += 1;
      }
      return { semantic: 'indexed', eventType, entryId, indexedDocuments };
    } catch (error) {
      if (error instanceof GridStoryError) throw error;
      throw authoringError('The AI semantic adapter failed.', 'ai_semantic_adapter_failed', 503);
    }
  }

  async semanticSearch(input: {
    scope: ContentScope;
    query: AiSemanticQuery;
    authorizer: AiSemanticHitAuthorizer;
  }): Promise<AiSemanticSearchResponse> {
    const query = aiSemanticQuerySchema.parse(input.query);
    const document = await this.snapshot(input.scope);
    const policy = activeSemanticPolicy(document, query.perspective);
    const adapter = this.#semanticAdapter(policy);
    const first = Math.min(query.first, policy.maximumResults);
    let result: AiSemanticAdapterResult;
    try {
      result = await adapter.search({
        scope: input.scope,
        perspective: query.perspective,
        query: redactAiText(query.text).value,
        first,
      });
    } catch {
      throw authoringError('The AI semantic adapter failed.', 'ai_semantic_adapter_failed', 503);
    }
    try {
      assertSameContentScope(input.scope, result, 'AI semantic adapter result');
    } catch {
      throw authoringError(
        'The AI semantic adapter returned invalid results.',
        'ai_semantic_result_invalid',
        502,
      );
    }
    if (
      result.adapterId !== adapter.id ||
      result.modelId !== adapter.modelId ||
      result.perspective !== query.perspective ||
      !result.indexVersion ||
      result.hits.length > first ||
      result.hits.length > resourceLimits.aiAuthoring.maximumSemanticAdapterHits
    ) {
      throw authoringError(
        'The AI semantic adapter returned invalid results.',
        'ai_semantic_result_invalid',
        502,
      );
    }
    const seen = new Set<string>();
    const hits: AiSemanticSearchResponse['hits'] = [];
    for (const hit of result.hits) {
      if (
        contentScopeKey(hit) !== contentScopeKey(input.scope) ||
        !hit.entryId ||
        !hit.contentType ||
        !hit.revisionId ||
        hit.perspective !== query.perspective ||
        !Number.isFinite(hit.score) ||
        hit.score < -1 ||
        hit.score > 1 ||
        seen.has(hit.entryId) ||
        new Set(hit.fieldPaths).size !== hit.fieldPaths.length
      ) {
        throw authoringError(
          'The AI semantic adapter returned invalid results.',
          'ai_semantic_result_invalid',
          502,
        );
      }
      seen.add(hit.entryId);
      const rule = policy.rules.find((candidate) => candidate.contentType === hit.contentType);
      if (
        !rule ||
        hit.fieldPaths.length === 0 ||
        hit.fieldPaths.some((path) => !rule.fieldPaths.includes(path))
      ) {
        throw authoringError(
          'The AI semantic adapter returned disallowed field provenance.',
          'ai_semantic_result_invalid',
          502,
        );
      }
      let entry: ContentEntry;
      try {
        entry = await this.#content.get({
          scope: input.scope,
          id: hit.entryId,
          perspective: query.perspective,
        });
      } catch (error) {
        if (error instanceof GridStoryError && error.code === 'not_found') {
          throw authoringError(
            'The AI semantic adapter returned a stale result.',
            'ai_semantic_result_stale',
            409,
          );
        }
        throw error;
      }
      assertSameContentScope(input.scope, entry, 'AI semantic result content');
      const revisionId = semanticRevision(entry, query.perspective);
      if (entry.contentType !== hit.contentType || !revisionId || revisionId !== hit.revisionId) {
        throw authoringError(
          'The AI semantic adapter returned a stale result.',
          'ai_semantic_result_stale',
          409,
        );
      }
      await input.authorizer.authorize(entry);
      if (hit.score >= policy.minimumScore) {
        hits.push({
          entryId: hit.entryId,
          contentType: hit.contentType,
          revisionId: hit.revisionId,
          score: hit.score,
          fieldPaths: [...hit.fieldPaths],
        });
      }
    }
    return aiSemanticSearchResponseSchema.parse({
      ...input.scope,
      perspective: query.perspective,
      adapterId: adapter.id,
      modelId: adapter.modelId,
      indexVersion: result.indexVersion,
      hits,
    });
  }
}
