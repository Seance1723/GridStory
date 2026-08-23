import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'personalization-tenant',
  'x-gridstory-environment': 'production',
  'x-gridstory-actor': 'targeting-admin',
  'x-gridstory-roles': 'admin',
};

const configuration = {
  purposes: [
    {
      id: 'personalization',
      name: 'Personalized content',
      description: 'Use declared preferences for content selection.',
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
  ],
};

function decision(resourceKey: string) {
  return {
    resourceKey,
    attributes: { market: 'uk', affinity: 'travel' },
    consent: {
      grantedPurposes: ['personalization'],
      deniedPurposes: [],
      globalPrivacyControl: false,
    },
  };
}

describe('personalization HTTP workflow', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('isolates authorized drafts and preview from published anonymous edge decisions', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/personalization',
      headers: { ...headers, 'x-gridstory-roles': 'delivery' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['cache-control']).toBe('private, no-store');

    const saved = await server.inject({
      method: 'PUT',
      url: '/api/v1/personalization/draft',
      headers,
      payload: { expectedVersion: 0, configuration },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ version: 1, draft: { revision: 2 } });
    expect(saved.headers['cache-control']).toBe('private, no-store');

    const preview = await server.inject({
      method: 'POST',
      url: '/api/v1/personalization/preview',
      headers,
      payload: { ...decision('hero'), override: { variant: 'default' } },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      variant: 'default',
      reason: 'override',
      cache: { mode: 'no-store' },
    });
    expect(preview.json().trace[0]).toMatchObject({
      audienceId: 'travel-readers',
      matched: true,
    });

    const unpublished = await server.inject({
      method: 'POST',
      url: '/api/v1/personalization/decide',
      headers: {
        'content-type': 'application/json',
        'x-gridstory-tenant': headers['x-gridstory-tenant'],
      },
      payload: decision('hero'),
    });
    expect(unpublished.statusCode).toBe(404);

    const published = await server.inject({
      method: 'POST',
      url: '/api/v1/personalization/publish',
      headers,
      payload: { expectedVersion: 1, expectedDraftRevision: 2 },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ version: 2, published: { revision: 2 } });

    const decided = await server.inject({
      method: 'POST',
      url: '/api/v1/personalization/decide',
      headers: {
        'content-type': 'application/json',
        'x-gridstory-tenant': headers['x-gridstory-tenant'],
        'x-gridstory-environment': 'production',
        'sec-gpc': '1',
      },
      payload: decision('hero'),
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.headers['cache-control']).toBe('private, no-store');
    expect(decided.json()).toMatchObject({
      variant: 'uk',
      publishedRevision: 2,
      cache: { mode: 'private', inputs: ['affinity', 'market'] },
    });
    expect(decided.json()).not.toHaveProperty('audienceId');
    expect(decided.json().cache).not.toHaveProperty('key');

    const shared = await server.inject({
      method: 'POST',
      url: '/api/v1/personalization/decide',
      headers: {
        'content-type': 'application/json',
        'x-gridstory-tenant': headers['x-gridstory-tenant'],
        'x-gridstory-environment': 'production',
      },
      payload: {
        resourceKey: 'banner',
        attributes: { market: 'uk' },
        consent: { grantedPurposes: [], deniedPurposes: [], globalPrivacyControl: false },
      },
    });
    expect(shared.json()).toMatchObject({
      variant: 'uk',
      cache: {
        mode: 'shared',
        key: expect.stringMatching(
          /^gridstory-personalization-v1:[a-f0-9]{64}:r2:banner:[a-f0-9]{64}$/,
        ),
      },
    });
    expect(shared.headers['cache-control']).toBe('private, no-store');

    const otherTenant = await server.inject({
      method: 'POST',
      url: '/api/v1/personalization/decide',
      headers: { 'content-type': 'application/json', 'x-gridstory-tenant': 'other-tenant' },
      payload: decision('hero'),
    });
    expect(otherTenant.statusCode).toBe(404);
  });
});
