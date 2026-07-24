import { createHash, randomUUID } from 'node:crypto';
import type {
  AssetObject,
  AssetRecord,
  AssetRendition,
  AssetRenditionPreset,
  AssetUploadPart,
  AssetUploadSession,
  AssetUsageLocation,
  AssetUsageReport,
  ContentPerspective,
  ContentScope,
  StartAssetUploadInput,
  UpdateAssetInput,
} from '@gridstory/schema';
import {
  assetMetadataSchema,
  assetRenditionPresetSchema,
  assetRecordSchema,
  assetUploadSessionSchema,
  startAssetUploadSchema,
  updateAssetSchema,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';
import type { ContentService } from './content-service.js';
import type { Actor, Awaitable } from './types.js';

const DEFAULT_PART_SIZE = 5 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

function scopeKey(scope: ContentScope): string {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
    scope.locale,
  ].join('\u001f');
}

function assertScope(left: ContentScope, right: ContentScope): void {
  if (scopeKey(left) !== scopeKey(right)) {
    throw new NotFoundError('Asset was not found in the requested scope.');
  }
}

function safeFilename(filename: string): string {
  const normalized = filename.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized || 'asset.bin';
}

export interface AssetRepository {
  list(scope: ContentScope): Awaitable<AssetRecord[]>;
  get(scope: ContentScope, id: string): Awaitable<AssetRecord | null>;
  save(asset: AssetRecord): Awaitable<void>;
  close?(): Awaitable<void>;
}

export class InMemoryAssetRepository implements AssetRepository {
  readonly #assets = new Map<string, AssetRecord>();

  list(scope: ContentScope): AssetRecord[] {
    return [...this.#assets.values()]
      .filter((asset) => scopeKey(asset) === scopeKey(scope))
      .map((asset) => structuredClone(asset));
  }

  get(scope: ContentScope, id: string): AssetRecord | null {
    const asset = this.#assets.get(`${scopeKey(scope)}\u001e${id}`);
    return asset ? structuredClone(asset) : null;
  }

  save(asset: AssetRecord): void {
    this.#assets.set(`${scopeKey(asset)}\u001e${asset.id}`, structuredClone(asset));
  }
}

export interface AssetStorageAdapter {
  startMultipart(input: {
    scope: ContentScope;
    filename: string;
    mediaType: string;
    size: number;
  }): Awaitable<{ uploadId: string; partSize: number }>;
  uploadPart(input: {
    scope: ContentScope;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
  }): Awaitable<AssetUploadPart>;
  completeMultipart(input: {
    scope: ContentScope;
    uploadId: string;
    parts: AssetUploadPart[];
    filename: string;
    mediaType: string;
    width?: number;
    height?: number;
  }): Awaitable<AssetObject>;
  abortMultipart(input: { scope: ContentScope; uploadId: string }): Awaitable<void>;
}

interface MemoryUpload {
  scope: ContentScope;
  parts: Map<number, Uint8Array>;
}

export class InMemoryAssetStorageAdapter implements AssetStorageAdapter {
  readonly #uploads = new Map<string, MemoryUpload>();
  readonly #baseUrl: string;

  constructor(baseUrl = 'https://assets.gridstory.local') {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
  }

  startMultipart(input: { scope: ContentScope }): { uploadId: string; partSize: number } {
    const uploadId = randomUUID();
    this.#uploads.set(uploadId, { scope: structuredClone(input.scope), parts: new Map() });
    return { uploadId, partSize: DEFAULT_PART_SIZE };
  }

  uploadPart(input: {
    scope: ContentScope;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
  }): AssetUploadPart {
    const upload = this.#uploads.get(input.uploadId);
    if (!upload) throw new NotFoundError('Upload session was not found.');
    assertScope(upload.scope, input.scope);
    if (
      !Number.isInteger(input.partNumber) ||
      input.partNumber < 1 ||
      input.body.byteLength === 0
    ) {
      throw new GridStoryError('Upload part is invalid.', 'invalid_asset_upload_part', 400);
    }
    const body = Uint8Array.from(input.body);
    upload.parts.set(input.partNumber, body);
    return {
      partNumber: input.partNumber,
      etag: createHash('sha256').update(body).digest('hex'),
      size: body.byteLength,
    };
  }

