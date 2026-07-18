import type {
  ComponentManifest,
  ContentEntry,
  ContentConnection,
  ContentFilter,
  ContentFilterOperator,
  ContentQuery,
  ContentSort,
  LocaleConfiguration,
  LocalizedContentResolution,
  ContentPerspective,
  ContentRevision,
  ContentSchemaDefinition,
  DesignSystemManifest,
  RequestContext,
  SchemaDriftReport,
  SchemaIrDocument,
  SchemaMigrationPlan,
  TranslationCompletenessReport,
  ValidationIssue,
  VisualModelDocument,
} from '@gridstory/schema';

export interface SchemaDeploymentRecord {
  document: SchemaIrDocument;
  fingerprint: string;
  generatedTypes: string;
  generatedTypesFingerprint: string;
  migrationPlanId?: string;
  deployedAt: string;
  actorId: string;
}

export interface SchemaLifecycleInspection {
  source: SchemaIrDocument;
  visualModel: VisualModelDocument;
  fingerprint: string;
  generatedTypes: string;
  generatedTypesFingerprint: string;
  deployment: SchemaDeploymentRecord | null;
}

export interface SchemaMigrationAssessmentResponse {
  plan: SchemaMigrationPlan;
  impact: {
    scannedEntries: number;
    affectedEntries: number;
    byContentType: Record<string, number>;
    invalidEntries: Array<{
      entryId: string;
      contentType: string;
      issues: ValidationIssue[];
    }>;
  };
}

export type ContentEventType = 'content.created' | 'content.draft.updated' | 'content.published';

export interface OutboxEventRecord {
  id: string;
  type: ContentEventType;
  aggregateId: string;
  revisionId: string;
  payload: Record<string, unknown>;
  cacheTags: string[];
  state: 'pending' | 'processing' | 'succeeded' | 'dead';
  attempts: number;
  occurredAt: string;
  availableAt: string;
}

export interface DurableJobRecord {
  id: string;
  type: 'cache.invalidate' | 'webhook.deliver';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  state: 'pending' | 'processing' | 'succeeded' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lastError?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookSubscriptionRecord {
  id: string;
  url: string;
  eventTypes: ContentEventType[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsDrainResult {
  claimedOutbox: number;
  completedOutbox: number;
  enqueuedJobs: number;
  claimedJobs: number;
  completedJobs: number;
  retriedJobs: number;
  deadJobs: number;
}

export interface LogicalArchiveRevision {
  id: string;
  sequence: number;
  baseRevisionId?: string;
  actorId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface LogicalArchiveRecord {
  entryId: string;
  contentType: string;
  currentDraftRevisionId: string;
  publishedRevisionId?: string;
  translationGroupId: string;
  createdAt: string;
  updatedAt: string;
  revisions: LogicalArchiveRevision[];
  auditEvents: Array<{
    id: string;
    sequence: number;
    actorId: string;
    action: ContentEventType;
    revisionId: string;
    occurredAt: string;
  }>;
}

export interface LogicalContentArchive {
  manifest: {
    kind: 'manifest';
    format: 'gridstory.logical-content';
    version: 1;
    sourceScope: Pick<
      RequestContext,
      'organizationId' | 'tenantId' | 'workspaceId' | 'siteId' | 'environmentId' | 'locale'
    >;
    exportedAt: string;
    entryCount: number;
    archiveChecksum: string;
    schemaFingerprint?: string;
  };
  entries: Array<{
    kind: 'entry';
    checksum: string;
    record: LogicalArchiveRecord;
  }>;
}

export interface LogicalImportResult {
  imported: number;
  skipped: number;
  replaced: number;
  conflicts: string[];
  dryRun: boolean;
}

export interface AuditEventRecord {
  id: string;
  organizationId: string;
  tenantId: string;
  workspaceId: string;
  siteId: string;
  environmentId: string;
  locale: string;
  entryId: string;
  sequence: number;
  actorId: string;
  action: ContentEventType;
  revisionId: string;
  occurredAt: string;
  previousHash?: string;
  eventHash: string;
}

export interface AuditVerificationRecord {
  valid: boolean;
  eventCount: number;
  entryCount: number;
  failures: Array<{
    eventId: string;
    entryId: string;
    reason: 'sequence_mismatch' | 'previous_hash_mismatch' | 'event_hash_mismatch';
  }>;
}

export interface AuditExportRecord {
  manifest: {
    kind: 'gridstory.audit.manifest';
    version: 1;
    scope: LogicalContentArchive['manifest']['sourceScope'];
    exportedAt: string;
    eventCount: number;
    entryCount: number;
    auditChecksum: string;
    valid: boolean;
  };
  events: AuditEventRecord[];
  failures: AuditVerificationRecord['failures'];
}

export interface OperationsDashboardRecord {
  generatedAt: string;
  content: { total: number; draft: number; changed: number; published: number };
  outbox: Record<'pending' | 'processing' | 'succeeded' | 'dead', number> & {
    total: number;
    truncated: boolean;
  };
  jobs: Record<'pending' | 'processing' | 'succeeded' | 'dead', number> & {
    total: number;
    truncated: boolean;
  };
  webhooks: { total: number; active: number };
  audit: AuditVerificationRecord;
  recentAudit: AuditEventRecord[];
}

export interface GridStoryClientOptions {
  baseUrl: string;
  tenantId: string;
  actorId?: string;
  scope?: Partial<
    Pick<RequestContext, 'organizationId' | 'workspaceId' | 'siteId' | 'environmentId' | 'locale'>
  >;
  fetch?: typeof globalThis.fetch;
}

export interface GridStoryErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
}

export class GridStoryApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { status: number; code?: string; details?: unknown; requestId?: string },
  ) {
    super(message);
    this.name = 'GridStoryApiError';
    this.status = options.status;
    this.code = options.code ?? 'request_failed';
    if (options.details !== undefined) this.details = options.details;
    if (options.requestId !== undefined) this.requestId = options.requestId;
  }
}

export class GridStoryClient {
  readonly #baseUrl: string;
  readonly #tenantId: string;
  readonly #actorId: string;
  readonly #scope: Required<NonNullable<GridStoryClientOptions['scope']>>;
  readonly #fetch: typeof globalThis.fetch;

