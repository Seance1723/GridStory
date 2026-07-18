import type { ContentScope } from '@gridstory/schema';
import { canonicalJson, logicalChecksum } from './portability-service.js';
import type { AuditEvent, ContentRepository } from './types.js';

export interface AuditVerificationFailure {
  eventId: string;
  entryId: string;
  reason: 'sequence_mismatch' | 'previous_hash_mismatch' | 'event_hash_mismatch';
}

export interface AuditVerification {
  valid: boolean;
  eventCount: number;
  entryCount: number;
  failures: AuditVerificationFailure[];
}

export interface AuditExport {
  manifest: {
    kind: 'gridstory.audit.manifest';
    version: 1;
    scope: ContentScope;
    exportedAt: string;
    eventCount: number;
    entryCount: number;
    auditChecksum: string;
    valid: boolean;
  };
  events: AuditEvent[];
  failures: AuditVerificationFailure[];
}

export function auditEventHash(event: Omit<AuditEvent, 'eventHash'>): string {
  return logicalChecksum({
    id: event.id,
    organizationId: event.organizationId,
    tenantId: event.tenantId,
    workspaceId: event.workspaceId,
    siteId: event.siteId,
    environmentId: event.environmentId,
    locale: event.locale,
    entryId: event.entryId,
    sequence: event.sequence,
    actorId: event.actorId,
    action: event.action,
    revisionId: event.revisionId,
    occurredAt: event.occurredAt,
    previousHash: event.previousHash ?? null,
  });
}

export function verifyAuditEvents(events: AuditEvent[]): AuditVerification {
  const failures: AuditVerificationFailure[] = [];
  const grouped = new Map<string, AuditEvent[]>();
  for (const event of events) {
    const current = grouped.get(event.entryId) ?? [];
    current.push(event);
    grouped.set(event.entryId, current);
  }
  for (const entryEvents of grouped.values()) {
    entryEvents.sort((left, right) => left.sequence - right.sequence);
    let previousHash: string | undefined;
    for (const [index, event] of entryEvents.entries()) {
      if (event.sequence !== index + 1) {
        failures.push({
          eventId: event.id,
          entryId: event.entryId,
          reason: 'sequence_mismatch',
        });
      }
      if (event.previousHash !== previousHash) {
        failures.push({
          eventId: event.id,
          entryId: event.entryId,
          reason: 'previous_hash_mismatch',
        });
      }
      const expectedHash = auditEventHash({
        ...event,
        ...(previousHash ? { previousHash } : {}),
      });
      if (event.eventHash !== expectedHash) {
        failures.push({
          eventId: event.id,
          entryId: event.entryId,
          reason: 'event_hash_mismatch',
        });
      }
      previousHash = event.eventHash;
    }
  }
  return {
    valid: failures.length === 0,
    eventCount: events.length,
    entryCount: grouped.size,
    failures,
  };
}

export function serializeAuditExport(auditExport: AuditExport): string {
  return `${[auditExport.manifest, ...auditExport.events].map(canonicalJson).join('\n')}\n`;
}

export class AuditService {
  readonly #repository: ContentRepository;
  readonly #now: () => string;

  constructor({
    repository,
    now = () => new Date().toISOString(),
  }: {
    repository: ContentRepository;
    now?: () => string;
  }) {
    this.#repository = repository;
    this.#now = now;
  }

  async verify(scope: ContentScope): Promise<AuditVerification> {
    return verifyAuditEvents(await this.#repository.listScopeAuditEvents({ scope }));
  }

  async export(scope: ContentScope): Promise<AuditExport> {
    const events = await this.#repository.listScopeAuditEvents({ scope });
    const verification = verifyAuditEvents(events);
    return {
      manifest: {
        kind: 'gridstory.audit.manifest',
        version: 1,
        scope,
        exportedAt: this.#now(),
        eventCount: verification.eventCount,
        entryCount: verification.entryCount,
        auditChecksum: logicalChecksum(events.map((event) => event.eventHash)),
        valid: verification.valid,
      },
      events,
      failures: verification.failures,
    };
  }
}
