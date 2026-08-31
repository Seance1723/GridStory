import {
  NAVIGATION_MENU_CONTENT_TYPE,
  buildContentRoute,
  type ContentEntry,
  type ContentSchemaDefinition,
  type ContentScope,
  navigationMenuDataSchema,
  navigationMenuEntryId,
  navigationMenuKeySchema,
  type NavigationMenuProjection,
  type NavigationMenuProjectionItem,
  navigationMenuProjectionSchema,
  normalizeRoutePath,
  type ValidationIssue,
} from '@gridstory/schema';
import type { ContentService } from './content-service.js';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import type { LocaleRegistry, LocalizationService } from './localization-service.js';
import { assertSameContentScope } from './tenant-scope.js';
import type {
  Actor,
  ContentLifecycleValidationInput,
  ContentLifecycleValidator,
  ContentRepository,
  PublishedContentReader,
} from './types.js';

function schemaIssues(data: unknown): ValidationIssue[] {
  const parsed = navigationMenuDataSchema.safeParse(data);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    code:
      issue.code === 'too_small'
        ? 'too_small'
        : issue.code === 'too_big'
          ? 'too_large'
          : 'invalid_format',
    path: issue.path.filter((value): value is string | number => typeof value !== 'symbol'),
    message: issue.message,
  }));
}

export interface NavigationMenuLifecycleValidatorOptions {
  schemas: ContentSchemaDefinition[];
}

export class NavigationMenuLifecycleValidator implements ContentLifecycleValidator {
  readonly contentType = NAVIGATION_MENU_CONTENT_TYPE;
  readonly #schemas: ReadonlyMap<string, ContentSchemaDefinition>;

  constructor({ schemas }: NavigationMenuLifecycleValidatorOptions) {
    this.#schemas = new Map(schemas.map((schema) => [schema.id, schema]));
  }

  async validate(input: ContentLifecycleValidationInput): Promise<ValidationIssue[]> {
    const issues = schemaIssues(input.data);
    const parsed = navigationMenuDataSchema.safeParse(input.data);
    if (!parsed.success) return issues;
    const menu = parsed.data;

    if (
      !input.previousData &&
      !input.translationGroupId &&
      input.entryId !== navigationMenuEntryId(menu.key)
    ) {
      issues.push({
        code: 'invalid_format',
        path: ['key'],
        message: 'A source menu must be created through its stable key identity.',
      });
    }
    const previous = navigationMenuDataSchema.safeParse(input.previousData);
    if (previous.success && previous.data.key !== menu.key) {
      issues.push({
        code: 'invalid_format',
        path: ['key'],
        message: 'A menu key is immutable after creation.',
      });
    }

    const menus = await input.view.list(NAVIGATION_MENU_CONTENT_TYPE);
    for (const candidate of menus) {
      assertSameContentScope(input.scope, candidate, 'navigation-menu-validation-list');
      if (candidate.id === input.entryId) continue;
      const other = navigationMenuDataSchema.safeParse(candidate.data);
      if (other.success && other.data.key === menu.key) {
        issues.push({
          code: 'invalid_format',
          path: ['key'],
          message: `Menu key ${menu.key} already exists in this exact scope.`,
        });
        break;
      }
    }

    for (const [index, item] of menu.items.entries()) {
      if (item.kind !== 'internal' || !item.target) continue;
      const targetSchema = this.#schemas.get(item.target.contentType);
      if (!targetSchema?.route) {
        issues.push({
          code: 'invalid_reference',
          path: ['items', index, 'target'],
          message: 'Internal menu targets must use a registered routed content type.',
        });
        continue;
      }
      const target = await input.view.getById(item.target.id);
      if (!target || target.contentType !== item.target.contentType) {
        issues.push({
          code: 'invalid_reference',
          path: ['items', index, 'target'],
          message:
            input.perspective === 'published'
              ? 'Internal menu target is absent from the published publication state.'
              : 'Internal menu target was not found in the active draft scope.',
        });
        continue;
      }
      assertSameContentScope(input.scope, target, 'navigation-menu-validation-target');
    }
    return issues;
  }
}

export interface NavigationMenuServiceOptions {
  contentService: ContentService;
  repository: ContentRepository;
  localization: LocalizationService;
  locales: LocaleRegistry;
}

