import type { ContentScope } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  emptyPersonalizationDocument,
  InMemoryPersonalizationRepository,
  SqlitePersonalizationRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

describe('personalization repositories', () => {
  it('enforces optimistic complete-scope writes in memory', () => {
    const repository = new InMemoryPersonalizationRepository();
    const document = emptyPersonalizationDocument(scope, 'author-a', '2026-08-23T12:00:00.000Z');
    document.version = 1;
    repository.save(document, null);
    expect(repository.get(scope)).toMatchObject({ version: 1, draft: { revision: 1 } });
    expect(repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
    expect(() => repository.save({ ...document, version: 2 }, null)).toThrowError(
      expect.objectContaining({ code: 'personalization_write_conflict' }),
    );
  });

  it('persists draft and published snapshots with conflicts in SQLite', () => {
    const repository = new SqlitePersonalizationRepository({ filename: ':memory:' });
    const document = emptyPersonalizationDocument(scope, 'author-a', '2026-08-23T12:00:00.000Z');
    document.version = 1;
    repository.save(document, null);
    const published = {
      ...document,
      version: 2,
      published: {
        ...document.draft,
        publishedAt: '2026-08-23T12:01:00.000Z',
        publishedBy: 'publisher-a',
      },
      updatedAt: '2026-08-23T12:01:00.000Z',
    };
    repository.save(published, 1);
    expect(repository.get(scope)).toEqual(published);
    expect(repository.listScopes()).toEqual([scope]);
    expect(() => repository.save({ ...document, version: 3 }, 1)).toThrowError(
      expect.objectContaining({ code: 'personalization_write_conflict' }),
    );
    repository.close();
  });
});
