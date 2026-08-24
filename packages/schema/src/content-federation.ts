import { z } from 'zod';
import { contentSchemaDefinitionSchema } from './contracts.js';
import { resourceLimits } from './resource-limits.js';

export const GRIDSTORY_CONTENT_FEDERATION_PROTOCOL = 'gridstory.content-federation.v1' as const;

const federationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const httpsUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'Federation URLs must be credential-free HTTPS URLs.');

export const contentFederationScopeSchema = z
  .object({
    organizationId: federationIdSchema,
    tenantId: federationIdSchema,
    workspaceId: federationIdSchema,
    siteId: federationIdSchema,
    environmentId: federationIdSchema,
    locale: federationIdSchema,
  })
  .strict();

export const federationPublicKeySchema = z
  .object({
    keyId: federationIdSchema,
    algorithm: z.literal('ed25519'),
    publicKey: z.string().min(32).max(8_192),
  })
  .strict();
export type FederationPublicKey = z.infer<typeof federationPublicKeySchema>;

export const federationAttributedAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    url: httpsUrlSchema.optional(),
  })
  .strict();
export type FederationAttributedAgent = z.infer<typeof federationAttributedAgentSchema>;

export const federationAttributionTermsSchema = z
  .object({
    licenseUrl: httpsUrlSchema,
    creditText: z.string().trim().min(1).max(1_000),
    attributedTo: z
      .array(federationAttributedAgentSchema)
      .min(1)
      .max(resourceLimits.contentFederation.maximumAttributedAgents),
  })
  .strict();
export type FederationAttributionTerms = z.infer<typeof federationAttributionTermsSchema>;

const supportedExternalSchema = contentSchemaDefinitionSchema.superRefine((schema, context) => {
  const unsupported = new Set(['asset', 'component-tree', 'relation', 'rich-text']);
  schema.fields.forEach((field, index) => {
    if (unsupported.has(field.type)) {
      context.addIssue({
        code: 'custom',
        path: ['fields', index, 'type'],
        message: `Federated type field ${field.name} uses unsupported ${field.type} data.`,
      });
    }
    if (field.type === 'array' && field.items.type === 'relation') {
      context.addIssue({
        code: 'custom',
        path: ['fields', index, 'items', 'type'],
        message: `Federated type field ${field.name} uses an unsupported relation item.`,
      });
    }
  });
  schema.objects.forEach((object, objectIndex) => {
    object.fields.forEach((field, fieldIndex) => {
      if (field.value.type === 'relation') {
        context.addIssue({
          code: 'custom',
          path: ['objects', objectIndex, 'fields', fieldIndex, 'value', 'type'],
          message: `Federated object field ${field.name} uses an unsupported relation.`,
        });
      }
    });
  });
});

export const federationTypeDescriptorSchema = z
  .object({
    namespace: federationIdSchema,
    contentType: federationIdSchema,
    version: z.number().int().positive(),
    fingerprint: sha256Schema,
    schema: supportedExternalSchema,
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (descriptor.schema.id !== descriptor.contentType) {
      context.addIssue({
        code: 'custom',
        path: ['schema', 'id'],
        message: 'Federated schema ID must match its content type.',
      });
    }
    if (descriptor.schema.version !== descriptor.version) {
      context.addIssue({
        code: 'custom',
        path: ['schema', 'version'],
        message: 'Federated schema version must match its descriptor version.',
      });
    }
  });
export type FederationTypeDescriptor = z.infer<typeof federationTypeDescriptorSchema>;

export const federationOfferInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    id: federationIdSchema,
    state: z.enum(['disabled', 'enabled']),
    sourceInstance: httpsUrlSchema,
    canonicalBaseUrl: httpsUrlSchema,
    contentTypes: z
      .array(z.object({ id: federationIdSchema, version: z.number().int().positive() }).strict())
      .min(1)
      .max(resourceLimits.contentFederation.maximumTypesPerOffer),
    attribution: federationAttributionTermsSchema,
  })
  .strict();
export type FederationOfferInput = z.infer<typeof federationOfferInputSchema>;

