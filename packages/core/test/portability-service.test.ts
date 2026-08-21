import { describe, expect, it } from 'vitest';
import {
  logicalChecksum,
  parseLogicalArchive,
  PortabilityError,
  PortabilityService,
  serializeLogicalArchive,
  SqliteContentRepository,
  validateLogicalArchive,
} from '../src/index.js';
import { resourceLimits } from '@gridstory/schema';

const sourceScope = {
  organizationId: 'organization',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'source',
  environmentId: 'production',
  locale: 'en',
};

const targetScope = { ...sourceScope, siteId: 'target' };

describe('logical content portability', () => {
  it('round-trips stable history through checksummed JSON Lines with dry-run and replace', async () => {
    const source = new SqliteContentRepository({ filename: ':memory:' });
    const target = new SqliteContentRepository({ filename: ':memory:' });
    try {
      const created = source.create({
        scope: sourceScope,
        contentType: 'page',
        data: { title: 'Portable', slug: 'portable', blocks: [] },
        actor: { id: 'author' },
      });
      const updated = source.updateDraft({
        scope: sourceScope,
        id: created.id,
        expectedRevisionId: created.draftRevisionId,
        data: { title: 'Portable v2', slug: 'portable', blocks: [] },
        actor: { id: 'editor' },
      });
      source.publish({
        scope: sourceScope,
        id: created.id,
        expectedRevisionId: updated.draftRevisionId,
        actor: { id: 'publisher' },
      });

      const sourcePortability = new PortabilityService({
        repository: source,
        now: () => '2026-07-17T00:00:00.000Z',
      });
      const targetPortability = new PortabilityService({ repository: target });
      const archive = await sourcePortability.export(sourceScope);
      const serialized = serializeLogicalArchive(archive);
      expect(serialized.split('\n')).toHaveLength(3);
      const parsed = parseLogicalArchive(serialized);

      await expect(
        targetPortability.import({ scope: targetScope, archive: parsed }),
      ).resolves.toMatchObject({ imported: 1, dryRun: true, conflicts: [] });
      expect(
        target.getById({ scope: targetScope, id: created.id, perspective: 'draft' }),
      ).toBeNull();
      await expect(
        targetPortability.import({ scope: targetScope, archive: parsed, dryRun: false }),
      ).resolves.toMatchObject({ imported: 1, dryRun: false });

      const targetRecords = target.exportPortableContent({ scope: targetScope });
      expect(targetRecords).toEqual(archive.entries.map((entry) => entry.record));
      const imported = target.getById({
        scope: targetScope,
        id: created.id,
        perspective: 'published',
      });
      expect(imported).toMatchObject({
        id: created.id,
        draftRevisionId: updated.draftRevisionId,
        publishedRevisionId: updated.draftRevisionId,
        data: { title: 'Portable v2' },
      });

      const changed = target.updateDraft({
        scope: targetScope,
        id: created.id,
        expectedRevisionId: updated.draftRevisionId,
        data: { title: 'Target-only edit', slug: 'portable', blocks: [] },
        actor: { id: 'target-editor' },
      });
      expect(changed.status).toBe('changed');
      await expect(
        targetPortability.import({
          scope: targetScope,
          archive: parsed,
          conflictPolicy: 'replace',
          dryRun: false,
        }),
      ).resolves.toMatchObject({ imported: 0, replaced: 1 });
      expect(target.exportPortableContent({ scope: targetScope })).toEqual(targetRecords);
    } finally {
      source.close();
      target.close();
    }
  });

  it('rejects content and aggregate checksum corruption before repository mutation', async () => {
    const repository = new SqliteContentRepository({ filename: ':memory:' });
    try {
      const created = repository.create({
        scope: sourceScope,
        contentType: 'page',
        data: { title: 'Original' },
        actor: { id: 'author' },
      });
      const service = new PortabilityService({ repository });
      const archive = await service.export(sourceScope);
      const corrupted = structuredClone(archive);
      const first = corrupted.entries[0];
      if (!first) throw new Error('Expected one exported entry.');
      first.record.revisions[0] = {
        ...first.record.revisions[0],
        data: { title: 'Tampered' },
      };
      expect(() => validateLogicalArchive(corrupted)).toThrow(PortabilityError);
      await expect(
        service.import({ scope: targetScope, archive: corrupted, dryRun: false }),
      ).rejects.toBeInstanceOf(PortabilityError);
      expect(
        repository.getById({ scope: targetScope, id: created.id, perspective: 'draft' }),
      ).toBeNull();
    } finally {
      repository.close();
    }
  });

  it('rejects archives whose entry or history shapes exceed published limits', async () => {
    const repository = new SqliteContentRepository({ filename: ':memory:' });
    try {
      repository.create({
        scope: sourceScope,
        contentType: 'page',
        data: { title: 'Bounded' },
        actor: { id: 'author' },
      });
      const service = new PortabilityService({ repository });
      const archive = await service.export(sourceScope);
      const first = archive.entries[0];
      if (!first) throw new Error('Expected one exported entry.');

      const excessiveHistory = structuredClone(archive);
      const historyEntry = excessiveHistory.entries[0];
      if (!historyEntry) throw new Error('Expected one exported entry.');
      historyEntry.record.revisions = Array.from(
        { length: resourceLimits.portability.maximumRevisionsPerEntry + 1 },
        (_, index) => ({
          ...first.record.revisions[0],
          id: `revision-${index + 1}`,
          sequence: index + 1,
          baseRevisionId: index === 0 ? undefined : `revision-${index}`,
        }),
      );
      historyEntry.record.currentDraftRevisionId =
        historyEntry.record.revisions.at(-1)?.id ?? 'missing';
      historyEntry.checksum = logicalChecksum(historyEntry.record);
      excessiveHistory.manifest.archiveChecksum = logicalChecksum(
        excessiveHistory.entries.map((entry) => entry.checksum),
      );
      expect(() => validateLogicalArchive(excessiveHistory)).toThrow(/revisions cannot exceed/u);

      const excessiveEntries = structuredClone(archive);
      excessiveEntries.entries = Array.from(
        { length: resourceLimits.portability.maximumEntries + 1 },
        () => first,
      );
      excessiveEntries.manifest.entryCount = excessiveEntries.entries.length;
      expect(() => validateLogicalArchive(excessiveEntries)).toThrow(/Archive cannot exceed/u);
    } finally {
      repository.close();
    }
  });
});
