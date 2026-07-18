import {
  buildContentRoute,
  normalizeRoutePath,
  type ContentEntry,
  type ContentPerspective,
  type ContentSchemaDefinition,
  type ContentScope,
  type LocaleConfiguration,
  type LocalizedContentResolution,
  type TranslationCompletenessReport,
  type TranslationLocaleCompleteness,
} from '@gridstory/schema';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import type { ContentService } from './content-service.js';
import type { Actor, ContentRepository } from './types.js';

function localeKey(siteId: string, code: string): string {
  return `${siteId}\u0000${code}`;
}

function fallbackCodes(locale: LocaleConfiguration): string[] {
  return [
    ...(locale.fallbackLocales ?? []),
    ...(locale.fallbackLocale ? [locale.fallbackLocale] : []),
  ].filter((code, index, values) => values.indexOf(code) === index);
}

function normalizedPrefix(prefix: string | undefined): string {
  if (!prefix || prefix === '/') return '';
  if (!prefix.startsWith('/') || prefix.endsWith('/')) {
    throw new GridStoryError(
      'Locale route prefixes must start with / and must not end with /.',
      'invalid_locale_configuration',
      500,
    );
  }
  return prefix;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export class LocaleRegistry {
  readonly #locales: LocaleConfiguration[];
  readonly #byKey: ReadonlyMap<string, LocaleConfiguration>;

  constructor(locales: LocaleConfiguration[]) {
    if (locales.length === 0) {
      throw new GridStoryError(
        'At least one locale configuration is required.',
        'invalid_locale_configuration',
        500,
      );
    }
    const normalized = locales.map((locale) => ({
      ...locale,
      code: locale.code.trim(),
      routePrefix: normalizedPrefix(locale.routePrefix),
      fallbackLocales: fallbackCodes(locale),
    }));
    const byKey = new Map<string, LocaleConfiguration>();
    for (const locale of normalized) {
      if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale.code)) {
        throw new GridStoryError(
          `Locale code ${locale.code} is not a supported BCP 47-style tag.`,
          'invalid_locale_configuration',
          500,
        );
      }
      const key = localeKey(locale.siteId, locale.code);
      if (byKey.has(key)) {
        throw new GridStoryError(
          `Locale ${locale.code} is duplicated for site ${locale.siteId}.`,
          'invalid_locale_configuration',
          500,
        );
      }
      byKey.set(key, locale);
    }
    for (const siteId of new Set(normalized.map((locale) => locale.siteId))) {
      const siteLocales = normalized.filter((locale) => locale.siteId === siteId && locale.enabled);
      if (siteLocales.filter((locale) => locale.default).length !== 1) {
        throw new GridStoryError(
          `Site ${siteId} must have exactly one enabled default locale.`,
          'invalid_locale_configuration',
          500,
        );
      }
      for (const locale of siteLocales) {
        for (const fallback of fallbackCodes(locale)) {
          const target = byKey.get(localeKey(siteId, fallback));
          if (!target?.enabled || fallback === locale.code) {
            throw new GridStoryError(
              `Locale ${locale.code} has invalid fallback ${fallback}.`,
              'invalid_locale_configuration',
              500,
            );
          }
        }
      }
      const visit = (code: string, path: string[]): void => {
        if (path.includes(code)) {
          throw new GridStoryError(
            `Locale fallback graph contains a cycle: ${[...path, code].join(' -> ')}.`,
            'invalid_locale_configuration',
            500,
          );
        }
        const locale = byKey.get(localeKey(siteId, code));
        fallbackCodes(locale as LocaleConfiguration).forEach((fallback) => {
          visit(fallback, [...path, code]);
        });
      };
      siteLocales.forEach((locale) => {
        visit(locale.code, []);
      });
    }
    this.#locales = normalized;
    this.#byKey = byKey;
  }

  list(siteId: string): LocaleConfiguration[] {
    return this.#locales.filter((locale) => locale.siteId === siteId && locale.enabled);
  }

  get(siteId: string, code: string): LocaleConfiguration {
    const locale = this.#byKey.get(localeKey(siteId, code));
    if (!locale?.enabled) {
      throw new GridStoryError(
        `Locale ${code} is not enabled for this site.`,
        'invalid_locale',
        400,
      );
    }
    return locale;
  }

  default(siteId: string): LocaleConfiguration {
    const locale = this.list(siteId).find((candidate) => candidate.default);
    if (!locale) throw new Error(`Site ${siteId} has no default locale.`);
    return locale;
  }

  fallbackChain(siteId: string, requestedCode: string): string[] {
    const requested = this.get(siteId, requestedCode);
    const chain: string[] = [];
    const append = (locale: LocaleConfiguration): void => {
      if (chain.includes(locale.code)) return;
      chain.push(locale.code);
      fallbackCodes(locale).forEach((fallback) => {
        append(this.get(siteId, fallback));
      });
    };
    append(requested);
    append(this.default(siteId));
    return chain;
  }
}

