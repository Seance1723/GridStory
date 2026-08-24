import type { ContentScope } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  emptyAiAuthoringDocument,
  InMemoryAiAuthoringRepository,
  SqliteAiAuthoringRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('AI authoring repositories', () => {
  it('enforces complete-scope optimistic writes in memory', () => {
    const repository = new InMemoryAiAuthoringRepository();
    const document = emptyAiAuthoringDocument(scope, '2026-08-24T08:00:00.000Z');
    repository.save(document, null);

    expect(repository.get(scope)).toMatchObject({ version: 0, state: 'disabled' });
    expect(repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
    expect(() => repository.save({ ...document, version: 1 }, null)).toThrowError(
      expect.objectContaining({ code: 'ai_authoring_write_conflict' }),
    );
  });

  it('persists bounded documents and conflicts in SQLite', () => {
    const repository = new SqliteAiAuthoringRepository({ filename: ':memory:' });
    const document = emptyAiAuthoringDocument(scope, '2026-08-24T08:00:00.000Z');
    repository.save(document, null);
    const updated = {
      ...document,
      version: 1,
      state: 'enabled' as const,
      actions: [
        {
          id: 'title',
          name: 'Title',
          enabled: true,
          promptId: 'summary',
          contentType: 'page',
          targetFields: ['title'],
          maximumChanges: 1,
          evaluationRules: [],
        },
      ],
      updatedAt: '2026-08-24T08:01:00.000Z',
    };
    repository.save(updated, 0);

    expect(repository.get(scope)).toEqual(updated);
    expect(() => repository.save({ ...updated, version: 2 }, 0)).toThrowError(
      expect.objectContaining({ code: 'ai_authoring_write_conflict' }),
    );
    repository.close();
  });
});
