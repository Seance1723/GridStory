import { describe, expect, it, vi } from 'vitest';
import {
  ContentfulMigrationSourceAdapter,
  SanityMigrationSourceAdapter,
  WordPressMigrationSourceAdapter,
} from '../src/migration-adapters.js';

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('official migration source adapters', () => {
  it('normalizes Contentful entries/assets/tombstones and advances only the opaque sync token', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            sys: {
              id: 'entry-1',
              type: 'Entry',
              updatedAt: '2026-08-23T00:00:00.000Z',
              contentType: { sys: { id: 'page' } },
            },
            fields: { title: { en: 'Hello' } },
          },
          { sys: { id: 'asset-1', type: 'Asset' }, fields: { title: { en: 'Hero' } } },
          { sys: { id: 'entry-old', type: 'DeletedEntry' } },
        ],
        nextSyncUrl:
          'https://cdn.contentful.com/spaces/space-a/environments/master/sync?sync_token=next-secret-state',
      }),
    );
    const adapter = new ContentfulMigrationSourceAdapter({
      id: 'contentful-main',
      name: 'Contentful main',
      spaceId: 'space-a',
      accessToken: 'source-token',
      fetch,
    });
    const snapshot = await adapter.read({ mode: 'full', maximumRecords: 10 });
    expect(snapshot).toMatchObject({
      kind: 'full',
      checkpoint: 'next-secret-state',
      records: [
        { externalId: 'entry-1', sourceType: 'contentful.Entry.page', status: 'published' },
        { externalId: 'asset-1', sourceType: 'contentful.Asset', status: 'published' },
        { externalId: 'entry-old', sourceType: 'contentful.DeletedEntry', status: 'deleted' },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringContaining('initial=true') }),
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: { authorization: 'Bearer source-token' },
      }),
    );
    expect(JSON.stringify(adapter.descriptor)).not.toContain('source-token');
  });

  it('normalizes a bounded Sanity NDJSON snapshot and excludes drafts by default', async () => {
    const body = [
      JSON.stringify({
        _id: 'post-1',
        _type: 'post',
        _updatedAt: '2026-08-23T00:00:00.000Z',
        title: 'Published',
      }),
      JSON.stringify({ _id: 'drafts.post-1', _type: 'post', title: 'Draft' }),
      '',
    ].join('\n');
    const fetch = vi.fn(
      async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }),
    );
    const adapter = new SanityMigrationSourceAdapter({
      id: 'sanity-main',
      name: 'Sanity main',
      projectId: 'project-a',
      dataset: 'production',
      token: 'sanity-token',
      fetch,
    });
    const snapshot = await adapter.read({ mode: 'full', maximumRecords: 10 });
    expect(snapshot.records).toEqual([
      expect.objectContaining({
        externalId: 'post-1',
        sourceType: 'sanity.post',
        status: 'published',
      }),
    ]);
    expect(snapshot.checkpoint).toMatch(/^[a-f0-9]{64}$/u);
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/v2021-03-25/data/export/production' }),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('follows WordPress total-page headers and reconciles posts, pages, and media', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const collection = url.pathname.split('/').at(-1);
      const page = Number(url.searchParams.get('page'));
      const totalPages = collection === 'posts' ? '2' : '1';
      if (collection === 'posts' && page === 2) {
        return jsonResponse(
          [
            {
              id: 2,
              status: 'publish',
              modified_gmt: '2026-08-23T00:01:00',
              title: { rendered: 'B' },
            },
          ],
          { 'x-wp-totalpages': totalPages },
        );
      }
      const id = collection === 'posts' ? 1 : collection === 'pages' ? 3 : 4;
      return jsonResponse(
        [
          {
            id,
            status: 'publish',
            modified_gmt: '2026-08-23T00:00:00',
            title: { rendered: collection },
          },
        ],
        { 'x-wp-totalpages': totalPages },
      );
    });
    const adapter = new WordPressMigrationSourceAdapter({
      id: 'wordpress-main',
      name: 'WordPress main',
      baseUrl: 'https://cms.example.test/',
      authorizationHeader: 'Basic redacted',
      fetch,
    });
    const snapshot = await adapter.read({ mode: 'full', maximumRecords: 10 });
    expect(snapshot.records.map((record) => record.externalId)).toEqual([
      'post:1',
      'post:2',
      'page:3',
      'media:4',
    ]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      headers: expect.objectContaining({ authorization: 'Basic redacted' }),
    });
  });

  it('rejects insecure configuration, cross-origin continuation, and oversized responses', async () => {
    expect(
      () =>
        new WordPressMigrationSourceAdapter({
          id: 'unsafe',
          name: 'Unsafe',
          baseUrl: 'http://cms.example.test/',
        }),
    ).toThrow('credential-free HTTPS');
    const crossOrigin = new ContentfulMigrationSourceAdapter({
      id: 'contentful-main',
      name: 'Contentful main',
      spaceId: 'space-a',
      accessToken: 'source-token',
      fetch: async () =>
        jsonResponse({
          items: [],
          nextSyncUrl: 'https://attacker.example/sync?sync_token=stolen',
        }),
    });
    await expect(crossOrigin.read({ mode: 'full', maximumRecords: 10 })).rejects.toThrow(
      'different origin',
    );
    const oversized = new SanityMigrationSourceAdapter({
      id: 'sanity-main',
      name: 'Sanity main',
      projectId: 'project-a',
      dataset: 'production',
      token: 'sanity-token',
      maximumResponseBytes: 4,
      fetch: async () => new Response('{"_id":"too-large"}', { status: 200 }),
    });
    await expect(oversized.read({ mode: 'full', maximumRecords: 10 })).rejects.toThrow(
      'byte limit',
    );
  });
});
