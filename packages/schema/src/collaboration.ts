import { z } from 'zod';

const collaborationScopeSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  environmentId: z.string().min(1),
  locale: z.string().min(1),
});

const collaborationIdSchema = z.string().trim().min(1).max(128);
const collaborationJsonSchema = z.json();

export const collaborationTargetSchema = z
  .object({
    entryId: collaborationIdSchema,
    field: collaborationIdSchema.optional(),
    nodeId: collaborationIdSchema.optional(),
    property: collaborationIdSchema.optional(),
  })
  .superRefine((target, context) => {
    if ((target.nodeId || target.property) && !target.field) {
      context.addIssue({
        code: 'custom',
        message: 'Block and property targets require a field.',
        path: ['field'],
      });
    }
    if (target.property && !target.nodeId) {
      context.addIssue({
        code: 'custom',
        message: 'Property targets require a block node.',
        path: ['nodeId'],
      });
    }
  });

export type CollaborationTarget = z.infer<typeof collaborationTargetSchema>;

export const collaborationChangeTargetSchema = z
  .object({
    entryId: collaborationIdSchema,
    field: collaborationIdSchema,
    nodeId: collaborationIdSchema.optional(),
    property: collaborationIdSchema.optional(),
  })
  .refine((target) => !target.property || Boolean(target.nodeId), {
    message: 'Property targets require a block node.',
    path: ['nodeId'],
  });

export type CollaborationChangeTarget = z.infer<typeof collaborationChangeTargetSchema>;

export const commentMessageSchema = z.object({
  id: collaborationIdSchema,
  actorId: collaborationIdSchema,
  body: z.string().trim().min(1).max(4000),
  mentions: z.array(collaborationIdSchema).max(50).default([]),
  createdAt: z.string().datetime(),
});

export type CommentMessage = z.infer<typeof commentMessageSchema>;

