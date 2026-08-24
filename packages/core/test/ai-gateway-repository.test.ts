import type { ContentScope } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  emptyAiGatewayDocument,
  InMemoryAiGatewayRepository,
  SqliteAiGatewayRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('AI gateway repositories', () => {
  it('enforces complete-scope optimistic writes in memory', () => {
    const repository = new InMemoryAiGatewayRepository();
    const document = emptyAiGatewayDocument(scope, '2026-08-24T08:00:00.000Z');
    repository.save(document, null);

    expect(repository.get(scope)).toMatchObject({ version: 0, state: 'disabled' });
    expect(repository.get({ ...scope, tenantId: 'tenant-b' })).toBeNull();
    expect(() => repository.save({ ...document, version: 1 }, null)).toThrowError(
      expect.objectContaining({ code: 'ai_gateway_write_conflict' }),
    );
  });

  it('persists policy documents and conflicts in SQLite', () => {
    const repository = new SqliteAiGatewayRepository({ filename: ':memory:' });
    const document = emptyAiGatewayDocument(scope, '2026-08-24T08:00:00.000Z');
    repository.save(document, null);
    const updated = {
      ...document,
      version: 1,
      state: 'enabled' as const,
      updatedAt: '2026-08-24T08:01:00.000Z',
    };
    repository.save(updated, 0);

    expect(repository.get(scope)).toEqual(updated);
    expect(() => repository.save({ ...updated, version: 2 }, 0)).toThrowError(
      expect.objectContaining({ code: 'ai_gateway_write_conflict' }),
    );
    repository.close();
  });
});
