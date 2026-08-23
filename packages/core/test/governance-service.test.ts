import type { ContentScope, GovernanceResourceTarget } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  ConfiguredPlacementAdapter,
  GovernanceService,
  type GovernedResourceProcessor,
  InMemoryCustomerManagedKeyAdapter,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

class FixtureProcessor implements GovernedResourceProcessor {
  readonly type = 'content' as const;
  readonly name = 'fixture-content';
  readonly resources = new Map<string, { version: string; data: unknown }>();

  inspect(input: { resource: GovernanceResourceTarget }) {
    const resource = this.resources.get(input.resource.id);
    return resource
      ? { exists: true, version: resource.version, effect: 'delete fixture content' }
      : { exists: false, effect: 'fixture content is absent' };
  }

  export(input: { resource: GovernanceResourceTarget }) {
    return this.resources.get(input.resource.id)?.data ?? null;
  }

  erase(input: { resource: GovernanceResourceTarget }) {
    const existed = this.resources.delete(input.resource.id);
    return { effect: existed ? 'fixture_content_erased' : 'fixture_content_already_absent' };
  }
}

function policy(now: string, key = false) {
  return {
    retentionRules: [
      {
        id: 'personal-content',
        name: 'Personal content',
        resourceType: 'content' as const,
        classification: 'personal' as const,
        retainForDays: 1,
        action: 'delete' as const,
        enabled: true,
      },
    ],
    residencyPolicy: {
      homeRegion: 'local',
      requireAttestation: true,
      rules: [
        { resourceType: 'content' as const, allowedRegions: ['local'] },
        { resourceType: 'asset' as const, allowedRegions: ['local'] },
        { resourceType: 'identity' as const, allowedRegions: ['local'] },
        { resourceType: 'plugin' as const, allowedRegions: ['local'] },
      ],
    },
    ...(key
      ? {
          keyReference: {
            adapter: 'custom' as const,
            keyId: 'customer-key',
            keyVersion: '1',
            expectedRegion: 'local',
          },
        }
      : {}),
    now,
  };
}

