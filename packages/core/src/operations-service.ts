import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { workflowActionDefinitionSchema, type ContentScope } from '@gridstory/schema';
import { verifyAuditEvents, type AuditVerification } from './audit-service.js';
import {
  assertSameContentScope,
  assertValidContentScope,
  cacheTagBelongsToScope,
  emitTenantTelemetry,
  scopedCustomCacheTags,
  type TenantTelemetrySink,
} from './tenant-scope.js';
import { GridStoryError, NotFoundError } from './errors.js';
import type {
  ContentEventType,
  ContentRepository,
  DurableJob,
  OutboxEvent,
  WebhookSubscription,
  AuditEvent,
} from './types.js';

export const contentEventTypes: ContentEventType[] = [
  'content.created',
  'content.draft.updated',
  'content.published',
];

export interface WebhookTransportInput {
  scope: ContentScope;
  url: string;
  body: string;
  headers: Record<string, string>;
}

export type WebhookTransport = (input: WebhookTransportInput) => Promise<{ status: number }>;

export type CacheInvalidator = (input: { scope: ContentScope; tags: string[] }) => Promise<void>;

export interface OperationsServiceOptions {
  repository: ContentRepository;
  webhookSigningSecret: string;
  webhookTransport?: WebhookTransport;
  cacheInvalidator?: CacheInvalidator;
  workflowActionNotifier?: (input: {
    scope: ContentScope;
    entryId: string;
    message: string;
    audienceRoles: string[];
  }) => Promise<void>;
  searchJobRunner?: (input: {
    scope: ContentScope;
    type: 'search.index' | 'search.rebuild';
    payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  analyticsLifecycleEnqueuer?: (input: {
    scope: ContentScope;
    event: OutboxEvent;
  }) => Promise<unknown>;
  analyticsJobRunner?: (input: {
    scope: ContentScope;
    type: 'analytics.process' | 'analytics.deliver';
    payload: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  allowedWebhookHosts?: string[];
  telemetry?: TenantTelemetrySink;
  now?: () => Date;
  createId?: () => string;
}

export interface DrainResult {
  claimedOutbox: number;
  completedOutbox: number;
  enqueuedJobs: number;
  claimedJobs: number;
  completedJobs: number;
  retriedJobs: number;
  deadJobs: number;
}

export interface OperationsDashboard {
  generatedAt: string;
  content: { total: number; draft: number; changed: number; published: number };
  outbox: Record<OutboxEvent['state'], number> & { total: number; truncated: boolean };
  jobs: Record<DurableJob['state'], number> & { total: number; truncated: boolean };
  webhooks: { total: number; active: number };
  audit: AuditVerification;
  recentAudit: AuditEvent[];
}

function iso(date: Date): string {
  return date.toISOString();
}

function plusSeconds(date: Date, seconds: number): string {
  return iso(new Date(date.getTime() + seconds * 1000));
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2000);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [first = 0, second = 0] = parts;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function validateWebhookUrl(value: string, allowedHosts?: ReadonlySet<string>): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GridStoryError('Webhook URL is invalid.', 'invalid_webhook', 400);
  }
  const hostname = url.hostname.toLocaleLowerCase('en-US');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    (isIP(hostname) === 4 && isPrivateIpv4(hostname)) ||
    isIP(hostname) === 6
  ) {
    throw new GridStoryError(
      'Webhook URLs must use HTTPS and a public host without embedded credentials.',
      'invalid_webhook',
      400,
    );
  }
  if (allowedHosts && !allowedHosts.has(hostname)) {
    throw new GridStoryError(
      'Webhook host is not on the configured allow-list.',
      'invalid_webhook',
      400,
    );
  }
  url.hash = '';
  return url.toString();
}

async function defaultWebhookTransport(input: WebhookTransportInput): Promise<{ status: number }> {
  const response = await fetch(input.url, {
    method: 'POST',
    headers: input.headers,
    body: input.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webhook endpoint returned HTTP ${response.status}.`);
  }
  return { status: response.status };
}

export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export class OperationsService {
  readonly #repository: ContentRepository;
  readonly #webhookSigningSecret: string;
  readonly #webhookTransport: WebhookTransport;
  readonly #cacheInvalidator: CacheInvalidator;
  readonly #workflowActionNotifier: NonNullable<OperationsServiceOptions['workflowActionNotifier']>;
  readonly #searchJobRunner: NonNullable<OperationsServiceOptions['searchJobRunner']>;
  readonly #analyticsLifecycleEnqueuer: OperationsServiceOptions['analyticsLifecycleEnqueuer'];
  readonly #analyticsJobRunner: NonNullable<OperationsServiceOptions['analyticsJobRunner']>;
  readonly #allowedWebhookHosts?: ReadonlySet<string>;
  readonly #telemetry: TenantTelemetrySink | undefined;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor({
    repository,
    webhookSigningSecret,
    webhookTransport = defaultWebhookTransport,
    cacheInvalidator = async () => undefined,
    workflowActionNotifier = async () => undefined,
    searchJobRunner = async () => {
      throw new Error('Search job runner is not configured.');
    },
    analyticsLifecycleEnqueuer,
    analyticsJobRunner = async () => {
      throw new Error('Analytics job runner is not configured.');
    },
    allowedWebhookHosts,
    telemetry,
    now = () => new Date(),
    createId = randomUUID,
  }: OperationsServiceOptions) {
    if (webhookSigningSecret.length < 32) {
      throw new GridStoryError(
        'Webhook signing secret must contain at least 32 characters.',
        'invalid_webhook_configuration',
        500,
      );
    }
    this.#repository = repository;
    this.#webhookSigningSecret = webhookSigningSecret;
    this.#webhookTransport = webhookTransport;
    this.#cacheInvalidator = cacheInvalidator;
    this.#workflowActionNotifier = workflowActionNotifier;
    this.#searchJobRunner = searchJobRunner;
    this.#analyticsLifecycleEnqueuer = analyticsLifecycleEnqueuer;
    this.#analyticsJobRunner = analyticsJobRunner;
    this.#telemetry = telemetry;
    if (allowedWebhookHosts) {
      this.#allowedWebhookHosts = new Set(
        allowedWebhookHosts.map((host) => host.toLocaleLowerCase('en-US')),
      );
    }
    this.#now = now;
    this.#createId = createId;
  }

  async saveWebhook(input: {
    scope: ContentScope;
    id?: string;
    url: string;
    eventTypes: ContentEventType[];
    active?: boolean;
  }): Promise<WebhookSubscription> {
    const eventTypes = [...new Set(input.eventTypes)];
    if (
      eventTypes.length === 0 ||
      eventTypes.some((eventType) => !contentEventTypes.includes(eventType))
    ) {
      throw new GridStoryError(
        'Webhook eventTypes must contain supported content events.',
        'invalid_webhook',
        400,
      );
    }
    const saved = await this.#repository.saveWebhookSubscription({
      scope: input.scope,
      ...(input.id ? { id: input.id } : {}),
      url: validateWebhookUrl(input.url, this.#allowedWebhookHosts),
      eventTypes,
      ...(input.active !== undefined ? { active: input.active } : {}),
    });
    assertSameContentScope(input.scope, saved, 'webhook repository save');
    return saved;
  }

  async listWebhooks(scope: ContentScope): Promise<WebhookSubscription[]> {
    const webhooks = await this.#repository.listWebhookSubscriptions({ scope });
    webhooks.forEach((webhook) => {
      assertSameContentScope(scope, webhook, 'webhook repository list');
    });
    return webhooks;
  }

  deleteWebhook(scope: ContentScope, id: string): Promise<boolean> {
    return Promise.resolve(this.#repository.deleteWebhookSubscription({ scope, id }));
  }

  async listOutbox(scope: ContentScope, limit?: number): Promise<OutboxEvent[]> {
    const events = await this.#repository.listOutboxEvents({
      scope,
      ...(limit ? { limit } : {}),
    });
    events.forEach((event) => {
      assertSameContentScope(scope, event, 'outbox repository list');
    });
    return events;
  }

  async listJobs(scope: ContentScope, limit?: number): Promise<DurableJob[]> {
    const jobs = await this.#repository.listJobs({ scope, ...(limit ? { limit } : {}) });
    jobs.forEach((job) => {
      assertSameContentScope(scope, job, 'job repository list');
    });
    return jobs;
  }

  async listWorkflowActions(scope: ContentScope, limit = 100): Promise<DurableJob[]> {
    return (await this.listJobs(scope, 1000))
      .filter((job) => job.type === 'workflow.action')
      .slice(0, Math.max(1, Math.min(limit, 1000)));
  }

  async listOperationalScopes(limit?: number): Promise<ContentScope[]> {
    const scopes = await this.#repository.listOperationalScopes({ ...(limit ? { limit } : {}) });
    scopes.forEach(assertValidContentScope);
    return scopes;
  }

  async dashboard(scope: ContentScope): Promise<OperationsDashboard> {
    const [entries, outbox, jobs, webhooks, auditEvents] = await Promise.all([
      this.#repository.list({ scope, perspective: 'draft' }),
      this.#repository.listOutboxEvents({ scope, limit: 1000 }),
      this.#repository.listJobs({ scope, limit: 1000 }),
      this.#repository.listWebhookSubscriptions({ scope }),
      this.#repository.listScopeAuditEvents({ scope }),
    ]);
    entries.forEach((entry) => {
      assertSameContentScope(scope, entry, 'operations content repository list');
    });
    outbox.forEach((event) => {
      assertSameContentScope(scope, event, 'operations outbox repository list');
    });
    jobs.forEach((job) => {
      assertSameContentScope(scope, job, 'operations job repository list');
    });
    webhooks.forEach((webhook) => {
      assertSameContentScope(scope, webhook, 'operations webhook repository list');
    });
    auditEvents.forEach((event) => {
      assertSameContentScope(scope, event, 'operations audit repository list');
    });
    const content = { total: entries.length, draft: 0, changed: 0, published: 0 };
    for (const entry of entries) content[entry.status] += 1;
    const outboxCounts = { total: outbox.length, pending: 0, processing: 0, succeeded: 0, dead: 0 };
    for (const event of outbox) outboxCounts[event.state] += 1;
    const jobCounts = { total: jobs.length, pending: 0, processing: 0, succeeded: 0, dead: 0 };
    for (const job of jobs) jobCounts[job.state] += 1;
    return {
      generatedAt: iso(this.#now()),
      content,
      outbox: { ...outboxCounts, truncated: outbox.length === 1000 },
      jobs: { ...jobCounts, truncated: jobs.length === 1000 },
      webhooks: {
        total: webhooks.length,
        active: webhooks.filter((webhook) => webhook.active).length,
      },
      audit: verifyAuditEvents(auditEvents),
      recentAudit: [...auditEvents]
        .sort(
          (left, right) =>
            right.occurredAt.localeCompare(left.occurredAt) ||
            right.sequence - left.sequence ||
            right.id.localeCompare(left.id),
        )
        .slice(0, 20),
    };
  }

  async replayJob(scope: ContentScope, id: string): Promise<DurableJob> {
    const job = await this.#repository.getJob({ scope, id });
    if (!job) throw new NotFoundError('Durable job was not found.');
    assertSameContentScope(scope, job, 'job repository get');
    if (job.state === 'processing') {
      throw new GridStoryError('A processing job cannot be replayed.', 'job_processing', 409);
    }
    const replay = await this.#repository.enqueueJob({
      scope,
      type: job.type,
      idempotencyKey: `replay:${job.id}:${this.#createId()}`,
      payload: job.payload,
      runAt: iso(this.#now()),
      maxAttempts: job.maxAttempts,
    });
    assertSameContentScope(scope, replay, 'replayed job enqueue');
    return replay;
  }

  async replayWorkflowAction(scope: ContentScope, id: string): Promise<DurableJob> {
    const job = await this.#repository.getJob({ scope, id });
    if (job?.type !== 'workflow.action') {
      throw new NotFoundError('Workflow action delivery was not found.');
    }
    return await this.replayJob(scope, id);
  }

  async #expandOutbox(scope: ContentScope, workerId: string, event: OutboxEvent): Promise<number> {
    assertSameContentScope(scope, event, 'claimed outbox event');
    let enqueued = 0;
    const cacheJob = await this.#repository.enqueueJob({
      scope,
      type: 'cache.invalidate',
      idempotencyKey: `outbox:${event.id}:cache`,
      payload: { eventId: event.id, tags: event.cacheTags },
      runAt: iso(this.#now()),
      maxAttempts: 8,
    });
    assertSameContentScope(scope, cacheJob, 'cache job enqueue');
    enqueued += 1;
    const searchJob = await this.#repository.enqueueJob({
      scope,
      type: 'search.index',
      idempotencyKey: `outbox:${event.id}:search`,
      payload: {
        eventId: event.id,
        eventType: event.type,
        entryId: event.aggregateId,
        revisionId: event.revisionId,
      },
      runAt: iso(this.#now()),
      maxAttempts: 8,
    });
    assertSameContentScope(scope, searchJob, 'search job enqueue');
    enqueued += 1;
    if (this.#analyticsLifecycleEnqueuer) {
      await this.#analyticsLifecycleEnqueuer({ scope, event });
      enqueued += 1;
    }
    const subscriptions = await this.#repository.listWebhookSubscriptions({ scope });
    subscriptions.forEach((subscription) => {
      assertSameContentScope(scope, subscription, 'outbox webhook subscription');
    });
    for (const subscription of subscriptions) {
      if (!subscription.active || !subscription.eventTypes.includes(event.type)) continue;
      const webhookJob = await this.#repository.enqueueJob({
        scope,
        type: 'webhook.deliver',
        idempotencyKey: `outbox:${event.id}:webhook:${subscription.id}`,
        payload: {
          event,
          subscriptionId: subscription.id,
          url: subscription.url,
        },
        runAt: iso(this.#now()),
        maxAttempts: 8,
      });
      assertSameContentScope(scope, webhookJob, 'webhook job enqueue');
      enqueued += 1;
    }
    await this.#repository.completeOutboxEvent({
      scope,
      id: event.id,
      workerId,
      completedAt: iso(this.#now()),
    });
    return enqueued;
  }

  async #runJob(scope: ContentScope, workerId: string, job: DurableJob): Promise<void> {
    assertSameContentScope(scope, job, 'claimed durable job');
    if (job.type === 'analytics.process' || job.type === 'analytics.deliver') {
      const result = await this.#analyticsJobRunner({
        scope,
        type: job.type,
        payload: job.payload,
      });
      await this.#repository.completeJob({
        scope,
        id: job.id,
        workerId,
        completedAt: iso(this.#now()),
        result,
      });
      return;
    }
    if (job.type === 'search.index' || job.type === 'search.rebuild') {
      const result = await this.#searchJobRunner({ scope, type: job.type, payload: job.payload });
      await this.#repository.completeJob({
        scope,
        id: job.id,
        workerId,
        completedAt: iso(this.#now()),
        result,
      });
      return;
    }
    if (job.type === 'cache.invalidate') {
      const tags = Array.isArray(job.payload.tags)
        ? job.payload.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];
      if (tags.length === 0 || tags.some((tag) => !cacheTagBelongsToScope(scope, tag))) {
        throw new Error('Cache invalidation job contains tags outside its tenant scope.');
      }
      await this.#cacheInvalidator({ scope, tags });
      await this.#repository.completeJob({
        scope,
        id: job.id,
        workerId,
        completedAt: iso(this.#now()),
        result: { invalidatedTags: tags.length },
      });
      return;
    }
    if (job.type === 'workflow.action') {
      const action = workflowActionDefinitionSchema.parse(job.payload.action);
      const entryId = typeof job.payload.entryId === 'string' ? job.payload.entryId : '';
      if (!entryId) throw new Error('Workflow action entryId is invalid.');
      let result: Record<string, unknown>;
      if (action.type === 'notification') {
        await this.#workflowActionNotifier({
          scope,
          entryId,
          message: action.message,
          audienceRoles: action.audienceRoles,
        });
        result = { delivered: true, audienceRoles: action.audienceRoles.length };
      } else if (action.type === 'cache-invalidate') {
        const tags = scopedCustomCacheTags(scope, action.tags);
        await this.#cacheInvalidator({ scope, tags });
        result = { invalidatedTags: tags.length };
      } else {
        const body = JSON.stringify({
          scope,
          deliveryId: job.id,
          idempotencyKey: job.idempotencyKey,
          eventId: job.payload.eventId,
          workflowId: job.payload.workflowId,
          workflowVersion: job.payload.workflowVersion,
          entryId,
          revisionId: job.payload.revisionId,
          transitionId: job.payload.transitionId,
          action: { id: action.id, label: action.label, type: action.type },
        });
        const timestamp = String(Math.floor(this.#now().getTime() / 1000));
        const response = await this.#webhookTransport({
          scope,
          url: validateWebhookUrl(action.url, this.#allowedWebhookHosts),
          body,
          headers: {
            'content-type': 'application/json',
            'user-agent': 'GridStory-Workflow-Actions/1.0',
            'x-gridstory-delivery': job.id,
            'x-gridstory-event': action.eventName,
            'x-gridstory-timestamp': timestamp,
            'x-gridstory-signature': signWebhookPayload(
              this.#webhookSigningSecret,
              timestamp,
              body,
            ),
          },
        });
        result = { httpStatus: response.status };
      }
      await this.#repository.completeJob({
        scope,
        id: job.id,
        workerId,
        completedAt: iso(this.#now()),
        result,
      });
      return;
    }
    const url = typeof job.payload.url === 'string' ? job.payload.url : '';
    const event = job.payload.event;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error('Webhook job event payload is invalid.');
    }
    const eventRecord = event as Record<string, unknown>;
    assertSameContentScope(
      scope,
      eventRecord as unknown as ContentScope,
      'webhook job event payload',
    );
    const body = JSON.stringify(eventRecord);
    const timestamp = String(Math.floor(this.#now().getTime() / 1000));
    const response = await this.#webhookTransport({
      scope,
      url: validateWebhookUrl(url, this.#allowedWebhookHosts),
      body,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'GridStory-Webhooks/1.0',
        'x-gridstory-delivery': job.id,
        'x-gridstory-event': typeof eventRecord.id === 'string' ? eventRecord.id : '',
        'x-gridstory-timestamp': timestamp,
        'x-gridstory-signature': signWebhookPayload(this.#webhookSigningSecret, timestamp, body),
      },
    });
    await this.#repository.completeJob({
      scope,
      id: job.id,
      workerId,
      completedAt: iso(this.#now()),
      result: { httpStatus: response.status },
    });
  }

  async drain(input: {
    scope: ContentScope;
    workerId?: string;
    limit?: number;
  }): Promise<DrainResult> {
    const workerId = input.workerId ?? `worker-${this.#createId()}`;
    const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
    const now = this.#now();
    const outbox = await this.#repository.claimOutboxEvents({
      scope: input.scope,
      workerId,
      limit,
      now: iso(now),
      leaseExpiresAt: plusSeconds(now, 60),
    });
    outbox.forEach((event) => {
      assertSameContentScope(input.scope, event, 'claimed outbox batch');
    });
    let completedOutbox = 0;
    let enqueuedJobs = 0;
    for (const event of outbox) {
      try {
        enqueuedJobs += await this.#expandOutbox(input.scope, workerId, event);
        completedOutbox += 1;
      } catch (error) {
        const dead = event.attempts >= 10;
        await this.#repository.retryOutboxEvent({
          scope: input.scope,
          id: event.id,
          workerId,
          availableAt: plusSeconds(this.#now(), Math.min(3600, 2 ** event.attempts)),
          error: errorMessage(error),
          dead,
        });
      }
    }

    const jobs = await this.#repository.claimJobs({
      scope: input.scope,
      workerId,
      limit,
      now: iso(this.#now()),
      leaseExpiresAt: plusSeconds(this.#now(), 60),
    });
    jobs.forEach((job) => {
      assertSameContentScope(input.scope, job, 'claimed job batch');
    });
    let completedJobs = 0;
    let retriedJobs = 0;
    let deadJobs = 0;
    for (const job of jobs) {
      try {
        await this.#runJob(input.scope, workerId, job);
        completedJobs += 1;
      } catch (error) {
        const dead = job.attempts >= job.maxAttempts;
        await this.#repository.failJob({
          scope: input.scope,
          id: job.id,
          workerId,
          runAt: plusSeconds(this.#now(), Math.min(3600, 2 ** job.attempts)),
          error: errorMessage(error),
          dead,
        });
        if (dead) deadJobs += 1;
        else retriedJobs += 1;
      }
    }
    const result = {
      claimedOutbox: outbox.length,
      completedOutbox,
      enqueuedJobs,
      claimedJobs: jobs.length,
      completedJobs,
      retriedJobs,
      deadJobs,
    };
    await emitTenantTelemetry(this.#telemetry, {
      scope: input.scope,
      name: 'operations.drain.completed',
      outcome: deadJobs > 0 ? 'error' : 'success',
      operationId: workerId,
      metadata: result,
    });
    return result;
  }
}
