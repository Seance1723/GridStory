import type {
  ComponentManifest,
  ContentEntry,
  ContentPerspective,
  ContentQualityReport,
  ContentRevision,
  ContentScope,
  ContentSchemaDefinition,
  SchemaIrDocument,
} from '@gridstory/schema';

export interface Actor {
  id: string;
  displayName?: string;
  roles?: string[];
}

export interface ContentWorkflowGate {
  contentCreated(input: {
    scope: ContentScope;
    entry: ContentEntry;
    actor: Actor;
  }): Awaitable<void>;
  draftUpdated(input: { scope: ContentScope; entry: ContentEntry; actor: Actor }): Awaitable<void>;
  assertCanPublish(input: {
    scope: ContentScope;
    entry: ContentEntry;
    actor: Actor;
  }): Awaitable<void>;
  contentPublished(input: {
    scope: ContentScope;
    entry: ContentEntry;
    actor: Actor;
  }): Awaitable<void>;
}
export interface ContentPublishGate {
  assess(input: {
    scope: ContentScope;
    entry: ContentEntry;
    channel?: string;
    roles?: string[];
  }): Awaitable<ContentQualityReport>;
}

export interface AuditEvent extends ContentScope {
  id: string;
  entryId: string;
  sequence: number;
  actorId: string;
  action: 'content.created' | 'content.draft.updated' | 'content.published';
  revisionId: string;
  occurredAt: string;
  previousHash?: string;
  eventHash: string;
}

export type Awaitable<T> = T | Promise<T>;

export interface SchemaDeployment extends ContentScope {
  document: SchemaIrDocument;
  fingerprint: string;
  generatedTypes: string;
  generatedTypesFingerprint: string;
  migrationPlanId?: string;
  deployedAt: string;
  actorId: string;
}

export type ContentEventType = 'content.created' | 'content.draft.updated' | 'content.published';

export type DurableState = 'pending' | 'processing' | 'succeeded' | 'dead';

export interface OutboxEvent extends ContentScope {
  id: string;
  type: ContentEventType;
  aggregateId: string;
  revisionId: string;
  payload: Record<string, unknown>;
  cacheTags: string[];
  occurredAt: string;
  state: DurableState;
  attempts: number;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  processedAt?: string;
  lastError?: string;
}

