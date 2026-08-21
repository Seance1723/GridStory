import { DatabaseSync } from 'node:sqlite';
import {
  type BreakGlassAccount,
  breakGlassAccountSchema,
  type DirectoryGroup,
  type DirectoryUser,
  defaultSessionPolicy,
  directoryGroupSchema,
  directoryUserSchema,
  type GroupRoleMapping,
  groupRoleMappingSchema,
  type IdentityProvider,
  type IdentitySecurityEvent,
  type IdentitySession,
  identityProviderSchema,
  identitySecurityEventSchema,
  identitySessionSchema,
  type SessionPolicy,
  sessionPolicySchema,
  type WebAuthnCredential,
  webAuthnCredentialSchema,
} from '@gridstory/schema';
import { Pool, type PoolConfig } from 'pg';
import { z } from 'zod';
import { GridStoryError } from './errors.js';
import type { Awaitable } from './types.js';

export interface IdentityTenantScope {
  organizationId: string;
  tenantId: string;
}

export interface StoredIdentitySession extends IdentitySession {
  secretHash: string;
}

export interface StoredWebAuthnChallenge extends IdentityTenantScope {
  id: string;
  kind: 'registration' | 'authentication';
  challenge: string;
  userId: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string | undefined;
}

export interface StoredServiceCredential extends IdentityTenantScope {
  id: string;
  name: string;
  secretHash: string;
  status: 'active' | 'revoked';
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string | undefined;
  revokedAt?: string | undefined;
}

export interface StoredFederationTransaction extends IdentityTenantScope {
  id: string;
  protocol: 'oidc' | 'saml';
  stateHash: string;
  nonce?: string | undefined;
  codeVerifier?: string | undefined;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string | undefined;
}

export interface StoredProtocolRequest extends IdentityTenantScope {
  key: string;
  value: string;
  createdAt: string;
  expiresAt: string;
}

export interface StoredBreakGlassAccount extends BreakGlassAccount {
  secretHash: string;
  failedAttempts: number;
}

export interface IdentityDocument extends IdentityTenantScope {
  version: number;
  providers: IdentityProvider[];
  users: DirectoryUser[];
  groups: DirectoryGroup[];
  mappings: GroupRoleMapping[];
  sessions: StoredIdentitySession[];
  credentials: WebAuthnCredential[];
  challenges: StoredWebAuthnChallenge[];
  serviceCredentials: StoredServiceCredential[];
  federationTransactions: StoredFederationTransaction[];
  protocolRequests: StoredProtocolRequest[];
  breakGlassAccounts: StoredBreakGlassAccount[];
  policy: SessionPolicy;
  securityEvents: IdentitySecurityEvent[];
  createdAt: string;
  updatedAt: string;
}

