import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRollingUpgrade } from '../src/rolling-upgrade.js';
import { buildServer } from '../src/server.js';
import { approveForPublication } from './workflow-helpers.js';

const connectionString = process.env.GRIDSTORY_TEST_POSTGRES_URL;
const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'postgres-tenant',
  'x-gridstory-actor': 'postgres-api-test',
};
const page = {
  title: 'PostgreSQL API page',
  slug: 'postgresql-api-page',
  blocks: [
    {
      id: 'postgres-hero',
      component: 'gridstory.hero',
      version: 1,
      props: {
        eyebrow: 'Production adapter',
        heading: 'PostgreSQL API page',
        body: 'Created through the complete API boundary.',
        tone: 'indigo',
      },
    },
  ],
};

describe.skipIf(!connectionString)('GridStory API with PostgreSQL', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('creates, publishes, and delivers content through the production adapter', async () => {
    if (!connectionString) throw new Error('GRIDSTORY_TEST_POSTGRES_URL is required.');
    server = await buildServer({ databaseUrl: connectionString, seed: false });

    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: page },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    await approveForPublication(server, created, headers);

    const managementQuery = await server.inject({
      method: 'POST',
      url: '/api/v1/content/query',
      headers,
      payload: {
        contentType: 'page',
        filter: { path: 'data.title', operator: 'eq', value: page.title },
        projection: ['data.title'],
      },
    });
    expect(managementQuery.statusCode).toBe(200);
    expect(managementQuery.json()).toMatchObject({
      totalCount: 1,
      nodes: [{ id: created.id, data: { title: page.title } }],
    });

    const publishResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers,
      payload: { expectedRevisionId: created.draftRevisionId },
    });
    expect(publishResponse.statusCode).toBe(200);

    const deliveryResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/postgresql-api-page',
      headers,
    });
    expect(deliveryResponse.statusCode).toBe(200);
    expect(deliveryResponse.json()).toMatchObject({ status: 'published', data: page });

    const deliveryQuery = await server.inject({
      method: 'POST',
      url: '/api/v1/delivery/query',
      headers,
      payload: { contentType: 'page' },
    });
    expect(deliveryQuery.statusCode).toBe(200);
    expect(deliveryQuery.json()).toMatchObject({
      totalCount: 1,
      nodes: [{ id: created.id, status: 'published' }],
    });

    const graphql = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers,
      payload: {
        query: `query {
          publishedContents(query: { contentType: "page" }) {
            totalCount
            nodes { id status }
          }
        }`,
      },
    });
    expect(graphql.statusCode).toBe(200);
    expect(graphql.json()).toMatchObject({
      data: {
        publishedContents: {
          totalCount: 1,
          nodes: [{ id: created.id, status: 'published' }],
        },
      },
    });
  });

  it('keeps current and candidate instances ready against the same database', async () => {
    if (!connectionString) throw new Error('GRIDSTORY_TEST_POSTGRES_URL is required.');
    const current = await buildServer({ databaseUrl: connectionString });
    const candidate = await buildServer({ databaseUrl: connectionString, seed: false });
    try {
      const currentUrl = await current.listen({ host: '127.0.0.1', port: 0 });
      const candidateUrl = await candidate.listen({ host: '127.0.0.1', port: 0 });
      await expect(
        checkRollingUpgrade({ currentBaseUrl: currentUrl, candidateBaseUrl: candidateUrl }),
      ).resolves.toMatchObject({ status: 'compatible' });
    } finally {
      await Promise.all([current.close(), candidate.close()]);
    }
  });
});
