import { describe, expect, it, vi } from 'vitest';
import { S3AssetStorageAdapter, type S3MultipartClient } from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('S3AssetStorageAdapter', () => {
  it('maps scoped resumable operations to an S3-compatible client', async () => {
    const createMultipartUpload = vi.fn(async () => ({ uploadId: 's3-upload-1' }));
    const uploadPart = vi.fn(async () => ({ etag: 'etag-1' }));
    const completeMultipartUpload = vi.fn(async () => ({
      size: 4,
      checksum: 'checksum-1',
    }));
    const abortMultipartUpload = vi.fn(async () => undefined);
    const getObject = vi.fn(async () => ({ body: new Uint8Array([1, 2, 3, 4]) }));
    const client: S3MultipartClient = {
      createMultipartUpload,
      uploadPart,
      completeMultipartUpload,
      abortMultipartUpload,
      getObject,
    };
    const storage = new S3AssetStorageAdapter({
      client,
      bucket: 'gridstory-assets',
      publicBaseUrl: 'https://cdn.example.test',
      keyPrefix: 'cms',
      partSize: 8,
    });

    const started = await storage.startMultipart({
      scope,
      filename: 'Hero image.jpg',
      mediaType: 'image/jpeg',
      size: 4,
    });
    expect(started).toEqual({ uploadId: 's3-upload-1', partSize: 8 });
    expect(createMultipartUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'gridstory-assets',
        key: expect.stringContaining(
          'cms/organization-a/tenant-a/workspace-a/site-a/production/en/',
        ),
        contentType: 'image/jpeg',
      }),
    );

    const part = await storage.uploadPart({
      scope,
      uploadId: started.uploadId,
      partNumber: 1,
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(part).toEqual({ partNumber: 1, etag: 'etag-1', size: 4 });
    const object = await storage.completeMultipart({
      scope,
      uploadId: started.uploadId,
      parts: [part],
      filename: 'Hero image.jpg',
      mediaType: 'image/jpeg',
      width: 1200,
      height: 800,
    });
    expect(object).toMatchObject({
      url: expect.stringMatching(/^https:\/\/cdn\.example\.test\/cms\//),
      checksum: 'checksum-1',
      size: 4,
      width: 1200,
      height: 800,
    });
    expect(completeMultipartUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'gridstory-assets',
        uploadId: 's3-upload-1',
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      }),
    );
    await expect(storage.readObject({ scope, object })).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(getObject).toHaveBeenCalledWith({
      bucket: 'gridstory-assets',
      key: object.objectKey,
    });
    await expect(
      storage.readObject({ scope: { ...scope, tenantId: 'tenant-b' }, object }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
