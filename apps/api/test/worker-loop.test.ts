import { describe, expect, it, vi } from 'vitest';
import { runWorkerLoop } from '../src/worker-loop.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('worker loop', () => {
  it('finishes the current durable cycle but starts no new cycle after abort', async () => {
    const controller = new AbortController();
    const cycle = deferred();
    const runCycle = vi.fn(() => cycle.promise);
    const running = runWorkerLoop({
      signal: controller.signal,
      intervalMs: 60_000,
      cycle: runCycle,
    });
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    controller.abort();
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    cycle.resolve();
    await running;
    expect(runCycle).toHaveBeenCalledTimes(1);
  });

  it('interrupts the polling wait immediately', async () => {
    const controller = new AbortController();
    const runCycle = vi.fn(async () => undefined);
    const running = runWorkerLoop({
      signal: controller.signal,
      intervalMs: 60_000,
      cycle: runCycle,
    });
    await vi.waitFor(() => expect(runCycle).toHaveBeenCalledTimes(1));
    controller.abort();
    await running;
    expect(runCycle).toHaveBeenCalledTimes(1);
  });
});
