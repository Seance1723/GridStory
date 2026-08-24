import { type FleetObservationAdapter, GridStoryError } from '@gridstory/core';
import { resourceLimits } from '@gridstory/schema';

export interface HttpGridStoryFleetObserverOptions {
  id: string;
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  observationLifetimeSeconds?: number;
  now?: () => Date;
}

function unavailable(): GridStoryError {
  return new GridStoryError(
    'Fleet observation target is unavailable.',
    'fleet_observation_unavailable',
    502,
  );
}

export class HttpGridStoryFleetObserver implements FleetObservationAdapter {
  readonly id: string;
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #observationLifetimeSeconds: number;
  readonly #now: () => Date;

  constructor(options: HttpGridStoryFleetObserverOptions) {
    this.id = options.id.trim();
    if (!this.id) throw new Error('Fleet observer ID is required.');
    const baseUrl = new URL(options.baseUrl);
    if (
      baseUrl.protocol !== 'https:' ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.pathname !== '/' ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new Error('Fleet observer base URL must be a credential-free HTTPS origin.');
    }
    this.#baseUrl = baseUrl;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (
      !Number.isInteger(this.#timeoutMs) ||
      this.#timeoutMs < resourceLimits.fleet.minimumObservationTimeoutMs ||
      this.#timeoutMs > resourceLimits.fleet.maximumObservationTimeoutMs
    ) {
      throw new Error('Fleet observer timeout is outside the reviewed resource limits.');
    }
    this.#observationLifetimeSeconds = options.observationLifetimeSeconds ?? 300;
    if (
      !Number.isInteger(this.#observationLifetimeSeconds) ||
      this.#observationLifetimeSeconds < 1 ||
      this.#observationLifetimeSeconds > resourceLimits.fleet.maximumObservationLifetimeSeconds
    ) {
      throw new Error('Fleet observation lifetime is outside the reviewed resource limits.');
    }
    this.#now = options.now ?? (() => new Date());
  }

  async #read(path: string, signal: AbortSignal): Promise<unknown> {
    const url = new URL(path, this.#baseUrl);
    if (url.origin !== this.#baseUrl.origin) throw unavailable();
    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]),
        headers: { accept: 'application/json, application/schema+json' },
      });
      if (
        !response.ok ||
        (response.url !== '' && new URL(response.url).origin !== this.#baseUrl.origin)
      ) {
        throw unavailable();
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > resourceLimits.fleet.maximumObservationBytes
      ) {
        throw unavailable();
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > resourceLimits.fleet.maximumObservationBytes) throw unavailable();
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw unavailable();
    }
  }

  async observe(input: { signal: AbortSignal }): Promise<unknown> {
    const [discovery, health, readiness] = await Promise.all([
      this.#read('/api/v1/interoperability', input.signal),
      this.#read('/health', input.signal),
      this.#read('/ready', input.signal),
    ]);
    const observedAt = this.#now();
    return {
      discovery,
      health,
      readiness,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(
        observedAt.getTime() + this.#observationLifetimeSeconds * 1_000,
      ).toISOString(),
    };
  }
}