  constructor({
    baseUrl,
    tenantId,
    actorId = 'local-admin',
    scope = {},
    fetch,
  }: GridStoryClientOptions) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#tenantId = tenantId;
    this.#actorId = actorId;
    this.#scope = {
      organizationId: scope.organizationId ?? 'local',
      workspaceId: scope.workspaceId ?? 'default',
      siteId: scope.siteId ?? 'default',
      environmentId: scope.environmentId ?? 'development',
      locale: scope.locale ?? 'en',
    };
    this.#fetch = fetch ?? globalThis.fetch.bind(globalThis);
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        'x-gridstory-organization': this.#scope.organizationId,
        'x-gridstory-tenant': this.#tenantId,
        'x-gridstory-workspace': this.#scope.workspaceId,
        'x-gridstory-site': this.#scope.siteId,
        'x-gridstory-environment': this.#scope.environmentId,
        'x-gridstory-locale': this.#scope.locale,
        'x-gridstory-actor': this.#actorId,
        ...init.headers,
      },
    });
    if (!response.ok) {
      let envelope: GridStoryErrorEnvelope = {};
      try {
        envelope = (await response.json()) as GridStoryErrorEnvelope;
      } catch {
        // Keep a stable error even if a proxy returned a non-JSON response.
      }
      throw new GridStoryApiError(
        envelope.error?.message ?? `GridStory request failed with status ${response.status}.`,
        {
          status: response.status,
          ...(envelope.error?.code ? { code: envelope.error.code } : {}),
          ...(envelope.error?.details !== undefined ? { details: envelope.error.details } : {}),
          ...(envelope.error?.requestId ? { requestId: envelope.error.requestId } : {}),
        },
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  getSchemas(signal?: AbortSignal): Promise<ContentSchemaDefinition[]> {
    return this.#request('/api/v1/schemas', { ...(signal ? { signal } : {}) });
  }

  getRequestContext(signal?: AbortSignal): Promise<RequestContext> {
    return this.#request('/api/v1/context', { ...(signal ? { signal } : {}) });
  }

  getComponentManifests(signal?: AbortSignal): Promise<ComponentManifest[]> {
    return this.#request('/api/v1/components', { ...(signal ? { signal } : {}) });
  }

  getDesignSystem(signal?: AbortSignal): Promise<DesignSystemManifest> {
    return this.#request('/api/v1/design-system', { ...(signal ? { signal } : {}) });
  }

  getSchemaLifecycle(signal?: AbortSignal): Promise<SchemaLifecycleInspection> {
    return this.#request('/api/v1/schema-lifecycle', { ...(signal ? { signal } : {}) });
  }

  getSchemaDrift(signal?: AbortSignal): Promise<SchemaDriftReport> {
    return this.#request('/api/v1/schema-lifecycle/drift', {
      ...(signal ? { signal } : {}),
    });
  }

  planSchema(
    candidate?: SchemaIrDocument | VisualModelDocument,
    signal?: AbortSignal,
  ): Promise<SchemaMigrationAssessmentResponse> {
    return this.#request('/api/v1/schema-lifecycle/plan', {
      method: 'POST',
      body: JSON.stringify({ ...(candidate ? { candidate } : {}) }),
      ...(signal ? { signal } : {}),
    });
  }

  deploySchema(
    options: { expectedPlanId?: string; approved?: boolean; signal?: AbortSignal } = {},
  ): Promise<SchemaDeploymentRecord> {
    return this.#request('/api/v1/schema-lifecycle/deploy', {
      method: 'POST',
      body: JSON.stringify({
        ...(options.expectedPlanId ? { expectedPlanId: options.expectedPlanId } : {}),
        ...(options.approved !== undefined ? { approved: options.approved } : {}),
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  listContent(
    options: { contentType?: string; perspective?: ContentPerspective; signal?: AbortSignal } = {},
  ): Promise<ContentEntry[]> {
    const search = new URLSearchParams();
    if (options.contentType) search.set('contentType', options.contentType);
    if (options.perspective) search.set('perspective', options.perspective);
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.#request(`/api/v1/content${suffix}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  queryContent(query: ContentQuery = {}, signal?: AbortSignal): Promise<ContentConnection> {
    return this.#request('/api/v1/content/query', {
      method: 'POST',
      body: JSON.stringify(query),
      ...(signal ? { signal } : {}),
    });
  }

  queryPublishedContent(
    query: Omit<ContentQuery, 'perspective'> = {},
    signal?: AbortSignal,
  ): Promise<ContentConnection> {
    return this.#request('/api/v1/delivery/query', {
      method: 'POST',
      body: JSON.stringify(query),
      ...(signal ? { signal } : {}),
    });
  }

  listLocales(signal?: AbortSignal): Promise<LocaleConfiguration[]> {
    return this.#request('/api/v1/locales', { ...(signal ? { signal } : {}) });
  }

  getTranslationCompleteness(
    sourceId: string,
    signal?: AbortSignal,
  ): Promise<TranslationCompletenessReport> {
    return this.#request(`/api/v1/content/${encodeURIComponent(sourceId)}/translations`, {
      ...(signal ? { signal } : {}),
    });
  }

  createTranslation(
    sourceId: string,
    locale: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ContentEntry> {
    return this.#request(`/api/v1/content/${encodeURIComponent(sourceId)}/translations`, {
      method: 'POST',
      body: JSON.stringify({ locale, data }),
      ...(signal ? { signal } : {}),
    });
  }

  getLocalizedContent(
    translationGroupId: string,
    options: { locale?: string; signal?: AbortSignal } = {},
  ): Promise<LocalizedContentResolution> {
    return this.#request(`/api/v1/delivery/localized/${encodeURIComponent(translationGroupId)}`, {
      ...(options.locale ? { headers: { 'x-gridstory-locale': options.locale } } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  getLocalizedRoute(
    path: string,
    options: { locale?: string; signal?: AbortSignal } = {},
  ): Promise<LocalizedContentResolution> {
    const encodedPath = path
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return this.#request(`/api/v1/delivery/localized-routes/${encodedPath}`, {
      ...(options.locale ? { headers: { 'x-gridstory-locale': options.locale } } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  listOutbox(limit = 100, signal?: AbortSignal): Promise<OutboxEventRecord[]> {
    return this.#request(`/api/v1/operations/outbox?limit=${limit}`, {
      ...(signal ? { signal } : {}),
    });
  }

  listJobs(limit = 100, signal?: AbortSignal): Promise<DurableJobRecord[]> {
    return this.#request(`/api/v1/operations/jobs?limit=${limit}`, {
      ...(signal ? { signal } : {}),
    });
  }

  listWebhooks(signal?: AbortSignal): Promise<WebhookSubscriptionRecord[]> {
    return this.#request('/api/v1/operations/webhooks', {
      ...(signal ? { signal } : {}),
    });
  }

  saveWebhook(
    input: {
      id?: string;
      url: string;
      eventTypes: ContentEventType[];
      active?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<WebhookSubscriptionRecord> {
    const path = input.id
      ? `/api/v1/operations/webhooks/${encodeURIComponent(input.id)}`
      : '/api/v1/operations/webhooks';
    return this.#request(path, {
      method: input.id ? 'PUT' : 'POST',
      body: JSON.stringify({
        url: input.url,
        eventTypes: input.eventTypes,
        ...(input.active !== undefined ? { active: input.active } : {}),
      }),
      ...(signal ? { signal } : {}),
    });
  }

  deleteWebhook(id: string, signal?: AbortSignal): Promise<void> {
    return this.#request(`/api/v1/operations/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    });
  }

  drainOperations(limit = 25, signal?: AbortSignal): Promise<OperationsDrainResult> {
    return this.#request('/api/v1/operations/drain', {
      method: 'POST',
      body: JSON.stringify({ limit }),
      ...(signal ? { signal } : {}),
    });
  }

  replayJob(id: string, signal?: AbortSignal): Promise<DurableJobRecord> {
    return this.#request(`/api/v1/operations/jobs/${encodeURIComponent(id)}/replay`, {
      method: 'POST',
      body: JSON.stringify({}),
      ...(signal ? { signal } : {}),
    });
  }

  exportContentArchive(signal?: AbortSignal): Promise<LogicalContentArchive> {
    return this.#request('/api/v1/portability/export', {
      ...(signal ? { signal } : {}),
    });
  }

  importContentArchive(
    archive: LogicalContentArchive,
    options: {
      dryRun?: boolean;
      conflictPolicy?: 'reject' | 'skip' | 'replace';
      allowSchemaMismatch?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<LogicalImportResult> {
    const search = new URLSearchParams();
    if (options.dryRun !== undefined) search.set('dryRun', String(options.dryRun));
    if (options.conflictPolicy) search.set('conflictPolicy', options.conflictPolicy);
    if (options.allowSchemaMismatch !== undefined) {
      search.set('allowSchemaMismatch', String(options.allowSchemaMismatch));
    }
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.#request(`/api/v1/portability/import${suffix}`, {
      method: 'POST',
      body: JSON.stringify(archive),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  verifyAudit(signal?: AbortSignal): Promise<AuditVerificationRecord> {
    return this.#request('/api/v1/audit/verify', {
      ...(signal ? { signal } : {}),
    });
  }

  exportAudit(signal?: AbortSignal): Promise<AuditExportRecord> {
    return this.#request('/api/v1/audit/export', {
      ...(signal ? { signal } : {}),
    });
  }

  getOperationsDashboard(signal?: AbortSignal): Promise<OperationsDashboardRecord> {
    return this.#request('/api/v1/operations/summary', {
      ...(signal ? { signal } : {}),
    });
  }

  getContent(
    id: string,
    options: { perspective?: ContentPerspective; signal?: AbortSignal } = {},
  ): Promise<ContentEntry> {
    const search = new URLSearchParams();
    if (options.perspective) search.set('perspective', options.perspective);
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}${suffix}`, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  getPublishedBySlug(
    contentType: string,
    slug: string,
    signal?: AbortSignal,
  ): Promise<ContentEntry> {
    return this.#request(
      `/api/v1/delivery/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}`,
      { ...(signal ? { signal } : {}) },
    );
  }

  createContent(
    contentType: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ContentEntry> {
    return this.#request('/api/v1/content', {
      method: 'POST',
      body: JSON.stringify({ contentType, data }),
      ...(signal ? { signal } : {}),
    });
  }

  saveDraft(
    id: string,
    expectedRevisionId: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ContentEntry> {
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ expectedRevisionId, data }),
      ...(signal ? { signal } : {}),
    });
  }

  publish(id: string, expectedRevisionId: string, signal?: AbortSignal): Promise<ContentEntry> {
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevisionId }),
      ...(signal ? { signal } : {}),
    });
  }

  listRevisions(id: string, signal?: AbortSignal): Promise<ContentRevision[]> {
    return this.#request(`/api/v1/content/${encodeURIComponent(id)}/revisions`, {
      ...(signal ? { signal } : {}),
    });
  }
}

export function createGridStoryClient(options: GridStoryClientOptions): GridStoryClient {
  return new GridStoryClient(options);
}

export type {
  ContentEntry,
  ContentConnection,
  ContentFilter,
  ContentFilterOperator,
  ContentQuery,
  ContentSort,
  LocaleConfiguration,
  LocalizedContentResolution,
  ContentPerspective,
  ContentRevision,
  ComponentManifest,
  ContentSchemaDefinition,
  SchemaDriftReport,
  SchemaIrDocument,
  SchemaMigrationPlan,
  TranslationCompletenessReport,
  VisualModelDocument,
};
