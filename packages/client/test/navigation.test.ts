import { describe, expect, it } from 'vitest';
import { createGridStoryClient, type GridStoryApiError } from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};
const projection = {
  schemaVersion: 1,
  scope,
  entryId: 'navigation-menu:header',
  key: 'header',
  name: 'Header',
  requestedLocale: 'en',
  resolvedLocale: 'en',
  perspective: 'published',
  revisionId: 'revision-1',
  items: [
    {
      id: 'home',
      label: 'Home',
      kind: 'internal',
      target: { id: 'page-1', contentType: 'page' },
      href: '/home',
    },
  ],
};

describe('navigation menu client', () => {
  it('uses scoped management calls and credential-free public delivery with strict parsing', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'https://gridstory.test',
      tenantId: scope.tenantId,
      actorId: 'editor',
      scope,
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        const url = String(input);
        if (url.endsWith('/api/v1/navigation-menus')) {
          return new Response(JSON.stringify({ id: projection.entryId }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            ...projection,
            perspective: url.includes('/preview') ? 'draft' : 'published',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    });

    await client.createNavigationMenu('header', 'Header');
    expect((await client.getNavigationMenuDraft(projection.entryId)).perspective).toBe('draft');
    expect((await client.getPublishedNavigationMenu('header')).items[0]?.href).toBe('/home');

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ['https://gridstory.test/api/v1/navigation-menus', 'POST'],
      [
        'https://gridstory.test/api/v1/navigation-menus/navigation-menu%3Aheader/preview',
        undefined,
      ],
      ['https://gridstory.test/api/v1/delivery/navigation-menus/header', 'GET'],
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ key: 'header', name: 'Header' });
    expect(requests[2]?.init?.credentials).toBe('omit');
    expect(requests[2]?.init?.cache).toBe('no-cache');
    const publicHeaders = new Headers(requests[2]?.init?.headers);
    expect(publicHeaders.get('x-gridstory-tenant')).toBe(scope.tenantId);
    expect(publicHeaders.get('x-gridstory-actor')).toBeNull();
  });

  it.each([
    ['unknown response data', { ...projection, draftToken: 'private' }],
    ['different tenant scope', { ...projection, scope: { ...scope, tenantId: 'tenant-b' } }],
  ])('rejects %s', async (_name, response) => {
    const client = createGridStoryClient({
      baseUrl: 'https://gridstory.test',
      tenantId: scope.tenantId,
      scope,
      fetch: async () =>
        new Response(JSON.stringify(response), {
          headers: { 'content-type': 'application/json' },
        }),
    });
    await expect(client.getPublishedNavigationMenu('header')).rejects.toMatchObject<
      Partial<GridStoryApiError>
    >({ status: 502, code: 'invalid_navigation_menu_response' });
  });
});