export interface LocalizationServiceOptions {
  repository: ContentRepository;
  contentService: ContentService;
  locales: LocaleRegistry;
}

export class LocalizationService {
  readonly #repository: ContentRepository;
  readonly #content: ContentService;
  readonly #locales: LocaleRegistry;
  readonly #schemas: ReadonlyMap<string, ContentSchemaDefinition>;

  constructor({ repository, contentService, locales }: LocalizationServiceOptions) {
    this.#repository = repository;
    this.#content = contentService;
    this.#locales = locales;
    this.#schemas = new Map(contentService.getSchemas().map((schema) => [schema.id, schema]));
  }

  listLocales(siteId: string): LocaleConfiguration[] {
    return this.#locales.list(siteId);
  }

  #schema(contentType: string): ContentSchemaDefinition {
    const schema = this.#schemas.get(contentType);
    if (!schema) throw new NotFoundError(`Content type ${contentType} is not registered.`);
    return schema;
  }

  #localizedFields(schema: ContentSchemaDefinition): string[] {
    return schema.localization?.localizedFields ?? [];
  }

  #mergedData(entry: ContentEntry, sharedSource: ContentEntry): Record<string, unknown> {
    const localized = new Set(this.#localizedFields(this.#schema(entry.contentType)));
    const data = { ...entry.data };
    for (const [field, value] of Object.entries(sharedSource.data)) {
      if (!localized.has(field)) data[field] = value;
    }
    return data;
  }

  #route(
    schema: ContentSchemaDefinition,
    data: Record<string, unknown>,
    locale: LocaleConfiguration,
  ): string | undefined {
    if (!schema.route) return undefined;
    return normalizeRoutePath(`${locale.routePrefix ?? ''}${buildContentRoute(schema, data)}`);
  }

  async createTranslation(input: {
    sourceScope: ContentScope;
    sourceId: string;
    locale: string;
    data: unknown;
    actor: Actor;
  }): Promise<ContentEntry> {
    this.#locales.get(input.sourceScope.siteId, input.locale);
    const source = await this.#content.get({
      scope: input.sourceScope,
      id: input.sourceId,
      perspective: 'draft',
    });
    const translationGroupId = await this.#repository.getTranslationGroup({
      scope: input.sourceScope,
      id: source.id,
    });
    if (!translationGroupId) throw new NotFoundError('Translation source was not found.');
    const variants = await this.#repository.listTranslationVariants({
      scope: input.sourceScope,
      translationGroupId,
      perspective: 'draft',
    });
    if (variants.some((variant) => variant.locale === input.locale)) {
      throw new ConflictError(`A ${input.locale} translation already exists.`, {
        translationGroupId,
        locale: input.locale,
      });
    }
    if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
      throw new GridStoryError('Translation data must be a JSON object.', 'invalid_request', 400);
    }
    const proposed = input.data as Record<string, unknown>;
    const localized = new Set(this.#localizedFields(this.#schema(source.contentType)));
    const data = { ...source.data, ...proposed };
    for (const [field, value] of Object.entries(source.data)) {
      if (!localized.has(field)) data[field] = value;
    }
    return this.#content.create({
      scope: { ...input.sourceScope, locale: input.locale },
      contentType: source.contentType,
      data,
      actor: input.actor,
      translationGroupId,
    });
  }

  async resolve(input: {
    scope: ContentScope;
    translationGroupId: string;
    perspective?: ContentPerspective;
  }): Promise<LocalizedContentResolution> {
    const perspective = input.perspective ?? 'published';
    const fallbackChain = this.#locales.fallbackChain(input.scope.siteId, input.scope.locale);
    const variants = await this.#repository.listTranslationVariants({
      scope: input.scope,
      translationGroupId: input.translationGroupId,
      perspective,
    });
    const entry = fallbackChain
      .map((locale) => variants.find((variant) => variant.locale === locale))
      .find((variant) => variant !== undefined);
    if (!entry)
      throw new NotFoundError('No content variant is available in the locale fallback chain.');
    const defaultLocale = this.#locales.default(input.scope.siteId).code;
    const sharedSource = variants.find((variant) => variant.locale === defaultLocale) ?? entry;
    return {
      requestedLocale: input.scope.locale,
      resolvedLocale: entry.locale,
      fallbackChain,
      usedFallback: entry.locale !== input.scope.locale,
      perspective,
      entry: { ...entry, data: this.#mergedData(entry, sharedSource) },
    };
  }

  async completeness(
    scope: ContentScope,
    sourceId: string,
  ): Promise<TranslationCompletenessReport> {
    const source = await this.#content.get({ scope, id: sourceId, perspective: 'draft' });
    const translationGroupId = await this.#repository.getTranslationGroup({ scope, id: sourceId });
    if (!translationGroupId) throw new NotFoundError('Translation source was not found.');
    const variants = await this.#repository.listTranslationVariants({
      scope,
      translationGroupId,
      perspective: 'draft',
    });
    const schema = this.#schema(source.contentType);
    const localizedFields = this.#localizedFields(schema);
    const configured = this.#locales.list(scope.siteId);
    const requiredLocales = configured
      .filter((locale) => locale.required !== false)
      .map((locale) => locale.code);
    const locales: TranslationLocaleCompleteness[] = configured.map((locale) => {
      const variant = variants.find((candidate) => candidate.locale === locale.code);
      const missingFields = localizedFields.filter((field) => !hasValue(variant?.data[field]));
      const translatedFields = localizedFields.length - missingFields.length;
      const route = variant
        ? this.#route(schema, this.#mergedData(variant, source), locale)
        : undefined;
      return {
        locale: locale.code,
        required: locale.required !== false,
        exists: Boolean(variant),
        status: variant?.status ?? 'missing',
        translatedFields,
        totalFields: localizedFields.length,
        percentage:
          localizedFields.length === 0
            ? 100
            : Math.round((translatedFields / localizedFields.length) * 100),
        missingFields,
        ...(variant ? { entryId: variant.id } : {}),
        ...(route ? { route } : {}),
      };
    });
    const required = locales.filter((locale) => locale.required);
    const totalFields = required.length * localizedFields.length;
    const translatedFields = required.reduce((sum, locale) => sum + locale.translatedFields, 0);
    return {
      translationGroupId,
      sourceEntryId: source.id,
      contentType: source.contentType,
      localizedFields,
      requiredLocales,
      translatedFields,
      totalFields,
      percentage: totalFields === 0 ? 100 : Math.round((translatedFields / totalFields) * 100),
      publicationComplete: required.every((locale) => locale.status === 'published'),
      locales,
    };
  }

  async resolveRoute(scope: ContentScope, rawPath: string): Promise<LocalizedContentResolution> {
    const requestedLocale = this.#locales.get(scope.siteId, scope.locale);
    const path = normalizeRoutePath(rawPath);
    const fallbackChain = this.#locales.fallbackChain(scope.siteId, scope.locale);
    for (const locale of fallbackChain) {
      const localeScope = { ...scope, locale };
      const entries = await this.#content.list({ scope: localeScope, perspective: 'published' });
      for (const entry of entries) {
        const schema = this.#schema(entry.contentType);
        if (this.#route(schema, entry.data, requestedLocale) !== path) continue;
        const translationGroupId = await this.#repository.getTranslationGroup({
          scope: localeScope,
          id: entry.id,
        });
        if (!translationGroupId) continue;
        return this.resolve({ scope, translationGroupId, perspective: 'published' });
      }
    }
    throw new NotFoundError('Published localized route was not found.');
  }
}
