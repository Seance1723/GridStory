import { afterEach, describe, expect, it } from 'vitest';
import type { ContentSchemaDefinition } from '@gridstory/schema';
import { ContentService } from '../src/content-service.js';
import { ContentQueryService } from '../src/content-query.js';
import { GridStoryError } from '../src/errors.js';
import { SqliteContentRepository } from '../src/sqlite-repository.js';

const scope = {
  organizationId: 'acme',
  tenantId: 'tenant',
  workspaceId: 'website',
  siteId: 'main',
  environmentId: 'preview',
  locale: 'en',
};
const actor = { id: 'query-test' };
const querySchema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  objects: [
    {
      id: 'metadata',
      name: 'Metadata',
      description: '',
      fields: [
        {
          id: 'metadata.description',
          name: 'description',
          label: 'Description',
          required: true,
          value: { type: 'text' },
        },
        {
          id: 'metadata.featured',
          name: 'featured',
          label: 'Featured',
          required: true,
          value: { type: 'boolean' },
        },
        {
          id: 'metadata.weight',
          name: 'weight',
          label: 'Weight',
          required: true,
          value: { type: 'number' },
        },
      ],
    },
  ],
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    {
      id: 'page.metadata',
      name: 'metadata',
      label: 'Metadata',
      type: 'object',
      objectType: 'metadata',
      required: true,
    },
  ],
};

function page(title: string, slug: string, weight: number, featured = false) {
  return {
    title,
    slug,
    blocks: [],
    metadata: { description: `${title} description`, featured, weight },
  };
}

describe('ContentQueryService', () => {
  const repositories: SqliteContentRepository[] = [];

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      repository.close();
    });
  });

  it('filters, deterministically sorts, paginates, and projects nested content', async () => {
    const repository = new SqliteContentRepository({ filename: ':memory:' });
    repositories.push(repository);
    const content = new ContentService({
      repository,
      schemas: [querySchema],
      componentManifests: [],
    });
    const query = new ContentQueryService({
      repository,
      cursorSecret: 'query-test-secret-with-enough-entropy',
    });
    for (const [title, slug, weight, featured] of [
      ['Gamma', 'gamma', 30, true],
      ['Alpha', 'alpha', 10, true],
      ['Beta', 'beta', 20, false],
    ] as const) {
      await content.create({
        scope,
        contentType: 'page',
        data: page(title, slug, weight, featured),
        actor,
      });
    }

    const first = await query.query(scope, {
      contentType: 'page',
      filter: {
        and: [
          { path: 'data.metadata.featured', operator: 'eq', value: true },
          { path: 'data.title', operator: 'contains', value: 'a' },
        ],
      },
      sort: [{ path: 'data.metadata.weight', direction: 'asc' }],
      projection: ['data.title', 'data.metadata.weight'],
      first: 1,
    });
    expect(first.totalCount).toBe(2);
    expect(first.nodes).toHaveLength(1);
    expect(first.nodes[0]?.data).toEqual({ title: 'Alpha', metadata: { weight: 10 } });
    expect(first.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });

    const second = await query.query(scope, {
      contentType: 'page',
      filter: {
        and: [
          { path: 'data.metadata.featured', operator: 'eq', value: true },
          { path: 'data.title', operator: 'contains', value: 'a' },
        ],
      },
      sort: [{ path: 'data.metadata.weight', direction: 'asc' }],
      projection: ['data.title', 'data.metadata.weight'],
      first: 1,
      after: first.pageInfo.endCursor ?? undefined,
    });
    expect(second.nodes[0]?.data).toEqual({ title: 'Gamma', metadata: { weight: 30 } });
    expect(second.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
  });

  it('rejects cursor tampering, cross-query reuse, unsafe paths, and excessive page sizes', async () => {
    const repository = new SqliteContentRepository({ filename: ':memory:' });
    repositories.push(repository);
    const content = new ContentService({
      repository,
      schemas: [querySchema],
      componentManifests: [],
    });
    const query = new ContentQueryService({
      repository,
      cursorSecret: 'query-test-secret-with-enough-entropy',
    });
    await content.create({ scope, contentType: 'page', data: page('Alpha', 'alpha', 10), actor });
    const first = await query.query(scope, { first: 1 });
    const cursor = first.pageInfo.endCursor ?? '';

    await expect(query.query(scope, { first: 1, after: `${cursor}x` })).rejects.toMatchObject({
      code: 'invalid_query',
    });
    await expect(
      query.query(scope, {
        first: 1,
        after: cursor,
        filter: { path: 'data.title', operator: 'eq', value: 'Alpha' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_query' });
    await expect(
      query.query(scope, { filter: { path: 'data.__proto__.polluted', operator: 'exists' } }),
    ).rejects.toBeInstanceOf(GridStoryError);
    await expect(query.query(scope, { first: 101 })).rejects.toMatchObject({
      code: 'invalid_query',
    });
  });
});
