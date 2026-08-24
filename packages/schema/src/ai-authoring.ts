import { z } from 'zod';
import { aiGenerateInputSchema, aiUsageSchema } from './ai.js';
import { resourceLimits } from './resource-limits.js';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/);
const timestampSchema = z.string().datetime({ offset: true });
const fieldPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
const contentScopeShape = {
  organizationId: identifierSchema,
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  siteId: identifierSchema,
  environmentId: identifierSchema,
  locale: identifierSchema,
};
const redactionCountsSchema = z
  .object({
    credentials: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    emails: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    phones: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ips: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const aiAuthoringMinimumLengthRuleSchema = z
  .object({
    id: identifierSchema,
    fieldPath: fieldPathSchema,
    kind: z.literal('minimum-length'),
    minimum: z
      .number()
      .int()
      .nonnegative()
      .max(resourceLimits.aiAuthoring.maximumSuggestedValueCharacters),
  })
  .strict();

export const aiAuthoringMaximumLengthRuleSchema = z
  .object({
    id: identifierSchema,
    fieldPath: fieldPathSchema,
    kind: z.literal('maximum-length'),
    maximum: z
      .number()
      .int()
      .positive()
      .max(resourceLimits.aiAuthoring.maximumSuggestedValueCharacters),
  })
  .strict();

export const aiAuthoringTermRuleSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: identifierSchema,
      fieldPath: fieldPathSchema,
      kind: z.literal('required-term'),
      term: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      id: identifierSchema,
      fieldPath: fieldPathSchema,
      kind: z.literal('forbidden-term'),
      term: z.string().trim().min(1).max(200),
    })
    .strict(),
]);

export const aiAuthoringEvaluationRuleSchema = z.union([
  aiAuthoringMinimumLengthRuleSchema,
  aiAuthoringMaximumLengthRuleSchema,
  aiAuthoringTermRuleSchema,
]);

export const aiAuthoringActionSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(160),
    enabled: z.boolean(),
    promptId: identifierSchema,
    contentType: identifierSchema,
    targetFields: z
      .array(fieldPathSchema)
      .min(1)
      .max(resourceLimits.aiAuthoring.maximumTargetFieldsPerAction)
      .refine((values) => new Set(values).size === values.length, 'Target fields must be unique.'),
    maximumChanges: z
      .number()
      .int()
      .positive()
      .max(resourceLimits.aiAuthoring.maximumChangesPerProposal),
    evaluationRules: z
      .array(aiAuthoringEvaluationRuleSchema)
      .max(resourceLimits.aiAuthoring.maximumEvaluationRulesPerAction),
  })
  .strict()
  .superRefine((action, context) => {
    if (action.maximumChanges > action.targetFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['maximumChanges'],
        message: 'Maximum changes cannot exceed the number of target fields.',
      });
    }
    if (
      new Set(action.evaluationRules.map((rule) => rule.id)).size !== action.evaluationRules.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evaluationRules'],
        message: 'Evaluation rule IDs must be unique.',
      });
    }
    action.evaluationRules.forEach((rule, index) => {
      if (!action.targetFields.includes(rule.fieldPath)) {
        context.addIssue({
          code: 'custom',
          path: ['evaluationRules', index, 'fieldPath'],
          message: 'Evaluation rules must target an action field.',
        });
      }
    });
  });

export const aiSemanticRuleSchema = z
  .object({
    contentType: identifierSchema,
    fieldPaths: z
      .array(fieldPathSchema)
      .min(1)
      .max(resourceLimits.aiAuthoring.maximumSemanticFieldsPerRule)
      .refine(
        (values) => new Set(values).size === values.length,
        'Semantic fields must be unique.',
      ),
  })
  .strict();

