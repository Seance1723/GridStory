import { z } from 'zod';
import { resourceLimits } from './resource-limits.js';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/u);
const fieldPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/u);
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const contentScopeShape = {
  organizationId: identifierSchema,
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  siteId: identifierSchema,
  environmentId: identifierSchema,
  locale: identifierSchema,
};
const unique = <T>(values: T[]) => new Set(values).size === values.length;

export const knowledgeGraphEdgeKindSchema = z.enum(['relation', 'taxonomy']);
export const knowledgeGraphDirectionSchema = z.enum(['outbound', 'inbound', 'both']);

export const knowledgeGraphQuerySchema = z
  .object({
    perspective: z.enum(['draft', 'published']).default('draft'),
    seedEntryIds: z
      .array(identifierSchema)
      .min(1)
      .max(resourceLimits.knowledge.maximumSeedEntries)
      .refine(unique, 'Knowledge graph seed entries must be unique.'),
    direction: knowledgeGraphDirectionSchema.default('both'),
    edgeKinds: z
      .array(knowledgeGraphEdgeKindSchema)
      .min(1)
      .max(2)
      .refine(unique, 'Knowledge graph edge kinds must be unique.')
      .default(['relation', 'taxonomy']),
    contentTypes: z
      .array(identifierSchema)
      .max(resourceLimits.search.maximumContentTypes)
      .refine(unique, 'Knowledge graph content types must be unique.')
      .default([]),
    maximumDepth: z
      .number()
      .int()
      .min(1)
      .max(resourceLimits.knowledge.maximumTraversalDepth)
      .default(2),
    maximumNodes: z
      .number()
      .int()
      .min(1)
      .max(resourceLimits.knowledge.maximumGraphNodes)
      .default(50),
    maximumEdges: z
      .number()
      .int()
      .min(1)
      .max(resourceLimits.knowledge.maximumGraphEdges)
      .default(100),
  })
  .strict();

export const knowledgeContentNodeSchema = z
  .object({
    kind: z.literal('content'),
    id: identifierSchema,
    contentType: identifierSchema,
    revisionId: identifierSchema,
    status: z.enum(['draft', 'published', 'changed']),
  })
  .strict();

export const knowledgeTaxonomyNodeSchema = z
  .object({
    kind: z.literal('taxonomy-term'),
    id: identifierSchema,
    taxonomyId: identifierSchema,
    termId: identifierSchema,
    label: z.string().trim().min(1).max(200),
  })
  .strict();

export const knowledgeGraphNodeSchema = z.discriminatedUnion('kind', [
  knowledgeContentNodeSchema,
  knowledgeTaxonomyNodeSchema,
]);

export const knowledgeGraphEdgeSchema = z
  .object({
    id: identifierSchema,
    kind: knowledgeGraphEdgeKindSchema,
    from: identifierSchema,
    to: identifierSchema,
    path: z.string().trim().min(1).max(500),
    taxonomyId: identifierSchema.optional(),
    termId: identifierSchema.optional(),
  })
  .strict();

export const knowledgeGraphPathSchema = z
  .object({
    from: identifierSchema,
    to: identifierSchema,
    nodeIds: z
      .array(identifierSchema)
      .min(2)
      .max(resourceLimits.knowledge.maximumTraversalDepth + 1),
    edgeIds: z.array(identifierSchema).min(1).max(resourceLimits.knowledge.maximumTraversalDepth),
  })
  .strict();

export const knowledgeGraphResponseSchema = z
  .object({
    ...contentScopeShape,
    perspective: z.enum(['draft', 'published']),
    seedEntryIds: z.array(identifierSchema).max(resourceLimits.knowledge.maximumSeedEntries),
    nodes: z.array(knowledgeGraphNodeSchema).max(resourceLimits.knowledge.maximumGraphNodes),
    edges: z.array(knowledgeGraphEdgeSchema).max(resourceLimits.knowledge.maximumGraphEdges),
    paths: z.array(knowledgeGraphPathSchema).max(resourceLimits.knowledge.maximumGraphPaths),
    sourceEntries: z
      .number()
      .int()
      .nonnegative()
      .max(resourceLimits.knowledge.maximumSourceEntries),
    truncated: z.boolean(),
  })
  .strict();

