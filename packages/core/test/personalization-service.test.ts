import type { ContentScope, PersonalizationConfiguration } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import { InMemoryPersonalizationRepository, PersonalizationService } from '../src/index.js';

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
        source: 'market',
        valueType: 'enum',
        allowedValues: ['uk', 'us'],
        classification: 'public',
        requiredPurposes: [],
        cacheability: 'shared',
      },
      {
        key: 'authenticated',
        name: 'Authentication state',
        source: 'authentication-state',
        valueType: 'boolean',
        allowedValues: [],
        classification: 'public',
        requiredPurposes: [],
        cacheability: 'private',
      },
      {
        key: 'affinity',
        name: 'Declared affinity',
        source: 'application',
        valueType: 'enum',
        allowedValues: ['travel', 'technology'],
        classification: 'personal',
        requiredPurposes: ['personalization'],
        cacheability: 'private',
      },
    ],
    audiences: [
      {
        id: 'travel-readers',
        name: 'Travel readers',
        description: 'Readers with a declared travel preference.',
        priority: 10,
        conditions: [{ attributeKey: 'affinity', operator: 'equals', value: 'travel' }],
      },
      {
        id: 'uk-visitors',
        name: 'UK visitors',
        description: 'Visitors in the UK market.',
        priority: 20,
        conditions: [{ attributeKey: 'market', operator: 'equals', value: 'uk' }],
      },
      {
        id: 'members',
        name: 'Members',
        description: 'Authenticated application visitors.',
        priority: 30,
        conditions: [{ attributeKey: 'authenticated', operator: 'equals', value: true }],
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
      {
        resourceKey: 'banner',
        name: 'Market banner',
        variants: ['default', 'uk'],
        rules: [{ audienceId: 'uk-visitors', variant: 'uk' }],
        fallbackVariant: 'default',
      },
      {
        resourceKey: 'account-link',
        name: 'Account link',
        variants: ['sign-in', 'account'],
        rules: [{ audienceId: 'members', variant: 'account' }],
        fallbackVariant: 'sign-in',
      },
    ],
  };
}

function request(resourceKey: string) {
  return {
    resourceKey,
    attributes: { market: 'uk' },
    consent: { grantedPurposes: [], deniedPurposes: [], globalPrivacyControl: false },
  };
}

