import { DatabaseSync } from 'node:sqlite';
import {
  aiAuthoringDocumentSchema,
  type AiAuthoringDocument,
  type ContentScope,
} from '@gridstory/schema';
import { Pool, type PoolConfig } from 'pg';
import { GridStoryError } from './errors.js';
import { contentScopeKey } from './tenant-scope.js';
import type { Awaitable } from './types.js';

export function emptyAiAuthoringDocument(
  scope: ContentScope,
  timestamp = '1970-01-01T00:00:00.000Z',
): AiAuthoringDocument {
  return {
    ...scope,
    schemaVersion: 1,
    version: 0,
    state: 'disabled',
    actions: [],
    semantic: { enabled: false },
    proposals: [],
    updatedAt: timestamp,
  };
}

function writeConflict(): GridStoryError {
  return new GridStoryError(
    'AI authoring policy changed during this operation.',
    'ai_authoring_write_conflict',
    409,
  );
}

export interface AiAuthoringRepository {
  get(scope: ContentScope): Awaitable<AiAuthoringDocument | null>;
  save(document: AiAuthoringDocument, expectedVersion: number | null): Awaitable<void>;
  close(): Awaitable<void>;
}

export class InMemoryAiAuthoringRepository implements AiAuthoringRepository {
  readonly #documents = new Map<string, AiAuthoringDocument>();

  get(scope: ContentScope): AiAuthoringDocument | null {
    const document = this.#documents.get(contentScopeKey(scope));
    return document ? structuredClone(document) : null;
  }

  save(document: AiAuthoringDocument, expectedVersion: number | null): void {
    const parsed = aiAuthoringDocumentSchema.parse(document);
    const key = contentScopeKey(parsed);
    const current = this.#documents.get(key);
    if (expectedVersion === null ? current !== undefined : current?.version !== expectedVersion) {
      throw writeConflict();
    }
    this.#documents.set(key, structuredClone(parsed));
  }

  close(): void {}
}

interface PayloadRow {
  payload: string;
}

export class SqliteAiAuthoringRepository implements AiAuthoringRepository {
  readonly #database: DatabaseSync;

  constructor(options: { filename: string }) {
    this.#database = new DatabaseSync(options.filename);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS gridstory_ai_authoring_documents (
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
      CREATE INDEX IF NOT EXISTS idx_gridstory_ai_authoring_updated
        ON gridstory_ai_authoring_documents (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          updated_at DESC
        );
    `);
  }

  get(scope: ContentScope): AiAuthoringDocument | null {
    const row = this.#database
      .prepare('SELECT payload FROM gridstory_ai_authoring_documents WHERE scope_key = ?')
      .get(contentScopeKey(scope)) as unknown as PayloadRow | undefined;
    return row ? aiAuthoringDocumentSchema.parse(JSON.parse(row.payload)) : null;
  }

  save(document: AiAuthoringDocument, expectedVersion: number | null): void {
    const parsed = aiAuthoringDocumentSchema.parse(document);
    if (expectedVersion === null) {
      try {
        this.#database
          .prepare(
            `INSERT INTO gridstory_ai_authoring_documents (
               scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id,
               locale, version, updated_at, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
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
          );
        return;
      } catch (error) {
        if (String(error).includes('UNIQUE constraint failed')) throw writeConflict();
        throw error;
      }
    }
    const result = this.#database
      .prepare(
        `UPDATE gridstory_ai_authoring_documents
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

  close(): void {
    this.#database.close();
  }
}

export class PostgresAiAuthoringRepository implements AiAuthoringRepository {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #table: string;
  readonly #ready: Promise<unknown>;

  constructor(options: { connectionString?: string; pool?: Pool; schema?: string }) {
    const schema = options.schema ?? 'gridstory';
    if (!/^[a-z_][a-z0-9_]*$/iu.test(schema)) {
      throw new Error('PostgreSQL AI authoring schema name is invalid.');
    }
    if (!options.pool && !options.connectionString) {
      throw new Error('PostgreSQL AI authoring connectionString or pool is required.');
    }
    this.#pool =
      options.pool ?? new Pool({ connectionString: options.connectionString } as PoolConfig);
    this.#ownsPool = !options.pool;
    const quotedSchema = `"${schema}"`;
    this.#table = `${quotedSchema}.gridstory_ai_authoring_documents`;
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
      CREATE INDEX IF NOT EXISTS idx_gridstory_ai_authoring_updated
        ON ${this.#table} (
          organization_id, tenant_id, workspace_id, site_id, environment_id, locale,
          updated_at DESC
        );
    `);
  }

  async get(scope: ContentScope): Promise<AiAuthoringDocument | null> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      `SELECT payload FROM ${this.#table} WHERE scope_key = $1`,
      [contentScopeKey(scope)],
    );
    return result.rows[0] ? aiAuthoringDocumentSchema.parse(result.rows[0].payload) : null;
  }

  async save(document: AiAuthoringDocument, expectedVersion: number | null): Promise<void> {
    await this.#ready;
    const parsed = aiAuthoringDocumentSchema.parse(document);
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

  async close(): Promise<void> {
    await this.#ready;
    if (this.#ownsPool) await this.#pool.end();
  }
}
