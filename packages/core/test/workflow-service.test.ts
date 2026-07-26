import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentManifest, ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import {
  ContentService,
  GridStoryError,
  OperationsService,
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

  async function harness(definition = defaultEditorialWorkflow()) {
    let clock = new Date('2026-07-26T00:00:00.000Z');
    let id = 0;
    const contentRepository = new SqliteContentRepository({
      filename: ':memory:',
      now: () => clock.toISOString(),
    });
    repositories.push(contentRepository);
    const workflowRepository = new InMemoryWorkflowRepository();
    const workflow = new WorkflowService({
      repository: workflowRepository,
      jobRepository: contentRepository,
      now: () => clock,
      createId: () => `workflow-id-${++id}`,
    });
    await workflow.saveDefinition({
      scope,
      id: 'page-editorial',
      definition,
    });
    const content = new ContentService({
      repository: contentRepository,
      schemas: [schema],
      componentManifests: [manifest],
      workflowGate: workflow,
    });
    return {
      workflow,
      content,
      contentRepository,
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

  it('enqueues transition actions idempotently and records retries, dead letters, replay, and delivery results', async () => {
    const definition = defaultEditorialWorkflow();
    const submit = definition.transitions.find((transition) => transition.id === 'submit-review');
    if (!submit) throw new Error('Submit transition fixture was not found.');
    submit.actions = [
      {
        id: 'notify-reviewers',
        label: 'Notify reviewers',
        type: 'notification',
        message: 'A page is ready for review.',
        audienceRoles: ['publisher'],
        maxAttempts: 3,
      },
      {
        id: 'transient-webhook',
        label: 'Transient webhook',
        type: 'webhook',
        url: 'https://hooks.example.test/transient',
        eventName: 'review-requested',
        maxAttempts: 2,
      },
      {
        id: 'dead-webhook',
        label: 'Dead webhook',
        type: 'webhook',
        url: 'https://hooks.example.test/dead',
        eventName: 'review-requested',
        maxAttempts: 1,
      },
    ];
    const { workflow, content, contentRepository, setClock } = await harness(definition);
    const entry = await content.create({
      scope,
      contentType: 'page',
      data: page('Actions'),
      actor: { id: 'author-a', roles: ['author'] },
    });
    await workflow.requestTransition({
      scope,
      entry,
      transitionId: 'submit-review',
      actor: { id: 'author-a', roles: ['author'] },
    });

    const initialActions = (await contentRepository.listJobs({ scope })).filter(
      (job) => job.type === 'workflow.action',
    );
    expect(initialActions).toHaveLength(3);
    expect(initialActions.every((job) => job.payload.workflowVersion === 1)).toBe(true);
    await workflow.saveDefinition({
      scope,
      id: 'page-editorial',
      definition: { ...definition, version: 2 },
    });
    const upgraded = await workflow.requestTransition({
      scope,
      entry,
      transitionId: 'request-changes',
      actor: { id: 'publisher-b', roles: ['publisher'] },
    });
    expect(upgraded.workflowVersion).toBe(2);
    await workflow.reconcileActions(scope);
    await workflow.reconcileActions(scope);
    expect(
      (await contentRepository.listJobs({ scope })).filter((job) => job.type === 'workflow.action'),
    ).toHaveLength(3);
    expect(
      (await contentRepository.listJobs({ scope }))
        .filter((job) => job.type === 'workflow.action')
        .every((job) => job.idempotencyKey.startsWith('workflow:page-editorial:1:')),
    ).toBe(true);

    const notifications: string[] = [];
    let transientFailures = 1;
    const operations = new OperationsService({
      repository: contentRepository,
      webhookSigningSecret: 'workflow-action-secret-with-at-least-32-characters',
      now: () => new Date('2026-07-26T00:00:00.000Z'),
      searchJobRunner: async () => ({ indexedDocuments: 1 }),
      workflowActionNotifier: async ({ message }) => {
        notifications.push(message);
      },
      webhookTransport: async ({ url }) => {
        if (url.endsWith('/dead')) throw new Error('permanent delivery failure');
        if (transientFailures > 0) {
          transientFailures -= 1;
          throw new Error('temporary delivery failure');
        }
        return { status: 202 };
      },
    });
    expect(await operations.drain({ scope, workerId: 'workflow-worker', limit: 20 })).toMatchObject(
      {
        completedJobs: 3,
        retriedJobs: 1,
        deadJobs: 1,
      },
    );
    expect(notifications).toEqual(['A page is ready for review.']);

    setClock('2026-07-26T00:00:03.000Z');
    const retryOperations = new OperationsService({
      repository: contentRepository,
      webhookSigningSecret: 'workflow-action-secret-with-at-least-32-characters',
      now: () => new Date('2026-07-26T00:00:03.000Z'),
      searchJobRunner: async () => ({ indexedDocuments: 1 }),
      webhookTransport: async () => ({ status: 202 }),
    });
    expect(
      await retryOperations.drain({ scope, workerId: 'workflow-worker', limit: 20 }),
    ).toMatchObject({ completedJobs: 1, retriedJobs: 0 });
    const deliveries = await retryOperations.listWorkflowActions(scope);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'succeeded',
          attempts: 2,
          result: { httpStatus: 202 },
        }),
        expect.objectContaining({
          state: 'dead',
          attempts: 1,
          lastError: 'permanent delivery failure',
        }),
      ]),
    );
    const dead = deliveries.find((job) => job.state === 'dead');
    const replay = await retryOperations.replayWorkflowAction(scope, dead?.id ?? '');
    expect(replay).toMatchObject({ type: 'workflow.action', state: 'pending', attempts: 0 });
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
