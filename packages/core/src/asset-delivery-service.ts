import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  assetDeliveryGrantSchema,
  type AssetDeliveryGrant,
  type ContentScope,
} from '@gridstory/schema';
import { GridStoryError } from './errors.js';

interface AssetDeliveryClaims extends ContentScope {
  version: 1;
  assetId: string;
  revisionId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface AssetDeliveryServiceOptions {
  signingSecret: string;
  now?: () => Date;
}

function encoded(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function decoded(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) {
    throw new GridStoryError(
      `Delivery token ${name} is invalid.`,
      'invalid_asset_delivery_token',
      401,
    );
  }
  return value;
}

export class AssetDeliveryService {
  readonly #signingSecret: string;
  readonly #now: () => Date;

  constructor(options: AssetDeliveryServiceOptions) {
    if (options.signingSecret.length < 32) {
      throw new Error('Asset delivery signing secret must contain at least 32 characters.');
    }
    this.#signingSecret = options.signingSecret;
    this.#now = options.now ?? (() => new Date());
  }

  create(input: {
    scope: ContentScope;
    assetId: string;
    revisionId: string;
    ttlSeconds: number;
  }): AssetDeliveryGrant {
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 30 || input.ttlSeconds > 900) {
      throw new GridStoryError(
        'Asset delivery lifetime must be between 30 and 900 seconds.',
        'invalid_asset_delivery_ttl',
        400,
      );
    }
    const issuedAt = Math.floor(this.#now().getTime() / 1000);
    const claims: AssetDeliveryClaims = {
      version: 1,
      ...input.scope,
      assetId: input.assetId,
      revisionId: input.revisionId,
      issuedAt,
      expiresAt: issuedAt + input.ttlSeconds,
      nonce: randomUUID(),
    };
    const payload = encoded(JSON.stringify(claims));
    const signature = this.#signature(payload);
    return assetDeliveryGrantSchema.parse({
      assetId: input.assetId,
      revisionId: input.revisionId,
      url: `/api/v1/assets/${encodeURIComponent(input.assetId)}/content?token=${payload}.${signature}`,
      expiresAt: new Date(claims.expiresAt * 1000).toISOString(),
    });
  }

  authenticate(token: string, expectedAssetId: string): AssetDeliveryClaims {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) {
      throw new GridStoryError(
        'Asset delivery token is invalid.',
        'invalid_asset_delivery_token',
        401,
      );
    }
    const expected = this.#signature(payload);
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (
      actualBytes.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw new GridStoryError(
        'Asset delivery token is invalid.',
        'invalid_asset_delivery_token',
        401,
      );
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(decoded(payload));
    } catch {
      throw new GridStoryError(
        'Asset delivery token is invalid.',
        'invalid_asset_delivery_token',
        401,
      );
    }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new GridStoryError(
        'Asset delivery token is invalid.',
        'invalid_asset_delivery_token',
        401,
      );
    }
    const value = candidate as Record<string, unknown>;
    const claims: AssetDeliveryClaims = {
      version: value.version === 1 ? 1 : this.#invalidVersion(),
      organizationId: requiredString(value.organizationId, 'organizationId'),
      tenantId: requiredString(value.tenantId, 'tenantId'),
      workspaceId: requiredString(value.workspaceId, 'workspaceId'),
      siteId: requiredString(value.siteId, 'siteId'),
      environmentId: requiredString(value.environmentId, 'environmentId'),
      locale: requiredString(value.locale, 'locale'),
      assetId: requiredString(value.assetId, 'assetId'),
      revisionId: requiredString(value.revisionId, 'revisionId'),
      issuedAt: this.#integer(value.issuedAt),
      expiresAt: this.#integer(value.expiresAt),
      nonce: requiredString(value.nonce, 'nonce'),
    };
    if (claims.assetId !== expectedAssetId) {
      throw new GridStoryError(
        'Asset delivery token is invalid.',
        'invalid_asset_delivery_token',
        401,
      );
    }
    if (claims.expiresAt <= Math.floor(this.#now().getTime() / 1000)) {
      throw new GridStoryError(
        'Asset delivery token has expired.',
        'asset_delivery_token_expired',
        401,
      );
    }
    return claims;
  }

  #signature(payload: string): string {
    return createHmac('sha256', this.#signingSecret).update(payload).digest('base64url');
  }

  #integer(value: unknown): number {
    if (!Number.isInteger(value)) {
      throw new GridStoryError(
        'Asset delivery token is invalid.',
        'invalid_asset_delivery_token',
        401,
      );
    }
    return value as number;
  }

  #invalidVersion(): never {
    throw new GridStoryError(
      'Asset delivery token is invalid.',
      'invalid_asset_delivery_token',
      401,
    );
  }
}
