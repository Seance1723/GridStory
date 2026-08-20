import { DatabaseSync } from 'node:sqlite';
import {
  type ContentScope,
  type PluginInstallation,
  pluginInstallationSchema,
} from '@gridstory/schema';
import { Pool, type PoolConfig } from 'pg';
import { contentScopeKey } from './tenant-scope.js';
import type { Awaitable } from './types.js';

export interface PluginRepository {
  list(scope: ContentScope): Awaitable<PluginInstallation[]>;
  get(scope: ContentScope, id: string): Awaitable<PluginInstallation | null>;
  save(installation: PluginInstallation): Awaitable<PluginInstallation>;
  close(): Awaitable<void>;
}

export class InMemoryPluginRepository implements PluginRepository {
  readonly #installations = new Map<string, PluginInstallation>();

  list(scope: ContentScope): PluginInstallation[] {
    const prefix = `${contentScopeKey(scope)}\u001f`;
    return [...this.#installations.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, installation]) => structuredClone(installation))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  get(scope: ContentScope, id: string): PluginInstallation | null {
    const installation = this.#installations.get(`${contentScopeKey(scope)}\u001f${id}`);
    return installation ? structuredClone(installation) : null;
  }

  save(installation: PluginInstallation): PluginInstallation {
    const parsed = pluginInstallationSchema.parse(installation);
    this.#installations.set(
      `${contentScopeKey(parsed)}\u001f${parsed.id}`,
      structuredClone(parsed),
    );
    return structuredClone(parsed);
  }

  close(): void {}
}

interface PayloadRow {
  payload: string;
}

export class SqlitePluginRepository implements PluginRepository {
  readonly #database: DatabaseSync;

  constructor(options: { filename: string }) {
    this.#database = new DatabaseSync(options.filename);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS gridstory_plugins (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        id TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (scope_key, id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_gridstory_plugins_scope_state
        ON gridstory_plugins (scope_key, state, updated_at DESC, id ASC);
    `);
  }

  list(scope: ContentScope): PluginInstallation[] {
    const rows = this.#database
      .prepare('SELECT payload FROM gridstory_plugins WHERE scope_key = ? ORDER BY id')
      .all(contentScopeKey(scope)) as unknown as PayloadRow[];
    return rows.map((row) => pluginInstallationSchema.parse(JSON.parse(row.payload)));
  }

  get(scope: ContentScope, id: string): PluginInstallation | null {
    const row = this.#database
      .prepare('SELECT payload FROM gridstory_plugins WHERE scope_key = ? AND id = ?')
      .get(contentScopeKey(scope), id) as unknown as PayloadRow | undefined;
    return row ? pluginInstallationSchema.parse(JSON.parse(row.payload)) : null;
  }

  save(installation: PluginInstallation): PluginInstallation {
    const parsed = pluginInstallationSchema.parse(installation);
    this.#database
      .prepare(
        `INSERT INTO gridstory_plugins (
           scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
           id, state, updated_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, id) DO UPDATE SET
           state = excluded.state,
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
        parsed.state,
        parsed.updatedAt,
        JSON.stringify(parsed),
      );
    return parsed;
  }

  close(): void {
    this.#database.close();
  }
}

export class PostgresPluginRepository implements PluginRepository {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #table: string;
  readonly #ready: Promise<unknown>;

  constructor(options: { connectionString?: string; pool?: Pool; schema?: string }) {
    const schema = options.schema;
    if (schema && !/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new Error('PostgreSQL schema name is invalid.');
    }
    if (!options.pool && !options.connectionString) {
      throw new Error('A PostgreSQL pool or connection string is required.');
    }
    this.#pool =
      options.pool ?? new Pool({ connectionString: options.connectionString } as PoolConfig);
    this.#ownsPool = !options.pool;
    const quotedSchema = schema ? `"${schema}"` : undefined;
    this.#table = quotedSchema ? `${quotedSchema}.plugins` : 'gridstory_plugins';
    const indexName = quotedSchema ? 'plugins_scope_state' : 'gridstory_plugins_scope_state';
    this.#ready = this.#pool.query(`
      ${quotedSchema ? `CREATE SCHEMA IF NOT EXISTS ${quotedSchema};` : ''}
      CREATE TABLE IF NOT EXISTS ${this.#table} (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        id TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (scope_key, id)
      );
      CREATE INDEX IF NOT EXISTS ${indexName}
        ON ${this.#table} (scope_key, state, updated_at DESC, id ASC);
    `);
  }

  async list(scope: ContentScope): Promise<PluginInstallation[]> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      `SELECT payload FROM ${this.#table} WHERE scope_key = $1 ORDER BY id`,
      [contentScopeKey(scope)],
    );
    return result.rows.map((row) => pluginInstallationSchema.parse(row.payload));
  }

  async get(scope: ContentScope, id: string): Promise<PluginInstallation | null> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      `SELECT payload FROM ${this.#table} WHERE scope_key = $1 AND id = $2`,
      [contentScopeKey(scope), id],
    );
    return result.rows[0] ? pluginInstallationSchema.parse(result.rows[0].payload) : null;
  }

  async save(installation: PluginInstallation): Promise<PluginInstallation> {
    await this.#ready;
    const parsed = pluginInstallationSchema.parse(installation);
    await this.#pool.query(
      `INSERT INTO ${this.#table} (
         scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
         id, state, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT(scope_key, id) DO UPDATE SET
         state = excluded.state,
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
        parsed.state,
        parsed.updatedAt,
        JSON.stringify(parsed),
      ],
    );
    return parsed;
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }
}
