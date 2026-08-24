import type { ContentScope } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  emptyAnalyticsDocument,
  InMemoryAnalyticsRepository,
  SqliteAnalyticsRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('analytics repositories', () => {
  it('enforces optimistic complete-scope writes in memory', () => {
    const repository = new InMemoryAnalyticsRepository();
    const document = emptyAnalyticsDocument(scope, '2026-08-24T08:00:00.000Z');
    repository.save(document, null);

    expect(repository.get(scope)).toMatchObject({
      version: 1,
      eventCounts: { 'content.viewed': 0 },
    });
    expect(repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
    expect(() => repository.save({ ...document, version: 2 }, null)).toThrowError(
      expect.objectContaining({ code: 'analytics_write_conflict' }),
    );
  });

  it('persists aggregate documents and conflicts in SQLite', () => {
    const repository = new SqliteAnalyticsRepository({ filename: ':memory:' });
    const document = emptyAnalyticsDocument(scope, '2026-08-24T08:00:00.000Z');
    repository.save(document, null);
    const updated = {
      ...document,
      version: 2,
      eventCounts: { ...document.eventCounts, 'content.viewed': 1 },
      updatedAt: '2026-08-24T08:01:00.000Z',
    };
    repository.save(updated, 1);

    expect(repository.get(scope)).toEqual(updated);
    expect(() => repository.save({ ...updated, version: 3 }, 1)).toThrowError(
      expect.objectContaining({ code: 'analytics_write_conflict' }),
    );
    repository.close();
  });
});
