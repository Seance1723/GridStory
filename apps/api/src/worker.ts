import {
  ContentQualityService,
  ContentService,
  OperationsService,
  PostgresContentRepository,
  PostgresWorkflowRepository,
  SqliteContentRepository,
  SqliteWorkflowRepository,
  WorkflowService,
  type ContentRepository,
  type DueWorkflowExecution,
  type WorkflowRepository,
} from '@gridstory/core';
import { componentManifests, pageSchema } from '@gridstory/example-kit/manifests';
import { loadConfig } from './config.js';
import { defaultPageQualityPolicies, defaultWorkflowDefinitions } from './defaults.js';

const config = loadConfig();
const repository: ContentRepository = config.databaseUrl
  ? new PostgresContentRepository({ connectionString: config.databaseUrl })
  : new SqliteContentRepository({ filename: config.databasePath });
const workflowRepository: WorkflowRepository = config.databaseUrl
  ? new PostgresWorkflowRepository({ connectionString: config.databaseUrl })
  : new SqliteWorkflowRepository({ filename: config.databasePath });
const workflows = new WorkflowService({
  repository: workflowRepository,
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
const operations = new OperationsService({
  repository,
  webhookSigningSecret: config.webhookSigningSecret,
  ...(config.allowedWebhookHosts ? { allowedWebhookHosts: config.allowedWebhookHosts } : {}),
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
      const due = await workflows.processDue({ scope, execute: executeWorkflowSchedule });
      const result = await operations.drain({
        scope,
        workerId: `operations-${process.pid}`,
        limit: 100,
      });
      if (
        due.escalated + due.executed + due.failed + result.claimedOutbox + result.claimedJobs >
        0
      ) {
        console.log(JSON.stringify({ scope, workflow: due, operations: result }));
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
}
