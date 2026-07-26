import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import { schemaIrDocumentSchema } from '@gridstory/schema';
import { auditEventHash } from './audit-service.js';
import { ConflictError, NotFoundError } from './errors.js';
import type {
  Actor,
  AuditEvent,
  ContentEntry,
  ContentPerspective,
  ContentRepository,
  ContentRevision,
  ContentScope,
  ContentStatus,
  SchemaDeployment,
  DurableJob,
  OutboxEvent,
  PortableContentRecord,
  PortableImportResult,
  WebhookSubscription,
} from './types.js';

interface EntryRow extends QueryResultRow {
  id: string;
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
  content_type: string;
  current_draft_revision_id: string;
  published_revision_id: string | null;
  created_at: string;
  updated_at: string;
  data_json: unknown;
}

interface RevisionRow extends QueryResultRow {
  id: string;
  entry_id: string;
  tenant_id: string;
  sequence: number;
  base_revision_id: string | null;
  created_at: string;
  actor_id: string;
  data_json: unknown;
  organization_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
}

interface AuditRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  entry_id: string;
  sequence: number | null;
  actor_id: string;
  action: AuditEvent['action'];
  revision_id: string;
  occurred_at: string;
  previous_hash: string | null;
  event_hash: string;
  organization_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
}

interface SchemaDeploymentRow extends QueryResultRow {
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
  document_json: unknown;
  fingerprint: string;
  generated_types: string;
  generated_types_fingerprint: string;
  migration_plan_id: string | null;
  deployed_at: string;
  actor_id: string;
}

interface OutboxRow extends QueryResultRow {
  id: string;
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
  event_type: OutboxEvent['type'];
  aggregate_id: string;
  revision_id: string;
  payload_json: unknown;
  cache_tags_json: unknown;
  occurred_at: string;
  state: OutboxEvent['state'];
  attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  processed_at: string | null;
  last_error: string | null;
}

interface JobRow extends QueryResultRow {
  id: string;
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
  job_type: DurableJob['type'];
  idempotency_key: string;
  payload_json: unknown;
  state: DurableJob['state'];
  attempts: number;
  max_attempts: number;
  run_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  result_json: unknown | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface WebhookRow extends QueryResultRow {
  id: string;
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
  url: string;
  event_types_json: unknown;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface Queryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface PostgresContentRepositoryOptions extends Pick<PoolConfig, 'ssl' | 'max'> {
  connectionString?: string;
  pool?: Pool;
  schema?: string;
  now?: () => string;
  createId?: () => string;
}

function statusFor(row: EntryRow): ContentStatus {
  if (!row.published_revision_id) return 'draft';
  return row.published_revision_id === row.current_draft_revision_id ? 'published' : 'changed';
}

function parseData(value: unknown): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Stored GridStory content must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function scopeValues(scope: ContentScope): string[] {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
    scope.locale,
  ];
}

function baseScopeValues(scope: ContentScope): string[] {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
  ];
}

function toEntry(row: EntryRow): ContentEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
    contentType: row.content_type,
    status: statusFor(row),
    draftRevisionId: row.current_draft_revision_id,
    ...(row.published_revision_id ? { publishedRevisionId: row.published_revision_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    data: parseData(row.data_json),
  };
}

function toRevision(row: RevisionRow): ContentRevision {
  return {
    id: row.id,
    entryId: row.entry_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
    sequence: Number(row.sequence),
    ...(row.base_revision_id ? { baseRevisionId: row.base_revision_id } : {}),
    createdAt: row.created_at,
    actorId: row.actor_id,
    data: parseData(row.data_json),
  };
}

function toSchemaDeployment(row: SchemaDeploymentRow): SchemaDeployment {
  return {
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
    document: schemaIrDocumentSchema.parse(
      typeof row.document_json === 'string' ? JSON.parse(row.document_json) : row.document_json,
    ),
    fingerprint: row.fingerprint,
    generatedTypes: row.generated_types,
    generatedTypesFingerprint: row.generated_types_fingerprint,
    ...(row.migration_plan_id ? { migrationPlanId: row.migration_plan_id } : {}),
    deployedAt: row.deployed_at,
    actorId: row.actor_id,
  };
}

function parseStringArray(value: unknown): string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function durableOptionals(row: {
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
}): Pick<OutboxEvent, 'leaseOwner' | 'leaseExpiresAt' | 'lastError'> {
  return {
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function toOutboxEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
    type: row.event_type,
    aggregateId: row.aggregate_id,
    revisionId: row.revision_id,
    payload: parseData(row.payload_json),
    cacheTags: parseStringArray(row.cache_tags_json),
    occurredAt: row.occurred_at,
    state: row.state,
    attempts: Number(row.attempts),
    availableAt: row.available_at,
    ...durableOptionals(row),
    ...(row.processed_at ? { processedAt: row.processed_at } : {}),
  };
}

