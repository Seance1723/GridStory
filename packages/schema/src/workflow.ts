import { z } from 'zod';

const identifierSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9-]*$/, 'Identifiers must use lowercase kebab-case.');

const contentScopeSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  environmentId: z.string().min(1),
  locale: z.string().min(1),
});

export const workflowStateKindSchema = z.enum([
  'draft',
  'review',
  'approved',
  'published',
  'archived',
]);

export const workflowStateDefinitionSchema = z.object({
  id: identifierSchema,
  label: z.string().min(1).max(100),
  kind: workflowStateKindSchema,
  terminal: z.boolean().default(false),
});

export const workflowApprovalRuleSchema = z.object({
  minimumApprovals: z.number().int().min(1).max(20),
  allowedRoles: z.array(z.string().min(1)).min(1),
  separationOfDuties: z.boolean().default(true),
  dueAfterHours: z.number().int().min(1).max(2160).optional(),
  escalateToRoles: z.array(z.string().min(1)).default([]),
  fields: z.array(z.string().min(1)).default([]),
  locales: z.array(z.string().min(1)).default([]),
});

export const workflowActionDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    id: identifierSchema,
    label: z.string().min(1).max(100),
    type: z.literal('notification'),
    message: z.string().min(1).max(500),
    audienceRoles: z.array(z.string().min(1)).min(1).max(20),
    maxAttempts: z.number().int().min(1).max(20).default(5),
  }),
  z.object({
    id: identifierSchema,
    label: z.string().min(1).max(100),
    type: z.literal('webhook'),
    url: z.string().url().startsWith('https://'),
    eventName: identifierSchema,
    maxAttempts: z.number().int().min(1).max(20).default(8),
  }),
  z.object({
    id: identifierSchema,
    label: z.string().min(1).max(100),
    type: z.literal('cache-invalidate'),
    tags: z.array(z.string().min(1).max(200)).min(1).max(100),
    maxAttempts: z.number().int().min(1).max(20).default(5),
  }),
]);

export const workflowTransitionDefinitionSchema = z.object({
  id: identifierSchema,
  label: z.string().min(1).max(100),
  from: identifierSchema,
  to: identifierSchema,
  allowedRoles: z.array(z.string().min(1)).min(1),
  approval: workflowApprovalRuleSchema.optional(),
  actions: z.array(workflowActionDefinitionSchema).max(20).default([]),
});

export const workflowDefinitionInputSchema = z
  .object({
    name: z.string().min(1).max(160),
    contentType: z.string().min(1).max(100),
    version: z.number().int().min(1),
    initialStateId: identifierSchema,
    states: z.array(workflowStateDefinitionSchema).min(2).max(50),
    transitions: z.array(workflowTransitionDefinitionSchema).min(1).max(200),
  })
  .superRefine((definition, context) => {
    const states = new Set(definition.states.map((state) => state.id));
    if (states.size !== definition.states.length) {
      context.addIssue({
        code: 'custom',
        path: ['states'],
        message: 'Workflow state IDs must be unique.',
      });
    }
    if (!states.has(definition.initialStateId)) {
      context.addIssue({
        code: 'custom',
        path: ['initialStateId'],
        message: 'The initial state must reference a declared state.',
      });
    }
    const transitionIds = new Set<string>();
    for (const [index, transition] of definition.transitions.entries()) {
      if (transitionIds.has(transition.id)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'id'],
          message: 'Workflow transition IDs must be unique.',
        });
      }
      transitionIds.add(transition.id);
      const actionIds = new Set(transition.actions.map((action) => action.id));
      if (actionIds.size !== transition.actions.length) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'actions'],
          message: 'Workflow action IDs must be unique within a transition.',
        });
      }
      if (!states.has(transition.from) || !states.has(transition.to)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index],
          message: 'Transitions must reference declared states.',
        });
      }
      if (transition.from === transition.to) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index],
          message: 'Workflow transitions must change state.',
        });
      }
    }
    const published = definition.states.filter((state) => state.kind === 'published');
    if (published.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['states'],
        message: 'A workflow must declare exactly one published state.',
      });
    }
  });

export const workflowDefinitionSchema = contentScopeSchema.extend({
  id: identifierSchema,
  ...workflowDefinitionInputSchema.shape,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const workflowApprovalDecisionSchema = z.object({
  actorId: z.string().min(1),
  actorRoles: z.array(z.string().min(1)),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(2000).optional(),
  decidedAt: z.string().datetime({ offset: true }),
});

export const workflowApprovalRequestSchema = z.object({
  id: z.string().min(1),
  transitionId: identifierSchema,
  revisionId: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedByRoles: z.array(z.string().min(1)),
  requestedAt: z.string().datetime({ offset: true }),
  changedFields: z.array(z.string().min(1)),
  decisions: z.array(workflowApprovalDecisionSchema),
  dueAt: z.string().datetime({ offset: true }).optional(),
  escalatedAt: z.string().datetime({ offset: true }).optional(),
});

export const workflowScheduleSchema = z.object({
  id: z.string().min(1),
  transitionId: identifierSchema,
  revisionId: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedByRoles: z.array(z.string().min(1)),
  runAt: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1).max(100),
  state: z.enum(['pending', 'executed', 'cancelled', 'failed']),
  createdAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
  error: z.string().max(2000).optional(),
});

export const workflowNotificationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'transition-requested',
    'transition-completed',
    'approval-recorded',
    'approval-rejected',
    'approval-escalated',
    'schedule-created',
    'schedule-completed',
    'schedule-failed',
    'schedule-cancelled',
  ]),
  message: z.string().min(1).max(500),
  audienceRoles: z.array(z.string().min(1)),
  createdAt: z.string().datetime({ offset: true }),
});

export const workflowHistoryEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['initialized', 'transition', 'approval', 'rejection', 'schedule', 'escalation']),
  actorId: z.string().min(1),
  transitionId: identifierSchema.optional(),
  fromStateId: identifierSchema.optional(),
  toStateId: identifierSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }),
  details: z.record(z.string(), z.string()).default({}),
});

export const workflowInstanceSchema = contentScopeSchema.extend({
  entryId: z.string().min(1),
  contentType: z.string().min(1),
  workflowId: identifierSchema,
  workflowVersion: z.number().int().min(1),
  stateId: identifierSchema,
  revisionId: z.string().min(1),
  pendingApproval: workflowApprovalRequestSchema.optional(),
  schedules: z.array(workflowScheduleSchema),
  notifications: z.array(workflowNotificationSchema),
  history: z.array(workflowHistoryEventSchema),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type WorkflowStateKind = z.infer<typeof workflowStateKindSchema>;
export type WorkflowStateDefinition = z.infer<typeof workflowStateDefinitionSchema>;
export type WorkflowApprovalRule = z.infer<typeof workflowApprovalRuleSchema>;
export type WorkflowActionDefinition = z.infer<typeof workflowActionDefinitionSchema>;
export type WorkflowTransitionDefinition = z.infer<typeof workflowTransitionDefinitionSchema>;
export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionInputSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowApprovalDecision = z.infer<typeof workflowApprovalDecisionSchema>;
export type WorkflowApprovalRequest = z.infer<typeof workflowApprovalRequestSchema>;
export type WorkflowSchedule = z.infer<typeof workflowScheduleSchema>;
export type WorkflowNotification = z.infer<typeof workflowNotificationSchema>;
export type WorkflowHistoryEvent = z.infer<typeof workflowHistoryEventSchema>;
export type WorkflowInstance = z.infer<typeof workflowInstanceSchema>;
