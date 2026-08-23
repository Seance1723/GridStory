import { describe, expect, it } from 'vitest';
import {
  experimentAllocationRequestSchema,
  experimentDesignSchema,
  experimentSchema,
  personalizationConfigurationSchema,
  personalizationConsentSchema,
  targetingAttributeSchema,
} from '../src/index.js';

function configuration() {
  return {
    purposes: [
      {
        id: 'personalization',
        name: 'Personalized content',
        description: 'Use a declared preference to choose content.',
        honorGlobalPrivacyControl: true,
      },
    ],
    attributes: [
      {
        key: 'market',
        name: 'Market',
        source: 'market' as const,
        valueType: 'enum' as const,
        allowedValues: ['uk', 'us'],
        classification: 'public' as const,
        requiredPurposes: [],
        cacheability: 'shared' as const,
      },
      {
        key: 'affinity',
        name: 'Declared affinity',
        source: 'application' as const,
        valueType: 'enum' as const,
        allowedValues: ['travel', 'technology'],
        classification: 'personal' as const,
        requiredPurposes: ['personalization'],
        cacheability: 'private' as const,
      },
    ],
    audiences: [
      {
        id: 'travel-readers',
        name: 'Travel readers',
        description: 'Readers with a declared travel preference.',
        priority: 10,
        conditions: [{ attributeKey: 'affinity', operator: 'equals' as const, value: 'travel' }],
      },
      {
        id: 'uk-visitors',
        name: 'UK visitors',
        description: 'Visitors in the UK market.',
        priority: 20,
        conditions: [{ attributeKey: 'market', operator: 'equals' as const, value: 'uk' }],
      },
    ],
    decisions: [
      {
        resourceKey: 'hero',
        name: 'Homepage hero',
        variants: ['default', 'travel', 'uk'],
        rules: [
          { audienceId: 'travel-readers', variant: 'travel' },
          { audienceId: 'uk-visitors', variant: 'uk' },
        ],
        fallbackVariant: 'default',
      },
    ],
  };
}

function experimentDesign() {
  return {
    id: 'hero-copy-test',
    name: 'Homepage hero copy',
    hypothesis: 'A shorter treatment improves qualified signups without increasing exits.',
    target: { resourceKey: 'hero' },
    controlVariant: 'default',
    purposeId: 'personalization',
    allocations: [
      { variant: 'default', weightBasisPoints: 5_000 },
      { variant: 'travel', weightBasisPoints: 5_000 },
    ],
    metrics: [
      {
        key: 'signup-rate',
        name: 'Qualified signup rate',
        role: 'primary' as const,
        direction: 'increase' as const,
        minimumSampleSize: 1_000,
      },
      {
        key: 'exit-rate',
        name: 'Homepage exit rate',
        role: 'guardrail' as const,
        direction: 'decrease' as const,
        minimumSampleSize: 1_000,
        guardrail: { operator: 'lte' as const, threshold: 0.35 },
      },
    ],
    minimumDurationHours: 168,
    maximumAllocationDeviationBasisPoints: 500,
  };
}

