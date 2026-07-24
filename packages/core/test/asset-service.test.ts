import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AssetObject,
  AssetRenditionPreset,
  ContentSchemaDefinition,
  ContentScope,
} from '@gridstory/schema';
import {
  AssetService,
  ContentService,
  InMemoryAssetStorageAdapter,
  SqliteContentRepository,
  type AssetRenditionAdapter,
  type ContentRepository,
} from '../src/index.js';

const pageSchema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    {
      id: 'page.hero',
      name: 'hero',
      label: 'Hero',
      type: 'asset',
      required: true,
      assetKinds: ['image'],
    },
  ],
};

function scope(tenantId = 'tenant-a'): ContentScope {
  return {
    organizationId: 'organization-a',
    tenantId,
    workspaceId: 'workspace-a',
    siteId: 'site-a',
    environmentId: 'development',
    locale: 'en',
  };
}

const renditionAdapter: AssetRenditionAdapter = {
  create(input): AssetObject {
    return {
      ...input.source,
      objectKey: `${input.source.objectKey}.${input.preset.id}`,
      url: `${input.source.url}?rendition=${input.preset.id}`,
      ...(input.preset.width ? { width: input.preset.width } : {}),
      ...(input.preset.height ? { height: input.preset.height } : {}),
    };
  },
};

