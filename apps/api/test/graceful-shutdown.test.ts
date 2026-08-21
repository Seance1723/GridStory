import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGracefulShutdownController,
  installShutdownSignals,
} from '../src/graceful-shutdown.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('graceful shutdown', () => {
  afterEach(() => vi.useRealTimers());

  it('runs cleanup once and sets a successful exit code after it drains', async () => {
    const drain = deferred();
    const onShutdown = vi.fn(() => drain.promise);
    const forceExit = vi.fn();
    const setExitCode = vi.fn();
    const controller = createGracefulShutdownController({
      timeoutMs: 1_000,
      onShutdown,
      logger: { info: vi.fn(), error: vi.fn() },
      forceExit,
      setExitCode,
    });

    const stopping = controller.request('SIGTERM');
    expect(controller.state()).toBe('stopping');
    expect(onShutdown).toHaveBeenCalledTimes(1);
    drain.resolve();
    await stopping;

    expect(controller.state()).toBe('stopped');
    expect(setExitCode).toHaveBeenCalledWith(0);
    expect(forceExit).not.toHaveBeenCalled();
  });

  it('forces a non-zero exit on a second signal or deadline breach', async () => {
    vi.useFakeTimers();
    const secondDrain = deferred();
    const secondForce = vi.fn();
    const second = createGracefulShutdownController({
      timeoutMs: 1_000,
      onShutdown: () => secondDrain.promise,
      logger: { info: vi.fn(), error: vi.fn() },
      forceExit: secondForce,
      setExitCode: vi.fn(),
    });
    const firstRequest = second.request('SIGTERM');
    await second.request('SIGINT');
    expect(second.state()).toBe('forced');
    expect(secondForce).toHaveBeenCalledWith(1);
    secondDrain.resolve();
    await firstRequest;

    const timeoutForce = vi.fn();
    const timeout = createGracefulShutdownController({
      timeoutMs: 250,
      onShutdown: () => new Promise(() => undefined),
      logger: { info: vi.fn(), error: vi.fn() },
      forceExit: timeoutForce,
      setExitCode: vi.fn(),
    });
    const timed = timeout.request('SIGTERM');
    await vi.advanceTimersByTimeAsync(250);
    await timed;
    expect(timeout.state()).toBe('forced');
    expect(timeoutForce).toHaveBeenCalledWith(1);

    const failureForce = vi.fn();
    const failed = createGracefulShutdownController({
      timeoutMs: 250,
      onShutdown: async () => {
        throw new Error('finalizer failed');
      },
      logger: { info: vi.fn(), error: vi.fn() },
      forceExit: failureForce,
      setExitCode: vi.fn(),
    });
    await failed.request('SIGTERM');
    expect(failed.state()).toBe('forced');
    expect(failureForce).toHaveBeenCalledWith(1);
  });

  it('installs and removes both process signal listeners', async () => {
    const signals = new EventEmitter();
    const controller = {
      state: () => 'running' as const,
      request: vi.fn(async () => undefined),
    };
    const remove = installShutdownSignals(signals, controller);
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    expect(controller.request).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(controller.request).toHaveBeenNthCalledWith(2, 'SIGINT');
    remove();
    signals.emit('SIGTERM');
    expect(controller.request).toHaveBeenCalledTimes(2);
  });
});
