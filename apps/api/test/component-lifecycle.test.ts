import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { approveForPublication } from './workflow-helpers.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'component-tenant',
  'x-gridstory-actor': 'component-admin',
};
const page = {
  title: 'Component page',
  slug: 'component-page',
  blocks: [
    {
      id: 'hero-1',
      component: 'gridstory.hero',
      version: 1,
      props: { eyebrow: '', heading: 'Component page', body: 'Governed.', tone: 'indigo' },
    },
  ],
};

describe('component lifecycle API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    if (server) await server.close();
  });

  it('returns private scoped usage, migration impact, and visual hooks', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: page },
    });
    const created = createdResponse.json();
    await approveForPublication(server, created, headers);
    await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers,
      payload: { expectedRevisionId: created.draftRevisionId },
    });

    const usage = await server.inject({
      method: 'GET',
      url: '/api/v1/components/gridstory.hero/usage',
      headers,
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.headers['cache-control']).toBe('private, no-store');
    expect(usage.json().byPerspective).toEqual({ draft: 1, published: 1 });

    const migration = await server.inject({
      method: 'GET',
      url: '/api/v1/components/gridstory.hero/migration',
      headers,
    });
    expect(migration.statusCode).toBe(200);
    expect(migration.json()).toMatchObject({ outdatedInstances: 0, ready: true });

    const visual = await server.inject({
      method: 'GET',
      url: '/api/v1/components/gridstory.hero/visual-regression',
      headers,
    });
    expect(visual.statusCode).toBe(200);
    expect(visual.json().scenarios).toHaveLength(1);
    expect(visual.json().selector).toContain('data-gridstory-version');
  });
});