describe('AssetService', () => {
  let contentRepository: ContentRepository;
  let content: ContentService;
  let assets: AssetService;

  beforeEach(() => {
    contentRepository = new SqliteContentRepository({ filename: ':memory:' });
    content = new ContentService({ repository: contentRepository, schemas: [pageSchema] });
    assets = new AssetService({
      storage: new InMemoryAssetStorageAdapter('https://cdn.example.test'),
      renditionAdapter,
      contentService: content,
    });
  });

  afterEach(async () => await contentRepository.close());

  it('resumes multipart uploads, versions metadata, creates renditions, and tracks usage', async () => {
    const body = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const upload = await assets.startUpload({
      scope: scope(),
      asset: {
        filename: 'hero.jpg',
        mediaType: 'image/jpeg',
        size: body.byteLength,
        kind: 'image',
        width: 1600,
        height: 900,
        metadata: { title: 'Hero', alt: 'Sunrise' },
      },
      now: new Date('2026-07-24T00:00:00.000Z'),
    });
    const part = await assets.uploadPart({
      scope: scope(),
      uploadId: upload.id,
      partNumber: 1,
      body,
    });
    expect(assets.getUpload(scope(), upload.id).parts).toEqual([part]);

    const asset = await assets.completeUpload({
      scope: scope(),
      uploadId: upload.id,
      parts: [part],
      actor: { id: 'author-a' },
      now: new Date('2026-07-24T00:01:00.000Z'),
    });
    expect(asset.revisions[0]?.security).toMatchObject({
      status: 'verified',
      declaredMediaType: 'image/jpeg',
      detectedMediaType: 'image/jpeg',
      sanitized: false,
      malware: { status: 'not_configured' },
    });
    expect(asset.revisions[0]?.original).toMatchObject({
      filename: 'hero.jpg',
      size: body.byteLength,
      width: 1600,
      height: 900,
    });
    await expect(assets.get(scope('tenant-b'), asset.id)).rejects.toMatchObject({
      statusCode: 404,
    });

    const updated = await assets.update({
      scope: scope(),
      id: asset.id,
      changes: {
        metadata: { title: 'Hero revised', alt: 'Sunrise', tags: ['homepage'] },
        focalPoint: { x: 0.25, y: 0.75 },
      },
      actor: { id: 'editor-a' },
      now: new Date('2026-07-24T00:02:00.000Z'),
    });
    expect(updated.revisions).toHaveLength(2);
    expect(updated.revisions[1]).toMatchObject({
      metadata: { title: 'Hero revised', tags: ['homepage'] },
      focalPoint: { x: 0.25, y: 0.75 },
      actorId: 'editor-a',
    });

    const preset: AssetRenditionPreset = {
      id: 'card',
      width: 640,
      fit: 'cover',
      format: 'webp',
      quality: 80,
    };
    const rendition = await assets.createRendition({ scope: scope(), id: asset.id, preset });
    expect(rendition.object).toMatchObject({ width: 640 });

    const reference = {
      id: asset.id,
      kind: 'image' as const,
      url: asset.revisions[0]?.original.url ?? '',
      title: 'Hero revised',
      alt: 'Sunrise',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 900,
    };
    const entry = await content.create({
      scope: scope(),
      contentType: 'page',
      data: { title: 'Welcome', hero: reference },
      actor: { id: 'author-a' },
    });
    await content.publish({
      scope: scope(),
      id: entry.id,
      expectedRevisionId: entry.draftRevisionId,
      actor: { id: 'publisher-a' },
    });
    const usage = await assets.usage(scope(), asset.id);
    expect(usage).toMatchObject({
      totalReferences: 2,
      entries: 1,
      byPerspective: { draft: 1, published: 1 },
    });
    expect(usage.locations.map((location) => location.path)).toEqual(['hero', 'hero']);
  });

  it('rejects incomplete and size-mismatched uploads', async () => {
    const upload = await assets.startUpload({
      scope: scope(),
      asset: {
        filename: 'document.pdf',
        mediaType: 'application/pdf',
        size: 10,
        kind: 'file',
        metadata: { title: 'Document' },
      },
    });
    const part = await assets.uploadPart({
      scope: scope(),
      uploadId: upload.id,
      partNumber: 1,
      body: new TextEncoder().encode('short'),
    });
    await expect(
      assets.completeUpload({
        scope: scope(),
        uploadId: upload.id,
        parts: [{ ...part, etag: 'forged', size: 10 }],
        actor: { id: 'author-a' },
      }),
    ).rejects.toMatchObject({ code: 'asset_part_mismatch', statusCode: 422 });
    await expect(
      assets.completeUpload({
        scope: scope(),
        uploadId: upload.id,
        parts: [part],
        actor: { id: 'author-a' },
      }),
    ).rejects.toMatchObject({ code: 'asset_size_mismatch', statusCode: 422 });
  });

  it('stores sanitized SVG bytes and exposes only a verified revision for private reads', async () => {
    const secureAssets = new AssetService({
      storage: new InMemoryAssetStorageAdapter('https://private-assets.example.test'),
    });
    const source = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10" /></svg>',
    );
    const upload = await secureAssets.startUpload({
      scope: scope(),
      asset: {
        filename: 'icon.svg',
        mediaType: 'image/svg+xml',
        size: source.byteLength,
        kind: 'image',
        metadata: { title: 'Icon' },
      },
    });
    const part = await secureAssets.uploadPart({
      scope: scope(),
      uploadId: upload.id,
      partNumber: 1,
      body: source,
    });
    const asset = await secureAssets.completeUpload({
      scope: scope(),
      uploadId: upload.id,
      parts: [part],
      actor: { id: 'author-a' },
      now: new Date('2026-07-24T01:00:00.000Z'),
    });

    expect(asset.revisions[0]?.security).toMatchObject({
      status: 'verified',
      sanitized: true,
      detectedMediaType: 'image/svg+xml',
      findings: ['svg_active_content_removed', 'svg_event_handler_removed'],
    });
    const delivered = await secureAssets.readPrivateObject(
      scope(),
      asset.id,
      asset.currentRevisionId,
    );
    const deliveredSvg = new TextDecoder().decode(delivered.body);
    expect(deliveredSvg).not.toMatch(/script|onload/i);
    expect(deliveredSvg).toContain('<rect');
  });

  it('quarantines infected uploads and scanner failures, denying reads and renditions', async () => {
    const infectedAssets = new AssetService({
      storage: new InMemoryAssetStorageAdapter(),
      renditionAdapter,
      malwareScanner: {
        scan: async () => ({ verdict: 'infected', provider: 'test-scanner', signature: 'EICAR' }),
      },
    });
    const body = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const upload = await infectedAssets.startUpload({
      scope: scope(),
      asset: {
        filename: 'infected.jpg',
        mediaType: 'image/jpeg',
        size: body.byteLength,
        kind: 'image',
        metadata: { title: 'Infected' },
      },
    });
    const part = await infectedAssets.uploadPart({
      scope: scope(),
      uploadId: upload.id,
      partNumber: 1,
      body,
    });
    const asset = await infectedAssets.completeUpload({
      scope: scope(),
      uploadId: upload.id,
      parts: [part],
      actor: { id: 'author-a' },
    });
    expect(asset.revisions[0]?.security).toMatchObject({
      status: 'quarantined',
      malware: { status: 'infected', provider: 'test-scanner', signature: 'EICAR' },
      findings: ['malware_detected'],
    });
    await expect(
      infectedAssets.readPrivateObject(scope(), asset.id, asset.currentRevisionId),
    ).rejects.toMatchObject({ code: 'asset_not_deliverable', statusCode: 423 });
    await expect(
      infectedAssets.createRendition({
        scope: scope(),
        id: asset.id,
        preset: { id: 'thumb', width: 200 },
      }),
    ).rejects.toMatchObject({ code: 'asset_not_deliverable', statusCode: 423 });

    const scannerFailureAssets = new AssetService({
      storage: new InMemoryAssetStorageAdapter(),
      malwareScanner: {
        scan: async () => {
          throw new Error('scanner unavailable');
        },
      },
    });
    const failedUpload = await scannerFailureAssets.startUpload({
      scope: scope(),
      asset: {
        filename: 'unscanned.jpg',
        mediaType: 'image/jpeg',
        size: body.byteLength,
        kind: 'image',
        metadata: { title: 'Unscanned' },
      },
    });
    const failedPart = await scannerFailureAssets.uploadPart({
      scope: scope(),
      uploadId: failedUpload.id,
      partNumber: 1,
      body,
    });
    const failedAsset = await scannerFailureAssets.completeUpload({
      scope: scope(),
      uploadId: failedUpload.id,
      parts: [failedPart],
      actor: { id: 'author-a' },
    });
    expect(failedAsset.revisions[0]?.security).toMatchObject({
      status: 'quarantined',
      malware: { status: 'error' },
      findings: ['malware_scan_failed'],
    });
  });
});
