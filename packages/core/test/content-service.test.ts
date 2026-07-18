import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ComponentManifest, ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import {
  ConflictError,
  ContentService,
  SqliteContentRepository,
  type ContentRepository,
} from '../src/index.js';

const schema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    {
      id: 'page.slug',
      name: 'slug',
      label: 'Slug',
      type: 'slug',
      required: true,
      pattern: '^[a-z0-9-]+$',
    },
    {
      id: 'page.blocks',
      name: 'blocks',
      label: 'Blocks',
      type: 'component-tree',
      required: true,
      minimum: 1,
      accepts: ['hero'],
    },
  ],
};
const manifest: ComponentManifest = {
  id: 'hero',
  version: 1,
  name: 'Hero',
  description: '',
  category: 'Marketing',
  strictProps: true,
  slots: [],
  props: [{ id: 'hero.heading', name: 'heading', label: 'Heading', type: 'text', required: true }],
};
const relatedArticleSchema: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  description: '',
  collection: 'articles',
  titleField: 'title',
  fields: [
    { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
    {
      id: 'article.related-page',
      name: 'relatedPage',
      label: 'Related page',
      type: 'relation',
      required: true,
      targets: ['page'],
    },
  ],
};

function page(title: string) {
  return {
    title,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    blocks: [{ id: 'hero-1', component: 'hero', version: 1, props: { heading: title } }],
  };
}

function scope(tenantId: string, overrides: Partial<ContentScope> = {}): ContentScope {
  return {
    organizationId: 'organization-a',
    tenantId,
    workspaceId: 'workspace-a',
    siteId: 'site-a',
    environmentId: 'development',
    locale: 'en',
    ...overrides,
  };
}

describe('ContentService', () => {
  let repository: ContentRepository;
  let service: ContentService;
  const actor = { id: 'test-user' };

  beforeEach(() => {
    repository = new SqliteContentRepository({ filename: ':memory:' });
    service = new ContentService({
      repository,
      schemas: [schema, relatedArticleSchema],
      componentManifests: [manifest],
    });
  });

  afterEach(async () => await repository.close());

  it('creates immutable drafts, publishes a revision, and preserves published content', async () => {
    const created = await service.create({
      scope: scope('tenant-a'),
      contentType: 'page',
      data: page('First'),
      actor,
    });
    expect(created.status).toBe('draft');

    const updated = await service.updateDraft({
      scope: scope('tenant-a'),
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      data: page('Published'),
      actor,
    });
    const published = await service.publish({
      scope: scope('tenant-a'),
      id: created.id,
      expectedRevisionId: updated.draftRevisionId,
      actor,
    });
    expect(published.status).toBe('published');

    const changed = await service.updateDraft({
      scope: scope('tenant-a'),
      id: created.id,
      expectedRevisionId: published.draftRevisionId,
      data: page('Future'),
      actor,
    });
    expect(changed.status).toBe('changed');
    expect(
      (
        await service.get({
          scope: scope('tenant-a'),
          id: created.id,
          perspective: 'published',
        })
      ).data.title,
    ).toBe('Published');
    expect(await service.listRevisions({ scope: scope('tenant-a'), id: created.id })).toHaveLength(
      3,
    );
    expect(
      await repository.listAuditEvents({ scope: scope('tenant-a'), id: created.id }),
    ).toHaveLength(4);
  });

  it('rejects a stale revision instead of overwriting another edit', async () => {
    const created = await service.create({
      scope: scope('tenant-a'),
      contentType: 'page',
      data: page('First'),
      actor,
    });
    await service.updateDraft({
      scope: scope('tenant-a'),
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      data: page('Second'),
      actor,
    });

    await expect(
      service.updateDraft({
        scope: scope('tenant-a'),
        id: created.id,
        expectedRevisionId: created.draftRevisionId,
        data: page('Stale'),
        actor,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('isolates entries by tenant', async () => {
    const created = await service.create({
      scope: scope('tenant-a'),
      contentType: 'page',
      data: page('Private'),
      actor,
    });
    expect(await service.list({ scope: scope('tenant-b') })).toEqual([]);
    expect(await service.list({ scope: scope('tenant-a', { siteId: 'site-b' }) })).toEqual([]);
    await expect(service.get({ scope: scope('tenant-b'), id: created.id })).rejects.toThrow();
  });

  it('accepts only relations that resolve to the declared type inside the active scope', async () => {
    const target = await service.create({
      scope: scope('tenant-a'),
      contentType: 'page',
      data: page('Target'),
      actor,
    });
    const article = await service.create({
      scope: scope('tenant-a'),
      contentType: 'article',
      data: { title: 'Related article', relatedPage: { id: target.id, contentType: 'page' } },
      actor,
    });
    expect(article.data.relatedPage).toEqual({ id: target.id, contentType: 'page' });

    await expect(
      service.create({
        scope: scope('tenant-a', { siteId: 'site-b' }),
        contentType: 'article',
        data: { title: 'Leaking article', relatedPage: { id: target.id, contentType: 'page' } },
        actor,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
