import { z } from 'zod';

const governanceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const governanceNameSchema = z.string().trim().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const governanceScopeSchema = z.object({
  organizationId: governanceIdSchema,
  tenantId: governanceIdSchema,
  workspaceId: governanceIdSchema,
  siteId: governanceIdSchema,
  environmentId: governanceIdSchema,
  locale: governanceIdSchema,
});

export const governanceResourceTypeSchema = z.enum(['content', 'asset', 'identity', 'plugin']);
export type GovernanceResourceType = z.infer<typeof governanceResourceTypeSchema>;

export const dataClassificationSchema = z.enum([
  'public',
  'internal',
  'confidential',
  'personal',
  'sensitive-personal',
]);
export type DataClassification = z.infer<typeof dataClassificationSchema>;

export const governanceResourceTargetSchema = z.object({
  type: governanceResourceTypeSchema,
  id: governanceIdSchema,
  version: z.string().trim().min(1).max(256).optional(),
  external: z.boolean().default(false),
});
export type GovernanceResourceTarget = z.infer<typeof governanceResourceTargetSchema>;

export const retentionRuleSchema = z.object({
  id: governanceIdSchema,
  name: governanceNameSchema,
  resourceType: governanceResourceTypeSchema,
  classification: dataClassificationSchema,
  retainForDays: z.number().int().min(1).max(36_500),
  action: z.enum(['delete', 'anonymize']),
  enabled: z.boolean(),
  createdBy: governanceIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type RetentionRule = z.infer<typeof retentionRuleSchema>;

export const dataSubjectSchema = z.object({
  id: governanceIdSchema,
  reference: z.string().trim().min(1).max(256),
  status: z.enum(['active', 'restricted', 'erased']),
  createdBy: governanceIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type DataSubject = z.infer<typeof dataSubjectSchema>;

export const subjectResourceLinkSchema = z.object({
  id: governanceIdSchema,
  subjectId: governanceIdSchema,
  resource: governanceResourceTargetSchema,
  classification: dataClassificationSchema,
  retentionBasisAt: timestampSchema,
  createdBy: governanceIdSchema,
  createdAt: timestampSchema,
});
export type SubjectResourceLink = z.infer<typeof subjectResourceLinkSchema>;

export const governanceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scope') }),
  z.object({ kind: z.literal('subject'), subjectId: governanceIdSchema }),
  z.object({ kind: z.literal('resource'), resource: governanceResourceTargetSchema }),
]);
export type GovernanceTarget = z.infer<typeof governanceTargetSchema>;

export const legalHoldSchema = z.object({
  id: governanceIdSchema,
  matter: governanceNameSchema,
  reason: z.string().trim().min(1).max(2_000),
  target: governanceTargetSchema,
  status: z.enum(['active', 'released']),
  createdBy: governanceIdSchema,
  createdAt: timestampSchema,
  releasedBy: governanceIdSchema.optional(),
  releasedAt: timestampSchema.optional(),
  releaseReason: z.string().trim().min(1).max(2_000).optional(),
});
export type LegalHold = z.infer<typeof legalHoldSchema>;

export const processingRestrictionSchema = z.object({
  id: governanceIdSchema,
  subjectId: governanceIdSchema,
  reason: z.string().trim().min(1).max(2_000),
  status: z.enum(['active', 'released']),
  createdBy: governanceIdSchema,
  createdAt: timestampSchema,
  releasedBy: governanceIdSchema.optional(),
  releasedAt: timestampSchema.optional(),
});
export type ProcessingRestriction = z.infer<typeof processingRestrictionSchema>;

export const dataSubjectRequestTypeSchema = z.enum(['access', 'export', 'restriction', 'erasure']);
export type DataSubjectRequestType = z.infer<typeof dataSubjectRequestTypeSchema>;

export const dataSubjectRequestSchema = z.object({
  id: governanceIdSchema,
  subjectId: governanceIdSchema,
  type: dataSubjectRequestTypeSchema,
  state: z.enum([
    'requested',
    'identity-verified',
    'approved',
    'rejected',
    'executing',
    'completed',
    'cancelled',
  ]),
  reason: z.string().trim().min(1).max(2_000),
  requestedBy: governanceIdSchema,
  requestedAt: timestampSchema,
  verification: z
    .object({
      method: z.enum(['customer-process', 'federated-session', 'manual-review']),
      evidenceReference: z.string().trim().min(1).max(512),
      verifiedBy: governanceIdSchema,
      verifiedAt: timestampSchema,
    })
    .optional(),
  reviewedBy: governanceIdSchema.optional(),
  reviewedAt: timestampSchema.optional(),
  reviewReason: z.string().trim().min(1).max(2_000).optional(),
  planId: governanceIdSchema.optional(),
  completedAt: timestampSchema.optional(),
});
export type DataSubjectRequest = z.infer<typeof dataSubjectRequestSchema>;

export const governancePlanCandidateSchema = z.object({
  id: governanceIdSchema,
  subjectId: governanceIdSchema.optional(),
  linkId: governanceIdSchema.optional(),
  ruleId: governanceIdSchema.optional(),
  resource: governanceResourceTargetSchema,
  action: z.enum(['delete', 'anonymize']),
  state: z.enum(['eligible', 'blocked', 'completed', 'failed']),
  blockers: z.array(z.string().trim().min(1).max(500)).max(20),
  expectedVersion: z.string().trim().min(1).max(256).optional(),
  receipt: z
    .object({
      processor: governanceIdSchema,
      effect: z.string().trim().min(1).max(500),
      externalReceipt: z.string().trim().min(1).max(1_024).optional(),
      completedAt: timestampSchema,
    })
    .optional(),
  error: z.string().trim().min(1).max(2_000).optional(),
});
export type GovernancePlanCandidate = z.infer<typeof governancePlanCandidateSchema>;

export const governanceBackupEvidenceSchema = z.object({
  reference: z.string().trim().min(8).max(1_024),
  sha256: sha256Schema,
  verifiedAt: timestampSchema,
});
export type GovernanceBackupEvidence = z.infer<typeof governanceBackupEvidenceSchema>;

export const governancePlanSchema = governanceScopeSchema.extend({
  id: governanceIdSchema,
  kind: z.enum(['retention', 'subject-erasure']),
  requestId: governanceIdSchema.optional(),
  subjectId: governanceIdSchema.optional(),
  state: z.enum(['preview', 'approved', 'executing', 'completed', 'blocked', 'cancelled']),
  documentVersion: z.number().int().nonnegative(),
  candidates: z.array(governancePlanCandidateSchema).max(10_000),
  digest: sha256Schema,
  createdBy: governanceIdSchema,
  createdAt: timestampSchema,
  approval: z
    .object({
      digest: sha256Schema,
      approvedBy: governanceIdSchema,
      approvedAt: timestampSchema,
      reauthenticatedAt: timestampSchema,
      reason: z.string().trim().min(1).max(2_000),
      backup: governanceBackupEvidenceSchema,
    })
    .optional(),
  startedAt: timestampSchema.optional(),
  completedAt: timestampSchema.optional(),
  workerId: governanceIdSchema.optional(),
});
export type GovernancePlan = z.infer<typeof governancePlanSchema>;

export const customerManagedKeyReferenceSchema = z.object({
  adapter: z.enum(['aws-kms', 'google-cloud-kms', 'custom']),
  keyId: z.string().trim().min(1).max(2_048),
  keyVersion: z.string().trim().min(1).max(512).optional(),
  expectedRegion: governanceIdSchema,
  updatedBy: governanceIdSchema,
  updatedAt: timestampSchema,
});
export type CustomerManagedKeyReference = z.infer<typeof customerManagedKeyReferenceSchema>;

export const residencyRuleSchema = z.object({
  resourceType: governanceResourceTypeSchema,
  allowedRegions: z.array(governanceIdSchema).min(1).max(100),
});
export type ResidencyRule = z.infer<typeof residencyRuleSchema>;

export const residencyPolicySchema = z.object({
  homeRegion: governanceIdSchema,
  requireAttestation: z.boolean(),
  rules: z.array(residencyRuleSchema).min(1).max(20),
  updatedBy: governanceIdSchema,
  updatedAt: timestampSchema,
});
export type ResidencyPolicy = z.infer<typeof residencyPolicySchema>;

export const governanceEventActionSchema = z.enum([
  'governance.policy.updated',
  'governance.subject.created',
  'governance.subject.linked',
  'governance.hold.created',
  'governance.hold.released',
  'governance.restriction.created',
  'governance.restriction.released',
  'governance.request.created',
  'governance.request.verified',
  'governance.request.approved',
  'governance.request.rejected',
  'governance.request.exported',
  'governance.plan.created',
  'governance.plan.approved',
  'governance.plan.blocked',
  'governance.plan.completed',
]);
export type GovernanceEventAction = z.infer<typeof governanceEventActionSchema>;

export const governanceEventSchema = governanceScopeSchema.extend({
  id: governanceIdSchema,
  sequence: z.number().int().positive(),
  action: governanceEventActionSchema,
  outcome: z.enum(['success', 'denied', 'error']),
  actorId: governanceIdSchema,
  subjectId: governanceIdSchema.optional(),
  resource: governanceResourceTargetSchema.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  occurredAt: timestampSchema,
  previousHash: sha256Schema.optional(),
  eventHash: sha256Schema,
});
export type GovernanceEvent = z.infer<typeof governanceEventSchema>;

export const governanceSnapshotSchema = governanceScopeSchema.extend({
  version: z.number().int().nonnegative(),
  retentionRules: z.array(retentionRuleSchema).max(1_000),
  subjects: z.array(dataSubjectSchema).max(100_000),
  links: z.array(subjectResourceLinkSchema).max(1_000_000),
  holds: z.array(legalHoldSchema).max(100_000),
  restrictions: z.array(processingRestrictionSchema).max(100_000),
  requests: z.array(dataSubjectRequestSchema).max(100_000),
  plans: z.array(governancePlanSchema).max(100_000),
  keyReference: customerManagedKeyReferenceSchema.optional(),
  residencyPolicy: residencyPolicySchema,
  events: z.array(governanceEventSchema).max(100_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type GovernanceSnapshot = z.infer<typeof governanceSnapshotSchema>;

export const governancePolicyInputSchema = z.object({
  retentionRules: z
    .array(retentionRuleSchema.omit({ createdBy: true, createdAt: true, updatedAt: true }))
    .max(1_000),
  residencyPolicy: residencyPolicySchema.omit({ updatedBy: true, updatedAt: true }),
  keyReference: customerManagedKeyReferenceSchema
    .omit({ updatedBy: true, updatedAt: true })
    .nullable()
    .optional(),
});
export type GovernancePolicyInput = z.infer<typeof governancePolicyInputSchema>;

export const dataSubjectInputSchema = z.object({ reference: z.string().trim().min(1).max(256) });
export const subjectResourceLinkInputSchema = subjectResourceLinkSchema.omit({
  id: true,
  subjectId: true,
  createdBy: true,
  createdAt: true,
});
export const legalHoldInputSchema = legalHoldSchema.omit({
  id: true,
  status: true,
  createdBy: true,
  createdAt: true,
  releasedBy: true,
  releasedAt: true,
  releaseReason: true,
});
export const dataSubjectRequestInputSchema = dataSubjectRequestSchema.pick({
  subjectId: true,
  type: true,
  reason: true,
});
export const governanceRequestVerificationInputSchema = z.object({
  method: z.enum(['customer-process', 'federated-session', 'manual-review']),
  evidenceReference: z.string().trim().min(1).max(512),
});
export const governanceRequestReviewInputSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(1).max(2_000),
});
export const governancePlanApprovalInputSchema = z.object({
  digest: sha256Schema,
  reason: z.string().trim().min(1).max(2_000),
  backup: governanceBackupEvidenceSchema,
});
export const governanceReasonInputSchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
});
export const governanceExportInputSchema = z.object({ encrypt: z.boolean().default(true) });

export const governanceExportEnvelopeSchema = z.object({
  format: z.literal('gridstory.governance.export.envelope'),
  version: z.literal(1),
  requestId: governanceIdSchema,
  algorithm: z.literal('A256GCM'),
  key: customerManagedKeyReferenceSchema.pick({
    adapter: true,
    keyId: true,
    keyVersion: true,
    expectedRegion: true,
  }),
  iv: z.string().min(16).max(64),
  authenticationTag: z.string().min(16).max(64),
  wrappedDataKey: z.string().min(1).max(65_536),
  ciphertext: z.string().min(1).max(22_369_624),
  plaintextSha256: sha256Schema,
});
export type GovernanceExportEnvelope = z.infer<typeof governanceExportEnvelopeSchema>;

export const governanceExportPackageSchema = z.object({
  format: z.literal('gridstory.governance.subject-export'),
  version: z.literal(1),
  scope: governanceScopeSchema,
  requestId: governanceIdSchema,
  subject: dataSubjectSchema,
  generatedAt: timestampSchema,
  resources: z
    .array(
      z.object({
        linkId: governanceIdSchema,
        resource: governanceResourceTargetSchema,
        classification: dataClassificationSchema,
        data: z.unknown(),
      }),
    )
    .max(10_000),
  unsupported: z.array(governanceResourceTargetSchema).max(10_000),
  checksum: sha256Schema,
});
export type GovernanceExportPackage = z.infer<typeof governanceExportPackageSchema>;

export const placementAttestationSchema = z.object({
  adapter: governanceIdSchema,
  resourceType: governanceResourceTypeSchema,
  purpose: z.enum(['write', 'export', 'erase', 'key-use']),
  regions: z.array(governanceIdSchema).min(1).max(100),
  checkedAt: timestampSchema,
  evidenceReference: z.string().trim().min(1).max(1_024).optional(),
});
export type PlacementAttestation = z.infer<typeof placementAttestationSchema>;

export const residencyStatusSchema = z.object({
  scope: governanceScopeSchema,
  checkedAt: timestampSchema,
  compliant: z.boolean(),
  attestations: z.array(placementAttestationSchema).max(100),
  violations: z.array(z.string().trim().min(1).max(1_000)).max(100),
});
export type ResidencyStatus = z.infer<typeof residencyStatusSchema>;
