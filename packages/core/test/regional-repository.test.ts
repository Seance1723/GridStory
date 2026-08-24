import type { ContentScope } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  emptyRegionalDocument,
  InMemoryRegionalRepository,
  SqliteRegionalRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('regional repositories', () => {
  it('enforces complete-scope optimistic writes in memory', () => {
    const repository = new InMemoryRegionalRepository();
    const document = emptyRegionalDocument(scope, '2026-08-24T08:00:00.000Z', 'us-east-1');
    repository.save(document, null);
    expect(repository.get(scope)).toMatchObject({ version: 0, state: 'disabled' });
    expect(repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
    expect(() => repository.save({ ...document, version: 1 }, null)).toThrowError(
      expect.objectContaining({ code: 'regional_write_conflict' }),
    );
  });

  it('persists bounded topology and operation state in SQLite', () => {
    const repository = new SqliteRegionalRepository({ filename: ':memory:' });
    const document = emptyRegionalDocument(scope, '2026-08-24T08:00:00.000Z', 'us-east-1');
    repository.save(document, null);
    const updated = {
      ...document,
      version: 1,
      state: 'enabled' as const,
      topologyVersion: 2,
      readPolicy: {
        mode: 'bounded-staleness' as const,
        maximumLagMs: 5_000,
        failureMode: 'primary' as const,
      },
      readRegions: [{ region: 'eu-west-1', adapter: 'reader-a', enabled: true }],
      updatedBy: 'operator-a',
      updatedAt: '2026-08-24T08:01:00.000Z',
    };
    repository.save(updated, 0);
    expect(repository.get(scope)).toEqual(updated);
    expect(() => repository.save({ ...updated, version: 2 }, 0)).toThrowError(
      expect.objectContaining({ code: 'regional_write_conflict' }),
    );
    repository.close();
  });
});
