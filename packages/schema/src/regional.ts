import { z } from 'zod';
import { resourceLimits } from './resource-limits.js';

const regionalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const regionalScopeSchema = z.object({
  organizationId: regionalIdSchema,
  tenantId: regionalIdSchema,
  workspaceId: regionalIdSchema,
  siteId: regionalIdSchema,
  environmentId: regionalIdSchema,
  locale: regionalIdSchema,
});

export const regionalReadPolicySchema = z
  .object({
    mode: z.enum(['primary-only', 'bounded-staleness']),
    maximumLagMs: z.number().int().min(0).max(resourceLimits.regional.maximumLagMs),
    failureMode: z.enum(['primary', 'unavailable']),
  })
  .strict();
export type RegionalReadPolicy = z.infer<typeof regionalReadPolicySchema>;

export const regionalReadRegionSchema = z
  .object({
    region: regionalIdSchema,
    adapter: regionalIdSchema,
    enabled: z.boolean(),
    residencyEvidenceReference: z.string().trim().min(1).max(1_024).optional(),
  })
  .strict();
export type RegionalReadRegion = z.infer<typeof regionalReadRegionSchema>;

export const regionalCachePartitionSchema = z
  .object({
    digest: sha256Schema,
    dimensions: z.tuple([
      z.literal('scope'),
      z.literal('served-region'),
      z.literal('consistency'),
      z.literal('topology-version'),
      z.literal('content-revision'),
    ]),
    attestedAt: timestampSchema,
  })
  .strict();
export type RegionalCachePartition = z.infer<typeof regionalCachePartitionSchema>;

export const regionalReadEvidenceSchema = regionalScopeSchema
  .extend({
    adapter: regionalIdSchema,
    servedRegion: regionalIdSchema,
    role: z.literal('replica'),
    topologyVersion: z.number().int().positive(),
    observedAt: timestampSchema,
    lagMs: z.number().int().min(0).max(resourceLimits.regional.maximumLagMs),
    watermark: z.string().trim().min(1).max(256),
    residencyEvidenceReference: z.string().trim().min(1).max(1_024).optional(),
    cachePartition: regionalCachePartitionSchema.optional(),
  })
  .strict();
export type RegionalReadEvidence = z.infer<typeof regionalReadEvidenceSchema>;

export const regionalConsistencyIndicatorSchema = z
  .object({
    servedRegion: regionalIdSchema,
    role: z.enum(['primary', 'replica']),
    consistency: z.enum(['strong', 'bounded-staleness']),
    observedAt: timestampSchema,
    lagMs: z.number().int().min(0).max(resourceLimits.regional.maximumLagMs),
    topologyVersion: z.number().int().positive(),
    contentRevision: z.string().trim().min(1).max(256),
    watermarkDigest: sha256Schema.optional(),
    cacheMode: z.enum(['shared', 'private']),
    fallbackUsed: z.boolean(),
  })
  .strict();
export type RegionalConsistencyIndicator = z.infer<typeof regionalConsistencyIndicatorSchema>;

export const regionalBackupEvidenceSchema = z
  .object({
    reference: z.string().trim().min(8).max(1_024),
    sha256: sha256Schema,
    verifiedAt: timestampSchema,
  })
  .strict();
export type RegionalBackupEvidence = z.infer<typeof regionalBackupEvidenceSchema>;

export const regionalFailoverReadinessSchema = regionalScopeSchema
  .extend({
    adapter: regionalIdSchema,
    requestId: z.string().uuid(),
    sourceRegion: regionalIdSchema,
    targetRegion: regionalIdSchema,
    topologyVersion: z.number().int().positive(),
    checkedAt: timestampSchema,
    ready: z.boolean(),
    caughtUp: z.boolean(),
    replicationLagMs: z.number().int().min(0).max(resourceLimits.regional.maximumLagMs),
    estimatedDataLossMs: z.number().int().min(0).max(resourceLimits.regional.maximumDataLossMs),
    evidenceDigest: sha256Schema,
  })
  .strict();
export type RegionalFailoverReadiness = z.infer<typeof regionalFailoverReadinessSchema>;

export const regionalFailoverResultSchema = regionalScopeSchema
  .extend({
    adapter: regionalIdSchema,
    requestId: z.string().uuid(),
    sourceRegion: regionalIdSchema,
    targetRegion: regionalIdSchema,
    topologyVersion: z.number().int().positive(),
    outcome: z.enum(['pending', 'succeeded', 'failed']),
    activeRegion: regionalIdSchema.optional(),
    sourceWritable: z.boolean(),
    targetWritable: z.boolean(),
    completedAt: timestampSchema.optional(),
    evidenceDigest: sha256Schema,
  })
  .strict();
export type RegionalFailoverResult = z.infer<typeof regionalFailoverResultSchema>;

