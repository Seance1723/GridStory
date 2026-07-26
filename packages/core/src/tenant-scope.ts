import type { ContentEntry, ContentScope } from '@gridstory/schema';
import { GridStoryError } from './errors.js';

export const contentScopeFields = [
  'organizationId',
  'tenantId',
  'workspaceId',
  'siteId',
  'environmentId',
  'locale',
] as const satisfies ReadonlyArray<keyof ContentScope>;

const identifierPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;
const sensitiveMetadataPattern =
  /(?:authorization|cookie|credential|password|secret|token|content|body|payload|email)/i;

export class InvalidContentScopeError extends GridStoryError {
  constructor(field: keyof ContentScope) {
    super(`Content scope field ${field} is invalid.`, 'invalid_scope', 400, { field });
    this.name = 'InvalidContentScopeError';
  }
}

export class TenantScopeViolationError extends GridStoryError {
  constructor(boundary: string) {
    super('A tenant scope boundary returned inconsistent data.', 'tenant_scope_violation', 500, {
      boundary,
    });
    this.name = 'TenantScopeViolationError';
  }
}

export function contentScopeTuple(
  scope: ContentScope,
): [string, string, string, string, string, string] {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
    scope.locale,
  ];
}

export function assertValidContentScope(scope: ContentScope): ContentScope {
  for (const field of contentScopeFields) {
    const value = scope[field];
    if (typeof value !== 'string' || value !== value.trim() || !identifierPattern.test(value)) {
      throw new InvalidContentScopeError(field);
    }
  }
  return scope;
}

export function contentScopeKey(scope: ContentScope): string {
  assertValidContentScope(scope);
  return JSON.stringify(contentScopeTuple(scope));
}

export function contentScopePath(scope: ContentScope): string {
  assertValidContentScope(scope);
  return contentScopeTuple(scope)
    .map((value) => encodeURIComponent(value))
    .join('/');
}

export function sameContentScope(left: ContentScope, right: ContentScope): boolean {
  return contentScopeFields.every((field) => left[field] === right[field]);
}

export function assertSameContentScope(
  expected: ContentScope,
  actual: ContentScope,
  boundary: string,
): void {
  assertValidContentScope(expected);
  assertValidContentScope(actual);
  if (!sameContentScope(expected, actual)) throw new TenantScopeViolationError(boundary);
}

function cacheComponent(value: string): string {
  return encodeURIComponent(value).replace(/:/g, '%3A');
}

export function contentScopeCachePrefix(scope: ContentScope): string {
  assertValidContentScope(scope);
  return `gridstory:scope:${contentScopeTuple(scope).map(cacheComponent).join(':')}`;
}

export function contentEventCacheTags(
  scope: ContentScope,
  contentType: string,
  entryId: string,
  revisionId: string,
): string[] {
  const prefix = contentScopeCachePrefix(scope);
  return [
    `${prefix}:tenant`,
    `${prefix}:site`,
    `${prefix}:environment`,
    `${prefix}:locale`,
    `${prefix}:type:${cacheComponent(contentType)}`,
    `${prefix}:entry:${cacheComponent(entryId)}`,
    `${prefix}:revision:${cacheComponent(revisionId)}`,
  ];
}

export function contentCacheTags(entry: ContentEntry): string[] {
  return contentEventCacheTags(
    entry,
    entry.contentType,
    entry.id,
    entry.publishedRevisionId ?? entry.draftRevisionId,
  );
}

export function scopedCustomCacheTags(scope: ContentScope, tags: string[]): string[] {
  const prefix = contentScopeCachePrefix(scope);
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].map(
    (tag) => `${prefix}:custom:${cacheComponent(tag.slice(0, 200))}`,
  );
}

export function cacheTagBelongsToScope(scope: ContentScope, tag: string): boolean {
  return tag.startsWith(`${contentScopeCachePrefix(scope)}:`);
}

export type TenantTelemetryOutcome = 'success' | 'denied' | 'error';
export type TenantTelemetryMetadata = Record<string, string | number | boolean>;

export interface TenantTelemetryEvent extends ContentScope {
  name: string;
  outcome: TenantTelemetryOutcome;
  occurredAt: string;
  operationId?: string;
  subjectId?: string;
  metadata?: TenantTelemetryMetadata;
}

export type TenantTelemetrySink = (event: TenantTelemetryEvent) => void | Promise<void>;

export function tenantTelemetryEvent(input: {
  scope: ContentScope;
  name: string;
  outcome: TenantTelemetryOutcome;
  occurredAt?: string;
  operationId?: string;
  subjectId?: string;
  metadata?: TenantTelemetryMetadata;
}): TenantTelemetryEvent {
  assertValidContentScope(input.scope);
  if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9]+){1,7}$/.test(input.name)) {
    throw new GridStoryError('Tenant telemetry event name is invalid.', 'invalid_telemetry', 500);
  }
  const entries = Object.entries(input.metadata ?? {});
  if (entries.length > 20) {
    throw new GridStoryError('Tenant telemetry metadata is too large.', 'invalid_telemetry', 500);
  }
  const metadata: TenantTelemetryMetadata = {};
  for (const [key, value] of entries) {
    if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(key) || sensitiveMetadataPattern.test(key)) {
      throw new GridStoryError(
        'Tenant telemetry metadata key is unsafe.',
        'invalid_telemetry',
        500,
      );
    }
    if (typeof value === 'string' && value.length > 200) {
      throw new GridStoryError(
        'Tenant telemetry metadata value is too large.',
        'invalid_telemetry',
        500,
      );
    }
    metadata[key] = value;
  }
  return {
    ...input.scope,
    name: input.name,
    outcome: input.outcome,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    ...(input.operationId ? { operationId: input.operationId } : {}),
    ...(input.subjectId ? { subjectId: input.subjectId } : {}),
    ...(entries.length ? { metadata } : {}),
  };
}

export async function emitTenantTelemetry(
  sink: TenantTelemetrySink | undefined,
  input: Parameters<typeof tenantTelemetryEvent>[0],
): Promise<void> {
  if (!sink) return;
  await sink(tenantTelemetryEvent(input));
}
