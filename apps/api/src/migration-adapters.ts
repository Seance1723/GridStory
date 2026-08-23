import { createHash } from 'node:crypto';
import {
  GridStoryError,
  type MigrationSourceAdapter,
  type MigrationSourceReadInput,
} from '@gridstory/core';
import {
  type MigrationSourceRecord,
  type MigrationSourceSnapshot,
  resourceLimits,
} from '@gridstory/schema';

export type MigrationFetch = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

interface SourceTransportOptions {
  fetch?: MigrationFetch;
  maximumResponseBytes?: number;
}

function sourceError(message: string, details?: unknown): GridStoryError {
  return new GridStoryError(message, 'migration_source_error', 502, details);
}

function configuredBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Migration source base URL must be credential-free HTTPS without query or hash.',
    );
  }
  return url;
}

function assertSameOrigin(configured: URL, candidate: URL): void {
  if (candidate.origin !== configured.origin) {
    throw sourceError('Migration source attempted to continue on a different origin.');
  }
}

async function boundedResponseText(
  response: Response,
  configuredOrigin: URL,
  maximumBytes: number,
): Promise<string> {
  if (response.url) assertSameOrigin(configuredOrigin, new URL(response.url));
  if (!response.ok) {
    throw sourceError(`Migration source returned HTTP ${response.status}.`, {
      status: response.status,
    });
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw sourceError('Migration source response exceeds the configured byte limit.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw sourceError('Migration source response exceeds the configured byte limit.');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parsedObject(value: string, provider: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw sourceError(`${provider} returned malformed JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw sourceError(`${provider} response must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function snapshotCheckpoint(records: MigrationSourceRecord[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        [...records].sort((left, right) => left.externalId.localeCompare(right.externalId)),
      ),
    )
    .digest('hex');
}

export interface ContentfulMigrationSourceOptions extends SourceTransportOptions {
  id: string;
  name: string;
  spaceId: string;
  environmentId?: string;
  accessToken: string;
  baseUrl?: string;
}

export class ContentfulMigrationSourceAdapter implements MigrationSourceAdapter {
  readonly descriptor;
  readonly #spaceId: string;
  readonly #environmentId: string;
  readonly #accessToken: string;
  readonly #baseUrl: URL;
  readonly #fetch: MigrationFetch;
  readonly #maximumResponseBytes: number;

  constructor(options: ContentfulMigrationSourceOptions) {
    if (!options.accessToken) throw new Error('Contentful migration access token is required.');
    this.descriptor = {
      id: options.id,
      provider: 'contentful' as const,
      name: options.name,
      supportsDelta: true,
      reportsDeletions: true,
      includesAssets: true,
    };
    this.#spaceId = options.spaceId;
    this.#environmentId = options.environmentId ?? 'master';
    this.#accessToken = options.accessToken;
    this.#baseUrl = configuredBaseUrl(options.baseUrl ?? 'https://cdn.contentful.com');
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maximumResponseBytes =
      options.maximumResponseBytes ?? resourceLimits.migration.maximumSourceResponseBytes;
  }

