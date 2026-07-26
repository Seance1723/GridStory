import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentScope } from '@gridstory/schema';
import {
  SqliteWorkflowRepository,
  WorkflowService,
  defaultEditorialWorkflow,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

describe('SqliteWorkflowRepository', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it('persists canonical workflow state across adapters and isolates the full scope key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gridstory-workflow-'));
    directories.push(directory);
    const filename = join(directory, 'workflow.db');
    const first = new SqliteWorkflowRepository({ filename });
    const service = new WorkflowService({
      repository: first,
      defaultDefinitions: [{ id: 'page-editorial', definition: defaultEditorialWorkflow() }],
      now: () => new Date('2026-07-26T00:00:00.000Z'),
      createId: () => 'instance-event-1',
    });
    await service.ensureInstance({
      scope,
      entryId: 'entry-1',
      contentType: 'page',
      revisionId: 'revision-1',
      actorId: 'author-1',
    });
    first.close();

    const reopened = new SqliteWorkflowRepository({ filename });
    try {
      expect(reopened.getInstance(scope, 'entry-1')).toMatchObject({
        workflowId: 'page-editorial',
        stateId: 'draft',
        revisionId: 'revision-1',
      });
      expect(reopened.getInstance({ ...scope, tenantId: 'tenant-b' }, 'entry-1')).toBeNull();
      expect(reopened.listDefinitions(scope)).toHaveLength(1);
    } finally {
      reopened.close();
    }
  });
});
