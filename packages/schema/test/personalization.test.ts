import { describe, expect, it } from 'vitest';
import {
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