describe('personalization contracts', () => {
  it('accepts a bounded purpose-aware targeting graph', () => {
    expect(personalizationConfigurationSchema.parse(configuration())).toMatchObject({
      attributes: [{ key: 'market' }, { key: 'affinity' }],
      audiences: [{ priority: 10 }, { priority: 20 }],
    });
  });

  it('rejects personal shared-cache attributes and dangling or mistyped conditions', () => {
    expect(
      targetingAttributeSchema.safeParse({
        ...configuration().attributes[1],
        cacheability: 'shared',
      }).success,
    ).toBe(false);
    expect(
      targetingAttributeSchema.safeParse({
        ...configuration().attributes[1],
        allowedValues: ['person@example.test'],
      }).success,
    ).toBe(false);
    expect(
      personalizationConfigurationSchema.safeParse({
        ...configuration(),
        audiences: [
          {
            ...configuration().audiences[0],
            conditions: [{ attributeKey: 'missing', operator: 'equals', value: 'travel' }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      personalizationConfigurationSchema.safeParse({
        ...configuration(),
        audiences: [
          {
            ...configuration().audiences[1],
            conditions: [{ attributeKey: 'market', operator: 'equals', value: 'canada' }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects priority ambiguity, dangling variants, and contradictory consent', () => {
    const duplicatePriority = structuredClone(configuration());
    const secondAudience = duplicatePriority.audiences[1];
    if (!secondAudience) {
      throw new Error('Expected a second audience in the test fixture.');
    }
    secondAudience.priority = 10;
    expect(personalizationConfigurationSchema.safeParse(duplicatePriority).success).toBe(false);

    const danglingVariant = structuredClone(configuration());
    const firstRule = danglingVariant.decisions[0]?.rules[0];
    if (!firstRule) {
      throw new Error('Expected a decision rule in the test fixture.');
    }
    firstRule.variant = 'missing';
    expect(personalizationConfigurationSchema.safeParse(danglingVariant).success).toBe(false);

    expect(
      personalizationConsentSchema.safeParse({
        grantedPurposes: ['personalization'],
        deniedPurposes: ['personalization'],
        globalPrivacyControl: false,
      }).success,
    ).toBe(false);
  });
});

describe('experiment contracts', () => {
  it('accepts a bounded draft design and optional random assignment token', () => {
    expect(experimentDesignSchema.parse(experimentDesign())).toMatchObject({
      controlVariant: 'default',
      allocations: [{ weightBasisPoints: 5_000 }, { weightBasisPoints: 5_000 }],
    });
    expect(
      experimentAllocationRequestSchema.parse({
        attributes: { market: 'uk' },
        consent: {
          grantedPurposes: ['personalization'],
          deniedPurposes: [],
          globalPrivacyControl: false,
        },
        assignmentToken: '5e2d7f02-6f34-4c66-aac2-1e869bced27e',
      }),
    ).toMatchObject({ assignmentToken: '5e2d7f02-6f34-4c66-aac2-1e869bced27e' });
  });

  it('rejects incomplete allocation and ambiguous metric authority', () => {
    expect(
      experimentDesignSchema.safeParse({
        ...experimentDesign(),
        allocations: [
          { variant: 'default', weightBasisPoints: 6_000 },
          { variant: 'travel', weightBasisPoints: 3_000 },
        ],
      }).success,
    ).toBe(false);
    expect(
      experimentDesignSchema.safeParse({
        ...experimentDesign(),
        metrics: experimentDesign().metrics.map((metric) => ({
          ...metric,
          role: 'primary',
          guardrail: undefined,
        })),
      }).success,
    ).toBe(false);
  });

  it('requires complete aggregate evidence and lifecycle metadata', () => {
    const running = {
      ...experimentDesign(),
      state: 'running' as const,
      revision: 1,
      metricSnapshots: [
        {
          id: 'snapshot-1',
          evidenceId: 'warehouse-run-1',
          evidenceDigest: 'a'.repeat(64),
          observedAt: '2026-08-23T10:00:00.000Z',
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
              variant: 'travel',
              exposures: 1_000,
              observations: [
                { metricKey: 'signup-rate', sampleSize: 1_000, value: 0.12 },
                { metricKey: 'exit-rate', sampleSize: 1_000, value: 0.31 },
              ],
            },
          ],
          recordedAt: '2026-08-23T10:05:00.000Z',
          recordedBy: 'analyst-1',
        },
      ],
      targetingRevision: 2,
      startedAt: '2026-08-16T10:00:00.000Z',
      startedBy: 'operator-1',
      createdAt: '2026-08-16T09:00:00.000Z',
      createdBy: 'operator-1',
      updatedAt: '2026-08-23T10:05:00.000Z',
      updatedBy: 'analyst-1',
    };
    expect(experimentSchema.parse(running)).toMatchObject({
      state: 'running',
      targetingRevision: 2,
    });

    const incomplete = structuredClone(running);
    incomplete.metricSnapshots[0]?.variantResults[1]?.observations.pop();
    expect(experimentSchema.safeParse(incomplete).success).toBe(false);
    expect(
      experimentSchema.safeParse({
        ...running,
        targetingRevision: undefined,
      }).success,
    ).toBe(false);
  });
});
