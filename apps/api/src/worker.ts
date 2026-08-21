import {
  ContentQualityService,
  ContentService,
  OperationsService,
  PostgresContentRepository,
  PostgresWorkflowRepository,
  SqliteContentRepository,
  SqliteWorkflowRepository,
  WorkflowService,
  ReleaseService,
  SearchService,
  PostgresReleaseRepository,
  SqliteReleaseRepository,
  type ContentRepository,
  type DueWorkflowExecution,
  type WorkflowRepository,
  type ReleaseRepository,
} from '@gridstory/core';
import { componentManifests, pageSchema } from '@gridstory/example-kit/manifests';
import { loadConfig } from './config.js';
import { defaultPageQualityPolicies, defaultWorkflowDefinitions } from './defaults.js';
import { startObservability } from './observability.js';

const config = loadConfig();
const observability = startObservability(config.observability);
const repository: ContentRepository = config.databaseUrl
  ? new PostgresContentRepository({ connectionString: config.databaseUrl })
  : new SqliteContentRepository({ filename: config.databasePath });
const workflowRepository: WorkflowRepository = config.databaseUrl
  ? new PostgresWorkflowRepository({ connectionString: config.databaseUrl })
  : new SqliteWorkflowRepository({ filename: config.databasePath });
const releaseRepository: ReleaseRepository = config.databaseUrl
  ? new PostgresReleaseRepository({ connectionString: config.databaseUrl })
  : new SqliteReleaseRepository({ filename: config.databasePath });
const workflows = new WorkflowService({
  repository: workflowRepository,
  jobRepository: repository,
  defaultDefinitions: defaultWorkflowDefinitions,
});
const quality = new ContentQualityService({
  repository,
  schemas: [pageSchema],
  policies: defaultPageQualityPolicies,
});
const content = new ContentService({
  repository,
  schemas: [pageSchema],
  componentManifests,
  qualityGate: quality,
  workflowGate: workflows,
});
const releases = new ReleaseService({
  repository: releaseRepository,
  contentService: content,
});
const search = new SearchService({
  repository,
  schemas: [pageSchema],
  telemetry: observability.tenantTelemetry,
});
const operations = new OperationsService({
  repository,
  searchJobRunner: (job) => search.processJob(job),
  webhookSigningSecret: config.webhookSigningSecret,
  ...(config.allowedWebhookHosts ? { allowedWebhookHosts: config.allowedWebhookHosts } : {}),
  telemetry: observability.tenantTelemetry,
});

async function executeWorkflowSchedule({
  scope,
  instance,
  schedule,
}: DueWorkflowExecution): Promise<void> {
  const entry = await content.get({ scope, id: instance.entryId, perspective: 'draft' });
  const definition = await workflows.getDefinition(scope, instance.workflowId);
  const transition = definition.transitions.find(
    (candidate) => candidate.id === schedule.transitionId && candidate.from === instance.stateId,
  );
  if (!transition) throw new Error('The scheduled transition is no longer available.');
  const actor = { id: schedule.requestedBy, roles: schedule.requestedByRoles };
  const target = definition.states.find((state) => state.id === transition.to);
  if (target?.kind === 'published') {
    await content.publish({
      scope,
      id: entry.id,
      expectedRevisionId: schedule.revisionId,
      actor,
    });
    return;
  }
  await workflows.requestTransition({
    scope,
    entry,
    transitionId: transition.id,
    actor,
  });
}

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
      const { dueReleases, due, result } = await observability.runWorkerScope(scope, async () => ({
        dueReleases: await releases.processDue(scope),
        due: await workflows.processDue({ scope, execute: executeWorkflowSchedule }),
        result: await operations.drain({
          scope,
          workerId: `operations-${process.pid}`,
          limit: 100,
        }),
      }));
      if (
        dueReleases.executed +
          dueReleases.failed +
          due.escalated +
          due.executed +
          due.failed +
          result.claimedOutbox +
          result.claimedJobs >
        0
      ) {
        console.log(
          JSON.stringify({ scope, releases: dueReleases, workflow: due, operations: result }),
        );
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
  await workflowRepository.close();
  await releaseRepository.close();
  await observability.shutdown();
}
