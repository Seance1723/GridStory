import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

const baseHeaders = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'workflow-tenant',
};
const page = {
  title: 'Governed workflow page',
  slug: 'governed-workflow-page',
  story: {
    version: 1,
    blocks: [
      {
        id: 'workflow-story',
        type: 'paragraph',
        content: [{ type: 'text', text: 'A governed editorial workflow test.', marks: [] }],
      },
    ],
  },
  blocks: [
    {
      id: 'workflow-hero',
      component: 'gridstory.hero',
      version: 1,
      props: {
        eyebrow: 'Governance',
        heading: 'Governed workflow page',
        body: 'A governed editorial workflow test.',
        tone: 'indigo',
      },
    },
  ],
};

describe('workflow API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('versions definitions and enforces private scoped approval, separation, and scheduling', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const adminHeaders = {
      ...baseHeaders,
      'x-gridstory-actor': 'workflow-admin',
      'x-gridstory-roles': 'admin',
    };
    const definitions = await server.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: adminHeaders,
    });
    expect(definitions.statusCode).toBe(200);
    expect(definitions.headers['cache-control']).toBe('private, no-store');
    const defaultDefinitions = definitions.json();
    expect(defaultDefinitions).toHaveLength(2);
    expect(defaultDefinitions.map((definition: { id: string }) => definition.id)).toEqual(
      expect.arrayContaining(['page-editorial', 'article-editorial']),
    );
    const invalidDefinition = await server.inject({
      method: 'PUT',
      url: '/api/v1/workflows/page-editorial',
      headers: adminHeaders,
      payload: { name: 'Broken workflow' },
    });
    expect(invalidDefinition.statusCode).toBe(400);
    expect(invalidDefinition.json().error.code).toBe('invalid_workflow_definition');
    const currentDefinition = defaultDefinitions.find(
      (definition: { id: string }) => definition.id === 'page-editorial',
    );
    expect(currentDefinition).toBeDefined();
    if (!currentDefinition) throw new Error('Expected the page editorial workflow fixture.');
    const updatedDefinition = await server.inject({
      method: 'PUT',
      url: '/api/v1/workflows/page-editorial',
      headers: adminHeaders,
      payload: {
        ...currentDefinition,
        version: 2,
        transitions: currentDefinition.transitions.map((transition: { id: string }) =>
          transition.id === 'submit-review'
            ? {
                ...transition,
                actions: [
                  {
                    id: 'notify-reviewers',
                    label: 'Notify reviewers',
                    type: 'notification',
                    message: 'Review requested.',
                    audienceRoles: ['publisher'],
                    maxAttempts: 3,
                  },
                ],
              }
            : transition,
        ),
      },
    });
    expect(updatedDefinition.statusCode).toBe(200);
    expect(updatedDefinition.json()).toMatchObject({ id: 'page-editorial', version: 2 });

    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: adminHeaders,
      payload: { contentType: 'page', data: page },
    });
    expect(createdResponse.statusCode).toBe(201);
    const entry = createdResponse.json();

    const blocked = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/publish`,
      headers: adminHeaders,
      payload: { expectedRevisionId: entry.draftRevisionId },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('workflow_publish_blocked');

    const requesterHeaders = {
      ...baseHeaders,
      'x-gridstory-actor': 'publisher-requester',
      'x-gridstory-roles': 'publisher',
    };
    const submitted = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/transitions/submit-review`,
      headers: requesterHeaders,
      payload: { changedFields: ['title'] },
    });
    expect(submitted.json().stateId).toBe('in-review');
    const queuedActions = await server.inject({
      method: 'GET',
      url: '/api/v1/workflow-actions',
      headers: adminHeaders,
    });
    expect(queuedActions.statusCode).toBe(200);
    expect(queuedActions.headers['cache-control']).toBe('private, no-store');
    expect(queuedActions.json()).toEqual([
      expect.objectContaining({ type: 'workflow.action', state: 'pending', attempts: 0 }),
    ]);
    const drainedActions = await server.inject({
      method: 'POST',
      url: '/api/v1/workflow-actions/drain',
      headers: adminHeaders,
      payload: { limit: 20 },
    });
    expect(drainedActions.statusCode).toBe(200);
    expect(drainedActions.json()).toMatchObject({
      reconciliation: { discovered: 1, reconciled: 1 },
      delivery: { completedJobs: 4 },
    });
    const completedActions = await server.inject({
      method: 'GET',
      url: '/api/v1/workflow-actions',
      headers: adminHeaders,
    });
    const completedActionId = completedActions.json()[0].id;
    expect(completedActions.json()[0]).toMatchObject({ state: 'succeeded', attempts: 1 });
    const replayedAction = await server.inject({
      method: 'POST',
      url: `/api/v1/workflow-actions/${completedActionId}/replay`,
      headers: adminHeaders,
      payload: {},
    });
    expect(replayedAction.statusCode).toBe(200);
    expect(replayedAction.json()).toMatchObject({ state: 'pending', attempts: 0 });
    const requested = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/transitions/approve`,
      headers: requesterHeaders,
      payload: { changedFields: ['title'] },
    });
    const requestId = requested.json().pendingApproval.id;

    const selfApproval = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/approvals/${requestId}`,
      headers: requesterHeaders,
      payload: { decision: 'approved' },
    });
    expect(selfApproval.statusCode).toBe(403);
    expect(selfApproval.json().error.code).toBe('workflow_separation_of_duties');

    const viewerApproval = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/approvals/${requestId}`,
      headers: {
        ...baseHeaders,
        'x-gridstory-actor': 'viewer-reviewer',
        'x-gridstory-roles': 'viewer',
      },
      payload: { decision: 'approved' },
    });
    expect(viewerApproval.statusCode).toBe(403);
    expect(viewerApproval.json().error.code).toBe('forbidden');

    const reviewerHeaders = {
      ...baseHeaders,
      'x-gridstory-actor': 'publisher-reviewer',
      'x-gridstory-roles': 'publisher',
    };
    const approved = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/approvals/${requestId}`,
      headers: reviewerHeaders,
      payload: { decision: 'approved', comment: 'Ready for release.' },
    });
    expect(approved.json()).toMatchObject({ stateId: 'approved', workflowVersion: 2 });

    const runAt = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/workflow/schedules`,
      headers: reviewerHeaders,
      payload: { transitionId: 'publish', runAt, timeZone: 'Asia/Kolkata' },
    });
    expect(scheduled.statusCode).toBe(201);
    expect(scheduled.json().schedules[0]).toMatchObject({
      transitionId: 'publish',
      timeZone: 'Asia/Kolkata',
      state: 'pending',
    });
    const scheduleId = scheduled.json().schedules[0].id;
    const cancelled = await server.inject({
      method: 'DELETE',
      url: `/api/v1/content/${entry.id}/workflow/schedules/${scheduleId}`,
      headers: {
        'x-gridstory-tenant': 'workflow-tenant',
        'x-gridstory-actor': 'publisher-reviewer',
        'x-gridstory-roles': 'publisher',
      },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().schedules[0].state).toBe('cancelled');

    const published = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/publish`,
      headers: reviewerHeaders,
      payload: { expectedRevisionId: entry.draftRevisionId },
    });
    expect(published.statusCode).toBe(200);
    const workflow = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${entry.id}/workflow`,
      headers: reviewerHeaders,
    });
    expect(workflow.json().stateId).toBe('published');
    expect(JSON.stringify(workflow.json().notifications)).not.toContain(
      page.story.blocks[0]?.content[0]?.text,
    );

    const crossedTenant = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${entry.id}/workflow`,
      headers: { ...reviewerHeaders, 'x-gridstory-tenant': 'other-tenant' },
    });
    expect(crossedTenant.statusCode).toBe(404);
  });
});
