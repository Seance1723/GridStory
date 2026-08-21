import { describe, expect, it } from 'vitest';
import type { ContentScope } from '@gridstory/schema';
import { CollaborationService, type GridStoryError } from '../src/index.js';

function scope(tenantId: string): ContentScope {
  return {
    organizationId: 'organization-a',
    tenantId,
    workspaceId: 'workspace-a',
    siteId: 'site-a',
    environmentId: 'development',
    locale: 'en',
  };
}

describe('CollaborationService', () => {
  it('keeps comments scoped while supporting mentions, assignments, replies, and resolution', async () => {
    const service = new CollaborationService();
    const created = await service.createThread({
      scope: scope('tenant-a'),
      target: { entryId: 'entry-1', field: 'story', nodeId: 'paragraph-1' },
      actorId: 'author',
      body: 'Please review this, @reviewer.',
      assigneeId: 'reviewer',
      dueAt: '2026-08-01T12:00:00Z',
    });

    expect(created.messages[0]?.mentions).toEqual(['reviewer']);
    expect(created.assigneeId).toBe('reviewer');
    expect((await service.snapshot(scope('tenant-b'), 'entry-1')).threads).toEqual([]);

    await service.reply({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      threadId: created.id,
      actorId: 'reviewer',
      body: 'Handled.',
    });
    const resolved = await service.updateThread({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      threadId: created.id,
      actorId: 'reviewer',
      resolved: true,
    });

    expect(resolved.messages).toHaveLength(2);
    expect(resolved.resolvedBy).toBe('reviewer');
    expect(resolved.resolvedAt).toBeDefined();
  });

  it('expires ephemeral presence and rejects malformed due dates with a stable error', async () => {
    const service = new CollaborationService();
    const started = new Date('2026-07-23T10:00:00Z');
    await service.heartbeat({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'author',
      displayName: 'Author',
      field: 'story',
      now: started,
    });

    expect((await service.snapshot(scope('tenant-a'), 'entry-1', started)).presence).toHaveLength(
      1,
    );
    expect(
      (await service.snapshot(scope('tenant-a'), 'entry-1', new Date(started.getTime() + 30_001)))
        .presence,
    ).toEqual([]);

    await expect(() =>
      service.createThread({
        scope: scope('tenant-a'),
        target: { entryId: 'entry-1' },
        actorId: 'author',
        body: 'Schedule me.',
        dueAt: 'not-a-date',
      }),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<GridStoryError>>({
        code: 'invalid_due_date',
        statusCode: 400,
      }),
    );
  });

  it('deduplicates stable operations and deterministically converges concurrent field changes', async () => {
    const first = new CollaborationService();
    const second = new CollaborationService();
    const operationA = {
      id: 'op-a',
      branchId: 'main',
      actorSequence: 1,
      dependencies: [],
      target: { field: 'title' },
      kind: 'set' as const,
      value: 'Alpha',
    };
    const operationB = {
      id: 'op-b',
      branchId: 'main',
      actorSequence: 1,
      dependencies: [],
      target: { field: 'title' },
      kind: 'set' as const,
      value: 'Beta',
    };

    await first.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'actor-a',
      operation: operationA,
    });
    await first.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'actor-b',
      operation: operationB,
    });
    const versionBeforeDuplicate = (await first.snapshot(scope('tenant-a'), 'entry-1')).version;
    await first.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'actor-a',
      operation: operationA,
    });
    await expect(
      first.submitOperation({
        scope: scope('tenant-a'),
        entryId: 'entry-1',
        actorId: 'actor-a',
        operation: { ...operationA, value: 'Changed duplicate' },
      }),
    ).rejects.toMatchObject({ code: 'collaboration_operation_conflict', statusCode: 409 });

    await second.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'actor-b',
      operation: operationB,
    });
    await second.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'actor-a',
      operation: operationA,
    });

    const firstSnapshot = await first.snapshot(scope('tenant-a'), 'entry-1');
    const secondSnapshot = await second.snapshot(scope('tenant-a'), 'entry-1');
    expect(firstSnapshot.version).toBe(versionBeforeDuplicate);
    expect(firstSnapshot.operations).toHaveLength(2);
    expect(firstSnapshot.branchStates[0]?.values).toEqual(secondSnapshot.branchStates[0]?.values);
    expect(firstSnapshot.branchStates[0]?.values[0]).toMatchObject({
      operationId: 'op-b',
      value: 'Beta',
      conflictingOperationIds: ['op-a'],
    });
    expect(firstSnapshot.conflicts).toHaveLength(1);
  });

  it('accepts suggestions and merges non-overlapping branch changes without conflicts', async () => {
    const service = new CollaborationService();
    await service.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'author',
      operation: { target: { field: 'title' }, kind: 'set', value: 'Base' },
    });
    const feature = await service.createBranch({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'author',
      name: 'Feature',
      id: 'feature',
    });
    const suggestion = await service.createSuggestion({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'reviewer',
      branchId: feature.id,
      target: { field: 'summary' },
      value: 'Suggested summary',
      id: 'suggestion-1',
    });
    const accepted = await service.reviewSuggestion({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      suggestionId: suggestion.id,
      actorId: 'author',
      decision: 'accept',
    });
    expect(accepted.status).toBe('accepted');

    const merge = await service.mergeBranches({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'author',
      sourceBranchId: feature.id,
      id: 'merge-1',
    });
    const snapshot = await service.snapshot(scope('tenant-a'), 'entry-1');
    expect(merge).toMatchObject({ status: 'merged', conflictIds: [] });
    expect(snapshot.branches.find((candidate) => candidate.id === feature.id)?.status).toBe(
      'merged',
    );
    expect(snapshot.branchStates.find((state) => state.branchId === 'main')?.values).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 'Suggested summary' })]),
    );
  });

  it('preserves overlapping branch values until an explicit conflict resolution', async () => {
    const service = new CollaborationService();
    await service.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'author',
      operation: {
        id: 'base',
        target: { field: 'title' },
        kind: 'set',
        value: 'Base',
      },
    });
    await service.createBranch({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'author',
      name: 'Feature',
      id: 'feature',
    });
    await service.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'feature-author',
      operation: {
        id: 'feature-title',
        branchId: 'feature',
        target: { field: 'title' },
        kind: 'set',
        value: 'Feature title',
      },
    });
    await service.submitOperation({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'main-author',
      operation: {
        id: 'main-title',
        target: { field: 'title' },
        kind: 'set',
        value: 'Main title',
      },
    });

    const merge = await service.mergeBranches({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'reviewer',
      sourceBranchId: 'feature',
      id: 'merge-conflicted',
    });
    expect(merge.status).toBe('conflicted');
    const conflict = (await service.snapshot(scope('tenant-a'), 'entry-1')).conflicts.find(
      (candidate) => candidate.id === merge.conflictIds[0],
    );
    expect(conflict?.variants.map((variant) => variant.value)).toEqual([
      'Feature title',
      'Main title',
    ]);

    const resolved = await service.resolveConflict({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      conflictId: conflict?.id ?? '',
      actorId: 'reviewer',
      operationId: 'feature-title',
    });
    const snapshot = await service.snapshot(scope('tenant-a'), 'entry-1');
    expect(resolved.status).toBe('resolved');
    expect(snapshot.merges.find((candidate) => candidate.id === merge.id)?.status).toBe('merged');
    expect(
      snapshot.branchStates
        .find((state) => state.branchId === 'main')
        ?.values.find((value) => value.target.field === 'title'),
    ).toMatchObject({ value: 'Feature title', conflictingOperationIds: [] });
  });
});
