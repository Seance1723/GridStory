import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { releaseSchema, type ContentScope, type Release } from '@gridstory/schema';
import type { Awaitable } from './types.js';

export interface ReleaseRepository {
  list(scope: ContentScope): Awaitable<Release[]>;
  get(scope: ContentScope, id: string): Awaitable<Release | null>;
  save(release: Release): Awaitable<Release>;
  close(): Awaitable<void>;
}

function scopeKey(scope: ContentScope): string {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
    scope.locale,
  ].join('\u001f');
}

export class InMemoryReleaseRepository implements ReleaseRepository {
  readonly #releases = new Map<string, Release>();

  list(scope: ContentScope): Release[] {
    const prefix = `${scopeKey(scope)}\u001f`;
    return [...this.#releases.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, release]) => structuredClone(release))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(scope: ContentScope, id: string): Release | null {
    const release = this.#releases.get(`${scopeKey(scope)}\u001f${id}`);
    return release ? structuredClone(release) : null;
  }

  save(release: Release): Release {
    const parsed = releaseSchema.parse(release);
    this.#releases.set(`${scopeKey(parsed)}\u001f${parsed.id}`, structuredClone(parsed));
    return structuredClone(parsed);
  }

  close(): void {}
}

interface PayloadRow {
  payload: string;
}

export class SqliteReleaseRepository implements ReleaseRepository {
  readonly #database: DatabaseSync;

  constructor(options: { filename: string }) {
    this.#database = new DatabaseSync(options.filename);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS gridstory_releases (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        id TEXT NOT NULL,
        state TEXT NOT NULL,
        run_at TEXT,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (scope_key, id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_gridstory_releases_scope_updated
        ON gridstory_releases (scope_key, updated_at DESC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_gridstory_releases_due
        ON gridstory_releases (scope_key, state, run_at);
    `);
  }

  list(scope: ContentScope): Release[] {
    const rows = this.#database
      .prepare(
        'SELECT payload FROM gridstory_releases WHERE scope_key = ? ORDER BY updated_at DESC',
      )
      .all(scopeKey(scope)) as unknown as PayloadRow[];
    return rows.map((row) => releaseSchema.parse(JSON.parse(row.payload)));
  }

  get(scope: ContentScope, id: string): Release | null {
    const row = this.#database
      .prepare('SELECT payload FROM gridstory_releases WHERE scope_key = ? AND id = ?')
      .get(scopeKey(scope), id) as unknown as PayloadRow | undefined;
    return row ? releaseSchema.parse(JSON.parse(row.payload)) : null;
  }

  save(release: Release): Release {
    const parsed = releaseSchema.parse(release);
    this.#database
      .prepare(
        `INSERT INTO gridstory_releases (
           scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
           id, state, run_at, updated_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, id) DO UPDATE SET
           state = excluded.state,
           run_at = excluded.run_at,
           updated_at = excluded.updated_at,
           payload = excluded.payload`,
      )
      .run(
        scopeKey(parsed),
        parsed.organizationId,
        parsed.tenantId,
        parsed.workspaceId,
        parsed.siteId,
        parsed.environmentId,
        parsed.locale,
        parsed.id,
        parsed.state,
        parsed.schedule?.state === 'pending' ? parsed.schedule.runAt : null,
        parsed.updatedAt,
        JSON.stringify(parsed),
      );
    return parsed;
  }

  close(): void {
    this.#database.close();
  }
}

export class PostgresReleaseRepository implements ReleaseRepository {
  readonly #pool: Pool;
  readonly #ready: Promise<unknown>;

  constructor(options: { connectionString: string }) {
    this.#pool = new Pool({ connectionString: options.connectionString });
    this.#ready = this.#pool.query(`
      CREATE TABLE IF NOT EXISTS gridstory_releases (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        id TEXT NOT NULL,
        state TEXT NOT NULL,
        run_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (scope_key, id)
      );
      CREATE INDEX IF NOT EXISTS idx_gridstory_releases_scope_updated
        ON gridstory_releases (scope_key, updated_at DESC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_gridstory_releases_due
        ON gridstory_releases (scope_key, state, run_at);
    `);
  }

  async list(scope: ContentScope): Promise<Release[]> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      'SELECT payload FROM gridstory_releases WHERE scope_key = $1 ORDER BY updated_at DESC',
      [scopeKey(scope)],
    );
    return result.rows.map((row) => releaseSchema.parse(row.payload));
  }

  async get(scope: ContentScope, id: string): Promise<Release | null> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      'SELECT payload FROM gridstory_releases WHERE scope_key = $1 AND id = $2',
      [scopeKey(scope), id],
    );
    return result.rows[0] ? releaseSchema.parse(result.rows[0].payload) : null;
  }

  async save(release: Release): Promise<Release> {
    await this.#ready;
    const parsed = releaseSchema.parse(release);
    await this.#pool.query(
      `INSERT INTO gridstory_releases (
         scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
         id, state, run_at, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT(scope_key, id) DO UPDATE SET
         state = excluded.state,
         run_at = excluded.run_at,
         updated_at = excluded.updated_at,
         payload = excluded.payload`,
      [
        scopeKey(parsed),
        parsed.organizationId,
        parsed.tenantId,
        parsed.workspaceId,
        parsed.siteId,
        parsed.environmentId,
        parsed.locale,
        parsed.id,
        parsed.state,
        parsed.schedule?.state === 'pending' ? parsed.schedule.runAt : null,
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
