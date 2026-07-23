import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ComponentManifest, ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import {
  ComponentLifecycleService,
  ContentService,
  SqliteContentRepository,
  type ContentRepository,
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
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    {
      id: 'page.blocks',
      name: 'blocks',
      label: 'Blocks',
      type: 'component-tree',
      required: true,
      accepts: ['hero'],
    },
  ],
};
const manifest: ComponentManifest = {
  id: 'hero',
  version: 2,
  name: 'Hero',
  description: '',
  category: 'Marketing',
  strictProps: true,
  status: 'active',
  slots: [],
  props: [
    { id: 'hero.headline', name: 'headline', label: 'Headline', type: 'text', required: true },
    { id: 'hero.tone', name: 'tone', label: 'Tone', type: 'text', required: true },
  ],
  migrations: [
    {
      fromVersion: 1,
      toVersion: 2,
      operations: [
        { kind: 'rename-prop', from: 'heading', to: 'headline' },
        { kind: 'set-default', name: 'tone', value: 'calm' },
      ],
    },
  ],
  visualRegression: {
    scenarios: [{ id: 'desktop', name: 'Desktop', props: { headline: 'Hello', tone: 'calm' } }],
  },
};

describe('ComponentLifecycleService', () => {
  let repository: ContentRepository;
  let lifecycle: ComponentLifecycleService;

  beforeEach(async () => {
    repository = new SqliteContentRepository({ filename: ':memory:' });
    const created = await repository.create({
      scope,
      contentType: 'page',
      data: {
        title: 'Legacy page',
        blocks: [{ id: 'hero-1', component: 'hero', version: 1, props: { heading: 'Legacy' } }],
      },
      actor: { id: 'seed' },
    });
    await repository.publish({
      scope,
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      actor: { id: 'publisher' },
    });
    const content = new ContentService({
      repository,
      schemas: [schema],
      componentManifests: [manifest],
    });
    lifecycle = new ComponentLifecycleService({ contentService: content });
  });

  afterEach(async () => repository.close());

  it('reports scoped draft/published impact and migrates only the immutable draft successor', async () => {
    const plan = await lifecycle.planMigration(scope, 'hero');
    expect(plan.outdatedInstances).toBe(2);
    expect(plan.ready).toBe(true);
    expect(plan.usage.byPerspective).toEqual({ draft: 1, published: 1 });

    const draft = plan.usage.locations.find((location) => location.perspective === 'draft');
    expect(draft).toBeDefined();
    if (!draft) return;
    const migrated = await lifecycle.migrateEntry({
      scope,
      entryId: draft.entryId,
      componentId: 'hero',
      expectedRevisionId: draft.revisionId,
      actor: { id: 'migrator' },
    });
    expect(migrated.migratedInstances).toBe(1);
    expect(migrated.entry.data.blocks).toEqual([
      { id: 'hero-1', component: 'hero', version: 2, props: { headline: 'Legacy', tone: 'calm' } },
    ]);

    const usage = await lifecycle.usage(scope, 'hero');
    expect(usage.byVersion).toEqual({ '1': 1, '2': 1 });
    expect(usage.locations.find((location) => location.perspective === 'published')?.version).toBe(
      1,
    );
  });

  it('emits stable scenario and content selectors for application-owned screenshot runners', async () => {
    const plan = await lifecycle.visualRegression(scope, 'hero');
    expect(plan.selector).toBe('[data-gridstory-component="hero"][data-gridstory-version="2"]');
    expect(plan.scenarios).toHaveLength(1);
    expect(plan.usageHooks).toHaveLength(2);
    expect((await lifecycle.visualRegression(scope, 'hero')).id).toBe(plan.id);
  });
});
