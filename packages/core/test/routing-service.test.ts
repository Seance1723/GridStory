import type { ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContentRoutingService,
  ContentService,
  SqliteContentRepository,
  type ContentRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'route-org',
  tenantId: 'route-tenant',
  workspaceId: 'route-workspace',
  siteId: 'route-site',
  environmentId: 'production',
  locale: 'en',
};
const schema: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  collection: 'articles',
  titleField: 'title',
  route: { pattern: '/articles/:slug', slugField: 'slug' },
  fields: [
    { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
  ],
};

describe('ContentRoutingService', () => {
  let repository: ContentRepository;
  let content: ContentService;

  beforeEach(() => {
    repository = new SqliteContentRepository({ filename: ':memory:' });
    content = new ContentService({ repository, schemas: [schema], componentManifests: [] });
  });

  afterEach(async () => await repository.close());

  it('resolves published content and rejects canonical route collisions before publication', async () => {
    const first = await content.create({
      scope,
      contentType: 'article',
      data: { title: 'First', slug: 'shared' },
      actor: { id: 'route-test' },
    });
    await content.publish({
      scope,
      id: first.id,
      expectedRevisionId: first.draftRevisionId,
      actor: { id: 'route-test' },
    });
    const routing = new ContentRoutingService({ contentService: content });
    expect(await routing.resolve(scope, '/articles/shared/')).toMatchObject({
      kind: 'content',
      entry: { id: first.id },
    });

    const second = await content.create({
      scope,
      contentType: 'article',
      data: { title: 'Second', slug: 'shared' },
      actor: { id: 'route-test' },
    });
    await expect(
      content.publish({
        scope,
        id: second.id,
        expectedRevisionId: second.draftRevisionId,
        actor: { id: 'route-test' },
      }),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
    });
  });
});
