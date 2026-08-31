import { afterEach, describe, expect, it } from 'vitest';
import { welcomePage } from '@gridstory/example-kit/manifests';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { approveForPublication } from './workflow-helpers.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'navigation-tenant',
  'x-gridstory-actor': 'navigation-editor',
};

describe('visitor navigation API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('keeps preview private and delivery published-only, minimized and dependency-tagged', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });

    const invalid = await server.inject({
      method: 'POST',
      url: '/api/v1/navigation-menus',
      headers,
      payload: { key: 'Bad Key', name: 'Header' },
    });
    expect(invalid.statusCode).toBe(400);

    const pageResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: {
        contentType: 'page',
        data: { ...welcomePage, title: 'Navigation target', slug: 'navigation-target' },
      },
    });
    expect(pageResponse.statusCode).toBe(201);
    const page = pageResponse.json();

    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/navigation-menus',
      headers,
      payload: { key: 'header', name: 'Header navigation' },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.id).toBe('navigation-menu:header');

    const genericCreate = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: {
        contentType: 'navigation-menu',
        data: { key: 'generic', name: 'Generic', items: [] },
      },
    });
    expect(genericCreate.statusCode).toBe(422);

    const saveResponse = await server.inject({
      method: 'PUT',
      url: `/api/v1/content/${encodeURIComponent(created.id)}/draft`,
      headers,
      payload: {
        expectedRevisionId: created.draftRevisionId,
        data: {
          key: 'header',
          name: 'Header navigation',
          items: [
            {
              id: 'home',
              label: 'Home draft',
              kind: 'internal',
              target: { id: page.id, contentType: 'page' },
            },
          ],
        },
      },
    });
    expect(saveResponse.statusCode).toBe(200);
    const menu = saveResponse.json();

    const preview = await server.inject({
      method: 'GET',
      url: `/api/v1/navigation-menus/${encodeURIComponent(menu.id)}/preview`,
      headers,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect(preview.json()).toMatchObject({
      perspective: 'draft',
      items: [
        {
          label: 'Home draft',
          href: '/navigation-target',
          target: { id: page.id, contentType: 'page' },
        },
      ],
    });
    expect(preview.body).not.toContain('Navigation target');

    const beforePublication = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/navigation-menus/header',
      headers: { 'x-gridstory-tenant': headers['x-gridstory-tenant'] },
    });
    expect(beforePublication.statusCode).toBe(404);

    await approveForPublication(server, menu, headers);
    const blockedMenuPublication = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${encodeURIComponent(menu.id)}/publish`,
      headers,
      payload: { expectedRevisionId: menu.draftRevisionId },
    });
    expect(blockedMenuPublication.statusCode).toBe(422);
    expect(blockedMenuPublication.json().error.details.issues[0].path).toEqual([
      'items',
      0,
      'target',
    ]);

    await approveForPublication(server, page, headers);
    const pagePublication = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${encodeURIComponent(page.id)}/publish`,
      headers,
      payload: { expectedRevisionId: page.draftRevisionId },
    });
    expect(pagePublication.statusCode).toBe(200);
    const menuPublication = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${encodeURIComponent(menu.id)}/publish`,
      headers,
      payload: { expectedRevisionId: menu.draftRevisionId },
    });
    expect(menuPublication.statusCode).toBe(200);

    const delivered = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/navigation-menus/header',
      headers: { 'x-gridstory-tenant': headers['x-gridstory-tenant'] },
    });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.headers['cache-control']).toContain('s-maxage=60');
    expect(delivered.headers.vary).toContain('x-gridstory-tenant');
    expect(delivered.headers['cache-tag']).toContain(`:entry:${encodeURIComponent(menu.id)}`);
    expect(delivered.headers['cache-tag']).toContain(`:entry:${page.id}`);
    expect(delivered.json()).toMatchObject({
      schemaVersion: 1,
      perspective: 'published',
      key: 'header',
      items: [{ label: 'Home draft', href: '/navigation-target' }],
    });
    expect(delivered.body).not.toContain('Navigation target');

    const changed = await server.inject({
      method: 'PUT',
      url: `/api/v1/content/${encodeURIComponent(menu.id)}/draft`,
      headers,
      payload: {
        expectedRevisionId: menu.draftRevisionId,
        data: {
          ...menu.data,
          items: [{ ...menu.data.items[0], label: 'Secret draft label' }],
        },
      },
    });
    expect(changed.statusCode).toBe(200);
    const stillPublished = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/navigation-menus/header',
      headers: { 'x-gridstory-tenant': headers['x-gridstory-tenant'] },
    });
    expect(stillPublished.body).toContain('Home draft');
    expect(stillPublished.body).not.toContain('Secret draft label');
  });
});
