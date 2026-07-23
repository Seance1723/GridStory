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
  it('keeps comments scoped while supporting mentions, assignments, replies, and resolution', () => {
    const service = new CollaborationService();
    const created = service.createThread({
      scope: scope('tenant-a'),
      target: { entryId: 'entry-1', field: 'story', nodeId: 'paragraph-1' },
      actorId: 'author',
      body: 'Please review this, @reviewer.',
      assigneeId: 'reviewer',
      dueAt: '2026-08-01T12:00:00Z',
    });

    expect(created.messages[0]?.mentions).toEqual(['reviewer']);
    expect(created.assigneeId).toBe('reviewer');
    expect(service.snapshot(scope('tenant-b'), 'entry-1').threads).toEqual([]);

    service.reply({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      threadId: created.id,
      actorId: 'reviewer',
      body: 'Handled.',
    });
    const resolved = service.updateThread({
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

  it('expires ephemeral presence and rejects malformed due dates with a stable error', () => {
    const service = new CollaborationService();
    const started = new Date('2026-07-23T10:00:00Z');
    service.heartbeat({
      scope: scope('tenant-a'),
      entryId: 'entry-1',
      actorId: 'author',
      displayName: 'Author',
      field: 'story',
      now: started,
    });

    expect(service.snapshot(scope('tenant-a'), 'entry-1', started).presence).toHaveLength(1);
    expect(
      service.snapshot(scope('tenant-a'), 'entry-1', new Date(started.getTime() + 30_001)).presence,
    ).toEqual([]);

    expect(() =>
      service.createThread({
        scope: scope('tenant-a'),
        target: { entryId: 'entry-1' },
        actorId: 'author',
        body: 'Schedule me.',
        dueAt: 'not-a-date',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<GridStoryError>>({
        code: 'invalid_due_date',
        statusCode: 400,
      }),
    );
  });
});
