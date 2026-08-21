import { describe, expect, it } from 'vitest';
import {
  assetMetadataSchema,
  assetSecuritySchema,
  createAssetDeliverySchema,
  assetRecordSchema,
  assetRenditionPresetSchema,
  assetUploadSessionSchema,
  resourceLimits,
  startAssetUploadSchema,
} from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

describe('asset contracts', () => {
  it('normalizes portable metadata and rendition presets', () => {
    expect(assetMetadataSchema.parse({ title: 'Hero' })).toEqual({
      title: 'Hero',
      tags: [],
      collections: [],
      custom: {},
    });
    expect(assetRenditionPresetSchema.parse({ id: 'card', width: 640 })).toEqual({
      id: 'card',
      width: 640,
      fit: 'cover',
      format: 'original',
      quality: 80,
    });
  });

  it('requires bounded focal points and resumable upload state', () => {
    expect(assetRenditionPresetSchema.safeParse({ id: 'invalid' }).success).toBe(false);
    expect(
      assetRecordSchema.safeParse({
        ...scope,
        id: 'asset-1',
        kind: 'image',
        currentRevisionId: 'revision-1',
        revisions: [
          {
            id: 'revision-1',
            version: 1,
            original: {
              objectKey: 'assets/hero.jpg',
              url: 'https://cdn.example.test/hero.jpg',
              filename: 'hero.jpg',
              mediaType: 'image/jpeg',
              size: 4,
              checksum: 'abcd',
            },
            metadata: { title: 'Hero' },
            focalPoint: { x: 1.1, y: 0.5 },
            createdAt: '2026-07-24T00:00:00.000Z',
            actorId: 'author-a',
          },
        ],
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      assetUploadSessionSchema.safeParse({
        ...scope,
        id: 'upload-1',
        storageUploadId: 's3-upload-1',
        filename: 'hero.jpg',
        mediaType: 'image/jpeg',
        size: 4,
        kind: 'image',
        state: 'uploading',
        partSize: 5_242_880,
        parts: [{ partNumber: 1, etag: 'etag', size: 4 }],
        createdAt: '2026-07-24T00:00:00.000Z',
        expiresAt: '2026-07-25T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('models immutable inspection verdicts and bounded private-delivery requests', () => {
    expect(
      assetSecuritySchema.parse({
        status: 'verified',
        declaredMediaType: 'image/svg+xml',
        detectedMediaType: 'image/svg+xml',
        inspectedAt: '2026-07-24T00:00:00.000Z',
        malware: { status: 'clean', provider: 'scanner' },
      }),
    ).toMatchObject({
      status: 'verified',
      sanitized: false,
      findings: [],
      malware: { status: 'clean' },
    });
    expect(createAssetDeliverySchema.parse({})).toEqual({ ttlSeconds: 300 });
    expect(createAssetDeliverySchema.safeParse({ ttlSeconds: 29 }).success).toBe(false);
    expect(createAssetDeliverySchema.safeParse({ ttlSeconds: 901 }).success).toBe(false);
  });

  it('rejects assets beyond the published byte and dimension envelope', () => {
    const valid = {
      filename: 'hero.jpg',
      mediaType: 'image/jpeg',
      size: resourceLimits.assets.maximumBytes,
      kind: 'image',
      width: resourceLimits.assets.maximumDimensionPixels,
      height: 1,
      metadata: { title: 'Hero' },
    };
    expect(startAssetUploadSchema.safeParse(valid).success).toBe(true);
    expect(
      startAssetUploadSchema.safeParse({
        ...valid,
        size: resourceLimits.assets.maximumBytes + 1,
      }).success,
    ).toBe(false);
    expect(
      startAssetUploadSchema.safeParse({
        ...valid,
        width: resourceLimits.assets.maximumDimensionPixels + 1,
      }).success,
    ).toBe(false);
  });
});