export const aiSemanticPolicySchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      adapterId: identifierSchema,
      modelId: identifierSchema,
      perspectives: z
        .array(z.enum(['draft', 'published']))
        .min(1)
        .max(2)
        .refine((values) => new Set(values).size === values.length, 'Perspectives must be unique.'),
      maximumResults: z
        .number()
        .int()
        .positive()
        .max(resourceLimits.aiAuthoring.maximumSemanticResults),
      minimumScore: z.number().finite().min(-1).max(1),
      rules: z
        .array(aiSemanticRuleSchema)
        .min(1)
        .max(resourceLimits.aiAuthoring.maximumSemanticRules)
        .refine(
          (rules) => new Set(rules.map((rule) => rule.contentType)).size === rules.length,
          'Semantic content types must be unique.',
        ),
    })
    .strict(),
]);

export const aiAuthoringSuggestionChangeSchema = z
  .object({
    fieldPath: fieldPathSchema,
    value: z.string().max(resourceLimits.aiAuthoring.maximumSuggestedValueCharacters),
    rationale: z
      .string()
      .trim()
      .min(1)
      .max(resourceLimits.aiAuthoring.maximumRationaleCharacters)
      .optional(),
  })
  .strict();

export const aiAuthoringProviderOutputSchema = z
  .object({
    contract: z.literal('gridstory.authoring-suggestions.v1'),
    suggestions: z
      .array(aiAuthoringSuggestionChangeSchema)
      .min(1)
      .max(resourceLimits.aiAuthoring.maximumChangesPerProposal)
      .refine(
        (suggestions) =>
          new Set(suggestions.map((suggestion) => suggestion.fieldPath)).size ===
          suggestions.length,
        'Suggestion fields must be unique.',
      ),
  })
  .strict();

export const aiAuthoringEvaluationResultSchema = z
  .object({
    ruleId: identifierSchema,
    fieldPath: fieldPathSchema,
    kind: z.enum([
      'minimum-length',
      'maximum-length',
      'required-term',
      'forbidden-term',
      'content-schema',
    ]),
    outcome: z.enum(['passed', 'failed']),
    message: z
      .string()
      .trim()
      .min(1)
      .max(resourceLimits.aiAuthoring.maximumEvaluationMessageCharacters),
  })
  .strict();

export const aiAuthoringProposalSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['evaluation-failed', 'pending-review', 'approved', 'rejected', 'stale']),
    action: aiAuthoringActionSchema
      .safeExtend({ documentVersion: z.number().int().nonnegative() })
      .strict(),
    target: z
      .object({
        entryId: identifierSchema,
        contentType: identifierSchema,
        revisionId: identifierSchema,
      })
      .strict(),
    changes: z
      .array(aiAuthoringSuggestionChangeSchema)
      .max(resourceLimits.aiAuthoring.maximumChangesPerProposal),
    evaluation: z
      .object({
        outcome: z.enum(['passed', 'failed']),
        results: z
          .array(aiAuthoringEvaluationResultSchema)
          .max(resourceLimits.aiAuthoring.maximumEvaluationRulesPerAction + 1),
      })
      .strict(),
    provenance: z
      .object({
        requestId: z.uuid(),
        outputContract: z.literal('gridstory.authoring-suggestions.v1'),
        promptId: identifierSchema,
        promptVersion: z.number().int().positive().max(1_000_000),
        providerId: identifierSchema,
        modelId: identifierSchema,
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
        redactions: redactionCountsSchema,
        finishReason: z.enum(['stop', 'length', 'content-filter', 'unknown']),
        actorId: identifierSchema,
        createdAt: timestampSchema,
      })
      .strict(),
    reviews: z
      .array(
        z
          .object({
            decision: z.enum(['approved', 'rejected']),
            actorId: identifierSchema,
            occurredAt: timestampSchema,
            reason: z
              .string()
              .trim()
              .min(1)
              .max(resourceLimits.aiAuthoring.maximumReviewReasonCharacters)
              .optional(),
          })
          .strict(),
      )
      .max(1),
  })
  .strict();

