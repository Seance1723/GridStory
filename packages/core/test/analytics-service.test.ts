import type { ContentScope, PublicAnalyticsEventInput } from '@gridstory/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnalyticsService,
  InMemoryAnalyticsRepository,
  OperationsService,
  SqliteContentRepository,
  type AnalyticsAdapter,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};
const content = { id: 'home', contentType: 'page', revisionId: 'revision-1' };

describe('AnalyticsService', () => {
  const repositories: SqliteContentRepository[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) repository.close();
  });

  function harness(adapter?: AnalyticsAdapter, lifecycle = false) {
    let current = new Date('2026-08-24T08:00:00.000Z');
    const jobs = new SqliteContentRepository({
      filename: ':memory:',
      now: () => current.toISOString(),
    });
    repositories.push(jobs);
    const analytics = new AnalyticsService({
      repository: new InMemoryAnalyticsRepository(),
      jobRepository: jobs,
      adapters: adapter ? [adapter] : [],
      now: () => current,
    });
    const operations = new OperationsService({
      repository: jobs,
      webhookSigningSecret: 'analytics-test-webhook-secret-at-least-32-characters',
      ...(lifecycle
        ? {
            analyticsLifecycleEnqueuer: ({ scope: selectedScope, event }) =>
              analytics.enqueueLifecycle(selectedScope, event),
          }
        : {}),
      analyticsJobRunner: ({ scope: selectedScope, type, payload }) =>
        type === 'analytics.process'
          ? analytics.process(selectedScope, payload)
          : analytics.deliver(selectedScope, payload),
      searchJobRunner: async () => ({ indexed: true }),
      now: () => current,
    });
    return {
      analytics,
      jobs,
      operations,
      setCurrent(value: string) {
        current = new Date(value);
      },
    };
  }

  it('gates anonymous events, aggregates once, and delivers through independent durable jobs', async () => {
    const delivered: string[] = [];
    const adapter: AnalyticsAdapter = {
      id: 'warehouse',
      async deliver(evidence) {
        delivered.push(evidence.kind === 'event' ? evidence.event.id : evidence.annotation.id);
      },
    };
    const { analytics, jobs, operations } = harness(adapter);
    const created = await jobs.create({
      scope,
      contentType: 'page',
      data: { title: 'Published analytics fixture' },
      actor: { id: 'author' },
    });
    const published = await jobs.publish({
      scope,
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      actor: { id: 'publisher' },
    });
    const event: PublicAnalyticsEventInput = {
      id: '018daf23-89b3-7cf8-a4f1-94064c96df90',
      name: 'component.interacted',
      occurredAt: '2026-08-24T07:59:00.000Z',
      content: {
        id: published.id,
        contentType: published.contentType,
        revisionId: published.publishedRevisionId ?? '',
      },
      component: { id: 'hero', version: 2, nodeId: 'hero-primary' },
      interaction: 'primary_cta.activate',
      consent: { purposeId: 'analytics', granted: true, globalPrivacyControl: false },
    };

    await expect(analytics.ingest(scope, event)).resolves.toEqual({
      accepted: true,
      eventId: event.id,
    });
    await operations.drain({ scope, workerId: 'processor' });
    expect(delivered).toEqual([]);
    await operations.drain({ scope, workerId: 'delivery' });
    expect(delivered).toEqual([event.id]);

    const report = await analytics.report(scope);
    expect(report).toMatchObject({
      eventCounts: { 'component.interacted': 1 },
      components: [
        {
          componentId: 'hero',
          interactions: 1,
          interactionCounts: [{ name: 'primary_cta.activate', count: 1 }],
        },
      ],
      adapterDeliveries: [{ adapterId: 'warehouse', succeeded: 1, dead: 0 }],
    });

    await expect(analytics.ingest(scope, event)).resolves.toEqual({
      accepted: true,
      eventId: event.id,
    });
    await operations.drain({ scope, workerId: 'duplicate' });
    expect((await analytics.report(scope)).eventCounts['component.interacted']).toBe(1);
    expect(delivered).toEqual([event.id]);

    await expect(
      analytics.ingest(scope, {
        ...event,
        id: '018daf23-89b3-7cf8-a4f1-94064c96df99',
        content: { ...event.content, revisionId: 'draft-or-stale-revision' },
      }),
    ).rejects.toMatchObject({ code: 'analytics_content_unpublished' });

    await expect(
      analytics.ingest(scope, {
        ...event,
        id: '018daf23-89b3-7cf8-a4f1-94064c96df91',
        consent: { ...event.consent, granted: false },
      }),
    ).resolves.toEqual({ accepted: false, reason: 'purpose-denied' });
    await expect(
      analytics.ingest(scope, {
        ...event,
        id: '018daf23-89b3-7cf8-a4f1-94064c96df92',
        consent: { ...event.consent, globalPrivacyControl: true },
      }),
    ).resolves.toEqual({ accepted: false, reason: 'global-privacy-control' });
  });

  it('bounds client time, isolates scope, and retains typed release annotations', async () => {
    const { analytics, operations, setCurrent } = harness();
    const base: PublicAnalyticsEventInput = {
      id: '018daf23-89b3-7cf8-a4f1-94064c96df93',
      name: 'content.viewed',
      occurredAt: '2026-08-22T08:00:00.000Z',
      content,
      consent: { purposeId: 'analytics', granted: true, globalPrivacyControl: false },
    };
    await expect(analytics.ingest(scope, base)).rejects.toMatchObject({
      code: 'analytics_event_stale',
    });
    await expect(
      analytics.ingest(scope, {
        ...base,
        occurredAt: '2026-08-24T08:06:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'analytics_event_future' });

    await analytics.annotateRelease({
      scope,
      name: 'release.published',
      releaseId: 'launch-1',
      releaseName: 'Homepage launch',
      entryCount: 2,
      occurredAt: '2026-08-24T08:00:00.000Z',
    });
    setCurrent('2026-08-24T08:01:00.000Z');
    await operations.drain({ scope, workerId: 'annotation' });
    expect((await analytics.report(scope)).releaseAnnotations).toEqual([
      expect.objectContaining({ name: 'release.published', releaseId: 'launch-1' }),
    ]);
    expect((await analytics.report({ ...scope, tenantId: 'tenant-b' })).releaseAnnotations).toEqual(
      [],
    );
  });

  it('keeps aggregates authoritative while a hostile adapter retries independently', async () => {
    let attempts = 0;
    const adapter: AnalyticsAdapter = {
      id: 'hostile-warehouse',
      async deliver() {
        attempts += 1;
        throw new Error('provider included a credential in a hostile diagnostic');
      },
    };
    const { analytics, jobs, operations } = harness(adapter);
    const created = await jobs.create({
      scope,
      contentType: 'page',
      data: { title: 'Adapter failure fixture' },
      actor: { id: 'author' },
    });
    const published = await jobs.publish({
      scope,
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      actor: { id: 'publisher' },
    });
    const event: PublicAnalyticsEventInput = {
      id: '018daf23-89b3-7cf8-a4f1-94064c96dfa0',
      name: 'content.viewed',
      occurredAt: '2026-08-24T07:59:00.000Z',
      content: {
        id: published.id,
        contentType: published.contentType,
        revisionId: published.publishedRevisionId ?? '',
      },
      consent: { purposeId: 'analytics', granted: true, globalPrivacyControl: false },
    };

    await analytics.ingest(scope, event);
    await operations.drain({ scope, workerId: 'processor' });
    await operations.drain({ scope, workerId: 'failing-delivery' });

    const report = await analytics.report(scope);
    expect(report.eventCounts['content.viewed']).toBe(1);
    expect(report.adapterDeliveries).toEqual([
      expect.objectContaining({
        adapterId: 'hostile-warehouse',
        pending: 1,
        succeeded: 0,
        dead: 0,
        lastError: 'Analytics adapter delivery failed.',
      }),
    ]);
    expect(attempts).toBe(1);
  });
});