describe('GovernanceService', () => {
  it('makes holds dominant and executes only a fresh separately approved plan', async () => {
    let clock = new Date('2026-08-23T12:00:00.000Z');
    let sequence = 0;
    const processor = new FixtureProcessor();
    processor.resources.set('entry-1', { version: 'revision-1', data: { title: 'Personal' } });
    const service = new GovernanceService({
      processors: [processor],
      placementAdapter: new ConfiguredPlacementAdapter({}, () => clock),
      now: () => clock,
      createId: () => `governance-${++sequence}`,
    });
    await service.savePolicy(scope, 'policy-admin', policy(clock.toISOString()));
    const subject = await service.createSubject(scope, 'privacy-admin', 'customer-42');
    await service.linkSubjectResource(scope, 'privacy-admin', subject.id, {
      resource: { type: 'content', id: 'entry-1', external: false },
      classification: 'personal',
      retentionBasisAt: '2026-08-20T00:00:00.000Z',
    });
    const hold = await service.createHold(scope, 'legal-admin', {
      matter: 'Matter 24-1',
      reason: 'Preserve relevant content.',
      target: { kind: 'subject', subjectId: subject.id },
    });
    const blocked = await service.createRetentionPlan(scope, 'planner');
    expect(blocked.candidates).toMatchObject([
      { state: 'blocked', blockers: [expect.stringMatching(/^legal_hold:/)] },
    ]);
    await expect(
      service.approvePlan(scope, 'approver', blocked.id, {
        digest: blocked.digest,
        reason: 'Approved.',
        reauthenticatedAt: clock.toISOString(),
        backup: {
          reference: 'backup-fixture-1',
          sha256: 'a'.repeat(64),
          verifiedAt: clock.toISOString(),
        },
      }),
    ).rejects.toMatchObject({ code: 'governance_plan_blocked' });

    await service.releaseHold(scope, 'legal-admin', hold.id, 'Matter closed.');
    const plan = await service.createRetentionPlan(scope, 'planner');
    expect(plan.candidates).toMatchObject([
      { state: 'eligible', expectedVersion: 'revision-1', action: 'delete' },
    ]);
    await expect(
      service.approvePlan(scope, 'planner', plan.id, {
        digest: plan.digest,
        reason: 'Self approval.',
        reauthenticatedAt: clock.toISOString(),
        backup: {
          reference: 'backup-fixture-2',
          sha256: 'b'.repeat(64),
          verifiedAt: clock.toISOString(),
        },
      }),
    ).rejects.toMatchObject({ code: 'governance_separation_required' });
    await service.approvePlan(scope, 'approver', plan.id, {
      digest: plan.digest,
      reason: 'Reviewed fixture-only purge.',
      reauthenticatedAt: clock.toISOString(),
      backup: {
        reference: 'backup-fixture-2',
        sha256: 'b'.repeat(64),
        verifiedAt: clock.toISOString(),
      },
    });
    clock = new Date('2026-08-23T12:01:00.000Z');
    await expect(service.processApprovedPlans(scope, 'worker-1')).resolves.toEqual({
      claimed: 1,
      completed: 1,
      blocked: 0,
      failed: 0,
    });
    expect(processor.resources.has('entry-1')).toBe(false);
    const snapshot = await service.snapshot(scope);
    expect(snapshot.plans.at(-1)).toMatchObject({
      state: 'completed',
      candidates: [{ state: 'completed', receipt: { processor: 'fixture-content' } }],
    });
    snapshot.events.forEach((event, index) => {
      expect(event.sequence).toBe(index + 1);
      expect(event.eventHash).toMatch(/^[a-f0-9]{64}$/);
      expect(event.previousHash).toBe(
        index === 0 ? undefined : snapshot.events[index - 1]?.eventHash,
      );
    });
  });

  it('rejects plan drift and round-trips a CMK envelope without retaining plaintext keys', async () => {
    const clock = new Date('2026-08-23T12:00:00.000Z');
    const processor = new FixtureProcessor();
    processor.resources.set('entry-2', {
      version: 'revision-2',
      data: { email: 'person@example.test' },
    });
    const keyAdapter = new InMemoryCustomerManagedKeyAdapter(new Uint8Array(32).fill(7));
    const service = new GovernanceService({
      processors: [processor],
      keyAdapter,
      now: () => clock,
      placementAdapter: new ConfiguredPlacementAdapter({}, () => clock),
    });
    await service.savePolicy(scope, 'policy-admin', policy(clock.toISOString(), true));
    const subject = await service.createSubject(scope, 'privacy-admin', 'customer-84');
    await service.linkSubjectResource(scope, 'privacy-admin', subject.id, {
      resource: { type: 'content', id: 'entry-2', external: false },
      classification: 'personal',
      retentionBasisAt: '2026-08-20T00:00:00.000Z',
    });
    const stale = await service.createRetentionPlan(scope, 'planner');
    await service.createHold(scope, 'legal-admin', {
      matter: 'New hold',
      reason: 'Arrived after preview.',
      target: { kind: 'resource', resource: { type: 'content', id: 'entry-2', external: false } },
    });
    await expect(
      service.approvePlan(scope, 'approver', stale.id, {
        digest: stale.digest,
        reason: 'Stale.',
        reauthenticatedAt: clock.toISOString(),
        backup: {
          reference: 'backup-fixture-3',
          sha256: 'c'.repeat(64),
          verifiedAt: clock.toISOString(),
        },
      }),
    ).rejects.toMatchObject({ code: 'governance_plan_stale' });

    const request = await service.createRequest(scope, 'privacy-admin', {
      subjectId: subject.id,
      type: 'export',
      reason: 'Verified export request.',
    });
    await service.verifyRequest(scope, 'verifier', request.id, {
      method: 'manual-review',
      evidenceReference: 'verification-case-84',
    });
    await service.reviewRequest(scope, 'reviewer', request.id, {
      decision: 'approve',
      reason: 'Identity evidence accepted.',
    });
    const exported = await service.exportRequest(scope, 'exporter', request.id, true);
    expect(exported).toEqual({ envelope: expect.objectContaining({ algorithm: 'A256GCM' }) });
    const reference = (await service.snapshot(scope)).keyReference;
    if (!reference || !exported.envelope) throw new Error('Expected configured CMK envelope.');
    const plaintext = await service.decryptEnvelopeForVerification(
      scope,
      reference,
      exported.envelope,
    );
    expect(plaintext).toMatchObject({
      requestId: request.id,
      resources: [{ resource: { id: 'entry-2' }, data: { email: 'person@example.test' } }],
    });
    expect(exported.envelope.ciphertext).not.toContain('person@example.test');
  });
});
