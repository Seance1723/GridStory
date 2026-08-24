import { randomUUID } from 'node:crypto';
import {
  analyticsDocumentSchema,
  analyticsEvidenceSchema,
  analyticsReportSchema,
  normalizedAnalyticsEventSchema,
  publicAnalyticsEventInputSchema,
  releaseAnalyticsAnnotationSchema,
  resourceLimits,
  type AnalyticsDocument,
  type AnalyticsEvidence,
  type AnalyticsIngestionResult,
  type AnalyticsReport,
  type ContentScope,
  type NormalizedAnalyticsEvent,
  type PublicAnalyticsEventInput,
  type ReleaseAnalyticsAnnotation,
} from '@gridstory/schema';
import { emptyAnalyticsDocument, type AnalyticsRepository } from './analytics-repository.js';
import { GridStoryError } from './errors.js';
import { assertSameContentScope, assertValidContentScope } from './tenant-scope.js';
import type { ContentRepository, DurableJob, OutboxEvent } from './types.js';

export interface AnalyticsAdapter {
  id: string;
  deliver(evidence: AnalyticsEvidence): Promise<void>;
}

export interface AnalyticsServiceOptions {
  repository: AnalyticsRepository;
  jobRepository: ContentRepository;
  adapters?: AnalyticsAdapter[];
  purposeId?: string;
  now?: () => Date;
  createId?: () => string;
}

const adapterIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;

function evidenceValue(
  evidence: AnalyticsEvidence,
): NormalizedAnalyticsEvent | ReleaseAnalyticsAnnotation {
  return evidence.kind === 'event' ? evidence.event : evidence.annotation;
}

function later(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}

function evidenceId(evidence: AnalyticsEvidence): string {
  return evidenceValue(evidence).id;
}

function boundedNewest<T>(
  values: T[],
  maximum: number,
  timestamp: (value: T) => string,
): { values: T[]; truncated: boolean } {
  if (values.length <= maximum) return { values, truncated: false };
  return {
    values: [...values]
      .sort((left, right) => timestamp(right).localeCompare(timestamp(left)))
      .slice(0, maximum),
    truncated: true,
  };
}

function applyEvent(document: AnalyticsDocument, event: NormalizedAnalyticsEvent): void {
  document.eventCounts[event.name] += 1;
  if (event.name.startsWith('content.')) {
    const current = document.contents.find(
      (metric) =>
        metric.contentId === event.content.id && metric.revisionId === event.content.revisionId,
    );
    const metric = current ?? {
      contentId: event.content.id,
      contentType: event.content.contentType,
      revisionId: event.content.revisionId,
      views: 0,
      created: 0,
      draftUpdates: 0,
      publications: 0,
      lastOccurredAt: event.occurredAt,
    };
    if (event.name === 'content.viewed') metric.views += 1;
    if (event.name === 'content.created') metric.created += 1;
    if (event.name === 'content.draft.updated') metric.draftUpdates += 1;
    if (event.name === 'content.published') metric.publications += 1;
    metric.lastOccurredAt = later(metric.lastOccurredAt, event.occurredAt);
    if (!current) document.contents.push(metric);
    const bounded = boundedNewest(
      document.contents,
      resourceLimits.analytics.maximumContentMetrics,
      (value) => value.lastOccurredAt,
    );
    document.contents = bounded.values;
    document.truncated.contents ||= bounded.truncated;
  }
  if (event.name !== 'component.viewed' && event.name !== 'component.interacted') return;
  const current = document.components.find(
    (metric) =>
      metric.componentId === event.component.id && metric.version === event.component.version,
  );
  const metric = current ?? {
    componentId: event.component.id,
    version: event.component.version,
    views: 0,
    interactions: 0,
    interactionCounts: [],
    lastOccurredAt: event.occurredAt,
  };
  if (event.name === 'component.viewed') metric.views += 1;
  if (event.name === 'component.interacted') {
    metric.interactions += 1;
    const interaction = metric.interactionCounts.find(({ name }) => name === event.interaction);
    if (interaction) interaction.count += 1;
    else if (
      metric.interactionCounts.length < resourceLimits.analytics.maximumInteractionNamesPerComponent
    ) {
      metric.interactionCounts.push({ name: event.interaction, count: 1 });
    }
  }
  metric.lastOccurredAt = later(metric.lastOccurredAt, event.occurredAt);
  if (!current) document.components.push(metric);
  const bounded = boundedNewest(
    document.components,
    resourceLimits.analytics.maximumComponentMetrics,
    (value) => value.lastOccurredAt,
  );
  document.components = bounded.values;
  document.truncated.components ||= bounded.truncated;
}

function applyAnnotation(
  document: AnalyticsDocument,
  annotation: ReleaseAnalyticsAnnotation,
): void {
  const bounded = boundedNewest(
    [...document.releaseAnnotations, annotation],
    resourceLimits.analytics.maximumReleaseAnnotations,
    (value) => value.occurredAt,
  );
  document.releaseAnnotations = bounded.values;
  document.truncated.releaseAnnotations ||= bounded.truncated;
}

