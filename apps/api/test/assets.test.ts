import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AssetRenditionAdapter } from '@gridstory/core';
import { buildServer } from '../src/server.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'asset-tenant',
  'x-gridstory-actor': 'asset-test',
};

const renditionAdapter: AssetRenditionAdapter = {
  create(input) {
    return {
      ...input.source,
      objectKey: `${input.source.objectKey}.${input.preset.id}`,
      url: `${input.source.url}?rendition=${input.preset.id}`,
      ...(input.preset.width ? { width: input.preset.width } : {}),
      ...(input.preset.height ? { height: input.preset.height } : {}),
    };
  },
};

const validPage = {
  title: 'Asset page',
  slug: 'asset-page',
  story: {
    version: 1,
    blocks: [
      {
        id: 'asset-story',
        type: 'paragraph',
        content: [{ type: 'text', text: 'A page that uses the uploaded hero asset.', marks: [] }],
      },
    ],
  },
  blocks: [
    {
      id: 'asset-hero',
      component: 'gridstory.hero',
      version: 1,
      props: { eyebrow: '', heading: 'Asset page', body: 'Uses an asset.', tone: 'indigo' },
    },
  ],
};

describe('asset management API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('supports scoped resumable uploads, metadata, renditions, and usage', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      assetRenditionAdapter: renditionAdapter,
    });
    const body = Buffer.from('hero');
    const start = await server.inject({
      method: 'POST',
      url: '/api/v1/assets/uploads',
      headers,
      payload: {
        filename: 'hero.jpg',
        mediaType: 'image/jpeg',
        size: body.byteLength,
        kind: 'image',
        width: 1600,
        height: 900,
        metadata: { title: 'Hero', alt: 'Sunrise' },
      },
    });
    expect(start.statusCode).toBe(201);
    expect(start.headers['cache-control']).toBe('private, no-store');
    const upload = start.json();

    const uploadedPart = await server.inject({
      method: 'PUT',
      url: `/api/v1/assets/uploads/${upload.id}/parts/1`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: body,
    });
    expect(uploadedPart.statusCode).toBe(200);
    const part = uploadedPart.json();

    const resumed = await server.inject({
      method: 'GET',
      url: `/api/v1/assets/uploads/${upload.id}`,
      headers,
    });
    expect(resumed.json().parts).toEqual([part]);

    const completed = await server.inject({
      method: 'POST',
      url: `/api/v1/assets/uploads/${upload.id}/complete`,
      headers,
      payload: { parts: [part] },
    });
    expect(completed.statusCode).toBe(201);
    const asset = completed.json();

    const isolated = await server.inject({
      method: 'GET',
      url: `/api/v1/assets/${asset.id}`,
      headers: { ...headers, 'x-gridstory-tenant': 'other-tenant' },
    });
    expect(isolated.statusCode).toBe(404);

    const updated = await server.inject({
      method: 'PATCH',
      url: `/api/v1/assets/${asset.id}`,
      headers,
      payload: { focalPoint: { x: 0.25, y: 0.75 } },
    });
    expect(updated.json().revisions).toHaveLength(2);

    const rendition = await server.inject({
      method: 'POST',
      url: `/api/v1/assets/${asset.id}/renditions`,
      headers,
      payload: { id: 'card', width: 640, format: 'webp' },
    });
    expect(rendition.statusCode).toBe(201);
    expect(rendition.json().object.width).toBe(640);

    const original = asset.revisions[0].original;
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: {
        contentType: 'page',
        data: {
          ...validPage,
          socialImage: {
            id: asset.id,
            kind: 'image',
            url: original.url,
            title: 'Hero',
            alt: 'Sunrise',
            mimeType: original.mediaType,
            width: original.width,
            height: original.height,
          },
        },
      },
    });
    expect(created.statusCode).toBe(201);

    const usage = await server.inject({
      method: 'GET',
      url: `/api/v1/assets/${asset.id}/usage`,
      headers,
    });
    expect(usage.json()).toMatchObject({
      assetId: asset.id,
      totalReferences: 1,
      entries: 1,
      byPerspective: { draft: 1, published: 0 },
    });

    const denied = await server.inject({
      method: 'POST',
      url: '/api/v1/assets/uploads',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
      payload: {
        filename: 'denied.jpg',
        mediaType: 'image/jpeg',
        size: 1,
        kind: 'image',
        metadata: { title: 'Denied' },
      },
    });
    expect(denied.statusCode).toBe(403);
  });
});
