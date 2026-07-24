import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();
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
});

const shutdown = async (signal: string) => {
  server.log.info({ signal }, 'Stopping GridStory API');
  await server.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