  completeMultipart(input: {
    scope: ContentScope;
    uploadId: string;
    parts: AssetUploadPart[];
    filename: string;
    mediaType: string;
    width?: number;
    height?: number;
  }): AssetObject {
    const upload = this.#uploads.get(input.uploadId);
    if (!upload) throw new NotFoundError('Upload session was not found.');
    assertScope(upload.scope, input.scope);
    const buffers = [...input.parts]
      .sort((left, right) => left.partNumber - right.partNumber)
      .map((part) => {
        const body = upload.parts.get(part.partNumber);
        if (!body || createHash('sha256').update(body).digest('hex') !== part.etag) {
          throw new GridStoryError(
            'Upload part list does not match stored parts.',
            'asset_part_mismatch',
            409,
          );
        }
        return body;
      });
    const body = Buffer.concat(buffers);
    const objectKey = `${scopeKey(input.scope).replaceAll('\u001f', '/')}/${randomUUID()}/${safeFilename(input.filename)}`;
    this.#uploads.delete(input.uploadId);
    return {
      objectKey,
      url: `${this.#baseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}`,
      filename: input.filename,
      mediaType: input.mediaType,
      size: body.byteLength,
      checksum: createHash('sha256').update(body).digest('hex'),
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
    };
  }

  abortMultipart(input: { scope: ContentScope; uploadId: string }): void {
    const upload = this.#uploads.get(input.uploadId);
    if (!upload) return;
    assertScope(upload.scope, input.scope);
    this.#uploads.delete(input.uploadId);
  }
}

export interface AssetRenditionAdapter {
  create(input: {
    scope: ContentScope;
    asset: AssetRecord;
    source: AssetObject;
    preset: AssetRenditionPreset;
  }): Awaitable<AssetObject>;
}

interface PendingUpload {
  session: AssetUploadSession;
  input: ReturnType<typeof startAssetUploadSchema.parse>;
}

function collectAssetReferences(
  value: unknown,
  assetId: string,
  path: string,
  found: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectAssetReferences(item, assetId, `${path}[${index}]`, found);
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  const candidate = value as Record<string, unknown>;
  if (candidate.id === assetId && ['image', 'video', 'file'].includes(String(candidate.kind))) {
    found.push(path);
  }
  for (const [key, child] of Object.entries(candidate)) {
    collectAssetReferences(child, assetId, path ? `${path}.${key}` : key, found);
  }
}

export class AssetService {
  readonly #repository: AssetRepository;
  readonly #storage: AssetStorageAdapter;
  readonly #renditions: AssetRenditionAdapter | undefined;
  readonly #content: ContentService | undefined;
  readonly #uploads = new Map<string, PendingUpload>();

  constructor(input: {
    repository?: AssetRepository;
    storage: AssetStorageAdapter;
    renditionAdapter?: AssetRenditionAdapter;
    contentService?: ContentService;
  }) {
    this.#repository = input.repository ?? new InMemoryAssetRepository();
    this.#storage = input.storage;
    this.#renditions = input.renditionAdapter;
    this.#content = input.contentService;
  }

