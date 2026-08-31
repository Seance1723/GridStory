import { afterEach, describe, expect, it } from 'vitest';
import {
  NAVIGATION_MENU_CONTENT_TYPE,
  navigationMenuEntryId,
  type ContentSchemaDefinition,
  type ContentScope,
  type LocaleConfiguration,
} from '@gridstory/schema';
import {
  ContentService,
  InMemoryReleaseRepository,
  LocaleRegistry,
  LocalizationService,
  NavigationMenuLifecycleValidator,
  NavigationMenuService,
  ReleaseService,
  SqliteContentRepository,
} from '../src/index.js';

const pageSchema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  localization: { localizedFields: ['title', 'slug'] },
  route: { pattern: '/:slug', slugField: 'slug' },
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
  ],
};

const navigationSchema: ContentSchemaDefinition = {
  id: NAVIGATION_MENU_CONTENT_TYPE,
  version: 1,
  name: 'Navigation menu',
  description: '',
  collection: 'navigation-menus',
  titleField: 'name',
  localization: { localizedFields: ['items'] },
  objects: [
    {
      id: 'navigation-menu-item',
      name: 'Navigation menu item',
      description: '',
      fields: [
        {
          id: 'navigation-menu-item.id',
          name: 'id',
          label: 'ID',
          required: true,
          value: { type: 'text' },
        },
        {
          id: 'navigation-menu-item.parent-id',
          name: 'parentId',
          label: 'Parent',
          required: false,
          value: { type: 'text' },
        },
        {
          id: 'navigation-menu-item.label',
          name: 'label',
          label: 'Label',
          required: true,
          value: { type: 'text' },
        },
        {
          id: 'navigation-menu-item.kind',
          name: 'kind',
          label: 'Kind',
          required: true,
          value: { type: 'enum', values: ['internal', 'external'] },
        },
        {
          id: 'navigation-menu-item.target',
          name: 'target',
          label: 'Target',
          required: false,
          value: { type: 'relation', targets: ['page'] },
        },
        {
          id: 'navigation-menu-item.external-url',
          name: 'externalUrl',
          label: 'External URL',
          required: false,
          value: { type: 'text' },
        },
      ],
    },
  ],
  fields: [
    {
      id: 'navigation-menu.key',
      name: 'key',
      label: 'Key',
      type: 'slug',
      required: true,
    },
    {
      id: 'navigation-menu.name',
      name: 'name',
      label: 'Name',
      type: 'text',
      required: true,
    },
    {
      id: 'navigation-menu.items',
      name: 'items',
      label: 'Items',
      type: 'array',
      required: true,
      items: { type: 'object', objectType: 'navigation-menu-item' },
    },
  ],
};

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};
const locales: LocaleConfiguration[] = [
  {
    code: 'en',
    siteId: scope.siteId,
    label: 'English',
    default: true,
    enabled: true,
    required: true,
    routePrefix: '',
  },
  {
    code: 'fr',
    siteId: scope.siteId,
    label: 'French',
    default: false,
    enabled: true,
    required: false,
    fallbackLocales: ['en'],
    routePrefix: '/fr',
  },
];
const actor = { id: 'editor' };
const page = (title: string, slug: string) => ({ title, slug });
const internalMenu = (key: string, targetId: string) => ({
  key,
  name: `${key} menu`,
  items: [
    {
      id: 'home',
      label: 'Home',
      kind: 'internal' as const,
      target: { id: targetId, contentType: 'page' },
    },
  ],
});

function harness() {
  const repository = new SqliteContentRepository({ filename: ':memory:' });
  const schemas = [pageSchema, navigationSchema];
  const content = new ContentService({
    repository,
    schemas,
    componentManifests: [],
    lifecycleValidators: [new NavigationMenuLifecycleValidator({ schemas })],
  });
  const registry = new LocaleRegistry(locales);
  const localization = new LocalizationService({
    repository,
    contentService: content,
    locales: registry,
  });
  const navigation = new NavigationMenuService({
    contentService: content,
    repository,
    localization,
    locales: registry,
  });
  const releases = new ReleaseService({
    repository: new InMemoryReleaseRepository(),
    contentService: content,
  });
  return { repository, content, localization, navigation, releases };
}

