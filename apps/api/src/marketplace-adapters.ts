import { resolveTxt } from 'node:dns/promises';
import { GridStoryError, type MarketplaceDomainVerifier } from '@gridstory/core';

interface TxtResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
}

export class NodeDnsMarketplaceDomainVerifier implements MarketplaceDomainVerifier {
  readonly #resolver: TxtResolver;
  readonly #timeoutMs: number;

  constructor(options: { resolver?: TxtResolver; timeoutMs?: number } = {}) {
    this.#resolver = options.resolver ?? { resolveTxt };
    this.#timeoutMs = options.timeoutMs ?? 5_000;
  }

  async hasTxtRecord(input: { recordName: string; token: string }): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const records = await Promise.race([
        this.#resolver.resolveTxt(input.recordName),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new GridStoryError(
                  'Publisher domain lookup timed out.',
                  'marketplace_domain_lookup_timeout',
                  504,
                ),
              ),
            this.#timeoutMs,
          );
        }),
      ]);
      return records.some((segments) => segments.join('') === input.token);
    } catch (error) {
      if (error instanceof GridStoryError) throw error;
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