const identityScopeSchema = z.object({
  organizationId: z.string().trim().min(1).max(128),
  tenantId: z.string().trim().min(1).max(128),
});
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const storedSessionSchema = identitySessionSchema.extend({ secretHash: digestSchema });
const storedChallengeSchema = identityScopeSchema.extend({
  id: z.string().trim().min(1).max(128),
  kind: z.enum(['registration', 'authentication']),
  challenge: z.string().min(16).max(1024),
  userId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  consumedAt: z.string().datetime().optional(),
});
const storedServiceCredentialSchema = identityScopeSchema.extend({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(256),
  secretHash: digestSchema,
  status: z.enum(['active', 'revoked']),
  createdBy: z.string().trim().min(1).max(128),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
});
const storedFederationTransactionSchema = identityScopeSchema.extend({
  id: z.string().trim().min(1).max(128),
  protocol: z.enum(['oidc', 'saml']),
  stateHash: digestSchema,
  nonce: z.string().min(16).max(1024).optional(),
  codeVerifier: z.string().min(16).max(1024).optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  consumedAt: z.string().datetime().optional(),
});
const storedProtocolRequestSchema = identityScopeSchema.extend({
  key: z.string().min(1).max(1024),
  value: z.string().min(1).max(4096),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
const storedBreakGlassSchema = breakGlassAccountSchema.extend({
  secretHash: digestSchema,
  failedAttempts: z.number().int().nonnegative(),
});
export const identityDocumentSchema = identityScopeSchema.extend({
  version: z.number().int().nonnegative(),
  providers: z.array(identityProviderSchema).max(50),
  users: z.array(directoryUserSchema).max(100_000),
  groups: z.array(directoryGroupSchema).max(10_000),
  mappings: z.array(groupRoleMappingSchema).max(10_000),
  sessions: z.array(storedSessionSchema).max(100_000),
  credentials: z.array(webAuthnCredentialSchema).max(100_000),
  challenges: z.array(storedChallengeSchema).max(100_000),
  serviceCredentials: z.array(storedServiceCredentialSchema).max(1_000),
  federationTransactions: z.array(storedFederationTransactionSchema).max(10_000),
  protocolRequests: z.array(storedProtocolRequestSchema).max(10_000),
  breakGlassAccounts: z.array(storedBreakGlassSchema).max(100),
  policy: sessionPolicySchema,
  securityEvents: z.array(identitySecurityEventSchema).max(100_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export function emptyIdentityDocument(
  scope: IdentityTenantScope,
  timestamp = '1970-01-01T00:00:00.000Z',
): IdentityDocument {
  return {
    ...scope,
    version: 0,
    providers: [],
    users: [],
    groups: [],
    mappings: [],
    sessions: [],
    credentials: [],
    challenges: [],
    serviceCredentials: [],
    federationTransactions: [],
    protocolRequests: [],
    breakGlassAccounts: [],
    policy: { ...defaultSessionPolicy },
    securityEvents: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function identityTenantKey(scope: IdentityTenantScope): string {
  return JSON.stringify([scope.organizationId, scope.tenantId]);
}

function writeConflict(): GridStoryError {
  return new GridStoryError(
    'Identity state changed during this operation.',
    'identity_write_conflict',
    409,
  );
}

export interface IdentityRepository {
  get(scope: IdentityTenantScope): Awaitable<IdentityDocument | null>;
  save(document: IdentityDocument, expectedVersion: number | null): Awaitable<void>;
  close(): Awaitable<void>;
}

export class InMemoryIdentityRepository implements IdentityRepository {
  readonly #documents = new Map<string, IdentityDocument>();

  get(scope: IdentityTenantScope): IdentityDocument | null {
    const document = this.#documents.get(identityTenantKey(scope));
    return document ? structuredClone(document) : null;
  }

  save(document: IdentityDocument, expectedVersion: number | null): void {
    const parsed = identityDocumentSchema.parse(document);
    const key = identityTenantKey(parsed);
    const current = this.#documents.get(key);
    if (expectedVersion === null ? current !== undefined : current?.version !== expectedVersion) {
      throw writeConflict();
    }
    this.#documents.set(key, structuredClone(parsed));
  }

  close(): void {}
}

interface PayloadRow {
  payload: string;
}

export class SqliteIdentityRepository implements IdentityRepository {
  readonly #database: DatabaseSync;

  constructor(options: { filename: string }) {
    this.#database = new DatabaseSync(options.filename);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS gridstory_identity_documents (
        scope_key TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 0),
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_gridstory_identity_updated
        ON gridstory_identity_documents (organization_id, tenant_id, updated_at DESC);
    `);
  }

  get(scope: IdentityTenantScope): IdentityDocument | null {
    const row = this.#database
      .prepare('SELECT payload FROM gridstory_identity_documents WHERE scope_key = ?')
      .get(identityTenantKey(scope)) as unknown as PayloadRow | undefined;
    return row ? identityDocumentSchema.parse(JSON.parse(row.payload)) : null;
  }

  save(document: IdentityDocument, expectedVersion: number | null): void {
    const parsed = identityDocumentSchema.parse(document);
    if (expectedVersion === null) {
      try {
        this.#database
          .prepare(
            `INSERT INTO gridstory_identity_documents (
               scope_key, organization_id, tenant_id, version, updated_at, payload)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            identityTenantKey(parsed),
            parsed.organizationId,
            parsed.tenantId,
            parsed.version,
            parsed.updatedAt,
            JSON.stringify(parsed),
          );
        return;
      } catch (error) {
        if (String(error).includes('UNIQUE constraint failed')) throw writeConflict();
        throw error;
      }
    }
    const result = this.#database
      .prepare(
        `UPDATE gridstory_identity_documents
         SET version = ?, updated_at = ?, payload = ?
         WHERE scope_key = ? AND version = ?`,
      )
      .run(
        parsed.version,
        parsed.updatedAt,
        JSON.stringify(parsed),
        identityTenantKey(parsed),
        expectedVersion,
      );
    if (result.changes !== 1) throw writeConflict();
  }

  close(): void {
    this.#database.close();
  }
}

export class PostgresIdentityRepository implements IdentityRepository {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  readonly #table: string;
  readonly #ready: Promise<unknown>;

  constructor(options: { connectionString?: string; pool?: Pool; schema?: string }) {
    const schema = options.schema ?? 'gridstory';
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new Error('PostgreSQL identity schema name is invalid.');
    }
    if (!options.pool && !options.connectionString) {
      throw new Error('PostgreSQL identity connectionString or pool is required.');
    }
    this.#pool =
      options.pool ?? new Pool({ connectionString: options.connectionString } as PoolConfig);
    this.#ownsPool = !options.pool;
    const quotedSchema = `"${schema}"`;
    this.#table = `${quotedSchema}.gridstory_identity_documents`;
    this.#ready = this.#pool.query(`
      CREATE SCHEMA IF NOT EXISTS ${quotedSchema};
      CREATE TABLE IF NOT EXISTS ${this.#table} (
        scope_key TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 0),
        updated_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gridstory_identity_updated
        ON ${this.#table} (organization_id, tenant_id, updated_at DESC);
    `);
  }

  async get(scope: IdentityTenantScope): Promise<IdentityDocument | null> {
    await this.#ready;
    const result = await this.#pool.query<{ payload: unknown }>(
      `SELECT payload FROM ${this.#table} WHERE scope_key = $1`,
      [identityTenantKey(scope)],
    );
    return result.rows[0] ? identityDocumentSchema.parse(result.rows[0].payload) : null;
  }

  async save(document: IdentityDocument, expectedVersion: number | null): Promise<void> {
    await this.#ready;
    const parsed = identityDocumentSchema.parse(document);
    if (expectedVersion === null) {
      const result = await this.#pool.query(
        `INSERT INTO ${this.#table} (
           scope_key, organization_id, tenant_id, version, updated_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (scope_key) DO NOTHING`,
        [
          identityTenantKey(parsed),
          parsed.organizationId,
          parsed.tenantId,
          parsed.version,
          parsed.updatedAt,
          JSON.stringify(parsed),
        ],
      );
      if (result.rowCount !== 1) throw writeConflict();
      return;
    }
    const result = await this.#pool.query(
      `UPDATE ${this.#table}
       SET version = $1, updated_at = $2, payload = $3::jsonb
       WHERE scope_key = $4 AND version = $5`,
      [
        parsed.version,
        parsed.updatedAt,
        JSON.stringify(parsed),
        identityTenantKey(parsed),
        expectedVersion,
      ],
    );
    if (result.rowCount !== 1) throw writeConflict();
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }
}
