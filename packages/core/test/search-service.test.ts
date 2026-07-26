import type { ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ContentService,
  OperationsService,
  SearchService,
  SqliteContentRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

const schema: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  description: '',
  collection: 'articles',
  titleField: 'title',
  taxonomies: [
    {
      id: 'topics',
      name: 'Topics',
      hierarchical: true,
      terms: [
        { id: 'product', slug: 'product', label: 'Product' },
        { id: 'launch', slug: 'launch', label: 'Launch', parentId: 'product' },
      ],
    },
  ],
  fields: [
    { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    {
      id: 'article.topic',
      name: 'topic',
      label: 'Topic',
      type: 'taxonomy',
      taxonomy: 'topics',
      required: true,
    },
    {
      id: 'article.related',
      name: 'related',
      label: 'Related',
      type: 'relation',
      targets: ['article'],
      required: false,
    },
  ],
};

const actor = { id: 'editor-a', roles: ['admin'] };

describe('SearchService', () => {
  const repositories: SqliteContentRepository[] = [];
  afterEach(() =>
    repositories.splice(0).forEach((repository) => {
      repository.close();
    }),
  );

  it('searches taxonomies, derives backlinks and related content, and runs durable rebuild/index jobs', async () => {
    const repository = new SqliteContentRepository({ filename: ':memory:' });
    repositories.push(repository);
    const content = new ContentService({ repository, schemas: [schema], componentManifests: [] });
    const target = await content.create({
      scope,
      contentType: 'article',
      data: { title: 'Launch plan', slug: 'launch-plan', topic: 'launch' },
      actor,
    });
    await content.publish({
      scope,
      id: target.id,
      expectedRevisionId: target.draftRevisionId,
      actor,
    });
    const source = await content.create({
      scope,
      contentType: 'article',
      data: {
        title: 'Product notes',
        slug: 'product-notes',
        topic: 'product',
        related: { id: target.id, contentType: 'article' },
      },
      actor,
    });
    await content.publish({
      scope,
      id: source.id,
      expectedRevisionId: source.draftRevisionId,
      actor,
    });

    const search = new SearchService({
      repository,
      schemas: [schema],
      createId: () => 'rebuild-1',
    });
    const result = await search.search(scope, {
      text: 'launch',
      perspective: 'published',
      contentTypes: [],
      taxonomies: { topics: ['launch'] },
      first: 20,
    });
    expect(result.total).toBe(1);
    expect(result.hits[0]?.entry.id).toBe(target.id);
    expect(result.facets[0]).toMatchObject({ taxonomyId: 'topics', label: 'Topics' });

    const backlinks = await search.backlinks(scope, target.id);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0]).toMatchObject({ source: { id: source.id }, paths: [['related']] });
    expect(await search.related(scope, target.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entry: expect.objectContaining({ id: source.id }), score: 5 }),
      ]),
    );

    const rebuild = await search.requestRebuild(scope);
    expect(rebuild).toMatchObject({ type: 'search.rebuild', state: 'pending' });
    const operations = new OperationsService({
      repository,
      webhookSigningSecret: 'search-test-secret-with-at-least-32-characters',
      searchJobRunner: (job) => search.processJob(job),
    });
    const drained = await operations.drain({ scope, workerId: 'search-worker', limit: 100 });
    expect(drained.completedOutbox).toBe(4);
    expect(drained.completedJobs).toBeGreaterThanOrEqual(9);
    expect(await search.status(scope)).toMatchObject({
      adapter: 'repository-scan',
      state: 'ready',
      draftDocuments: 2,
      publishedDocuments: 2,
      pendingJobs: 0,
      deadJobs: 0,
    });

    const neighboring = await search.search(
      { ...scope, tenantId: 'tenant-b' },
      { text: 'launch', perspective: 'published', contentTypes: [], taxonomies: {}, first: 20 },
    );
    expect(neighboring.total).toBe(0);
  });
});
