import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'experiment-tenant',
  'x-gridstory-environment': 'production',
  'x-gridstory-actor': 'experiment-admin',
  'x-gridstory-roles': 'admin',
};

const configuration = {
  purposes: [
    {
      id: 'experimentation',
      name: 'Content experimentation',
      description: 'Use a random assignment token to compare content variants.',
      honorGlobalPrivacyControl: true,
    },
  ],
  attributes: [
    {
      key: 'market',
      name: 'Market',
      source: 'market',
      valueType: 'enum',
      allowedValues: ['uk', 'us'],
      classification: 'public',
      requiredPurposes: [],
      cacheability: 'shared',
    },
  ],
  audiences: [
    {
      id: 'uk-visitors',
      name: 'UK visitors',
      description: 'Visitors in the UK market.',
      priority: 10,
      conditions: [{ attributeKey: 'market', operator: 'equals', value: 'uk' }],
    },
  ],
  decisions: [
    {
      resourceKey: 'hero',
      name: 'Homepage hero',
      variants: ['default', 'treatment', 'uk'],
      rules: [{ audienceId: 'uk-visitors', variant: 'uk' }],
      fallbackVariant: 'default',
    },
  ],
};

const design = {
  id: 'hero-copy-test',
  name: 'Homepage hero copy',
  hypothesis: 'The treatment improves signup rate without increasing exits.',
  target: { resourceKey: 'hero' },
  controlVariant: 'default',
  purposeId: 'experimentation',
  allocations: [
    { variant: 'default', weightBasisPoints: 5_000 },
    { variant: 'treatment', weightBasisPoints: 5_000 },
  ],
  metrics: [
    {
      key: 'signup-rate',
      name: 'Signup rate',
      role: 'primary',
      direction: 'increase',
      minimumSampleSize: 100,
    },
    {
      key: 'exit-rate',
      name: 'Exit rate',
      role: 'guardrail',
      direction: 'decrease',
      minimumSampleSize: 100,
      guardrail: { operator: 'lte', threshold: 0.4 },
    },
  ],
  minimumDurationHours: 0,
  maximumAllocationDeviationBasisPoints: 500,
};

function allocation(globalPrivacyControl = false) {
  return {
    attributes: { market: 'us' },
    consent: {
      grantedPurposes: ['experimentation'],
      deniedPurposes: [],
      globalPrivacyControl,
    },
    assignmentToken: '5e2d7f02-6f34-4c66-aac2-1e869bced27e',
  };
}