function toJob(row: JobRow): DurableJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
    type: row.job_type,
    idempotencyKey: row.idempotency_key,
    payload: parseData(row.payload_json),
    state: row.state,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAt: row.run_at,
    ...durableOptionals(row),
    ...(row.result_json ? { result: parseData(row.result_json) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function toWebhook(row: WebhookRow): WebhookSubscription {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
    url: row.url,
    eventTypes: parseStringArray(row.event_types_json) as WebhookSubscription['eventTypes'],
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventCacheTags(
  scope: ContentScope,
  contentType: string,
  entryId: string,
  revisionId: string,
): string[] {
  return [
    `gridstory:tenant:${scope.tenantId}`,
    `gridstory:site:${scope.siteId}`,
    `gridstory:environment:${scope.environmentId}`,
    `gridstory:locale:${scope.locale}`,
    `gridstory:type:${contentType}`,
    `gridstory:entry:${entryId}`,
    `gridstory:revision:${revisionId}`,
  ];
}

export class PostgresContentRepository implements ContentRepository {
  readonly #pool: Pool;
  readonly #schema: string;
  readonly #entries: string;
  readonly #revisions: string;
  readonly #auditEvents: string;
  readonly #schemaDeployments: string;
  readonly #translationVariants: string;
  readonly #outboxEvents: string;
  readonly #durableJobs: string;
  readonly #webhookSubscriptions: string;
  readonly #now: () => string;
  readonly #createId: () => string;
  readonly #ownsPool: boolean;
  readonly #ready: Promise<void>;

  constructor({
    connectionString,
    pool,
    schema = 'gridstory',
    ssl,
    max,
    now = () => new Date().toISOString(),
    createId = randomUUID,
  }: PostgresContentRepositoryOptions) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error('PostgreSQL schema name is invalid.');
    if (!pool && !connectionString)
      throw new Error('PostgreSQL connectionString or pool is required.');
    this.#pool =
      pool ?? new Pool({ connectionString, ...(ssl ? { ssl } : {}), ...(max ? { max } : {}) });
    this.#ownsPool = !pool;
    this.#schema = `"${schema}"`;
    this.#entries = `${this.#schema}.entries`;
    this.#revisions = `${this.#schema}.revisions`;
    this.#auditEvents = `${this.#schema}.audit_events`;
    this.#schemaDeployments = `${this.#schema}.schema_deployments`;
    this.#translationVariants = `${this.#schema}.translation_variants`;
    this.#outboxEvents = `${this.#schema}.outbox_events`;
    this.#durableJobs = `${this.#schema}.durable_jobs`;
    this.#webhookSubscriptions = `${this.#schema}.webhook_subscriptions`;
    this.#now = now;
    this.#createId = createId;
    this.#ready = this.#initialize();
  }

  async #initialize(): Promise<void> {
    await this.#pool.query(`
      CREATE SCHEMA IF NOT EXISTS ${this.#schema};
      CREATE TABLE IF NOT EXISTS ${this.#entries} (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        content_type TEXT NOT NULL,
        current_draft_revision_id TEXT,
        published_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entries_scope_type_idx
        ON ${this.#entries} (organization_id, tenant_id, workspace_id, site_id, environment_id, locale, content_type, updated_at DESC);
      CREATE TABLE IF NOT EXISTS ${this.#revisions} (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES ${this.#entries}(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        base_revision_id TEXT,
        actor_id TEXT NOT NULL,
        data_json JSONB NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (entry_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS revisions_entry_idx
        ON ${this.#revisions} (tenant_id, entry_id, sequence DESC);
      CREATE TABLE IF NOT EXISTS ${this.#auditEvents} (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        entry_id TEXT NOT NULL REFERENCES ${this.#entries}(id) ON DELETE CASCADE,
        sequence INTEGER,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        previous_hash TEXT,
        event_hash TEXT
      );
      ALTER TABLE ${this.#auditEvents} ADD COLUMN IF NOT EXISTS previous_hash TEXT;
      ALTER TABLE ${this.#auditEvents} ADD COLUMN IF NOT EXISTS event_hash TEXT;
      ALTER TABLE ${this.#auditEvents} ADD COLUMN IF NOT EXISTS sequence INTEGER;
      CREATE INDEX IF NOT EXISTS audit_entry_idx
        ON ${this.#auditEvents} (tenant_id, entry_id, occurred_at DESC);
      CREATE TABLE IF NOT EXISTS ${this.#translationVariants} (
        entry_id TEXT PRIMARY KEY REFERENCES ${this.#entries}(id) ON DELETE CASCADE,
        translation_group_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        content_type TEXT NOT NULL,
        UNIQUE (
          organization_id, tenant_id, workspace_id, site_id, environment_id,
          locale, translation_group_id
        )
      );
      CREATE INDEX IF NOT EXISTS translation_variants_group_idx
        ON ${this.#translationVariants} (
          organization_id, tenant_id, workspace_id, site_id, environment_id,
          translation_group_id, locale
        );
      CREATE TABLE IF NOT EXISTS ${this.#outboxEvents} (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        event_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        cache_tags_json JSONB NOT NULL,
        occurred_at TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        processed_at TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS outbox_claim_idx
        ON ${this.#outboxEvents} (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          state, available_at, occurred_at
        );
      CREATE TABLE IF NOT EXISTS ${this.#durableJobs} (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        job_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        run_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        result_json JSONB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          idempotency_key
        )
      );
      CREATE INDEX IF NOT EXISTS durable_jobs_claim_idx
        ON ${this.#durableJobs} (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          state, run_at, created_at
        );
      CREATE TABLE IF NOT EXISTS ${this.#webhookSubscriptions} (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        url TEXT NOT NULL,
        event_types_json JSONB NOT NULL,
        active BOOLEAN NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${this.#schemaDeployments} (
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        document_json JSONB NOT NULL,
        fingerprint TEXT NOT NULL,
        generated_types TEXT NOT NULL,
        generated_types_fingerprint TEXT NOT NULL,
        migration_plan_id TEXT,
        deployed_at TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        PRIMARY KEY (organization_id, tenant_id, workspace_id, site_id, environment_id, locale)
      );
      INSERT INTO ${this.#translationVariants} (
        entry_id, translation_group_id, organization_id, tenant_id, workspace_id,
        site_id, environment_id, locale, content_type
      )
      SELECT id, id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale, content_type
      FROM ${this.#entries}
      ON CONFLICT (entry_id) DO NOTHING;
    `);
    await this.#backfillAuditHashes();
    await this.#pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS audit_entry_sequence_idx
        ON ${this.#auditEvents} (entry_id, sequence)
    `);
  }

  async #backfillAuditHashes(): Promise<void> {
    const result = await this.#pool.query<AuditRow>(
      `SELECT a.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
       FROM ${this.#auditEvents} a JOIN ${this.#entries} e ON e.id = a.entry_id
       ORDER BY a.entry_id ASC, a.occurred_at ASC, a.id ASC`,
    );
    const previousByEntry = new Map<string, string>();
    const sequenceByEntry = new Map<string, number>();
    for (const row of result.rows) {
      const previousHash = previousByEntry.get(row.entry_id);
      const sequence = row.sequence ?? (sequenceByEntry.get(row.entry_id) ?? 0) + 1;
      if (row.event_hash && row.sequence !== null) {
        previousByEntry.set(row.entry_id, row.event_hash);
        sequenceByEntry.set(row.entry_id, row.sequence);
        continue;
      }
      const eventHash = auditEventHash({
        id: row.id,
        organizationId: row.organization_id,
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        siteId: row.site_id,
        environmentId: row.environment_id,
        locale: row.locale,
        entryId: row.entry_id,
        sequence,
        actorId: row.actor_id,
        action: row.action,
        revisionId: row.revision_id,
        occurredAt: row.occurred_at,
        ...(previousHash ? { previousHash } : {}),
      });
      await this.#pool.query(
        `UPDATE ${this.#auditEvents}
         SET sequence = $1, previous_hash = $2, event_hash = $3 WHERE id = $4`,
        [sequence, previousHash ?? null, eventHash, row.id],
      );
      previousByEntry.set(row.entry_id, eventHash);
      sequenceByEntry.set(row.entry_id, sequence);
    }
  }

  #revisionJoin(perspective: ContentPerspective): string {
    return perspective === 'draft'
      ? 'r.id = e.current_draft_revision_id'
      : 'r.id = e.published_revision_id';
  }

  async #entryRow(
    database: Queryable,
    scope: ContentScope,
    id: string,
    perspective: ContentPerspective,
    lock = false,
  ): Promise<EntryRow | null> {
    const result = await database.query<EntryRow>(
      `SELECT e.*, r.data_json
       FROM ${this.#entries} e
       JOIN ${this.#revisions} r ON ${this.#revisionJoin(perspective)}
       WHERE e.organization_id = $1 AND e.tenant_id = $2 AND e.workspace_id = $3
         AND e.site_id = $4 AND e.environment_id = $5 AND e.locale = $6 AND e.id = $7
       ${lock ? 'FOR UPDATE OF e' : ''}`,
      [...scopeValues(scope), id],
    );
    return result.rows[0] ?? null;
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.#ready;
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #audit(
    client: Queryable,
    scope: ContentScope,
    entryId: string,
    actor: Actor,
    action: AuditEvent['action'],
    revisionId: string,
    occurredAt: string,
  ): Promise<void> {
    const id = this.#createId();
    const previous = await client.query<{ sequence: number; event_hash: string } & QueryResultRow>(
      `SELECT sequence, event_hash FROM ${this.#auditEvents}
       WHERE entry_id = $1 ORDER BY sequence DESC LIMIT 1`,
      [entryId],
    );
    const previousHash = previous.rows[0]?.event_hash;
    const sequence = (previous.rows[0]?.sequence ?? 0) + 1;
    const eventHash = auditEventHash({
      id,
      ...scope,
      entryId,
      sequence,
      actorId: actor.id,
      action,
      revisionId,
      occurredAt,
      ...(previousHash ? { previousHash } : {}),
    });
    await client.query(
      `INSERT INTO ${this.#auditEvents}
        (id, tenant_id, entry_id, sequence, actor_id, action, revision_id, occurred_at,
         previous_hash, event_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        scope.tenantId,
        entryId,
        sequence,
        actor.id,
        action,
        revisionId,
        occurredAt,
        previousHash ?? null,
        eventHash,
      ],
    );
  }

  async #emitOutbox(
    client: Queryable,
    scope: ContentScope,
    type: OutboxEvent['type'],
    contentType: string,
    entryId: string,
    revisionId: string,
    data: Record<string, unknown>,
    occurredAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.#outboxEvents} (
        id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
        event_type, aggregate_id, revision_id, payload_json, cache_tags_json,
        occurred_at, state, attempts, available_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
        $13, 'pending', 0, $14
      )`,
      [
        this.#createId(),
        ...scopeValues(scope),
        type,
        entryId,
        revisionId,
        JSON.stringify({ contentType, data }),
        JSON.stringify(eventCacheTags(scope, contentType, entryId, revisionId)),
        occurredAt,
        occurredAt,
      ],
    );
  }

  async list({
    scope,
    contentType,
    perspective,
  }: Parameters<ContentRepository['list']>[0]): Promise<ContentEntry[]> {
    await this.#ready;
    const values: unknown[] = scopeValues(scope);
    const typeClause = contentType ? `AND e.content_type = $${values.push(contentType)}` : '';
    const result = await this.#pool.query<EntryRow>(
      `SELECT e.*, r.data_json
       FROM ${this.#entries} e
       JOIN ${this.#revisions} r ON ${this.#revisionJoin(perspective)}
       WHERE e.organization_id = $1 AND e.tenant_id = $2 AND e.workspace_id = $3
         AND e.site_id = $4 AND e.environment_id = $5 AND e.locale = $6 ${typeClause}
       ORDER BY e.updated_at DESC, e.id ASC`,
      values,
    );
    return result.rows.map(toEntry);
  }

  async getById({
    scope,
    id,
    perspective,
  }: Parameters<ContentRepository['getById']>[0]): Promise<ContentEntry | null> {
    await this.#ready;
    const row = await this.#entryRow(this.#pool, scope, id, perspective);
    return row ? toEntry(row) : null;
  }

  async getBySlug({
    scope,
    contentType,
    slug,
    perspective,
  }: Parameters<ContentRepository['getBySlug']>[0]): Promise<ContentEntry | null> {
    await this.#ready;
    const result = await this.#pool.query<EntryRow>(
      `SELECT e.*, r.data_json
       FROM ${this.#entries} e
       JOIN ${this.#revisions} r ON ${this.#revisionJoin(perspective)}
       WHERE e.organization_id = $1 AND e.tenant_id = $2 AND e.workspace_id = $3
         AND e.site_id = $4 AND e.environment_id = $5 AND e.locale = $6
         AND e.content_type = $7 AND r.data_json ->> 'slug' = $8
       LIMIT 1`,
      [...scopeValues(scope), contentType, slug],
    );
    return result.rows[0] ? toEntry(result.rows[0]) : null;
  }

  async create({
    scope,
    contentType,
    data,
    actor,
    translationGroupId,
  }: Parameters<ContentRepository['create']>[0]): Promise<ContentEntry> {
    const id = this.#createId();
    const revisionId = this.#createId();
    const now = this.#now();
    return this.#transaction(async (client) => {
      await client.query(
        `INSERT INTO ${this.#entries}
          (id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
           content_type, current_draft_revision_id, published_revision_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, $9, $10)`,
        [id, ...scopeValues(scope), contentType, now, now],
      );
      await client.query(
        `INSERT INTO ${this.#translationVariants}
          (entry_id, translation_group_id, organization_id, tenant_id, workspace_id,
           site_id, environment_id, locale, content_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, translationGroupId ?? id, ...scopeValues(scope), contentType],
      );
      await client.query(
        `INSERT INTO ${this.#revisions}
          (id, entry_id, tenant_id, sequence, base_revision_id, actor_id, data_json, created_at)
         VALUES ($1, $2, $3, 1, NULL, $4, $5::jsonb, $6)`,
        [revisionId, id, scope.tenantId, actor.id, JSON.stringify(data), now],
      );
      await client.query(
        `UPDATE ${this.#entries} SET current_draft_revision_id = $1 WHERE id = $2`,
        [revisionId, id],
      );
      await this.#audit(client, scope, id, actor, 'content.created', revisionId, now);
      await this.#emitOutbox(
        client,
        scope,
        'content.created',
        contentType,
        id,
        revisionId,
        data,
        now,
      );
      const row = await this.#entryRow(client, scope, id, 'draft');
      if (!row) throw new Error('Created PostgreSQL GridStory entry could not be read back.');
      return toEntry(row);
    });
  }

  async updateDraft({
    scope,
    id,
    expectedRevisionId,
    data,
    actor,
  }: Parameters<ContentRepository['updateDraft']>[0]): Promise<ContentEntry> {
    return this.#transaction(async (client) => {
      const current = await this.#entryRow(client, scope, id, 'draft', true);
      if (!current) throw new NotFoundError('Content entry was not found.');
      if (current.current_draft_revision_id !== expectedRevisionId) {
        throw new ConflictError('The draft changed after it was loaded.', {
          expectedRevisionId,
          currentRevisionId: current.current_draft_revision_id,
        });
      }
      const sequence = await client.query<{ sequence: number } & QueryResultRow>(
        `SELECT COALESCE(MAX(sequence), 0)::int AS sequence FROM ${this.#revisions} WHERE entry_id = $1`,
        [id],
      );
      const revisionId = this.#createId();
      const now = this.#now();
      await client.query(
        `INSERT INTO ${this.#revisions}
          (id, entry_id, tenant_id, sequence, base_revision_id, actor_id, data_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          revisionId,
          id,
          scope.tenantId,
          (sequence.rows[0]?.sequence ?? 0) + 1,
          expectedRevisionId,
          actor.id,
          JSON.stringify(data),
          now,
        ],
      );
      await client.query(
        `UPDATE ${this.#entries} SET current_draft_revision_id = $1, updated_at = $2 WHERE id = $3`,
        [revisionId, now, id],
      );
      await this.#audit(client, scope, id, actor, 'content.draft.updated', revisionId, now);
      await this.#emitOutbox(
        client,
        scope,
        'content.draft.updated',
        current.content_type,
        id,
        revisionId,
        data,
        now,
      );
      const row = await this.#entryRow(client, scope, id, 'draft');
      if (!row) throw new Error('Updated PostgreSQL GridStory entry could not be read back.');
      return toEntry(row);
    });
  }

  async publish({
    scope,
    id,
    expectedRevisionId,
    actor,
  }: Parameters<ContentRepository['publish']>[0]): Promise<ContentEntry> {
    return this.#transaction(async (client) => {
      const current = await this.#entryRow(client, scope, id, 'draft', true);
      if (!current) throw new NotFoundError('Content entry was not found.');
      if (current.current_draft_revision_id !== expectedRevisionId) {
        throw new ConflictError('The draft changed before it could be published.', {
          expectedRevisionId,
          currentRevisionId: current.current_draft_revision_id,
        });
      }
      const now = this.#now();
      await client.query(
        `UPDATE ${this.#entries} SET published_revision_id = $1, updated_at = $2 WHERE id = $3`,
        [expectedRevisionId, now, id],
      );
      await this.#audit(client, scope, id, actor, 'content.published', expectedRevisionId, now);
      await this.#emitOutbox(
        client,
        scope,
        'content.published',
        current.content_type,
        id,
        expectedRevisionId,
        parseData(current.data_json),
        now,
      );
      const row = await this.#entryRow(client, scope, id, 'published');
      if (!row) throw new Error('Published PostgreSQL GridStory entry could not be read back.');
      return toEntry(row);
    });
  }

  async publishMany({
    scope,
    entries,
    actor,
  }: Parameters<ContentRepository['publishMany']>[0]): Promise<ContentEntry[]> {
    if (entries.length === 0) return [];
    if (new Set(entries.map((entry) => entry.entryId)).size !== entries.length) {
      throw new ConflictError('An atomic publication cannot contain duplicate entries.');
    }
    return this.#transaction(async (client) => {
      const prepared = [];
      for (const entry of entries) {
        const current = await this.#entryRow(client, scope, entry.entryId, 'draft', true);
        if (!current) throw new NotFoundError('Content entry was not found.');
        if (
          entry.expectedDraftRevisionId !== undefined &&
          current.current_draft_revision_id !== entry.expectedDraftRevisionId
        ) {
          throw new ConflictError('A release draft changed before atomic publication.', {
            entryId: entry.entryId,
            expectedRevisionId: entry.expectedDraftRevisionId,
            currentRevisionId: current.current_draft_revision_id,
          });
        }
        if (
          entry.expectedPublishedRevisionId !== undefined &&
          current.published_revision_id !== entry.expectedPublishedRevisionId
        ) {
          throw new ConflictError('Published content changed after the release was prepared.', {
            entryId: entry.entryId,
            expectedPublishedRevisionId: entry.expectedPublishedRevisionId,
            currentPublishedRevisionId: current.published_revision_id,
          });
        }
        const target = await client.query<{ data_json: unknown }>(
          `SELECT r.data_json
           FROM ${this.#revisions} r JOIN ${this.#entries} e ON e.id = r.entry_id
           WHERE e.organization_id = $1 AND e.tenant_id = $2 AND e.workspace_id = $3
             AND e.site_id = $4 AND e.environment_id = $5 AND e.locale = $6
             AND e.id = $7 AND r.id = $8`,
          [...scopeValues(scope), entry.entryId, entry.targetRevisionId],
        );
        if (!target.rows[0]) throw new NotFoundError('The target release revision was not found.');
        prepared.push({ entry, current, data: parseData(target.rows[0].data_json) });
      }
      const now = this.#now();
      for (const candidate of prepared) {
        await client.query(
          `UPDATE ${this.#entries} SET published_revision_id = $1, updated_at = $2 WHERE id = $3`,
          [candidate.entry.targetRevisionId, now, candidate.entry.entryId],
        );
        await this.#audit(
          client,
          scope,
          candidate.entry.entryId,
          actor,
          'content.published',
          candidate.entry.targetRevisionId,
          now,
        );
        await this.#emitOutbox(
          client,
          scope,
          'content.published',
          candidate.current.content_type,
          candidate.entry.entryId,
          candidate.entry.targetRevisionId,
          candidate.data,
          now,
        );
      }
      const published = [];
      for (const candidate of prepared) {
        const row = await this.#entryRow(client, scope, candidate.entry.entryId, 'published');
        if (!row) throw new Error('Atomically published entry could not be read back.');
        published.push(toEntry(row));
      }
      return published;
    });
  }

  async getRevision({
    scope,
    id,
    revisionId,
  }: Parameters<ContentRepository['getRevision']>[0]): Promise<ContentRevision | null> {
    await this.#ready;
    const result = await this.#pool.query<RevisionRow>(
      `SELECT r.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
       FROM ${this.#revisions} r JOIN ${this.#entries} e ON e.id = r.entry_id
       WHERE e.organization_id = $1 AND e.tenant_id = $2 AND e.workspace_id = $3
         AND e.site_id = $4 AND e.environment_id = $5 AND e.locale = $6
         AND r.entry_id = $7 AND r.id = $8`,
      [...scopeValues(scope), id, revisionId],
    );
    return result.rows[0] ? toRevision(result.rows[0]) : null;
  }
  async listRevisions({
    scope,
    id,
  }: Parameters<ContentRepository['listRevisions']>[0]): Promise<ContentRevision[]> {
    await this.#ready;
    const result = await this.#pool.query<RevisionRow>(
      `SELECT r.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
       FROM ${this.#revisions} r JOIN ${this.#entries} e ON e.id = r.entry_id
       WHERE e.organization_id = $1 AND e.tenant_id = $2 AND e.workspace_id = $3
         AND e.site_id = $4 AND e.environment_id = $5 AND e.locale = $6 AND r.entry_id = $7
       ORDER BY r.sequence DESC`,
      [...scopeValues(scope), id],
    );
    return result.rows.map(toRevision);
  }

  async listAuditEvents({
    scope,
    id,
  }: Parameters<ContentRepository['listAuditEvents']>[0]): Promise<AuditEvent[]> {
    await this.#ready;
    const result = await this.#pool.query<AuditRow>(
      `SELECT a.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
       FROM ${this.#auditEvents} a JOIN ${this.#entries} e ON e.id = a.entry_id
       WHERE e.organization_id = $1 AND e.tenant_id = $2 AND e.workspace_id = $3
         AND e.site_id = $4 AND e.environment_id = $5 AND e.locale = $6 AND a.entry_id = $7
       ORDER BY a.sequence DESC`,
      [...scopeValues(scope), id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      environmentId: row.environment_id,
      locale: row.locale,
      entryId: row.entry_id,
      sequence: row.sequence ?? 0,
      actorId: row.actor_id,
      action: row.action,
      revisionId: row.revision_id,
      occurredAt: row.occurred_at,
      ...(row.previous_hash ? { previousHash: row.previous_hash } : {}),
      eventHash: row.event_hash,
    }));
  }

  async listScopeAuditEvents({
    scope,
  }: Parameters<ContentRepository['listScopeAuditEvents']>[0]): Promise<AuditEvent[]> {
    await this.#ready;
    const result = await this.#pool.query<AuditRow>(
      `SELECT a.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
       FROM ${this.#auditEvents} a JOIN ${this.#entries} e ON e.id = a.entry_id
       WHERE e.organization_id = $1 AND e.tenant_id = $2 AND e.workspace_id = $3
         AND e.site_id = $4 AND e.environment_id = $5 AND e.locale = $6
       ORDER BY a.entry_id ASC, a.sequence ASC`,
      scopeValues(scope),
    );
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      environmentId: row.environment_id,
      locale: row.locale,
      entryId: row.entry_id,
      sequence: row.sequence ?? 0,
      actorId: row.actor_id,
      action: row.action,
      revisionId: row.revision_id,
      occurredAt: row.occurred_at,
      ...(row.previous_hash ? { previousHash: row.previous_hash } : {}),
      eventHash: row.event_hash,
    }));
  }

  async getTranslationGroup({
    scope,
    id,
  }: Parameters<ContentRepository['getTranslationGroup']>[0]): Promise<string | null> {
    await this.#ready;
    const existing = await this.#pool.query<{ translation_group_id: string } & QueryResultRow>(
      `SELECT translation_group_id FROM ${this.#translationVariants}
       WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND site_id = $4 AND environment_id = $5 AND locale = $6 AND entry_id = $7`,
      [...scopeValues(scope), id],
    );
    if (existing.rows[0]) return existing.rows[0].translation_group_id;
    const entry = await this.#entryRow(this.#pool, scope, id, 'draft');
    if (!entry) return null;
    await this.#pool.query(
      `INSERT INTO ${this.#translationVariants}
        (entry_id, translation_group_id, organization_id, tenant_id, workspace_id,
         site_id, environment_id, locale, content_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (entry_id) DO NOTHING`,
      [id, id, ...scopeValues(scope), entry.content_type],
    );
    return id;
  }

  async listTranslationVariants({
    scope,
    translationGroupId,
    perspective,
  }: Parameters<ContentRepository['listTranslationVariants']>[0]): Promise<ContentEntry[]> {
    await this.#ready;
    const result = await this.#pool.query<EntryRow>(
      `SELECT e.*, r.data_json
       FROM ${this.#translationVariants} t
       JOIN ${this.#entries} e ON e.id = t.entry_id
       JOIN ${this.#revisions} r ON ${this.#revisionJoin(perspective)}
       WHERE t.organization_id = $1 AND t.tenant_id = $2 AND t.workspace_id = $3
         AND t.site_id = $4 AND t.environment_id = $5 AND t.translation_group_id = $6
       ORDER BY t.locale ASC`,
      [...baseScopeValues(scope), translationGroupId],
    );
    return result.rows.map(toEntry);
  }

  async listOutboxEvents({
    scope,
    limit = 100,
  }: Parameters<ContentRepository['listOutboxEvents']>[0]): Promise<OutboxEvent[]> {
    await this.#ready;
    const result = await this.#pool.query<OutboxRow>(
      `SELECT * FROM ${this.#outboxEvents}
       WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND site_id = $4 AND environment_id = $5 AND locale = $6
       ORDER BY occurred_at DESC, id DESC LIMIT $7`,
      [...scopeValues(scope), Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows.map(toOutboxEvent);
  }

  async listOperationalScopes({ limit = 100 }: { limit?: number } = {}): Promise<ContentScope[]> {
    await this.#ready;
    const result = await this.#pool.query<
      QueryResultRow & {
        organization_id: string;
        tenant_id: string;
        workspace_id: string;
        site_id: string;
        environment_id: string;
        locale: string;
      }
    >(
      `SELECT DISTINCT organization_id, tenant_id, workspace_id, site_id, environment_id, locale
       FROM (
         SELECT organization_id, tenant_id, workspace_id, site_id, environment_id, locale
         FROM ${this.#outboxEvents} WHERE state IN ('pending', 'processing')
         UNION
         SELECT organization_id, tenant_id, workspace_id, site_id, environment_id, locale
         FROM ${this.#durableJobs} WHERE state IN ('pending', 'processing')
       ) operational_scopes
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows.map((row) => ({
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      environmentId: row.environment_id,
      locale: row.locale,
    }));
  }

  async claimOutboxEvents({
    scope,
    workerId,
    limit,
    now,
    leaseExpiresAt,
  }: Parameters<ContentRepository['claimOutboxEvents']>[0]): Promise<OutboxEvent[]> {
    await this.#ready;
    const result = await this.#pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id FROM ${this.#outboxEvents}
         WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
           AND site_id = $4 AND environment_id = $5 AND locale = $6
           AND (
             (state = 'pending' AND available_at <= $7)
             OR (state = 'processing' AND lease_expires_at <= $7)
           )
         ORDER BY occurred_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $8
       )
       UPDATE ${this.#outboxEvents} event
       SET state = 'processing', attempts = event.attempts + 1,
           lease_owner = $9, lease_expires_at = $10, last_error = NULL
       FROM candidates
       WHERE event.id = candidates.id
       RETURNING event.*`,
      [...scopeValues(scope), now, Math.max(1, Math.min(limit, 100)), workerId, leaseExpiresAt],
    );
    return result.rows.map(toOutboxEvent);
  }

  async completeOutboxEvent({
    scope,
    id,
    workerId,
    completedAt,
  }: Parameters<ContentRepository['completeOutboxEvent']>[0]): Promise<void> {
    await this.#ready;
    const result = await this.#pool.query(
      `UPDATE ${this.#outboxEvents}
       SET state = 'succeeded', processed_at = $1, lease_owner = NULL, lease_expires_at = NULL
       WHERE organization_id = $2 AND tenant_id = $3 AND workspace_id = $4
         AND site_id = $5 AND environment_id = $6 AND locale = $7
         AND id = $8 AND state = 'processing' AND lease_owner = $9`,
      [completedAt, ...scopeValues(scope), id, workerId],
    );
    if (result.rowCount !== 1) throw new ConflictError('Outbox event lease is no longer owned.');
  }

  async retryOutboxEvent({
    scope,
    id,
    workerId,
    availableAt,
    error,
    dead,
  }: Parameters<ContentRepository['retryOutboxEvent']>[0]): Promise<void> {
    await this.#ready;
    const result = await this.#pool.query(
      `UPDATE ${this.#outboxEvents}
       SET state = $1, available_at = $2, last_error = $3,
           lease_owner = NULL, lease_expires_at = NULL
       WHERE organization_id = $4 AND tenant_id = $5 AND workspace_id = $6
         AND site_id = $7 AND environment_id = $8 AND locale = $9
         AND id = $10 AND state = 'processing' AND lease_owner = $11`,
      [dead ? 'dead' : 'pending', availableAt, error, ...scopeValues(scope), id, workerId],
    );
    if (result.rowCount !== 1) throw new ConflictError('Outbox event lease is no longer owned.');
  }

  async enqueueJob({
    scope,
    type,
    idempotencyKey,
    payload,
    runAt,
    maxAttempts,
  }: Parameters<ContentRepository['enqueueJob']>[0]): Promise<DurableJob> {
    await this.#ready;
    const now = this.#now();
    const result = await this.#pool.query<JobRow>(
      `INSERT INTO ${this.#durableJobs} (
        id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
        job_type, idempotency_key, payload_json, state, attempts, max_attempts,
        run_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
        'pending', 0, $11, $12, $13, $13
      )
      ON CONFLICT (
        organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
        idempotency_key
      ) DO UPDATE SET idempotency_key = excluded.idempotency_key
      RETURNING *`,
      [
        this.#createId(),
        ...scopeValues(scope),
        type,
        idempotencyKey,
        JSON.stringify(payload),
        maxAttempts,
        runAt,
        now,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Enqueued PostgreSQL durable job could not be read back.');
    return toJob(row);
  }

  async listJobs({
    scope,
    limit = 100,
  }: Parameters<ContentRepository['listJobs']>[0]): Promise<DurableJob[]> {
    await this.#ready;
    const result = await this.#pool.query<JobRow>(
      `SELECT * FROM ${this.#durableJobs}
       WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND site_id = $4 AND environment_id = $5 AND locale = $6
       ORDER BY created_at DESC, id DESC LIMIT $7`,
      [...scopeValues(scope), Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows.map(toJob);
  }

  async getJob({
    scope,
    id,
  }: Parameters<ContentRepository['getJob']>[0]): Promise<DurableJob | null> {
    await this.#ready;
    const result = await this.#pool.query<JobRow>(
      `SELECT * FROM ${this.#durableJobs}
       WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND site_id = $4 AND environment_id = $5 AND locale = $6 AND id = $7`,
      [...scopeValues(scope), id],
    );
    return result.rows[0] ? toJob(result.rows[0]) : null;
  }

  async claimJobs({
    scope,
    workerId,
    limit,
    now,
    leaseExpiresAt,
  }: Parameters<ContentRepository['claimJobs']>[0]): Promise<DurableJob[]> {
    await this.#ready;
    const result = await this.#pool.query<JobRow>(
      `WITH candidates AS (
         SELECT id FROM ${this.#durableJobs}
         WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
           AND site_id = $4 AND environment_id = $5 AND locale = $6
           AND (
             (state = 'pending' AND run_at <= $7)
             OR (state = 'processing' AND lease_expires_at <= $7)
           )
         ORDER BY run_at ASC, created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $8
       )
       UPDATE ${this.#durableJobs} job
       SET state = 'processing', attempts = job.attempts + 1,
           lease_owner = $9, lease_expires_at = $10, last_error = NULL, updated_at = $7
       FROM candidates
       WHERE job.id = candidates.id
       RETURNING job.*`,
      [...scopeValues(scope), now, Math.max(1, Math.min(limit, 100)), workerId, leaseExpiresAt],
    );
    return result.rows.map(toJob);
  }

  async completeJob({
    scope,
    id,
    workerId,
    completedAt,
    result: jobResult,
  }: Parameters<ContentRepository['completeJob']>[0]): Promise<void> {
    await this.#ready;
    const result = await this.#pool.query(
      `UPDATE ${this.#durableJobs}
       SET state = 'succeeded', result_json = $1::jsonb, completed_at = $2, updated_at = $2,
           lease_owner = NULL, lease_expires_at = NULL
       WHERE organization_id = $3 AND tenant_id = $4 AND workspace_id = $5
         AND site_id = $6 AND environment_id = $7 AND locale = $8
         AND id = $9 AND state = 'processing' AND lease_owner = $10`,
      [JSON.stringify(jobResult), completedAt, ...scopeValues(scope), id, workerId],
    );
    if (result.rowCount !== 1) throw new ConflictError('Durable job lease is no longer owned.');
  }

  async failJob({
    scope,
    id,
    workerId,
    runAt,
    error,
    dead,
  }: Parameters<ContentRepository['failJob']>[0]): Promise<void> {
    await this.#ready;
    const now = this.#now();
    const result = await this.#pool.query(
      `UPDATE ${this.#durableJobs}
       SET state = $1, run_at = $2, last_error = $3, updated_at = $4,
           lease_owner = NULL, lease_expires_at = NULL
       WHERE organization_id = $5 AND tenant_id = $6 AND workspace_id = $7
         AND site_id = $8 AND environment_id = $9 AND locale = $10
         AND id = $11 AND state = 'processing' AND lease_owner = $12`,
      [dead ? 'dead' : 'pending', runAt, error, now, ...scopeValues(scope), id, workerId],
    );
    if (result.rowCount !== 1) throw new ConflictError('Durable job lease is no longer owned.');
  }

  async saveWebhookSubscription({
    scope,
    id = this.#createId(),
    url,
    eventTypes,
    active = true,
  }: Parameters<ContentRepository['saveWebhookSubscription']>[0]): Promise<WebhookSubscription> {
    await this.#ready;
    const now = this.#now();
    const result = await this.#pool.query<WebhookRow>(
      `INSERT INTO ${this.#webhookSubscriptions} (
        id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
        url, event_types_json, active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11)
      ON CONFLICT (id) DO UPDATE SET
        url = excluded.url,
        event_types_json = excluded.event_types_json,
        active = excluded.active,
        updated_at = excluded.updated_at
      WHERE ${this.#webhookSubscriptions}.organization_id = excluded.organization_id
        AND ${this.#webhookSubscriptions}.tenant_id = excluded.tenant_id
        AND ${this.#webhookSubscriptions}.workspace_id = excluded.workspace_id
        AND ${this.#webhookSubscriptions}.site_id = excluded.site_id
        AND ${this.#webhookSubscriptions}.environment_id = excluded.environment_id
        AND ${this.#webhookSubscriptions}.locale = excluded.locale
      RETURNING *`,
      [id, ...scopeValues(scope), url, JSON.stringify(eventTypes), active, now],
    );
    const row = result.rows[0];
    if (!row) throw new ConflictError('Webhook subscription ID belongs to another scope.');
    return toWebhook(row);
  }

  async listWebhookSubscriptions({
    scope,
  }: Parameters<ContentRepository['listWebhookSubscriptions']>[0]): Promise<WebhookSubscription[]> {
    await this.#ready;
    const result = await this.#pool.query<WebhookRow>(
      `SELECT * FROM ${this.#webhookSubscriptions}
       WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND site_id = $4 AND environment_id = $5 AND locale = $6
       ORDER BY created_at ASC, id ASC`,
      scopeValues(scope),
    );
    return result.rows.map(toWebhook);
  }

  async deleteWebhookSubscription({
    scope,
    id,
  }: Parameters<ContentRepository['deleteWebhookSubscription']>[0]): Promise<boolean> {
    await this.#ready;
    const result = await this.#pool.query(
      `DELETE FROM ${this.#webhookSubscriptions}
       WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND site_id = $4 AND environment_id = $5 AND locale = $6 AND id = $7`,
      [...scopeValues(scope), id],
    );
    return result.rowCount === 1;
  }

  async exportPortableContent({
    scope,
  }: Parameters<ContentRepository['exportPortableContent']>[0]): Promise<PortableContentRecord[]> {
    const entries = await this.list({ scope, perspective: 'draft' });
    const records: PortableContentRecord[] = [];
    for (const entry of entries.sort((left, right) => left.id.localeCompare(right.id))) {
      const translationGroupId = await this.getTranslationGroup({ scope, id: entry.id });
      if (!translationGroupId) {
        throw new Error(`Translation group is missing for portable entry ${entry.id}.`);
      }
      const revisions = await this.listRevisions({ scope, id: entry.id });
      const auditEvents = await this.listAuditEvents({ scope, id: entry.id });
      records.push({
        entryId: entry.id,
        contentType: entry.contentType,
        currentDraftRevisionId: entry.draftRevisionId,
        ...(entry.publishedRevisionId ? { publishedRevisionId: entry.publishedRevisionId } : {}),
        translationGroupId,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        revisions: revisions
          .sort((left, right) => left.sequence - right.sequence)
          .map((revision) => ({
            id: revision.id,
            sequence: revision.sequence,
            ...(revision.baseRevisionId ? { baseRevisionId: revision.baseRevisionId } : {}),
            actorId: revision.actorId,
            data: revision.data,
            createdAt: revision.createdAt,
          })),
        auditEvents: auditEvents
          .sort((left, right) => left.sequence - right.sequence)
          .map((event) => ({
            id: event.id,
            sequence: event.sequence,
            actorId: event.actorId,
            action: event.action,
            revisionId: event.revisionId,
            occurredAt: event.occurredAt,
          })),
      });
    }
    return records;
  }

  async importPortableContent({
    scope,
    records,
    conflictPolicy,
    dryRun,
  }: Parameters<ContentRepository['importPortableContent']>[0]): Promise<PortableImportResult> {
    return this.#transaction(async (client) => {
      const existing = await client.query<
        QueryResultRow & {
          id: string;
          organization_id: string;
          tenant_id: string;
          workspace_id: string;
          site_id: string;
          environment_id: string;
          locale: string;
        }
      >(
        `SELECT id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale
         FROM ${this.#entries} WHERE id = ANY($1::text[]) FOR UPDATE`,
        [records.map((record) => record.entryId)],
      );
      const conflicts = existing.rows.map((row) => row.id).sort();
      const crossScope = existing.rows.filter(
        (row) =>
          row.organization_id !== scope.organizationId ||
          row.tenant_id !== scope.tenantId ||
          row.workspace_id !== scope.workspaceId ||
          row.site_id !== scope.siteId ||
          row.environment_id !== scope.environmentId ||
          row.locale !== scope.locale,
      );
      if (crossScope.length > 0) {
        throw new ConflictError('Portable IDs already belong to another scope.', {
          conflicts: crossScope.map((row) => row.id),
        });
      }
      if (conflictPolicy === 'reject' && conflicts.length > 0) {
        throw new ConflictError('Portable content conflicts with existing entry IDs.', {
          conflicts,
        });
      }
      const conflictSet = new Set(conflicts);
      const selected = records.filter(
        (record) => conflictPolicy !== 'skip' || !conflictSet.has(record.entryId),
      );
      const result: PortableImportResult = {
        imported: selected.length - conflicts.length * Number(conflictPolicy === 'replace'),
        skipped: conflictPolicy === 'skip' ? conflicts.length : 0,
        replaced: conflictPolicy === 'replace' ? conflicts.length : 0,
        conflicts,
        dryRun,
      };
      if (dryRun) return result;

      if (conflictPolicy === 'replace' && conflicts.length > 0) {
        await client.query(
          `DELETE FROM ${this.#outboxEvents}
           WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
             AND site_id = $4 AND environment_id = $5 AND locale = $6
             AND aggregate_id = ANY($7::text[])`,
          [...scopeValues(scope), conflicts],
        );
        await client.query(`DELETE FROM ${this.#entries} WHERE id = ANY($1::text[])`, [conflicts]);
      }
      for (const record of selected) {
        await client.query(
          `INSERT INTO ${this.#entries} (
             id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
             content_type, current_draft_revision_id, published_revision_id, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            record.entryId,
            ...scopeValues(scope),
            record.contentType,
            record.currentDraftRevisionId,
            record.publishedRevisionId ?? null,
            record.createdAt,
            record.updatedAt,
          ],
        );
        await client.query(
          `INSERT INTO ${this.#translationVariants} (
             entry_id, translation_group_id, organization_id, tenant_id, workspace_id,
             site_id, environment_id, locale, content_type
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [record.entryId, record.translationGroupId, ...scopeValues(scope), record.contentType],
        );
        for (const revision of record.revisions) {
          await client.query(
            `INSERT INTO ${this.#revisions} (
               id, entry_id, tenant_id, sequence, base_revision_id, actor_id, data_json, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
            [
              revision.id,
              record.entryId,
              scope.tenantId,
              revision.sequence,
              revision.baseRevisionId ?? null,
              revision.actorId,
              JSON.stringify(revision.data),
              revision.createdAt,
            ],
          );
        }
        let previousAuditHash: string | undefined;
        for (const event of [...record.auditEvents].sort(
          (left, right) => left.sequence - right.sequence,
        )) {
          const eventHash = auditEventHash({
            id: event.id,
            ...scope,
            entryId: record.entryId,
            sequence: event.sequence,
            actorId: event.actorId,
            action: event.action,
            revisionId: event.revisionId,
            occurredAt: event.occurredAt,
            ...(previousAuditHash ? { previousHash: previousAuditHash } : {}),
          });
          await client.query(
            `INSERT INTO ${this.#auditEvents} (
               id, tenant_id, entry_id, sequence, actor_id, action, revision_id, occurred_at,
               previous_hash, event_hash
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              event.id,
              scope.tenantId,
              record.entryId,
              event.sequence,
              event.actorId,
              event.action,
              event.revisionId,
              event.occurredAt,
              previousAuditHash ?? null,
              eventHash,
            ],
          );
          previousAuditHash = eventHash;
        }
      }
      return result;
    });
  }

  async getSchemaDeployment({
    scope,
  }: Parameters<ContentRepository['getSchemaDeployment']>[0]): Promise<SchemaDeployment | null> {
    await this.#ready;
    const result = await this.#pool.query<SchemaDeploymentRow>(
      `SELECT * FROM ${this.#schemaDeployments}
       WHERE organization_id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND site_id = $4 AND environment_id = $5 AND locale = $6`,
      scopeValues(scope),
    );
    return result.rows[0] ? toSchemaDeployment(result.rows[0]) : null;
  }

  async saveSchemaDeployment({
    scope,
    document,
    fingerprint,
    generatedTypes,
    generatedTypesFingerprint,
    migrationPlanId,
    actor,
  }: Parameters<ContentRepository['saveSchemaDeployment']>[0]): Promise<SchemaDeployment> {
    await this.#ready;
    const deployedAt = this.#now();
    const result = await this.#pool.query<SchemaDeploymentRow>(
      `INSERT INTO ${this.#schemaDeployments} (
         organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
         document_json, fingerprint, generated_types, generated_types_fingerprint,
         migration_plan_id, deployed_at, actor_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (organization_id, tenant_id, workspace_id, site_id, environment_id, locale)
       DO UPDATE SET
         document_json = excluded.document_json,
         fingerprint = excluded.fingerprint,
         generated_types = excluded.generated_types,
         generated_types_fingerprint = excluded.generated_types_fingerprint,
         migration_plan_id = excluded.migration_plan_id,
         deployed_at = excluded.deployed_at,
         actor_id = excluded.actor_id
       RETURNING *`,
      [
        ...scopeValues(scope),
        JSON.stringify(document),
        fingerprint,
        generatedTypes,
        generatedTypesFingerprint,
        migrationPlanId ?? null,
        deployedAt,
        actor.id,
      ],
    );
    const deployment = result.rows[0];
    if (!deployment) throw new Error('Saved PostgreSQL schema deployment could not be read back.');
    return toSchemaDeployment(deployment);
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }
}
