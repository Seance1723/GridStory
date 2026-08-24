import { createHash } from 'node:crypto';
import {
  type AiGatewayDocument,
  type ContentEntry,
  type ContentSchemaDefinition,
  type ContentScope,
  type EnabledKnowledgeAgentPolicy,
  type KnowledgeAgentExecuteInput,
  type KnowledgeAgentPlan,
  type KnowledgeAgentPlanRequest,
  type KnowledgeAgentPolicyInput,
  type KnowledgeAgentReceipt,
  type KnowledgeAgentReviewInput,
  type KnowledgeAgentRuntimePlan,
  type KnowledgeAgentToolCall,
  type KnowledgeAgentToolName,
  type KnowledgeAgentToolTrace,
  type KnowledgeContentNode,
  type KnowledgeDocument,
  type KnowledgeGraphEdge,
  type KnowledgeGraphPath,
  type KnowledgeGraphQuery,
  type KnowledgeGraphResponse,
  type KnowledgeRecommendationContribution,
  type KnowledgeRecommendationQuery,
  type KnowledgeRecommendationResponse,
  collectContentReferences,
  knowledgeAgentExecuteInputSchema,
  knowledgeAgentPlanRequestSchema,
  knowledgeAgentPolicyInputSchema,
  knowledgeAgentReviewInputSchema,
  knowledgeAgentRuntimePlanSchema,
  knowledgeAgentToolCallSchema,
  knowledgeDocumentSchema,
  knowledgeGraphQuerySchema,
  knowledgeGraphResponseSchema,
  knowledgeRecommendationQuerySchema,
  knowledgeRecommendationResponseSchema,
  resourceLimits,
} from '@gridstory/schema';
import { redactAiText } from './ai-gateway-service.js';
import { GridStoryError, NotFoundError } from './errors.js';
import { emptyKnowledgeDocument, type KnowledgeRepository } from './knowledge-repository.js';
import { canonicalJson } from './portability-service.js';
import { assertSameContentScope } from './tenant-scope.js';
import type { Actor, Awaitable, ContentRepository } from './types.js';
import type { ContentService } from './content-service.js';

function knowledgeError(message: string, code: string, statusCode: number): GridStoryError {
  return new GridStoryError(message, code, statusCode);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), 'utf8');
}

function revisionId(entry: ContentEntry, perspective: 'draft' | 'published'): string {
  return perspective === 'published'
    ? (entry.publishedRevisionId ?? entry.draftRevisionId)
    : entry.draftRevisionId;
}

function contentNode(
  entry: ContentEntry,
  perspective: 'draft' | 'published',
): KnowledgeContentNode {
  return {
    kind: 'content',
    id: entry.id,
    contentType: entry.contentType,
    revisionId: revisionId(entry, perspective),
    status: entry.status,
  };
}

function safePath(path: Array<string | number>): string {
  return path.map(String).join('.').slice(0, 500);
}

function edgeId(input: Omit<KnowledgeGraphEdge, 'id'>): string {
  return `edge_${digest(input).slice(0, 24)}`;
}

function taxonomyNodeId(taxonomyId: string, termId: string): string {
  return `term_${digest({ taxonomyId, termId }).slice(0, 24)}`;
}

function applyChanges(
  data: Record<string, unknown>,
  changes: KnowledgeAgentRuntimePlan['changes'],
): Record<string, unknown> {
  const next = structuredClone(data);
  for (const change of changes) next[change.fieldPath] = change.value;
  return next;
}

function resultCount(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.nodes)) return record.nodes.length;
  if (Array.isArray(record.recommendations)) return record.recommendations.length;
  return 1;
}

export interface KnowledgeAuthorizer {
  canRead(entry: ContentEntry): boolean;
}

export interface KnowledgeAiPolicyReader {
  snapshot(scope: ContentScope): Awaitable<AiGatewayDocument>;
}

export interface KnowledgeAgentRuntimeAdapter {
  readonly id: string;
  readonly modelId: string;
  run(input: {
    goal: string;
    target: KnowledgeContentNode;
    prompt: { id: string; version: number };
    tools: KnowledgeAgentToolName[];
    invokeTool(call: KnowledgeAgentToolCall): Promise<unknown>;
    signal: AbortSignal;
  }): Awaitable<unknown>;
}

export interface KnowledgeServiceOptions {
  repository: KnowledgeRepository;
  contentRepository: ContentRepository;
  contentService: ContentService;
  schemas: ContentSchemaDefinition[];
  aiGateway: KnowledgeAiPolicyReader;
  runtimes?: KnowledgeAgentRuntimeAdapter[];
  now?: () => Date;
  createId?: () => string;
}

interface GraphInventory {
  entries: Map<string, ContentEntry>;
  nodes: Map<string, KnowledgeGraphResponse['nodes'][number]>;
  edges: KnowledgeGraphEdge[];
  sourceEntries: number;
}

