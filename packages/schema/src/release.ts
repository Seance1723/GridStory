import { z } from 'zod';

const contentScopeSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  environmentId: z.string().min(1),
  locale: z.string().min(1),
});

const identifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export const releaseStateSchema = z.enum([
  'draft',
  'validated',
  'scheduled',
  'executing',
  'published',
  'rolled-back',
  'failed',
]);

export const releaseRollbackPolicySchema = z
  .object({
    mode: z.enum(['manual', 'time-window', 'disabled']).default('manual'),
    windowHours: z.number().int().min(1).max(8760).optional(),
  })
  .superRefine((policy, context) => {
    if (policy.mode === 'time-window' && policy.windowHours === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['windowHours'],
        message: 'A time-window rollback policy requires windowHours.',
      });
    }
    if (policy.mode !== 'time-window' && policy.windowHours !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['windowHours'],
        message: 'windowHours is only valid for a time-window rollback policy.',
      });
    }
  });

export const releaseMemberInputSchema = z.object({
  entryId: z.string().min(1),
  revisionId: z.string().min(1),
});

export const releaseInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    entries: z.array(releaseMemberInputSchema).min(2).max(100),
    rollbackPolicy: releaseRollbackPolicySchema.default({ mode: 'manual' }),
  })
  .superRefine((release, context) => {
    const seen = new Set<string>();
    release.entries.forEach((entry, index) => {
      if (seen.has(entry.entryId)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'entryId'],
          message: 'A release cannot contain the same entry more than once.',
        });
      }
      seen.add(entry.entryId);
    });
  });

export const releaseMemberSchema = releaseMemberInputSchema.extend({
  contentType: z.string().min(1),
  previousPublishedRevisionId: z.string().min(1).nullable(),
});

export const releaseValidationIssueSchema = z.object({
  code: z.enum([
    'entry-not-found',
    'stale-revision',
    'content-invalid',
    'workflow-blocked',
    'quality-blocked',
    'route-collision',
    'reference-unpublished',
    'rollback-unavailable',
    'unknown',
  ]),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1).max(2000),
  entryId: z.string().min(1).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const releaseValidationResultSchema = z.object({
  valid: z.boolean(),
  checkedAt: z.string().datetime({ offset: true }),
  issues: z.array(releaseValidationIssueSchema).max(1000),
});

export const releaseScheduleSchema = z.object({
  runAt: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1).max(100),
  requestedBy: z.string().min(1),
  requestedByRoles: z.array(z.string().min(1)),
  state: z.enum(['pending', 'executed', 'cancelled', 'failed']),
  createdAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
  error: z.string().max(2000).optional(),
});

export const releaseSchema = contentScopeSchema.extend({
  id: identifierSchema,
  name: z.string().min(1).max(160),
  state: releaseStateSchema,
  entries: z.array(releaseMemberSchema).min(2).max(100),
  rollbackPolicy: releaseRollbackPolicySchema,
  validation: releaseValidationResultSchema.optional(),
  schedule: releaseScheduleSchema.optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  executedAt: z.string().datetime({ offset: true }).optional(),
  executedBy: z.string().min(1).optional(),
  rolledBackAt: z.string().datetime({ offset: true }).optional(),
  rolledBackBy: z.string().min(1).optional(),
  rollbackReason: z.string().min(1).max(2000).optional(),
  error: z.string().max(2000).optional(),
});

export const releasePreviewEntrySchema = releaseMemberSchema.extend({
  data: z.record(z.string(), z.unknown()),
  route: z.string().min(1).optional(),
});

export const releasePreviewSchema = z.object({
  releaseId: identifierSchema,
  generatedAt: z.string().datetime({ offset: true }),
  validation: releaseValidationResultSchema.optional(),
  entries: z.array(releasePreviewEntrySchema).min(2).max(100),
});

export type ReleaseState = z.infer<typeof releaseStateSchema>;
export type ReleaseRollbackPolicy = z.infer<typeof releaseRollbackPolicySchema>;
export type ReleaseMemberInput = z.infer<typeof releaseMemberInputSchema>;
export type ReleaseInput = z.infer<typeof releaseInputSchema>;
export type ReleaseMember = z.infer<typeof releaseMemberSchema>;
export type ReleaseValidationIssue = z.infer<typeof releaseValidationIssueSchema>;
export type ReleaseValidationResult = z.infer<typeof releaseValidationResultSchema>;
export type ReleaseSchedule = z.infer<typeof releaseScheduleSchema>;
export type Release = z.infer<typeof releaseSchema>;
export type ReleasePreviewEntry = z.infer<typeof releasePreviewEntrySchema>;
export type ReleasePreview = z.infer<typeof releasePreviewSchema>;