export const knowledgeRecommendationQuerySchema = z
  .object({
    perspective: z.enum(['draft', 'published']).default('draft'),
    entryId: identifierSchema,
    first: z.number().int().min(1).max(resourceLimits.knowledge.maximumRecommendations).default(10),
  })
  .strict();

export const knowledgeRecommendationContributionSchema = z
  .object({
    ruleId: z.enum([
      'direct-relation',
      'inverse-relation',
      'shared-taxonomy',
      'same-content-type',
      'bounded-graph-path',
    ]),
    weight: z.number().int().positive().max(100),
    explanation: z.string().trim().min(1).max(500),
    edgeId: identifierSchema.optional(),
    taxonomyId: identifierSchema.optional(),
    termId: identifierSchema.optional(),
    path: knowledgeGraphPathSchema.optional(),
  })
  .strict();

export const knowledgeRecommendationSchema = z
  .object({
    entry: knowledgeContentNodeSchema,
    score: z.number().int().positive().max(2_000),
    contributions: z
      .array(knowledgeRecommendationContributionSchema)
      .min(1)
      .max(resourceLimits.knowledge.maximumContributionsPerRecommendation),
  })
  .strict();

export const knowledgeRecommendationResponseSchema = z
  .object({
    ...contentScopeShape,
    perspective: z.enum(['draft', 'published']),
    source: knowledgeContentNodeSchema,
    recommendations: z
      .array(knowledgeRecommendationSchema)
      .max(resourceLimits.knowledge.maximumRecommendations),
    truncated: z.boolean(),
  })
  .strict();

export const knowledgeAgentToolNameSchema = z.enum([
  'content.get',
  'graph.explore',
  'recommendation.list',
]);

export const knowledgeAgentFieldRuleSchema = z
  .object({
    contentType: identifierSchema,
    fieldPaths: z
      .array(fieldPathSchema)
      .min(1)
      .max(resourceLimits.knowledge.maximumAgentChanges)
      .refine(unique, 'Agent field paths must be unique.'),
  })
  .strict();

export const disabledKnowledgeAgentPolicySchema = z.object({ enabled: z.literal(false) }).strict();
export const enabledKnowledgeAgentPolicySchema = z
  .object({
    enabled: z.literal(true),
    adapterId: identifierSchema,
    modelId: identifierSchema,
    promptId: identifierSchema,
    promptVersion: z.number().int().positive(),
    fieldRules: z
      .array(knowledgeAgentFieldRuleSchema)
      .min(1)
      .max(resourceLimits.knowledge.maximumAgentPolicies)
      .refine(
        (rules) => unique(rules.map((rule) => rule.contentType)),
        'Agent field rules must use unique content types.',
      ),
    tools: z
      .array(knowledgeAgentToolNameSchema)
      .min(1)
      .max(resourceLimits.knowledge.maximumAgentTools)
      .refine(unique, 'Agent tools must be unique.'),
    maximumToolCalls: z.number().int().min(1).max(resourceLimits.knowledge.maximumAgentToolCalls),
    timeoutMs: z
      .number()
      .int()
      .min(resourceLimits.knowledge.minimumAgentTimeoutMs)
      .max(resourceLimits.knowledge.maximumAgentTimeoutMs),
    planLifetimeSeconds: z
      .number()
      .int()
      .min(60)
      .max(resourceLimits.knowledge.maximumPlanLifetimeSeconds),
  })
  .strict();

export const knowledgeAgentPolicySchema = z.discriminatedUnion('enabled', [
  disabledKnowledgeAgentPolicySchema,
  enabledKnowledgeAgentPolicySchema,
]);

export const knowledgeAgentPolicyInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    policy: knowledgeAgentPolicySchema,
  })
  .strict();

