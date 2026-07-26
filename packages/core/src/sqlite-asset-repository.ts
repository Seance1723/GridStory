import { DatabaseSync } from 'node:sqlite';
import { contentScopeKey } from './tenant-scope.js';
import { assetRecordSchema, type AssetRecord, type ContentScope } from '@gridstory/schema';
import type { AssetRepository } from './asset-service.js';

export interface SqliteAssetRepositoryOptions {
  filename: string;
}

interface AssetRow {
  payload: string;
}

export class SqliteAssetRepository implements AssetRepository {
  readonly #database: DatabaseSync;

  constructor(options: SqliteAssetRepositoryOptions) {
    this.#database = new DatabaseSync(options.filename);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS gridstory_assets (
        scope_key TEXT NOT NULL,
        id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (scope_key, id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_gridstory_assets_scope_updated
        ON gridstory_assets (scope_key, updated_at DESC, id ASC);
    `);
  }

  list(scope: ContentScope): AssetRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT payload FROM gridstory_assets
         WHERE scope_key = ?
         ORDER BY updated_at DESC, id ASC`,
      )
      .all(contentScopeKey(scope)) as unknown as AssetRow[];
    return rows.map((row) => assetRecordSchema.parse(JSON.parse(row.payload)));
  }

  get(scope: ContentScope, id: string): AssetRecord | null {
    const row = this.#database
      .prepare('SELECT payload FROM gridstory_assets WHERE scope_key = ? AND id = ?')
      .get(contentScopeKey(scope), id) as unknown as AssetRow | undefined;
    return row ? assetRecordSchema.parse(JSON.parse(row.payload)) : null;
  }

  save(asset: AssetRecord): void {
    const parsed = assetRecordSchema.parse(asset);
    this.#database
      .prepare(
        `INSERT INTO gridstory_assets (scope_key, id, updated_at, payload)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_key, id) DO UPDATE SET
           updated_at = excluded.updated_at,
           payload = excluded.payload`,
      )
      .run(contentScopeKey(parsed), parsed.id, parsed.updatedAt, JSON.stringify(parsed));
  }

  close(): void {
    this.#database.close();
  }
}
