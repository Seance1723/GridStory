import { z } from 'zod';

const migrationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const migrationNameSchema = z.string().trim().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sourcePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_$:-]+(?:\.[A-Za-z0-9_$:-]+)*$/u)
  .refine(
    (path) =>
      path
        .split('.')
        .every((segment) => !['__proto__', 'constructor', 'prototype'].includes(segment)),
    'Source paths cannot contain prototype keys.',
  );

export const migrationScopeSchema = z.object({
  organizationId: migrationIdSchema,
  tenantId: migrationIdSchema,
  workspaceId: migrationIdSchema,
  siteId: migrationIdSchema,
  environmentId: migrationIdSchema,
  locale: migrationIdSchema,
});

export const migrationProviderSchema = z.enum(['contentful', 'sanity', 'wordpress']);
export type MigrationProvider = z.infer<typeof migrationProviderSchema>;

export const migrationSourceDescriptorSchema = z.object({
  id: migrationIdSchema,
  provider: migrationProviderSchema,
  name: migrationNameSchema,
  supportsDelta: z.boolean(),
  reportsDeletions: z.boolean(),
  includesAssets: z.boolean(),
});
export type MigrationSourceDescriptor = z.infer<typeof migrationSourceDescriptorSchema>;

export const migrationSourceRecordSchema = z.object({
  externalId: migrationIdSchema,
  sourceType: z.string().trim().min(1).max(256),
  status: z.enum(['draft', 'published', 'deleted']),
  locale: z.string().trim().min(1).max(64).optional(),
  updatedAt: timestampSchema.optional(),
  data: z.record(z.string(), z.unknown()),
});
export type MigrationSourceRecord = z.infer<typeof migrationSourceRecordSchema>;

export const migrationSourceSnapshotSchema = z.object({
  kind: z.enum(['full', 'delta']),
  records: z.array(migrationSourceRecordSchema).max(1_000),
  checkpoint: z.string().min(1).max(8_192),
  complete: z.literal(true),
});
export type MigrationSourceSnapshot = z.infer<typeof migrationSourceSnapshotSchema>;

export const migrationTransformSchema = z.enum(['copy', 'string', 'number', 'boolean', 'slug']);
export type MigrationTransform = z.infer<typeof migrationTransformSchema>;

export const migrationFieldMappingSchema = z.object({
  sourcePath: sourcePathSchema,
  targetField: migrationIdSchema,
  transform: migrationTransformSchema.default('copy'),
  required: z.boolean().default(false),
});
export type MigrationFieldMapping = z.infer<typeof migrationFieldMappingSchema>;

export const migrationRecipeInputSchema = z
  .object({
    id: migrationIdSchema,
    name: migrationNameSchema,
    provider: migrationProviderSchema,
    sourceType: z.string().trim().min(1).max(256),
    targetContentType: migrationIdSchema,
    sourceLocale: z.string().trim().min(1).max(64).optional(),
    publicationMode: z.enum(['draft', 'mirror-source']).default('draft'),
    fields: z.array(migrationFieldMappingSchema).min(1).max(100),
  })
  .superRefine((recipe, context) => {
    const targets = new Set<string>();
    for (const [index, field] of recipe.fields.entries()) {
      if (targets.has(field.targetField)) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index, 'targetField'],
          message: `Target field ${field.targetField} is mapped more than once.`,
        });
      }
      targets.add(field.targetField);
    }
  });
export type MigrationRecipeInput = z.infer<typeof migrationRecipeInputSchema>;

export const migrationRecipeSchema = migrationRecipeInputSchema.and(
  z.object({
    version: z.number().int().positive(),
    createdBy: migrationIdSchema,
    createdAt: timestampSchema,
    updatedBy: migrationIdSchema,
    updatedAt: timestampSchema,
  }),
);
export type MigrationRecipe = z.infer<typeof migrationRecipeSchema>;

export const migrationProjectInputSchema = z.object({
  id: migrationIdSchema,
  name: migrationNameSchema,
  sourceId: migrationIdSchema,
  recipeIds: z.array(migrationIdSchema).min(1).max(100),
  mode: z.enum(['one-time', 'dual-run']).default('one-time'),
});
export type MigrationProjectInput = z.infer<typeof migrationProjectInputSchema>;

export const migrationProjectStateInputSchema = z.object({
  state: z.enum(['active', 'paused']),
});
export type MigrationProjectStateInput = z.infer<typeof migrationProjectStateInputSchema>;

export const migrationProjectSchema = migrationProjectInputSchema.extend({
  provider: migrationProviderSchema,
  state: z.enum(['active', 'paused']),
  version: z.number().int().positive(),
  checkpoint: z.string().min(1).max(8_192).optional(),
  checkpointDigest: sha256Schema.optional(),
  recipeVersions: z.record(migrationIdSchema, z.number().int().positive()),
  lastFullSourceIds: z.array(migrationIdSchema).max(1_000),
  lastSyncedAt: timestampSchema.optional(),
  createdBy: migrationIdSchema,
  createdAt: timestampSchema,
  updatedBy: migrationIdSchema,
  updatedAt: timestampSchema,
});
export type MigrationProject = z.infer<typeof migrationProjectSchema>;

export const migrationProjectSummarySchema = migrationProjectSchema.omit({
  checkpoint: true,
  lastFullSourceIds: true,
});
export type MigrationProjectSummary = z.infer<typeof migrationProjectSummarySchema>;

export const migrationEffectActionSchema = z.enum([
  'create',
  'update',
  'noop',
  'source-deleted',
  'blocked',
]);
export type MigrationEffectAction = z.infer<typeof migrationEffectActionSchema>;