const agentContentGetInputSchema = z
  .object({
    entryId: identifierSchema,
    fieldPaths: z
      .array(fieldPathSchema)
      .min(1)
      .max(resourceLimits.knowledge.maximumAgentChanges)
      .refine(unique, 'Agent content fields must be unique.'),
  })
  .strict();

export const knowledgeAgentToolCallSchema = z.discriminatedUnion('tool', [
  z
    .object({
      id: identifierSchema,
      tool: z.literal('content.get'),
      input: agentContentGetInputSchema,
    })
    .strict(),
  z
    .object({
      id: identifierSchema,
      tool: z.literal('graph.explore'),
      input: knowledgeGraphQuerySchema,
    })
    .strict(),
  z
    .object({
      id: identifierSchema,
      tool: z.literal('recommendation.list'),
      input: knowledgeRecommendationQuerySchema,
    })
    .strict(),
]);

export const knowledgeAgentToolTraceSchema = z
  .object({
    callId: identifierSchema,
    tool: knowledgeAgentToolNameSchema,
    inputDigest: sha256Schema,
    outputDigest: sha256Schema,
    resultCount: z.number().int().nonnegative().max(resourceLimits.knowledge.maximumGraphNodes),
    completedAt: timestampSchema,
  })
  .strict();

export const knowledgeAgentChangeSchema = z
  .object({
    fieldPath: fieldPathSchema,
    value: z.string().max(resourceLimits.knowledge.maximumAgentChangeCharacters),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const knowledgeAgentRuntimePlanSchema = z
  .object({
    contract: z.literal('gridstory.agent-draft-plan.v1'),
    summary: z.string().trim().min(1).max(2_000),
    targetEntryId: identifierSchema,
    expectedDraftRevisionId: identifierSchema,
    changes: z
      .array(knowledgeAgentChangeSchema)
      .min(1)
      .max(resourceLimits.knowledge.maximumAgentChanges)
      .refine(
        (changes) => unique(changes.map((change) => change.fieldPath)),
        'Agent plan fields must be unique.',
      ),
  })
  .strict();

export const knowledgeAgentPlanRequestSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    goal: z.string().trim().min(1).max(resourceLimits.knowledge.maximumAgentGoalCharacters),
    targetEntryId: identifierSchema,
  })
  .strict();

export const knowledgeAgentReviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    actorId: identifierSchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
    decidedAt: timestampSchema,
  })
  .strict();

export const knowledgeAgentExecutionSchema = z
  .object({
    state: z.enum(['pending', 'succeeded', 'failed']),
    idempotencyKey: identifierSchema,
    actorId: identifierSchema,
    startedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
    receiptId: identifierSchema.optional(),
    errorCode: identifierSchema.optional(),
  })
  .strict();

export const knowledgeAgentPlanSchema = z
  .object({
    id: identifierSchema,
    status: z.enum([
      'pending-review',
      'approved',
      'rejected',
      'executing',
      'succeeded',
      'failed',
      'stale',
    ]),
    policyVersion: z.number().int().positive(),
    policyDigest: sha256Schema,
    adapterId: identifierSchema,
    modelId: identifierSchema,
    promptId: identifierSchema,
    promptVersion: z.number().int().positive(),
    goal: z.string().max(resourceLimits.knowledge.maximumAgentGoalCharacters),
    goalDigest: sha256Schema,
    target: z
      .object({
        entryId: identifierSchema,
        contentType: identifierSchema,
        draftRevisionId: identifierSchema,
      })
      .strict(),
    summary: z.string().trim().min(1).max(2_000),
    changes: z.array(knowledgeAgentChangeSchema).max(resourceLimits.knowledge.maximumAgentChanges),
    toolTrace: z
      .array(knowledgeAgentToolTraceSchema)
      .max(resourceLimits.knowledge.maximumAgentToolCalls),
    resultChecksum: sha256Schema,
    digest: sha256Schema,
    createdBy: identifierSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    review: knowledgeAgentReviewSchema.optional(),
    execution: knowledgeAgentExecutionSchema.optional(),
  })
  .strict();

