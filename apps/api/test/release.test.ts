import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { approveForPublication } from './workflow-helpers.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'release-tenant',
  'x-gridstory-actor': 'release-admin',
  'x-gridstory-roles': 'admin',
};
const page = (title: string, slug: string) => ({
  title,
  slug,
  story: {
    version: 1,
    blocks: [
      {
        id: `story-${slug}`,
        type: 'paragraph',
        content: [{ type: 'text', text: `${title} release story.`, marks: [] }],
      },
    ],
  },
  blocks: [
    {
      id: `hero-${slug}`,
      component: 'gridstory.hero',
      version: 1,
      props: {
        eyebrow: 'Release',
        heading: title,
        body: `${title} coordinated release body.`,
        tone: 'indigo',
      },
    },
  ],
});

describe('release API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function createAndPublish(title: string, slug: string) {
    const created = await server?.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: page(title, slug) },
    });
    expect(created?.statusCode).toBe(201);
    const entry = created?.json();
    await approveForPublication(server as FastifyInstance, entry, headers);
    const published = await server?.inject({
      method: 'POST',
      url: `/api/v1/content/${entry.id}/publish`,
      headers,
      payload: { expectedRevisionId: entry.draftRevisionId },
    });
    expect(published?.statusCode, published?.body).toBe(200);
    return entry;
  }

  async function revise(
    entry: { id: string; draftRevisionId: string },
    title: string,
    slug: string,
  ) {
    const response = await server?.inject({
      method: 'PUT',
      url: `/api/v1/content/${entry.id}/draft`,
      headers,
      payload: { expectedRevisionId: entry.draftRevisionId, data: page(title, slug) },
    });
    expect(response?.statusCode, response?.body).toBe(200);
    const revised = response?.json();
    await approveForPublication(server as FastifyInstance, revised, headers);
    return revised;
  }

  it('validates, previews, schedules, atomically publishes, scopes, and rolls back a release', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const firstInitial = await createAndPublish('First initial', 'release-first');
    const secondInitial = await createAndPublish('Second initial', 'release-second');
    const first = await revise(firstInitial, 'First future', 'release-first');
    const second = await revise(secondInitial, 'Second future', 'release-second');

    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/releases',
      headers,
      payload: {
        name: 'API coordinated release',
        entries: [
          { entryId: first.id, revisionId: first.draftRevisionId },
          { entryId: second.id, revisionId: second.draftRevisionId },
        ],
        rollbackPolicy: { mode: 'manual' },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    const release = created.json();

    const crossedTenant = await server.inject({
      method: 'GET',
      url: `/api/v1/releases/${release.id}`,
      headers: { ...headers, 'x-gridstory-tenant': 'other-tenant' },
    });
    expect(crossedTenant.statusCode).toBe(404);

    const validated = await server.inject({
      method: 'POST',
      url: `/api/v1/releases/${release.id}/validate`,
      headers,
      payload: {},
    });
    expect(validated.statusCode, validated.body).toBe(200);
    expect(validated.json()).toMatchObject({ state: 'validated', validation: { valid: true } });

    const preview = await server.inject({
      method: 'GET',
      url: `/api/v1/releases/${release.id}/preview`,
      headers,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect(
      preview.json().entries.map((entry: { data: { title: string } }) => entry.data.title),
    ).toEqual(['First future', 'Second future']);

    const scheduled = await server.inject({
      method: 'POST',
      url: `/api/v1/releases/${release.id}/schedule`,
      headers,
      payload: { runAt: new Date(Date.now() + 60_000).toISOString(), timeZone: 'Asia/Kolkata' },
    });
    expect(scheduled.statusCode, scheduled.body).toBe(201);
    expect(scheduled.json()).toMatchObject({
      state: 'scheduled',
      schedule: { state: 'pending', timeZone: 'Asia/Kolkata' },
    });
    const cancelled = await server.inject({
      method: 'DELETE',
      url: `/api/v1/releases/${release.id}/schedule`,
      headers: {
        'x-gridstory-tenant': headers['x-gridstory-tenant'],
        'x-gridstory-actor': headers['x-gridstory-actor'],
        'x-gridstory-roles': headers['x-gridstory-roles'],
      },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({
      state: 'validated',
      schedule: { state: 'cancelled' },
    });

    const viewerExecute = await server.inject({
      method: 'POST',
      url: `/api/v1/releases/${release.id}/execute`,
      headers: { ...headers, 'x-gridstory-actor': 'release-viewer', 'x-gridstory-roles': 'viewer' },
      payload: {},
    });
    expect(viewerExecute.statusCode).toBe(403);

    const executed = await server.inject({
      method: 'POST',
      url: `/api/v1/releases/${release.id}/execute`,
      headers,
      payload: {},
    });
    expect(executed.statusCode, executed.body).toBe(200);
    expect(executed.json().state).toBe('published');

    const firstDelivery = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/release-first',
      headers,
    });
    const secondDelivery = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/release-second',
      headers,
    });
    expect([firstDelivery.json().data.title, secondDelivery.json().data.title]).toEqual([
      'First future',
      'Second future',
    ]);

    const rolledBack = await server.inject({
      method: 'POST',
      url: `/api/v1/releases/${release.id}/rollback`,
      headers,
      payload: { reason: 'API rollback drill' },
    });
    expect(rolledBack.statusCode, rolledBack.body).toBe(200);
    expect(rolledBack.json()).toMatchObject({
      state: 'rolled-back',
      rollbackReason: 'API rollback drill',
    });
    const restoredFirst = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/release-first',
      headers,
    });
    const restoredSecond = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/release-second',
      headers,
    });
    expect([restoredFirst.json().data.title, restoredSecond.json().data.title]).toEqual([
      'First initial',
      'Second initial',
    ]);
  });
});