export const migrationBlockerCodeSchema = z.enum([
  'unmapped-source-type',
  'unsupported-media',
  'missing-required-field',
  'invalid-transform',
  'invalid-target-content',
  'target-drift',
  'target-missing',
  'target-unpublished',
  'source-deleted',
  'source-drift',
  'incomplete-snapshot',
  'project-changed',
  'recipe-changed',
]);
export type MigrationBlockerCode = z.infer<typeof migrationBlockerCodeSchema>;

export const migrationBlockerSchema = z.object({
  code: migrationBlockerCodeSchema,
  message: z.string().trim().min(1).max(1_000),
  externalId: migrationIdSchema.optional(),
  targetEntryId: migrationIdSchema.optional(),
});
export type MigrationBlocker = z.infer<typeof migrationBlockerSchema>;

export const migrationPlanEffectSchema = z.object({
  externalId: migrationIdSchema,
  sourceType: z.string().trim().min(1).max(256),
  sourceStatus: z.enum(['draft', 'published', 'deleted']),
  sourceChecksum: sha256Schema,
  action: migrationEffectActionSchema,
  publish: z.boolean(),
  recipeId: migrationIdSchema.optional(),
  recipeVersion: z.number().int().positive().optional(),
  targetEntryId: migrationIdSchema.optional(),
  expectedTargetRevisionId: migrationIdSchema.optional(),
  mappedData: z.record(z.string(), z.unknown()).optional(),
  dataChecksum: sha256Schema.optional(),
  blockers: z.array(migrationBlockerSchema).max(20),
});
export type MigrationPlanEffect = z.infer<typeof migrationPlanEffectSchema>;

export const migrationPlanCountsSchema = z.object({
  create: z.number().int().nonnegative(),
  update: z.number().int().nonnegative(),
  publish: z.number().int().nonnegative(),
  noop: z.number().int().nonnegative(),
  sourceDeleted: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type MigrationPlanCounts = z.infer<typeof migrationPlanCountsSchema>;

export const migrationPlanSchema = z.object({
  id: migrationIdSchema,
  projectId: migrationIdSchema,
  projectVersion: z.number().int().positive(),
  state: z.enum(['preview', 'executing', 'completed', 'failed', 'expired']),
  snapshotKind: z.enum(['full', 'delta']),
  effects: z.array(migrationPlanEffectSchema).max(1_000),
  counts: migrationPlanCountsSchema,
  digest: sha256Schema,
  nextCheckpoint: z.string().min(1).max(8_192),
  fullSourceIds: z.array(migrationIdSchema).max(1_000).optional(),
  createdBy: migrationIdSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  completedAt: timestampSchema.optional(),
  error: z.string().trim().min(1).max(2_000).optional(),
});
export type MigrationPlan = z.infer<typeof migrationPlanSchema>;

export const migrationPlanExecutionInputSchema = z.object({ digest: sha256Schema });
export type MigrationPlanExecutionInput = z.infer<typeof migrationPlanExecutionInputSchema>;

export const migrationPlanSummarySchema = migrationPlanSchema
  .extend({
    effects: z.array(migrationPlanEffectSchema.omit({ mappedData: true })).max(1_000),
  })
  .omit({ nextCheckpoint: true, fullSourceIds: true });
export type MigrationPlanSummary = z.infer<typeof migrationPlanSummarySchema>;

export const migrationLinkSchema = z.object({
  projectId: migrationIdSchema,
  externalId: migrationIdSchema,
  sourceType: z.string().trim().min(1).max(256),
  targetEntryId: migrationIdSchema,
  recipeId: migrationIdSchema,
  recipeVersion: z.number().int().positive(),
  state: z.enum(['pending', 'applied']),
  sourceStatus: z.enum(['draft', 'published', 'deleted']),
  sourceChecksum: sha256Schema,
  dataChecksum: sha256Schema,
  lastAppliedRevisionId: migrationIdSchema.optional(),
  lastPublishedRevisionId: migrationIdSchema.optional(),
  planId: migrationIdSchema,
  updatedAt: timestampSchema,
});
export type MigrationLink = z.infer<typeof migrationLinkSchema>;

export const migrationRunSchema = z.object({
  id: migrationIdSchema,
  projectId: migrationIdSchema,
  planId: migrationIdSchema,
  state: z.enum(['succeeded', 'failed']),
  counts: migrationPlanCountsSchema,
  actorId: migrationIdSchema,
  startedAt: timestampSchema,
  completedAt: timestampSchema,
  error: z.string().trim().min(1).max(2_000).optional(),
});
export type MigrationRun = z.infer<typeof migrationRunSchema>;

export const migrationCutoverReportSchema = z.object({
  id: migrationIdSchema,
  projectId: migrationIdSchema,
  ready: z.boolean(),
  digest: sha256Schema,
  sourceDigest: sha256Schema,
  sourceCount: z.number().int().nonnegative(),
  linkedCount: z.number().int().nonnegative(),
  currentCount: z.number().int().nonnegative(),
  publishedCount: z.number().int().nonnegative(),
  blockers: z.array(migrationBlockerSchema).max(1_000),
  validatedBy: migrationIdSchema,
  validatedAt: timestampSchema,
});
export type MigrationCutoverReport = z.infer<typeof migrationCutoverReportSchema>;

export const migrationSnapshotSchema = migrationScopeSchema.extend({
  schemaVersion: z.literal(1),
  version: z.number().int().nonnegative(),
  recipes: z.array(migrationRecipeSchema).max(100),
  projects: z.array(migrationProjectSchema).max(50),
  links: z.array(migrationLinkSchema).max(50_000),
  plans: z.array(migrationPlanSchema).max(20),
  runs: z.array(migrationRunSchema).max(100),
  cutoverReports: z.array(migrationCutoverReportSchema).max(20),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type MigrationSnapshot = z.infer<typeof migrationSnapshotSchema>;
