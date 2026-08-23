import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentScope } from '@gridstory/schema';
import {
  emptyMigrationDocument,
  InMemoryMigrationRepository,
  SqliteMigrationRepository,
} from '../src/index.js';

const directories: string[] = [];
const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'migration-shadow',
  locale: 'en',
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe.each([
  ['memory', () => new InMemoryMigrationRepository()],
  [
    'sqlite',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'gridstory-migration-repository-'));
      directories.push(directory);
      return new SqliteMigrationRepository({ filename: join(directory, 'migration.db') });
    },
  ],
])('MigrationRepository %s', (_name, createRepository) => {
  it('persists scoped optimistic documents and rejects stale writes', async () => {
    const repository = createRepository();
    try {
      const document = emptyMigrationDocument(scope, '2026-08-23T00:00:00.000Z');
      document.version = 1;
      await repository.save(document, null);
      const loaded = await repository.get(scope);
      expect(loaded).toMatchObject({ version: 1, tenantId: 'tenant-a' });
      const updated = structuredClone(loaded);
      if (!updated) throw new Error('Expected migration state.');
      updated.version = 2;
      updated.updatedAt = '2026-08-23T00:01:00.000Z';
      await repository.save(updated, 1);
      await expect(async () => await repository.save(updated, 1)).rejects.toMatchObject({
        code: 'migration_write_conflict',
      });
      expect(await repository.listScopes()).toEqual([scope]);
      expect(await repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
    } finally {
      await repository.close();
    }
  });
});

describe('SqliteMigrationRepository durability', () => {
  it('reopens the same scoped document', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-migration-reopen-'));
    directories.push(directory);
    const filename = join(directory, 'migration.db');
    const first = new SqliteMigrationRepository({ filename });
    const document = emptyMigrationDocument(scope, '2026-08-23T00:00:00.000Z');
    document.version = 1;
    await first.save(document, null);
    await first.close();
    const reopened = new SqliteMigrationRepository({ filename });
    try {
      expect(await reopened.get(scope)).toMatchObject({ version: 1 });
    } finally {
      await reopened.close();
    }
  });
});
