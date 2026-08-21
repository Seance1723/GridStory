export async function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, durationMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export async function runWorkerLoop({
  signal,
  intervalMs,
  cycle,
}: {
  signal: AbortSignal;
  intervalMs: number;
  cycle: () => Promise<void>;
}): Promise<void> {
  while (!signal.aborted) {
    await cycle();
    if (!signal.aborted) await abortableDelay(intervalMs, signal);
  }
}