export interface DurableJob extends ContentScope {
  id: string;
  type: 'cache.invalidate' | 'webhook.deliver';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  state: DurableState;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WebhookSubscription extends ContentScope {
  id: string;
  url: string;
  eventTypes: ContentEventType[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PortableRevision {
  id: string;
  sequence: number;
  baseRevisionId?: string;
  actorId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface PortableAuditEvent {
  id: string;
  sequence: number;
  actorId: string;
  action: AuditEvent['action'];
  revisionId: string;
  occurredAt: string;
}

export interface PortableContentRecord {
  entryId: string;
  contentType: string;
  currentDraftRevisionId: string;
  publishedRevisionId?: string;
  translationGroupId: string;
  createdAt: string;
  updatedAt: string;
  revisions: PortableRevision[];
  auditEvents: PortableAuditEvent[];
}

export type ImportConflictPolicy = 'reject' | 'skip' | 'replace';

export interface PortableImportResult {
  imported: number;
  skipped: number;
  replaced: number;
  conflicts: string[];
  dryRun: boolean;
}

export interface AtomicPublication {
  entryId: string;
  targetRevisionId: string;
  expectedDraftRevisionId?: string;
  expectedPublishedRevisionId?: string | null;
}
export interface ContentRepository {
  list(input: {
    scope: ContentScope;
    contentType?: string;
    perspective: ContentPerspective;
  }): Awaitable<ContentEntry[]>;
  getById(input: {
    scope: ContentScope;
    id: string;
    perspective: ContentPerspective;
  }): Awaitable<ContentEntry | null>;
  getBySlug(input: {
    scope: ContentScope;
    contentType: string;
    slug: string;
    perspective: ContentPerspective;
  }): Awaitable<ContentEntry | null>;
  create(input: {
    scope: ContentScope;
    contentType: string;
    data: Record<string, unknown>;
    actor: Actor;
    translationGroupId?: string;
  }): Awaitable<ContentEntry>;
  updateDraft(input: {
    scope: ContentScope;
    id: string;
    expectedRevisionId: string;
    data: Record<string, unknown>;
    actor: Actor;
  }): Awaitable<ContentEntry>;
  publish(input: {
    scope: ContentScope;
    id: string;
    expectedRevisionId: string;
    actor: Actor;
  }): Awaitable<ContentEntry>;
  publishMany(input: {
    scope: ContentScope;
    entries: AtomicPublication[];
    actor: Actor;
  }): Awaitable<ContentEntry[]>;
  getRevision(input: {
    scope: ContentScope;
    id: string;
    revisionId: string;
  }): Awaitable<ContentRevision | null>;
  listRevisions(input: { scope: ContentScope; id: string }): Awaitable<ContentRevision[]>;
  listAuditEvents(input: { scope: ContentScope; id: string }): Awaitable<AuditEvent[]>;
  listScopeAuditEvents(input: { scope: ContentScope }): Awaitable<AuditEvent[]>;
  getTranslationGroup(input: { scope: ContentScope; id: string }): Awaitable<string | null>;
  listTranslationVariants(input: {
    scope: ContentScope;
    translationGroupId: string;
    perspective: ContentPerspective;
  }): Awaitable<ContentEntry[]>;
  listOutboxEvents(input: { scope: ContentScope; limit?: number }): Awaitable<OutboxEvent[]>;
  listOperationalScopes(input?: { limit?: number }): Awaitable<ContentScope[]>;
  claimOutboxEvents(input: {
    scope: ContentScope;
    workerId: string;
    limit: number;
    now: string;
    leaseExpiresAt: string;
  }): Awaitable<OutboxEvent[]>;
  completeOutboxEvent(input: {
    scope: ContentScope;
    id: string;
    workerId: string;
    completedAt: string;
  }): Awaitable<void>;
  retryOutboxEvent(input: {
    scope: ContentScope;
    id: string;
    workerId: string;
    availableAt: string;
    error: string;
    dead: boolean;
  }): Awaitable<void>;
  enqueueJob(input: {
    scope: ContentScope;
    type: DurableJob['type'];
    idempotencyKey: string;
    payload: Record<string, unknown>;
    runAt: string;
    maxAttempts: number;
  }): Awaitable<DurableJob>;
  listJobs(input: { scope: ContentScope; limit?: number }): Awaitable<DurableJob[]>;
  getJob(input: { scope: ContentScope; id: string }): Awaitable<DurableJob | null>;
  claimJobs(input: {
    scope: ContentScope;
    workerId: string;
    limit: number;
    now: string;
    leaseExpiresAt: string;
  }): Awaitable<DurableJob[]>;
  completeJob(input: {
    scope: ContentScope;
    id: string;
    workerId: string;
    completedAt: string;
    result: Record<string, unknown>;
  }): Awaitable<void>;
  failJob(input: {
    scope: ContentScope;
    id: string;
    workerId: string;
    runAt: string;
    error: string;
    dead: boolean;
  }): Awaitable<void>;
  saveWebhookSubscription(input: {
    scope: ContentScope;
    id?: string;
    url: string;
    eventTypes: ContentEventType[];
    active?: boolean;
  }): Awaitable<WebhookSubscription>;
  listWebhookSubscriptions(input: { scope: ContentScope }): Awaitable<WebhookSubscription[]>;
  deleteWebhookSubscription(input: { scope: ContentScope; id: string }): Awaitable<boolean>;
  exportPortableContent(input: { scope: ContentScope }): Awaitable<PortableContentRecord[]>;
  importPortableContent(input: {
    scope: ContentScope;
    records: PortableContentRecord[];
    conflictPolicy: ImportConflictPolicy;
    dryRun: boolean;
  }): Awaitable<PortableImportResult>;
  getSchemaDeployment(input: { scope: ContentScope }): Awaitable<SchemaDeployment | null>;
  saveSchemaDeployment(input: {
    scope: ContentScope;
    document: SchemaIrDocument;
    fingerprint: string;
    generatedTypes: string;
    generatedTypesFingerprint: string;
    migrationPlanId?: string;
    actor: Actor;
  }): Awaitable<SchemaDeployment>;
  close(): Awaitable<void>;
}

export interface ContentServiceOptions {
  repository: ContentRepository;
  schemas: ContentSchemaDefinition[];
  componentManifests: ComponentManifest[];
  qualityGate?: ContentPublishGate;
  workflowGate?: ContentWorkflowGate;
}

export type {
  ContentEntry,
  ContentPerspective,
  ContentQualityReport,
  ContentRevision,
  ContentScope,
  ContentStatus,
} from '@gridstory/schema';
