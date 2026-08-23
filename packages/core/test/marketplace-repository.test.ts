import type { ContentScope } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  emptyMarketplaceDocument,
  InMemoryMarketplaceRepository,
  SqliteMarketplaceRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

describe('marketplace repositories', () => {
  it('enforces optimistic writes and exact scope in memory', () => {
    const repository = new InMemoryMarketplaceRepository();
    const document = emptyMarketplaceDocument(scope, '2026-08-23T12:00:00.000Z');
    document.version = 1;
    repository.save(document, null);
    expect(repository.get(scope)).toMatchObject({ version: 1, publishers: [], releases: [] });
    expect(() => repository.save({ ...document, version: 2 }, null)).toThrowError(
      expect.objectContaining({ code: 'marketplace_write_conflict' }),
    );
    expect(repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
  });

  it('persists the scoped document and conflicts in SQLite', () => {
    const repository = new SqliteMarketplaceRepository({ filename: ':memory:' });
    const document = emptyMarketplaceDocument(scope, '2026-08-23T12:00:00.000Z');
    document.version = 1;
    repository.save(document, null);
    repository.save({ ...document, version: 2, updatedAt: '2026-08-23T12:01:00.000Z' }, 1);
    expect(repository.get(scope)).toMatchObject({ version: 2 });
    expect(repository.listScopes()).toEqual([scope]);
    expect(() => repository.save({ ...document, version: 3 }, 1)).toThrowError(
      expect.objectContaining({ code: 'marketplace_write_conflict' }),
    );
    repository.close();
  });
});