export const federationOfferSchema = contentFederationScopeSchema
  .extend({
    id: federationIdSchema,
    version: z.number().int().positive(),
    state: z.enum(['disabled', 'enabled']),
    sourceInstance: httpsUrlSchema,
    canonicalBaseUrl: httpsUrlSchema,
    publicKey: federationPublicKeySchema,
    types: z
      .array(federationTypeDescriptorSchema)
      .min(1)
      .max(resourceLimits.contentFederation.maximumTypesPerOffer),
    attribution: federationAttributionTermsSchema,
    digest: sha256Schema,
    createdBy: federationIdSchema,
    createdAt: timestampSchema,
    updatedBy: federationIdSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export type FederationOffer = z.infer<typeof federationOfferSchema>;

export const federationOfferContractSchema = federationOfferSchema.omit({
  organizationId: true,
  tenantId: true,
  workspaceId: true,
  siteId: true,
  environmentId: true,
  locale: true,
  createdBy: true,
  createdAt: true,
  updatedBy: true,
  updatedAt: true,
});
export type FederationOfferContract = z.infer<typeof federationOfferContractSchema>;

export const federationAgreementInspectionInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    adapter: federationIdSchema,
    sourceScope: contentFederationScopeSchema,
    sourceInstance: httpsUrlSchema,
    canonicalBaseUrl: httpsUrlSchema,
    offerId: federationIdSchema,
    mode: z.enum(['live', 'mirror']),
    trustedKey: federationPublicKeySchema,
  })
  .strict();
export type FederationAgreementInspectionInput = z.infer<
  typeof federationAgreementInspectionInputSchema
>;

export const federationAgreementStateInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    state: z.enum(['disabled', 'active']),
  })
  .strict();
export type FederationAgreementStateInput = z.infer<typeof federationAgreementStateInputSchema>;

