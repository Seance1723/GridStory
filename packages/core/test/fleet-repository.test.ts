import type { ContentScope } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  emptyFleetDocument,
  type FleetRepository,
  InMemoryFleetRepository,
  SqliteFleetRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

async function conformance(repository: FleetRepository) {
  const initial = emptyFleetDocument(scope, '2026-08-24T08:00:00.000Z');
  await repository.save(initial, null);
  expect(await repository.get(scope)).toEqual(initial);
  expect(await repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
  const next = {
    ...initial,
    version: 1,
    updatedBy: 'operator-a',
    updatedAt: '2026-08-24T08:01:00.000Z',
  };
  await repository.save(next, 0);
  expect(await repository.get(scope)).toMatchObject({ version: 1, updatedBy: 'operator-a' });
  await expect(async () => repository.save(next, 0)).rejects.toMatchObject({
    code: 'fleet_write_conflict',
  });
  await repository.close();
}

describe('fleet repositories', () => {
  it('enforces complete-scope optimistic memory persistence', async () => {
    await conformance(new InMemoryFleetRepository());
  });

  it('enforces complete-scope optimistic SQLite persistence', async () => {
    await conformance(new SqliteFleetRepository({ filename: ':memory:' }));
  });
});
