import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import {
  EditorialOverviewService,
  InMemoryReleaseRepository,
  InMemoryWorkflowRepository,
  SqliteContentRepository,
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
const otherScope = { ...scope, siteId: 'site-b' };
const schemas: ContentSchemaDefinition[] = [
  {
    id: 'page',
    version: 1,
    name: 'Page',
    description: '',
    collection: 'pages',
    titleField: 'title',
    route: { pattern: '/:slug', slugField: 'slug' },
    fields: [
      { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
      { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    ],
  },
  {
    id: 'article',
    version: 1,
    name: 'Article',
    description: '',
    collection: 'articles',
    titleField: 'headline',
    route: { pattern: '/articles/:slug', slugField: 'slug' },
    fields: [
      {
        id: 'article.headline',
        name: 'headline',
        label: 'Headline',
        type: 'text',
        required: true,
      },
      { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    ],
  },
];

describe('EditorialOverviewService', () => {
  const contentRepositories: SqliteContentRepository[] = [];

  afterEach(() => {
    for (const repository of contentRepositories.splice(0)) repository.close();
  });

  async function harness() {
    let clock = new Date('2026-08-29T00:00:00.000Z');
    let id = 0;
    const content = new SqliteContentRepository({
      filename: ':memory:',
      now: () => clock.toISOString(),
      createId: () => `generated-${++id}`,
    });
    contentRepositories.push(content);
    const workflows = new InMemoryWorkflowRepository();
    const releases = new InMemoryReleaseRepository();
    const operations = vi.fn(async () => ({
      generatedAt: clock.toISOString(),
      content: { total: 0, draft: 0, changed: 0, published: 0 },
      outbox: { total: 2, pending: 0, processing: 0, succeeded: 1, dead: 1, truncated: true },
      jobs: { total: 3, pending: 0, processing: 0, succeeded: 1, dead: 2, truncated: false },
      webhooks: { total: 0, active: 0 },
      audit: { valid: true, eventCount: 0, entryCount: 0, failures: [] },
      recentAudit: [],
    }));
    const service = new EditorialOverviewService({
      content,
      workflows,
      releases,
      schemas,
      operations,
      now: () => clock,
    });
    return {
      content,
      workflows,
      releases,
      operations,
      service,
      setClock(value: string) {
        clock = new Date(value);
      },
    };
  }

  it('returns exact bounded content, eligible reviews, minimized releases and operations', async () => {
    const value = await harness();
    const entries = [];
    for (let index = 0; index < 6; index += 1) {
      value.setClock(`2026-08-29T0${index}:00:00.000Z`);
      entries.push(
        await value.content.create({
          scope,
          id: `entry-${index}`,
          contentType: index % 2 === 0 ? 'page' : 'article',
          data:
            index === 5
              ? { headline: '', slug: 'fallback-slug' }
              : index % 2 === 0
                ? { title: `Page ${index}`, slug: `page-${index}` }
                : { headline: `Article ${index}`, slug: `article-${index}` },
          actor: { id: 'author', roles: ['author'] },
        }),
      );
    }
    const workflowInput = defaultEditorialWorkflow();
    value.workflows.saveDefinition({
      ...scope,
      id: 'page-editorial',
      ...workflowInput,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    value.workflows.saveInstance({
      ...scope,
      entryId: 'entry-0',
      contentType: 'page',
      workflowId: 'page-editorial',
      workflowVersion: 1,
      stateId: 'in-review',
      revisionId: entries[0]?.draftRevisionId ?? 'revision',
      pendingApproval: {
        id: 'approval-1',
        transitionId: 'approve',
        revisionId: entries[0]?.draftRevisionId ?? 'revision',
        requestedBy: 'author',
        requestedByRoles: ['author'],
        requestedAt: '2026-08-29T06:00:00.000Z',
        dueAt: '2026-08-30T06:00:00.000Z',
        changedFields: [],
        decisions: [],
      },
      schedules: [],
      notifications: [],
      history: [],
      createdAt: '2026-08-29T06:00:00.000Z',
      updatedAt: '2026-08-29T06:00:00.000Z',
    });
    for (const [entryId, pendingApproval] of [
      [
        'entry-2',
        {
          id: 'approval-separated',
          transitionId: 'approve',
          revisionId: entries[2]?.draftRevisionId ?? 'revision-2',
          requestedBy: 'reviewer',
          requestedByRoles: ['publisher'],
          requestedAt: '2026-08-29T06:00:00.000Z',
          changedFields: [],
          decisions: [],
        },
      ],
      [
        'entry-4',
        {
          id: 'approval-decided',
          transitionId: 'approve',
          revisionId: entries[4]?.draftRevisionId ?? 'revision-4',
          requestedBy: 'author',
          requestedByRoles: ['author'],
          requestedAt: '2026-08-29T06:00:00.000Z',
          changedFields: [],
          decisions: [
            {
              actorId: 'reviewer',
              actorRoles: ['publisher'],
              decision: 'approved' as const,
              decidedAt: '2026-08-29T06:30:00.000Z',
            },
          ],
        },
      ],
    ] as const) {
      value.workflows.saveInstance({
        ...scope,
        entryId,
        contentType: 'page',
        workflowId: 'page-editorial',
        workflowVersion: 1,
        stateId: 'in-review',
        revisionId: pendingApproval.revisionId,
        pendingApproval,
        schedules: [],
        notifications: [],
        history: [],
        createdAt: '2026-08-29T06:00:00.000Z',
        updatedAt: '2026-08-29T06:00:00.000Z',
      });
    }
    value.releases.save({
      ...scope,
      id: 'release-1',
      name: 'Autumn launch',
      state: 'scheduled',
      entries: [
        {
          entryId: 'entry-0',
          revisionId: entries[0]?.draftRevisionId ?? 'revision-0',
          contentType: 'page',
          previousPublishedRevisionId: null,
        },
        {
          entryId: 'entry-1',
          revisionId: entries[1]?.draftRevisionId ?? 'revision-1',
          contentType: 'article',
          previousPublishedRevisionId: null,
        },
      ],
      rollbackPolicy: { mode: 'manual' },
      schedule: {
        runAt: '2026-08-31T09:00:00.000Z',
        timeZone: 'UTC',
        requestedBy: 'publisher',
        requestedByRoles: ['publisher'],
        state: 'pending',
        createdAt: '2026-08-29T06:00:00.000Z',
      },
      createdBy: 'publisher',
      createdAt: '2026-08-29T06:00:00.000Z',
      updatedAt: '2026-08-29T06:00:00.000Z',
    });

    const overview = await value.service.read({
      scope,
      principal: { id: 'reviewer', roles: ['publisher'] },
      visibility: {
        content: 'all-registered',
        reviews: true,
        releases: true,
        operations: true,
      },
    });

    expect(overview.widgets.content).toMatchObject({
      availability: 'available',
      coverage: 'all-registered',
      bounds: { totalCount: 6, displayedCount: 5, limit: 5, hasMore: true },
      states: { draft: 6, changed: 0, published: 0 },
    });
    if (overview.widgets.content.availability !== 'available') throw new Error('content missing');
    expect(overview.widgets.content.recent[0]).toMatchObject({
      id: 'entry-5',
      title: 'fallback-slug',
      destination: 'collections',
    });
    expect(overview.widgets.reviews).toMatchObject({
      availability: 'available',
      bounds: { totalCount: 1, displayedCount: 1 },
      items: [{ entryId: 'entry-0', transitionLabel: 'Request approval' }],
    });
    expect(overview.widgets.releases).toMatchObject({
      availability: 'available',
      bounds: { totalCount: 1 },
      items: [{ id: 'release-1', destination: 'releases' }],
    });
    expect(JSON.stringify(overview.widgets.releases)).not.toContain('revisionId');
    expect(overview.widgets.operations).toMatchObject({
      availability: 'available',
      auditValid: true,
      deadOutbox: 1,
      deadJobs: 2,
      outboxTruncated: true,
      jobsTruncated: false,
    });
  });

  it('keeps page coverage and review eligibility exact without exposing other types', async () => {
    const value = await harness();
    for (const [id, contentType] of [
      ['page-entry', 'page'],
      ['article-entry', 'article'],
    ] as const) {
      await value.content.create({
        scope,
        id,
        contentType,
        data:
          contentType === 'page'
            ? { title: 'Page', slug: 'page' }
            : { headline: 'Article', slug: 'article' },
        actor: { id: 'author', roles: ['author'] },
      });
    }
    const overview = await value.service.read({
      scope,
      principal: { id: 'author', roles: ['author'] },
      visibility: { content: 'pages-only', reviews: true, releases: false, operations: false },
    });
    expect(overview.widgets.content).toMatchObject({
      availability: 'available',
      coverage: 'pages-only',
      bounds: { totalCount: 1 },
    });
    expect(overview.widgets.reviews).toMatchObject({
      availability: 'available',
      coverage: 'pages-only',
      bounds: { totalCount: 0 },
    });
    expect(overview.widgets.releases).toEqual({ availability: 'unavailable' });
    expect(overview.widgets.operations).toEqual({ availability: 'unavailable' });
    expect(value.operations).not.toHaveBeenCalled();
  });

  it('isolates source failures and rejects cross-scope repository results', async () => {
    const value = await harness();
    vi.spyOn(value.releases, 'list').mockRejectedValueOnce(new Error('private release failure'));
    const failedRelease = await value.service.read({
      scope,
      principal: { id: 'reviewer', roles: ['publisher'] },
      visibility: { content: 'all-registered', reviews: false, releases: true, operations: false },
    });
    expect(failedRelease.widgets.content.availability).toBe('available');
    expect(failedRelease.widgets.releases).toEqual({
      availability: 'error',
      reason: 'source-unavailable',
    });
    expect(JSON.stringify(failedRelease)).not.toContain('private release failure');

    const valid = await value.content.create({
      scope,
      id: 'entry',
      contentType: 'page',
      data: { title: 'Page', slug: 'page' },
      actor: { id: 'author', roles: ['author'] },
    });
    vi.spyOn(value.workflows, 'listInstances').mockResolvedValueOnce([
      {
        ...otherScope,
        entryId: valid.id,
        contentType: 'page',
        workflowId: 'workflow',
        workflowVersion: 1,
        stateId: 'draft',
        revisionId: valid.draftRevisionId,
        schedules: [],
        notifications: [],
        history: [],
        createdAt: valid.createdAt,
        updatedAt: valid.updatedAt,
      },
    ]);
    const crossScope = await value.service.read({
      scope,
      principal: { id: 'reviewer', roles: ['publisher'] },
      visibility: { content: 'all-registered', reviews: true, releases: false, operations: false },
    });
    expect(crossScope.widgets.content.availability).toBe('available');
    expect(crossScope.widgets.reviews).toEqual({
      availability: 'error',
      reason: 'source-unavailable',
    });

    vi.spyOn(value.content, 'list').mockResolvedValueOnce([
      { ...valid, ...otherScope, contentType: 'article' },
    ]);
    const filteredCrossScope = await value.service.read({
      scope,
      principal: { id: 'reviewer', roles: ['publisher'] },
      visibility: { content: 'pages-only', reviews: false, releases: false, operations: false },
    });
    expect(filteredCrossScope.widgets.content).toEqual({
      availability: 'error',
      reason: 'source-unavailable',
    });
  });
});
