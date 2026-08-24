import { describe, expect, it } from 'vitest';
import { createInteroperabilityDiscovery, type ContentScope } from '@gridstory/schema';
import {
  emptyFleetDocument,
  FleetService,
  InMemoryFleetRepository,
  type FleetObservationAdapter,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'org',
  tenantId: 'tenant-a',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'production',
  locale: 'en',
};
const otherScope = { ...scope, tenantId: 'tenant-b' };
const discovery = createInteroperabilityDiscovery({
  instanceId: 'local-instance',
  serviceVersion: '8.4.0',
});
const remoteDiscovery = createInteroperabilityDiscovery({
  instanceId: 'remote-instance',
  serviceVersion: '8.4.0',
});

function service(adapter: FleetObservationAdapter) {
  let id = 0;
  return new FleetService({
    repository: new InMemoryFleetRepository(),
    adapters: [adapter],
    localDiscovery: discovery,
    now: () => new Date('2026-08-24T12:00:00.000Z'),
    createId: () => String(++id),
    timeoutMs: 100,
  });
}

describe('FleetService', () => {
  it('is empty by default, isolated by complete scope, and records compatible observations', async () => {
    const fleet = service({
      id: 'remote-primary',
      observe: () => ({
        discovery: remoteDiscovery,
        health: { status: 'ok', service: 'gridstory-api' },
        readiness: { status: 'ready' },
        observedAt: '2026-08-24T11:59:59.000Z',
        expiresAt: '2026-08-24T12:05:00.000Z',
      }),
    });
    expect((await fleet.snapshot(scope)).members).toEqual([]);
    let document = await fleet.upsertMember({
      scope,
      memberId: 'primary',
      member: {
        expectedVersion: 0,
        label: 'Primary production',
        adapterId: 'remote-primary',
        expectedInstanceId: 'remote-instance',
        expectedServiceVersion: '8.4.0',
      },
      actorId: 'operator',
    });
    document = await fleet.checkMember({
      scope,
      memberId: 'primary',
      expectedVersion: document.version,
      actorId: 'operator',
    });
    expect(
      document.observations.at(-1)?.conditions.map(({ type, status }) => ({ type, status })),
    ).toEqual([
      { type: 'Reachable', status: 'true' },
      { type: 'Ready', status: 'true' },
      { type: 'Compatible', status: 'true' },
    ]);
    expect(document.observations.at(-1)?.instance?.specifications).toHaveLength(4);
    expect((await fleet.snapshot(otherScope)).members).toEqual([]);
  });

  it('fails closed with generic evidence for malformed adapter output', async () => {
    const fleet = service({
      id: 'hostile',
      observe: () => ({ secret: 'do-not-retain', error: 'private upstream stack trace' }),
    });
    let document = await fleet.upsertMember({
      scope,
      memberId: 'hostile-member',
      member: {
        expectedVersion: 0,
        label: 'Hostile fixture',
        adapterId: 'hostile',
        expectedInstanceId: 'expected',
      },
      actorId: 'operator',
    });
    document = await fleet.checkMember({
      scope,
      memberId: 'hostile-member',
      expectedVersion: document.version,
      actorId: 'operator',
    });
    expect(document.observations.at(-1)?.conditions[0]).toMatchObject({
      type: 'Reachable',
      status: 'false',
      reason: 'ObservationUnavailable',
    });
    expect(JSON.stringify(document)).not.toContain('do-not-retain');
    expect(JSON.stringify(document)).not.toContain('stack trace');
  });

  it('requires configured adapters and refuses checks while a member is paused', async () => {
    const fleet = service({ id: 'configured', observe: () => undefined });
    await expect(
      fleet.upsertMember({
        scope,
        memberId: 'missing',
        member: {
          expectedVersion: 0,
          label: 'Missing adapter',
          adapterId: 'unconfigured',
          expectedInstanceId: 'remote',
        },
        actorId: 'operator',
      }),
    ).rejects.toMatchObject({ code: 'fleet_adapter_unavailable' });
    let document = await fleet.upsertMember({
      scope,
      memberId: 'configured-member',
      member: {
        expectedVersion: 0,
        label: 'Configured member',
        adapterId: 'configured',
        expectedInstanceId: 'remote',
      },
      actorId: 'operator',
    });
    document = await fleet.setMemberState({
      scope,
      memberId: 'configured-member',
      state: { expectedVersion: document.version, state: 'paused' },
      actorId: 'operator',
    });
    await expect(
      fleet.checkMember({
        scope,
        memberId: 'configured-member',
        expectedVersion: document.version,
        actorId: 'operator',
      }),
    ).rejects.toMatchObject({ code: 'fleet_member_paused' });
  });

  it('updates an explicitly persisted empty version-zero document after restore', async () => {
    const repository = new InMemoryFleetRepository();
    repository.save(emptyFleetDocument(scope, '2026-08-24T11:00:00.000Z'), null);
    const fleet = new FleetService({
      repository,
      adapters: [{ id: 'configured', observe: () => undefined }],
      localDiscovery: discovery,
      now: () => new Date('2026-08-24T12:00:00.000Z'),
      createId: () => 'restored',
      timeoutMs: 100,
    });
    await expect(
      fleet.upsertMember({
        scope,
        memberId: 'after-restore',
        member: {
          expectedVersion: 0,
          label: 'After restore',
          adapterId: 'configured',
          expectedInstanceId: 'remote',
        },
        actorId: 'operator',
      }),
    ).resolves.toMatchObject({ version: 1, members: [{ id: 'after-restore' }] });
  });

  it('projects expired observations as unknown without rewriting retained evidence', async () => {
    let now = new Date('2026-08-24T12:00:00.000Z');
    const fleet = new FleetService({
      repository: new InMemoryFleetRepository(),
      adapters: [
        {
          id: 'remote',
          observe: () => ({
            discovery: remoteDiscovery,
            health: { status: 'ok', service: 'gridstory-api' },
            readiness: { status: 'ready' },
            observedAt: '2026-08-24T11:59:59.000Z',
            expiresAt: '2026-08-24T12:01:00.000Z',
          }),
        },
      ],
      localDiscovery: discovery,
      now: () => now,
      createId: () => 'freshness',
      timeoutMs: 100,
    });
    let document = await fleet.upsertMember({
      scope,
      memberId: 'remote',
      member: {
        expectedVersion: 0,
        label: 'Remote',
        adapterId: 'remote',
        expectedInstanceId: 'remote-instance',
      },
      actorId: 'operator',
    });
    document = await fleet.checkMember({
      scope,
      memberId: 'remote',
      expectedVersion: document.version,
      actorId: 'operator',
    });
    expect(document.observations[0]?.conditions.every((item) => item.status === 'true')).toBe(true);
    now = new Date('2026-08-24T12:02:00.000Z');
    expect(
      (await fleet.snapshot(scope)).observations[0]?.conditions.every(
        (item) => item.status === 'unknown' && item.reason === 'ObservationExpired',
      ),
    ).toBe(true);
  });
});