  async list(scope: ContentScope): Promise<AssetRecord[]> {
    const assets = await this.#repository.list(scope);
    return assets.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(scope: ContentScope, id: string): Promise<AssetRecord> {
    const asset = await this.#repository.get(scope, id);
    if (!asset) throw new NotFoundError(`Asset ${id} was not found.`);
    return assetRecordSchema.parse(asset);
  }

  async startUpload(input: {
    scope: ContentScope;
    asset: StartAssetUploadInput;
    now?: Date;
  }): Promise<AssetUploadSession> {
    const parsed = startAssetUploadSchema.parse(input.asset);
    const storage = await this.#storage.startMultipart({
      scope: input.scope,
      filename: parsed.filename,
      mediaType: parsed.mediaType,
      size: parsed.size,
    });
    const now = input.now ?? new Date();
    const session = assetUploadSessionSchema.parse({
      ...input.scope,
      id: randomUUID(),
      storageUploadId: storage.uploadId,
      filename: parsed.filename,
      mediaType: parsed.mediaType,
      size: parsed.size,
      kind: parsed.kind,
      state: 'pending',
      partSize: storage.partSize,
      parts: [],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS).toISOString(),
    });
    this.#uploads.set(session.id, { session, input: parsed });
    return structuredClone(session);
  }

  getUpload(scope: ContentScope, id: string): AssetUploadSession {
    const pending = this.#uploads.get(id);
    if (!pending) throw new NotFoundError('Upload session was not found.');
    assertScope(pending.session, scope);
    return structuredClone(pending.session);
  }

  async uploadPart(input: {
    scope: ContentScope;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
  }): Promise<AssetUploadPart> {
    const pending = this.#uploads.get(input.uploadId);
    if (!pending) throw new NotFoundError('Upload session was not found.');
    assertScope(pending.session, input.scope);
    if (Date.parse(pending.session.expiresAt) <= Date.now()) {
      throw new GridStoryError('Upload session has expired.', 'asset_upload_expired', 410);
    }
    const part = await this.#storage.uploadPart({
      scope: input.scope,
      uploadId: pending.session.storageUploadId,
      partNumber: input.partNumber,
      body: input.body,
    });
    pending.session.parts = [
      ...pending.session.parts.filter((candidate) => candidate.partNumber !== part.partNumber),
      part,
    ].sort((left, right) => left.partNumber - right.partNumber);
    pending.session.state = 'uploading';
    return structuredClone(part);
  }

  async completeUpload(input: {
    scope: ContentScope;
    uploadId: string;
    parts: AssetUploadPart[];
    actor: Actor;
    now?: Date;
  }): Promise<AssetRecord> {
    const pending = this.#uploads.get(input.uploadId);
    if (!pending) throw new NotFoundError('Upload session was not found.');
    assertScope(pending.session, input.scope);
    const submittedParts = [...input.parts].sort(
      (left, right) => left.partNumber - right.partNumber,
    );
    const recordedParts = pending.session.parts;
    const partsMatch =
      submittedParts.length === recordedParts.length &&
      submittedParts.every((part, index) => {
        const recorded = recordedParts[index];
        if (!recorded) return false;
        return (
          part.partNumber === recorded.partNumber &&
          part.etag === recorded.etag &&
          part.size === recorded.size
        );
      });
    if (!partsMatch) {
      throw new GridStoryError(
        'Completion parts do not match the uploaded parts.',
        'asset_part_mismatch',
        422,
      );
    }
    const submittedSize = recordedParts.reduce((total, part) => total + part.size, 0);
    if (submittedSize !== pending.input.size) {
      throw new GridStoryError(
        'Uploaded size does not match the declared size.',
        'asset_size_mismatch',
        422,
      );
    }
    const object = await this.#storage.completeMultipart({
      scope: input.scope,
      uploadId: pending.session.storageUploadId,
      parts: submittedParts,
      filename: pending.input.filename,
      mediaType: pending.input.mediaType,
      ...(pending.input.width ? { width: pending.input.width } : {}),
      ...(pending.input.height ? { height: pending.input.height } : {}),
    });
    const now = input.now ?? new Date();
    const id = randomUUID();
    const revisionId = randomUUID();
    const asset = assetRecordSchema.parse({
      ...input.scope,
      id,
      kind: pending.input.kind,
      currentRevisionId: revisionId,
      revisions: [
        {
          id: revisionId,
          version: 1,
          original: object,
          metadata: assetMetadataSchema.parse(pending.input.metadata),
          createdAt: now.toISOString(),
          actorId: input.actor.id,
        },
      ],
      renditions: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    pending.session.state = 'completed';
    this.#uploads.delete(input.uploadId);
    await this.#repository.save(asset);
    return asset;
  }

  async abortUpload(scope: ContentScope, uploadId: string): Promise<void> {
    const pending = this.#uploads.get(uploadId);
    if (!pending) return;
    assertScope(pending.session, scope);
    await this.#storage.abortMultipart({ scope, uploadId: pending.session.storageUploadId });
    pending.session.state = 'aborted';
    this.#uploads.delete(uploadId);
  }

  async update(input: {
    scope: ContentScope;
    id: string;
    changes: UpdateAssetInput;
    actor: Actor;
    now?: Date;
  }): Promise<AssetRecord> {
    const asset = await this.get(input.scope, input.id);
    const changes = updateAssetSchema.parse(input.changes);
    const current = asset.revisions.find((revision) => revision.id === asset.currentRevisionId);
    if (!current)
      throw new GridStoryError('Asset revision is missing.', 'asset_revision_missing', 500);
    const now = input.now ?? new Date();
    const revision = {
      ...current,
      id: randomUUID(),
      version: current.version + 1,
      metadata: changes.metadata ? assetMetadataSchema.parse(changes.metadata) : current.metadata,
      createdAt: now.toISOString(),
      actorId: input.actor.id,
    };
    if (changes.focalPoint === null) delete revision.focalPoint;
    else if (changes.focalPoint !== undefined) revision.focalPoint = changes.focalPoint;
    asset.currentRevisionId = revision.id;
    asset.revisions.push(revision);
    asset.updatedAt = now.toISOString();
    await this.#repository.save(asset);
    return assetRecordSchema.parse(asset);
  }

  async createRendition(input: {
    scope: ContentScope;
    id: string;
    preset: AssetRenditionPreset;
    now?: Date;
  }): Promise<AssetRendition> {
    if (!this.#renditions) {
      throw new GridStoryError(
        'No rendition adapter is configured.',
        'rendition_adapter_unavailable',
        501,
      );
    }
    const asset = await this.get(input.scope, input.id);
    if (asset.kind !== 'image') {
      throw new GridStoryError(
        'Renditions require an image asset.',
        'invalid_rendition_asset',
        422,
      );
    }
    const preset = assetRenditionPresetSchema.parse(input.preset);
    const current = asset.revisions.find((revision) => revision.id === asset.currentRevisionId);
    if (!current)
      throw new GridStoryError('Asset revision is missing.', 'asset_revision_missing', 500);
    const existing = asset.renditions.find((rendition) => rendition.preset.id === preset.id);
    if (existing) return existing;
    const object = await this.#renditions.create({
      scope: input.scope,
      asset,
      source: current.original,
      preset,
    });
    const rendition: AssetRendition = {
      id: randomUUID(),
      preset,
      object,
      createdAt: (input.now ?? new Date()).toISOString(),
    };
    asset.renditions.push(rendition);
    asset.updatedAt = rendition.createdAt;
    await this.#repository.save(asset);
    return structuredClone(rendition);
  }

  async usage(scope: ContentScope, assetId: string): Promise<AssetUsageReport> {
    await this.get(scope, assetId);
    if (!this.#content) {
      throw new GridStoryError(
        'Content usage tracking is unavailable.',
        'asset_usage_unavailable',
        501,
      );
    }
    const locations: AssetUsageLocation[] = [];
    for (const perspective of ['draft', 'published'] as const satisfies ContentPerspective[]) {
      for (const entry of await this.#content.list({ scope, perspective })) {
        for (const [field, value] of Object.entries(entry.data)) {
          const paths: string[] = [];
          collectAssetReferences(value, assetId, field, paths);
          for (const path of paths) {
            locations.push({
              entryId: entry.id,
              contentType: entry.contentType,
              perspective,
              revisionId:
                perspective === 'published'
                  ? (entry.publishedRevisionId ?? entry.draftRevisionId)
                  : entry.draftRevisionId,
              field,
              path,
            });
          }
        }
      }
    }
    return {
      assetId,
      totalReferences: locations.length,
      entries: new Set(locations.map((location) => location.entryId)).size,
      byPerspective: {
        draft: locations.filter((location) => location.perspective === 'draft').length,
        published: locations.filter((location) => location.perspective === 'published').length,
      },
      locations,
    };
  }
}