export const federationAgreementSchema = contentFederationScopeSchema
  .extend({
    id: federationIdSchema,
    version: z.number().int().positive(),
    state: z.enum(['disabled', 'active']),
    adapter: federationIdSchema,
    mode: z.enum(['live', 'mirror']),
    sourceScope: contentFederationScopeSchema,
    sourceInstance: httpsUrlSchema,
    canonicalBaseUrl: httpsUrlSchema,
    offerId: federationIdSchema,
    offerVersion: z.number().int().positive(),
    offerDigest: sha256Schema,
    trustedKey: federationPublicKeySchema,
    types: z
      .array(federationTypeDescriptorSchema)
      .min(1)
      .max(resourceLimits.contentFederation.maximumTypesPerOffer),
    attribution: federationAttributionTermsSchema,
    createdBy: federationIdSchema,
    createdAt: timestampSchema,
    updatedBy: federationIdSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export type FederationAgreement = z.infer<typeof federationAgreementSchema>;

export const federationRecordAttributionSchema = federationAttributionTermsSchema
  .extend({
    canonicalUrl: httpsUrlSchema,
    sourceInstance: httpsUrlSchema,
    sourceEntryId: federationIdSchema,
    sourceRevisionId: federationIdSchema,
    sourceRevisionSequence: z.number().int().positive(),
    offerId: federationIdSchema,
    offerVersion: z.number().int().positive(),
    offerDigest: sha256Schema,
    typeFingerprint: sha256Schema,
  })
  .strict();
export type FederationRecordAttribution = z.infer<typeof federationRecordAttributionSchema>;

export const federatedContentRecordSchema = z
  .object({
    namespace: federationIdSchema,
    contentType: federationIdSchema,
    typeVersion: z.number().int().positive(),
    typeFingerprint: sha256Schema,
    sourceEntryId: federationIdSchema,
    sourceRevisionId: federationIdSchema,
    sourceRevisionSequence: z.number().int().positive(),
    publishedAt: timestampSchema,
    data: z.record(z.string(), z.unknown()),
    checksum: sha256Schema,
    attribution: federationRecordAttributionSchema,
  })
  .strict();
export type FederatedContentRecord = z.infer<typeof federatedContentRecordSchema>;

const federationEnvelopeBaseSchema = z
  .object({
    protocol: z.literal(GRIDSTORY_CONTENT_FEDERATION_PROTOCOL),
    sourceScope: contentFederationScopeSchema,
    sourceInstance: httpsUrlSchema,
    requestId: z.string().uuid(),
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();

export const federationOfferEnvelopePayloadSchema = federationEnvelopeBaseSchema.extend({
  kind: z.literal('offer'),
  offer: federationOfferContractSchema,
});
export type FederationOfferEnvelopePayload = z.infer<typeof federationOfferEnvelopePayloadSchema>;

export const federationRecordEnvelopePayloadSchema = federationEnvelopeBaseSchema.extend({
  kind: z.literal('record'),
  offerId: federationIdSchema,
  offerVersion: z.number().int().positive(),
  offerDigest: sha256Schema,
  record: federatedContentRecordSchema.nullable(),
});
export type FederationRecordEnvelopePayload = z.infer<typeof federationRecordEnvelopePayloadSchema>;

export const federationSnapshotEnvelopePayloadSchema = federationEnvelopeBaseSchema.extend({
  kind: z.literal('snapshot'),
  offerId: federationIdSchema,
  offerVersion: z.number().int().positive(),
  offerDigest: sha256Schema,
  complete: z.literal(true),
  checkpoint: sha256Schema,
  records: z
    .array(federatedContentRecordSchema)
    .max(resourceLimits.contentFederation.maximumRecordsPerSnapshot),
});
export type FederationSnapshotEnvelopePayload = z.infer<
  typeof federationSnapshotEnvelopePayloadSchema
>;

export const federationEnvelopePayloadSchema = z.discriminatedUnion('kind', [
  federationOfferEnvelopePayloadSchema,
  federationRecordEnvelopePayloadSchema,
  federationSnapshotEnvelopePayloadSchema,
]);
export type FederationEnvelopePayload = z.infer<typeof federationEnvelopePayloadSchema>;

export const signedFederationEnvelopeSchema = z
  .object({
    payload: federationEnvelopePayloadSchema,
    signature: z
      .object({
        keyId: federationIdSchema,
        algorithm: z.literal('ed25519'),
        value: z.string().min(32).max(8_192),
      })
      .strict(),
  })
  .strict();
export type SignedFederationEnvelope = z.infer<typeof signedFederationEnvelopeSchema>;

export const federationMirrorRecordSchema = federatedContentRecordSchema.extend({
  agreementId: federationIdSchema,
  state: z.enum(['active', 'withdrawn']),
  receivedAt: timestampSchema,
  withdrawnAt: timestampSchema.optional(),
});
export type FederationMirrorRecord = z.infer<typeof federationMirrorRecordSchema>;

export const federationSyncEffectSchema = z
  .object({
    namespace: federationIdSchema,
    sourceEntryId: federationIdSchema,
    action: z.enum(['create', 'update', 'noop', 'withdraw', 'blocked']),
    sourceRevisionId: federationIdSchema.optional(),
    sourceRevisionSequence: z.number().int().positive().optional(),
    checksum: sha256Schema.optional(),
    record: federatedContentRecordSchema.optional(),
    message: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
export type FederationSyncEffect = z.infer<typeof federationSyncEffectSchema>;

export const federationSyncPlanSchema = contentFederationScopeSchema
  .extend({
    id: z.string().uuid(),
    agreementId: federationIdSchema,
    agreementVersion: z.number().int().positive(),
    state: z.enum(['preview', 'executing', 'completed', 'failed', 'expired']),
    requestId: z.string().uuid(),
    offerVersion: z.number().int().positive(),
    offerDigest: sha256Schema,
    sourceCheckpoint: sha256Schema,
    effects: z
      .array(federationSyncEffectSchema)
      .max(resourceLimits.contentFederation.maximumRecordsPerSnapshot * 2),
    digest: sha256Schema,
    createdBy: federationIdSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
    error: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
export type FederationSyncPlan = z.infer<typeof federationSyncPlanSchema>;

export const federationSyncPlanExecutionInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    digest: sha256Schema,
  })
  .strict();
export type FederationSyncPlanExecutionInput = z.infer<
  typeof federationSyncPlanExecutionInputSchema
>;

export const federationExpectedVersionInputSchema = z
  .object({ expectedVersion: z.number().int().nonnegative() })
  .strict();
export type FederationExpectedVersionInput = z.infer<typeof federationExpectedVersionInputSchema>;

export const federationSyncReceiptSchema = z
  .object({
    id: z.string().uuid(),
    planId: z.string().uuid(),
    agreementId: federationIdSchema,
    digest: sha256Schema,
    checkpoint: sha256Schema,
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    withdrawn: z.number().int().nonnegative(),
    actorId: federationIdSchema,
    completedAt: timestampSchema,
  })
  .strict();
export type FederationSyncReceipt = z.infer<typeof federationSyncReceiptSchema>;

export const contentFederationDocumentSchema = contentFederationScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    version: z.number().int().nonnegative(),
    offers: z.array(federationOfferSchema).max(resourceLimits.contentFederation.maximumOffers),
    agreements: z
      .array(federationAgreementSchema)
      .max(resourceLimits.contentFederation.maximumAgreements),
    mirrors: z
      .array(federationMirrorRecordSchema)
      .max(resourceLimits.contentFederation.maximumRecordsPerSnapshot * 2),
    plans: z.array(federationSyncPlanSchema).max(resourceLimits.contentFederation.maximumPlans),
    receipts: z
      .array(federationSyncReceiptSchema)
      .max(resourceLimits.contentFederation.maximumReceipts),
    updatedBy: federationIdSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export type ContentFederationDocument = z.infer<typeof contentFederationDocumentSchema>;

export const federationPublicRecordSchema = federatedContentRecordSchema;
export type FederationPublicRecord = z.infer<typeof federationPublicRecordSchema>;
