import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptyGovernanceDocument,
  InMemoryGovernanceRepository,
  SqliteGovernanceRepository,
} from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('governance repositories', () => {
  it('enforces optimistic versions and exact scope in memory', () => {
    const repository = new InMemoryGovernanceRepository();
    const document = {
      ...emptyGovernanceDocument(scope, '2026-08-23T00:00:00.000Z'),
      version: 1,
    };
    repository.save(document, null);
    expect(repository.get(scope)).toEqual(document);
    expect(repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
    expect(() => repository.save({ ...document, version: 2 }, null)).toThrow(
      expect.objectContaining({ code: 'governance_write_conflict' }),
    );
    expect(repository.listScopes()).toEqual([scope]);
  });

  it('persists documents and optimistic conflicts across SQLite instances', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-governance-'));
    const filename = join(directory, 'governance.db');
    try {
      const first = new SqliteGovernanceRepository({ filename });
      first.save(
        {
          ...emptyGovernanceDocument(scope, '2026-08-23T00:00:00.000Z'),
          version: 1,
          subjects: [
            {
              id: 'subject-a',
              reference: 'customer-42',
              status: 'active',
              createdBy: 'admin',
              createdAt: '2026-08-23T00:00:00.000Z',
              updatedAt: '2026-08-23T00:00:00.000Z',
            },
          ],
        },
        null,
      );
      first.close();

      const second = new SqliteGovernanceRepository({ filename });
      try {
        expect(second.get(scope)?.subjects).toMatchObject([
          { id: 'subject-a', reference: 'customer-42' },
        ]);
        expect(() =>
          second.save(
            { ...(second.get(scope) as ReturnType<typeof emptyGovernanceDocument>), version: 2 },
            0,
          ),
        ).toThrow(expect.objectContaining({ code: 'governance_write_conflict' }));
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