  #syncUrl(input: MigrationSourceReadInput): URL {
    const url = new URL(
      `/spaces/${encodeURIComponent(this.#spaceId)}/environments/${encodeURIComponent(this.#environmentId)}/sync`,
      this.#baseUrl,
    );
    if (input.mode === 'delta') {
      if (!input.checkpoint)
        throw new Error('Contentful delta synchronization requires a checkpoint.');
      url.searchParams.set('sync_token', input.checkpoint);
    } else {
      url.searchParams.set('initial', 'true');
      url.searchParams.set('limit', String(Math.min(input.maximumRecords, 1_000)));
    }
    return url;
  }

  #record(item: unknown): MigrationSourceRecord {
    const object = objectValue(item);
    const sys = objectValue(object?.sys);
    const id = nonEmptyString(sys?.id);
    const type = nonEmptyString(sys?.type);
    if (!object || !sys || !id || !type) throw sourceError('Contentful sync item is malformed.');
    const updatedAt = nonEmptyString(sys.updatedAt);
    if (type === 'DeletedEntry' || type === 'DeletedAsset') {
      return {
        externalId: id,
        sourceType: `contentful.${type}`,
        status: 'deleted',
        ...(updatedAt ? { updatedAt } : {}),
        data: {},
      };
    }
    if (type === 'Asset') {
      return {
        externalId: id,
        sourceType: 'contentful.Asset',
        status: 'published',
        ...(updatedAt ? { updatedAt } : {}),
        data: object,
      };
    }
    if (type !== 'Entry') throw sourceError(`Contentful sync item type ${type} is unsupported.`);
    const contentType = objectValue(sys.contentType);
    const contentTypeSys = objectValue(contentType?.sys);
    const contentTypeId = nonEmptyString(contentTypeSys?.id);
    if (!contentTypeId) throw sourceError('Contentful entry is missing its content type.');
    return {
      externalId: id,
      sourceType: `contentful.Entry.${contentTypeId}`,
      status: 'published',
      ...(updatedAt ? { updatedAt } : {}),
      data: object,
    };
  }

  async read(input: MigrationSourceReadInput): Promise<MigrationSourceSnapshot> {
    let url = this.#syncUrl(input);
    const records: MigrationSourceRecord[] = [];
    let checkpoint: string | undefined;
    for (;;) {
      assertSameOrigin(this.#baseUrl, url);
      const response = await this.#fetch(url, {
        method: 'GET',
        redirect: 'error',
        headers: { authorization: `Bearer ${this.#accessToken}` },
      });
      const payload = parsedObject(
        await boundedResponseText(response, this.#baseUrl, this.#maximumResponseBytes),
        'Contentful',
      );
      if (!Array.isArray(payload.items))
        throw sourceError('Contentful sync items must be an array.');
      records.push(...payload.items.map((item) => this.#record(item)));
      if (records.length > input.maximumRecords) {
        throw sourceError('Contentful sync exceeds the configured record limit.');
      }
      const nextPage = nonEmptyString(payload.nextPageUrl);
      if (nextPage) {
        url = new URL(nextPage);
        assertSameOrigin(this.#baseUrl, url);
        continue;
      }
      const nextSync = nonEmptyString(payload.nextSyncUrl);
      if (!nextSync) throw sourceError('Contentful sync response is missing its next sync token.');
      const nextSyncUrl = new URL(nextSync);
      assertSameOrigin(this.#baseUrl, nextSyncUrl);
      checkpoint = nextSyncUrl.searchParams.get('sync_token') ?? undefined;
      if (!checkpoint) throw sourceError('Contentful next sync URL has no opaque sync token.');
      break;
    }
    return { kind: input.mode, records, checkpoint, complete: true };
  }
}

export interface SanityMigrationSourceOptions extends SourceTransportOptions {
  id: string;
  name: string;
  projectId: string;
  dataset: string;
  token: string;
  apiVersion?: string;
  includeDrafts?: boolean;
  baseUrl?: string;
}

export class SanityMigrationSourceAdapter implements MigrationSourceAdapter {
  readonly descriptor;
  readonly #dataset: string;
  readonly #token: string;
  readonly #apiVersion: string;
  readonly #includeDrafts: boolean;
  readonly #baseUrl: URL;
  readonly #fetch: MigrationFetch;
  readonly #maximumResponseBytes: number;

  constructor(options: SanityMigrationSourceOptions) {
    if (!options.token) throw new Error('Sanity migration token is required.');
    this.descriptor = {
      id: options.id,
      provider: 'sanity' as const,
      name: options.name,
      supportsDelta: false,
      reportsDeletions: false,
      includesAssets: true,
    };
    this.#dataset = options.dataset;
    this.#token = options.token;
    this.#apiVersion = options.apiVersion ?? 'v2021-03-25';
    this.#includeDrafts = options.includeDrafts ?? false;
    this.#baseUrl = configuredBaseUrl(
      options.baseUrl ?? `https://${options.projectId}.api.sanity.io`,
    );
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maximumResponseBytes =
      options.maximumResponseBytes ?? resourceLimits.migration.maximumSourceResponseBytes;
  }

  async read(input: MigrationSourceReadInput): Promise<MigrationSourceSnapshot> {
    if (input.mode !== 'full') {
      throw new Error(
        'Sanity migration uses complete snapshots instead of unsafe inferred deltas.',
      );
    }
    const url = new URL(
      `/${encodeURIComponent(this.#apiVersion)}/data/export/${encodeURIComponent(this.#dataset)}`,
      this.#baseUrl,
    );
    const response = await this.#fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${this.#token}`, accept: 'application/x-ndjson' },
    });
    const text = await boundedResponseText(response, this.#baseUrl, this.#maximumResponseBytes);
    const records: MigrationSourceRecord[] = [];
    for (const line of text.split(/\r?\n/gu).filter(Boolean)) {
      const document = parsedObject(line, 'Sanity');
      const id = nonEmptyString(document._id);
      const type = nonEmptyString(document._type);
      if (!id || !type) throw sourceError('Sanity export document is missing _id or _type.');
      if (!this.#includeDrafts && id.startsWith('drafts.')) continue;
      records.push({
        externalId: id,
        sourceType: `sanity.${type}`,
        status: id.startsWith('drafts.') ? 'draft' : 'published',
        ...(nonEmptyString(document._updatedAt)
          ? { updatedAt: nonEmptyString(document._updatedAt) }
          : {}),
        data: document,
      });
      if (records.length > input.maximumRecords) {
        throw sourceError('Sanity export exceeds the configured record limit.');
      }
    }
    return {
      kind: 'full',
      records,
      checkpoint: snapshotCheckpoint(records),
      complete: true,
    };
  }
}

export interface WordPressMigrationSourceOptions extends SourceTransportOptions {
  id: string;
  name: string;
  baseUrl: string;
  authorizationHeader?: string;
  collections?: Array<'posts' | 'pages' | 'media'>;
  context?: 'view' | 'edit';
}

export class WordPressMigrationSourceAdapter implements MigrationSourceAdapter {
  readonly descriptor;
  readonly #baseUrl: URL;
  readonly #authorizationHeader: string | undefined;
  readonly #collections: Array<'posts' | 'pages' | 'media'>;
  readonly #context: 'view' | 'edit';
  readonly #fetch: MigrationFetch;
  readonly #maximumResponseBytes: number;

  constructor(options: WordPressMigrationSourceOptions) {
    this.#collections = options.collections ?? ['posts', 'pages', 'media'];
    this.descriptor = {
      id: options.id,
      provider: 'wordpress' as const,
      name: options.name,
      supportsDelta: false,
      reportsDeletions: false,
      includesAssets: this.#collections.includes('media'),
    };
    this.#baseUrl = configuredBaseUrl(options.baseUrl);
    this.#authorizationHeader = options.authorizationHeader;
    this.#context = options.context ?? 'view';
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maximumResponseBytes =
      options.maximumResponseBytes ?? resourceLimits.migration.maximumSourceResponseBytes;
  }

  #updatedAt(record: Record<string, unknown>): string | undefined {
    const raw = nonEmptyString(record.modified_gmt) ?? nonEmptyString(record.modified);
    if (!raw) return undefined;
    const timestamp = raw.endsWith('Z') || /[+-]\d\d:\d\d$/u.test(raw) ? raw : `${raw}Z`;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
  }

  async read(input: MigrationSourceReadInput): Promise<MigrationSourceSnapshot> {
    if (input.mode !== 'full') {
      throw new Error(
        'WordPress migration uses full reconciliation because REST has no deletion feed.',
      );
    }
    const records: MigrationSourceRecord[] = [];
    for (const collection of this.#collections) {
      let totalPages = 1;
      for (let page = 1; page <= totalPages; page += 1) {
        const url = new URL(`wp-json/wp/v2/${collection}`, this.#baseUrl);
        url.searchParams.set('context', this.#context);
        url.searchParams.set('per_page', '100');
        url.searchParams.set('page', String(page));
        url.searchParams.set('orderby', 'modified');
        url.searchParams.set('order', 'asc');
        const headers: Record<string, string> = { accept: 'application/json' };
        if (this.#authorizationHeader) headers.authorization = this.#authorizationHeader;
        const response = await this.#fetch(url, { method: 'GET', redirect: 'error', headers });
        const text = await boundedResponseText(response, this.#baseUrl, this.#maximumResponseBytes);
        let payload: unknown;
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          throw sourceError('WordPress returned malformed JSON.');
        }
        if (!Array.isArray(payload)) throw sourceError('WordPress collection must be an array.');
        const pages = Number(response.headers.get('x-wp-totalpages'));
        if (!Number.isInteger(pages) || pages < 1) {
          throw sourceError('WordPress response is missing a valid X-WP-TotalPages header.');
        }
        totalPages = pages;
        for (const item of payload) {
          const record = objectValue(item);
          const id =
            record && (typeof record.id === 'number' || typeof record.id === 'string')
              ? String(record.id)
              : undefined;
          if (!record || !id) throw sourceError('WordPress record is missing its ID.');
          const type = collection === 'posts' ? 'post' : collection === 'pages' ? 'page' : 'media';
          records.push({
            externalId: `${type}:${id}`,
            sourceType: `wordpress.${type}`,
            status: record.status === 'publish' || this.#context === 'view' ? 'published' : 'draft',
            ...(this.#updatedAt(record) ? { updatedAt: this.#updatedAt(record) } : {}),
            data: record,
          });
          if (records.length > input.maximumRecords) {
            throw sourceError('WordPress export exceeds the configured record limit.');
          }
        }
      }
    }
    return {
      kind: 'full',
      records,
      checkpoint: snapshotCheckpoint(records),
      complete: true,
    };
  }
}
