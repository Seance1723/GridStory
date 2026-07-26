import type { AssetRecord, ContentEntry, ContentScope } from '@gridstory/schema';
import { describe, expect, it, vi } from 'vitest';
import {
  AssetService,
  AuditService,
  AuthorizationPolicy,
  GridStoryActions,
  InMemoryAssetStorageAdapter,
  OperationsService,
  SearchService,
  TenantScopeViolationError,
  cacheTagBelongsToScope,
  contentCacheTags,
  contentScopeCachePrefix,
  contentScopeKey,
  contentScopePath,
  scopedCustomCacheTags,
  tenantTelemetryEvent,
  type AssetRepository,
  type AuditEvent,
  type ContentRepository,
  type DurableJob,
  type OutboxEvent,
  type SearchAdapter,
  type TenantTelemetryEvent,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};
const foreignScope: ContentScope = { ...scope, tenantId: 'tenant-b' };
const now = '2026-07-26T00:00:00.000Z';

function entry(entryScope: ContentScope = scope): ContentEntry {
  return {
    ...entryScope,
    id: 'entry-1',
    contentType: 'page',
    status: 'published',
    draftRevisionId: 'revision-1',
    publishedRevisionId: 'revision-1',
    createdAt: now,
    updatedAt: now,
    data: { title: 'Scoped result' },
  };
}

function searchAdapter(resultScope: ContentScope): SearchAdapter {
  return {
    name: 'hostile-adapter',
    search: async () => ({
      scope: resultScope,
      perspective: 'published',
      hits: [
        {
          entryId: 'entry-1',
          score: 1,
          highlights: ['tenant-b private content'],
          taxonomies: { privateTaxonomy: ['tenant-b-only'] },
        },
      ],
      facets: [
        {
          taxonomyId: 'privateTaxonomy',
          label: 'Tenant B taxonomy',
          terms: [{ id: 'tenant-b-only', label: 'Tenant B only', count: 999 }],
        },
      ],
      total: 999,
    }),
    upsert: async () => undefined,
    rebuild: async () => undefined,
    status: async (requestedScope) => ({
      scope: requestedScope,
      state: 'ready',
      draftDocuments: 0,
      publishedDocuments: 0,
    }),
  };
}

describe('canonical tenant scope', () => {
  it('uses collision-safe keys, paths, and cache prefixes for every scope dimension', () => {
    const left = { ...scope, organizationId: 'organization:a', tenantId: 'tenant' };
    const right = { ...scope, organizationId: 'organization', tenantId: 'a:tenant' };

    expect(contentScopeKey(left)).not.toBe(contentScopeKey(right));
    expect(contentScopePath(left)).not.toBe(contentScopePath(right));
    expect(contentScopeCachePrefix(left)).not.toBe(contentScopeCachePrefix(right));
    expect(contentScopeCachePrefix(left)).toContain('organization%3Aa');
  });

  it('namespaces generated and custom cache tags to the complete scope', () => {
    const prefix = contentScopeCachePrefix(scope);
    const generated = contentCacheTags(entry());
    const custom = scopedCustomCacheTags(scope, ['navigation:header', 'navigation:header']);

    expect(generated).toContain(`${prefix}:entry:entry-1`);
    expect(generated).toContain(`${prefix}:type:page`);
    expect(generated.every((tag) => cacheTagBelongsToScope(scope, tag))).toBe(true);
    expect(custom).toEqual([`${prefix}:custom:navigation%3Aheader`]);
    expect(cacheTagBelongsToScope(foreignScope, custom[0] ?? '')).toBe(false);
  });
});

