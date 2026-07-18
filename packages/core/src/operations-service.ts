import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { ContentEntry, ContentScope } from '@gridstory/schema';
import { verifyAuditEvents, type AuditVerification } from './audit-service.js';
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
  url: string;
  body: string;
  headers: Record<string, string>;
}

export type WebhookTransport = (input: WebhookTransportInput) => Promise<{ status: number }>;

export type CacheInvalidator = (tags: string[]) => Promise<void>;

export interface OperationsServiceOptions {
  repository: ContentRepository;
  webhookSigningSecret: string;
  webhookTransport?: WebhookTransport;
  cacheInvalidator?: CacheInvalidator;
  allowedWebhookHosts?: string[];
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

export function contentCacheTags(entry: ContentEntry): string[] {
  return [
    `gridstory:tenant:${entry.tenantId}`,
    `gridstory:site:${entry.siteId}`,
    `gridstory:environment:${entry.environmentId}`,
    `gridstory:locale:${entry.locale}`,
    `gridstory:type:${entry.contentType}`,
    `gridstory:entry:${entry.id}`,
    `gridstory:revision:${entry.publishedRevisionId ?? entry.draftRevisionId}`,
  ];
}

export class OperationsService {
  readonly #repository: ContentRepository;
  readonly #webhookSigningSecret: string;
  readonly #webhookTransport: WebhookTransport;
  readonly #cacheInvalidator: CacheInvalidator;
  readonly #allowedWebhookHosts?: ReadonlySet<string>;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor({
    repository,
    webhookSigningSecret,
    webhookTransport = defaultWebhookTransport,
    cacheInvalidator = async () => undefined,
    allowedWebhookHosts,
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
    return this.#repository.saveWebhookSubscription({
      scope: input.scope,
      ...(input.id ? { id: input.id } : {}),
      url: validateWebhookUrl(input.url, this.#allowedWebhookHosts),
      eventTypes,
      ...(input.active !== undefined ? { active: input.active } : {}),
    });
  }

  listWebhooks(scope: ContentScope): Promise<WebhookSubscription[]> {
    return Promise.resolve(this.#repository.listWebhookSubscriptions({ scope }));
  }

  deleteWebhook(scope: ContentScope, id: string): Promise<boolean> {
    return Promise.resolve(this.#repository.deleteWebhookSubscription({ scope, id }));
  }

  listOutbox(scope: ContentScope, limit?: number): Promise<OutboxEvent[]> {
    return Promise.resolve(
      this.#repository.listOutboxEvents({ scope, ...(limit ? { limit } : {}) }),
    );
  }

  listJobs(scope: ContentScope, limit?: number): Promise<DurableJob[]> {
    return Promise.resolve(this.#repository.listJobs({ scope, ...(limit ? { limit } : {}) }));
  }

  listOperationalScopes(limit?: number): Promise<ContentScope[]> {
    return Promise.resolve(this.#repository.listOperationalScopes({ ...(limit ? { limit } : {}) }));
  }

  async dashboard(scope: ContentScope): Promise<OperationsDashboard> {
    const [entries, outbox, jobs, webhooks, auditEvents] = await Promise.all([
      this.#repository.list({ scope, perspective: 'draft' }),
      this.#repository.listOutboxEvents({ scope, limit: 1000 }),
      this.#repository.listJobs({ scope, limit: 1000 }),
      this.#repository.listWebhookSubscriptions({ scope }),
      this.#repository.listScopeAuditEvents({ scope }),
    ]);
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
    if (job.state === 'processing') {
      throw new GridStoryError('A processing job cannot be replayed.', 'job_processing', 409);
    }
    return this.#repository.enqueueJob({
      scope,
      type: job.type,
      idempotencyKey: `replay:${job.id}:${this.#createId()}`,
      payload: job.payload,
      runAt: iso(this.#now()),
      maxAttempts: job.maxAttempts,
    });
  }

  async #expandOutbox(scope: ContentScope, workerId: string, event: OutboxEvent): Promise<number> {
    let enqueued = 0;
    await this.#repository.enqueueJob({
      scope,
      type: 'cache.invalidate',
      idempotencyKey: `outbox:${event.id}:cache`,
      payload: { eventId: event.id, tags: event.cacheTags },
      runAt: iso(this.#now()),
      maxAttempts: 8,
    });
    enqueued += 1;
    const subscriptions = await this.#repository.listWebhookSubscriptions({ scope });
    for (const subscription of subscriptions) {
      if (!subscription.active || !subscription.eventTypes.includes(event.type)) continue;
      await this.#repository.enqueueJob({
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
    if (job.type === 'cache.invalidate') {
      const tags = Array.isArray(job.payload.tags)
        ? job.payload.tags.filter((tag): tag is string => typeof tag === 'string')
        : [];
      await this.#cacheInvalidator(tags);
      await this.#repository.completeJob({
        scope,
        id: job.id,
        workerId,
        completedAt: iso(this.#now()),
        result: { invalidatedTags: tags.length },
      });
      return;
    }
    const url = typeof job.payload.url === 'string' ? job.payload.url : '';
    const event = job.payload.event;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error('Webhook job event payload is invalid.');
    }
    const eventRecord = event as Record<string, unknown>;
    const body = JSON.stringify(eventRecord);
    const timestamp = String(Math.floor(this.#now().getTime() / 1000));
    const response = await this.#webhookTransport({
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
    return {
      claimedOutbox: outbox.length,
      completedOutbox,
      enqueuedJobs,
      claimedJobs: jobs.length,
      completedJobs,
      retriedJobs,
      deadJobs,
    };
  }
}
