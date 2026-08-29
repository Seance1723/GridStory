import { z } from 'zod';

const identifier = z.string().min(1).max(256);
const label = z.string().min(1).max(256);
const timestamp = z.string().datetime({ offset: true });

const contentScopeSchema = z
  .object({
    organizationId: identifier,
    tenantId: identifier,
    workspaceId: identifier,
    siteId: identifier,
    environmentId: identifier,
    locale: identifier,
  })
  .strict();

const unavailableWidgetSchema = z.object({ availability: z.literal('unavailable') }).strict();
const errorWidgetSchema = z
  .object({ availability: z.literal('error'), reason: z.literal('source-unavailable') })
  .strict();

const boundsSchema = z
  .object({
    totalCount: z.number().int().nonnegative(),
    displayedCount: z.number().int().min(0).max(5),
    limit: z.literal(5),
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.displayedCount > value.totalCount ||
      value.hasMore !== value.totalCount > value.displayedCount
    ) {
      context.addIssue({ code: 'custom', message: 'Editorial overview bounds are inconsistent.' });
    }
  });

export const editorialContentItemSchema = z
  .object({
    id: identifier,
    contentType: identifier,
    title: label,
    status: z.enum(['draft', 'changed', 'published']),
    updatedAt: timestamp,
    destination: z.enum(['pages', 'collections']),
  })
  .strict();

const contentAvailableSchema = z
  .object({
    availability: z.literal('available'),
    coverage: z.enum(['all-registered', 'pages-only']),
    exact: z.literal(true),
    bounds: boundsSchema,
    states: z
      .object({
        draft: z.number().int().nonnegative(),
        changed: z.number().int().nonnegative(),
        published: z.number().int().nonnegative(),
      })
      .strict(),
    recent: z.array(editorialContentItemSchema).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.recent.length !== value.bounds.displayedCount ||
      value.states.draft + value.states.changed + value.states.published !== value.bounds.totalCount
    ) {
      context.addIssue({ code: 'custom', message: 'Editorial content totals are inconsistent.' });
    }
  });

export const editorialReviewItemSchema = z
  .object({
    entryId: identifier,
    contentType: identifier,
    title: label,
    workflowName: label,
    stateLabel: label,
    transitionLabel: label,
    requestedAt: timestamp,
    dueAt: timestamp.optional(),
    destination: z.enum(['pages', 'collections']),
  })
  .strict();

const reviewsAvailableSchema = z
  .object({
    availability: z.literal('available'),
    coverage: z.enum(['all-registered', 'pages-only']),
    exact: z.literal(true),
    bounds: boundsSchema,
    items: z.array(editorialReviewItemSchema).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.items.length !== value.bounds.displayedCount) {
      context.addIssue({ code: 'custom', message: 'Editorial review bounds are inconsistent.' });
    }
  });

export const editorialReleaseItemSchema = z
  .object({
    id: identifier,
    name: label,
    state: z.enum([
      'draft',
      'validated',
      'scheduled',
      'executing',
      'published',
      'rolled-back',
      'failed',
    ]),
    updatedAt: timestamp,
    runAt: timestamp.optional(),
    destination: z.literal('releases'),
  })
  .strict();

const releasesAvailableSchema = z
  .object({
    availability: z.literal('available'),
    exact: z.literal(true),
    bounds: boundsSchema,
    items: z.array(editorialReleaseItemSchema).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.items.length !== value.bounds.displayedCount) {
      context.addIssue({ code: 'custom', message: 'Editorial release bounds are inconsistent.' });
    }
  });

const operationsAvailableSchema = z
  .object({
    availability: z.literal('available'),
    auditValid: z.boolean(),
    deadOutbox: z.number().int().nonnegative(),
    deadJobs: z.number().int().nonnegative(),
    outboxTruncated: z.boolean(),
    jobsTruncated: z.boolean(),
    destination: z.literal('operations'),
  })
  .strict();

export const editorialOverviewSchema = z
  .object({
    version: z.literal(1),
    scope: contentScopeSchema,
    generatedAt: timestamp,
    widgets: z
      .object({
        content: z.union([contentAvailableSchema, unavailableWidgetSchema, errorWidgetSchema]),
        reviews: z.union([reviewsAvailableSchema, unavailableWidgetSchema, errorWidgetSchema]),
        releases: z.union([releasesAvailableSchema, unavailableWidgetSchema, errorWidgetSchema]),
        operations: z.union([
          operationsAvailableSchema,
          unavailableWidgetSchema,
          errorWidgetSchema,
        ]),
      })
      .strict(),
  })
  .strict();

export type EditorialContentItem = z.infer<typeof editorialContentItemSchema>;
export type EditorialReviewItem = z.infer<typeof editorialReviewItemSchema>;
export type EditorialReleaseItem = z.infer<typeof editorialReleaseItemSchema>;
export type EditorialOverview = z.infer<typeof editorialOverviewSchema>;
