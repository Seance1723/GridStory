import { type ContentFederationSourceAdapter, GridStoryError } from '@gridstory/core';
import { type ContentScope, resourceLimits } from '@gridstory/schema';

export interface HttpContentFederationSourceOptions {
  name: string;
  baseUrl: string;
  authorizationHeader?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function unavailable(): GridStoryError {
  return new GridStoryError(
    'Content federation source is unavailable.',
    'content_federation_source_unavailable',
    502,
  );
}

function scopeHeaders(scope: ContentScope): Record<string, string> {
  return {
    'x-gridstory-organization': scope.organizationId,
    'x-gridstory-tenant': scope.tenantId,
    'x-gridstory-workspace': scope.workspaceId,
    'x-gridstory-site': scope.siteId,
    'x-gridstory-environment': scope.environmentId,
    'x-gridstory-locale': scope.locale,
  };
}

export class HttpContentFederationSource implements ContentFederationSourceAdapter {
  readonly name: string;
  readonly #baseUrl: URL;
  readonly #authorizationHeader: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: HttpContentFederationSourceOptions) {
    this.name = options.name.trim();
    if (!this.name) throw new Error('Content federation source name is required.');
    const baseUrl = new URL(options.baseUrl);
    if (
      baseUrl.protocol !== 'https:' ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new Error('Content federation source base URL must be credential-free HTTPS.');
    }
    baseUrl.pathname = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;
    this.#baseUrl = baseUrl;
    this.#authorizationHeader = options.authorizationHeader;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0 || this.#timeoutMs > 60_000) {
      throw new Error(
        'Content federation source timeout must be between 1 and 60000 milliseconds.',
      );
    }
  }

  async #read(path: string, scope: ContentScope): Promise<unknown> {
    const url = new URL(path, this.#baseUrl);
    if (url.origin !== this.#baseUrl.origin) throw unavailable();
    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
        headers: {
          accept: 'application/json',
          ...scopeHeaders(scope),
          ...(this.#authorizationHeader ? { authorization: this.#authorizationHeader } : {}),
        },
      });
      if (!response.ok || new URL(response.url).origin !== this.#baseUrl.origin) {
        throw unavailable();
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > resourceLimits.contentFederation.maximumEnvelopeBytes
      ) {
        throw unavailable();
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > resourceLimits.contentFederation.maximumEnvelopeBytes) {
        throw unavailable();
      }
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unavailable();
      return value;
    } catch {
      throw unavailable();
    }
  }

  readOffer(input: {
    sourceScope: ContentScope;
    offerId: string;
    requestId: string;
  }): Promise<unknown> {
    const query = new URLSearchParams({ requestId: input.requestId });
    return this.#read(
      `api/v1/federation/source/offers/${encodeURIComponent(input.offerId)}?${query}`,
      input.sourceScope,
    );
  }

  readRecord(input: {
    sourceScope: ContentScope;
    offerId: string;
    namespace: string;
    sourceEntryId: string;
    requestId: string;
  }): Promise<unknown> {
    const query = new URLSearchParams({ requestId: input.requestId });
    return this.#read(
      `api/v1/federation/source/offers/${encodeURIComponent(input.offerId)}/records/${encodeURIComponent(input.namespace)}/${encodeURIComponent(input.sourceEntryId)}?${query}`,
      input.sourceScope,
    );
  }

  readSnapshot(input: {
    sourceScope: ContentScope;
    offerId: string;
    requestId: string;
    maximumRecords: number;
  }): Promise<unknown> {
    const query = new URLSearchParams({
      requestId: input.requestId,
      maximumRecords: String(input.maximumRecords),
    });
    return this.#read(
      `api/v1/federation/source/offers/${encodeURIComponent(input.offerId)}/snapshot?${query}`,
      input.sourceScope,
    );
  }
}
