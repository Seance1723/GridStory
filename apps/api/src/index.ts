import { loadConfig } from './config.js';
import { createGracefulShutdownController, installShutdownSignals } from './graceful-shutdown.js';
import { startObservability } from './observability.js';
import { buildServer } from './server.js';

const config = loadConfig();
const observability = startObservability(config.observability);
const server = await buildServer({
  databasePath: config.databasePath,
  ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
  allowedOrigins: config.allowedOrigins,
  cursorSecret: config.cursorSecret,
  previewSigningSecret: config.previewSigningSecret,
  assetDeliverySigningSecret: config.assetDeliverySigningSecret,
  allowedPreviewOrigins: config.allowedPreviewOrigins,
  locales: config.locales,
  webhookSigningSecret: config.webhookSigningSecret,
  ...(config.allowedWebhookHosts ? { allowedWebhookHosts: config.allowedWebhookHosts } : {}),
  seed: true,
  logger: true,
  observability,
  identity: config.identity,
});

const shutdown = createGracefulShutdownController({
  timeoutMs: config.shutdownTimeoutMs,
  onShutdown: async () => {
    const failures: unknown[] = [];
    try {
      await server.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await observability.shutdown();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, 'API finalization failed.');
  },
  logger: server.log,
  forceExit: (code) => process.exit(code),
  setExitCode: (code) => {
    if (process.exitCode === undefined || code !== 0) process.exitCode = code;
  },
});
const removeSignalHandlers = installShutdownSignals(process, shutdown);

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error(error);
  removeSignalHandlers();
  await Promise.allSettled([server.close(), observability.shutdown()]);
  process.exitCode = 1;
}
