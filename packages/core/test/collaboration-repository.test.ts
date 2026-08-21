import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentScope } from '@gridstory/schema';
import {
  CollaborationService,
  SqliteCollaborationRepository,
  type GridStoryError,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

describe('SqliteCollaborationRepository', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists comments and causal operations while isolating the complete tenant scope', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-collaboration-'));
    directories.push(directory);
    const filename = join(directory, 'collaboration.db');
    const firstRepository = new SqliteCollaborationRepository({ filename });
    const first = new CollaborationService({ repository: firstRepository });
    try {
      await first.createThread({
        scope,
        target: { entryId: 'entry-1', field: 'title' },
        actorId: 'author',
        body: 'Persist this discussion.',
      });
      await first.submitOperation({
        scope,
        entryId: 'entry-1',
        actorId: 'author',
        operation: { id: 'operation-1', target: { field: 'title' }, value: 'Durable title' },
      });
    } finally {
      await first.close();
    }

    const reopenedRepository = new SqliteCollaborationRepository({ filename });
    const reopened = new CollaborationService({ repository: reopenedRepository });
    try {
      const snapshot = await reopened.snapshot(scope, 'entry-1');
      expect(snapshot).toMatchObject({
        version: 2,
        threads: [{ messages: [{ body: 'Persist this discussion.' }] }],
        operations: [{ id: 'operation-1', value: 'Durable title' }],
      });
      expect(await reopened.snapshot({ ...scope, tenantId: 'tenant-b' }, 'entry-1')).toMatchObject({
        version: 0,
        threads: [],
        operations: [],
      });

      const document = reopenedRepository.get(scope, 'entry-1');
      expect(document).not.toBeNull();
      if (!document) throw new Error('Expected a persisted collaboration document.');
      expect(() =>
        reopenedRepository.save(
          { ...document, version: document.version + 1 },
          document.version - 1,
        ),
      ).toThrowError(
        expect.objectContaining<Partial<GridStoryError>>({
          code: 'collaboration_write_conflict',
          statusCode: 409,
        }),
      );
    } finally {
      await reopened.close();
    }
  });
});
