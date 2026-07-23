import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  PREVIEW_PROTOCOL_VERSION,
  previewSessionClaimsSchema,
  type ContentScope,
  type PreviewMode,
  type PreviewSessionClaims,
  type PreviewSessionGrant,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';

interface ActivePreviewSession {
  claims: PreviewSessionClaims;
  revoked: boolean;
  lastSequence: number;
  nonces: Set<string>;
}

export interface PreviewSessionServiceOptions {
  signingSecret: string;
  allowedOrigins: string[];
  now?: () => number;
  createId?: () => string;
  defaultTtlSeconds?: number;
  maximumTtlSeconds?: number;
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new GridStoryError('Preview URL is invalid.', 'invalid_preview_url', 400);
  }
}

export class PreviewSessionService {
  readonly #secret: string;
  readonly #allowedOrigins: Set<string>;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #defaultTtlSeconds: number;
  readonly #maximumTtlSeconds: number;
  readonly #sessions = new Map<string, ActivePreviewSession>();

  constructor(options: PreviewSessionServiceOptions) {
    if (options.signingSecret.length < 32) {
      throw new GridStoryError(
        'Preview signing secret must contain at least 32 characters.',
        'invalid_preview_configuration',
        500,
      );
    }
    this.#secret = options.signingSecret;
    this.#allowedOrigins = new Set(options.allowedOrigins.map(safeOrigin));
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#createId = options.createId ?? (() => randomBytes(18).toString('base64url'));
    this.#defaultTtlSeconds = options.defaultTtlSeconds ?? 120;
    this.#maximumTtlSeconds = options.maximumTtlSeconds ?? 300;
  }

  #signature(payload: string): Buffer {
    return createHmac('sha256', this.#secret).update(payload).digest();
  }

  create(input: {
    scope: ContentScope;
    previewUrl: string;
    route: string;
    mode: PreviewMode;
    entryId?: string;
    ttlSeconds?: number;
  }): PreviewSessionGrant {
    let url: URL;
    try {
      url = new URL(input.previewUrl);
    } catch {
      throw new GridStoryError('Preview URL is invalid.', 'invalid_preview_url', 400);
    }
    const origin = url.origin;
    if (!this.#allowedOrigins.has(origin)) {
      throw new GridStoryError('Preview origin is not allow-listed.', 'preview_origin_denied', 403);
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new GridStoryError('Preview URLs must use HTTPS.', 'insecure_preview_url', 400);
    }
    if (!input.route.startsWith('/')) {
      throw new GridStoryError('Preview route must start with /.', 'invalid_preview_route', 400);
    }
    const ttl = input.ttlSeconds ?? this.#defaultTtlSeconds;
    if (!Number.isInteger(ttl) || ttl < 15 || ttl > this.#maximumTtlSeconds) {
      throw new GridStoryError(
        `Preview TTL must be between 15 and ${this.#maximumTtlSeconds} seconds.`,
        'invalid_preview_ttl',
        400,
      );
    }
    const issuedAt = this.#now();
    const claims: PreviewSessionClaims = {
      audience: 'gridstory-preview',
      protocolVersion: PREVIEW_PROTOCOL_VERSION,
      sessionId: this.#createId(),
      scope: input.scope,
      origin,
      route: input.route,
      ...(input.entryId ? { entryId: input.entryId } : {}),
      mode: input.mode,
      issuedAt,
      expiresAt: issuedAt + ttl,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const token = `gsp_${payload}.${this.#signature(payload).toString('base64url')}`;
    this.#sessions.set(claims.sessionId, {
      claims,
      revoked: false,
      lastSequence: -1,
      nonces: new Set(),
    });
    return {
      token,
      sessionId: claims.sessionId,
      previewUrl: url.toString(),
      origin,
      protocolVersion: PREVIEW_PROTOCOL_VERSION,
      expiresAt: new Date(claims.expiresAt * 1000).toISOString(),
    };
  }

  authenticate(token: string, expectedOrigin?: string): PreviewSessionClaims {
    const match = /^gsp_([^.]+)\.([^.]+)$/.exec(token);
    if (!match) throw new GridStoryError('Preview token is invalid.', 'invalid_preview_token', 401);
    const payload = match[1] as string;
    const actual = Buffer.from(match[2] as string, 'base64url');
    const expected = this.#signature(payload);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new GridStoryError('Preview token is invalid.', 'invalid_preview_token', 401);
    }
    let claims: PreviewSessionClaims;
    try {
      claims = previewSessionClaimsSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
      );
    } catch {
      throw new GridStoryError('Preview token is invalid.', 'invalid_preview_token', 401);
    }
    const session = this.#sessions.get(claims.sessionId);
    if (!session || session.revoked || claims.expiresAt <= this.#now()) {
      throw new GridStoryError('Preview session is expired or revoked.', 'preview_expired', 401);
    }
    if (expectedOrigin && safeOrigin(expectedOrigin) !== claims.origin) {
      throw new GridStoryError(
        'Preview origin does not match the session.',
        'preview_origin_denied',
        403,
      );
    }
    return structuredClone(claims);
  }

  acceptMessage(sessionId: string, sequence: number, nonce: string): PreviewSessionClaims {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new NotFoundError('Preview session was not found.');
    if (session.revoked || session.claims.expiresAt <= this.#now()) {
      throw new GridStoryError('Preview session is expired or revoked.', 'preview_expired', 401);
    }
    if (sequence <= session.lastSequence || session.nonces.has(nonce)) {
      throw new GridStoryError('Preview message was replayed.', 'preview_replay', 409);
    }
    if (nonce.length < 16 || nonce.length > 200) {
      throw new GridStoryError('Preview nonce is invalid.', 'invalid_preview_message', 400);
    }
    session.lastSequence = sequence;
    session.nonces.add(nonce);
    if (session.nonces.size > 1000)
      session.nonces.delete(session.nonces.values().next().value as string);
    return structuredClone(session.claims);
  }

  revoke(sessionId: string, expectedScope?: ContentScope): void {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new NotFoundError('Preview session was not found.');
    if (
      expectedScope &&
      (Object.keys(expectedScope) as Array<keyof ContentScope>).some(
        (key) => expectedScope[key] !== session.claims.scope[key],
      )
    ) {
      throw new GridStoryError(
        'Preview session does not belong to the active scope.',
        'preview_scope_denied',
        403,
      );
    }
    session.revoked = true;
  }
}
