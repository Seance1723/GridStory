import { DatabaseSync } from 'node:sqlite';
import { contentScopeKey } from './tenant-scope.js';
import { Pool } from 'pg';
import {
  collaborationDocumentSchema,
  type CollaborationDocument,
  type ContentScope,
} from '@gridstory/schema';
import { GridStoryError } from './errors.js';
import type { Awaitable } from './types.js';

export interface CollaborationRepository {
  get(scope: ContentScope, entryId: string): Awaitable<CollaborationDocument | null>;
  save(document: CollaborationDocument, expectedVersion: number | null): Awaitable<void>;
  close(): Awaitable<void>;
}

function writeConflict(): GridStoryError {
  return new GridStoryError(
    'Collaboration state changed while this request was being applied.',
    'collaboration_write_conflict',
    409,
  );
}

export class InMemoryCollaborationRepository implements CollaborationRepository {
  readonly #documents = new Map<string, CollaborationDocument>();

  get(scope: ContentScope, entryId: string): CollaborationDocument | null {
    const document = this.#documents.get(`${contentScopeKey(scope)}\u001f${entryId}`);
    return document ? structuredClone(document) : null;
  }

  save(document: CollaborationDocument, expectedVersion: number | null): void {
    const parsed = collaborationDocumentSchema.parse(document);
    const key = `${contentScopeKey(parsed)}\u001f${parsed.entryId}`;
    const current = this.#documents.get(key);
    if (
      (expectedVersion === null && current) ||
      (expectedVersion !== null && current?.version !== expectedVersion)
    ) {
      throw writeConflict();
    }
    this.#documents.set(key, structuredClone(parsed));
  }

  close(): void {}
}

interface PayloadRow {
  payload: string;
}

export class SqliteCollaborationRepository implements CollaborationRepository {
  readonly #database: DatabaseSync;

  constructor(options: { filename: string }) {
    this.#database = new DatabaseSync(options.filename);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS gridstory_collaboration_documents (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 0),
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (scope_key, entry_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_gridstory_collaboration_scope_updated
        ON gridstory_collaboration_documents (scope_key, updated_at DESC, entry_id ASC);
    `);
  }

  get(scope: ContentScope, entryId: string): CollaborationDocument | null {
    const row = this.#database
      .prepare(
        'SELECT payload FROM gridstory_collaboration_documents WHERE scope_key = ? AND entry_id = ?',
      )
      .get(contentScopeKey(scope), entryId) as unknown as PayloadRow | undefined;
    return row ? collaborationDocumentSchema.parse(JSON.parse(row.payload)) : null;
  }

  save(document: CollaborationDocument, expectedVersion: number | null): void {
    const parsed = collaborationDocumentSchema.parse(document);
    if (expectedVersion === null) {
      try {
        this.#database
          .prepare(
            `INSERT INTO gridstory_collaboration_documents (
               scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id,
               locale, entry_id, version, updated_at, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            parsed.version,
            parsed.updatedAt,
            JSON.stringify(parsed),
          );
        return;
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
          throw writeConflict();
        }
        throw error;
      }
    }

    const result = this.#database
      .prepare(
        `UPDATE gridstory_collaboration_documents
         SET version = ?, updated_at = ?, payload = ?
         WHERE scope_key = ? AND entry_id = ? AND version = ?`,
      )
      .run(
        parsed.version,
        parsed.updatedAt,
        JSON.stringify(parsed),
        contentScopeKey(parsed),
        parsed.entryId,
        expectedVersion,
      );
    if (result.changes !== 1) throw writeConflict();
  }

  close(): void {
    this.#database.close();
  }
}

export class PostgresCollaborationRepository implements CollaborationRepository {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #table: string;
  readonly #ready: Promise<unknown>;

  constructor(options: { connectionString?: string; pool?: Pool; schema?: string }) {
    const schema = options.schema ?? 'gridstory';
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new Error('PostgreSQL collaboration schema name is invalid.');
    }
    if (!options.pool && !options.connectionString) {
      throw new Error('PostgreSQL collaboration connectionString or pool is required.');
    }
    this.#pool = options.pool ?? new Pool({ connectionString: options.connectionString });
    this.#ownsPool = !options.pool;
    const qualifiedSchema = `"${schema}"`;
    this.#table = `${qualifiedSchema}.gridstory_collaboration_documents`;
    this.#ready = this.#pool.query(`
      CREATE SCHEMA IF NOT EXISTS ${qualifiedSchema};
      CREATE TABLE IF NOT EXISTS ${this.#table} (
        scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 0),
        updated_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (scope_key, entry_id)
      );
      CREATE INDEX IF NOT EXISTS idx_gridstory_collaboration_scope_updated
        ON ${this.#table} (scope_key, updated_at DESC, entry_id ASC);
    `);
  }

  async get(scope: ContentScope, entryId: string): Promise<CollaborationDocument | null> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      `SELECT payload FROM ${this.#table} WHERE scope_key = $1 AND entry_id = $2`,
      [contentScopeKey(scope), entryId],
    );
    return result.rows[0] ? collaborationDocumentSchema.parse(result.rows[0].payload) : null;
  }

  async save(document: CollaborationDocument, expectedVersion: number | null): Promise<void> {
    await this.#ready;
    const parsed = collaborationDocumentSchema.parse(document);
    if (expectedVersion === null) {
      const result = await this.#pool.query(
        `INSERT INTO ${this.#table} (
           scope_key, organization_id, tenant_id, workspace_id, site_id, environment_id,
           locale, entry_id, version, updated_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         ON CONFLICT (scope_key, entry_id) DO NOTHING`,
        [
          contentScopeKey(parsed),
          parsed.organizationId,
          parsed.tenantId,
          parsed.workspaceId,
          parsed.siteId,
          parsed.environmentId,
          parsed.locale,
          parsed.entryId,
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
       WHERE scope_key = $4 AND entry_id = $5 AND version = $6`,
      [
        parsed.version,
        parsed.updatedAt,
        JSON.stringify(parsed),
        contentScopeKey(parsed),
        parsed.entryId,
        expectedVersion,
      ],
    );
    if (result.rowCount !== 1) throw writeConflict();
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }
}