export const commentThreadSchema = collaborationScopeSchema.extend({
  id: collaborationIdSchema,
  target: collaborationTargetSchema,
  messages: z.array(commentMessageSchema).min(1).max(500),
  assigneeId: collaborationIdSchema.optional(),
  dueAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: collaborationIdSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CommentThread = z.infer<typeof commentThreadSchema>;

export const presenceParticipantSchema = z.object({
  actorId: collaborationIdSchema,
  displayName: z.string().trim().min(1).max(160),
  field: collaborationIdSchema.optional(),
  nodeId: collaborationIdSchema.optional(),
  lastSeenAt: z.string().datetime(),
});

export type PresenceParticipant = z.infer<typeof presenceParticipantSchema>;

export const collaborationOperationKindSchema = z.enum(['set', 'delete', 'insert', 'move']);
export type CollaborationOperationKind = z.infer<typeof collaborationOperationKindSchema>;

export const collaborationOperationSchema = z
  .object({
    id: collaborationIdSchema,
    entryId: collaborationIdSchema,
    branchId: collaborationIdSchema,
    actorId: collaborationIdSchema,
    actorSequence: z.number().int().positive(),
    dependencies: z.array(collaborationIdSchema).max(256),
    target: collaborationChangeTargetSchema,
    kind: collaborationOperationKindSchema,
    value: collaborationJsonSchema.optional(),
    createdAt: z.string().datetime(),
  })
  .superRefine((operation, context) => {
    if (operation.kind !== 'delete' && operation.value === undefined) {
      context.addIssue({
        code: 'custom',
        message: `${operation.kind} operations require a JSON value.`,
        path: ['value'],
      });
    }
    if (operation.target.entryId !== operation.entryId) {
      context.addIssue({
        code: 'custom',
        message: 'Operation target entry must match the operation entry.',
        path: ['target', 'entryId'],
      });
    }
  });

export type CollaborationOperation = z.infer<typeof collaborationOperationSchema>;

export const collaborationOperationInputSchema = z.object({
  id: collaborationIdSchema.optional(),
  branchId: collaborationIdSchema.default('main'),
  actorSequence: z.number().int().positive().optional(),
  dependencies: z.array(collaborationIdSchema).max(256).optional(),
  target: z
    .object({
      field: collaborationIdSchema,
      nodeId: collaborationIdSchema.optional(),
      property: collaborationIdSchema.optional(),
    })
    .refine((target) => !target.property || Boolean(target.nodeId), {
      message: 'Property targets require a block node.',
      path: ['nodeId'],
    }),
  kind: collaborationOperationKindSchema.default('set'),
  value: collaborationJsonSchema.optional(),
});

export type CollaborationOperationInput = z.input<typeof collaborationOperationInputSchema>;

export const collaborationBranchSchema = z.object({
  id: collaborationIdSchema,
  entryId: collaborationIdSchema,
  name: z.string().trim().min(1).max(120),
  status: z.enum(['open', 'merged', 'archived']),
  parentBranchId: collaborationIdSchema.optional(),
  baseOperationIds: z.array(collaborationIdSchema).max(10_000),
  operationIds: z.array(collaborationIdSchema).max(10_000),
  headOperationIds: z.array(collaborationIdSchema).max(256),
  createdBy: collaborationIdSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  mergedAt: z.string().datetime().optional(),
});

export type CollaborationBranch = z.infer<typeof collaborationBranchSchema>;

export const collaborationSuggestionSchema = z.object({
  id: collaborationIdSchema,
  entryId: collaborationIdSchema,
  branchId: collaborationIdSchema,
  target: collaborationChangeTargetSchema,
  kind: collaborationOperationKindSchema,
  value: collaborationJsonSchema.optional(),
  status: z.enum(['open', 'accepted', 'rejected']),
  createdBy: collaborationIdSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  reviewedBy: collaborationIdSchema.optional(),
  reviewedAt: z.string().datetime().optional(),
  operationId: collaborationIdSchema.optional(),
});

export type CollaborationSuggestion = z.infer<typeof collaborationSuggestionSchema>;

export const collaborationConflictVariantSchema = z.object({
  operationId: collaborationIdSchema,
  actorId: collaborationIdSchema,
  branchId: collaborationIdSchema,
  kind: collaborationOperationKindSchema,
  value: collaborationJsonSchema.optional(),
});

export type CollaborationConflictVariant = z.infer<typeof collaborationConflictVariantSchema>;

export const collaborationConflictSchema = z.object({
  id: collaborationIdSchema,
  entryId: collaborationIdSchema,
  branchId: collaborationIdSchema,
  mergeId: collaborationIdSchema.optional(),
  target: collaborationChangeTargetSchema,
  variants: z.array(collaborationConflictVariantSchema).min(2).max(64),
  status: z.enum(['open', 'resolved']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolution: z
    .object({
      operationId: collaborationIdSchema,
      actorId: collaborationIdSchema,
      resolvedAt: z.string().datetime(),
    })
    .optional(),
});

export type CollaborationConflict = z.infer<typeof collaborationConflictSchema>;

export const collaborationMergeSchema = z.object({
  id: collaborationIdSchema,
  entryId: collaborationIdSchema,
  sourceBranchId: collaborationIdSchema,
  targetBranchId: collaborationIdSchema,
  status: z.enum(['conflicted', 'merged']),
  conflictIds: z.array(collaborationIdSchema).max(1000),
  createdBy: collaborationIdSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  mergedAt: z.string().datetime().optional(),
});

export type CollaborationMerge = z.infer<typeof collaborationMergeSchema>;

export const collaborationValueStateSchema = z.object({
  target: collaborationChangeTargetSchema,
  operationId: collaborationIdSchema,
  kind: collaborationOperationKindSchema,
  value: collaborationJsonSchema.optional(),
  conflictingOperationIds: z.array(collaborationIdSchema).max(63),
});

export type CollaborationValueState = z.infer<typeof collaborationValueStateSchema>;

export const collaborationBranchStateSchema = z.object({
  branchId: collaborationIdSchema,
  version: z.number().int().nonnegative(),
  headOperationIds: z.array(collaborationIdSchema).max(256),
  values: z.array(collaborationValueStateSchema).max(10_000),
});

export type CollaborationBranchState = z.infer<typeof collaborationBranchStateSchema>;

export const collaborationDocumentSchema = collaborationScopeSchema.extend({
  entryId: collaborationIdSchema,
  version: z.number().int().nonnegative(),
  threads: z.array(commentThreadSchema).max(1000),
  operations: z.array(collaborationOperationSchema).max(10_000),
  branches: z.array(collaborationBranchSchema).min(1).max(100),
  suggestions: z.array(collaborationSuggestionSchema).max(1000),
  merges: z.array(collaborationMergeSchema).max(1000),
  conflicts: z.array(collaborationConflictSchema).max(1000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CollaborationDocument = z.infer<typeof collaborationDocumentSchema>;

export const collaborationSnapshotSchema = collaborationScopeSchema.extend({
  entryId: collaborationIdSchema,
  version: z.number().int().nonnegative(),
  threads: z.array(commentThreadSchema),
  presence: z.array(presenceParticipantSchema),
  operations: z.array(collaborationOperationSchema),
  branches: z.array(collaborationBranchSchema),
  branchStates: z.array(collaborationBranchStateSchema),
  suggestions: z.array(collaborationSuggestionSchema),
  merges: z.array(collaborationMergeSchema),
  conflicts: z.array(collaborationConflictSchema),
});

export type CollaborationSnapshot = z.infer<typeof collaborationSnapshotSchema>;
