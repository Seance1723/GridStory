import { z } from 'zod';
import { signedPluginManifestSchema } from './plugins.js';
import { resourceLimits } from './resource-limits.js';

const identifierSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const domainSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?=.{1,253}$)(?![-.])[a-z0-9.-]+(?<![-.])$/)
  .refine((value) => value.includes('.'), 'Publisher domain must contain a registrable suffix.');
const httpsUrlSchema = z
  .url()
  .max(500)
  .refine((value) => new URL(value).protocol === 'https:', 'URL must use HTTPS.');
const contentScopeSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  environmentId: z.string().min(1),
  locale: z.string().min(1),
});

export const marketplacePublisherStateSchema = z.enum(['pending', 'verified', 'suspended']);

export const marketplacePublisherInputSchema = z
  .object({
    id: identifierSchema,
    displayName: z.string().min(1).max(120),
    domain: domainSchema,
    websiteUrl: httpsUrlSchema,
    supportUrl: httpsUrlSchema,
    key: z
      .object({
        keyId: identifierSchema,
        algorithm: z.literal('ed25519'),
        publicKey: z.string().min(80).max(4_096),
      })
      .strict(),
  })
  .strict();

export type MarketplacePublisherInput = z.output<typeof marketplacePublisherInputSchema>;

export const marketplaceDomainChallengeSchema = z
  .object({
    recordName: z.string().min(1).max(300),
    token: z.string().min(32).max(200),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type MarketplaceDomainChallenge = z.output<typeof marketplaceDomainChallengeSchema>;

export const marketplacePublisherSchema = contentScopeSchema
  .extend({
    id: identifierSchema,
    displayName: z.string().min(1).max(120),
    domain: domainSchema,
    websiteUrl: httpsUrlSchema,
    supportUrl: httpsUrlSchema,
    key: z
      .object({
        keyId: identifierSchema,
        algorithm: z.literal('ed25519'),
        publicKey: z.string().min(80).max(4_096),
        fingerprint: sha256Schema,
      })
      .strict(),
    state: marketplacePublisherStateSchema,
    challenge: marketplaceDomainChallengeSchema.optional(),
    domainVerifiedAt: z.string().datetime().optional(),
    verifiedAt: z.string().datetime().optional(),
    verifiedBy: z.string().min(1).max(128).optional(),
    verificationEvidenceReference: z.string().min(1).max(500).optional(),
    verificationReason: z.string().min(1).max(500).optional(),
    suspendedAt: z.string().datetime().optional(),
    suspendedBy: z.string().min(1).max(128).optional(),
    suspensionReason: z.string().min(1).max(500).optional(),
    createdAt: z.string().datetime(),
    createdBy: z.string().min(1).max(128),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type MarketplacePublisher = z.output<typeof marketplacePublisherSchema>;

export const marketplacePublisherSummarySchema = marketplacePublisherSchema
  .omit({ challenge: true, key: true })
  .extend({
    key: z
      .object({
        keyId: identifierSchema,
        algorithm: z.literal('ed25519'),
        fingerprint: sha256Schema,
      })
      .strip(),
  })
  .strip();

export type MarketplacePublisherSummary = z.output<typeof marketplacePublisherSummarySchema>;

export const marketplaceArtifactInspectionSchema = z
  .object({
    inspector: z.object({ id: identifierSchema, version: z.string().min(1).max(100) }).strict(),
    completedAt: z.string().datetime(),
    evidenceReference: z.string().min(1).max(500),
    artifact: z.object({ sha256: sha256Schema, sizeBytes: z.number().int().positive() }).strict(),
    inventory: z
      .object({
        status: z.enum(['clean', 'blocked']),
        files: z.number().int().nonnegative().max(100_000),
        installScripts: z.number().int().nonnegative().max(1_000),
        nativeBinaries: z.number().int().nonnegative().max(1_000),
        pathTraversal: z.boolean(),
      })
      .strict(),
    sbom: z
      .object({
        format: z.enum(['spdx-json-2.3', 'spdx-json-3.0']),
        sha256: sha256Schema,
        packages: z.number().int().positive().max(100_000),
      })
      .strict(),
    provenance: z
      .object({
        verified: z.boolean(),
        subjectSha256: sha256Schema,
        builderId: z.string().min(1).max(500),
        sourceRepository: httpsUrlSchema,
        sourceRevision: z.string().min(7).max(128),
      })
      .strict(),
    malware: z.object({ status: z.enum(['clean', 'detected', 'unknown']) }).strict(),
    vulnerabilities: z
      .object({
        critical: z.number().int().nonnegative().max(100_000),
        high: z.number().int().nonnegative().max(100_000),
        moderate: z.number().int().nonnegative().max(100_000),
        low: z.number().int().nonnegative().max(100_000),
        identifiers: z.array(z.string().min(1).max(128)).max(1_000),
      })
      .strict(),
    licenses: z
      .object({
        status: z.enum(['allowed', 'denied', 'unknown']),
        identifiers: z.array(z.string().min(1).max(128)).max(1_000),
      })
      .strict(),
  })
  .strict();

export type MarketplaceArtifactInspection = z.output<typeof marketplaceArtifactInspectionSchema>;

export const marketplaceReviewCheckSchema = z
  .object({
    id: identifierSchema,
    category: z.enum([
      'publisher',
      'signature',
      'compatibility',
      'permissions',
      'inventory',
      'sbom',
      'provenance',
      'malware',
      'vulnerabilities',
      'licenses',
    ]),
    status: z.enum(['passed', 'warning', 'failed']),
    summary: z.string().min(1).max(500),
  })
  .strict();

export type MarketplaceReviewCheck = z.output<typeof marketplaceReviewCheckSchema>;

export const marketplaceReviewRunSchema = z
  .object({
    id: identifierSchema,
    policyVersion: z.literal(1),
    status: z.enum(['passed', 'blocked', 'error']),
    manifestDigest: sha256Schema,
    inspector: z.object({ id: identifierSchema, version: z.string().min(1).max(100) }).strict(),
    evidenceReference: z.string().min(1).max(500),
    completedAt: z.string().datetime(),
    reviewedBy: z.string().min(1).max(128),
    checks: z
      .array(marketplaceReviewCheckSchema)
      .min(1)
      .max(resourceLimits.marketplace.maximumReviewChecks),
  })
  .strict();

export type MarketplaceReviewRun = z.output<typeof marketplaceReviewRunSchema>;

export const marketplaceReleaseStateSchema = z.enum([
  'submitted',
  'reviewed',
  'approved',
  'rejected',
  'yanked',
]);

export const marketplaceReleaseSubmissionSchema = z
  .object({
    manifest: signedPluginManifestSchema,
    artifactReference: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((submission, context) => {
    if (!submission.manifest.marketplace) {
      context.addIssue({
        code: 'custom',
        path: ['manifest', 'marketplace'],
        message: 'Marketplace metadata is required for a marketplace release.',
      });
    }
  });

export type MarketplaceReleaseSubmission = z.output<typeof marketplaceReleaseSubmissionSchema>;

export const marketplaceReleaseSchema = contentScopeSchema
  .extend({
    id: identifierSchema,
    pluginId: identifierSchema,
    publisherId: identifierSchema,
    version: semverSchema,
    manifest: signedPluginManifestSchema,
    artifactReference: z.string().min(1).max(500),
    state: marketplaceReleaseStateSchema,
    submittedAt: z.string().datetime(),
    submittedBy: z.string().min(1).max(128),
    updatedAt: z.string().datetime(),
    reviews: z
      .array(marketplaceReviewRunSchema)
      .max(resourceLimits.marketplace.maximumReviewRunsPerRelease),
    approvedAt: z.string().datetime().optional(),
    approvedBy: z.string().min(1).max(128).optional(),
    approvalReason: z.string().min(1).max(500).optional(),
    rejectedAt: z.string().datetime().optional(),
    rejectedBy: z.string().min(1).max(128).optional(),
    rejectionReason: z.string().min(1).max(500).optional(),
    yankedAt: z.string().datetime().optional(),
    yankedBy: z.string().min(1).max(128).optional(),
    yankReason: z.string().min(1).max(500).optional(),
  })
  .strict();

export type MarketplaceRelease = z.output<typeof marketplaceReleaseSchema>;

export const marketplaceReleaseSummarySchema = marketplaceReleaseSchema
  .omit({
    artifactReference: true,
  })
  .strip();

export type MarketplaceReleaseSummary = z.output<typeof marketplaceReleaseSummarySchema>;

export const marketplaceSnapshotSchema = contentScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    version: z.number().int().nonnegative(),
    publishers: z
      .array(marketplacePublisherSchema)
      .max(resourceLimits.marketplace.maximumPublishers),
    releases: z.array(marketplaceReleaseSchema).max(resourceLimits.marketplace.maximumReleases),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type MarketplaceSnapshot = z.output<typeof marketplaceSnapshotSchema>;

export const marketplaceOverviewSchema = z
  .object({
    publishers: z
      .array(marketplacePublisherSummarySchema)
      .max(resourceLimits.marketplace.maximumPublishers),
    releases: z
      .array(marketplaceReleaseSummarySchema)
      .max(resourceLimits.marketplace.maximumReleases),
  })
  .strict();

export type MarketplaceOverview = z.output<typeof marketplaceOverviewSchema>;
