import { randomUUID } from 'node:crypto';
import type { AssetObject, AssetUploadPart, ContentScope } from '@gridstory/schema';
import { NotFoundError } from './errors.js';
import type { AssetStorageAdapter } from './asset-service.js';
import { contentScopeKey, contentScopePath } from './tenant-scope.js';
import type { Awaitable } from './types.js';

export interface S3MultipartClient {
  createMultipartUpload(input: {
    bucket: string;
    key: string;
    contentType: string;
  }): Awaitable<{ uploadId: string }>;
  uploadPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
  }): Awaitable<{ etag: string }>;
  completeMultipartUpload(input: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }): Awaitable<{ size: number; checksum: string; url?: string }>;
  abortMultipartUpload(input: { bucket: string; key: string; uploadId: string }): Awaitable<void>;
  getObject(input: { bucket: string; key: string }): Awaitable<{ body: Uint8Array }>;
}

export interface S3AssetStorageOptions {
  client: S3MultipartClient;
  bucket: string;
  publicBaseUrl: string;
  keyPrefix?: string;
  partSize?: number;
}

interface UploadDescriptor {
  scopeKey: string;
  objectKey: string;
}

function safeFilename(filename: string): string {
  return filename.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'asset.bin';
}

export class S3AssetStorageAdapter implements AssetStorageAdapter {
  readonly #client: S3MultipartClient;
  readonly #bucket: string;
  readonly #publicBaseUrl: string;
  readonly #keyPrefix: string;
  readonly #partSize: number;
  readonly #uploads = new Map<string, UploadDescriptor>();

  constructor(options: S3AssetStorageOptions) {
    this.#client = options.client;
    this.#bucket = options.bucket;
    this.#publicBaseUrl = options.publicBaseUrl.replace(/\/$/, '');
    this.#keyPrefix = options.keyPrefix?.replace(/^\/+|\/+$/g, '') ?? 'gridstory';
    this.#partSize = options.partSize ?? 5 * 1024 * 1024;
  }

  async startMultipart(input: {
    scope: ContentScope;
    filename: string;
    mediaType: string;
  }): Promise<{ uploadId: string; partSize: number }> {
    const objectKey = `${this.#keyPrefix}/${contentScopePath(input.scope)}/${randomUUID()}/${safeFilename(input.filename)}`;
    const started = await this.#client.createMultipartUpload({
      bucket: this.#bucket,
      key: objectKey,
      contentType: input.mediaType,
    });
    this.#uploads.set(started.uploadId, {
      scopeKey: contentScopeKey(input.scope),
      objectKey,
    });
    return { uploadId: started.uploadId, partSize: this.#partSize };
  }

  async uploadPart(input: {
    scope: ContentScope;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
  }): Promise<AssetUploadPart> {
    const descriptor = this.#descriptor(input.scope, input.uploadId);
    const uploaded = await this.#client.uploadPart({
      bucket: this.#bucket,
      key: descriptor.objectKey,
      uploadId: input.uploadId,
      partNumber: input.partNumber,
      body: input.body,
    });
    return { partNumber: input.partNumber, etag: uploaded.etag, size: input.body.byteLength };
  }

  async completeMultipart(input: {
    scope: ContentScope;
    uploadId: string;
    parts: AssetUploadPart[];
    filename: string;
    mediaType: string;
    width?: number;
    height?: number;
  }): Promise<AssetObject> {
    const descriptor = this.#descriptor(input.scope, input.uploadId);
    const completed = await this.#client.completeMultipartUpload({
      bucket: this.#bucket,
      key: descriptor.objectKey,
      uploadId: input.uploadId,
      parts: input.parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
    });
    this.#uploads.delete(input.uploadId);
    return {
      objectKey: descriptor.objectKey,
      url:
        completed.url ??
        `${this.#publicBaseUrl}/${descriptor.objectKey.split('/').map(encodeURIComponent).join('/')}`,
      filename: input.filename,
      mediaType: input.mediaType,
      size: completed.size,
      checksum: completed.checksum,
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
    };
  }

  async readObject(input: { scope: ContentScope; object: AssetObject }): Promise<Uint8Array> {
    const expectedPrefix = `${this.#keyPrefix}/${contentScopePath(input.scope)}/`;
    if (!input.object.objectKey.startsWith(expectedPrefix)) {
      throw new NotFoundError('Asset object was not found.');
    }
    const object = await this.#client.getObject({
      bucket: this.#bucket,
      key: input.object.objectKey,
    });
    return Uint8Array.from(object.body);
  }
  async abortMultipart(input: { scope: ContentScope; uploadId: string }): Promise<void> {
    const descriptor = this.#uploads.get(input.uploadId);
    if (!descriptor) return;
    this.#descriptor(input.scope, input.uploadId);
    await this.#client.abortMultipartUpload({
      bucket: this.#bucket,
      key: descriptor.objectKey,
      uploadId: input.uploadId,
    });
    this.#uploads.delete(input.uploadId);
  }

  #descriptor(scope: ContentScope, uploadId: string): UploadDescriptor {
    const descriptor = this.#uploads.get(uploadId);
    if (!descriptor || descriptor.scopeKey !== contentScopeKey(scope)) {
      throw new NotFoundError('Upload session was not found.');
    }
    return descriptor;
  }
}