export const knowledgeAgentReviewInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    digest: sha256Schema,
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const knowledgeAgentExecuteInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    digest: sha256Schema,
    idempotencyKey: identifierSchema,
  })
  .strict();

export const knowledgeAgentReceiptSchema = z
  .object({
    id: identifierSchema,
    planId: identifierSchema,
    digest: sha256Schema,
    idempotencyKey: identifierSchema,
    actorId: identifierSchema,
    targetEntryId: identifierSchema,
    fromRevisionId: identifierSchema,
    toRevisionId: identifierSchema,
    resultChecksum: sha256Schema,
    completedAt: timestampSchema,
  })
  .strict();

export const knowledgeDocumentSchema = z
  .object({
    ...contentScopeShape,
    schemaVersion: z.literal(1),
    version: z.number().int().nonnegative(),
    policy: knowledgeAgentPolicySchema,
    plans: z.array(knowledgeAgentPlanSchema).max(resourceLimits.knowledge.maximumAgentPlans),
    receipts: z
      .array(knowledgeAgentReceiptSchema)
      .max(resourceLimits.knowledge.maximumAgentReceipts),
    updatedAt: timestampSchema,
    updatedBy: identifierSchema,
  })
  .strict();

export type KnowledgeGraphEdgeKind = z.infer<typeof knowledgeGraphEdgeKindSchema>;
export type KnowledgeGraphQuery = z.input<typeof knowledgeGraphQuerySchema>;
export type ParsedKnowledgeGraphQuery = z.output<typeof knowledgeGraphQuerySchema>;
export type KnowledgeContentNode = z.infer<typeof knowledgeContentNodeSchema>;
export type KnowledgeTaxonomyNode = z.infer<typeof knowledgeTaxonomyNodeSchema>;
export type KnowledgeGraphNode = z.infer<typeof knowledgeGraphNodeSchema>;
export type KnowledgeGraphEdge = z.infer<typeof knowledgeGraphEdgeSchema>;
export type KnowledgeGraphPath = z.infer<typeof knowledgeGraphPathSchema>;
export type KnowledgeGraphResponse = z.infer<typeof knowledgeGraphResponseSchema>;
export type KnowledgeRecommendationQuery = z.input<typeof knowledgeRecommendationQuerySchema>;
export type ParsedKnowledgeRecommendationQuery = z.output<
  typeof knowledgeRecommendationQuerySchema
>;
export type KnowledgeRecommendationContribution = z.infer<
  typeof knowledgeRecommendationContributionSchema
>;
export type KnowledgeRecommendation = z.infer<typeof knowledgeRecommendationSchema>;
export type KnowledgeRecommendationResponse = z.infer<typeof knowledgeRecommendationResponseSchema>;
export type KnowledgeAgentToolName = z.infer<typeof knowledgeAgentToolNameSchema>;
export type KnowledgeAgentPolicy = z.infer<typeof knowledgeAgentPolicySchema>;
export type EnabledKnowledgeAgentPolicy = z.infer<typeof enabledKnowledgeAgentPolicySchema>;
export type KnowledgeAgentPolicyInput = z.infer<typeof knowledgeAgentPolicyInputSchema>;
export type KnowledgeAgentToolCall = z.infer<typeof knowledgeAgentToolCallSchema>;
export type KnowledgeAgentToolTrace = z.infer<typeof knowledgeAgentToolTraceSchema>;
export type KnowledgeAgentRuntimePlan = z.infer<typeof knowledgeAgentRuntimePlanSchema>;
export type KnowledgeAgentPlanRequest = z.infer<typeof knowledgeAgentPlanRequestSchema>;
export type KnowledgeAgentPlan = z.infer<typeof knowledgeAgentPlanSchema>;
export type KnowledgeAgentReviewInput = z.infer<typeof knowledgeAgentReviewInputSchema>;
export type KnowledgeAgentExecuteInput = z.infer<typeof knowledgeAgentExecuteInputSchema>;
export type KnowledgeAgentReceipt = z.infer<typeof knowledgeAgentReceiptSchema>;
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;
