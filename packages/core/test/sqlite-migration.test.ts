import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentScope } from '@gridstory/schema';
import { SqliteContentRepository, verifyAuditEvents } from '../src/index.js';

const temporaryDirectories: string[] = [];
const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SQLite schema migration', () => {
  it('adds mandatory scope columns before creating the composite scope index', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-migration-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'legacy.db');
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        current_draft_revision_id TEXT,
        published_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const repository = new SqliteContentRepository({ filename });
    const created = repository.create({
      scope,
      contentType: 'legacy-test',
      data: { title: 'Migrated' },
      actor: { id: 'migration-test' },
    });
    expect(created).toMatchObject(scope);
    repository.close();
  });

  it('backfills deterministic sequence and hashes for legacy audit events', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-audit-migration-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'legacy-audit.db');
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE entries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        current_draft_revision_id TEXT,
        published_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      INSERT INTO entries (
        id, tenant_id, content_type, current_draft_revision_id,
        published_revision_id, created_at, updated_at
      ) VALUES (
        'legacy-entry', 'tenant-a', 'page', NULL, NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO audit_events VALUES (
        'audit-b', 'tenant-a', 'legacy-entry', 'legacy-author',
        'content.created', 'revision-a', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO audit_events VALUES (
        'audit-a', 'tenant-a', 'legacy-entry', 'legacy-editor',
        'content.draft.updated', 'revision-b', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const repository = new SqliteContentRepository({ filename });
    const events = repository.listScopeAuditEvents({
      scope: {
        organizationId: 'local',
        tenantId: 'tenant-a',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
      },
    });
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(verifyAuditEvents(events)).toMatchObject({ valid: true, eventCount: 2 });
    repository.close();
  });
});
