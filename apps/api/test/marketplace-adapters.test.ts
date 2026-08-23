import { describe, expect, it } from 'vitest';
import { NodeDnsMarketplaceDomainVerifier } from '../src/marketplace-adapters.js';

describe('NodeDnsMarketplaceDomainVerifier', () => {
  it('accepts only an exact TXT value while joining DNS character-string segments', async () => {
    const verifier = new NodeDnsMarketplaceDomainVerifier({
      resolver: {
        async resolveTxt(hostname) {
          expect(hostname).toBe('_gridstory-verification.example.com');
          return [['unrelated=value'], ['gridstory-verification=', 'exact-token']];
        },
      },
    });
    await expect(
      verifier.hasTxtRecord({
        recordName: '_gridstory-verification.example.com',
        token: 'gridstory-verification=exact-token',
      }),
    ).resolves.toBe(true);
    await expect(
      verifier.hasTxtRecord({
        recordName: '_gridstory-verification.example.com',
        token: 'exact-token',
      }),
    ).resolves.toBe(false);
  });

  it('fails closed on resolver errors and bounded timeouts without exposing DNS details', async () => {
    const unavailable = new NodeDnsMarketplaceDomainVerifier({
      resolver: {
        async resolveTxt() {
          throw new Error('private resolver details');
        },
      },
    });
    await expect(
      unavailable.hasTxtRecord({ recordName: 'example.com', token: 'token' }),
    ).resolves.toBe(false);

    const timedOut = new NodeDnsMarketplaceDomainVerifier({
      resolver: { resolveTxt: () => new Promise<string[][]>(() => undefined) },
      timeoutMs: 5,
    });
    await expect(
      timedOut.hasTxtRecord({ recordName: 'example.com', token: 'token' }),
    ).rejects.toMatchObject({ code: 'marketplace_domain_lookup_timeout', statusCode: 504 });
  });
});
