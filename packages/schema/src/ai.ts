import { z } from 'zod';
import { resourceLimits } from './resource-limits.js';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/);
const timestampSchema = z.string().datetime({ offset: true });
const safeCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const tokenCountSchema = z.number().int().positive().max(2_000_000);
const costMicrosSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fieldPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/);

const contentScopeShape = {
  organizationId: identifierSchema,
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  siteId: identifierSchema,
  environmentId: identifierSchema,
  locale: identifierSchema,
};

export const aiModelReferenceSchema = z
  .object({ providerId: identifierSchema, modelId: identifierSchema })
  .strict();

export const aiModelPolicySchema = aiModelReferenceSchema
  .extend({
    enabled: z.boolean(),
    maximumInputTokens: tokenCountSchema,
    maximumOutputTokens: tokenCountSchema,
    inputCostMicrosPerMillion: costMicrosSchema,
    outputCostMicrosPerMillion: costMicrosSchema,
  })
  .strict();

export const aiBudgetPolicySchema = z
  .object({
    dailyRequests: z.number().int().positive().max(1_000_000),
    dailyInputTokens: tokenCountSchema,
    dailyOutputTokens: tokenCountSchema,
    dailyCostMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const aiRetrievalRuleSchema = z
  .object({
    contentType: identifierSchema,
    fieldPaths: z
      .array(fieldPathSchema)
      .min(1)
      .max(resourceLimits.aiGateway.maximumFieldsPerRetrievalRule)
      .refine((values) => new Set(values).size === values.length, 'Field paths must be unique.'),
  })
  .strict();

export const aiRetrievalPolicySchema = z
  .object({
    perspective: z.enum(['published', 'draft']),
    maximumSources: z
      .number()
      .int()
      .positive()
      .max(resourceLimits.aiGateway.maximumSourcesPerRequest),
    rules: z
      .array(aiRetrievalRuleSchema)
      .min(1)
      .max(resourceLimits.aiGateway.maximumRetrievalRulesPerPrompt)
      .refine(
        (rules) => new Set(rules.map((rule) => rule.contentType)).size === rules.length,
        'Content types must be unique.',
      ),
  })
  .strict();

export const aiPromptVersionSchema = z
  .object({
    promptId: identifierSchema,
    version: z.number().int().positive().max(1_000_000),
    name: z.string().trim().min(1).max(160),
    purpose: z.string().trim().min(1).max(1_000),
    instructions: z
      .string()
      .trim()
      .min(1)
      .max(resourceLimits.aiGateway.maximumInstructionCharacters),
    allowedModels: z
      .array(aiModelReferenceSchema)
      .min(1)
      .max(resourceLimits.aiGateway.maximumAllowedModelsPerPrompt)
      .refine(
        (models) =>
          new Set(models.map((model) => `${model.providerId}\u0000${model.modelId}`)).size ===
          models.length,
        'Allowed models must be unique.',
      ),
    maximumOutputTokens: tokenCountSchema,
    maximumCostMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    timeoutMs: z
      .number()
      .int()
      .min(resourceLimits.aiGateway.minimumTimeoutMs)
      .max(resourceLimits.aiGateway.maximumTimeoutMs),
    retrieval: aiRetrievalPolicySchema,
    createdBy: identifierSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const aiActivePromptSchema = z
  .object({ promptId: identifierSchema, version: z.number().int().positive().max(1_000_000) })
  .strict();

export const aiGatewayStateEventSchema = z
  .object({
    state: z.enum(['enabled', 'disabled']),
    actorId: identifierSchema,
    reason: z.string().trim().min(1).max(500),
    occurredAt: timestampSchema,
  })
  .strict();

export const aiUsageSchema = z
  .object({
    requests: safeCountSchema,
    inputTokens: safeCountSchema,
    outputTokens: safeCountSchema,
    costMicros: costMicrosSchema,
  })
  .strict();

export const aiDailyUsageSchema = aiUsageSchema
  .extend({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();

export const aiRequestReceiptSchema = z
  .object({
    requestId: z.uuid(),
    promptId: identifierSchema,
    promptVersion: z.number().int().positive().max(1_000_000),
    providerId: identifierSchema,
    modelId: identifierSchema,
    status: z.enum(['reserved', 'succeeded', 'failed']),
    usageDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reservedUsage: aiUsageSchema,
    actualUsage: aiUsageSchema.optional(),
    createdAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict();

export const aiGatewayDocumentSchema = z
  .object({
    ...contentScopeShape,
    schemaVersion: z.literal(1),
    version: z.number().int().nonnegative(),
    state: z.enum(['enabled', 'disabled']),
    models: z.array(aiModelPolicySchema).max(resourceLimits.aiGateway.maximumModels),
    budgets: aiBudgetPolicySchema,
    promptVersions: z
      .array(aiPromptVersionSchema)
      .max(resourceLimits.aiGateway.maximumPromptVersions),
    activePrompts: z.array(aiActivePromptSchema).max(resourceLimits.aiGateway.maximumActivePrompts),
    dailyUsage: z.array(aiDailyUsageSchema).max(resourceLimits.aiGateway.maximumDailyUsageRecords),
    receipts: z.array(aiRequestReceiptSchema).max(resourceLimits.aiGateway.maximumRequestReceipts),
    stateEvents: z
      .array(aiGatewayStateEventSchema)
      .max(resourceLimits.aiGateway.maximumStateEvents),
    updatedAt: timestampSchema,
  })
  .strict();

export const aiGatewayPolicyInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    models: z.array(aiModelPolicySchema).max(resourceLimits.aiGateway.maximumModels),
    budgets: aiBudgetPolicySchema,
  })
  .strict();

export const aiPromptVersionInputSchema = aiPromptVersionSchema
  .omit({ createdBy: true, createdAt: true })
  .extend({ expectedVersion: z.number().int().nonnegative() })
  .strict();

export const aiPromptActivationInputSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();

export const aiGatewayStateInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    state: z.enum(['enabled', 'disabled']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const aiGenerateInputSchema = z
  .object({
    requestId: z.uuid(),
    promptId: identifierSchema,
    providerId: identifierSchema,
    modelId: identifierSchema,
    input: z.string().trim().min(1).max(resourceLimits.aiGateway.maximumInputCharacters),
    sourceIds: z
      .array(identifierSchema)
      .max(resourceLimits.aiGateway.maximumSourcesPerRequest)
      .refine((values) => new Set(values).size === values.length, 'Source IDs must be unique.'),
  })
  .strict();

export const aiProviderRequestSchema = z
  .object({
    requestId: z.uuid(),
    providerId: identifierSchema,
    modelId: identifierSchema,
    prompt: z
      .object({
        id: identifierSchema,
        version: z.number().int().positive().max(1_000_000),
        instructions: z.string().min(1).max(resourceLimits.aiGateway.maximumInstructionCharacters),
      })
      .strict(),
    input: z.string().min(1).max(resourceLimits.aiGateway.maximumInputCharacters),
    sources: z
      .array(
        z
          .object({
            id: identifierSchema,
            contentType: identifierSchema,
            revisionId: identifierSchema,
            fields: z.record(fieldPathSchema, z.string()),
          })
          .strict(),
      )
      .max(resourceLimits.aiGateway.maximumSourcesPerRequest),
    maximumOutputTokens: tokenCountSchema,
    timeoutMs: z
      .number()
      .int()
      .min(resourceLimits.aiGateway.minimumTimeoutMs)
      .max(resourceLimits.aiGateway.maximumTimeoutMs),
    outputContract: z.literal('gridstory.authoring-suggestions.v1').optional(),
  })
  .strict();

export const aiProviderEstimateSchema = aiUsageSchema
  .omit({ requests: true })
  .extend({ outputTokens: z.number().int().positive().max(2_000_000) })
  .strict();

export const aiProviderResultSchema = z
  .object({
    output: z.string().max(resourceLimits.aiGateway.maximumOutputCharacters),
    inputTokens: safeCountSchema,
    outputTokens: safeCountSchema,
    costMicros: costMicrosSchema,
    finishReason: z.enum(['stop', 'length', 'content-filter', 'unknown']),
  })
  .strict();

export const aiGenerateResultSchema = z
  .object({
    requestId: z.uuid(),
    promptId: identifierSchema,
    promptVersion: z.number().int().positive().max(1_000_000),
    providerId: identifierSchema,
    modelId: identifierSchema,
    output: z.string().max(resourceLimits.aiGateway.maximumOutputCharacters),
    trust: z.literal('untrusted'),
    sources: z
      .array(
        z
          .object({
            id: identifierSchema,
            contentType: identifierSchema,
            revisionId: identifierSchema,
          })
          .strict(),
      )
      .max(resourceLimits.aiGateway.maximumSourcesPerRequest),
    usage: aiUsageSchema,
    redactions: z
      .object({
        credentials: safeCountSchema,
        emails: safeCountSchema,
        phones: safeCountSchema,
        ips: safeCountSchema,
      })
      .strict(),
    finishReason: z.enum(['stop', 'length', 'content-filter', 'unknown']),
  })
  .strict();

export type AiModelReference = z.infer<typeof aiModelReferenceSchema>;
export type AiModelPolicy = z.infer<typeof aiModelPolicySchema>;
export type AiBudgetPolicy = z.infer<typeof aiBudgetPolicySchema>;
export type AiPromptVersion = z.infer<typeof aiPromptVersionSchema>;
export type AiGatewayDocument = z.infer<typeof aiGatewayDocumentSchema>;
export type AiGatewayPolicyInput = z.infer<typeof aiGatewayPolicyInputSchema>;
export type AiPromptVersionInput = z.infer<typeof aiPromptVersionInputSchema>;
export type AiGatewayStateInput = z.infer<typeof aiGatewayStateInputSchema>;
export type AiGenerateInput = z.infer<typeof aiGenerateInputSchema>;
export type AiProviderRequest = z.infer<typeof aiProviderRequestSchema>;
export type AiProviderEstimate = z.infer<typeof aiProviderEstimateSchema>;
export type AiProviderResult = z.infer<typeof aiProviderResultSchema>;
export type AiGenerateResult = z.infer<typeof aiGenerateResultSchema>;
export type AiUsage = z.infer<typeof aiUsageSchema>;
