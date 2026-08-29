import { InMemoryReleaseRepository, InMemoryWorkflowRepository } from '@gridstory/core';
import { editorialOverviewSchema } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';

const scopeHeaders = {
  'x-gridstory-organization': 'local',
  'x-gridstory-tenant': 'default',
  'x-gridstory-workspace': 'default',
  'x-gridstory-site': 'default',
  'x-gridstory-environment': 'development',
  'x-gridstory-locale': 'en',
  'x-gridstory-actor': 'editorial-fixture',
};

describe('editorial overview route', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
  });

  async function server(options: Parameters<typeof buildServer>[0] = {}) {
    const value = await buildServer({ databasePath: ':memory:', ...options });
    servers.push(value);
    return value;
  }

  it('returns a strict private scoped overview with exact bounds and minimized widgets', async () => {
    const value = await server();
    const response = await value.inject({
      method: 'GET',
      url: '/api/v1/editorial/overview',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'admin' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const overview = editorialOverviewSchema.parse(response.json());
    expect(overview.scope).toEqual({
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
    });
    expect(overview.widgets.content).toMatchObject({
      availability: 'available',
      coverage: 'all-registered',
      exact: true,
      bounds: { totalCount: 2, displayedCount: 2, limit: 5, hasMore: false },
    });
    expect(overview.widgets.reviews.availability).toBe('available');
    expect(overview.widgets.releases).toMatchObject({
      availability: 'available',
      bounds: { totalCount: 0, displayedCount: 0 },
    });
    expect(overview.widgets.operations.availability).toBe('available');
    const serialized = JSON.stringify(overview);
    for (const forbidden of [
      'principal',
      'roles',
      'draftRevisionId',
      'publishedRevisionId',
      'data',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('loads only widgets backed by existing permissions and denies an unmapped caller', async () => {
    const workflowRepository = new InMemoryWorkflowRepository();
    const listInstances = vi.spyOn(workflowRepository, 'listInstances');
    const listDefinitions = vi.spyOn(workflowRepository, 'listDefinitions');
    const value = await server({ workflowRepository });
    listInstances.mockClear();
    listDefinitions.mockClear();
    const viewer = await value.inject({
      method: 'GET',
      url: '/api/v1/editorial/overview',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'viewer' },
    });
    expect(viewer.statusCode, viewer.body).toBe(200);
    const overview = editorialOverviewSchema.parse(viewer.json());
    expect(overview.widgets.content.availability).toBe('available');
    expect(overview.widgets.reviews).toEqual({ availability: 'unavailable' });
    expect(overview.widgets.releases.availability).toBe('available');
    expect(overview.widgets.operations).toEqual({ availability: 'unavailable' });
    expect(listInstances).not.toHaveBeenCalled();
    expect(listDefinitions).not.toHaveBeenCalled();

    const denied = await value.inject({
      method: 'GET',
      url: '/api/v1/editorial/overview',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'unmapped' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['cache-control']).toBe('private, no-store');
    expect(denied.body).not.toContain('operations');
  });

  it('rejects development identity headers at the production authentication boundary', async () => {
    const value = await server({ identity: { mode: 'production' } });
    const response = await value.inject({
      method: 'GET',
      url: '/api/v1/editorial/overview',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'admin' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).not.toContain('editorial-fixture');
  });

  it('rejects inputs, isolates source errors and never reflects their details', async () => {
    const releaseRepository = new InMemoryReleaseRepository();
    vi.spyOn(releaseRepository, 'list').mockRejectedValue(new Error('private repository detail'));
    const value = await server({ releaseRepository });
    const invalid = await value.inject({
      method: 'GET',
      url: '/api/v1/editorial/overview?limit=500',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'admin' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers['cache-control']).toBe('private, no-store');

    const response = await value.inject({
      method: 'GET',
      url: '/api/v1/editorial/overview',
      headers: { ...scopeHeaders, 'x-gridstory-roles': 'admin' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const overview = editorialOverviewSchema.parse(response.json());
    expect(overview.widgets.content.availability).toBe('available');
    expect(overview.widgets.releases).toEqual({
      availability: 'error',
      reason: 'source-unavailable',
    });
    expect(response.body).not.toContain('private repository detail');
  });
});