export const regionalFailoverPlanSchema = regionalScopeSchema
  .extend({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    state: z.enum(['preview', 'approved', 'executing', 'ambiguous', 'succeeded', 'failed']),
    documentVersion: z.number().int().nonnegative(),
    topologyVersion: z.number().int().positive(),
    sourceRegion: regionalIdSchema,
    targetRegion: regionalIdSchema,
    mode: z.enum(['planned', 'emergency']),
    reason: z.string().trim().min(1).max(2_000),
    expectedRpoSeconds: z.number().int().min(0).max(604_800),
    expectedRtoSeconds: z.number().int().min(1).max(604_800),
    backup: regionalBackupEvidenceSchema,
    readiness: regionalFailoverReadinessSchema,
    digest: sha256Schema,
    createdBy: regionalIdSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    approval: z
      .object({
        digest: sha256Schema,
        approvedBy: regionalIdSchema,
        approvedAt: timestampSchema,
        reauthenticatedAt: timestampSchema,
        reason: z.string().trim().min(1).max(2_000),
        acceptDataLoss: z.boolean(),
      })
      .strict()
      .optional(),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
    result: regionalFailoverResultSchema.optional(),
  })
  .strict();
export type RegionalFailoverPlan = z.infer<typeof regionalFailoverPlanSchema>;

export const regionalDocumentSchema = regionalScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    version: z.number().int().nonnegative(),
    state: z.enum(['disabled', 'enabled']),
    activeControlRegion: regionalIdSchema,
    activeControlEvidenceReference: z.string().trim().min(1).max(1_024).optional(),
    topologyVersion: z.number().int().positive(),
    readPolicy: regionalReadPolicySchema,
    readRegions: z.array(regionalReadRegionSchema).max(resourceLimits.regional.maximumReadRegions),
    failoverAdapter: regionalIdSchema.optional(),
    operations: z.array(regionalFailoverPlanSchema).max(resourceLimits.regional.maximumOperations),
    updatedBy: regionalIdSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((document, context) => {
    const regions = document.readRegions.map((item) => item.region);
    if (new Set(regions).size !== regions.length) {
      context.addIssue({
        code: 'custom',
        path: ['readRegions'],
        message: 'Read regions must be unique.',
      });
    }
    if (document.state === 'enabled' && document.readPolicy.mode === 'bounded-staleness') {
      if (!document.readRegions.some((item) => item.enabled)) {
        context.addIssue({
          code: 'custom',
          path: ['readRegions'],
          message: 'Bounded-staleness requires at least one enabled read region.',
        });
      }
    }
  });
export type RegionalDocument = z.infer<typeof regionalDocumentSchema>;

export const regionalPolicyInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    state: z.enum(['disabled', 'enabled']),
    activeControlRegion: regionalIdSchema,
    activeControlEvidenceReference: z.string().trim().min(1).max(1_024).optional(),
    readPolicy: regionalReadPolicySchema,
    readRegions: z.array(regionalReadRegionSchema).max(resourceLimits.regional.maximumReadRegions),
    failoverAdapter: regionalIdSchema.optional(),
  })
  .strict()
  .superRefine((policy, context) => {
    const regions = policy.readRegions.map((item) => item.region);
    if (new Set(regions).size !== regions.length) {
      context.addIssue({
        code: 'custom',
        path: ['readRegions'],
        message: 'Read regions must be unique.',
      });
    }
    if (
      policy.state === 'enabled' &&
      policy.readPolicy.mode === 'bounded-staleness' &&
      !policy.readRegions.some((item) => item.enabled)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['readRegions'],
        message: 'Bounded-staleness requires at least one enabled read region.',
      });
    }
  });
export type RegionalPolicyInput = z.infer<typeof regionalPolicyInputSchema>;

export const regionalFailoverPreflightInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    targetRegion: regionalIdSchema,
    mode: z.enum(['planned', 'emergency']),
    reason: z.string().trim().min(1).max(2_000),
    expectedRpoSeconds: z.number().int().min(0).max(604_800),
    expectedRtoSeconds: z.number().int().min(1).max(604_800),
    backup: regionalBackupEvidenceSchema,
  })
  .strict();
export type RegionalFailoverPreflightInput = z.infer<typeof regionalFailoverPreflightInputSchema>;

export const regionalFailoverApprovalInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    digest: sha256Schema,
    reason: z.string().trim().min(1).max(2_000),
    acceptDataLoss: z.boolean(),
  })
  .strict();
export type RegionalFailoverApprovalInput = z.infer<typeof regionalFailoverApprovalInputSchema>;

export const regionalExpectedVersionInputSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export type RegionalExpectedVersionInput = z.infer<typeof regionalExpectedVersionInputSchema>;
