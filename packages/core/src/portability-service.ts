import { createHash } from 'node:crypto';
import { type ContentScope, resourceLimits } from '@gridstory/schema';
import { GridStoryError } from './errors.js';
import type {
  ContentRepository,
  ImportConflictPolicy,
  PortableContentRecord,
  PortableImportResult,
} from './types.js';

export const LOGICAL_ARCHIVE_FORMAT = 'gridstory.logical-content';
export const LOGICAL_ARCHIVE_VERSION = 1;

export interface LogicalArchiveManifest {
  kind: 'manifest';
  format: typeof LOGICAL_ARCHIVE_FORMAT;
  version: typeof LOGICAL_ARCHIVE_VERSION;
  sourceScope: ContentScope;
  exportedAt: string;
  entryCount: number;
  archiveChecksum: string;
  schemaFingerprint?: string;
}

export interface LogicalArchiveEntry {
  kind: 'entry';
  checksum: string;
  record: PortableContentRecord;
}

export interface LogicalArchive {
  manifest: LogicalArchiveManifest;
  entries: LogicalArchiveEntry[];
}

export class PortabilityError extends GridStoryError {
  constructor(message: string, details?: unknown) {
    super(message, 'invalid_archive', 400, details);
    this.name = 'PortabilityError';
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function logicalChecksum(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PortabilityError(`Archive value ${path} must be a non-empty string.`);
  }
  return value;
}

function requireChecksum(value: unknown, path: string): string {
  const checksum = requireString(value, path);
  if (!/^[a-f0-9]{64}$/u.test(checksum)) {
    throw new PortabilityError(`Archive value ${path} must be a SHA-256 checksum.`);
  }
  return checksum;
}

function validatePortableRecord(record: PortableContentRecord, index: number): void {
  const path = `entries[${index}].record`;
  requireString(record.entryId, `${path}.entryId`);
  requireString(record.contentType, `${path}.contentType`);
  requireString(record.currentDraftRevisionId, `${path}.currentDraftRevisionId`);
  requireString(record.translationGroupId, `${path}.translationGroupId`);
  requireString(record.createdAt, `${path}.createdAt`);
  requireString(record.updatedAt, `${path}.updatedAt`);
  if (!Array.isArray(record.revisions) || record.revisions.length === 0) {
    throw new PortabilityError(`${path}.revisions must contain at least one revision.`);
  }
  if (record.revisions.length > resourceLimits.portability.maximumRevisionsPerEntry) {
    throw new PortabilityError(
      `${path}.revisions cannot exceed ${resourceLimits.portability.maximumRevisionsPerEntry} records.`,
    );
  }
  if (!Array.isArray(record.auditEvents)) {
    throw new PortabilityError(`${path}.auditEvents must be an array.`);
  }
  if (record.auditEvents.length > resourceLimits.portability.maximumAuditEventsPerEntry) {
    throw new PortabilityError(
      `${path}.auditEvents cannot exceed ${resourceLimits.portability.maximumAuditEventsPerEntry} records.`,
    );
  }
  const revisionIds = new Set<string>();
  const sequences = new Set<number>();
  for (const revision of record.revisions) {
    if (!isRecord(revision)) throw new PortabilityError(`${path}.revisions must contain objects.`);
    requireString(revision.id, `${path}.revisions.id`);
    requireString(revision.actorId, `${path}.revisions.actorId`);
    requireString(revision.createdAt, `${path}.revisions.createdAt`);
    if (!Number.isInteger(revision.sequence) || revision.sequence < 1) {
      throw new PortabilityError(`${path}.revisions.sequence must be a positive integer.`);
    }
    if (!isRecord(revision.data)) {
      throw new PortabilityError(`${path}.revisions.data must be a JSON object.`);
    }
    if (revisionIds.has(revision.id) || sequences.has(revision.sequence)) {
      throw new PortabilityError(`${path}.revisions contains duplicate IDs or sequences.`);
    }
    revisionIds.add(revision.id);
    sequences.add(revision.sequence);
  }
  for (const revision of record.revisions) {
    if (revision.baseRevisionId && !revisionIds.has(revision.baseRevisionId)) {
      throw new PortabilityError(`${path}.revisions.baseRevisionId is not present in the entry.`);
    }
  }
  if (!revisionIds.has(record.currentDraftRevisionId)) {
    throw new PortabilityError(`${path}.currentDraftRevisionId does not reference a revision.`);
  }
  if (record.publishedRevisionId && !revisionIds.has(record.publishedRevisionId)) {
    throw new PortabilityError(`${path}.publishedRevisionId does not reference a revision.`);
  }
  const auditIds = new Set<string>();
  const auditSequences = new Set<number>();
  for (const event of record.auditEvents) {
    if (!isRecord(event)) throw new PortabilityError(`${path}.auditEvents must contain objects.`);
    requireString(event.id, `${path}.auditEvents.id`);
    requireString(event.actorId, `${path}.auditEvents.actorId`);
    requireString(event.revisionId, `${path}.auditEvents.revisionId`);
    requireString(event.occurredAt, `${path}.auditEvents.occurredAt`);
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      throw new PortabilityError(`${path}.auditEvents.sequence must be a positive integer.`);
    }
    if (
      event.action !== 'content.created' &&
      event.action !== 'content.draft.updated' &&
      event.action !== 'content.published'
    ) {
      throw new PortabilityError(`${path}.auditEvents.action is unsupported.`);
    }
    if (
      auditIds.has(event.id) ||
      auditSequences.has(event.sequence) ||
      !revisionIds.has(event.revisionId)
    ) {
      throw new PortabilityError(`${path}.auditEvents contains a duplicate or invalid reference.`);
    }
    auditIds.add(event.id);
    auditSequences.add(event.sequence);
  }
  if ([...auditSequences].sort((left, right) => left - right).some((value, i) => value !== i + 1)) {
    throw new PortabilityError(`${path}.auditEvents sequences must be contiguous from one.`);
  }
}

