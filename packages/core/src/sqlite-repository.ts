import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
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

interface EntryRow {
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
  data_json: string;
}

interface RevisionRow {
  id: string;
  entry_id: string;
  tenant_id: string;
  sequence: number;
  base_revision_id: string | null;
  created_at: string;
  actor_id: string;
  data_json: string;
  organization_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
}

interface AuditRow {
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

interface SchemaDeploymentRow {
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
  document_json: string;
  fingerprint: string;
  generated_types: string;
  generated_types_fingerprint: string;
  migration_plan_id: string | null;
  deployed_at: string;
  actor_id: string;
}

interface OutboxRow {
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
  payload_json: string;
  cache_tags_json: string;
  occurred_at: string;
  state: OutboxEvent['state'];
  attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  processed_at: string | null;
  last_error: string | null;
}

interface JobRow {
  id: string;
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
  job_type: DurableJob['type'];
  idempotency_key: string;
  payload_json: string;
  state: DurableJob['state'];
  attempts: number;
  max_attempts: number;
  run_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface WebhookRow {
  id: string;
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
  url: string;
  event_types_json: string;
  active: number;
  created_at: string;
  updated_at: string;
}

interface ExistingEntryRow {
  id: string;
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
}

export interface SqliteContentRepositoryOptions {
  filename: string;
  now?: () => string;
  createId?: () => string;
}

function statusFor(row: EntryRow): ContentStatus {
  if (!row.published_revision_id) return 'draft';
  return row.published_revision_id === row.current_draft_revision_id ? 'published' : 'changed';
}

function parseData(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Stored GridStory content must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function scopeValues(scope: ContentScope): SQLInputValue[] {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
    scope.locale,
  ];
}

function baseScopeValues(scope: ContentScope): SQLInputValue[] {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
  ];
}

function toEntry(row: EntryRow): ContentEntry {
  const entry: ContentEntry = {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    data: parseData(row.data_json),
  };
  if (row.published_revision_id) {
    entry.publishedRevisionId = row.published_revision_id;
  }
  return entry;
}

function toRevision(row: RevisionRow): ContentRevision {
  const revision: ContentRevision = {
    id: row.id,
    entryId: row.entry_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
    sequence: row.sequence,
    createdAt: row.created_at,
    actorId: row.actor_id,
    data: parseData(row.data_json),
  };
  if (row.base_revision_id) {
    revision.baseRevisionId = row.base_revision_id;
  }
  return revision;
}

function toSchemaDeployment(row: SchemaDeploymentRow): SchemaDeployment {
  return {
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
    document: schemaIrDocumentSchema.parse(JSON.parse(row.document_json)),
    fingerprint: row.fingerprint,
    generatedTypes: row.generated_types,
    generatedTypesFingerprint: row.generated_types_fingerprint,
    ...(row.migration_plan_id ? { migrationPlanId: row.migration_plan_id } : {}),
    deployedAt: row.deployed_at,
    actorId: row.actor_id,
  };
}

function optionalRowFields(row: {
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
    cacheTags: JSON.parse(row.cache_tags_json) as string[],
    occurredAt: row.occurred_at,
    state: row.state,
    attempts: row.attempts,
    availableAt: row.available_at,
    ...optionalRowFields(row),
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
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    ...optionalRowFields(row),
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
    eventTypes: JSON.parse(row.event_types_json) as WebhookSubscription['eventTypes'],
    active: row.active === 1,
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

export class SqliteContentRepository implements ContentRepository {
  readonly #database: DatabaseSync;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor({
    filename,
    now = () => new Date().toISOString(),
    createId = randomUUID,
  }: SqliteContentRepositoryOptions) {
    this.#database = new DatabaseSync(filename);
    this.#now = now;
    this.#createId = createId;
    this.#initialize();
  }

  #initialize(): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL DEFAULT 'local',
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'default',
        site_id TEXT NOT NULL DEFAULT 'default',
        environment_id TEXT NOT NULL DEFAULT 'development',
        locale TEXT NOT NULL DEFAULT 'en',
        content_type TEXT NOT NULL,
        current_draft_revision_id TEXT,
        published_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS entries_tenant_type_idx
        ON entries (tenant_id, content_type, updated_at DESC);

      CREATE TABLE IF NOT EXISTS revisions (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        base_revision_id TEXT,
        actor_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (entry_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS revisions_entry_idx
        ON revisions (tenant_id, entry_id, sequence DESC);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        sequence INTEGER,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        previous_hash TEXT,
        event_hash TEXT
      );

      CREATE INDEX IF NOT EXISTS audit_entry_idx
        ON audit_events (tenant_id, entry_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS translation_variants (
        entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
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
        ON translation_variants (
          organization_id, tenant_id, workspace_id, site_id, environment_id,
          translation_group_id, locale
        );

      CREATE TABLE IF NOT EXISTS outbox_events (
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
        payload_json TEXT NOT NULL,
        cache_tags_json TEXT NOT NULL,
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
        ON outbox_events (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          state, available_at, occurred_at
        );

      CREATE TABLE IF NOT EXISTS durable_jobs (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        job_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        run_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          idempotency_key
        )
      );
      CREATE INDEX IF NOT EXISTS durable_jobs_claim_idx
        ON durable_jobs (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          state, run_at, created_at
        );

      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        url TEXT NOT NULL,
        event_types_json TEXT NOT NULL,
        active INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_deployments (
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        document_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        generated_types TEXT NOT NULL,
        generated_types_fingerprint TEXT NOT NULL,
        migration_plan_id TEXT,
        deployed_at TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        PRIMARY KEY (organization_id, tenant_id, workspace_id, site_id, environment_id, locale)
      );
    `);
    this.#ensureEntryScopeColumn('organization_id', "TEXT NOT NULL DEFAULT 'local'");
    this.#ensureEntryScopeColumn('workspace_id', "TEXT NOT NULL DEFAULT 'default'");
    this.#ensureEntryScopeColumn('site_id', "TEXT NOT NULL DEFAULT 'default'");
    this.#ensureEntryScopeColumn('environment_id', "TEXT NOT NULL DEFAULT 'development'");
    this.#ensureEntryScopeColumn('locale', "TEXT NOT NULL DEFAULT 'en'");
    this.#ensureAuditColumn('previous_hash', 'TEXT');
    this.#ensureAuditColumn('event_hash', 'TEXT');
    this.#ensureAuditColumn('sequence', 'INTEGER');
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS entries_scope_type_idx
        ON entries (organization_id, tenant_id, workspace_id, site_id, environment_id, locale, content_type, updated_at DESC);
      INSERT OR IGNORE INTO translation_variants (
        entry_id, translation_group_id, organization_id, tenant_id, workspace_id,
        site_id, environment_id, locale, content_type
      )
      SELECT id, id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale, content_type
      FROM entries;
    `);
    this.#backfillAuditHashes();
    this.#database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS audit_entry_sequence_idx
        ON audit_events (entry_id, sequence);
    `);
  }

  #ensureEntryScopeColumn(name: string, definition: string): void {
    const columns = this.#database.prepare('PRAGMA table_info(entries)').all() as unknown as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === name)) {
      this.#database.exec(`ALTER TABLE entries ADD COLUMN ${name} ${definition}`);
    }
  }

  #ensureAuditColumn(name: string, definition: string): void {
    const columns = this.#database
      .prepare('PRAGMA table_info(audit_events)')
      .all() as unknown as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === name)) {
      this.#database.exec(`ALTER TABLE audit_events ADD COLUMN ${name} ${definition}`);
    }
  }

  #backfillAuditHashes(): void {
    const rows = this.#database
      .prepare(`
        SELECT a.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
        FROM audit_events a JOIN entries e ON e.id = a.entry_id
        ORDER BY a.entry_id ASC, a.occurred_at ASC, a.id ASC
      `)
      .all() as unknown as AuditRow[];
    const previousByEntry = new Map<string, string>();
    const sequenceByEntry = new Map<string, number>();
    for (const row of rows) {
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
      this.#database
        .prepare(
          'UPDATE audit_events SET sequence = ?, previous_hash = ?, event_hash = ? WHERE id = ?',
        )
        .run(sequence, previousHash ?? null, eventHash, row.id);
      previousByEntry.set(row.entry_id, eventHash);
      sequenceByEntry.set(row.entry_id, sequence);
    }
  }

  #transaction<T>(work: () => T): T {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #revisionJoin(perspective: ContentPerspective): string {
    return perspective === 'draft'
      ? 'r.id = e.current_draft_revision_id'
      : 'r.id = e.published_revision_id';
  }

  #entryRow(scope: ContentScope, id: string, perspective: ContentPerspective): EntryRow | null {
    const row = this.#database
      .prepare(`
        SELECT e.*, r.data_json
        FROM entries e
        JOIN revisions r ON ${this.#revisionJoin(perspective)}
        WHERE e.organization_id = ? AND e.tenant_id = ? AND e.workspace_id = ?
          AND e.site_id = ? AND e.environment_id = ? AND e.locale = ? AND e.id = ?
      `)
      .get(...scopeValues(scope), id) as EntryRow | undefined;
    return row ?? null;
  }

  #audit(
    scope: ContentScope,
    entryId: string,
    actor: Actor,
    action: AuditEvent['action'],
    revisionId: string,
    occurredAt: string,
  ): void {
    const id = this.#createId();
    const previous = this.#database
      .prepare(`
        SELECT sequence, event_hash FROM audit_events
        WHERE entry_id = ? ORDER BY sequence DESC LIMIT 1
      `)
      .get(entryId) as { sequence: number; event_hash: string } | undefined;
    const previousHash = previous?.event_hash;
    const sequence = (previous?.sequence ?? 0) + 1;
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
    this.#database
      .prepare(`
        INSERT INTO audit_events (
          id, tenant_id, entry_id, sequence, actor_id, action, revision_id, occurred_at,
          previous_hash, event_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
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
      );
  }

  #emitOutbox(
    scope: ContentScope,
    type: OutboxEvent['type'],
    contentType: string,
    entryId: string,
    revisionId: string,
    data: Record<string, unknown>,
    occurredAt: string,
  ): void {
    this.#database
      .prepare(`
        INSERT INTO outbox_events (
          id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          event_type, aggregate_id, revision_id, payload_json, cache_tags_json,
          occurred_at, state, attempts, available_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
      `)
      .run(
        this.#createId(),
        ...scopeValues(scope),
        type,
        entryId,
        revisionId,
        JSON.stringify({ contentType, data }),
        JSON.stringify(eventCacheTags(scope, contentType, entryId, revisionId)),
        occurredAt,
        occurredAt,
      );
  }

  list({
    scope,
    contentType,
    perspective,
  }: {
    scope: ContentScope;
    contentType?: string;
    perspective: ContentPerspective;
  }): ContentEntry[] {
    const values: SQLInputValue[] = scopeValues(scope);
    let typeClause = '';
    if (contentType) {
      typeClause = 'AND e.content_type = ?';
      values.push(contentType);
    }
    const rows = this.#database
      .prepare(`
        SELECT e.*, r.data_json
        FROM entries e
        JOIN revisions r ON ${this.#revisionJoin(perspective)}
        WHERE e.organization_id = ? AND e.tenant_id = ? AND e.workspace_id = ?
          AND e.site_id = ? AND e.environment_id = ? AND e.locale = ? ${typeClause}
        ORDER BY e.updated_at DESC, e.id ASC
      `)
      .all(...values) as unknown as EntryRow[];
    return rows.map(toEntry);
  }

  getById({
    scope,
    id,
    perspective,
  }: {
    scope: ContentScope;
    id: string;
    perspective: ContentPerspective;
  }): ContentEntry | null {
    const row = this.#entryRow(scope, id, perspective);
    return row ? toEntry(row) : null;
  }

  getBySlug({
    scope,
    contentType,
    slug,
    perspective,
  }: {
    scope: ContentScope;
    contentType: string;
    slug: string;
    perspective: ContentPerspective;
  }): ContentEntry | null {
    const row = this.#database
      .prepare(`
        SELECT e.*, r.data_json
        FROM entries e
        JOIN revisions r ON ${this.#revisionJoin(perspective)}
        WHERE e.organization_id = ? AND e.tenant_id = ? AND e.workspace_id = ?
          AND e.site_id = ? AND e.environment_id = ? AND e.locale = ?
          AND e.content_type = ?
          AND json_extract(r.data_json, '$.slug') = ?
        LIMIT 1
      `)
      .get(...scopeValues(scope), contentType, slug) as EntryRow | undefined;
    return row ? toEntry(row) : null;
  }

  create({
    scope,
    contentType,
    data,
    actor,
    translationGroupId,
  }: {
    scope: ContentScope;
    contentType: string;
    data: Record<string, unknown>;
    actor: Actor;
    translationGroupId?: string;
  }): ContentEntry {
    const id = this.#createId();
    const revisionId = this.#createId();
    const now = this.#now();
    return this.#transaction(() => {
      this.#database
        .prepare(`
          INSERT INTO entries (
            id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
            content_type, current_draft_revision_id, published_revision_id, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        `)
        .run(id, ...scopeValues(scope), contentType, now, now);
      this.#database
        .prepare(`
          INSERT INTO translation_variants (
            entry_id, translation_group_id, organization_id, tenant_id, workspace_id,
            site_id, environment_id, locale, content_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(id, translationGroupId ?? id, ...scopeValues(scope), contentType);
      this.#database
        .prepare(`
          INSERT INTO revisions (id, entry_id, tenant_id, sequence, base_revision_id, actor_id, data_json, created_at)
          VALUES (?, ?, ?, 1, NULL, ?, ?, ?)
        `)
        .run(revisionId, id, scope.tenantId, actor.id, JSON.stringify(data), now);
      this.#database
        .prepare('UPDATE entries SET current_draft_revision_id = ? WHERE id = ?')
        .run(revisionId, id);
      this.#audit(scope, id, actor, 'content.created', revisionId, now);
      this.#emitOutbox(scope, 'content.created', contentType, id, revisionId, data, now);
      const row = this.#entryRow(scope, id, 'draft');
      if (!row) throw new Error('Created GridStory entry could not be read back.');
      return toEntry(row);
    });
  }

  updateDraft({
    scope,
    id,
    expectedRevisionId,
    data,
    actor,
  }: {
    scope: ContentScope;
    id: string;
    expectedRevisionId: string;
    data: Record<string, unknown>;
    actor: Actor;
  }): ContentEntry {
    return this.#transaction(() => {
      const current = this.#entryRow(scope, id, 'draft');
      if (!current) throw new NotFoundError('Content entry was not found.');
      if (current.current_draft_revision_id !== expectedRevisionId) {
        throw new ConflictError('The draft changed after it was loaded.', {
          expectedRevisionId,
          currentRevisionId: current.current_draft_revision_id,
        });
      }
      const sequenceRow = this.#database
        .prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM revisions WHERE entry_id = ?')
        .get(id) as { sequence: number };
      const revisionId = this.#createId();
      const now = this.#now();
      this.#database
        .prepare(`
          INSERT INTO revisions (id, entry_id, tenant_id, sequence, base_revision_id, actor_id, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          revisionId,
          id,
          scope.tenantId,
          sequenceRow.sequence + 1,
          expectedRevisionId,
          actor.id,
          JSON.stringify(data),
          now,
        );
      this.#database
        .prepare(
          `UPDATE entries SET current_draft_revision_id = ?, updated_at = ?
           WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
             AND site_id = ? AND environment_id = ? AND locale = ? AND id = ?`,
        )
        .run(revisionId, now, ...scopeValues(scope), id);
      this.#audit(scope, id, actor, 'content.draft.updated', revisionId, now);
      this.#emitOutbox(
        scope,
        'content.draft.updated',
        current.content_type,
        id,
        revisionId,
        data,
        now,
      );
      const updated = this.#entryRow(scope, id, 'draft');
      if (!updated) throw new Error('Updated GridStory entry could not be read back.');
      return toEntry(updated);
    });
  }

