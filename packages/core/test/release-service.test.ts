import { afterEach, describe, expect, it } from 'vitest';
import type {
  ComponentManifest,
  ContentEntry,
  ContentSchemaDefinition,
  ContentScope,
} from '@gridstory/schema';
import {
  ContentService,
  InMemoryReleaseRepository,
  InMemoryWorkflowRepository,
  ReleaseService,
  SqliteContentRepository,
  WorkflowService,
  defaultEditorialWorkflow,
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
const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};
const requester = { id: 'publisher-requester', roles: ['publisher'] };
const reviewer = { id: 'publisher-reviewer', roles: ['publisher'] };
const page = (title: string, slug: string) => ({
  title,
  slug,
  blocks: [{ id: `hero-${slug}`, component: 'hero', version: 1, props: { heading: title } }],
});

describe('ReleaseService', () => {
  const repositories: SqliteContentRepository[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) repository.close();
  });

  async function harness(
    analyticsAnnotator?: ConstructorParameters<typeof ReleaseService>[0]['analyticsAnnotator'],
  ) {
    let clock = new Date('2026-07-26T00:00:00.000Z');
    let id = 0;
    const workflow = new WorkflowService({
      repository: new InMemoryWorkflowRepository(),
      defaultDefinitions: [{ id: 'page-editorial', definition: defaultEditorialWorkflow() }],
      now: () => clock,
      createId: () => `workflow-${++id}`,
    });
    const contentRepository = new SqliteContentRepository({ filename: ':memory:' });
    repositories.push(contentRepository);
    const content = new ContentService({
      repository: contentRepository,
      schemas: [schema],
      componentManifests: [manifest],
      workflowGate: workflow,
    });
    const releases = new ReleaseService({
      repository: new InMemoryReleaseRepository(),
      contentService: content,
      now: () => clock,
      createId: () => `release-${++id}`,
      ...(analyticsAnnotator ? { analyticsAnnotator } : {}),
    });
    return {
      content,
      contentRepository,
      workflow,
      releases,
      setClock(value: string) {
        clock = new Date(value);
      },
    };
  }

  async function approve(workflow: WorkflowService, entry: ContentEntry): Promise<void> {
    await workflow.requestTransition({
      scope,
      entry,
      transitionId: 'submit-review',
      actor: requester,
    });
    const pending = await workflow.requestTransition({
      scope,
      entry,
      transitionId: 'approve',
      actor: requester,
    });
    await workflow.decideApproval({
      scope,
      entry,
      requestId: pending.pendingApproval?.id ?? '',
      decision: 'approved',
      actor: reviewer,
    });
  }

  async function initiallyPublished(
    harnessValue: Awaited<ReturnType<typeof harness>>,
    slug: string,
  ) {
    const created = await harnessValue.content.create({
      scope,
      contentType: 'page',
      data: page(`${slug} initial`, slug),
      actor: requester,
    });
    await approve(harnessValue.workflow, created);
    return await harnessValue.content.publish({
      scope,
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      actor: reviewer,
    });
  }

  async function revise(
    harnessValue: Awaited<ReturnType<typeof harness>>,
    entry: ContentEntry,
    title: string,
    slug: string,
  ) {
    const revised = await harnessValue.content.updateDraft({
      scope,
      id: entry.id,
      expectedRevisionId: entry.draftRevisionId,
      data: page(title, slug),
      actor: requester,
    });
    await approve(harnessValue.workflow, revised);
    return revised;
  }

  it('previews and atomically publishes two pinned revisions, then restores both', async () => {
    const annotations: string[] = [];
    const value = await harness(async (annotation) => {
      annotations.push(annotation.name);
      if (annotation.name === 'release.rolled_back') throw new Error('analytics queue unavailable');
    });
    const firstPublished = await initiallyPublished(value, 'first');
    const secondPublished = await initiallyPublished(value, 'second');
    const first = await revise(value, firstPublished, 'First launch', 'first');
    const second = await revise(value, secondPublished, 'Second launch', 'second');

    let release = await value.releases.create({
      scope,
      release: {
        name: 'Coordinated launch',
        entries: [
          { entryId: first.id, revisionId: first.draftRevisionId },
          { entryId: second.id, revisionId: second.draftRevisionId },
        ],
        rollbackPolicy: { mode: 'manual' },
      },
      actor: reviewer,
    });
    release = await value.releases.validate({ scope, id: release.id, actor: reviewer });
    expect(release.validation).toMatchObject({ valid: true, issues: [] });
    const preview = await value.releases.preview(scope, release.id);
    expect(preview.entries.map((entry) => [entry.route, entry.data.title])).toEqual([
      ['/first', 'First launch'],
      ['/second', 'Second launch'],
    ]);

    release = await value.releases.execute({ scope, id: release.id, actor: reviewer });
    expect(release.state).toBe('published');
    expect(annotations).toEqual(['release.published']);
    expect(
      (await value.content.get({ scope, id: first.id, perspective: 'published' })).data.title,
    ).toBe('First launch');
    expect(
      (await value.content.get({ scope, id: second.id, perspective: 'published' })).data.title,
    ).toBe('Second launch');

    release = await value.releases.rollback({
      scope,
      id: release.id,
      reason: 'Launch rollback drill',
      actor: reviewer,
    });
    expect(release).toMatchObject({
      state: 'rolled-back',
      rollbackReason: 'Launch rollback drill',
    });
    expect(annotations).toEqual(['release.published', 'release.rolled_back']);
    expect(
      (await value.content.get({ scope, id: first.id, perspective: 'published' })).data.title,
    ).toBe('first initial');
    expect(
      (await value.content.get({ scope, id: second.id, perspective: 'published' })).data.title,
    ).toBe('second initial');
  });

  it('fails a stale or route-colliding release without changing either published pointer', async () => {
    const value = await harness();
    const firstPublished = await initiallyPublished(value, 'first');
    const secondPublished = await initiallyPublished(value, 'second');
    const first = await revise(value, firstPublished, 'First collision', 'shared');
    const second = await revise(value, secondPublished, 'Second collision', 'shared');
    const release = await value.releases.create({
      scope,
      release: {
        name: 'Invalid launch',
        entries: [
          { entryId: first.id, revisionId: first.draftRevisionId },
          { entryId: second.id, revisionId: second.draftRevisionId },
        ],
        rollbackPolicy: { mode: 'disabled' },
      },
      actor: reviewer,
    });

    const validation = await value.releases.validate({ scope, id: release.id, actor: reviewer });
    expect(validation.validation?.valid).toBe(false);
    expect(validation.validation?.issues.map((issue) => issue.code)).toContain('route-collision');
    await expect(
      value.releases.execute({ scope, id: release.id, actor: reviewer }),
    ).rejects.toMatchObject({ code: 'release_validation_failed' });
    expect(
      (await value.content.get({ scope, id: first.id, perspective: 'published' })).data.title,
    ).toBe('first initial');
    expect(
      (await value.content.get({ scope, id: second.id, perspective: 'published' })).data.title,
    ).toBe('second initial');
  });

  it('executes a persisted IANA-zone schedule only after its absolute instant is due', async () => {
    const value = await harness();
    const first = await value.content.create({
      scope,
      contentType: 'page',
      data: page('First scheduled', 'first-scheduled'),
      actor: requester,
    });
    const second = await value.content.create({
      scope,
      contentType: 'page',
      data: page('Second scheduled', 'second-scheduled'),
      actor: requester,
    });
    await approve(value.workflow, first);
    await approve(value.workflow, second);
    let release = await value.releases.create({
      scope,
      release: {
        name: 'Scheduled launch',
        entries: [
          { entryId: first.id, revisionId: first.draftRevisionId },
          { entryId: second.id, revisionId: second.draftRevisionId },
        ],
        rollbackPolicy: { mode: 'disabled' },
      },
      actor: reviewer,
    });
    release = await value.releases.schedule({
      scope,
      id: release.id,
      runAt: '2026-07-26T01:00:00.000Z',
      timeZone: 'Asia/Kolkata',
      actor: reviewer,
    });
    expect(release).toMatchObject({ state: 'scheduled', schedule: { timeZone: 'Asia/Kolkata' } });
    expect(await value.releases.processDue(scope)).toEqual({ executed: 0, failed: 0 });
    value.setClock('2026-07-26T01:00:01.000Z');
    expect(await value.releases.processDue(scope)).toEqual({ executed: 1, failed: 0 });
    expect((await value.releases.get(scope, release.id)).state).toBe('published');
  });

  it('keeps all pointers unchanged when repository validation fails before an atomic write', async () => {
    const value = await harness();
    const first = await value.content.create({
      scope,
      contentType: 'page',
      data: page('Atomic first', 'atomic-first'),
      actor: requester,
    });
    const second = await value.content.create({
      scope,
      contentType: 'page',
      data: page('Atomic second', 'atomic-second'),
      actor: requester,
    });
    expect(() =>
      value.contentRepository.publishMany({
        scope,
        entries: [
          {
            entryId: first.id,
            targetRevisionId: first.draftRevisionId,
            expectedDraftRevisionId: first.draftRevisionId,
            expectedPublishedRevisionId: null,
          },
          {
            entryId: second.id,
            targetRevisionId: 'missing-revision',
            expectedDraftRevisionId: second.draftRevisionId,
            expectedPublishedRevisionId: null,
          },
        ],
        actor: reviewer,
      }),
    ).toThrow('The target release revision was not found.');
    await expect(
      value.content.get({ scope, id: first.id, perspective: 'published' }),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      value.content.get({ scope, id: second.id, perspective: 'published' }),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
