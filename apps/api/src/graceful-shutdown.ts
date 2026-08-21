export type ShutdownSignal = 'SIGINT' | 'SIGTERM';
export type ShutdownState = 'running' | 'stopping' | 'stopped' | 'forced';

export interface ShutdownLogger {
  info(fields: { signal: ShutdownSignal }, message: string): void;
  error(fields: { signal: ShutdownSignal; error?: unknown }, message: string): void;
}

export interface ShutdownSignalSource {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

export interface GracefulShutdownController {
  state(): ShutdownState;
  request(signal: ShutdownSignal): Promise<void>;
}

class ShutdownTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Graceful shutdown exceeded ${timeoutMs}ms.`);
  }
}

export function createGracefulShutdownController({
  timeoutMs,
  onShutdown,
  logger,
  forceExit,
  setExitCode,
}: {
  timeoutMs: number;
  onShutdown: (signal: ShutdownSignal) => Promise<void>;
  logger: ShutdownLogger;
  forceExit: (code: number) => void;
  setExitCode: (code: number) => void;
}): GracefulShutdownController {
  let shutdownState: ShutdownState = 'running';
  let shutdownPromise: Promise<void> | undefined;
  const currentState = (): ShutdownState => shutdownState;

  return {
    state: () => shutdownState,
    request(signal) {
      if (shutdownState === 'forced' || shutdownState === 'stopped') return Promise.resolve();
      if (shutdownState === 'stopping') {
        shutdownState = 'forced';
        logger.error({ signal }, 'A second signal forced GridStory shutdown');
        forceExit(1);
        return Promise.resolve();
      }

      shutdownState = 'stopping';
      logger.info({ signal }, 'Stopping GridStory gracefully');
      shutdownPromise = (async () => {
        let timeout: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            onShutdown(signal),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => reject(new ShutdownTimeoutError(timeoutMs)), timeoutMs);
            }),
          ]);
          if (currentState() === 'forced') return;
          shutdownState = 'stopped';
          setExitCode(0);
        } catch (error) {
          if (currentState() === 'forced') return;
          shutdownState = 'forced';
          logger.error({ signal, error }, 'Graceful GridStory shutdown failed');
          forceExit(1);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      })();
      return shutdownPromise;
    },
  };
}

export function installShutdownSignals(
  signalSource: ShutdownSignalSource,
  controller: GracefulShutdownController,
): () => void {
  const onInterrupt = () => void controller.request('SIGINT');
  const onTerminate = () => void controller.request('SIGTERM');
  signalSource.on('SIGINT', onInterrupt);
  signalSource.on('SIGTERM', onTerminate);
  return () => {
    signalSource.off('SIGINT', onInterrupt);
    signalSource.off('SIGTERM', onTerminate);
  };
}
