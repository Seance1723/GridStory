import { describe, expect, it } from 'vitest';
import { contentQualityPolicySchema } from '../src/index.js';

describe('content quality policies', () => {
  it('resolves deterministic defaults for serializable publish policy', () => {
    const policy = contentQualityPolicySchema.parse({
      id: 'page-web',
      contentType: 'page',
    });

    expect(policy.channels).toEqual(['web']);
    expect(policy.seo).toMatchObject({ titleMinLength: 15, titleMaxLength: 60 });
    expect(policy.accessibility.requireImageAlt).toBe(true);
    expect(policy.links).toEqual({ requirePublishedReferences: true, checkExternal: false });
    expect(policy.gate).toEqual({ blockedSeverities: ['error'], minimumScore: 0 });
  });

  it('rejects invalid gate thresholds and empty channels', () => {
    expect(
      contentQualityPolicySchema.safeParse({
        id: 'invalid',
        contentType: 'page',
        channels: [],
        gate: { minimumScore: 101 },
      }).success,
    ).toBe(false);
  });
});
