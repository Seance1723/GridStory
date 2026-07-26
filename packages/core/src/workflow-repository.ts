import { DatabaseSync } from 'node:sqlite';
import { contentScopeKey } from './tenant-scope.js';
import { Pool } from 'pg';
import {
  workflowDefinitionSchema,
  workflowInstanceSchema,
  type ContentScope,
  type WorkflowDefinition,
  type WorkflowInstance,
} from '@gridstory/schema';
import type { Awaitable } from './types.js';

export interface WorkflowRepository {
  listDefinitions(scope: ContentScope): Awaitable<WorkflowDefinition[]>;
  getDefinition(scope: ContentScope, id: string): Awaitable<WorkflowDefinition | null>;
  saveDefinition(definition: WorkflowDefinition): Awaitable<WorkflowDefinition>;
  getInstance(scope: ContentScope, entryId: string): Awaitable<WorkflowInstance | null>;
  listInstances(scope: ContentScope): Awaitable<WorkflowInstance[]>;
  saveInstance(instance: WorkflowInstance): Awaitable<WorkflowInstance>;
  close(): Awaitable<void>;
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  readonly #definitions = new Map<string, WorkflowDefinition>();
  readonly #instances = new Map<string, WorkflowInstance>();

  listDefinitions(scope: ContentScope): WorkflowDefinition[] {
    const prefix = `${contentScopeKey(scope)}\u001f`;
    return [...this.#definitions.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, definition]) => structuredClone(definition));
  }

  getDefinition(scope: ContentScope, id: string): WorkflowDefinition | null {
    const definition = this.#definitions.get(`${contentScopeKey(scope)}\u001f${id}`);
    return definition ? structuredClone(definition) : null;
  }

  saveDefinition(definition: WorkflowDefinition): WorkflowDefinition {
    const parsed = workflowDefinitionSchema.parse(definition);
    this.#definitions.set(`${contentScopeKey(parsed)}\u001f${parsed.id}`, structuredClone(parsed));
    return structuredClone(parsed);
  }

  getInstance(scope: ContentScope, entryId: string): WorkflowInstance | null {
    const instance = this.#instances.get(`${contentScopeKey(scope)}\u001f${entryId}`);
    return instance ? structuredClone(instance) : null;
  }

  listInstances(scope: ContentScope): WorkflowInstance[] {
    const prefix = `${contentScopeKey(scope)}\u001f`;
    return [...this.#instances.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, instance]) => structuredClone(instance));
  }

  saveInstance(instance: WorkflowInstance): WorkflowInstance {
    const parsed = workflowInstanceSchema.parse(instance);
    this.#instances.set(
      `${contentScopeKey(parsed)}\u001f${parsed.entryId}`,
      structuredClone(parsed),
    );
    return structuredClone(parsed);
  }

  close(): void {}
}

interface PayloadRow {
  payload: string;
}

export class SqliteWorkflowRepository implements WorkflowRepository {
  readonly #database: DatabaseSync;