export function validateLogicalArchive(archive: LogicalArchive): void {
  if (
    !isRecord(archive) ||
    !isRecord(archive.manifest) ||
    !Array.isArray(archive.entries) ||
    archive.entries.some((entry) => !isRecord(entry))
  ) {
    throw new PortabilityError('Archive must contain a manifest and entry array.');
  }
  if (
    archive.manifest.kind !== 'manifest' ||
    archive.manifest.format !== LOGICAL_ARCHIVE_FORMAT ||
    archive.manifest.version !== LOGICAL_ARCHIVE_VERSION
  ) {
    throw new PortabilityError('Archive format or version is unsupported.');
  }
  const sourceScope = archive.manifest.sourceScope;
  if (!isRecord(sourceScope)) throw new PortabilityError('Archive source scope is invalid.');
  for (const key of [
    'organizationId',
    'tenantId',
    'workspaceId',
    'siteId',
    'environmentId',
    'locale',
  ] as const) {
    requireString(sourceScope[key], `manifest.sourceScope.${key}`);
  }
  requireString(archive.manifest.exportedAt, 'manifest.exportedAt');
  requireChecksum(archive.manifest.archiveChecksum, 'manifest.archiveChecksum');
  if (archive.manifest.schemaFingerprint !== undefined) {
    requireString(archive.manifest.schemaFingerprint, 'manifest.schemaFingerprint');
  }
  if (archive.manifest.entryCount !== archive.entries.length) {
    throw new PortabilityError('Archive entry count does not match its manifest.');
  }
  if (archive.entries.length > resourceLimits.portability.maximumEntries) {
    throw new PortabilityError(
      `Archive cannot exceed ${resourceLimits.portability.maximumEntries} entries.`,
    );
  }
  const entryIds = new Set<string>();
  const revisionIds = new Set<string>();
  const auditIds = new Set<string>();
  archive.entries.forEach((entry, index) => {
    if (entry.kind !== 'entry' || !isRecord(entry.record)) {
      throw new PortabilityError(`Archive line ${index + 2} is invalid.`);
    }
    requireChecksum(entry.checksum, `entries[${index}].checksum`);
    validatePortableRecord(entry.record, index);
    if (entryIds.has(entry.record.entryId)) {
      throw new PortabilityError(`Archive contains duplicate entry ID ${entry.record.entryId}.`);
    }
    entryIds.add(entry.record.entryId);
    for (const revision of entry.record.revisions) {
      if (revisionIds.has(revision.id)) {
        throw new PortabilityError(`Archive contains duplicate revision ID ${revision.id}.`);
      }
      revisionIds.add(revision.id);
    }
    for (const event of entry.record.auditEvents) {
      if (auditIds.has(event.id)) {
        throw new PortabilityError(`Archive contains duplicate audit ID ${event.id}.`);
      }
      auditIds.add(event.id);
    }
    const checksum = logicalChecksum(entry.record);
    if (checksum !== entry.checksum) {
      throw new PortabilityError(`Archive checksum failed for entry ${entry.record.entryId}.`);
    }
  });
  const archiveChecksum = logicalChecksum(archive.entries.map((entry) => entry.checksum));
  if (archiveChecksum !== archive.manifest.archiveChecksum) {
    throw new PortabilityError('Archive manifest checksum does not match its entries.');
  }
}