describe('untrusted scope boundaries', () => {
  it('rejects search results whose adapter scope differs from the request', async () => {
    const repository = {
      getById: async () => entry(),
    } as unknown as ContentRepository;
    const search = new SearchService({
      repository,
      schemas: [],
      adapter: searchAdapter(foreignScope),
    });

    await expect(
      search.search(scope, {
        text: '',
        perspective: 'published',
        contentTypes: [],
        taxonomies: {},
        first: 20,
      }),
    ).rejects.toBeInstanceOf(TenantScopeViolationError);
  });

  it('does not expose adapter-provided totals or facets and emits fully scoped telemetry', async () => {
    const telemetry: TenantTelemetryEvent[] = [];
    const repository = {
      getById: async () => entry(),
    } as unknown as ContentRepository;
    const search = new SearchService({
      repository,
      schemas: [],
      adapter: searchAdapter(scope),
      telemetry: (event) => {
        telemetry.push(event);
      },
    });

    const result = await search.search(scope, {
      text: '',
      perspective: 'published',
      contentTypes: [],
      taxonomies: {},
      first: 20,
    });

    expect(result).toMatchObject({
      total: 1,
      facets: [],
      hits: [expect.objectContaining({ highlights: [], taxonomies: {} })],
    });
    expect(telemetry).toEqual([
      expect.objectContaining({
        ...scope,
        name: 'search.query.completed',
        outcome: 'success',
      }),
    ]);
  });

  it('rejects foreign assets returned by an asset repository', async () => {
    const repository: AssetRepository = {
      list: async () => [{ ...foreignScope, updatedAt: now } as AssetRecord],
      get: async () => null,
      save: async () => undefined,
    };
    const assets = new AssetService({
      repository,
      storage: new InMemoryAssetStorageAdapter(),
    });

    await expect(assets.list(scope)).rejects.toBeInstanceOf(TenantScopeViolationError);
  });

  it('rejects foreign audit events returned by a repository', async () => {
    const repository = {
      listScopeAuditEvents: async () => [
        {
          ...foreignScope,
          id: 'audit-1',
          entryId: 'entry-1',
          sequence: 1,
          actorId: 'actor-1',
          action: 'content.created',
          revisionId: 'revision-1',
          occurredAt: now,
          eventHash: 'hash',
        } satisfies AuditEvent,
      ],
    } as unknown as ContentRepository;
    const audit = new AuditService({ repository });

    await expect(audit.verify(scope)).rejects.toBeInstanceOf(TenantScopeViolationError);
  });

  it('rejects foreign claimed outbox events and durable jobs before side effects', async () => {
    const cacheInvalidator = vi.fn();
    const foreignEvent = {
      ...foreignScope,
      id: 'event-1',
      type: 'content.created',
      aggregateId: 'entry-1',
      revisionId: 'revision-1',
      payload: {},
      cacheTags: [],
      occurredAt: now,
      state: 'processing',
      attempts: 1,
      availableAt: now,
    } satisfies OutboxEvent;
    const foreignJob = {
      ...foreignScope,
      id: 'job-1',
      type: 'cache.invalidate',
      idempotencyKey: 'job-1',
      payload: { tags: [] },
      state: 'processing',
      attempts: 1,
      maxAttempts: 1,
      runAt: now,
      createdAt: now,
      updatedAt: now,
    } satisfies DurableJob;

    const outboxRepository = {
      claimOutboxEvents: async () => [foreignEvent],
    } as unknown as ContentRepository;
    const outboxOperations = new OperationsService({
      repository: outboxRepository,
      webhookSigningSecret: 'tenant-isolation-test-secret-32-characters',
      cacheInvalidator,
    });
    await expect(outboxOperations.drain({ scope })).rejects.toBeInstanceOf(
      TenantScopeViolationError,
    );

    const jobRepository = {
      claimOutboxEvents: async () => [],
      claimJobs: async () => [foreignJob],
    } as unknown as ContentRepository;
    const jobOperations = new OperationsService({
      repository: jobRepository,
      webhookSigningSecret: 'tenant-isolation-test-secret-32-characters',
      cacheInvalidator,
    });
    await expect(jobOperations.drain({ scope })).rejects.toBeInstanceOf(TenantScopeViolationError);
    expect(cacheInvalidator).not.toHaveBeenCalled();
  });
});

describe('tenant telemetry contract', () => {
  it('requires a valid complete scope and rejects sensitive metadata', () => {
    expect(() =>
      tenantTelemetryEvent({
        scope,
        name: 'security.access.denied',
        outcome: 'denied',
        metadata: { apiToken: 'must-not-leak' },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_telemetry' }));
    expect(() =>
      tenantTelemetryEvent({
        scope: { ...scope, locale: '../neighbor' },
        name: 'security.access.denied',
        outcome: 'denied',
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_scope' }));
  });

  it('does not reuse an OIDC role assignment in another tenant', () => {
    const policy = new AuthorizationPolicy();
    const principal = {
      id: 'oidc-user',
      type: 'user' as const,
      roles: ['viewer'],
      roleAssignments: [{ roleId: 'viewer', tenantId: scope.tenantId }],
      authenticationMethod: 'oidc' as const,
    };
    const baseContext = { ...scope, perspective: 'draft' as const, principal };

    expect(
      policy.decide(baseContext, GridStoryActions.contentRead, { kind: 'content' }).allowed,
    ).toBe(true);
    expect(
      policy.decide(
        { ...baseContext, tenantId: foreignScope.tenantId },
        GridStoryActions.contentRead,
        { kind: 'content' },
      ).allowed,
    ).toBe(false);
  });
});