  publish({
    scope,
    id,
    expectedRevisionId,
    actor,
  }: {
    scope: ContentScope;
    id: string;
    expectedRevisionId: string;
    actor: Actor;
  }): ContentEntry {
    return this.#transaction(() => {
      const current = this.#entryRow(scope, id, 'draft');
      if (!current) throw new NotFoundError('Content entry was not found.');
      if (current.current_draft_revision_id !== expectedRevisionId) {
        throw new ConflictError('The draft changed before it could be published.', {
          expectedRevisionId,
          currentRevisionId: current.current_draft_revision_id,
        });
      }
      const now = this.#now();
      this.#database
        .prepare(
          `UPDATE entries SET published_revision_id = ?, updated_at = ?
           WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
             AND site_id = ? AND environment_id = ? AND locale = ? AND id = ?`,
        )
        .run(expectedRevisionId, now, ...scopeValues(scope), id);
      this.#audit(scope, id, actor, 'content.published', expectedRevisionId, now);
      this.#emitOutbox(
        scope,
        'content.published',
        current.content_type,
        id,
        expectedRevisionId,
        parseData(current.data_json),
        now,
      );
      const published = this.#entryRow(scope, id, 'published');
      if (!published) throw new Error('Published GridStory entry could not be read back.');
      return toEntry(published);
    });
  }

  listRevisions({ scope, id }: { scope: ContentScope; id: string }): ContentRevision[] {
    const rows = this.#database
      .prepare(`
        SELECT r.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
        FROM revisions r
        JOIN entries e ON e.id = r.entry_id
        WHERE e.organization_id = ? AND e.tenant_id = ? AND e.workspace_id = ?
          AND e.site_id = ? AND e.environment_id = ? AND e.locale = ? AND r.entry_id = ?
        ORDER BY r.sequence DESC
      `)
      .all(...scopeValues(scope), id) as unknown as RevisionRow[];
    return rows.map(toRevision);
  }

  listAuditEvents({ scope, id }: { scope: ContentScope; id: string }): AuditEvent[] {
    const rows = this.#database
      .prepare(`
        SELECT a.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
        FROM audit_events a
        JOIN entries e ON e.id = a.entry_id
        WHERE e.organization_id = ? AND e.tenant_id = ? AND e.workspace_id = ?
          AND e.site_id = ? AND e.environment_id = ? AND e.locale = ? AND a.entry_id = ?
        ORDER BY a.sequence DESC
      `)
      .all(...scopeValues(scope), id) as unknown as AuditRow[];
    return rows.map((row) => ({
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

  listScopeAuditEvents({
    scope,
  }: Parameters<ContentRepository['listScopeAuditEvents']>[0]): AuditEvent[] {
    const rows = this.#database
      .prepare(`
        SELECT a.*, e.organization_id, e.workspace_id, e.site_id, e.environment_id, e.locale
        FROM audit_events a JOIN entries e ON e.id = a.entry_id
        WHERE e.organization_id = ? AND e.tenant_id = ? AND e.workspace_id = ?
          AND e.site_id = ? AND e.environment_id = ? AND e.locale = ?
        ORDER BY a.entry_id ASC, a.sequence ASC
      `)
      .all(...scopeValues(scope)) as unknown as AuditRow[];
    return rows.map((row) => ({
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

  getTranslationGroup({ scope, id }: { scope: ContentScope; id: string }): string | null {
    const existing = this.#database
      .prepare(`
        SELECT translation_group_id FROM translation_variants
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ? AND entry_id = ?
      `)
      .get(...scopeValues(scope), id) as { translation_group_id: string } | undefined;
    if (existing) return existing.translation_group_id;
    const entry = this.#entryRow(scope, id, 'draft');
    if (!entry) return null;
    this.#database
      .prepare(`
        INSERT OR IGNORE INTO translation_variants (
          entry_id, translation_group_id, organization_id, tenant_id, workspace_id,
          site_id, environment_id, locale, content_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, id, ...scopeValues(scope), entry.content_type);
    return id;
  }

  listTranslationVariants({
    scope,
    translationGroupId,
    perspective,
  }: Parameters<ContentRepository['listTranslationVariants']>[0]): ContentEntry[] {
    const rows = this.#database
      .prepare(`
        SELECT e.*, r.data_json
        FROM translation_variants t
        JOIN entries e ON e.id = t.entry_id
        JOIN revisions r ON ${this.#revisionJoin(perspective)}
        WHERE t.organization_id = ? AND t.tenant_id = ? AND t.workspace_id = ?
          AND t.site_id = ? AND t.environment_id = ? AND t.translation_group_id = ?
        ORDER BY t.locale ASC
      `)
      .all(...baseScopeValues(scope), translationGroupId) as unknown as EntryRow[];
    return rows.map(toEntry);
  }

  listOutboxEvents({
    scope,
    limit = 100,
  }: Parameters<ContentRepository['listOutboxEvents']>[0]): OutboxEvent[] {
    const rows = this.#database
      .prepare(`
        SELECT * FROM outbox_events
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ?
        ORDER BY occurred_at DESC, id DESC
        LIMIT ?
      `)
      .all(...scopeValues(scope), Math.max(1, Math.min(limit, 1000))) as unknown as OutboxRow[];
    return rows.map(toOutboxEvent);
  }

  listOperationalScopes({ limit = 100 }: { limit?: number } = {}): ContentScope[] {
    const rows = this.#database
      .prepare(`
        SELECT DISTINCT organization_id, tenant_id, workspace_id, site_id, environment_id, locale
        FROM (
          SELECT organization_id, tenant_id, workspace_id, site_id, environment_id, locale
          FROM outbox_events WHERE state IN ('pending', 'processing')
          UNION
          SELECT organization_id, tenant_id, workspace_id, site_id, environment_id, locale
          FROM durable_jobs WHERE state IN ('pending', 'processing')
        )
        LIMIT ?
      `)
      .all(Math.max(1, Math.min(limit, 1000))) as unknown as Array<{
      organization_id: string;
      tenant_id: string;
      workspace_id: string;
      site_id: string;
      environment_id: string;
      locale: string;
    }>;
    return rows.map((row) => ({
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      siteId: row.site_id,
      environmentId: row.environment_id,
      locale: row.locale,
    }));
  }

  claimOutboxEvents({
    scope,
    workerId,
    limit,
    now,
    leaseExpiresAt,
  }: Parameters<ContentRepository['claimOutboxEvents']>[0]): OutboxEvent[] {
    return this.#transaction(() => {
      const rows = this.#database
        .prepare(`
          SELECT * FROM outbox_events
          WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
            AND site_id = ? AND environment_id = ? AND locale = ?
            AND (
              (state = 'pending' AND available_at <= ?)
              OR (state = 'processing' AND lease_expires_at <= ?)
            )
          ORDER BY occurred_at ASC, id ASC
          LIMIT ?
        `)
        .all(
          ...scopeValues(scope),
          now,
          now,
          Math.max(1, Math.min(limit, 100)),
        ) as unknown as OutboxRow[];
      for (const row of rows) {
        this.#database
          .prepare(`
            UPDATE outbox_events
            SET state = 'processing', attempts = attempts + 1,
                lease_owner = ?, lease_expires_at = ?, last_error = NULL
            WHERE id = ?
          `)
          .run(workerId, leaseExpiresAt, row.id);
      }
      return rows.map((row) =>
        toOutboxEvent({
          ...row,
          state: 'processing',
          attempts: row.attempts + 1,
          lease_owner: workerId,
          lease_expires_at: leaseExpiresAt,
          last_error: null,
        }),
      );
    });
  }

  completeOutboxEvent({
    scope,
    id,
    workerId,
    completedAt,
  }: Parameters<ContentRepository['completeOutboxEvent']>[0]): void {
    const result = this.#database
      .prepare(`
        UPDATE outbox_events
        SET state = 'succeeded', processed_at = ?, lease_owner = NULL, lease_expires_at = NULL
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ?
          AND id = ? AND state = 'processing' AND lease_owner = ?
      `)
      .run(completedAt, ...scopeValues(scope), id, workerId);
    if (result.changes !== 1) throw new ConflictError('Outbox event lease is no longer owned.');
  }

  retryOutboxEvent({
    scope,
    id,
    workerId,
    availableAt,
    error,
    dead,
  }: Parameters<ContentRepository['retryOutboxEvent']>[0]): void {
    const result = this.#database
      .prepare(`
        UPDATE outbox_events
        SET state = ?, available_at = ?, last_error = ?, lease_owner = NULL, lease_expires_at = NULL
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ?
          AND id = ? AND state = 'processing' AND lease_owner = ?
      `)
      .run(dead ? 'dead' : 'pending', availableAt, error, ...scopeValues(scope), id, workerId);
    if (result.changes !== 1) throw new ConflictError('Outbox event lease is no longer owned.');
  }

  enqueueJob({
    scope,
    type,
    idempotencyKey,
    payload,
    runAt,
    maxAttempts,
  }: Parameters<ContentRepository['enqueueJob']>[0]): DurableJob {
    const id = this.#createId();
    const now = this.#now();
    this.#database
      .prepare(`
        INSERT OR IGNORE INTO durable_jobs (
          id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          job_type, idempotency_key, payload_json, state, attempts, max_attempts,
          run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
      `)
      .run(
        id,
        ...scopeValues(scope),
        type,
        idempotencyKey,
        JSON.stringify(payload),
        maxAttempts,
        runAt,
        now,
        now,
      );
    const row = this.#database
      .prepare(`
        SELECT * FROM durable_jobs
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ? AND idempotency_key = ?
      `)
      .get(...scopeValues(scope), idempotencyKey) as JobRow | undefined;
    if (!row) throw new Error('Enqueued durable job could not be read back.');
    return toJob(row);
  }

  listJobs({ scope, limit = 100 }: Parameters<ContentRepository['listJobs']>[0]): DurableJob[] {
    const rows = this.#database
      .prepare(`
        SELECT * FROM durable_jobs
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ?
        ORDER BY created_at DESC, id DESC LIMIT ?
      `)
      .all(...scopeValues(scope), Math.max(1, Math.min(limit, 1000))) as unknown as JobRow[];
    return rows.map(toJob);
  }

  getJob({ scope, id }: Parameters<ContentRepository['getJob']>[0]): DurableJob | null {
    const row = this.#database
      .prepare(`
        SELECT * FROM durable_jobs
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ? AND id = ?
      `)
      .get(...scopeValues(scope), id) as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  claimJobs({
    scope,
    workerId,
    limit,
    now,
    leaseExpiresAt,
  }: Parameters<ContentRepository['claimJobs']>[0]): DurableJob[] {
    return this.#transaction(() => {
      const rows = this.#database
        .prepare(`
          SELECT * FROM durable_jobs
          WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
            AND site_id = ? AND environment_id = ? AND locale = ?
            AND (
              (state = 'pending' AND run_at <= ?)
              OR (state = 'processing' AND lease_expires_at <= ?)
            )
          ORDER BY run_at ASC, created_at ASC, id ASC LIMIT ?
        `)
        .all(
          ...scopeValues(scope),
          now,
          now,
          Math.max(1, Math.min(limit, 100)),
        ) as unknown as JobRow[];
      for (const row of rows) {
        this.#database
          .prepare(`
            UPDATE durable_jobs
            SET state = 'processing', attempts = attempts + 1,
                lease_owner = ?, lease_expires_at = ?, last_error = NULL, updated_at = ?
            WHERE id = ?
          `)
          .run(workerId, leaseExpiresAt, now, row.id);
      }
      return rows.map((row) =>
        toJob({
          ...row,
          state: 'processing',
          attempts: row.attempts + 1,
          lease_owner: workerId,
          lease_expires_at: leaseExpiresAt,
          last_error: null,
          updated_at: now,
        }),
      );
    });
  }

  completeJob({
    scope,
    id,
    workerId,
    completedAt,
    result: jobResult,
  }: Parameters<ContentRepository['completeJob']>[0]): void {
    const result = this.#database
      .prepare(`
        UPDATE durable_jobs
        SET state = 'succeeded', result_json = ?, completed_at = ?, updated_at = ?,
            lease_owner = NULL, lease_expires_at = NULL
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ?
          AND id = ? AND state = 'processing' AND lease_owner = ?
      `)
      .run(
        JSON.stringify(jobResult),
        completedAt,
        completedAt,
        ...scopeValues(scope),
        id,
        workerId,
      );
    if (result.changes !== 1) throw new ConflictError('Durable job lease is no longer owned.');
  }

  failJob({
    scope,
    id,
    workerId,
    runAt,
    error,
    dead,
  }: Parameters<ContentRepository['failJob']>[0]): void {
    const now = this.#now();
    const result = this.#database
      .prepare(`
        UPDATE durable_jobs
        SET state = ?, run_at = ?, last_error = ?, updated_at = ?,
            lease_owner = NULL, lease_expires_at = NULL
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ?
          AND id = ? AND state = 'processing' AND lease_owner = ?
      `)
      .run(dead ? 'dead' : 'pending', runAt, error, now, ...scopeValues(scope), id, workerId);
    if (result.changes !== 1) throw new ConflictError('Durable job lease is no longer owned.');
  }

  saveWebhookSubscription({
    scope,
    id = this.#createId(),
    url,
    eventTypes,
    active = true,
  }: Parameters<ContentRepository['saveWebhookSubscription']>[0]): WebhookSubscription {
    const now = this.#now();
    const updated = this.#database
      .prepare(`
        UPDATE webhook_subscriptions
        SET url = ?, event_types_json = ?, active = ?, updated_at = ?
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ? AND id = ?
      `)
      .run(url, JSON.stringify(eventTypes), active ? 1 : 0, now, ...scopeValues(scope), id);
    if (updated.changes === 0) {
      this.#database
        .prepare(`
          INSERT INTO webhook_subscriptions (
            id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
            url, event_types_json, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(id, ...scopeValues(scope), url, JSON.stringify(eventTypes), active ? 1 : 0, now, now);
    }
    const row = this.#database
      .prepare(`
        SELECT * FROM webhook_subscriptions
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ? AND id = ?
      `)
      .get(...scopeValues(scope), id) as WebhookRow | undefined;
    if (!row) throw new Error('Saved webhook subscription could not be read back.');
    return toWebhook(row);
  }

  listWebhookSubscriptions({
    scope,
  }: Parameters<ContentRepository['listWebhookSubscriptions']>[0]): WebhookSubscription[] {
    const rows = this.#database
      .prepare(`
        SELECT * FROM webhook_subscriptions
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ?
        ORDER BY created_at ASC, id ASC
      `)
      .all(...scopeValues(scope)) as unknown as WebhookRow[];
    return rows.map(toWebhook);
  }

  deleteWebhookSubscription({
    scope,
    id,
  }: Parameters<ContentRepository['deleteWebhookSubscription']>[0]): boolean {
    const result = this.#database
      .prepare(`
        DELETE FROM webhook_subscriptions
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ? AND id = ?
      `)
      .run(...scopeValues(scope), id);
    return result.changes === 1;
  }

  exportPortableContent({
    scope,
  }: Parameters<ContentRepository['exportPortableContent']>[0]): PortableContentRecord[] {
    return this.list({ scope, perspective: 'draft' })
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => {
        const translationGroupId = this.getTranslationGroup({ scope, id: entry.id });
        if (!translationGroupId) {
          throw new Error(`Translation group is missing for portable entry ${entry.id}.`);
        }
        return {
          entryId: entry.id,
          contentType: entry.contentType,
          currentDraftRevisionId: entry.draftRevisionId,
          ...(entry.publishedRevisionId ? { publishedRevisionId: entry.publishedRevisionId } : {}),
          translationGroupId,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          revisions: this.listRevisions({ scope, id: entry.id })
            .sort((left, right) => left.sequence - right.sequence)
            .map((revision) => ({
              id: revision.id,
              sequence: revision.sequence,
              ...(revision.baseRevisionId ? { baseRevisionId: revision.baseRevisionId } : {}),
              actorId: revision.actorId,
              data: revision.data,
              createdAt: revision.createdAt,
            })),
          auditEvents: this.listAuditEvents({ scope, id: entry.id })
            .sort((left, right) => left.sequence - right.sequence)
            .map((event) => ({
              id: event.id,
              sequence: event.sequence,
              actorId: event.actorId,
              action: event.action,
              revisionId: event.revisionId,
              occurredAt: event.occurredAt,
            })),
        };
      });
  }

  importPortableContent({
    scope,
    records,
    conflictPolicy,
    dryRun,
  }: Parameters<ContentRepository['importPortableContent']>[0]): PortableImportResult {
    return this.#transaction(() => {
      const recordIds = records.map((record) => record.entryId);
      const existing = recordIds
        .map(
          (id) =>
            this.#database
              .prepare(`
              SELECT id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale
              FROM entries WHERE id = ?
            `)
              .get(id) as unknown as ExistingEntryRow | undefined,
        )
        .filter((row): row is ExistingEntryRow => row !== undefined);
      const conflicts = existing.map((row) => row.id);
      const crossScope = existing.filter(
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

      if (conflictPolicy === 'replace') {
        for (const id of conflicts) {
          this.#database
            .prepare(`
              DELETE FROM outbox_events
              WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
                AND site_id = ? AND environment_id = ? AND locale = ? AND aggregate_id = ?
            `)
            .run(...scopeValues(scope), id);
          this.#database.prepare('DELETE FROM entries WHERE id = ?').run(id);
        }
      }
      for (const record of selected) {
        this.#database
          .prepare(`
            INSERT INTO entries (
              id, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
              content_type, current_draft_revision_id, published_revision_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            record.entryId,
            ...scopeValues(scope),
            record.contentType,
            record.currentDraftRevisionId,
            record.publishedRevisionId ?? null,
            record.createdAt,
            record.updatedAt,
          );
        this.#database
          .prepare(`
            INSERT INTO translation_variants (
              entry_id, translation_group_id, organization_id, tenant_id, workspace_id,
              site_id, environment_id, locale, content_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            record.entryId,
            record.translationGroupId,
            ...scopeValues(scope),
            record.contentType,
          );
        for (const revision of record.revisions) {
          this.#database
            .prepare(`
              INSERT INTO revisions (
                id, entry_id, tenant_id, sequence, base_revision_id, actor_id, data_json, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              revision.id,
              record.entryId,
              scope.tenantId,
              revision.sequence,
              revision.baseRevisionId ?? null,
              revision.actorId,
              JSON.stringify(revision.data),
              revision.createdAt,
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
          this.#database
            .prepare(`
              INSERT INTO audit_events (
                id, tenant_id, entry_id, sequence, actor_id, action, revision_id, occurred_at,
                previous_hash, event_hash
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
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
            );
          previousAuditHash = eventHash;
        }
      }
      return result;
    });
  }

  getSchemaDeployment({ scope }: { scope: ContentScope }): SchemaDeployment | null {
    const row = this.#database
      .prepare(`
        SELECT * FROM schema_deployments
        WHERE organization_id = ? AND tenant_id = ? AND workspace_id = ?
          AND site_id = ? AND environment_id = ? AND locale = ?
      `)
      .get(...scopeValues(scope)) as SchemaDeploymentRow | undefined;
    return row ? toSchemaDeployment(row) : null;
  }

  saveSchemaDeployment({
    scope,
    document,
    fingerprint,
    generatedTypes,
    generatedTypesFingerprint,
    migrationPlanId,
    actor,
  }: Parameters<ContentRepository['saveSchemaDeployment']>[0]): SchemaDeployment {
    const deployedAt = this.#now();
    this.#database
      .prepare(`
        INSERT INTO schema_deployments (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          document_json, fingerprint, generated_types, generated_types_fingerprint,
          migration_plan_id, deployed_at, actor_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (organization_id, tenant_id, workspace_id, site_id, environment_id, locale)
        DO UPDATE SET
          document_json = excluded.document_json,
          fingerprint = excluded.fingerprint,
          generated_types = excluded.generated_types,
          generated_types_fingerprint = excluded.generated_types_fingerprint,
          migration_plan_id = excluded.migration_plan_id,
          deployed_at = excluded.deployed_at,
          actor_id = excluded.actor_id
      `)
      .run(
        ...scopeValues(scope),
        JSON.stringify(document),
        fingerprint,
        generatedTypes,
        generatedTypesFingerprint,
        migrationPlanId ?? null,
        deployedAt,
        actor.id,
      );
    const deployment = this.getSchemaDeployment({ scope });
    if (!deployment) throw new Error('Saved SQLite schema deployment could not be read back.');
    return deployment;
  }

  close(): void {
    this.#database.close();
  }
}
