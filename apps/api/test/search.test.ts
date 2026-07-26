import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { approveForPublication } from './workflow-helpers.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'search-tenant',
  'x-gridstory-actor': 'search-admin',
  'x-gridstory-roles': 'admin',
};

function page(title: string, slug: string, topics: string[], relatedPages: unknown[] = []) {
  return {
    title,
    slug,
    story: {
      version: 1,
      blocks: [
        {
          id: `${slug}-story`,
          type: 'paragraph',
          content: [{ type: 'text', text: title, marks: [] }],
        },
      ],
    },
    topics,
    relatedPages,
    blocks: [
      {
        id: `${slug}-hero`,
        component: 'gridstory.hero',
        version: 1,
        props: { eyebrow: 'Search', heading: title, body: title, tone: 'indigo' },
      },
    ],
  };
}

describe('GridStory search API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('searches scoped published content and exposes taxonomies, backlinks, related content, and rebuild status', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const targetResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: page('Launch plan', 'launch-plan', ['launches']) },
    });
    expect(targetResponse.statusCode).toBe(201);
    const target = targetResponse.json();
    await approveForPublication(server, target, headers);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/content/${target.id}/publish`,
          headers,
          payload: { expectedRevisionId: target.draftRevisionId },
        })
      ).statusCode,
    ).toBe(200);

    const sourceResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: {
        contentType: 'page',
        data: page(
          'Product notes',
          'product-notes',
          ['product'],
          [{ id: target.id, contentType: 'page' }],
        ),
      },
    });
    expect(sourceResponse.statusCode).toBe(201);
    const source = sourceResponse.json();
    await approveForPublication(server, source, headers);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/content/${source.id}/publish`,
          headers,
          payload: { expectedRevisionId: source.draftRevisionId },
        })
      ).statusCode,
    ).toBe(200);

    const viewerHeaders = { ...headers, 'x-gridstory-roles': 'viewer' };
    const search = await server.inject({
      method: 'POST',
      url: '/api/v1/search',
      headers: viewerHeaders,
      payload: { text: 'launch', taxonomies: { topics: ['launches'] } },
    });
    expect(search.statusCode).toBe(200);
    expect(search.headers['cache-control']).toBe('private, no-store');
    expect(search.json()).toMatchObject({
      total: 1,
      hits: [{ entry: { id: target.id }, taxonomies: { topics: ['launches'] } }],
      facets: [{ taxonomyId: 'topics', label: 'Topics' }],
    });

    const taxonomies = await server.inject({
      method: 'GET',
      url: '/api/v1/taxonomies',
      headers: viewerHeaders,
    });
    expect(taxonomies.statusCode).toBe(200);
    expect(taxonomies.json()[0]).toMatchObject({ id: 'topics', hierarchical: true });

    const backlinks = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${target.id}/backlinks`,
      headers: viewerHeaders,
    });
    expect(backlinks.json()).toEqual([
      expect.objectContaining({ source: expect.objectContaining({ id: source.id }) }),
    ]);
    const related = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${target.id}/related?limit=5`,
      headers: viewerHeaders,
    });
    expect(related.json()).toEqual([
      expect.objectContaining({ entry: expect.objectContaining({ id: source.id }) }),
    ]);

    const isolated = await server.inject({
      method: 'POST',
      url: '/api/v1/search',
      headers: { ...viewerHeaders, 'x-gridstory-tenant': 'other-tenant' },
      payload: { text: 'launch' },
    });
    expect(isolated.json()).toMatchObject({ total: 0, hits: [] });

    const forbiddenRebuild = await server.inject({
      method: 'POST',
      url: '/api/v1/search/index/rebuild',
      headers: viewerHeaders,
      payload: { perspective: 'published' },
    });
    expect(forbiddenRebuild.statusCode).toBe(403);
    const rebuild = await server.inject({
      method: 'POST',
      url: '/api/v1/search/index/rebuild',
      headers,
      payload: { perspective: 'published' },
    });
    expect(rebuild.statusCode).toBe(202);
    expect(rebuild.json()).toMatchObject({ type: 'search.rebuild', state: 'pending' });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/v1/operations/drain',
          headers,
          payload: { limit: 100 },
        })
      ).statusCode,
    ).toBe(200);
    const status = await server.inject({
      method: 'GET',
      url: '/api/v1/search/index/status',
      headers: viewerHeaders,
    });
    expect(status.json()).toMatchObject({
      adapter: 'repository-scan',
      state: 'ready',
      publishedDocuments: 2,
      pendingJobs: 0,
      deadJobs: 0,
    });

    const invalid = await server.inject({
      method: 'POST',
      url: '/api/v1/search',
      headers: viewerHeaders,
      payload: { text: 42 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('invalid_search');
  });
});