describe('experiment HTTP workflow', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('authorizes management, allocates privately, records aggregates, and promotes only to draft', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/experiments',
      headers: { ...headers, 'x-gridstory-roles': 'delivery' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['cache-control']).toBe('private, no-store');

    const targeting = await server.inject({
      method: 'PUT',
      url: '/api/v1/personalization/draft',
      headers,
      payload: { expectedVersion: 0, configuration },
    });
    expect(targeting.statusCode, targeting.body).toBe(200);
    const published = await server.inject({
      method: 'POST',
      url: '/api/v1/personalization/publish',
      headers,
      payload: { expectedVersion: 1, expectedDraftRevision: 2 },
    });
    expect(published.statusCode, published.body).toBe(200);

    const invalid = await server.inject({
      method: 'PUT',
      url: '/api/v1/experiments/hero-copy-test',
      headers,
      payload: {
        expectedVersion: 2,
        design: { ...design, allocations: design.allocations.slice(0, 1) },
      },
    });
    expect(invalid.statusCode).toBe(400);

    const drafted = await server.inject({
      method: 'PUT',
      url: '/api/v1/experiments/hero-copy-test',
      headers,
      payload: { expectedVersion: 2, design },
    });
    expect(drafted.statusCode, drafted.body).toBe(200);
    expect(drafted.json()).toMatchObject({ version: 3, experiments: [{ state: 'draft' }] });
    const started = await server.inject({
      method: 'POST',
      url: '/api/v1/experiments/hero-copy-test/transition',
      headers,
      payload: {
        expectedVersion: 3,
        action: 'start',
        reason: 'Reviewed design and instrumentation.',
      },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json()).toMatchObject({ version: 4, experiments: [{ state: 'running' }] });

    const allocated = await server.inject({
      method: 'POST',
      url: '/api/v1/experiments/hero-copy-test/allocate',
      headers: {
        'content-type': 'application/json',
        'x-gridstory-tenant': headers['x-gridstory-tenant'],
        'x-gridstory-environment': 'production',
      },
      payload: allocation(),
    });
    expect(allocated.statusCode, allocated.body).toBe(200);
    expect(allocated.headers['cache-control']).toBe('private, no-store');
    expect(allocated.json()).toMatchObject({
      experimentId: 'hero-copy-test',
      participating: true,
      reason: 'allocated',
      cache: { mode: 'no-store' },
    });
    expect(allocated.body).not.toContain('5e2d7f02');

    const gpc = await server.inject({
      method: 'POST',
      url: '/api/v1/experiments/hero-copy-test/allocate',
      headers: {
        'content-type': 'application/json',
        'x-gridstory-tenant': headers['x-gridstory-tenant'],
        'x-gridstory-environment': 'production',
        'sec-gpc': '1',
      },
      payload: allocation(false),
    });
    expect(gpc.json()).toMatchObject({
      participating: false,
      reason: 'consent-required',
      variant: 'default',
    });

    const observedAt = new Date().toISOString();
    const recorded = await server.inject({
      method: 'POST',
      url: '/api/v1/experiments/hero-copy-test/metrics',
      headers,
      payload: {
        expectedVersion: 4,
        snapshot: {
          id: 'snapshot-1',
          evidenceId: 'warehouse-run-1',
          evidenceDigest: 'a'.repeat(64),
          observedAt,
          variantResults: [
            {
              variant: 'default',
              exposures: 1_000,
              observations: [
                { metricKey: 'signup-rate', sampleSize: 1_000, value: 0.1 },
                { metricKey: 'exit-rate', sampleSize: 1_000, value: 0.3 },
              ],
            },
            {
              variant: 'treatment',
              exposures: 1_000,
              observations: [
                { metricKey: 'signup-rate', sampleSize: 1_000, value: 0.12 },
                { metricKey: 'exit-rate', sampleSize: 1_000, value: 0.32 },
              ],
            },
          ],
        },
      },
    });
    expect(recorded.statusCode, recorded.body).toBe(200);
    expect(recorded.json()).toMatchObject({
      version: 5,
      experiments: [{ lastGuardrailEvaluation: { status: 'passed' } }],
    });
    const completed = await server.inject({
      method: 'POST',
      url: '/api/v1/experiments/hero-copy-test/transition',
      headers,
      payload: { expectedVersion: 5, action: 'complete', reason: 'Planned run completed.' },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    const promoted = await server.inject({
      method: 'POST',
      url: '/api/v1/experiments/hero-copy-test/promote',
      headers,
      payload: {
        expectedVersion: 6,
        snapshotId: 'snapshot-1',
        winnerVariant: 'treatment',
        reason: 'Reviewed aggregate evidence supports the treatment.',
      },
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(promoted.json()).toMatchObject({
      version: 7,
      targetingDraftRevision: 3,
      targetingPublishedRevision: 2,
      experiments: [{ state: 'promoted', promotion: { winnerVariant: 'treatment' } }],
    });

    const targetingAfterPromotion = await server.inject({
      method: 'GET',
      url: '/api/v1/personalization',
      headers,
    });
    expect(targetingAfterPromotion.json()).toMatchObject({
      draft: { revision: 3, configuration: { decisions: [{ fallbackVariant: 'treatment' }] } },
      published: { revision: 2, configuration: { decisions: [{ fallbackVariant: 'default' }] } },
    });
    const otherTenant = await server.inject({
      method: 'POST',
      url: '/api/v1/experiments/hero-copy-test/allocate',
      headers: { 'content-type': 'application/json', 'x-gridstory-tenant': 'other-tenant' },
      payload: allocation(),
    });
    expect(otherTenant.statusCode).toBe(404);
  });
});
