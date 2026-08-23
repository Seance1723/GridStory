import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const headers = {
  'x-gridstory-tenant': 'governance-test',
  'x-gridstory-actor': 'planner',
};

const page = {
  title: 'Governed fixture',
  slug: 'governed-fixture',
  story: {
    version: 1,
    blocks: [
      {
        id: 'paragraph',
        type: 'paragraph',
        content: [{ type: 'text', text: 'Fixture', marks: [] }],
      },
    ],
  },
  blocks: [
    {
      id: 'hero',
      component: 'gridstory.hero',
      version: 1,
      props: { eyebrow: '', heading: 'Governed fixture', body: 'Fixture', tone: 'indigo' },
    },
  ],
};

describe('governance HTTP workflow', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('blocks held data and executes an independently approved isolated-fixture plan', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const created = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/content',
        headers,
        payload: { contentType: 'page', data: page },
      })
    ).json();
    const policy = await server.inject({
      method: 'PUT',
      url: '/api/v1/governance/policy',
      headers,
      payload: {
        retentionRules: [
          {
            id: 'personal-content',
            name: 'Personal content fixture',
            resourceType: 'content',
            classification: 'personal',
            retainForDays: 1,
            action: 'delete',
            enabled: true,
          },
        ],
        residencyPolicy: {
          homeRegion: 'local',
          requireAttestation: true,
          rules: [
            { resourceType: 'content', allowedRegions: ['local'] },
            { resourceType: 'asset', allowedRegions: ['local'] },
            { resourceType: 'identity', allowedRegions: ['local'] },
            { resourceType: 'plugin', allowedRegions: ['local'] },
          ],
        },
      },
    });
    expect(policy.statusCode).toBe(200);
    expect(policy.headers['cache-control']).toBe('private, no-store');

    const subject = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/governance/subjects',
        headers,
        payload: { reference: 'fixture@example.test' },
      })
    ).json();
    const link = await server.inject({
      method: 'POST',
      url: `/api/v1/governance/subjects/${subject.id}/links`,
      headers,
      payload: {
        resource: { type: 'content', id: created.id, external: false },
        classification: 'personal',
        retentionBasisAt: '2020-01-01T00:00:00.000Z',
      },
    });
    expect(link.statusCode).toBe(201);

    const hold = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/governance/holds',
        headers,
        payload: {
          matter: 'fixture-litigation',
          reason: 'Prove deletion cannot cross an active hold.',
          target: { kind: 'subject', subjectId: subject.id },
        },
      })
    ).json();
    const blockedPlan = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/governance/retention/plans',
        headers,
      })
    ).json();
    expect(blockedPlan.candidates[0]).toMatchObject({ state: 'blocked' });
    expect(blockedPlan.candidates[0].blockers).toContain(`legal_hold:${hold.id}`);

    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/governance/holds/${hold.id}/release`,
          headers,
          payload: { reason: 'Isolated fixture hold released.' },
        })
      ).statusCode,
    ).toBe(200);
    const plan = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/governance/retention/plans',
        headers,
      })
    ).json();
    expect(plan.candidates).toEqual([
      expect.objectContaining({
        resource: expect.objectContaining({ id: created.id }),
        state: 'eligible',
      }),
    ]);

    const sameActor = await server.inject({
      method: 'POST',
      url: `/api/v1/governance/plans/${plan.id}/approve`,
      headers,
      payload: {
        digest: plan.digest,
        reason: 'Fixture retention execution.',
        backup: {
          reference: 'fixture-backup-2026-08-23',
          sha256: '0'.repeat(64),
          verifiedAt: new Date().toISOString(),
        },
      },
    });
    expect(sameActor.statusCode).toBe(409);
    expect(sameActor.json().error.code).toBe('governance_separation_required');

    const approved = await server.inject({
      method: 'POST',
      url: `/api/v1/governance/plans/${plan.id}/approve`,
      headers: { ...headers, 'x-gridstory-actor': 'approver' },
      payload: {
        digest: plan.digest,
        reason: 'Fixture retention execution.',
        backup: {
          reference: 'fixture-backup-2026-08-23',
          sha256: '0'.repeat(64),
          verifiedAt: new Date().toISOString(),
        },
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().state).toBe('approved');

    const processed = await server.inject({
      method: 'POST',
      url: '/api/v1/governance/plans/process',
      headers: { ...headers, 'x-gridstory-actor': 'operator' },
    });
    expect(processed.statusCode).toBe(200);
    expect(processed.json()).toMatchObject({ claimed: 1, completed: 1, blocked: 0, failed: 0 });
    expect(
      (
        await server.inject({
          method: 'GET',
          url: `/api/v1/content/${created.id}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);

    const snapshot = await server.inject({ method: 'GET', url: '/api/v1/governance', headers });
    expect(
      snapshot.json().plans.find((candidate: { id: string }) => candidate.id === plan.id),
    ).toMatchObject({ state: 'completed' });
    expect(snapshot.json().events.at(-1)).toMatchObject({ action: 'governance.plan.completed' });

    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/governance',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });
    expect(denied.statusCode).toBe(403);
  });
});
