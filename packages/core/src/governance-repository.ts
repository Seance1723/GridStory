import { DatabaseSync } from 'node:sqlite';
import {
  type ContentScope,
  type GovernanceSnapshot,
  governanceSnapshotSchema,
} from '@gridstory/schema';
import { Pool, type PoolConfig } from 'pg';
import { GridStoryError } from './errors.js';
import { contentScopeKey } from './tenant-scope.js';
import type { Awaitable } from './types.js';

export type GovernanceDocument = GovernanceSnapshot;

export function emptyGovernanceDocument(
  scope: ContentScope,
  timestamp = '1970-01-01T00:00:00.000Z',
): GovernanceDocument {
  return {
    ...scope,
    version: 0,
    retentionRules: [],
    subjects: [],
    links: [],
    holds: [],
    restrictions: [],
    requests: [],
    plans: [],
    residencyPolicy: {
      homeRegion: 'local',
      requireAttestation: true,
      rules: [
        { resourceType: 'content', allowedRegions: ['local'] },
        { resourceType: 'asset', allowedRegions: ['local'] },
        { resourceType: 'identity', allowedRegions: ['local'] },
        { resourceType: 'plugin', allowedRegions: ['local'] },
      ],
      updatedBy: 'system',
      updatedAt: timestamp,
    },
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function writeConflict(): GridStoryError {
  return new GridStoryError(
    'Governance state changed during this operation.',
    'governance_write_conflict',
    409,
  );
}

export interface GovernanceRepository {
  get(scope: ContentScope): Awaitable<GovernanceDocument | null>;
  save(document: GovernanceDocument, expectedVersion: number | null): Awaitable<void>;
  listScopes(input?: { limit?: number }): Awaitable<ContentScope[]>;
  close(): Awaitable<void>;
}

export class InMemoryGovernanceRepository implements GovernanceRepository {
  readonly #documents = new Map<string, GovernanceDocument>();

  get(scope: ContentScope): GovernanceDocument | null {
    const document = this.#documents.get(contentScopeKey(scope));
    return document ? structuredClone(document) : null;
  }

  save(document: GovernanceDocument, expectedVersion: number | null): void {
    const parsed = governanceSnapshotSchema.parse(document);
    const key = contentScopeKey(parsed);
    const current = this.#documents.get(key);
    if (expectedVersion === null ? current !== undefined : current?.version !== expectedVersion) {
      throw writeConflict();
    }
    this.#documents.set(key, structuredClone(parsed));
  }

  listScopes(input: { limit?: number } = {}): ContentScope[] {
    return [...this.#documents.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit ?? 1_000)
      .map(({ organizationId, tenantId, workspaceId, siteId, environmentId, locale }) => ({
        organizationId,
        tenantId,
        workspaceId,
        siteId,
        environmentId,
        locale,
      }));
  }

  close(): void {}
}

interface PayloadRow {
  payload: string;
}

interface ScopeRow {
  organization_id: string;
  tenant_id: string;
  workspace_id: string;
  site_id: string;
  environment_id: string;
  locale: string;
}

function rowScope(row: ScopeRow): ContentScope {
  return {
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    environmentId: row.environment_id,
    locale: row.locale,
  };
}

export class SqliteGovernanceRepository implements GovernanceRepository {
  readonly #database: DatabaseSync;

  constructor(options: { filename: string }) {
    this.#database = new DatabaseSync(options.filename);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS gridstory_governance_documents (
        scope_key TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 0),
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_gridstory_governance_updated
        ON gridstory_governance_documents (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          updated_at DESC
        );
    `);
  }

  get(scope: ContentScope): GovernanceDocument | null {
    const row = this.#database
      .prepare('SELECT payload FROM gridstory_governance_documents WHERE scope_key = ?')
      .get(contentScopeKey(scope)) as unknown as PayloadRow | undefined;
    return row ? governanceSnapshotSchema.parse(JSON.parse(row.payload)) : null;
  }

  save(document: GovernanceDocument, expectedVersion: number | null): void {
    const parsed = governanceSnapshotSchema.parse(document);
    const values = [
      contentScopeKey(parsed),
      parsed.organizationId,
      parsed.tenantId,
      parsed.workspaceId,
      parsed.siteId,
      parsed.environmentId,
      parsed.locale,
      parsed.version,
      parsed.updatedAt,
      JSON.stringify(parsed),
    ];
    if (expectedVersion === null) {
      try {
        this.#database
          .prepare(
            `INSERT INTO gridstory_governance_documents (
               scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id,
               locale, version, updated_at, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(...values);
        return;
      } catch (error) {
        if (String(error).includes('UNIQUE constraint failed')) throw writeConflict();
        throw error;
      }
    }
    const result = this.#database
      .prepare(
        `UPDATE gridstory_governance_documents
         SET version = ?, updated_at = ?, payload = ?
         WHERE scope_key = ? AND version = ?`,
      )
      .run(
        parsed.version,
        parsed.updatedAt,
        JSON.stringify(parsed),
        contentScopeKey(parsed),
        expectedVersion,
      );
    if (result.changes !== 1) throw writeConflict();
  }

  listScopes(input: { limit?: number } = {}): ContentScope[] {
    const rows = this.#database
      .prepare(
        `SELECT organization_id, tenant_id, workspace_id, site_id, environment_id, locale
         FROM gridstory_governance_documents
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(input.limit ?? 1_000) as unknown as ScopeRow[];
    return rows.map(rowScope);
  }

  close(): void {
    this.#database.close();
  }
}

export class PostgresGovernanceRepository implements GovernanceRepository {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #table: string;
  readonly #ready: Promise<unknown>;

  constructor(options: { connectionString?: string; pool?: Pool; schema?: string }) {
    const schema = options.schema ?? 'gridstory';
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new Error('PostgreSQL governance schema name is invalid.');
    }
    if (!options.pool && !options.connectionString) {
      throw new Error('PostgreSQL governance connectionString or pool is required.');
    }
    this.#pool =
      options.pool ?? new Pool({ connectionString: options.connectionString } as PoolConfig);
    this.#ownsPool = !options.pool;
    const quotedSchema = `"${schema}"`;
    this.#table = `${quotedSchema}.gridstory_governance_documents`;
    this.#ready = this.#pool.query(`
      CREATE SCHEMA IF NOT EXISTS ${quotedSchema};
      CREATE TABLE IF NOT EXISTS ${this.#table} (
        scope_key TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 0),
        updated_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gridstory_governance_updated
        ON ${this.#table} (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          updated_at DESC
        );
    `);
  }

  async get(scope: ContentScope): Promise<GovernanceDocument | null> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      `SELECT payload FROM ${this.#table} WHERE scope_key = $1`,
      [contentScopeKey(scope)],
    );
    return result.rows[0] ? governanceSnapshotSchema.parse(result.rows[0].payload) : null;
  }

  async save(document: GovernanceDocument, expectedVersion: number | null): Promise<void> {
    await this.#ready;
    const parsed = governanceSnapshotSchema.parse(document);
    if (expectedVersion === null) {
      const result = await this.#pool.query(
        `INSERT INTO ${this.#table} (
           scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id,
           locale, version, updated_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         ON CONFLICT (scope_key) DO NOTHING`,
        [
          contentScopeKey(parsed),
          parsed.organizationId,
          parsed.tenantId,
          parsed.workspaceId,
          parsed.siteId,
          parsed.environmentId,
          parsed.locale,
          parsed.version,
          parsed.updatedAt,
          JSON.stringify(parsed),
        ],
      );
      if (result.rowCount !== 1) throw writeConflict();
      return;
    }
    const result = await this.#pool.query(
      `UPDATE ${this.#table}
       SET version = $1, updated_at = $2, payload = $3::jsonb
       WHERE scope_key = $4 AND version = $5`,
      [
        parsed.version,
        parsed.updatedAt,
        JSON.stringify(parsed),
        contentScopeKey(parsed),
        expectedVersion,
      ],
    );
    if (result.rowCount !== 1) throw writeConflict();
  }

  async listScopes(input: { limit?: number } = {}): Promise<ContentScope[]> {
    await this.#ready;
    const result = await this.#pool.query<ScopeRow>(
      `SELECT organization_id, tenant_id, workspace_id, site_id, environment_id, locale
       FROM ${this.#table}
       ORDER BY updated_at DESC
       LIMIT $1`,
      [input.limit ?? 1_000],
    );
    return result.rows.map(rowScope);
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }
}