export class AnalyticsService {
  readonly #repository: AnalyticsRepository;
  readonly #jobs: ContentRepository;
  readonly #adapters: ReadonlyMap<string, AnalyticsAdapter>;
  readonly #purposeId: string;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor({
    repository,
    jobRepository,
    adapters = [],
    purposeId = 'analytics',
    now = () => new Date(),
    createId = randomUUID,
  }: AnalyticsServiceOptions) {
    if (!adapterIdPattern.test(purposeId)) {
      throw new GridStoryError('Analytics purpose ID is invalid.', 'invalid_analytics_config', 500);
    }
    if (adapters.length > resourceLimits.analytics.maximumAdapters) {
      throw new GridStoryError(
        'Too many analytics adapters are configured.',
        'invalid_analytics_config',
        500,
      );
    }
    const byId = new Map<string, AnalyticsAdapter>();
    for (const adapter of adapters) {
      if (!adapterIdPattern.test(adapter.id) || byId.has(adapter.id)) {
        throw new GridStoryError(
          'Analytics adapter IDs must be bounded and unique.',
          'invalid_analytics_config',
          500,
        );
      }
      byId.set(adapter.id, adapter);
    }
    this.#repository = repository;
    this.#jobs = jobRepository;
    this.#adapters = byId;
    this.#purposeId = purposeId;
    this.#now = now;
    this.#createId = createId;
  }

  async ingest(
    scope: ContentScope,
    input: PublicAnalyticsEventInput,
  ): Promise<AnalyticsIngestionResult> {
    assertValidContentScope(scope);
    const parsed = publicAnalyticsEventInputSchema.parse(input);
    if (parsed.consent.purposeId !== this.#purposeId || !parsed.consent.granted) {
      return { accepted: false, reason: 'purpose-denied' };
    }
    if (parsed.consent.globalPrivacyControl) {
      return { accepted: false, reason: 'global-privacy-control' };
    }
    const now = this.#now();
    const occurredAt = new Date(parsed.occurredAt);
    const ageSeconds = (now.getTime() - occurredAt.getTime()) / 1_000;
    if (ageSeconds > resourceLimits.analytics.maximumEventAgeSeconds) {
      throw new GridStoryError(
        'Analytics event is older than the accepted ingestion window.',
        'analytics_event_stale',
        400,
      );
    }
    if (ageSeconds < -resourceLimits.analytics.maximumFutureSkewSeconds) {
      throw new GridStoryError(
        'Analytics event is too far in the future.',
        'analytics_event_future',
        400,
      );
    }
    const published = await this.#jobs.getById({
      scope,
      id: parsed.content.id,
      perspective: 'published',
    });
    if (
      !published ||
      published.contentType !== parsed.content.contentType ||
      published.publishedRevisionId !== parsed.content.revisionId
    ) {
      throw new GridStoryError(
        'Analytics events must reference the current published content revision.',
        'analytics_content_unpublished',
        409,
      );
    }
    const { consent: _consent, ...eventInput } = parsed;
    const event = normalizedAnalyticsEventSchema.parse({
      ...scope,
      ...eventInput,
      source: 'browser',
    });
    await this.#enqueue({ kind: 'event', event });
    return { accepted: true, eventId: event.id };
  }

  async enqueueLifecycle(scope: ContentScope, event: OutboxEvent): Promise<DurableJob> {
    assertSameContentScope(scope, event, 'analytics lifecycle outbox');
    const contentType = event.payload.contentType;
    if (typeof contentType !== 'string') {
      throw new GridStoryError(
        'Content lifecycle event is missing its content type.',
        'invalid_analytics_event',
        500,
      );
    }
    const normalized = normalizedAnalyticsEventSchema.parse({
      ...scope,
      id: event.id,
      name: event.type,
      source: 'server',
      occurredAt: event.occurredAt,
      content: {
        id: event.aggregateId,
        contentType,
        revisionId: event.revisionId,
      },
    });
    return await this.#enqueue({ kind: 'event', event: normalized });
  }

  async annotateRelease(input: {
    scope: ContentScope;
    name: ReleaseAnalyticsAnnotation['name'];
    releaseId: string;
    releaseName: string;
    entryCount: number;
    occurredAt: string;
  }): Promise<DurableJob> {
    const annotation = releaseAnalyticsAnnotationSchema.parse({
      ...input.scope,
      id: this.#createId(),
      name: input.name,
      releaseId: input.releaseId,
      releaseName: input.releaseName,
      entryCount: input.entryCount,
      occurredAt: input.occurredAt,
    });
    return await this.#enqueue({ kind: 'release-annotation', annotation });
  }

  async process(
    scope: ContentScope,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const evidence = analyticsEvidenceSchema.parse(payload.evidence);
    assertSameContentScope(scope, evidenceValue(evidence), 'analytics process job');
    const aggregated = await this.#aggregate(scope, evidence);
    const deliveries = [];
    for (const adapterId of this.#adapters.keys()) {
      deliveries.push(
        await this.#jobs.enqueueJob({
          scope,
          type: 'analytics.deliver',
          idempotencyKey: `analytics:deliver:${adapterId}:${evidenceId(evidence)}`,
          payload: { adapterId, evidence },
          runAt: this.#now().toISOString(),
          maxAttempts: 12,
        }),
      );
    }
    return { aggregated, adapterJobs: deliveries.length, evidenceId: evidenceId(evidence) };
  }

  async deliver(
    scope: ContentScope,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const adapterId = payload.adapterId;
    if (typeof adapterId !== 'string') {
      throw new GridStoryError('Analytics adapter job is invalid.', 'invalid_analytics_job', 500);
    }
    const adapter = this.#adapters.get(adapterId);
    if (!adapter) {
      throw new GridStoryError(
        'Analytics adapter is no longer configured.',
        'analytics_adapter_unavailable',
        503,
      );
    }
    const evidence = analyticsEvidenceSchema.parse(payload.evidence);
    assertSameContentScope(scope, evidenceValue(evidence), 'analytics adapter job');
    try {
      await adapter.deliver(evidence);
    } catch {
      throw new GridStoryError(
        'Analytics adapter delivery failed.',
        'analytics_adapter_delivery_failed',
        502,
      );
    }
    return { adapterId, delivered: true, evidenceId: evidenceId(evidence) };
  }

  async report(scope: ContentScope): Promise<AnalyticsReport> {
    const [stored, jobs] = await Promise.all([
      this.#repository.get(scope),
      this.#jobs.listJobs({ scope, limit: resourceLimits.operations.maximumListPageSize }),
    ]);
    const document = stored ?? emptyAnalyticsDocument(scope, this.#now().toISOString());
    assertSameContentScope(scope, document, 'analytics report repository');
    jobs.forEach((job) => {
      assertSameContentScope(scope, job, 'analytics report jobs');
    });
    const deliveryJobs = jobs.filter((job) => job.type === 'analytics.deliver');
    const adapterIds = new Set(this.#adapters.keys());
    for (const job of deliveryJobs) {
      if (
        typeof job.payload.adapterId === 'string' &&
        adapterIdPattern.test(job.payload.adapterId)
      ) {
        adapterIds.add(job.payload.adapterId);
      }
    }
    const adapterDeliveries = [...adapterIds].sort().map((adapterId) => {
      const selected = deliveryJobs.filter((job) => job.payload.adapterId === adapterId);
      const counts = { pending: 0, processing: 0, succeeded: 0, dead: 0 };
      for (const job of selected) counts[job.state] += 1;
      const lastError = selected.find((job) => job.lastError)?.lastError;
      return { adapterId, ...counts, ...(lastError ? { lastError } : {}) };
    });
    const { receipts: _privateReceipts, ...reportDocument } = document;
    return analyticsReportSchema.parse({
      ...reportDocument,
      generatedAt: this.#now().toISOString(),
      adapterDeliveries,
      deliveriesTruncated: jobs.length === resourceLimits.operations.maximumListPageSize,
    });
  }

  async #enqueue(evidence: AnalyticsEvidence): Promise<DurableJob> {
    const parsed = analyticsEvidenceSchema.parse(evidence);
    const value = evidenceValue(parsed);
    return await this.#jobs.enqueueJob({
      scope: value,
      type: 'analytics.process',
      idempotencyKey: `analytics:process:${value.id}`,
      payload: { evidence: parsed },
      runAt: this.#now().toISOString(),
      maxAttempts: 12,
    });
  }

  async #aggregate(scope: ContentScope, evidence: AnalyticsEvidence): Promise<boolean> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.#repository.get(scope);
      const document = current
        ? structuredClone(current)
        : emptyAnalyticsDocument(scope, this.#now().toISOString());
      assertSameContentScope(scope, document, 'analytics aggregate repository');
      if (document.receipts.some(({ id }) => id === evidenceId(evidence))) return false;
      if (evidence.kind === 'event') applyEvent(document, evidence.event);
      else applyAnnotation(document, evidence.annotation);
      const receipt = { id: evidenceId(evidence), occurredAt: evidenceValue(evidence).occurredAt };
      const bounded = boundedNewest(
        [...document.receipts, receipt],
        resourceLimits.analytics.maximumIdempotencyReceipts,
        (value) => value.occurredAt,
      );
      document.receipts = bounded.values;
      document.truncated.receipts ||= bounded.truncated;
      document.version = current ? current.version + 1 : 1;
      document.updatedAt = this.#now().toISOString();
      const parsed = analyticsDocumentSchema.parse(document);
      try {
        await this.#repository.save(parsed, current?.version ?? null);
        return true;
      } catch (error) {
        if (!(error instanceof GridStoryError) || error.code !== 'analytics_write_conflict') {
          throw error;
        }
      }
    }
    throw new GridStoryError(
      'Analytics aggregates changed too often to record this event.',
      'analytics_write_conflict',
      409,
    );
  }
}
