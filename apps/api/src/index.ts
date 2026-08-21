import { loadConfig } from './config.js';
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
});

const shutdown = async (signal: string) => {
  server.log.info({ signal }, 'Stopping GridStory API');
  await server.close();
  await observability.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error(error);
  await observability.shutdown();
  process.exit(1);
}
