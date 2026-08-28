import type { ContentSchemaDefinition, StudioContext } from '@gridstory/schema';
import { describe, expect, it, vi } from 'vitest';
import {
  buildContentListQuery,
  contentListScopeKey,
  defaultContentListView,
  loadContentListViews,
  removeContentListView,
  saveContentListView,
} from '../src/content-list.js';

const schema: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  collection: 'articles',
  titleField: 'headline',
  fields: [
    { id: 'article.headline', name: 'headline', label: 'Headline', type: 'text' },
    { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug' },
  ],
};

const scope: StudioContext['scope'] = {
  organizationId: 'org',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'development',
  locale: 'en',
};

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('content list queries and local views', () => {
  it('builds only supported search, status, sort, and cursor query fields', () => {
    expect(
      buildContentListQuery({
        contentType: 'article',
        schema,
        view: { search: 'Launch', status: 'changed', sort: 'title-asc' },
        after: 'opaque-cursor',
      }),
    ).toEqual({
      contentType: 'article',
      perspective: 'draft',
      first: 10,
      after: 'opaque-cursor',
      filter: {
        and: [
          {
            or: [
              {
                path: 'data.headline',
                operator: 'contains',
                value: 'Launch',
                caseSensitive: false,
              },
              {
                path: 'data.slug',
                operator: 'contains',
                value: 'Launch',
                caseSensitive: false,
              },
            ],
          },
          { path: 'status', operator: 'eq', value: 'changed' },
        ],
      },
      sort: [{ path: 'data.headline', direction: 'asc', nulls: 'last' }],
    });
  });

  it('versions and isolates saved views by verified scope and content type', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const storage = memoryStorage();
    const scopeKey = contentListScopeKey(scope);
    const saved = saveContentListView(storage, scopeKey, {
      name: 'Changed launches',
      contentType: 'article',
      search: 'Launch',
      status: 'changed',
      sort: 'updated-desc',
    });
    expect(saved).toEqual([
      {
        version: 1,
        id: 'view-ya',
        name: 'Changed launches',
        contentType: 'article',
        search: 'Launch',
        status: 'changed',
        sort: 'updated-desc',
      },
    ]);
    expect(loadContentListViews(storage, scopeKey, 'page')).toEqual([]);
    const savedView = saved[0];
    if (!savedView) throw new Error('Expected the local view fixture to be saved.');
    expect(removeContentListView(storage, scopeKey, savedView.id, 'article')).toEqual([]);
  });

  it('ignores malformed or differently versioned local state', () => {
    const storage = {
      getItem: () => JSON.stringify({ version: 2, scopes: { anything: [defaultContentListView] } }),
    };
    expect(loadContentListViews(storage, contentListScopeKey(scope), 'article')).toEqual([]);
  });
});