  constructor(options: { filename: string }) {
    this.#database = new DatabaseSync(options.filename);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS gridstory_workflow_definitions (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (scope_key, id)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gridstory_workflow_content_type
        ON gridstory_workflow_definitions (scope_key, content_type);
      CREATE TABLE IF NOT EXISTS gridstory_workflow_instances (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (scope_key, entry_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_gridstory_workflow_instances_scope_updated
        ON gridstory_workflow_instances (scope_key, updated_at DESC, entry_id ASC);
    `);
  }

  listDefinitions(scope: ContentScope): WorkflowDefinition[] {
    const rows = this.#database
      .prepare('SELECT payload FROM gridstory_workflow_definitions WHERE scope_key = ? ORDER BY id')
      .all(contentScopeKey(scope)) as unknown as PayloadRow[];
    return rows.map((row) => workflowDefinitionSchema.parse(JSON.parse(row.payload)));
  }

  getDefinition(scope: ContentScope, id: string): WorkflowDefinition | null {
    const row = this.#database
      .prepare('SELECT payload FROM gridstory_workflow_definitions WHERE scope_key = ? AND id = ?')
      .get(contentScopeKey(scope), id) as unknown as PayloadRow | undefined;
    return row ? workflowDefinitionSchema.parse(JSON.parse(row.payload)) : null;
  }

  saveDefinition(definition: WorkflowDefinition): WorkflowDefinition {
    const parsed = workflowDefinitionSchema.parse(definition);
    this.#database
      .prepare(
        `INSERT INTO gridstory_workflow_definitions (
           scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
           id, content_type, updated_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, id) DO UPDATE SET
           content_type = excluded.content_type,
           updated_at = excluded.updated_at,
           payload = excluded.payload`,
      )
      .run(
        contentScopeKey(parsed),
        parsed.organizationId,
        parsed.tenantId,
        parsed.workspaceId,
        parsed.siteId,
        parsed.environmentId,
        parsed.locale,
        parsed.id,
        parsed.contentType,
        parsed.updatedAt,
        JSON.stringify(parsed),
      );
    return parsed;
  }

  getInstance(scope: ContentScope, entryId: string): WorkflowInstance | null {
    const row = this.#database
      .prepare(
        'SELECT payload FROM gridstory_workflow_instances WHERE scope_key = ? AND entry_id = ?',
      )
      .get(contentScopeKey(scope), entryId) as unknown as PayloadRow | undefined;
    return row ? workflowInstanceSchema.parse(JSON.parse(row.payload)) : null;
  }

  listInstances(scope: ContentScope): WorkflowInstance[] {
    const rows = this.#database
      .prepare(
        'SELECT payload FROM gridstory_workflow_instances WHERE scope_key = ? ORDER BY updated_at DESC',
      )
      .all(contentScopeKey(scope)) as unknown as PayloadRow[];
    return rows.map((row) => workflowInstanceSchema.parse(JSON.parse(row.payload)));
  }

  saveInstance(instance: WorkflowInstance): WorkflowInstance {
    const parsed = workflowInstanceSchema.parse(instance);
    this.#database
      .prepare(
        `INSERT INTO gridstory_workflow_instances (
           scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
           entry_id, updated_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, entry_id) DO UPDATE SET
           updated_at = excluded.updated_at,
           payload = excluded.payload`,
      )
      .run(
        contentScopeKey(parsed),
        parsed.organizationId,
        parsed.tenantId,
        parsed.workspaceId,
        parsed.siteId,
        parsed.environmentId,
        parsed.locale,
        parsed.entryId,
        parsed.updatedAt,
        JSON.stringify(parsed),
      );
    return parsed;
  }

  close(): void {
    this.#database.close();
  }
}

export class PostgresWorkflowRepository implements WorkflowRepository {
  readonly #pool: Pool;
  readonly #ready: Promise<unknown>;

  constructor(options: { connectionString: string }) {
    this.#pool = new Pool({ connectionString: options.connectionString });
    this.#ready = this.#pool.query(`
      CREATE TABLE IF NOT EXISTS gridstory_workflow_definitions (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (scope_key, id),
        UNIQUE (scope_key, content_type)
      );
      CREATE TABLE IF NOT EXISTS gridstory_workflow_instances (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (scope_key, entry_id)
      );
      CREATE INDEX IF NOT EXISTS idx_gridstory_workflow_instances_scope_updated
        ON gridstory_workflow_instances (scope_key, updated_at DESC, entry_id ASC);
    `);
  }

  async listDefinitions(scope: ContentScope): Promise<WorkflowDefinition[]> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      'SELECT payload FROM gridstory_workflow_definitions WHERE scope_key = $1 ORDER BY id',
      [contentScopeKey(scope)],
    );
    return result.rows.map((row) => workflowDefinitionSchema.parse(row.payload));
  }

  async getDefinition(scope: ContentScope, id: string): Promise<WorkflowDefinition | null> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      'SELECT payload FROM gridstory_workflow_definitions WHERE scope_key = $1 AND id = $2',
      [contentScopeKey(scope), id],
    );
    return result.rows[0] ? workflowDefinitionSchema.parse(result.rows[0].payload) : null;
  }

  async saveDefinition(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    await this.#ready;
    const parsed = workflowDefinitionSchema.parse(definition);
    await this.#pool.query(
      `INSERT INTO gridstory_workflow_definitions (
         scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
         id, content_type, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT(scope_key, id) DO UPDATE SET
         content_type = excluded.content_type,
         updated_at = excluded.updated_at,
         payload = excluded.payload`,
      [
        contentScopeKey(parsed),
        parsed.organizationId,
        parsed.tenantId,
        parsed.workspaceId,
        parsed.siteId,
        parsed.environmentId,
        parsed.locale,
        parsed.id,
        parsed.contentType,
        parsed.updatedAt,
        JSON.stringify(parsed),
      ],
    );
    return parsed;
  }

  async getInstance(scope: ContentScope, entryId: string): Promise<WorkflowInstance | null> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      'SELECT payload FROM gridstory_workflow_instances WHERE scope_key = $1 AND entry_id = $2',
      [contentScopeKey(scope), entryId],
    );
    return result.rows[0] ? workflowInstanceSchema.parse(result.rows[0].payload) : null;
  }

  async listInstances(scope: ContentScope): Promise<WorkflowInstance[]> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      'SELECT payload FROM gridstory_workflow_instances WHERE scope_key = $1 ORDER BY updated_at DESC',
      [contentScopeKey(scope)],
    );
    return result.rows.map((row) => workflowInstanceSchema.parse(row.payload));
  }

  async saveInstance(instance: WorkflowInstance): Promise<WorkflowInstance> {
    await this.#ready;
    const parsed = workflowInstanceSchema.parse(instance);
    await this.#pool.query(
      `INSERT INTO gridstory_workflow_instances (
         scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
         entry_id, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT(scope_key, entry_id) DO UPDATE SET
         updated_at = excluded.updated_at,
         payload = excluded.payload`,
      [
        contentScopeKey(parsed),
        parsed.organizationId,
        parsed.tenantId,
        parsed.workspaceId,
        parsed.siteId,
        parsed.environmentId,
        parsed.locale,
        parsed.entryId,
        parsed.updatedAt,
        JSON.stringify(parsed),
      ],
    );
    return parsed;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
