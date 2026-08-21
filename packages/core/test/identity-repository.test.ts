import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptyIdentityDocument,
  InMemoryIdentityRepository,
  SqliteIdentityRepository,
} from '../src/index.js';

const scope = { organizationId: 'organization-a', tenantId: 'tenant-a' };

describe('identity repositories', () => {
  it('enforces optimistic versions and exact tenant scope in memory', () => {
    const repository = new InMemoryIdentityRepository();
    const document = {
      ...emptyIdentityDocument(scope, '2026-08-21T00:00:00.000Z'),
      version: 1,
    };
    repository.save(document, null);
    expect(repository.get(scope)).toEqual(document);
    expect(repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
    expect(() => repository.save({ ...document, version: 2 }, null)).toThrow(
      expect.objectContaining({ code: 'identity_write_conflict' }),
    );
    expect(() => repository.save({ ...document, version: 3 }, 2)).toThrow(
      expect.objectContaining({ code: 'identity_write_conflict' }),
    );
  });

  it('persists identity state across SQLite repository instances', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-identity-'));
    const filename = join(directory, 'identity.db');
    try {
      const first = new SqliteIdentityRepository({ filename });
      try {
        first.save(
          {
            ...emptyIdentityDocument(scope, '2026-08-21T00:00:00.000Z'),
            version: 1,
            users: [
              {
                ...scope,
                id: 'user-a',
                userName: 'author@example.test',
                emails: ['author@example.test'],
                active: true,
                providerLinks: [],
                groupIds: [],
                version: 1,
                createdAt: '2026-08-21T00:00:00.000Z',
                updatedAt: '2026-08-21T00:00:00.000Z',
              },
            ],
          },
          null,
        );
      } finally {
        first.close();
      }
      const second = new SqliteIdentityRepository({ filename });
      try {
        expect(second.get(scope)?.users).toMatchObject([
          { id: 'user-a', userName: 'author@example.test' },
        ]);
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