describe('NavigationMenuService', () => {
  const repositories: SqliteContentRepository[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) repository.close();
  });

  function setup() {
    const value = harness();
    repositories.push(value.repository);
    return value;
  }

  it('requires stable source identity, unique immutable keys and optimistic revisions', async () => {
    const { content, navigation } = setup();
    await expect(
      content.create({
        scope,
        contentType: NAVIGATION_MENU_CONTENT_TYPE,
        data: { key: 'generic', name: 'Generic', items: [] },
        actor,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const created = await navigation.create({ scope, key: 'header', name: 'Header', actor });
    expect(created.id).toBe(navigationMenuEntryId('header'));
    await expect(
      navigation.create({ scope, key: 'header', name: 'Duplicate', actor }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(
      content.updateDraft({
        scope,
        id: created.id,
        expectedRevisionId: created.draftRevisionId,
        data: { key: 'renamed', name: 'Header', items: [] },
        actor,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('previews draft targets but publishes and delivers only published targets', async () => {
    const { content, navigation } = setup();
    const target = await content.create({
      scope,
      contentType: 'page',
      data: page('Welcome', 'welcome'),
      actor,
    });
    const created = await navigation.create({ scope, key: 'header', name: 'Header', actor });
    const menu = await content.updateDraft({
      scope,
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      data: internalMenu('header', target.id),
      actor,
    });

    expect((await navigation.preview(scope, menu.id)).items[0]).toMatchObject({ href: '/welcome' });
    await expect(
      content.publish({
        scope,
        id: menu.id,
        expectedRevisionId: menu.draftRevisionId,
        actor,
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    await content.publish({
      scope,
      id: target.id,
      expectedRevisionId: target.draftRevisionId,
      actor,
    });
    await content.publish({
      scope,
      id: menu.id,
      expectedRevisionId: menu.draftRevisionId,
      actor,
    });
    const delivered = await navigation.resolvePublished(scope, 'header');
    expect(delivered.projection).toMatchObject({
      perspective: 'published',
      key: 'header',
      items: [{ label: 'Home', href: '/welcome' }],
    });
    expect(delivered.dependencies.map((entry) => entry.id)).toEqual([menu.id, target.id]);
  });

  it('resolves current published slugs and locale fallback without persisting routes', async () => {
    const { content, navigation } = setup();
    let target = await content.create({
      scope,
      contentType: 'page',
      data: page('Welcome', 'welcome'),
      actor,
    });
    target = await content.publish({
      scope,
      id: target.id,
      expectedRevisionId: target.draftRevisionId,
      actor,
    });
    let menu = await navigation.create({ scope, key: 'footer', name: 'Footer', actor });
    menu = await content.updateDraft({
      scope,
      id: menu.id,
      expectedRevisionId: menu.draftRevisionId,
      data: internalMenu('footer', target.id),
      actor,
    });
    await content.publish({
      scope,
      id: menu.id,
      expectedRevisionId: menu.draftRevisionId,
      actor,
    });

    target = await content.updateDraft({
      scope,
      id: target.id,
      expectedRevisionId: target.draftRevisionId,
      data: page('Welcome', 'start'),
      actor,
    });
    await content.publish({
      scope,
      id: target.id,
      expectedRevisionId: target.draftRevisionId,
      actor,
    });

    expect((await navigation.resolvePublished(scope, 'footer')).projection.items[0]).toMatchObject({
      href: '/start',
    });
    expect(
      (await navigation.resolvePublished({ ...scope, locale: 'fr' }, 'footer')).projection,
    ).toMatchObject({ requestedLocale: 'fr', resolvedLocale: 'en', items: [{ href: '/start' }] });
  });

  it('validates menu references against the complete pinned future release state', async () => {
    const { content, navigation, releases } = setup();
    const target = await content.create({
      scope,
      contentType: 'page',
      data: page('Launch', 'launch'),
      actor,
    });
    let menu = await navigation.create({ scope, key: 'header', name: 'Header', actor });
    menu = await content.updateDraft({
      scope,
      id: menu.id,
      expectedRevisionId: menu.draftRevisionId,
      data: internalMenu('header', target.id),
      actor,
    });

    expect(
      await content.assessRelease({
        scope,
        entries: [
          { entryId: target.id, revisionId: target.draftRevisionId },
          { entryId: menu.id, revisionId: menu.draftRevisionId },
        ],
        actor,
      }),
    ).toEqual([]);
    expect(
      (
        await content.assessRelease({
          scope,
          entries: [{ entryId: menu.id, revisionId: menu.draftRevisionId }],
          actor,
        })
      ).map((issue) => [issue.code, issue.path]),
    ).toContainEqual(['content-invalid', ['items', 0, 'target']]);

    let release = await releases.create({
      scope,
      release: {
        name: 'New page and navigation',
        entries: [
          { entryId: target.id, revisionId: target.draftRevisionId },
          { entryId: menu.id, revisionId: menu.draftRevisionId },
        ],
        rollbackPolicy: { mode: 'disabled' },
      },
      actor,
    });
    release = await releases.validate({ scope, id: release.id, actor });
    expect(release.validation).toMatchObject({ valid: true, issues: [] });
    release = await releases.execute({ scope, id: release.id, actor });
    expect(release.state).toBe('published');
    expect((await navigation.resolvePublished(scope, 'header')).projection.items[0]).toMatchObject({
      href: '/launch',
    });
  });

  it('restores prior menu and target pointers when an updated release rolls back', async () => {
    const { content, navigation, releases } = setup();
    let target = await content.create({
      scope,
      contentType: 'page',
      data: page('Before', 'before'),
      actor,
    });
    target = await content.publish({
      scope,
      id: target.id,
      expectedRevisionId: target.draftRevisionId,
      actor,
    });
    let menu = await navigation.create({ scope, key: 'footer', name: 'Footer', actor });
    menu = await content.updateDraft({
      scope,
      id: menu.id,
      expectedRevisionId: menu.draftRevisionId,
      data: internalMenu('footer', target.id),
      actor,
    });
    menu = await content.publish({
      scope,
      id: menu.id,
      expectedRevisionId: menu.draftRevisionId,
      actor,
    });

    target = await content.updateDraft({
      scope,
      id: target.id,
      expectedRevisionId: target.draftRevisionId,
      data: page('After', 'after'),
      actor,
    });
    menu = await content.updateDraft({
      scope,
      id: menu.id,
      expectedRevisionId: menu.draftRevisionId,
      data: {
        ...internalMenu('footer', target.id),
        items: [{ ...internalMenu('footer', target.id).items[0], label: 'After' }],
      },
      actor,
    });
    let release = await releases.create({
      scope,
      release: {
        name: 'Updated page and navigation',
        entries: [
          { entryId: target.id, revisionId: target.draftRevisionId },
          { entryId: menu.id, revisionId: menu.draftRevisionId },
        ],
        rollbackPolicy: { mode: 'manual' },
      },
      actor,
    });
    release = await releases.validate({ scope, id: release.id, actor });
    expect(release.validation).toMatchObject({ valid: true, issues: [] });
    release = await releases.execute({ scope, id: release.id, actor });
    expect((await navigation.resolvePublished(scope, 'footer')).projection.items[0]).toMatchObject({
      href: '/after',
      label: 'After',
    });

    release = await releases.rollback({
      scope,
      id: release.id,
      reason: 'Navigation rollback regression',
      actor,
    });
    expect(release.state).toBe('rolled-back');
    expect((await navigation.resolvePublished(scope, 'footer')).projection.items[0]).toMatchObject({
      href: '/before',
      label: 'Home',
    });
  });
});