export interface ResolvedNavigationMenu {
  projection: NavigationMenuProjection;
  dependencies: ContentEntry[];
}

export class NavigationMenuService {
  readonly #content: ContentService;
  readonly #repository: ContentRepository;
  readonly #localization: LocalizationService;
  readonly #locales: LocaleRegistry;
  readonly #schemas: ReadonlyMap<string, ContentSchemaDefinition>;

  constructor({ contentService, repository, localization, locales }: NavigationMenuServiceOptions) {
    this.#content = contentService;
    this.#repository = repository;
    this.#localization = localization;
    this.#locales = locales;
    this.#schemas = new Map(contentService.getSchemas().map((schema) => [schema.id, schema]));
    if (!this.#schemas.has(NAVIGATION_MENU_CONTENT_TYPE)) {
      throw new Error('NavigationMenuService requires the reserved navigation-menu schema.');
    }
  }

  async create(input: {
    scope: ContentScope;
    key: string;
    name: string;
    actor: Actor;
  }): Promise<ContentEntry> {
    if (input.scope.locale !== this.#locales.default(input.scope.siteId).code) {
      throw new GridStoryError(
        'Navigation menu sources must be created in the site default locale.',
        'invalid_navigation_menu_source_locale',
        400,
      );
    }
    const parsed = navigationMenuDataSchema.safeParse({
      key: input.key,
      name: input.name,
      items: [],
    });
    if (!parsed.success) {
      throw new GridStoryError(
        'Navigation menu key or name is invalid.',
        'invalid_navigation_menu',
        400,
        { issues: parsed.error.issues },
      );
    }
    const data = parsed.data;
    const id = navigationMenuEntryId(data.key);
    try {
      await this.#content.get({ scope: input.scope, id, perspective: 'draft' });
      throw new ConflictError(`Navigation menu key ${data.key} already exists.`);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
    return await this.#content.create({
      scope: input.scope,
      id,
      contentType: NAVIGATION_MENU_CONTENT_TYPE,
      data,
      actor: input.actor,
    });
  }

  async #projection(input: {
    requestedScope: ContentScope;
    resolvedEntry: ContentEntry;
    resolvedLocale: string;
    perspective: 'draft' | 'published';
    target: (reference: { id: string; contentType: string }) => Promise<ContentEntry | null>;
  }): Promise<ResolvedNavigationMenu> {
    const parsed = navigationMenuDataSchema.safeParse(input.resolvedEntry.data);
    if (!parsed.success) {
      throw new GridStoryError(
        'Navigation menu state is invalid.',
        'invalid_navigation_menu_state',
        503,
      );
    }
    const menu = parsed.data;
    const dependencies: ContentEntry[] = [input.resolvedEntry];
    const routePrefix = this.#locales.get(
      input.requestedScope.siteId,
      input.resolvedLocale,
    ).routePrefix;
    const items: NavigationMenuProjectionItem[] = [];
    for (const item of menu.items) {
      if (item.kind === 'external') {
        items.push({
          id: item.id,
          ...(item.parentId ? { parentId: item.parentId } : {}),
          label: item.label,
          kind: 'external' as const,
          href: item.externalUrl as string,
        });
        continue;
      }
      const reference = item.target as { id: string; contentType: string };
      const target = await input.target(reference);
      if (!target || target.contentType !== reference.contentType) {
        throw new GridStoryError(
          'Navigation menu target is unavailable.',
          'navigation_menu_target_unavailable',
          503,
        );
      }
      assertSameContentScope(
        { ...input.requestedScope, locale: input.resolvedLocale },
        target,
        'navigation-menu-projection-target',
      );
      const schema = this.#schemas.get(target.contentType);
      if (!schema?.route) {
        throw new GridStoryError(
          'Navigation menu target is not routed.',
          'navigation_menu_target_unavailable',
          503,
        );
      }
      dependencies.push(target);
      items.push({
        id: item.id,
        ...(item.parentId ? { parentId: item.parentId } : {}),
        label: item.label,
        kind: 'internal' as const,
        target: reference,
        href: normalizeRoutePath(`${routePrefix ?? ''}${buildContentRoute(schema, target.data)}`),
      });
    }
    return {
      projection: navigationMenuProjectionSchema.parse({
        schemaVersion: 1,
        scope: input.requestedScope,
        entryId: input.resolvedEntry.id,
        key: menu.key,
        name: menu.name,
        requestedLocale: input.requestedScope.locale,
        resolvedLocale: input.resolvedLocale,
        perspective: input.perspective,
        revisionId:
          input.perspective === 'published'
            ? input.resolvedEntry.publishedRevisionId
            : input.resolvedEntry.draftRevisionId,
        items,
      }),
      dependencies,
    };
  }

  async preview(scope: ContentScope, entryId: string): Promise<NavigationMenuProjection> {
    const selected = await this.#content.get({ scope, id: entryId, perspective: 'draft' });
    if (selected.contentType !== NAVIGATION_MENU_CONTENT_TYPE) {
      throw new NotFoundError('Navigation menu was not found.');
    }
    const group = await this.#repository.getTranslationGroup({ scope, id: selected.id });
    const localized = group
      ? await this.#localization.resolve({
          scope,
          translationGroupId: group,
          perspective: 'draft',
        })
      : {
          requestedLocale: scope.locale,
          resolvedLocale: selected.locale,
          entry: selected,
        };
    return (
      await this.#projection({
        requestedScope: scope,
        resolvedEntry: localized.entry,
        resolvedLocale: localized.resolvedLocale,
        perspective: 'draft',
        target: async (reference) => {
          try {
            return await this.#content.get({
              scope: { ...scope, locale: localized.resolvedLocale },
              id: reference.id,
              perspective: 'draft',
            });
          } catch (error) {
            if (error instanceof NotFoundError) return null;
            throw error;
          }
        },
      })
    ).projection;
  }

  async resolvePublished(
    scope: ContentScope,
    key: string,
    reader?: PublishedContentReader,
  ): Promise<ResolvedNavigationMenu> {
    const parsedKey = navigationMenuKeySchema.safeParse(key);
    if (!parsedKey.success) {
      throw new GridStoryError(
        'Navigation menu key is invalid.',
        'invalid_navigation_menu_key',
        400,
      );
    }
    const selectedKey = parsedKey.data;
    let selected: ContentEntry | null = null;
    for (const locale of this.#locales.fallbackChain(scope.siteId, scope.locale)) {
      const localeScope = { ...scope, locale };
      const entries = reader
        ? await reader.list({
            scope: localeScope,
            contentType: NAVIGATION_MENU_CONTENT_TYPE,
            perspective: 'published',
          })
        : await this.#content.list({
            scope: localeScope,
            contentType: NAVIGATION_MENU_CONTENT_TYPE,
            perspective: 'published',
          });
      const matches = entries.filter((entry) => entry.data.key === selectedKey);
      if (matches.length > 1) {
        throw new ConflictError(`Published menu key ${selectedKey} is ambiguous.`);
      }
      if (matches[0]) {
        selected = matches[0];
        break;
      }
    }
    if (!selected) throw new NotFoundError('Published navigation menu was not found.');

    const selectedScope = { ...scope, locale: selected.locale };
    const group = reader
      ? await reader.getTranslationGroup({ scope: selectedScope, id: selected.id })
      : await this.#repository.getTranslationGroup({ scope: selectedScope, id: selected.id });
    const localized = group
      ? await this.#localization.resolve({
          scope,
          translationGroupId: group,
          perspective: 'published',
          ...(reader ? { publishedReader: reader } : {}),
        })
      : {
          requestedLocale: scope.locale,
          resolvedLocale: selected.locale,
          entry: selected,
        };
    const targetCache = new Map<string, ContentEntry[]>();
    return await this.#projection({
      requestedScope: scope,
      resolvedEntry: localized.entry,
      resolvedLocale: localized.resolvedLocale,
      perspective: 'published',
      target: async (reference) => {
        let entries = targetCache.get(reference.contentType);
        if (!entries) {
          const targetScope = { ...scope, locale: localized.resolvedLocale };
          entries = reader
            ? await reader.list({
                scope: targetScope,
                contentType: reference.contentType,
                perspective: 'published',
              })
            : await this.#content.list({
                scope: targetScope,
                contentType: reference.contentType,
                perspective: 'published',
              });
          targetCache.set(reference.contentType, entries);
        }
        return entries.find((entry) => entry.id === reference.id) ?? null;
      },
    });
  }
}
