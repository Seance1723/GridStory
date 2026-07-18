import {
  OperationsService,
  PostgresContentRepository,
  SqliteContentRepository,
  type ContentRepository,
} from '@gridstory/core';
import { loadConfig } from './config.js';

const config = loadConfig();
const repository: ContentRepository = config.databaseUrl
  ? new PostgresContentRepository({ connectionString: config.databaseUrl })
  : new SqliteContentRepository({ filename: config.databasePath });
const operations = new OperationsService({
  repository,
  webhookSigningSecret: config.webhookSigningSecret,
  ...(config.allowedWebhookHosts ? { allowedWebhookHosts: config.allowedWebhookHosts } : {}),
});

let stopping = false;
const stop = () => {
  stopping = true;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  while (!stopping) {
    const scopes = await operations.listOperationalScopes(1000);
    for (const scope of scopes) {
      if (stopping) break;
      const result = await operations.drain({
        scope,
        workerId: `operations-${process.pid}`,
        limit: 100,
      });
      if (result.claimedOutbox + result.claimedJobs > 0) {
        console.log(JSON.stringify({ scope, ...result }));
      }
    }
    if (!stopping) {
      await new Promise<void>((resolve) => setTimeout(resolve, config.workerIntervalMs));
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await repository.close();
}
