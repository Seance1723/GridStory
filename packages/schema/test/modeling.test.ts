import { describe, expect, it } from 'vitest';
import {
  RedirectResolver,
  buildContentRoute,
  contentSchemaDefinitionSchema,
  validateContent,
  type ContentReference,
} from '../src/index.js';
import {
  defineContentSchema,
  generateTypeScriptContracts,
  type ContentDataOf,
} from '../src/typegen.js';

const articleSchema = defineContentSchema({
  id: 'article',
  version: 1,
  name: 'Article',
  description: 'Advanced modeling fixture',
  collection: 'articles',
  titleField: 'title',
  route: { pattern: '/articles/:slug', slugField: 'slug' },
  objects: [
    {
      id: 'seo',
      name: 'SEO metadata',
      description: '',
      fields: [
        {
          id: 'seo.title',
          name: 'title',
          label: 'SEO title',
          required: true,
          value: { type: 'text', maxLength: 60 },
        },
      ],
    },
    {
      id: 'author',
      name: 'Author',
      description: '',
      fields: [
        {
          id: 'author.name',
          name: 'name',
          label: 'Name',
          required: true,
          value: { type: 'text' },
        },
      ],
    },
    {
      id: 'call-to-action',
      name: 'Call to action',
      description: '',
      fields: [
        {
          id: 'cta.label',
          name: 'label',
          label: 'Label',
          required: true,
          value: { type: 'text' },
        },
      ],
    },
  ],
  taxonomies: [
    {
      id: 'topics',
      name: 'Topics',
      hierarchical: true,
      terms: [
        { id: 'engineering', slug: 'engineering', label: 'Engineering' },
        { id: 'react', slug: 'react', label: 'React', parentId: 'engineering' },
      ],
    },
  ],
  fields: [
    { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    {
      id: 'article.reading-time',
      name: 'readingTime',
      label: 'Reading time',
      type: 'number',
      minimum: 1,
    },
    { id: 'article.featured', name: 'featured', label: 'Featured', type: 'boolean' },
    {
      id: 'article.seo',
      name: 'seo',
      label: 'SEO',
      type: 'object',
      objectType: 'seo',
      required: true,
    },
    {
      id: 'article.authors',
      name: 'authors',
      label: 'Authors',
      type: 'array',
      minimum: 1,
      items: { type: 'object', objectType: 'author' },
    },
    {
      id: 'article.promotion',
      name: 'promotion',
      label: 'Promotion',
      type: 'union',
      discriminator: 'kind',
      variants: [{ id: 'cta', label: 'Call to action', objectType: 'call-to-action' }],
    },
    {
      id: 'article.related',
      name: 'related',
      label: 'Related content',
      type: 'relation',
      targets: ['article', 'page'],
      multiple: true,
      maximum: 3,
    },
    {
      id: 'article.topics',
      name: 'topics',
      label: 'Topics',
      type: 'taxonomy',
      taxonomy: 'topics',
      multiple: true,
      minimum: 1,
    },
  ],
});

const related: ContentReference = { id: 'related-1', contentType: 'article' };
const validArticle: ContentDataOf<typeof articleSchema> = {
  title: 'Advanced content',
  slug: 'advanced-content',
  readingTime: 8,
  featured: true,
  seo: { title: 'Advanced React CMS content' },
  authors: [{ name: 'Rupak' }],
  promotion: { kind: 'cta', value: { label: 'Read more' } },
  related: [related],
  topics: ['react'],
};

describe('advanced content modeling', () => {
  it('validates reusable objects, arrays, unions, relations, and hierarchical taxonomy terms', () => {
    expect(validateContent(articleSchema, validArticle)).toEqual({ valid: true, issues: [] });

    const invalid = validateContent(articleSchema, {
      ...validArticle,
      seo: {},
      related: [{ id: 'wrong', contentType: 'asset' }],
      topics: ['unknown'],
      promotion: { kind: 'banner', value: {} },
    });
    expect(invalid.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['required', 'invalid_reference', 'invalid_term', 'invalid_union']),
    );
  });

  it('generates reusable object, array, union, relation, and taxonomy types', () => {
    const output = generateTypeScriptContracts([articleSchema], []);
    expect(output).toContain('export interface ArticleSeoObject');
    expect(output).toContain('authors?: Array<ArticleAuthorObject>;');
    expect(output).toContain('related?: ContentReference[];');
    expect(output).toContain('topics?: string[];');
    expect(output).toContain("kind: 'cta'");
  });

  it('builds canonical routes and resolves redirect chains without permitting cycles', () => {
    expect(buildContentRoute(articleSchema, validArticle)).toBe('/articles/advanced-content');
    const resolver = new RedirectResolver([
      { from: '/old-article/', to: '/articles/legacy', status: 301 },
      { from: '/articles/legacy', to: '/articles/advanced-content', status: 308 },
    ]);
    expect(resolver.resolve('/old-article?campaign=1')).toEqual({
      from: '/old-article',
      to: '/articles/advanced-content',
      status: 301,
      chain: ['/old-article', '/articles/legacy', '/articles/advanced-content'],
    });
    expect(
      () =>
        new RedirectResolver([
          { from: '/a', to: '/b', status: 308 },
          { from: '/b', to: '/a', status: 308 },
        ]),
    ).toThrow(/cycle/i);
  });

  it('rejects invalid object references, route fields, and taxonomy cycles in the model itself', () => {
    const result = contentSchemaDefinitionSchema.safeParse({
      ...articleSchema,
      route: { pattern: '/articles/:missing', slugField: 'missing' },
      fields: [
        ...articleSchema.fields,
        {
          id: 'article.bad-object',
          name: 'badObject',
          label: 'Bad',
          type: 'object',
          objectType: 'missing',
        },
      ],
      taxonomies: [
        {
          id: 'cyclic',
          name: 'Cyclic',
          hierarchical: true,
          terms: [
            { id: 'a', slug: 'a', label: 'A', parentId: 'b' },
            { id: 'b', slug: 'b', label: 'B', parentId: 'a' },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(' ')).toMatch(
        /not declared|slugField|cycle/i,
      );
    }
  });
});
