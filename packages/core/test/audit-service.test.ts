import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AuditService,
  serializeAuditExport,
  SqliteContentRepository,
  verifyAuditEvents,
} from '../src/index.js';

const scope = {
  organizationId: 'organization',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'production',
  locale: 'en',
};

describe('tamper-evident audit history', () => {
  it('exports a scoped hash chain and identifies changed event data', async () => {
    const repository = new SqliteContentRepository({ filename: ':memory:' });
    try {
      const created = repository.create({
        scope,
        contentType: 'page',
        data: { title: 'Audit' },
        actor: { id: 'author' },
      });
      const updated = repository.updateDraft({
        scope,
        id: created.id,
        expectedRevisionId: created.draftRevisionId,
        data: { title: 'Audit updated' },
        actor: { id: 'editor' },
      });
      repository.publish({
        scope,
        id: created.id,
        expectedRevisionId: updated.draftRevisionId,
        actor: { id: 'publisher' },
      });

      const service = new AuditService({
        repository,
        now: () => '2026-07-17T00:00:00.000Z',
      });
      await expect(service.verify(scope)).resolves.toMatchObject({
        valid: true,
        eventCount: 3,
        entryCount: 1,
        failures: [],
      });
      const auditExport = await service.export(scope);
      expect(auditExport.manifest).toMatchObject({
        kind: 'gridstory.audit.manifest',
        version: 1,
        eventCount: 3,
        valid: true,
      });
      expect(auditExport.manifest.auditChecksum).toMatch(/^[a-f0-9]{64}$/u);
      expect(serializeAuditExport(auditExport).trim().split('\n')).toHaveLength(4);

      const tampered = structuredClone(auditExport.events);
      const first = tampered[0];
      if (!first) throw new Error('Expected an audit event.');
      first.actorId = 'intruder';
      expect(verifyAuditEvents(tampered)).toMatchObject({
        valid: false,
        failures: expect.arrayContaining([
          expect.objectContaining({ eventId: first.id, reason: 'event_hash_mismatch' }),
        ]),
      });
    } finally {
      repository.close();
    }
  });

  it('does not silently rehash a persisted chain after direct database tampering', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-audit-tamper-'));
    const filename = join(directory, 'audit.db');
    try {
      const repository = new SqliteContentRepository({ filename });
      repository.create({
        scope,
        contentType: 'page',
        data: { title: 'Original actor' },
        actor: { id: 'author' },
      });
      repository.close();

      const database = new DatabaseSync(filename);
      database.prepare("UPDATE audit_events SET actor_id = 'intruder' WHERE sequence = 1").run();
      database.close();

      const reopened = new SqliteContentRepository({ filename });
      try {
        await expect(
          new AuditService({ repository: reopened }).verify(scope),
        ).resolves.toMatchObject({
          valid: false,
          failures: [expect.objectContaining({ reason: 'event_hash_mismatch' })],
        });
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
