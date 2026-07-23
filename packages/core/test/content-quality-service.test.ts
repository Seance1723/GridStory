import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import {
  ContentQualityService,
  ContentService,
  type PublishQualityGateError,
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
  route: { pattern: '/:slug', slugField: 'slug' },
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    { id: 'page.story', name: 'story', label: 'Story', type: 'rich-text' },
    {
      id: 'page.image',
      name: 'image',
      label: 'Image',
      type: 'asset',
      accepts: ['image'],
      requiredAlt: false,
    },
    {
      id: 'page.related',
      name: 'related',
      label: 'Related',
      type: 'relation',
      targets: ['page'],
      multiple: true,
    },
  ],
};

const testScope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

function data(title: string, related: Array<{ id: string; contentType: string }> = []) {
  return {
    title,
    slug: title.toLowerCase().replaceAll(' ', '-'),
    image: {
      id: 'asset-1',
      kind: 'image',
      url: 'https://assets.example.test/hero.jpg',
      title: 'Hero',
      alt: '',
    },
    related,
    story: {
      version: 1,
      blocks: [
        {
          id: 'heading',
          type: 'heading',
          level: 4,
          content: [{ type: 'text', text: 'Deep heading', marks: [] }],
        },
        {
          id: 'link',
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Click here',
              marks: [{ type: 'link', href: 'https://broken.example.test' }],
            },
          ],
        },
        {
          id: 'table',
          type: 'table',
          rows: [[[{ type: 'text', text: 'Value', marks: [] }]]],
        },
      ],
    },
  };
}

const policy = {
  id: 'page-web-v1',
  contentType: 'page',
  channels: ['web'],
  bypassRoles: ['quality-admin'],
  seo: { titleMinLength: 15, titleMaxLength: 60, requireCanonicalRoute: true },
  accessibility: {
    requireImageAlt: true,
    rejectGenericLinkText: true,
    enforceHeadingOrder: true,
    requireTableHeader: true,
  },
  links: { requirePublishedReferences: true, checkExternal: true },
  content: {
    minWords: 30,
    requiredPhrases: ['approved phrase'],
    prohibitedPhrases: ['deep heading'],
  },
  gate: { blockedSeverities: ['error'], minimumScore: 60 },
} as const;

describe('ContentQualityService', () => {
  let repository: ContentRepository;

  beforeEach(() => {
    repository = new SqliteContentRepository({ filename: ':memory:' });
  });

  afterEach(async () => repository.close());

  it('returns explainable SEO, accessibility, link, and content findings with stable paths', async () => {
    const base = new ContentService({ repository, schemas: [schema], componentManifests: [] });
    const target = await base.create({
      scope: testScope,
      contentType: 'page',
      data: data('Target page'),
      actor: { id: 'author' },
    });
    const entry = await base.create({
      scope: testScope,
      contentType: 'page',
      data: data('Short', [{ id: target.id, contentType: 'page' }]),
      actor: { id: 'author' },
    });
    const check = vi.fn(async () => ({ ok: false, status: 404 }));
    const quality = new ContentQualityService({
      repository,
      schemas: [schema],
      policies: [policy],
      externalLinkChecker: { check },
    });

    const first = await quality.assess({ scope: testScope, entry });
    const second = await quality.assess({ scope: testScope, entry });

    expect(first.passed).toBe(false);
    expect(first.score).toBeLessThan(60);
    expect(new Set(first.findings.map((finding) => finding.category))).toEqual(
      new Set(['seo', 'accessibility', 'links', 'content']),
    );
    expect(first.findings).toEqual(second.findings);
    expect(first.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'image_alt_missing', path: ['image', 'alt'] }),
        expect.objectContaining({ code: 'reference_not_published', path: ['related', 0] }),
        expect.objectContaining({ code: 'external_link_broken', severity: 'error' }),
        expect.objectContaining({ code: 'heading_order_skipped', severity: 'warning' }),
        expect.objectContaining({ code: 'table_header_missing', severity: 'warning' }),
      ]),
    );
    expect(check).toHaveBeenCalledWith('https://broken.example.test');
  });

  it('blocks publication before repository mutation and supports an explicit role bypass', async () => {
    const quality = new ContentQualityService({
      repository,
      schemas: [schema],
      policies: [policy],
    });
    const service = new ContentService({
      repository,
      schemas: [schema],
      componentManifests: [],
      qualityGate: quality,
    });
    const entry = await service.create({
      scope: testScope,
      contentType: 'page',
      data: data('Blocked page'),
      actor: { id: 'author' },
    });

    await expect(
      service.publish({
        scope: testScope,
        id: entry.id,
        expectedRevisionId: entry.draftRevisionId,
        actor: { id: 'author' },
      }),
    ).rejects.toMatchObject({
      code: 'publish_quality_gate_failed',
      statusCode: 422,
      report: expect.objectContaining({ passed: false }),
    } satisfies Partial<PublishQualityGateError>);
    expect(
      await repository.getById({ scope: testScope, id: entry.id, perspective: 'published' }),
    ).toBeNull();

    const published = await service.publish({
      scope: testScope,
      id: entry.id,
      expectedRevisionId: entry.draftRevisionId,
      actor: { id: 'administrator', roles: ['quality-admin'] },
    });
    expect(published.status).toBe('published');
  });
});