describe('PersonalizationService', () => {
  it('keeps draft preview isolated and publishes an exact optimistic revision', async () => {
    const service = new PersonalizationService({
      repository: new InMemoryPersonalizationRepository(),
      now: () => '2026-08-23T12:00:00.000Z',
    });
    const draft = await service.replaceDraft({
      scope,
      actorId: 'author-a',
      expectedVersion: 0,
      configuration: configuration(),
    });
    expect(draft).toMatchObject({ version: 1, draft: { revision: 2 } });
    expect(draft.published).toBeUndefined();
    const preview = await service.preview(scope, request('banner'));
    expect(preview).toMatchObject({
      variant: 'uk',
      audienceId: 'uk-visitors',
      reason: 'matched',
      cache: { mode: 'no-store' },
    });
    await expect(service.decidePublished(scope, request('banner'))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      service.publish({
        scope,
        actorId: 'publisher-a',
        expectedVersion: 0,
        expectedDraftRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    const published = await service.publish({
      scope,
      actorId: 'publisher-a',
      expectedVersion: 1,
      expectedDraftRevision: 2,
    });
    expect(published).toMatchObject({ version: 2, published: { revision: 2 } });
  });

  it('evaluates first-match consent and GPC without persisting a subject profile', async () => {
    const service = new PersonalizationService({
      repository: new InMemoryPersonalizationRepository(),
    });
    await service.replaceDraft({
      scope,
      actorId: 'author-a',
      expectedVersion: 0,
      configuration: configuration(),
    });
    await service.publish({
      scope,
      actorId: 'publisher-a',
      expectedVersion: 1,
      expectedDraftRevision: 2,
    });
    const base = {
      resourceKey: 'hero',
      attributes: { affinity: 'travel', market: 'uk' },
      consent: {
        grantedPurposes: ['personalization'],
        deniedPurposes: [],
        globalPrivacyControl: false,
      },
    } as const;
    const travelDecision = await service.decidePublished(scope, base);
    expect(travelDecision).toMatchObject({
      variant: 'travel',
      cache: { mode: 'private' },
    });
    expect(travelDecision).not.toHaveProperty('audienceId');
    expect(travelDecision.cache).not.toHaveProperty('key');
    await expect(
      service.decidePublished(scope, {
        ...base,
        consent: { ...base.consent, globalPrivacyControl: true },
      }),
    ).resolves.toMatchObject({ variant: 'uk' });
    await expect(
      service.decidePublished(scope, {
        ...base,
        consent: { grantedPurposes: [], deniedPurposes: [], globalPrivacyControl: false },
      }),
    ).resolves.toMatchObject({ variant: 'uk' });
  });

  it('emits complete shared keys only for bounded public inputs and keeps auth private', async () => {
    const service = new PersonalizationService({
      repository: new InMemoryPersonalizationRepository(),
    });
    await service.replaceDraft({
      scope,
      actorId: 'author-a',
      expectedVersion: 0,
      configuration: configuration(),
    });
    await service.publish({
      scope,
      actorId: 'publisher-a',
      expectedVersion: 1,
      expectedDraftRevision: 2,
    });
    const banner = await service.decidePublished(scope, request('banner'));
    expect(banner.cache).toMatchObject({
      mode: 'shared',
      inputs: ['market'],
      key: expect.stringMatching(
        /^gridstory-personalization-v1:[a-f0-9]{64}:r2:banner:[a-f0-9]{64}$/,
      ),
    });
    await expect(
      service.decidePublished(scope, {
        resourceKey: 'account-link',
        attributes: { authenticated: true },
        consent: { grantedPurposes: [], deniedPurposes: [], globalPrivacyControl: false },
      }),
    ).resolves.toMatchObject({ variant: 'account', cache: { mode: 'private' } });
  });

  it('keeps maximum bounded public contexts in fixed-length collision-resistant guidance', async () => {
    const longScope = Object.fromEntries(
      Object.keys(scope).map((key) => [key, `a${':'.repeat(127)}`]),
    ) as ContentScope;
    const attributes = Array.from({ length: 50 }, (_, index) => ({
      key: `attribute-${index}`,
      name: `Attribute ${index}`,
      source: 'application' as const,
      valueType: 'enum' as const,
      allowedValues: ['selected', 'other'],
      classification: 'public' as const,
      requiredPurposes: [],
      cacheability: 'shared' as const,
    }));
    const audiences = attributes.map((attribute, index) => ({
      id: `audience-${index}`,
      name: `Audience ${index}`,
      description: `Audience for ${attribute.key}.`,
      priority: index,
      conditions: [{ attributeKey: attribute.key, operator: 'equals' as const, value: 'selected' }],
    }));
    const maximumConfiguration: PersonalizationConfiguration = {
      purposes: [],
      attributes,
      audiences,
      decisions: [
        {
          resourceKey: 'maximum-context',
          name: 'Maximum context',
          variants: ['default', 'selected'],
          rules: audiences.map(({ id }) => ({ audienceId: id, variant: 'selected' })),
          fallbackVariant: 'default',
        },
      ],
    };
    const service = new PersonalizationService({
      repository: new InMemoryPersonalizationRepository(),
    });
    await service.replaceDraft({
      scope: longScope,
      actorId: 'author-a',
      expectedVersion: 0,
      configuration: maximumConfiguration,
    });
    await service.publish({
      scope: longScope,
      actorId: 'publisher-a',
      expectedVersion: 1,
      expectedDraftRevision: 2,
    });
    const context = Object.fromEntries(attributes.map(({ key }) => [key, 'selected']));
    const result = await service.decidePublished(longScope, {
      resourceKey: 'maximum-context',
      attributes: context,
      consent: { grantedPurposes: [], deniedPurposes: [], globalPrivacyControl: false },
    });
    expect(result.cache).toMatchObject({ mode: 'shared', inputs: expect.any(Array) });
    expect(result.cache.inputs).toHaveLength(50);
    expect(result.cache.key?.length).toBeLessThan(256);
    expect(result.cache.tag.length).toBeLessThan(128);
    const changed = await service.decidePublished(longScope, {
      resourceKey: 'maximum-context',
      attributes: { ...context, 'attribute-49': 'other' },
      consent: { grantedPurposes: [], deniedPurposes: [], globalPrivacyControl: false },
    });
    expect(changed.cache.key).not.toBe(result.cache.key);
  });

  it('rejects undeclared inputs and supports non-persistent audience or variant preview overrides', async () => {
    const service = new PersonalizationService({
      repository: new InMemoryPersonalizationRepository(),
    });
    await service.replaceDraft({
      scope,
      actorId: 'author-a',
      expectedVersion: 0,
      configuration: configuration(),
    });
    await expect(
      service.preview(scope, {
        ...request('banner'),
        attributes: { email: 'person@example.test' },
      }),
    ).rejects.toMatchObject({ code: 'personalization_attribute_unknown' });
    await expect(
      service.preview(scope, {
        ...request('banner'),
        override: { variant: 'default' },
      }),
    ).resolves.toMatchObject({
      variant: 'default',
      reason: 'override',
      cache: { mode: 'no-store' },
    });
    await expect(
      service.preview(scope, {
        ...request('hero'),
        override: { audienceId: 'travel-readers', variant: 'uk' },
      }),
    ).rejects.toMatchObject({ code: 'personalization_preview_override_invalid' });
  });
});
