import { z } from 'zod';
import { resourceLimits } from './resource-limits.js';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/);
const eventIdSchema = z.uuid();
const timestampSchema = z.string().datetime({ offset: true });
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const contentScopeShape = {
  organizationId: identifierSchema,
  tenantId: identifierSchema,
  workspaceId: identifierSchema,
  siteId: identifierSchema,
  environmentId: identifierSchema,
  locale: identifierSchema,
};

export const analyticsContentReferenceSchema = z
  .object({
    id: identifierSchema,
    contentType: identifierSchema,
    revisionId: identifierSchema,
  })
  .strict();

export const analyticsComponentReferenceSchema = z
  .object({
    id: identifierSchema,
    version: z.number().int().positive().max(1_000_000),
    nodeId: identifierSchema,
  })
  .strict();

export const analyticsConsentSchema = z
  .object({
    purposeId: identifierSchema,
    granted: z.boolean(),
    globalPrivacyControl: z.boolean().default(false),
  })
  .strict();

const publicEventBase = z
  .object({
    id: eventIdSchema,
    occurredAt: timestampSchema,
    content: analyticsContentReferenceSchema,
    consent: analyticsConsentSchema,
  })
  .strict();

const interactionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/);

export const publicAnalyticsEventInputSchema = z.discriminatedUnion('name', [
  publicEventBase.extend({ name: z.literal('content.viewed') }),
  publicEventBase.extend({
    name: z.literal('component.viewed'),
    component: analyticsComponentReferenceSchema,
  }),
  publicEventBase.extend({
    name: z.literal('component.interacted'),
    component: analyticsComponentReferenceSchema,
    interaction: interactionNameSchema,
  }),
]);

const normalizedEventBase = z.object({
  ...contentScopeShape,
  id: eventIdSchema,
  occurredAt: timestampSchema,
  source: z.enum(['browser', 'server']),
  content: analyticsContentReferenceSchema,
});

export const normalizedAnalyticsEventSchema = z.discriminatedUnion('name', [
  normalizedEventBase.extend({ name: z.literal('content.created') }).strict(),
  normalizedEventBase.extend({ name: z.literal('content.draft.updated') }).strict(),
  normalizedEventBase.extend({ name: z.literal('content.published') }).strict(),
  normalizedEventBase.extend({ name: z.literal('content.viewed') }).strict(),
  normalizedEventBase
    .extend({
      name: z.literal('component.viewed'),
      component: analyticsComponentReferenceSchema,
    })
    .strict(),
  normalizedEventBase
    .extend({
      name: z.literal('component.interacted'),
      component: analyticsComponentReferenceSchema,
      interaction: interactionNameSchema,
    })
    .strict(),
]);

export const releaseAnalyticsAnnotationSchema = z
  .object({
    ...contentScopeShape,
    id: eventIdSchema,
    name: z.enum(['release.published', 'release.rolled_back']),
    releaseId: identifierSchema,
    releaseName: z.string().trim().min(1).max(160),
    entryCount: z.number().int().min(2).max(100),
    occurredAt: timestampSchema,
  })
  .strict();

export const analyticsEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), event: normalizedAnalyticsEventSchema }).strict(),
  z
    .object({ kind: z.literal('release-annotation'), annotation: releaseAnalyticsAnnotationSchema })
    .strict(),
]);

const eventCountsSchema = z
  .object({
    'content.created': countSchema,
    'content.draft.updated': countSchema,
    'content.published': countSchema,
    'content.viewed': countSchema,
    'component.viewed': countSchema,
    'component.interacted': countSchema,
  })
  .strict();

export const analyticsContentMetricSchema = z
  .object({
    contentId: identifierSchema,
    contentType: identifierSchema,
    revisionId: identifierSchema,
    views: countSchema,
    created: countSchema,
    draftUpdates: countSchema,
    publications: countSchema,
    lastOccurredAt: timestampSchema,
  })
  .strict();

export const analyticsComponentMetricSchema = z
  .object({
    componentId: identifierSchema,
    version: z.number().int().positive().max(1_000_000),
    views: countSchema,
    interactions: countSchema,
    interactionCounts: z
      .array(z.object({ name: interactionNameSchema, count: countSchema }).strict())
      .max(resourceLimits.analytics.maximumInteractionNamesPerComponent),
    lastOccurredAt: timestampSchema,
  })
  .strict();

export const analyticsReceiptSchema = z
  .object({ id: eventIdSchema, occurredAt: timestampSchema })
  .strict();

export const analyticsDocumentSchema = z
  .object({
    ...contentScopeShape,
    version: z.number().int().positive(),
    eventCounts: eventCountsSchema,
    contents: z
      .array(analyticsContentMetricSchema)
      .max(resourceLimits.analytics.maximumContentMetrics),
    components: z
      .array(analyticsComponentMetricSchema)
      .max(resourceLimits.analytics.maximumComponentMetrics),
    releaseAnnotations: z
      .array(releaseAnalyticsAnnotationSchema)
      .max(resourceLimits.analytics.maximumReleaseAnnotations),
    receipts: z
      .array(analyticsReceiptSchema)
      .max(resourceLimits.analytics.maximumIdempotencyReceipts),
    truncated: z
      .object({
        contents: z.boolean(),
        components: z.boolean(),
        releaseAnnotations: z.boolean(),
        receipts: z.boolean(),
      })
      .strict(),
    updatedAt: timestampSchema,
  })
  .strict();

export const analyticsAdapterHealthSchema = z
  .object({
    adapterId: identifierSchema,
    pending: countSchema,
    processing: countSchema,
    succeeded: countSchema,
    dead: countSchema,
    lastError: z.string().min(1).max(2000).optional(),
  })
  .strict();

export const analyticsReportSchema = analyticsDocumentSchema
  .omit({ receipts: true })
  .extend({
    generatedAt: timestampSchema,
    adapterDeliveries: z
      .array(analyticsAdapterHealthSchema)
      .max(resourceLimits.analytics.maximumAdapters),
    deliveriesTruncated: z.boolean(),
  })
  .strict();

export const analyticsIngestionResultSchema = z
  .object({
    accepted: z.boolean(),
    eventId: eventIdSchema.optional(),
    reason: z.enum(['purpose-denied', 'global-privacy-control']).optional(),
  })
  .strict();

export type PublicAnalyticsEventInput = z.infer<typeof publicAnalyticsEventInputSchema>;
export type NormalizedAnalyticsEvent = z.infer<typeof normalizedAnalyticsEventSchema>;
export type ReleaseAnalyticsAnnotation = z.infer<typeof releaseAnalyticsAnnotationSchema>;
export type AnalyticsEvidence = z.infer<typeof analyticsEvidenceSchema>;
export type AnalyticsContentMetric = z.infer<typeof analyticsContentMetricSchema>;
export type AnalyticsComponentMetric = z.infer<typeof analyticsComponentMetricSchema>;
export type AnalyticsDocument = z.infer<typeof analyticsDocumentSchema>;
export type AnalyticsAdapterHealth = z.infer<typeof analyticsAdapterHealthSchema>;
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;
export type AnalyticsIngestionResult = z.infer<typeof analyticsIngestionResultSchema>;
