import { afterEach, describe, expect, it } from 'vitest';
import type { ContentSchemaDefinition, ContentScope, LocaleConfiguration } from '@gridstory/schema';
import {
  ContentService,
  LocaleRegistry,
  LocalizationService,
  SqliteContentRepository,
} from '../src/index.js';

const schema: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  description: '',
  collection: 'articles',
  titleField: 'title',
  localization: { localizedFields: ['title', 'slug'] },
  route: { pattern: '/articles/:slug', slugField: 'slug' },
  fields: [
    { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    { id: 'article.category', name: 'category', label: 'Category', type: 'text', required: true },
  ],
};
const scope: ContentScope = {
  organizationId: 'acme',
  tenantId: 'tenant',
  workspaceId: 'editorial',
  siteId: 'website',
  environmentId: 'production',
  locale: 'en',
};
const locales: LocaleConfiguration[] = [
  {
    code: 'en',
    siteId: 'website',
    label: 'English',
    default: true,
    enabled: true,
    required: true,
    routePrefix: '',
  },
  {
    code: 'fr',
    siteId: 'website',
    label: 'French',
    default: false,
    enabled: true,
    required: true,
    fallbackLocales: ['en'],
    routePrefix: '/fr',
  },
  {
    code: 'fr-CA',
    siteId: 'website',
    label: 'French (Canada)',
    default: false,
    enabled: true,
    required: false,
    fallbackLocales: ['fr', 'en'],
    routePrefix: '/fr-ca',
  },
];

describe('LocalizationService', () => {
  const repositories: SqliteContentRepository[] = [];

  afterEach(() => {
    repositories.splice(0).forEach((repository) => {
      repository.close();
    });
  });

  it('validates ordered acyclic fallback graphs', () => {
    const registry = new LocaleRegistry(locales);
    const english = locales[0];
    const french = locales[1];
    if (!english || !french) throw new Error('Locale fixtures are incomplete.');
    expect(registry.fallbackChain('website', 'fr-CA')).toEqual(['fr-CA', 'fr', 'en']);
    expect(
      () =>
        new LocaleRegistry([
          { ...english, fallbackLocales: ['fr'] },
          { ...french, fallbackLocales: ['en'] },
        ]),
    ).toThrow(/cycle/i);
  });

  it('creates variants, keeps shared values canonical, reports completeness, and resolves routes with fallback', async () => {
    const repository = new SqliteContentRepository({ filename: ':memory:' });
    repositories.push(repository);
    const content = new ContentService({ repository, schemas: [schema], componentManifests: [] });
    const localization = new LocalizationService({
      repository,
      contentService: content,
      locales: new LocaleRegistry(locales),
    });
    const english = await content.create({
      scope,
      contentType: 'article',
      data: { title: 'Hello', slug: 'hello', category: 'Engineering' },
      actor: { id: 'author' },
    });
    await content.publish({
      scope,
      id: english.id,
      expectedRevisionId: english.draftRevisionId,
      actor: { id: 'publisher' },
    });

    const initial = await localization.completeness(scope, english.id);
    expect(initial).toMatchObject({
      percentage: 50,
      publicationComplete: false,
      locales: [
        { locale: 'en', status: 'published', percentage: 100 },
        { locale: 'fr', status: 'missing', percentage: 0 },
        { locale: 'fr-CA', status: 'missing', percentage: 0 },
      ],
    });
    const fallback = await localization.resolve({
      scope: { ...scope, locale: 'fr' },
      translationGroupId: initial.translationGroupId,
    });
    expect(fallback).toMatchObject({ resolvedLocale: 'en', usedFallback: true });

    const french = await localization.createTranslation({
      sourceScope: scope,
      sourceId: english.id,
      locale: 'fr',
      data: { title: 'Bonjour', slug: 'bonjour', category: 'Changed' },
      actor: { id: 'translator' },
    });
    expect(french.data.category).toBe('Engineering');
    await expect(
      localization.createTranslation({
        sourceScope: scope,
        sourceId: english.id,
        locale: 'fr',
        data: french.data,
        actor: { id: 'translator' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await content.publish({
      scope: { ...scope, locale: 'fr' },
      id: french.id,
      expectedRevisionId: french.draftRevisionId,
      actor: { id: 'publisher' },
    });

    const complete = await localization.completeness(scope, english.id);
    expect(complete).toMatchObject({ percentage: 100, publicationComplete: true });
    expect(complete.locales.find((locale) => locale.locale === 'fr')?.route).toBe(
      '/fr/articles/bonjour',
    );
    const canadianFallback = await localization.resolve({
      scope: { ...scope, locale: 'fr-CA' },
      translationGroupId: complete.translationGroupId,
    });
    expect(canadianFallback).toMatchObject({ resolvedLocale: 'fr', usedFallback: true });
    expect(canadianFallback.entry.data.category).toBe('Engineering');

    const route = await localization.resolveRoute(
      { ...scope, locale: 'fr' },
      '/fr/articles/bonjour',
    );
    expect(route).toMatchObject({ resolvedLocale: 'fr', entry: { id: french.id } });
  });
});
