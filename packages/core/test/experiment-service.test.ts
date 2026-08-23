import type {
  ContentScope,
  ExperimentDesign,
  ExperimentMetricSnapshotInput,
  PersonalizationConfiguration,
} from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  ExperimentService,
  InMemoryPersonalizationRepository,
  PersonalizationService,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

function configuration(): PersonalizationConfiguration {
  return {
    purposes: [
      {
        id: 'experimentation',
        name: 'Content experimentation',
        description: 'Use a random assignment token to compare declared content variants.',
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
}

function design(id = 'hero-copy-test'): ExperimentDesign {
  return {
    id,
    name: 'Homepage hero copy',
    hypothesis: 'The treatment improves signup rate without increasing exit rate.',
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
    minimumDurationHours: 24,
    maximumAllocationDeviationBasisPoints: 500,
  };
}

function metrics(input: {
  id: string;
  observedAt: string;
  treatmentSignup?: number;
  treatmentExit?: number;
  sampleSize?: number;
  treatmentExposures?: number;
}): ExperimentMetricSnapshotInput {
  const sampleSize = input.sampleSize ?? 1_000;
  return {
    id: input.id,
    evidenceId: `warehouse-${input.id}`,
    evidenceDigest: input.id === 'snapshot-1' ? 'a'.repeat(64) : 'b'.repeat(64),
    observedAt: input.observedAt,
    variantResults: [
      {
        variant: 'default',
        exposures: 1_000,
        observations: [
          { metricKey: 'signup-rate', sampleSize, value: 0.1 },
          { metricKey: 'exit-rate', sampleSize, value: 0.3 },
        ],
      },
      {
        variant: 'treatment',
        exposures: input.treatmentExposures ?? 1_000,
        observations: [
          {
            metricKey: 'signup-rate',
            sampleSize,
            value: input.treatmentSignup ?? 0.12,
          },
          {
            metricKey: 'exit-rate',
            sampleSize,
            value: input.treatmentExit ?? 0.32,
          },
        ],
      },
    ],
  };
}

async function setup(now: () => string) {
  const repository = new InMemoryPersonalizationRepository();
  const personalization = new PersonalizationService({ repository, now });
  const experiments = new ExperimentService({ repository, now });
  await personalization.replaceDraft({
    scope,
    actorId: 'author-a',
    expectedVersion: 0,
    configuration: configuration(),
  });
  await personalization.publish({
    scope,
    actorId: 'publisher-a',
    expectedVersion: 1,
    expectedDraftRevision: 2,
  });
  return { repository, personalization, experiments };
}

const grantedConsent = {
  grantedPurposes: ['experimentation'],
  deniedPurposes: [],
  globalPrivacyControl: false,
} as const;

describe('ExperimentService', () => {
  it('freezes a valid design and allocates a stable variant without retaining the token', async () => {
    let timestamp = '2026-08-20T10:00:00.000Z';
    const { experiments, personalization } = await setup(() => timestamp);
    const drafted = await experiments.saveDraft({
      scope,
      actorId: 'analyst-a',
      expectedVersion: 2,
      design: design(),
    });
    expect(drafted).toMatchObject({ version: 3, experiments: [{ state: 'draft', revision: 1 }] });
    const started = await experiments.transition({
      scope,
      actorId: 'analyst-a',
      experimentId: 'hero-copy-test',
      expectedVersion: 3,
      action: 'start',
      reason: 'The design and instrumentation were reviewed.',
    });
    expect(started).toMatchObject({
      version: 4,
      experiments: [{ state: 'running', targetingRevision: 2 }],
    });

    const request = {
      attributes: { market: 'us' },
      consent: grantedConsent,
      assignmentToken: '5e2d7f02-6f34-4c66-aac2-1e869bced27e',
    } as const;
    const first = await experiments.allocate(scope, 'hero-copy-test', request);
    const repeated = await experiments.allocate(scope, 'hero-copy-test', request);
    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      participating: true,
      reason: 'allocated',
      variant: expect.stringMatching(/^(default|treatment)$/),
      cache: { mode: 'no-store' },
    });
    expect(first).not.toHaveProperty('assignmentToken');
    expect(await experiments.overview(scope)).not.toEqual(
      expect.objectContaining({ assignmentToken: expect.anything() }),
    );

    await expect(
      experiments.allocate(scope, 'hero-copy-test', {
        attributes: { market: 'us' },
        consent: { ...grantedConsent, grantedPurposes: [] },
      }),
    ).resolves.toMatchObject({
      participating: false,
      reason: 'consent-required',
      variant: 'default',
    });
    await expect(
      experiments.allocate(scope, 'hero-copy-test', {
        attributes: { market: 'uk' },
        consent: grantedConsent,
        assignmentToken: request.assignmentToken,
      }),
    ).resolves.toMatchObject({ participating: false, reason: 'not-eligible', variant: 'uk' });
    await expect(
      experiments.allocate(scope, 'hero-copy-test', {
        attributes: { market: 'us' },
        consent: { ...grantedConsent, globalPrivacyControl: true },
      }),
    ).resolves.toMatchObject({ participating: false, reason: 'consent-required' });
    await expect(
      experiments.saveDraft({
        scope,
        actorId: 'analyst-a',
        expectedVersion: 4,
        design: { ...design(), hypothesis: 'Changed while running.' },
      }),
    ).rejects.toMatchObject({ code: 'experiment_design_immutable' });

    timestamp = '2026-08-20T11:00:00.000Z';
    await personalization.replaceDraft({
      scope,
      actorId: 'publisher-a',
      expectedVersion: 4,
      configuration: configuration(),
    });
    await personalization.publish({
      scope,
      actorId: 'publisher-a',
      expectedVersion: 5,
      expectedDraftRevision: 3,
    });
    await expect(experiments.allocate(scope, 'hero-copy-test', request)).resolves.toMatchObject({
      participating: false,
      reason: 'targeting-drift',
      variant: 'default',
    });
  });

  it('blocks overlapping placements and requires valid published control references', async () => {
    const { experiments } = await setup(() => '2026-08-20T10:00:00.000Z');
    await expect(
      experiments.saveDraft({
        scope,
        actorId: 'analyst-a',
        expectedVersion: 2,
        design: {
          ...design(),
          controlVariant: 'missing',
          allocations: [
            { variant: 'missing', weightBasisPoints: 5_000 },
            { variant: 'treatment', weightBasisPoints: 5_000 },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'experiment_control_mismatch' });
    await experiments.saveDraft({
      scope,
      actorId: 'analyst-a',
      expectedVersion: 2,
      design: design(),
    });
    await experiments.transition({
      scope,
      actorId: 'analyst-a',
      experimentId: 'hero-copy-test',
      expectedVersion: 3,
      action: 'start',
      reason: 'Start first experiment.',
    });
    await experiments.saveDraft({
      scope,
      actorId: 'analyst-b',
      expectedVersion: 4,
      design: design('hero-copy-test-2'),
    });
    await expect(
      experiments.transition({
        scope,
        actorId: 'analyst-b',
        experimentId: 'hero-copy-test-2',
        expectedVersion: 5,
        action: 'start',
        reason: 'Attempt overlapping experiment.',
      }),
    ).rejects.toMatchObject({ code: 'experiment_target_overlap' });
  });

  it('pauses failed guardrails and requires later passing aggregate evidence before resume', async () => {
    let timestamp = '2026-08-20T10:00:00.000Z';
    const { experiments } = await setup(() => timestamp);
    await experiments.saveDraft({
      scope,
      actorId: 'analyst-a',
      expectedVersion: 2,
      design: design(),
    });
    await experiments.transition({
      scope,
      actorId: 'analyst-a',
      experimentId: 'hero-copy-test',
      expectedVersion: 3,
      action: 'start',
      reason: 'Begin guarded allocation.',
    });
    timestamp = '2026-08-20T12:00:00.000Z';
    const paused = await experiments.recordMetrics({
      scope,
      actorId: 'analytics-adapter',
      experimentId: 'hero-copy-test',
      expectedVersion: 4,
      snapshot: metrics({
        id: 'snapshot-1',
        observedAt: timestamp,
        treatmentExit: 0.5,
      }),
    });
    expect(paused).toMatchObject({
      version: 5,
      experiments: [
        {
          state: 'paused',
          lastGuardrailEvaluation: { status: 'failed', snapshotId: 'snapshot-1' },
        },
      ],
    });
    await expect(
      experiments.transition({
        scope,
        actorId: 'analyst-a',
        experimentId: 'hero-copy-test',
        expectedVersion: 5,
        action: 'resume',
        reason: 'Unsafe resume attempt.',
      }),
    ).rejects.toMatchObject({ code: 'experiment_guardrail_blocked' });
    timestamp = '2026-08-20T13:00:00.000Z';
    const healthy = await experiments.recordMetrics({
      scope,
      actorId: 'analytics-adapter',
      experimentId: 'hero-copy-test',
      expectedVersion: 5,
      snapshot: metrics({ id: 'snapshot-2', observedAt: timestamp }),
    });
    expect(healthy.experiments[0]?.lastGuardrailEvaluation).toMatchObject({ status: 'passed' });
    await expect(
      experiments.recordMetrics({
        scope,
        actorId: 'analytics-adapter',
        experimentId: 'hero-copy-test',
        expectedVersion: 6,
        snapshot: metrics({ id: 'snapshot-2', observedAt: timestamp }),
      }),
    ).rejects.toMatchObject({ code: 'experiment_metric_snapshot_conflict' });
    await expect(
      experiments.transition({
        scope,
        actorId: 'analyst-a',
        experimentId: 'hero-copy-test',
        expectedVersion: 6,
        action: 'resume',
        reason: 'Passing evidence is now attached.',
      }),
    ).resolves.toMatchObject({ version: 7, experiments: [{ state: 'running' }] });
  });

  it('promotes a supported treatment atomically into draft while published targeting stays stable', async () => {
    let timestamp = '2026-08-20T10:00:00.000Z';
    const { experiments, personalization, repository } = await setup(() => timestamp);
    await experiments.saveDraft({
      scope,
      actorId: 'analyst-a',
      expectedVersion: 2,
      design: design(),
    });
    await experiments.transition({
      scope,
      actorId: 'analyst-a',
      experimentId: 'hero-copy-test',
      expectedVersion: 3,
      action: 'start',
      reason: 'Begin experiment.',
    });
    timestamp = '2026-08-21T12:00:00.000Z';
    await experiments.recordMetrics({
      scope,
      actorId: 'analytics-adapter',
      experimentId: 'hero-copy-test',
      expectedVersion: 4,
      snapshot: metrics({ id: 'snapshot-1', observedAt: timestamp }),
    });
    await experiments.transition({
      scope,
      actorId: 'analyst-a',
      experimentId: 'hero-copy-test',
      expectedVersion: 5,
      action: 'complete',
      reason: 'The planned run is complete.',
    });
    const promoted = await experiments.promote({
      scope,
      actorId: 'publisher-a',
      experimentId: 'hero-copy-test',
      expectedVersion: 6,
      snapshotId: 'snapshot-1',
      winnerVariant: 'treatment',
      reason: 'Reviewed external analysis selected the treatment.',
    });
    expect(promoted).toMatchObject({
      version: 7,
      targetingDraftRevision: 3,
      targetingPublishedRevision: 2,
      experiments: [
        {
          state: 'promoted',
          promotion: {
            winnerVariant: 'treatment',
            snapshotId: 'snapshot-1',
            targetingDraftRevision: 3,
          },
        },
      ],
    });
    expect(repository.get(scope)?.draft.configuration.decisions[0]?.fallbackVariant).toBe(
      'treatment',
    );
    await expect(
      personalization.decidePublished(scope, {
        resourceKey: 'hero',
        attributes: { market: 'us' },
        consent: grantedConsent,
      }),
    ).resolves.toMatchObject({ variant: 'default', publishedRevision: 2 });
  });

  it('blocks promotion on insufficient samples, allocation mismatch, or unsupported primary results', async () => {
    let timestamp = '2026-08-20T10:00:00.000Z';
    const { experiments } = await setup(() => timestamp);
    await experiments.saveDraft({
      scope,
      actorId: 'analyst-a',
      expectedVersion: 2,
      design: design(),
    });
    await experiments.transition({
      scope,
      actorId: 'analyst-a',
      experimentId: 'hero-copy-test',
      expectedVersion: 3,
      action: 'start',
      reason: 'Begin experiment.',
    });
    timestamp = '2026-08-21T12:00:00.000Z';
    await experiments.recordMetrics({
      scope,
      actorId: 'analytics-adapter',
      experimentId: 'hero-copy-test',
      expectedVersion: 4,
      snapshot: metrics({
        id: 'snapshot-1',
        observedAt: timestamp,
        sampleSize: 20,
        treatmentExposures: 100,
      }),
    });
    await experiments.transition({
      scope,
      actorId: 'analyst-a',
      experimentId: 'hero-copy-test',
      expectedVersion: 5,
      action: 'complete',
      reason: 'Stop the invalid run.',
    });
    await expect(
      experiments.promote({
        scope,
        actorId: 'publisher-a',
        experimentId: 'hero-copy-test',
        expectedVersion: 6,
        snapshotId: 'snapshot-1',
        winnerVariant: 'treatment',
        reason: 'Unsafe promotion attempt.',
      }),
    ).rejects.toMatchObject({ code: 'experiment_guardrail_blocked' });

    const healthy = await experiments.recordMetrics({
      scope,
      actorId: 'analytics-adapter',
      experimentId: 'hero-copy-test',
      expectedVersion: 6,
      snapshot: metrics({
        id: 'snapshot-2',
        observedAt: timestamp,
        treatmentSignup: 0.08,
      }),
    });
    expect(healthy.experiments[0]?.lastGuardrailEvaluation).toMatchObject({ status: 'passed' });
    await expect(
      experiments.promote({
        scope,
        actorId: 'publisher-a',
        experimentId: 'hero-copy-test',
        expectedVersion: 7,
        snapshotId: 'snapshot-2',
        winnerVariant: 'treatment',
        reason: 'Unsupported winner attempt.',
      }),
    ).rejects.toMatchObject({ code: 'experiment_winner_not_supported' });
  });
});
