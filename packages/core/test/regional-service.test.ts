import type { ContentEntry, ContentScope, RegionalFailoverResult } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  InMemoryRegionalRepository,
  type PublishedContentReader,
  type RegionalFailoverAdapter,
  type RegionalReadAdapter,
  regionalCachePartitionDigest,
  RegionalService,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};
const now = new Date('2026-08-24T08:00:00.000Z');
const page: ContentEntry = {
  ...scope,
  id: 'page-a',
  contentType: 'page',
  status: 'published',
  draftRevisionId: 'revision-a',
  publishedRevisionId: 'revision-a',
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  data: { title: 'Regional page', slug: 'regional-page' },
};

function reader(entry: ContentEntry = page): PublishedContentReader {
  return {
    list: () => [structuredClone(entry)],
    getBySlug: () => structuredClone(entry),
    getTranslationGroup: () => 'translation-a',
    listTranslationVariants: () => [structuredClone(entry)],
  };
}

class TestReadAdapter implements RegionalReadAdapter {
  readonly name = 'reader-a';
  content = reader();
  evidence: Record<string, unknown> = {};

  open(input: Parameters<RegionalReadAdapter['open']>[0]) {
    return {
      reader: this.content,
      evidence: {
        ...input.scope,
        adapter: this.name,
        servedRegion: input.region,
        role: 'replica',
        topologyVersion: input.topologyVersion,
        observedAt: now.toISOString(),
        lagMs: 250,
        watermark: 'opaque-watermark',
        residencyEvidenceReference: 'placement://eu-west-1',
        ...this.evidence,
      },
    };
  }
}

class TestFailoverAdapter implements RegionalFailoverAdapter {
  readonly name = 'failover-a';
  throwExecute = false;
  invalidReadiness = false;
  invalidResult = false;
  estimatedDataLossMs = 0;
  outcome: RegionalFailoverResult['outcome'] = 'succeeded';

  preflight(input: Parameters<RegionalFailoverAdapter['preflight']>[0]) {
    if (this.invalidReadiness) return { providerDiagnostic: 'provider readiness secret' };
    return {
      ...input.scope,
      adapter: this.name,
      requestId: input.requestId,
      sourceRegion: input.sourceRegion,
      targetRegion: input.targetRegion,
      topologyVersion: input.topologyVersion,
      checkedAt: now.toISOString(),
      ready: true,
      caughtUp: this.estimatedDataLossMs === 0,
      replicationLagMs: this.estimatedDataLossMs,
      estimatedDataLossMs: this.estimatedDataLossMs,
      evidenceDigest: 'a'.repeat(64),
    };
  }

  execute(input: Parameters<RegionalFailoverAdapter['execute']>[0]) {
    if (this.throwExecute) throw new Error('provider secret');
    return this.result(input);
  }

  reconcile(input: Parameters<RegionalFailoverAdapter['reconcile']>[0]) {
    return this.result(input);
  }

  private result(input: Parameters<RegionalFailoverAdapter['execute']>[0]) {
    if (this.invalidResult) return { providerDiagnostic: 'provider result secret' };
    return {
      ...input.scope,
      adapter: this.name,
      requestId: input.requestId,
      sourceRegion: input.sourceRegion,
      targetRegion: input.targetRegion,
      topologyVersion: input.topologyVersion,
      outcome: this.outcome,
      ...(this.outcome === 'succeeded' ? { activeRegion: input.targetRegion } : {}),
      sourceWritable: this.outcome !== 'succeeded',
      targetWritable: this.outcome === 'succeeded',
      ...(this.outcome === 'pending' ? {} : { completedAt: now.toISOString() }),
      evidenceDigest: 'b'.repeat(64),
    };
  }
}

function harness() {
  const reads = new TestReadAdapter();
  const failover = new TestFailoverAdapter();
  const service = new RegionalService({
    repository: new InMemoryRegionalRepository(),
    primary: reader(),
    localRegion: 'eu-west-1',
    readAdapters: [reads],
    failoverAdapters: [failover],
    residency: {
      assertRegion(_scope, _resource, region, evidence) {
        if (!['us-east-1', 'eu-west-1'].includes(region) || !evidence) {
          throw new Error('residency denied');
        }
      },
    },
    now: () => new Date(now),
  });
  return { service, reads, failover };
}