export class KnowledgeService {
  readonly #repository: KnowledgeRepository;
  readonly #contentRepository: ContentRepository;
  readonly #contentService: ContentService;
  readonly #schemas: ReadonlyMap<string, ContentSchemaDefinition>;
  readonly #aiGateway: KnowledgeAiPolicyReader;
  readonly #runtimes: ReadonlyMap<string, KnowledgeAgentRuntimeAdapter>;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: KnowledgeServiceOptions) {
    this.#repository = options.repository;
    this.#contentRepository = options.contentRepository;
    this.#contentService = options.contentService;
    this.#schemas = new Map(options.schemas.map((schema) => [schema.id, schema]));
    this.#aiGateway = options.aiGateway;
    const runtimes = options.runtimes ?? [];
    if (new Set(runtimes.map((runtime) => runtime.id)).size !== runtimes.length) {
      throw new Error('Knowledge agent runtime adapter IDs must be unique.');
    }
    this.#runtimes = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  async snapshot(scope: ContentScope): Promise<KnowledgeDocument> {
    return (await this.#repository.get(scope)) ?? emptyKnowledgeDocument(scope);
  }

  async #replace(
    scope: ContentScope,
    expectedVersion: number,
    actorId: string,
    update: (document: KnowledgeDocument) => KnowledgeDocument,
  ): Promise<KnowledgeDocument> {
    const persisted = await this.#repository.get(scope);
    const current = persisted ?? emptyKnowledgeDocument(scope);
    if (current.version !== expectedVersion) {
      throw knowledgeError(
        'Knowledge and agent state changed during this operation.',
        'knowledge_write_conflict',
        409,
      );
    }
    const next = knowledgeDocumentSchema.parse({
      ...update(structuredClone(current)),
      version: current.version + 1,
      updatedAt: this.#now().toISOString(),
      updatedBy: actorId,
    });
    await this.#repository.save(next, persisted ? current.version : null);
    return next;
  }

  async #inventory(
    scope: ContentScope,
    perspective: 'draft' | 'published',
    contentTypes: string[],
    edgeKinds: Array<'relation' | 'taxonomy'>,
    authorizer: KnowledgeAuthorizer,
  ): Promise<GraphInventory> {
    const listed = await this.#contentRepository.list({ scope, perspective });
    listed.forEach((entry) => {
      assertSameContentScope(scope, entry, 'knowledge graph repository list');
    });
    if (listed.length > resourceLimits.knowledge.maximumSourceEntries) {
      throw knowledgeError(
        'The content scope exceeds the bounded knowledge traversal limit.',
        'knowledge_source_limit',
        413,
      );
    }
    const entries = new Map(
      listed
        .filter(
          (entry) =>
            (contentTypes.length === 0 || contentTypes.includes(entry.contentType)) &&
            authorizer.canRead(entry),
        )
        .map((entry) => [entry.id, entry]),
    );
    const nodes = new Map<string, KnowledgeGraphResponse['nodes'][number]>();
    for (const entry of entries.values()) nodes.set(entry.id, contentNode(entry, perspective));
    const edges: KnowledgeGraphEdge[] = [];
    for (const entry of entries.values()) {
      const schema = this.#schemas.get(entry.contentType);
      if (!schema) continue;
      if (edgeKinds.includes('relation')) {
        for (const located of collectContentReferences(schema, entry.data)) {
          if (!entries.has(located.reference.id)) continue;
          const partial = {
            kind: 'relation' as const,
            from: entry.id,
            to: located.reference.id,
            path: safePath(located.path),
          };
          edges.push({ id: edgeId(partial), ...partial });
        }
      }
      if (edgeKinds.includes('taxonomy')) {
        for (const field of schema.fields) {
          if (field.type !== 'taxonomy') continue;
          const definition = schema.taxonomies?.find((taxonomy) => taxonomy.id === field.taxonomy);
          if (!definition) continue;
          const raw = entry.data[field.name];
          const values = Array.isArray(raw) ? raw : [raw];
          for (const value of [
            ...new Set(values.filter((item): item is string => typeof item === 'string')),
          ]) {
            const term = definition.terms?.find((candidate) => candidate.id === value);
            if (!term) continue;
            const id = taxonomyNodeId(definition.id, term.id);
            nodes.set(id, {
              kind: 'taxonomy-term',
              id,
              taxonomyId: definition.id,
              termId: term.id,
              label: term.label.slice(0, 200),
            });
            const partial = {
              kind: 'taxonomy' as const,
              from: entry.id,
              to: id,
              path: field.name,
              taxonomyId: definition.id,
              termId: term.id,
            };
            edges.push({ id: edgeId(partial), ...partial });
          }
        }
      }
    }
    return {
      entries,
      nodes,
      edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      sourceEntries: entries.size,
    };
  }

  async exploreGraph(input: {
    scope: ContentScope;
    query: KnowledgeGraphQuery;
    authorizer?: KnowledgeAuthorizer;
  }): Promise<KnowledgeGraphResponse> {
    const query = knowledgeGraphQuerySchema.parse(input.query);
    const authorizer = input.authorizer ?? { canRead: () => true };
    const inventory = await this.#inventory(
      input.scope,
      query.perspective,
      query.contentTypes,
      query.edgeKinds,
      authorizer,
    );
    for (const seed of query.seedEntryIds) {
      if (!inventory.entries.has(seed))
        throw new NotFoundError('Knowledge graph seed was not found.');
    }

    const selectedNodes = new Map<string, KnowledgeGraphResponse['nodes'][number]>();
    const selectedEdges = new Map<string, KnowledgeGraphEdge>();
    const paths: KnowledgeGraphPath[] = [];
    const visited = new Map<string, number>();
    const queue: Array<{
      seed: string;
      nodeId: string;
      depth: number;
      nodeIds: string[];
      edgeIds: string[];
    }> = [];
    for (const seed of query.seedEntryIds) {
      const node = inventory.nodes.get(seed);
      if (!node) continue;
      selectedNodes.set(seed, node);
      visited.set(seed, 0);
      queue.push({ seed, nodeId: seed, depth: 0, nodeIds: [seed], edgeIds: [] });
    }
    let truncated = false;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (!current || current.depth >= query.maximumDepth) continue;
      for (const edge of inventory.edges) {
        let nextId: string | undefined;
        if (
          (query.direction === 'outbound' || query.direction === 'both') &&
          edge.from === current.nodeId
        ) {
          nextId = edge.to;
        } else if (
          (query.direction === 'inbound' || query.direction === 'both') &&
          edge.to === current.nodeId
        ) {
          nextId = edge.from;
        }
        if (!nextId) continue;
        const nextNode = inventory.nodes.get(nextId);
        if (!nextNode) continue;
        if (!selectedEdges.has(edge.id) && selectedEdges.size >= query.maximumEdges) {
          truncated = true;
          continue;
        }
        if (!selectedNodes.has(nextId) && selectedNodes.size >= query.maximumNodes) {
          truncated = true;
          continue;
        }
        selectedEdges.set(edge.id, edge);
        selectedNodes.set(nextId, nextNode);
        const nextDepth = current.depth + 1;
        const knownDepth = visited.get(nextId);
        if (knownDepth !== undefined && knownDepth <= nextDepth) continue;
        visited.set(nextId, nextDepth);
        const nextPath = {
          seed: current.seed,
          nodeId: nextId,
          depth: nextDepth,
          nodeIds: [...current.nodeIds, nextId],
          edgeIds: [...current.edgeIds, edge.id],
        };
        if (paths.length < resourceLimits.knowledge.maximumGraphPaths) {
          paths.push({
            from: current.seed,
            to: nextId,
            nodeIds: nextPath.nodeIds,
            edgeIds: nextPath.edgeIds,
          });
        } else {
          truncated = true;
        }
        queue.push(nextPath);
      }
    }
    return knowledgeGraphResponseSchema.parse({
      ...input.scope,
      perspective: query.perspective,
      seedEntryIds: query.seedEntryIds,
      nodes: [...selectedNodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
      edges: [...selectedEdges.values()].sort((left, right) => left.id.localeCompare(right.id)),
      paths: paths.sort(
        (left, right) =>
          left.edgeIds.length - right.edgeIds.length || left.to.localeCompare(right.to),
      ),
      sourceEntries: inventory.sourceEntries,
      truncated,
    });
  }

  async recommend(input: {
    scope: ContentScope;
    query: KnowledgeRecommendationQuery;
    authorizer?: KnowledgeAuthorizer;
  }): Promise<KnowledgeRecommendationResponse> {
    const query = knowledgeRecommendationQuerySchema.parse(input.query);
    const graph = await this.exploreGraph({
      scope: input.scope,
      query: {
        perspective: query.perspective,
        seedEntryIds: [query.entryId],
        direction: 'both',
        edgeKinds: ['relation', 'taxonomy'],
        contentTypes: [],
        maximumDepth: resourceLimits.knowledge.maximumTraversalDepth,
        maximumNodes: resourceLimits.knowledge.maximumGraphNodes,
        maximumEdges: resourceLimits.knowledge.maximumGraphEdges,
      },
      ...(input.authorizer ? { authorizer: input.authorizer } : {}),
    });
    const source = graph.nodes.find(
      (node): node is KnowledgeContentNode => node.kind === 'content' && node.id === query.entryId,
    );
    if (!source) throw new NotFoundError('Recommendation source was not found.');
    const sourceTerms = new Map<string, KnowledgeGraphEdge>();
    for (const edge of graph.edges) {
      if (edge.kind === 'taxonomy' && edge.from === source.id) sourceTerms.set(edge.to, edge);
    }
    const recommendations = graph.nodes
      .filter(
        (node): node is KnowledgeContentNode => node.kind === 'content' && node.id !== source.id,
      )
      .map((entry) => {
        const contributions: KnowledgeRecommendationContribution[] = [];
        for (const edge of graph.edges) {
          if (edge.kind === 'relation' && edge.from === source.id && edge.to === entry.id) {
            contributions.push({
              ruleId: 'direct-relation',
              weight: 8,
              explanation: 'The source directly references this entry.',
              edgeId: edge.id,
            });
          }
          if (edge.kind === 'relation' && edge.from === entry.id && edge.to === source.id) {
            contributions.push({
              ruleId: 'inverse-relation',
              weight: 8,
              explanation: 'This entry directly references the source.',
              edgeId: edge.id,
            });
          }
          if (edge.kind === 'taxonomy' && edge.from === entry.id && sourceTerms.has(edge.to)) {
            contributions.push({
              ruleId: 'shared-taxonomy',
              weight: 4,
              explanation: `Both entries use ${edge.taxonomyId ?? 'the same taxonomy'}:${edge.termId ?? 'term'}.`,
              taxonomyId: edge.taxonomyId,
              termId: edge.termId,
            });
          }
        }
        if (entry.contentType === source.contentType) {
          contributions.push({
            ruleId: 'same-content-type',
            weight: 1,
            explanation: `Both entries use content type ${source.contentType}.`,
          });
        }
        const path = graph.paths.find(
          (candidate) =>
            candidate.from === source.id &&
            candidate.to === entry.id &&
            candidate.edgeIds.length > 1,
        );
        if (path) {
          contributions.push({
            ruleId: 'bounded-graph-path',
            weight: Math.max(1, 4 - path.edgeIds.length),
            explanation: `A bounded ${path.edgeIds.length}-edge path connects the entries.`,
            path,
          });
        }
        const bounded = contributions.slice(
          0,
          resourceLimits.knowledge.maximumContributionsPerRecommendation,
        );
        return {
          entry,
          score: bounded.reduce((total, contribution) => total + contribution.weight, 0),
          contributions: bounded,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id),
      );
    return knowledgeRecommendationResponseSchema.parse({
      ...input.scope,
      perspective: query.perspective,
      source,
      recommendations: recommendations.slice(0, query.first),
      truncated: graph.truncated || recommendations.length > query.first,
    });
  }

  async #assertPolicy(scope: ContentScope, policy: EnabledKnowledgeAgentPolicy): Promise<void> {
    const runtime = this.#runtimes.get(policy.adapterId);
    if (!runtime || runtime.modelId !== policy.modelId) {
      throw knowledgeError(
        'The configured knowledge agent runtime is unavailable.',
        'knowledge_agent_runtime_unavailable',
        503,
      );
    }
    for (const rule of policy.fieldRules) {
      const schema = this.#schemas.get(rule.contentType);
      if (!schema) {
        throw knowledgeError(
          'Agent policy references an unknown content type.',
          'knowledge_agent_policy_invalid',
          400,
        );
      }
      for (const path of rule.fieldPaths) {
        const field = schema.fields.find((candidate) => candidate.name === path);
        if (!field || (field.type !== 'text' && field.type !== 'slug')) {
          throw knowledgeError(
            'Agent policies may allow only top-level text or slug fields.',
            'knowledge_agent_policy_invalid',
            400,
          );
        }
      }
    }
    const gateway = await this.#aiGateway.snapshot(scope);
    const active = gateway.activePrompts.find(
      (candidate) =>
        candidate.promptId === policy.promptId && candidate.version === policy.promptVersion,
    );
    const prompt = gateway.promptVersions.find(
      (candidate) =>
        candidate.promptId === policy.promptId && candidate.version === policy.promptVersion,
    );
    const model = gateway.models.find(
      (candidate) =>
        candidate.providerId === policy.adapterId && candidate.modelId === policy.modelId,
    );
    if (
      gateway.state !== 'enabled' ||
      !active ||
      !prompt ||
      !model?.enabled ||
      !prompt.allowedModels.some(
        (candidate) =>
          candidate.providerId === policy.adapterId && candidate.modelId === policy.modelId,
      )
    ) {
      throw knowledgeError(
        'The knowledge agent prompt and model are not active.',
        'knowledge_agent_policy_unavailable',
        409,
      );
    }
  }

  async updatePolicy(
    scope: ContentScope,
    input: KnowledgeAgentPolicyInput,
    actorId: string,
  ): Promise<KnowledgeDocument> {
    const parsed = knowledgeAgentPolicyInputSchema.parse(input);
    if (parsed.policy.enabled) await this.#assertPolicy(scope, parsed.policy);
    return this.#replace(scope, parsed.expectedVersion, actorId, (document) => ({
      ...document,
      policy: structuredClone(parsed.policy),
    }));
  }

  async #invokeTool(input: {
    scope: ContentScope;
    call: KnowledgeAgentToolCall;
    policy: EnabledKnowledgeAgentPolicy;
    authorizer: KnowledgeAuthorizer;
  }): Promise<unknown> {
    if (input.call.tool === 'content.get') {
      const entry = await this.#contentRepository.getById({
        scope: input.scope,
        id: input.call.input.entryId,
        perspective: 'draft',
      });
      if (!entry || !input.authorizer.canRead(entry)) {
        throw new NotFoundError('Agent content tool target was not found.');
      }
      assertSameContentScope(input.scope, entry, 'knowledge agent content tool');
      const rule = input.policy.fieldRules.find(
        (candidate) => candidate.contentType === entry.contentType,
      );
      if (
        !rule ||
        input.call.input.fieldPaths.some((fieldPath) => !rule.fieldPaths.includes(fieldPath))
      ) {
        throw knowledgeError(
          'The agent requested a field outside its policy.',
          'knowledge_agent_tool_denied',
          403,
        );
      }
      return {
        entry: contentNode(entry, 'draft'),
        fields: Object.fromEntries(
          input.call.input.fieldPaths.map((path) => [
            path,
            typeof entry.data[path] === 'string' ? entry.data[path] : null,
          ]),
        ),
      };
    }
    if (input.call.tool === 'graph.explore') {
      if (input.call.input.perspective !== 'draft') {
        throw knowledgeError(
          'Agent graph tools may inspect only drafts.',
          'knowledge_agent_tool_denied',
          403,
        );
      }
      return this.exploreGraph({
        scope: input.scope,
        query: input.call.input,
        authorizer: input.authorizer,
      });
    }
    if (input.call.input.perspective !== 'draft') {
      throw knowledgeError(
        'Agent recommendation tools may inspect only drafts.',
        'knowledge_agent_tool_denied',
        403,
      );
    }
    return this.recommend({
      scope: input.scope,
      query: input.call.input,
      authorizer: input.authorizer,
    });
  }

  async createPlan(input: {
    scope: ContentScope;
    request: KnowledgeAgentPlanRequest;
    actorId: string;
    authorizer: KnowledgeAuthorizer;
  }): Promise<KnowledgeDocument> {
    const request = knowledgeAgentPlanRequestSchema.parse(input.request);
    const initial = await this.snapshot(input.scope);
    if (initial.version !== request.expectedVersion) {
      throw knowledgeError(
        'Knowledge and agent state changed during this operation.',
        'knowledge_write_conflict',
        409,
      );
    }
    if (!initial.policy.enabled) {
      throw knowledgeError(
        'Knowledge agent planning is disabled.',
        'knowledge_agent_disabled',
        503,
      );
    }
    const policy = initial.policy;
    await this.#assertPolicy(input.scope, policy);
    const runtime = this.#runtimes.get(policy.adapterId);
    if (!runtime) {
      throw knowledgeError(
        'The configured knowledge agent runtime is unavailable.',
        'knowledge_agent_runtime_unavailable',
        503,
      );
    }
    const target = await this.#contentRepository.getById({
      scope: input.scope,
      id: request.targetEntryId,
      perspective: 'draft',
    });
    if (!target || !input.authorizer.canRead(target)) {
      throw new NotFoundError('Knowledge agent target was not found.');
    }
    assertSameContentScope(input.scope, target, 'knowledge agent plan target');
    const fieldRule = policy.fieldRules.find(
      (candidate) => candidate.contentType === target.contentType,
    );
    if (!fieldRule) {
      throw knowledgeError(
        'The target content type is not allowed by the agent policy.',
        'knowledge_agent_target_denied',
        403,
      );
    }
    const redactedGoal = redactAiText(request.goal).value;
    const trace: KnowledgeAgentToolTrace[] = [];
    const callIds = new Set<string>();
    let active = true;
    const controller = new AbortController();
    const invokeTool = async (candidate: KnowledgeAgentToolCall): Promise<unknown> => {
      if (!active) {
        throw knowledgeError(
          'The agent runtime is no longer active.',
          'knowledge_agent_late_call',
          409,
        );
      }
      const call = knowledgeAgentToolCallSchema.parse(candidate);
      if (!policy.tools.includes(call.tool)) {
        throw knowledgeError(
          'The agent requested a tool outside its policy.',
          'knowledge_agent_tool_denied',
          403,
        );
      }
      if (callIds.has(call.id)) {
        throw knowledgeError(
          'The agent reused a tool call identity.',
          'knowledge_agent_tool_duplicate',
          409,
        );
      }
      if (trace.length >= policy.maximumToolCalls) {
        throw knowledgeError(
          'The agent exceeded its tool call limit.',
          'knowledge_agent_tool_limit',
          429,
        );
      }
      callIds.add(call.id);
      const output = await this.#invokeTool({
        scope: input.scope,
        call,
        policy,
        authorizer: input.authorizer,
      });
      if (serializedBytes(output) > resourceLimits.knowledge.maximumAgentToolResultBytes) {
        throw knowledgeError(
          'The agent tool result exceeds its bounded size.',
          'knowledge_agent_tool_result_too_large',
          413,
        );
      }
      trace.push({
        callId: call.id,
        tool: call.tool,
        inputDigest: digest(call.input),
        outputDigest: digest(output),
        resultCount: resultCount(output),
        completedAt: this.#now().toISOString(),
      });
      return structuredClone(output);
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let runtimeOutput: unknown;
    try {
      runtimeOutput = await Promise.race([
        runtime.run({
          goal: redactedGoal,
          target: contentNode(target, 'draft'),
          prompt: { id: policy.promptId, version: policy.promptVersion },
          tools: structuredClone(policy.tools),
          invokeTool,
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(
              knowledgeError(
                'The knowledge agent runtime timed out.',
                'knowledge_agent_runtime_timeout',
                504,
              ),
            );
          }, policy.timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof GridStoryError && error.code === 'knowledge_agent_runtime_timeout') {
        throw error;
      }
      throw knowledgeError(
        'The knowledge agent runtime failed.',
        'knowledge_agent_runtime_failed',
        502,
      );
    } finally {
      active = false;
      if (timeout) clearTimeout(timeout);
    }

    let runtimePlan: KnowledgeAgentRuntimePlan;
    try {
      runtimePlan = knowledgeAgentRuntimePlanSchema.parse(runtimeOutput);
    } catch {
      throw knowledgeError(
        'The knowledge agent returned an invalid plan.',
        'knowledge_agent_plan_invalid',
        502,
      );
    }
    if (
      runtimePlan.targetEntryId !== target.id ||
      runtimePlan.expectedDraftRevisionId !== target.draftRevisionId ||
      runtimePlan.changes.some((change) => !fieldRule.fieldPaths.includes(change.fieldPath))
    ) {
      throw knowledgeError(
        'The knowledge agent returned a plan outside its target contract.',
        'knowledge_agent_plan_invalid',
        502,
      );
    }
    const freshTarget = await this.#contentRepository.getById({
      scope: input.scope,
      id: target.id,
      perspective: 'draft',
    });
    if (!freshTarget || freshTarget.draftRevisionId !== target.draftRevisionId) {
      throw knowledgeError(
        'The knowledge agent target changed while planning.',
        'knowledge_agent_target_stale',
        409,
      );
    }
    const resultData = applyChanges(freshTarget.data, runtimePlan.changes);
    try {
      await this.#contentService.validateCandidate({
        scope: input.scope,
        contentType: freshTarget.contentType,
        data: resultData,
      });
    } catch {
      throw knowledgeError(
        'The knowledge agent plan does not satisfy the content contract.',
        'knowledge_agent_plan_invalid',
        422,
      );
    }
    const createdAt = this.#now();
    const id = `agent_plan_${this.#createId()}`;
    const policyDigest = digest(policy);
    const planIdentity = {
      id,
      policyVersion: initial.version,
      policyDigest,
      adapterId: policy.adapterId,
      modelId: policy.modelId,
      promptId: policy.promptId,
      promptVersion: policy.promptVersion,
      goalDigest: digest(redactedGoal),
      target: {
        entryId: freshTarget.id,
        contentType: freshTarget.contentType,
        draftRevisionId: freshTarget.draftRevisionId,
      },
      summary: runtimePlan.summary,
      changes: runtimePlan.changes,
      toolTrace: trace,
      resultChecksum: digest(resultData),
      createdBy: input.actorId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + policy.planLifetimeSeconds * 1_000).toISOString(),
    };
    const plan: KnowledgeAgentPlan = {
      ...planIdentity,
      status: 'pending-review',
      goal: redactedGoal,
      digest: digest(planIdentity),
    };
    return this.#replace(input.scope, request.expectedVersion, input.actorId, (document) => ({
      ...document,
      plans: [...document.plans, plan].slice(-resourceLimits.knowledge.maximumAgentPlans),
    }));
  }

  async reviewPlan(input: {
    scope: ContentScope;
    planId: string;
    review: KnowledgeAgentReviewInput;
    actorId: string;
    principalType: 'user' | 'service-account' | 'anonymous';
  }): Promise<KnowledgeDocument> {
    const review = knowledgeAgentReviewInputSchema.parse(input.review);
    if (input.principalType !== 'user') {
      throw knowledgeError(
        'Knowledge agent review requires a human user principal.',
        'knowledge_agent_human_review_required',
        403,
      );
    }
    return this.#replace(input.scope, review.expectedVersion, input.actorId, (document) => {
      const plan = document.plans.find((candidate) => candidate.id === input.planId);
      if (!plan) throw new NotFoundError('Knowledge agent plan was not found.');
      if (plan.status !== 'pending-review' || plan.review) {
        throw knowledgeError(
          'That knowledge agent plan cannot be reviewed.',
          'knowledge_agent_plan_not_reviewable',
          409,
        );
      }
      if (plan.digest !== review.digest) {
        throw knowledgeError(
          'Knowledge agent plan digest does not match.',
          'knowledge_agent_plan_digest_mismatch',
          409,
        );
      }
      if (Date.parse(plan.expiresAt) <= this.#now().getTime()) {
        throw knowledgeError(
          'Knowledge agent plan expired before review.',
          'knowledge_agent_plan_expired',
          409,
        );
      }
      return {
        ...document,
        plans: document.plans.map((candidate) =>
          candidate.id === plan.id
            ? {
                ...candidate,
                status: review.decision,
                review: {
                  decision: review.decision,
                  actorId: input.actorId,
                  ...(review.reason ? { reason: review.reason } : {}),
                  decidedAt: this.#now().toISOString(),
                },
              }
            : candidate,
        ),
      };
    });
  }

  async #finalizeExecution(input: {
    scope: ContentScope;
    planId: string;
    digest: string;
    idempotencyKey: string;
    actorId: string;
    fromRevisionId: string;
    entry: ContentEntry;
  }): Promise<KnowledgeAgentReceipt> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.snapshot(input.scope);
      const existing = current.receipts.find(
        (receipt) =>
          receipt.planId === input.planId && receipt.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return existing;
      const plan = current.plans.find((candidate) => candidate.id === input.planId);
      if (!plan || plan.digest !== input.digest) {
        throw knowledgeError(
          'Knowledge agent execution state is unavailable.',
          'knowledge_agent_execution_unavailable',
          409,
        );
      }
      const receipt: KnowledgeAgentReceipt = {
        id: `agent_receipt_${this.#createId()}`,
        planId: plan.id,
        digest: plan.digest,
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
        targetEntryId: input.entry.id,
        fromRevisionId: input.fromRevisionId,
        toRevisionId: input.entry.draftRevisionId,
        resultChecksum: plan.resultChecksum,
        completedAt: this.#now().toISOString(),
      };
      try {
        await this.#replace(input.scope, current.version, input.actorId, (document) => ({
          ...document,
          plans: document.plans.map((candidate) =>
            candidate.id === plan.id
              ? {
                  ...candidate,
                  status: 'succeeded' as const,
                  execution: {
                    state: 'succeeded' as const,
                    idempotencyKey: input.idempotencyKey,
                    actorId: input.actorId,
                    startedAt: candidate.execution?.startedAt ?? this.#now().toISOString(),
                    completedAt: receipt.completedAt,
                    receiptId: receipt.id,
                  },
                }
              : candidate,
          ),
          receipts: [...document.receipts, receipt].slice(
            -resourceLimits.knowledge.maximumAgentReceipts,
          ),
        }));
        return receipt;
      } catch (error) {
        if (!(error instanceof GridStoryError) || error.code !== 'knowledge_write_conflict') {
          throw error;
        }
      }
    }
    throw knowledgeError(
      'Knowledge agent execution could not be finalized.',
      'knowledge_agent_execution_ambiguous',
      409,
    );
  }

  async executePlan(input: {
    scope: ContentScope;
    planId: string;
    execution: KnowledgeAgentExecuteInput;
    actor: Actor;
    principalType: 'user' | 'service-account' | 'anonymous';
  }): Promise<KnowledgeAgentReceipt> {
    const execution = knowledgeAgentExecuteInputSchema.parse(input.execution);
    if (input.principalType !== 'user') {
      throw knowledgeError(
        'Knowledge agent execution requires a human user principal.',
        'knowledge_agent_human_execution_required',
        403,
      );
    }
    let document = await this.snapshot(input.scope);
    const existing = document.receipts.find(
      (receipt) =>
        receipt.planId === input.planId && receipt.idempotencyKey === execution.idempotencyKey,
    );
    if (existing) return existing;
    if (
      document.receipts.some(
        (receipt) =>
          receipt.idempotencyKey === execution.idempotencyKey && receipt.planId !== input.planId,
      ) ||
      document.plans.some(
        (candidate) =>
          candidate.id !== input.planId &&
          candidate.execution?.idempotencyKey === execution.idempotencyKey,
      )
    ) {
      throw knowledgeError(
        'That knowledge agent idempotency key belongs to another plan.',
        'knowledge_agent_idempotency_conflict',
        409,
      );
    }
    let plan = document.plans.find((candidate) => candidate.id === input.planId);
    if (!plan) throw new NotFoundError('Knowledge agent plan was not found.');
    if (plan.digest !== execution.digest) {
      throw knowledgeError(
        'Knowledge agent plan digest does not match.',
        'knowledge_agent_plan_digest_mismatch',
        409,
      );
    }
    const reconcilePending =
      plan.status === 'executing' &&
      plan.execution?.state === 'pending' &&
      plan.execution.idempotencyKey === execution.idempotencyKey;
    if (!reconcilePending && document.version !== execution.expectedVersion) {
      throw knowledgeError(
        'Knowledge and agent state changed during this operation.',
        'knowledge_write_conflict',
        409,
      );
    }
    if (!reconcilePending) {
      if (plan.status !== 'approved' || plan.review?.decision !== 'approved') {
        throw knowledgeError(
          'That knowledge agent plan is not approved for execution.',
          'knowledge_agent_plan_not_executable',
          409,
        );
      }
      if (Date.parse(plan.expiresAt) <= this.#now().getTime()) {
        throw knowledgeError(
          'Knowledge agent plan expired before execution.',
          'knowledge_agent_plan_expired',
          409,
        );
      }
      if (!document.policy.enabled || digest(document.policy) !== plan.policyDigest) {
        throw knowledgeError(
          'Knowledge agent policy changed after planning.',
          'knowledge_agent_policy_changed',
          409,
        );
      }
      await this.#assertPolicy(input.scope, document.policy);
    }

    let target = await this.#contentRepository.getById({
      scope: input.scope,
      id: plan.target.entryId,
      perspective: 'draft',
    });
    if (!target) throw new NotFoundError('Knowledge agent target was not found.');
    assertSameContentScope(input.scope, target, 'knowledge agent execution target');
    if (reconcilePending && digest(target.data) === plan.resultChecksum) {
      return this.#finalizeExecution({
        scope: input.scope,
        planId: plan.id,
        digest: plan.digest,
        idempotencyKey: execution.idempotencyKey,
        actorId: input.actor.id,
        fromRevisionId: plan.target.draftRevisionId,
        entry: target,
      });
    }
    if (reconcilePending) {
      if (Date.parse(plan.expiresAt) <= this.#now().getTime()) {
        throw knowledgeError(
          'Knowledge agent plan expired before execution.',
          'knowledge_agent_plan_expired',
          409,
        );
      }
      if (!document.policy.enabled || digest(document.policy) !== plan.policyDigest) {
        throw knowledgeError(
          'Knowledge agent policy changed after planning.',
          'knowledge_agent_policy_changed',
          409,
        );
      }
      await this.#assertPolicy(input.scope, document.policy);
    }
    if (target.draftRevisionId !== plan.target.draftRevisionId) {
      await this.#replace(input.scope, document.version, input.actor.id, (current) => ({
        ...current,
        plans: current.plans.map((candidate) =>
          candidate.id === plan?.id ? { ...candidate, status: 'stale' as const } : candidate,
        ),
      }));
      throw knowledgeError(
        'Knowledge agent target changed before execution.',
        'knowledge_agent_target_stale',
        409,
      );
    }
    const resultData = applyChanges(target.data, plan.changes);
    if (digest(resultData) !== plan.resultChecksum) {
      throw knowledgeError(
        'Knowledge agent plan result no longer matches its digest.',
        'knowledge_agent_plan_digest_mismatch',
        409,
      );
    }
    await this.#contentService.validateCandidate({
      scope: input.scope,
      contentType: target.contentType,
      data: resultData,
    });
    if (!reconcilePending) {
      document = await this.#replace(
        input.scope,
        execution.expectedVersion,
        input.actor.id,
        (current) => ({
          ...current,
          plans: current.plans.map((candidate) =>
            candidate.id === plan?.id
              ? {
                  ...candidate,
                  status: 'executing' as const,
                  execution: {
                    state: 'pending' as const,
                    idempotencyKey: execution.idempotencyKey,
                    actorId: input.actor.id,
                    startedAt: this.#now().toISOString(),
                  },
                }
              : candidate,
          ),
        }),
      );
      plan = document.plans.find((candidate) => candidate.id === input.planId);
      if (!plan) throw new NotFoundError('Knowledge agent plan was not found.');
    }
    try {
      target = await this.#contentService.updateDraft({
        scope: input.scope,
        id: target.id,
        expectedRevisionId: target.draftRevisionId,
        data: resultData,
        actor: input.actor,
      });
    } catch (error) {
      const current = await this.snapshot(input.scope);
      await this.#replace(input.scope, current.version, input.actor.id, (latest) => ({
        ...latest,
        plans: latest.plans.map((candidate) =>
          candidate.id === input.planId
            ? {
                ...candidate,
                status: 'failed' as const,
                execution: {
                  state: 'failed' as const,
                  idempotencyKey: execution.idempotencyKey,
                  actorId: input.actor.id,
                  startedAt: candidate.execution?.startedAt ?? this.#now().toISOString(),
                  completedAt: this.#now().toISOString(),
                  errorCode: 'knowledge_agent_content_update_failed',
                },
              }
            : candidate,
        ),
      })).catch(() => undefined);
      throw error;
    }
    return this.#finalizeExecution({
      scope: input.scope,
      planId: input.planId,
      digest: execution.digest,
      idempotencyKey: execution.idempotencyKey,
      actorId: input.actor.id,
      fromRevisionId: plan.target.draftRevisionId,
      entry: target,
    });
  }
}
