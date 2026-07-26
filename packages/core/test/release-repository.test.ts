import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentScope, Release } from '@gridstory/schema';
import { SqliteReleaseRepository } from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

const release: Release = {
  ...scope,
  id: 'release-1',
  name: 'Launch',
  state: 'validated',
  entries: [
    {
      entryId: 'entry-1',
      revisionId: 'revision-1',
      contentType: 'page',
      previousPublishedRevisionId: 'published-1',
    },
    {
      entryId: 'entry-2',
      revisionId: 'revision-2',
      contentType: 'page',
      previousPublishedRevisionId: 'published-2',
    },
  ],
  rollbackPolicy: { mode: 'manual' },
  validation: { valid: true, checkedAt: '2026-07-26T00:00:00.000Z', issues: [] },
  createdBy: 'publisher-a',
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
};

describe('SqliteReleaseRepository', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists release payloads and isolates the complete tenant scope', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-release-'));
    directories.push(directory);
    const filename = join(directory, 'release.db');
    const first = new SqliteReleaseRepository({ filename });
    first.save(release);
    first.close();

    const reopened = new SqliteReleaseRepository({ filename });
    try {
      expect(reopened.get(scope, release.id)).toMatchObject({
        id: release.id,
        state: 'validated',
        entries: release.entries,
      });
      expect(reopened.get({ ...scope, tenantId: 'tenant-b' }, release.id)).toBeNull();
      expect(reopened.list(scope)).toHaveLength(1);
    } finally {
      reopened.close();
    }
  });
});