export const aiAuthoringDocumentSchema = z
  .object({
    ...contentScopeShape,
    schemaVersion: z.literal(1),
    version: z.number().int().nonnegative(),
    state: z.enum(['enabled', 'disabled']),
    actions: z
      .array(aiAuthoringActionSchema)
      .max(resourceLimits.aiAuthoring.maximumActions)
      .refine(
        (actions) => new Set(actions.map((action) => action.id)).size === actions.length,
        'Action IDs must be unique.',
      ),
    semantic: aiSemanticPolicySchema,
    proposals: z.array(aiAuthoringProposalSchema).max(resourceLimits.aiAuthoring.maximumProposals),
    updatedAt: timestampSchema,
  })
  .strict();

export const aiAuthoringPolicyInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    state: z.enum(['enabled', 'disabled']),
    actions: z
      .array(aiAuthoringActionSchema)
      .max(resourceLimits.aiAuthoring.maximumActions)
      .refine(
        (actions) => new Set(actions.map((action) => action.id)).size === actions.length,
        'Action IDs must be unique.',
      ),
    semantic: aiSemanticPolicySchema,
  })
  .strict();

export const aiAuthoringProposalInputSchema = z
  .object({
    actionId: identifierSchema,
    targetEntryId: identifierSchema,
    expectedDraftRevisionId: identifierSchema,
    request: aiGenerateInputSchema,
  })
  .strict();

export const aiAuthoringReviewInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    decision: z.enum(['approved', 'rejected']),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(resourceLimits.aiAuthoring.maximumReviewReasonCharacters)
      .optional(),
  })
  .strict();

export const aiSemanticQuerySchema = z
  .object({
    text: z.string().trim().min(1).max(resourceLimits.aiAuthoring.maximumSemanticQueryCharacters),
    perspective: z.enum(['draft', 'published']),
    first: z.number().int().positive().max(resourceLimits.aiAuthoring.maximumSemanticResults),
  })
  .strict();

export const aiSemanticSearchResponseSchema = z
  .object({
    ...contentScopeShape,
    perspective: z.enum(['draft', 'published']),
    adapterId: identifierSchema,
    modelId: identifierSchema,
    indexVersion: identifierSchema,
    hits: z
      .array(
        z
          .object({
            entryId: identifierSchema,
            contentType: identifierSchema,
            revisionId: identifierSchema,
            score: z.number().finite().min(-1).max(1),
            fieldPaths: z
              .array(fieldPathSchema)
              .max(resourceLimits.aiAuthoring.maximumSemanticFieldsPerRule),
          })
          .strict(),
      )
      .max(resourceLimits.aiAuthoring.maximumSemanticResults),
  })
  .strict();

export type AiAuthoringEvaluationRule = z.infer<typeof aiAuthoringEvaluationRuleSchema>;
export type AiAuthoringAction = z.infer<typeof aiAuthoringActionSchema>;
export type AiSemanticPolicy = z.infer<typeof aiSemanticPolicySchema>;
export type AiAuthoringProviderOutput = z.infer<typeof aiAuthoringProviderOutputSchema>;
export type AiAuthoringSuggestionChange = z.infer<typeof aiAuthoringSuggestionChangeSchema>;
export type AiAuthoringProposal = z.infer<typeof aiAuthoringProposalSchema>;
export type AiAuthoringDocument = z.infer<typeof aiAuthoringDocumentSchema>;
export type AiAuthoringPolicyInput = z.infer<typeof aiAuthoringPolicyInputSchema>;
export type AiAuthoringProposalInput = z.infer<typeof aiAuthoringProposalInputSchema>;
export type AiAuthoringReviewInput = z.infer<typeof aiAuthoringReviewInputSchema>;
export type AiSemanticQuery = z.infer<typeof aiSemanticQuerySchema>;
export type AiSemanticSearchResponse = z.infer<typeof aiSemanticSearchResponseSchema>;
