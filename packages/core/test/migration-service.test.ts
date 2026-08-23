import { describe, expect, it } from 'vitest';
import type {
  ContentSchemaDefinition,
  ContentScope,
  MigrationSourceRecord,
  MigrationSourceSnapshot,
} from '@gridstory/schema';
import {
  ContentService,
  type ContentWorkflowGate,
  InMemoryMigrationRepository,
  type MigrationSourceAdapter,
  MigrationService,
  SqliteContentRepository,
} from '../src/index.js';

const pageSchema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  route: { pattern: '/:slug', slugField: 'slug' },
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
  ],
};

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'migration-shadow',
  locale: 'en',
};

class FixtureSource implements MigrationSourceAdapter {
  readonly descriptor = {
    id: 'contentful-main',
    provider: 'contentful' as const,
    name: 'Contentful main',
    supportsDelta: true,
    reportsDeletions: true,
    includesAssets: true,
  };
  records: MigrationSourceRecord[] = [];
  reads: Array<{ mode: 'full' | 'delta'; checkpoint?: string }> = [];

  read(input: { mode: 'full' | 'delta'; checkpoint?: string }): MigrationSourceSnapshot {
    this.reads.push({
      mode: input.mode,
      ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
    });
    return {
      kind: input.mode,
      records: structuredClone(this.records),
      checkpoint: `checkpoint-${this.reads.length}`,
      complete: true,
    };
  }
}

function sourceRecord(
  title: string,
  status: 'published' | 'deleted' = 'published',
): MigrationSourceRecord {
  return {
    externalId: 'entry-1',
    sourceType: 'contentful.Entry.page',
    status,
    updatedAt: '2026-08-23T00:00:00.000Z',
    data: { fields: { title, slug: title } },
  };
}

async function fixture(options: { workflowGate?: ContentWorkflowGate } = {}) {
  const contentRepository = new SqliteContentRepository({ filename: ':memory:' });
  const contentService = new ContentService({
    repository: contentRepository,
    schemas: [pageSchema],
    componentManifests: [],
    ...(options.workflowGate ? { workflowGate: options.workflowGate } : {}),
  });
  const migrationRepository = new InMemoryMigrationRepository();
  const source = new FixtureSource();
  let counter = 0;
  const service = new MigrationService({
    repository: migrationRepository,
    contentRepository,
    contentService,
    sources: [source],
    now: () => '2026-08-23T00:00:00.000Z',
    createId: () => `migration-${++counter}`,
  });
  await service.upsertRecipe(scope, 'admin-a', {
    id: 'contentful-page',
    name: 'Contentful page',
    provider: 'contentful',
    sourceType: 'contentful.Entry.page',
    targetContentType: 'page',
    publicationMode: 'mirror-source',
    fields: [
      { sourcePath: 'fields.title', targetField: 'title', transform: 'string', required: true },
      { sourcePath: 'fields.slug', targetField: 'slug', transform: 'slug', required: true },
    ],
  });
  await service.createProject(scope, 'admin-a', {
    id: 'contentful-cutover',
    name: 'Contentful cutover',
    sourceId: 'contentful-main',
    recipeIds: ['contentful-page'],
    mode: 'dual-run',
  });
  return { contentRepository, contentService, migrationRepository, source, service };
}

