import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentManifest, ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import {
  ContentService,
  GridStoryError,
  InMemoryWorkflowRepository,
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
const page = (title: string) => ({
  title,
  slug: title.toLowerCase(),
  blocks: [{ id: 'hero-1', component: 'hero', version: 1, props: { heading: title } }],
});

describe('WorkflowService', () => {
  const repositories: SqliteContentRepository[] = [];
  afterEach(() =>
    repositories.splice(0).forEach((repository) => {
      repository.close();
    }),
  );

  async function harness() {
    let clock = new Date('2026-07-26T00:00:00.000Z');
    let id = 0;
    const workflowRepository = new InMemoryWorkflowRepository();
    const workflow = new WorkflowService({
      repository: workflowRepository,
      now: () => clock,
      createId: () => `workflow-id-${++id}`,
    });
    await workflow.saveDefinition({
      scope,
      id: 'page-editorial',
      definition: defaultEditorialWorkflow(),
    });
    const contentRepository = new SqliteContentRepository({ filename: ':memory:' });
    repositories.push(contentRepository);
    const content = new ContentService({
      repository: contentRepository,
      schemas: [schema],
      componentManifests: [manifest],
      workflowGate: workflow,
    });
    return {
      workflow,
      content,
      setClock(value: string) {
        clock = new Date(value);
      },
    };
  }

  it('gates publication behind a distinct reviewer and resets state for a new draft', async () => {
    const { workflow, content } = await harness();
    const author = { id: 'author-a', roles: ['publisher'] };
    const reviewer = { id: 'reviewer-b', roles: ['publisher'] };
    const entry = await content.create({
      scope,
      contentType: 'page',
      data: page('First'),
      actor: author,
    });

    await expect(
      content.publish({
        scope,
        id: entry.id,
        expectedRevisionId: entry.draftRevisionId,
        actor: reviewer,
      }),
    ).rejects.toMatchObject({ code: 'workflow_publish_blocked' });

    let instance = await workflow.requestTransition({
      scope,
      entry,
      transitionId: 'submit-review',
      actor: author,
      changedFields: ['title'],
    });
    expect(instance.stateId).toBe('in-review');
    instance = await workflow.requestTransition({
      scope,
      entry,
      transitionId: 'approve',
      actor: author,
      changedFields: ['title'],
    });
    expect(instance.pendingApproval).toBeDefined();

    await expect(
      workflow.decideApproval({
        scope,
        entry,
        requestId: instance.pendingApproval?.id ?? '',
        decision: 'approved',
        actor: author,
      }),
    ).rejects.toMatchObject({ code: 'workflow_separation_of_duties' });

    instance = await workflow.decideApproval({
      scope,
      entry,
      requestId: instance.pendingApproval?.id ?? '',
      decision: 'approved',
      actor: reviewer,
    });
    expect(instance.stateId).toBe('approved');
    const published = await content.publish({
      scope,
      id: entry.id,
      expectedRevisionId: entry.draftRevisionId,
      actor: reviewer,
    });
    expect((await workflow.getInstance({ scope, entry: published })).stateId).toBe('published');

    const revised = await content.updateDraft({
      scope,
      id: entry.id,
      expectedRevisionId: published.draftRevisionId,
      data: page('Second'),
      actor: author,
    });
    const reset = await workflow.getInstance({ scope, entry: revised });
    expect(reset).toMatchObject({ stateId: 'draft', revisionId: revised.draftRevisionId });
    expect(reset.notifications.join(' ')).not.toContain('Second');
  });

  it('records deadline escalation and executes a DST-safe scheduled transition', async () => {
    const { workflow, content, setClock } = await harness();
    const author = { id: 'author-a', roles: ['author'] };
    const reviewer = { id: 'reviewer-b', roles: ['publisher'] };
    const approvalEntry = await content.create({
      scope,
      contentType: 'page',
      data: page('Approval'),
      actor: author,
    });
    await workflow.requestTransition({
      scope,
      entry: approvalEntry,
      transitionId: 'submit-review',
      actor: author,
    });
    await workflow.requestTransition({
      scope,
      entry: approvalEntry,
      transitionId: 'approve',
      actor: author,
    });
    setClock('2026-07-27T00:00:01.000Z');
    expect(await workflow.processDue({ scope, execute: async () => undefined })).toMatchObject({
      escalated: 1,
    });
    const escalated = await workflow.getInstance({ scope, entry: approvalEntry });
    expect(escalated.pendingApproval?.escalatedAt).toBe('2026-07-27T00:00:01.000Z');
    expect(escalated.notifications.at(-1)).toMatchObject({
      kind: 'approval-escalated',
      audienceRoles: ['admin'],
    });

    const scheduledEntry = await content.create({
      scope,
      contentType: 'page',
      data: page('Scheduled'),
      actor: author,
    });
    await workflow.requestTransition({
      scope,
      entry: scheduledEntry,
      transitionId: 'submit-review',
      actor: author,
    });
    await workflow.scheduleTransition({
      scope,
      entry: scheduledEntry,
      transitionId: 'request-changes',
      runAt: '2026-07-27T01:00:00.000Z',
      timeZone: 'Asia/Kolkata',
      actor: reviewer,
    });
    setClock('2026-07-27T01:00:01.000Z');
    const result = await workflow.processDue({
      scope,
      execute: async ({ schedule }) => {
        await workflow.requestTransition({
          scope,
          entry: scheduledEntry,
          transitionId: schedule.transitionId,
          actor: { id: schedule.requestedBy, roles: schedule.requestedByRoles },
        });
      },
    });
    expect(result).toMatchObject({ executed: 1, failed: 0 });
    const scheduled = await workflow.getInstance({ scope, entry: scheduledEntry });
    expect(scheduled.stateId).toBe('draft');
    expect(scheduled.schedules[0]).toMatchObject({
      state: 'executed',
      timeZone: 'Asia/Kolkata',
    });
  });

  it('rejects invalid time zones and stale workflow definition versions', async () => {
    const { workflow, content } = await harness();
    const author = { id: 'author-a', roles: ['author'] };
    const entry = await content.create({
      scope,
      contentType: 'page',
      data: page('Draft'),
      actor: author,
    });
    await expect(
      workflow.scheduleTransition({
        scope,
        entry,
        transitionId: 'submit-review',
        runAt: '2026-07-27T01:00:00.000Z',
        timeZone: 'Not/AZone',
        actor: author,
      }),
    ).rejects.toBeInstanceOf(GridStoryError);
    await expect(
      workflow.saveDefinition({
        scope,
        id: 'page-editorial',
        definition: defaultEditorialWorkflow(),
      }),
    ).rejects.toThrow('increment');
  });
});
