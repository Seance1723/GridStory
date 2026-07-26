import { afterEach, describe, expect, it } from 'vitest';
import type { ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import {
  ContentService,
  contentScopeCachePrefix,
  OperationsService,
  SqliteContentRepository,
  signWebhookPayload,
  type WebhookTransportInput,
} from '../src/index.js';

const schema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  collection: 'pages',
  titleField: 'title',
  fields: [{ id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true }],
};
const scope: ContentScope = {
  organizationId: 'acme',
  tenantId: 'tenant',
  workspaceId: 'web',
  siteId: 'site',
  environmentId: 'production',
  locale: 'en',
};

describe('OperationsService', () => {
  const repositories: SqliteContentRepository[] = [];

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      repository.close();
    });
  });

  it('expands transactional events into signed idempotent jobs, retries, dead-letters, and replays', async () => {
    let current = new Date('2026-01-01T00:00:00.000Z');
    let failDelivery = true;
    const deliveries: WebhookTransportInput[] = [];
    const invalidated: string[][] = [];
    const repository = new SqliteContentRepository({
      filename: ':memory:',
      now: () => current.toISOString(),
    });
    repositories.push(repository);
    const operations = new OperationsService({
      repository,
      webhookSigningSecret: 'test-webhook-secret-with-at-least-32-characters',
      now: () => current,
      webhookTransport: async (input) => {
        deliveries.push(input);
        if (failDelivery) throw new Error('temporary endpoint failure');
        return { status: 204 };
      },
      cacheInvalidator: async ({ tags }) => {
        invalidated.push(tags);
      },
      searchJobRunner: async () => ({ indexedDocuments: 1 }),
    });
    await operations.saveWebhook({
      scope,
      url: 'https://hooks.example.test/gridstory',
      eventTypes: ['content.created'],
    });
    await expect(
      operations.saveWebhook({
        scope,
        url: 'http://127.0.0.1/internal',
        eventTypes: ['content.created'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_webhook' });

    const content = new ContentService({ repository, schemas: [schema], componentManifests: [] });
    const entry = await content.create({
      scope,
      contentType: 'page',
      data: { title: 'Events' },
      actor: { id: 'author' },
    });
    expect(await operations.listOutbox(scope)).toEqual([
      expect.objectContaining({ aggregateId: entry.id, state: 'pending' }),
    ]);

    const first = await operations.drain({ scope, workerId: 'worker' });
    expect(first).toMatchObject({
      completedOutbox: 1,
      enqueuedJobs: 3,
      completedJobs: 2,
      retriedJobs: 1,
    });
    expect(invalidated[0]).toContain(`${contentScopeCachePrefix(scope)}:entry:${entry.id}`);
    const attempted = deliveries[0];
    expect(attempted?.headers['x-gridstory-signature']).toBe(
      signWebhookPayload(
        'test-webhook-secret-with-at-least-32-characters',
        attempted?.headers['x-gridstory-timestamp'] ?? '',
        attempted?.body ?? '',
      ),
    );

    current = new Date('2026-01-01T00:00:03.000Z');
    failDelivery = false;
    const second = await operations.drain({ scope, workerId: 'worker' });
    expect(second).toMatchObject({ completedJobs: 1, retriedJobs: 0 });
    const webhookJob = (await operations.listJobs(scope)).find(
      (job) => job.type === 'webhook.deliver',
    );
    expect(webhookJob).toMatchObject({ state: 'succeeded', attempts: 2 });

    const replay = await operations.replayJob(scope, webhookJob?.id ?? '');
    expect(replay).toMatchObject({ state: 'pending', attempts: 0 });
    current = new Date('2026-01-01T00:00:04.000Z');
    expect(await operations.drain({ scope, workerId: 'worker' })).toMatchObject({
      completedJobs: 1,
    });

    const deadCandidate = await repository.enqueueJob({
      scope,
      type: 'webhook.deliver',
      idempotencyKey: 'dead-letter-test',
      payload: { url: 'https://hooks.example.test/gridstory', event: { id: 'dead' } },
      runAt: current.toISOString(),
      maxAttempts: 1,
    });
    failDelivery = true;
    expect(await operations.drain({ scope, workerId: 'worker' })).toMatchObject({ deadJobs: 1 });
    expect(await repository.getJob({ scope, id: deadCandidate.id })).toMatchObject({
      state: 'dead',
      attempts: 1,
    });
    await expect(operations.dashboard(scope)).resolves.toMatchObject({
      content: { total: 1, draft: 1, changed: 0, published: 0 },
      outbox: { total: 1, succeeded: 1, truncated: false },
      webhooks: { total: 1, active: 1 },
      audit: { valid: true, eventCount: 1, entryCount: 1 },
      recentAudit: [expect.objectContaining({ entryId: entry.id, action: 'content.created' })],
    });
  });
});