describe('MigrationService', () => {
  it('plans, executes, retries, delta-syncs, and validates a current published cutover', async () => {
    const { contentRepository, source, service } = await fixture();
    try {
      source.records = [sourceRecord('Hello World')];
      const initial = await service.planSync(scope, 'admin-a', 'contentful-cutover');
      expect(initial).toMatchObject({
        snapshotKind: 'full',
        counts: { create: 1, publish: 1, blocked: 0 },
      });
      expect(initial.effects[0]).not.toHaveProperty('mappedData');
      const run = await service.executePlan(
        scope,
        { id: 'admin-a', roles: ['admin'] },
        initial.id,
        initial.digest,
      );
      expect(run.state).toBe('succeeded');
      await expect(
        service.executePlan(scope, { id: 'admin-a' }, initial.id, initial.digest),
      ).resolves.toEqual(run);
      const overview = await service.overview(scope);
      expect(overview.projects[0]).toMatchObject({
        checkpointDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(overview.projects[0]).not.toHaveProperty('checkpoint');

      source.records = [sourceRecord('Hello Again')];
      const delta = await service.planSync(scope, 'admin-a', 'contentful-cutover');
      expect(delta).toMatchObject({ snapshotKind: 'delta', counts: { update: 1, publish: 1 } });
      await service.executePlan(scope, { id: 'admin-a' }, delta.id, delta.digest);
      const targetId = delta.effects[0]?.targetEntryId;
      if (!targetId) throw new Error('Expected target ID.');
      expect(
        await contentRepository.getById({ scope, id: targetId, perspective: 'published' }),
      ).toMatchObject({ data: { title: 'Hello Again', slug: 'hello-again' } });

      const report = await service.validateCutover(scope, 'admin-a', 'contentful-cutover');
      expect(report).toMatchObject({
        ready: true,
        sourceCount: 1,
        currentCount: 1,
        publishedCount: 1,
      });
      expect(source.reads.map((read) => read.mode)).toEqual(['full', 'delta', 'full']);
    } finally {
      contentRepository.close();
    }
  });

  it('blocks target drift and reports source deletions without destructive propagation', async () => {
    const { contentRepository, contentService, source, service } = await fixture();
    try {
      source.records = [sourceRecord('Original')];
      const initial = await service.planSync(scope, 'admin-a', 'contentful-cutover');
      await service.executePlan(scope, { id: 'admin-a' }, initial.id, initial.digest);
      const targetId = initial.effects[0]?.targetEntryId;
      if (!targetId) throw new Error('Expected target ID.');
      const current = await contentService.get({ scope, id: targetId });
      await contentService.updateDraft({
        scope,
        id: targetId,
        expectedRevisionId: current.draftRevisionId,
        data: { title: 'Manual target edit', slug: 'manual-target-edit' },
        actor: { id: 'editor-a' },
      });
      source.records = [sourceRecord('Changed at source')];
      const drift = await service.planSync(scope, 'admin-a', 'contentful-cutover');
      expect(drift.counts.blocked).toBe(1);
      expect(drift.effects[0]?.blockers).toEqual([
        expect.objectContaining({ code: 'target-drift' }),
      ]);
      await expect(
        service.executePlan(scope, { id: 'admin-a' }, drift.id, drift.digest),
      ).rejects.toMatchObject({ code: 'migration_plan_blocked' });

      source.records = [sourceRecord('Deleted', 'deleted')];
      const deletion = await service.planSync(scope, 'admin-a', 'contentful-cutover');
      expect(deletion.counts.sourceDeleted).toBe(1);
      await expect(
        service.executePlan(scope, { id: 'admin-a' }, deletion.id, deletion.digest),
      ).rejects.toMatchObject({ code: 'migration_plan_blocked' });
      await expect(contentService.get({ scope, id: targetId })).resolves.toMatchObject({
        data: { title: 'Manual target edit' },
      });
    } finally {
      contentRepository.close();
    }
  });

  it('rejects altered plan digests, recipe changes, and cross-scope project access', async () => {
    const { contentRepository, source, service } = await fixture();
    try {
      source.records = [sourceRecord('Protected')];
      const plan = await service.planSync(scope, 'admin-a', 'contentful-cutover');
      await expect(
        service.executePlan(scope, { id: 'admin-a' }, plan.id, '0'.repeat(64)),
      ).rejects.toThrow('digest');
      await service.upsertRecipe(scope, 'admin-b', {
        id: 'contentful-page',
        name: 'Contentful page changed',
        provider: 'contentful',
        sourceType: 'contentful.Entry.page',
        targetContentType: 'page',
        fields: [
          { sourcePath: 'fields.title', targetField: 'title', transform: 'string', required: true },
          { sourcePath: 'fields.slug', targetField: 'slug', transform: 'slug', required: true },
        ],
      });
      await expect(
        service.executePlan(scope, { id: 'admin-a' }, plan.id, plan.digest),
      ).rejects.toThrow('recipe changed');
      await expect(
        service.planSync({ ...scope, tenantId: 'tenant-b' }, 'admin-a', 'contentful-cutover'),
      ).rejects.toMatchObject({ code: 'not_found' });
    } finally {
      contentRepository.close();
    }
  });

  it('recovers a target written before a process failure without duplicating it or advancing early', async () => {
    let failAfterCreate = true;
    const workflowGate: ContentWorkflowGate = {
      async contentCreated() {
        if (failAfterCreate) {
          failAfterCreate = false;
          throw new Error('Simulated process interruption after the durable content write.');
        }
      },
      async draftUpdated() {},
      async assertCanPublish() {},
      async contentPublished() {},
    };
    const { contentRepository, migrationRepository, source, service } = await fixture({
      workflowGate,
    });
    try {
      source.records = [sourceRecord('Retry Safe')];
      const plan = await service.planSync(scope, 'admin-a', 'contentful-cutover');
      await expect(
        service.executePlan(scope, { id: 'admin-a' }, plan.id, plan.digest),
      ).rejects.toThrow('Simulated process interruption');

      const interrupted = migrationRepository.get(scope);
      expect(interrupted?.projects[0]).not.toHaveProperty('checkpoint');
      expect(interrupted?.links).toEqual([
        expect.objectContaining({ externalId: 'entry-1', state: 'pending', planId: plan.id }),
      ]);
      expect(await contentRepository.list({ scope, perspective: 'draft' })).toHaveLength(1);

      await expect(
        service.executePlan(scope, { id: 'admin-a' }, plan.id, plan.digest),
      ).resolves.toMatchObject({ state: 'succeeded', planId: plan.id });
      const recovered = migrationRepository.get(scope);
      expect(recovered?.projects[0]).toHaveProperty('checkpoint', 'checkpoint-1');
      expect(recovered?.links).toEqual([
        expect.objectContaining({ externalId: 'entry-1', state: 'applied', planId: plan.id }),
      ]);
      expect(await contentRepository.list({ scope, perspective: 'draft' })).toHaveLength(1);
    } finally {
      contentRepository.close();
    }
  });
});