export function logicalArchiveFromUnknown(value: unknown): LogicalArchive {
  if (!isRecord(value) || !isRecord(value.manifest) || !Array.isArray(value.entries)) {
    throw new PortabilityError('Archive must contain a manifest and entry array.');
  }
  const archive = value as unknown as LogicalArchive;
  validateLogicalArchive(archive);
  return archive;
}

export function serializeLogicalArchive(archive: LogicalArchive): string {
  validateLogicalArchive(archive);
  return `${[archive.manifest, ...archive.entries].map(canonicalJson).join('\n')}\n`;
}

export function parseLogicalArchive(value: string): LogicalArchive {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new PortabilityError('Archive is empty.');
  let parsed: unknown[];
  try {
    parsed = lines.map((line) => JSON.parse(line) as unknown);
  } catch {
    throw new PortabilityError('Archive contains malformed JSON lines.');
  }
  const [manifestValue, ...entryValues] = parsed;
  if (!isRecord(manifestValue) || entryValues.some((entry) => !isRecord(entry))) {
    throw new PortabilityError('Archive lines must be JSON objects.');
  }
  const archive = logicalArchiveFromUnknown({
    manifest: manifestValue,
    entries: entryValues,
  });
  return archive;
}

export interface PortabilityServiceOptions {
  repository: ContentRepository;
  now?: () => string;
}

export class PortabilityService {
  readonly #repository: ContentRepository;
  readonly #now: () => string;

  constructor({ repository, now = () => new Date().toISOString() }: PortabilityServiceOptions) {
    this.#repository = repository;
    this.#now = now;
  }

  async export(scope: ContentScope): Promise<LogicalArchive> {
    const records = await this.#repository.exportPortableContent({ scope });
    if (records.length > resourceLimits.portability.maximumEntries) {
      throw new PortabilityError(
        `Archive cannot exceed ${resourceLimits.portability.maximumEntries} entries.`,
      );
    }
    const entries = records.map((record) => ({
      kind: 'entry' as const,
      checksum: logicalChecksum(record),
      record,
    }));
    const deployment = await this.#repository.getSchemaDeployment({ scope });
    return {
      manifest: {
        kind: 'manifest',
        format: LOGICAL_ARCHIVE_FORMAT,
        version: LOGICAL_ARCHIVE_VERSION,
        sourceScope: scope,
        exportedAt: this.#now(),
        entryCount: entries.length,
        archiveChecksum: logicalChecksum(entries.map((entry) => entry.checksum)),
        ...(deployment ? { schemaFingerprint: deployment.fingerprint } : {}),
      },
      entries,
    };
  }

  async import(input: {
    scope: ContentScope;
    archive: LogicalArchive;
    conflictPolicy?: ImportConflictPolicy;
    dryRun?: boolean;
    allowSchemaMismatch?: boolean;
  }): Promise<PortableImportResult> {
    validateLogicalArchive(input.archive);
    const deployment = await this.#repository.getSchemaDeployment({ scope: input.scope });
    if (
      !input.allowSchemaMismatch &&
      deployment &&
      input.archive.manifest.schemaFingerprint &&
      deployment.fingerprint !== input.archive.manifest.schemaFingerprint
    ) {
      throw new PortabilityError('Archive schema fingerprint does not match the target scope.', {
        archive: input.archive.manifest.schemaFingerprint,
        target: deployment.fingerprint,
      });
    }
    return await this.#repository.importPortableContent({
      scope: input.scope,
      records: input.archive.entries.map((entry) => entry.record),
      conflictPolicy: input.conflictPolicy ?? 'reject',
      dryRun: input.dryRun ?? true,
    });
  }
}