async function enable(service: RegionalService) {
  return service.updatePolicy(
    scope,
    {
      expectedVersion: 0,
      state: 'enabled',
      activeControlRegion: 'us-east-1',
      activeControlEvidenceReference: 'placement://us-east-1',
      readPolicy: { mode: 'bounded-staleness', maximumLagMs: 5_000, failureMode: 'unavailable' },
      readRegions: [
        {
          region: 'eu-west-1',
          adapter: 'reader-a',
          enabled: true,
          residencyEvidenceReference: 'placement://eu-west-1',
        },
      ],
      failoverAdapter: 'failover-a',
    },
    'operator-a',
  );
}

describe('RegionalService', () => {
  it('keeps the default on the strong primary without regional metadata', async () => {
    const { service } = harness();
    const session = await service.openRead(scope);
    const entry = await session.reader.getBySlug({
      scope,
      contentType: 'page',
      slug: 'regional-page',
      perspective: 'published',
    });
    expect(session.managed).toBe(false);
    expect(session.indicator([entry as ContentEntry])).toMatchObject({
      servedRegion: 'eu-west-1',
      role: 'primary',
      consistency: 'strong',
      cacheMode: 'shared',
      fallbackUsed: false,
    });
  });

  it('validates bounded replica evidence and every returned content scope', async () => {
    const { service, reads } = harness();
    await enable(service);
    const session = await service.openRead(scope);
    const entry = await session.reader.getBySlug({
      scope,
      contentType: 'page',
      slug: 'regional-page',
      perspective: 'published',
    });
    expect(session.indicator([entry as ContentEntry])).toMatchObject({
      servedRegion: 'eu-west-1',
      role: 'replica',
      consistency: 'bounded-staleness',
      lagMs: 250,
      cacheMode: 'private',
      fallbackUsed: false,
    });
    reads.content = reader({ ...page, id: 'page-fr', locale: 'fr' });
    const localized = await service.openRead(scope);
    await expect(
      localized.reader.list({
        scope: { ...scope, locale: 'fr' },
        perspective: 'published',
      }),
    ).resolves.toEqual([expect.objectContaining({ id: 'page-fr', locale: 'fr' })]);
    reads.content = reader({ ...page, status: 'draft' });
    const draft = await service.openRead(scope);
    await expect(
      draft.reader.getBySlug({
        scope,
        contentType: 'page',
        slug: 'regional-page',
        perspective: 'published',
      }),
    ).rejects.toMatchObject({ code: 'regional_result_invalid' });
    reads.content = reader({ ...page, tenantId: 'tenant-b' });
    const hostile = await service.openRead(scope);
    await expect(
      hostile.reader.getBySlug({
        scope,
        contentType: 'page',
        slug: 'regional-page',
        perspective: 'published',
      }),
    ).rejects.toMatchObject({ code: 'tenant_scope_violation' });
  });

  it('fails unavailable rather than silently accepting stale topology evidence', async () => {
    const { service, reads } = harness();
    await enable(service);
    reads.evidence = { topologyVersion: 99 };
    await expect(service.openRead(scope)).rejects.toMatchObject({
      code: 'regional_read_unavailable',
    });
  });

  it('uses shared caching only with complete attestation and honors explicit primary fallback', async () => {
    const { service, reads } = harness();
    const configured = await enable(service);
    reads.evidence = {
      cachePartition: {
        digest: regionalCachePartitionDigest({
          scope,
          servedRegion: 'eu-west-1',
          topologyVersion: configured.topologyVersion,
          contentRevision: page.publishedRevisionId as string,
        }),
        dimensions: [
          'scope',
          'served-region',
          'consistency',
          'topology-version',
          'content-revision',
        ],
        attestedAt: now.toISOString(),
      },
    };
    const shared = await service.openRead(scope);
    expect(shared.indicator([page]).cacheMode).toBe('shared');
    reads.evidence = {
      cachePartition: {
        digest: 'f'.repeat(64),
        dimensions: [
          'scope',
          'served-region',
          'consistency',
          'topology-version',
          'content-revision',
        ],
        attestedAt: now.toISOString(),
      },
    };
    const mismatched = await service.openRead(scope);
    expect(mismatched.indicator([page]).cacheMode).toBe('private');

    await service.updatePolicy(
      scope,
      {
        expectedVersion: configured.version,
        state: 'enabled',
        activeControlRegion: 'us-east-1',
        activeControlEvidenceReference: 'placement://us-east-1',
        readPolicy: { mode: 'bounded-staleness', maximumLagMs: 5_000, failureMode: 'primary' },
        readRegions: [
          {
            region: 'eu-west-1',
            adapter: 'reader-a',
            enabled: true,
            residencyEvidenceReference: 'placement://eu-west-1',
          },
        ],
        failoverAdapter: 'failover-a',
      },
      'operator-a',
    );
    reads.evidence = { topologyVersion: 99 };
    const fallback = await service.openRead(scope);
    expect(fallback.indicator([page])).toMatchObject({
      role: 'primary',
      consistency: 'strong',
      cacheMode: 'shared',
      fallbackUsed: true,
    });
  });

  it('requires independent approval and completes a planned zero-loss switchover', async () => {
    const { service } = harness();
    const configured = await enable(service);
    const preview = await service.preflight(
      scope,
      {
        expectedVersion: configured.version,
        requestId: '018daf23-89b3-7cf8-a4f1-94064c96df90',
        targetRegion: 'eu-west-1',
        mode: 'planned',
        reason: 'Controlled maintenance.',
        expectedRpoSeconds: 0,
        expectedRtoSeconds: 120,
        backup: {
          reference: 'backup://regional/2026-08-24',
          sha256: 'c'.repeat(64),
          verifiedAt: now.toISOString(),
        },
      },
      'operator-a',
    );
    const plan = preview.operations[0];
    if (!plan) throw new Error('Expected failover plan.');
    await expect(
      service.approve(
        scope,
        plan.id,
        {
          expectedVersion: preview.version,
          digest: plan.digest,
          reason: 'Self approval.',
          acceptDataLoss: false,
        },
        { id: 'operator-a', type: 'user', reauthenticatedAt: now.toISOString() },
      ),
    ).rejects.toMatchObject({ code: 'regional_independent_approval_required' });
    const approved = await service.approve(
      scope,
      plan.id,
      {
        expectedVersion: preview.version,
        digest: plan.digest,
        reason: 'Readiness evidence reviewed.',
        acceptDataLoss: false,
      },
      { id: 'operator-b', type: 'user', reauthenticatedAt: now.toISOString() },
    );
    const completed = await service.execute(
      scope,
      plan.id,
      { expectedVersion: approved.version },
      'operator-b',
    );
    expect(completed).toMatchObject({
      activeControlRegion: 'eu-west-1',
      topologyVersion: 3,
      readPolicy: { mode: 'primary-only', maximumLagMs: 0 },
      operations: [{ state: 'succeeded', result: { sourceWritable: false, targetWritable: true } }],
    });
  });

  it('persists ambiguous execution and reconciles by stable request ID', async () => {
    const { service, failover } = harness();
    const configured = await enable(service);
    const preview = await service.preflight(
      scope,
      {
        expectedVersion: configured.version,
        requestId: '018daf23-89b3-7cf8-a4f1-94064c96df91',
        targetRegion: 'eu-west-1',
        mode: 'planned',
        reason: 'Controlled maintenance.',
        expectedRpoSeconds: 0,
        expectedRtoSeconds: 120,
        backup: {
          reference: 'backup://regional/2026-08-24',
          sha256: 'd'.repeat(64),
          verifiedAt: now.toISOString(),
        },
      },
      'operator-a',
    );
    const plan = preview.operations[0];
    if (!plan) throw new Error('Expected failover plan.');
    const approved = await service.approve(
      scope,
      plan.id,
      {
        expectedVersion: preview.version,
        digest: plan.digest,
        reason: 'Reviewed.',
        acceptDataLoss: false,
      },
      { id: 'operator-b', type: 'user', reauthenticatedAt: now.toISOString() },
    );
    failover.throwExecute = true;
    await expect(
      service.execute(scope, plan.id, { expectedVersion: approved.version }, 'operator-b'),
    ).rejects.toMatchObject({ code: 'regional_failover_ambiguous' });
    const ambiguous = await service.snapshot(scope);
    expect(ambiguous.operations[0]?.state).toBe('ambiguous');
    failover.throwExecute = false;
    const reconciled = await service.reconcile(
      scope,
      plan.id,
      { expectedVersion: ambiguous.version },
      'operator-b',
    );
    expect(reconciled.operations[0]?.state).toBe('succeeded');
  });

  it('requires an explicit emergency RPO and data-loss acceptance', async () => {
    const { service, failover } = harness();
    const configured = await enable(service);
    failover.estimatedDataLossMs = 1_500;
    const preflight = {
      expectedVersion: configured.version,
      requestId: '018daf23-89b3-7cf8-a4f1-94064c96df93',
      targetRegion: 'eu-west-1',
      mode: 'emergency' as const,
      reason: 'Primary region is unavailable.',
      expectedRpoSeconds: 1,
      expectedRtoSeconds: 120,
      backup: {
        reference: 'backup://regional/emergency',
        sha256: '9'.repeat(64),
        verifiedAt: now.toISOString(),
      },
    };
    await expect(service.preflight(scope, preflight, 'operator-a')).rejects.toMatchObject({
      code: 'invalid_regional_state',
    });
    const preview = await service.preflight(
      scope,
      { ...preflight, expectedRpoSeconds: 2 },
      'operator-a',
    );
    const plan = preview.operations[0];
    if (!plan) throw new Error('Expected emergency failover plan.');
    await expect(
      service.approve(
        scope,
        plan.id,
        {
          expectedVersion: preview.version,
          digest: plan.digest,
          reason: 'Reviewed emergency evidence.',
          acceptDataLoss: false,
        },
        { id: 'operator-b', type: 'user', reauthenticatedAt: now.toISOString() },
      ),
    ).rejects.toMatchObject({ code: 'invalid_regional_state' });
    const approved = await service.approve(
      scope,
      plan.id,
      {
        expectedVersion: preview.version,
        digest: plan.digest,
        reason: 'Reviewed emergency evidence.',
        acceptDataLoss: true,
      },
      { id: 'operator-b', type: 'user', reauthenticatedAt: now.toISOString() },
    );
    expect(approved.operations[0]).toMatchObject({
      state: 'approved',
      approval: { acceptDataLoss: true },
    });
  });

  it('normalizes malformed adapter evidence without leaking provider diagnostics', async () => {
    const { service, failover } = harness();
    const configured = await enable(service);
    const input = {
      expectedVersion: configured.version,
      requestId: '018daf23-89b3-7cf8-a4f1-94064c96df92',
      targetRegion: 'eu-west-1',
      mode: 'planned' as const,
      reason: 'Controlled maintenance.',
      expectedRpoSeconds: 0,
      expectedRtoSeconds: 120,
      backup: {
        reference: 'backup://regional/2026-08-24',
        sha256: 'e'.repeat(64),
        verifiedAt: now.toISOString(),
      },
    };
    failover.invalidReadiness = true;
    const invalidReadiness = service.preflight(scope, input, 'operator-a');
    await expect(invalidReadiness).rejects.toMatchObject({
      code: 'regional_readiness_invalid',
      statusCode: 503,
    });
    await expect(invalidReadiness).rejects.not.toThrow(/provider readiness secret/);

    failover.invalidReadiness = false;
    const preview = await service.preflight(scope, input, 'operator-a');
    const plan = preview.operations[0];
    if (!plan) throw new Error('Expected failover plan.');
    const approved = await service.approve(
      scope,
      plan.id,
      {
        expectedVersion: preview.version,
        digest: plan.digest,
        reason: 'Reviewed.',
        acceptDataLoss: false,
      },
      { id: 'operator-b', type: 'user', reauthenticatedAt: now.toISOString() },
    );
    failover.invalidResult = true;
    const invalidResult = service.execute(
      scope,
      plan.id,
      { expectedVersion: approved.version },
      'operator-b',
    );
    await expect(invalidResult).rejects.toMatchObject({
      code: 'regional_result_invalid',
      statusCode: 503,
    });
    await expect(invalidResult).rejects.not.toThrow(/provider result secret/);
    expect((await service.snapshot(scope)).operations[0]?.state).toBe('ambiguous');
  });
});
