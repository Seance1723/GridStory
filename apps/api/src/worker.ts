import {
  ConfiguredPlacementAdapter,
  ContentGovernanceProcessor,
  ContentQualityService,
  type ContentRepository,
  ContentService,
  type DueWorkflowExecution,
  EnterpriseIdentityService,
  type GovernanceRepository,
  GovernanceService,
  IdentityGovernanceProcessor,
  type IdentityRepository,
  OperationsService,
  PostgresContentRepository,
  PostgresGovernanceRepository,
  PostgresIdentityRepository,
  PostgresReleaseRepository,
  PostgresWorkflowRepository,
  type ReleaseRepository,
  ReleaseService,
  SearchService,
  SqliteContentRepository,
  SqliteGovernanceRepository,
  SqliteIdentityRepository,
  SqliteReleaseRepository,
  SqliteWorkflowRepository,
  type WorkflowRepository,
  WorkflowService,
} from '@gridstory/core';
import { componentManifests, pageSchema } from '@gridstory/example-kit/manifests';
import { loadConfig } from './config.js';
import { defaultPageQualityPolicies, defaultWorkflowDefinitions } from './defaults.js';
import { createGracefulShutdownController, installShutdownSignals } from './graceful-shutdown.js';
import { startObservability } from './observability.js';
import { runWorkerLoop } from './worker-loop.js';

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
const governanceRepository: GovernanceRepository = config.databaseUrl
  ? new PostgresGovernanceRepository({ connectionString: config.databaseUrl })
  : new SqliteGovernanceRepository({ filename: config.databasePath });
const identityRepository: IdentityRepository = config.databaseUrl
  ? new PostgresIdentityRepository({ connectionString: config.databaseUrl })
  : new SqliteIdentityRepository({ filename: config.databasePath });
const identity = new EnterpriseIdentityService({ repository: identityRepository });
const governance = new GovernanceService({
  repository: governanceRepository,
  placementAdapter: new ConfiguredPlacementAdapter({
    content: config.dataRegions,
    asset: config.dataRegions,
    identity: config.dataRegions,
    plugin: config.dataRegions,
  }),
  telemetry: observability.tenantTelemetry,
});
governance.registerProcessor(new ContentGovernanceProcessor({ repository }));
governance.registerProcessor(new IdentityGovernanceProcessor(identity));
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
  governanceGate: governance,
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

const stopController = new AbortController();
const workerRun = runWorkerLoop({
  signal: stopController.signal,
  intervalMs: config.workerIntervalMs,
  cycle: async () => {
    const operationalScopes = await operations.listOperationalScopes(1000);
    const governanceScopes = await governance.listScopes();
    const scopes = [...operationalScopes, ...governanceScopes].filter(
      (scope, index, all) =>
        all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(scope)) === index,
    );
    for (const scope of scopes) {
      if (stopController.signal.aborted) break;
      const { dueReleases, due, result, governed } = await observability.runWorkerScope(
        scope,
        async () => ({
          dueReleases: await releases.processDue(scope),
          due: await workflows.processDue({ scope, execute: executeWorkflowSchedule }),
          result: await operations.drain({
            scope,
            workerId: `operations-${process.pid}`,
            limit: 100,
          }),
          governed: await governance.processApprovedPlans(scope, `governance-${process.pid}`),
        }),
      );
      if (
        dueReleases.executed +
          dueReleases.failed +
          due.escalated +
          due.executed +
          due.failed +
          result.claimedOutbox +
          result.claimedJobs +
          governed.claimed >
        0
      ) {
        console.log(
          JSON.stringify({
            scope,
            releases: dueReleases,
            workflow: due,
            operations: result,
            governance: governed,
          }),
        );
      }
    }
  },
});
let workerError: unknown;
const workerSettled = workerRun.catch((error: unknown) => {
  workerError = error;
});
let cleanup: Promise<void> | undefined;
const closeWorker = () => {
  stopController.abort();
  cleanup ??= (async () => {
    await workerSettled;
    const failures: unknown[] = [];
    for (const finalize of [
      () => repository.close(),
      () => workflowRepository.close(),
      () => releaseRepository.close(),
      () => governanceRepository.close(),
      () => identityRepository.close(),
      () => observability.shutdown(),
    ]) {
      try {
        await finalize();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Worker finalization failed.');
  })();
  return cleanup;
};
const shutdown = createGracefulShutdownController({
  timeoutMs: config.shutdownTimeoutMs,
  onShutdown: closeWorker,
  logger: {
    info: (fields, message) => console.log(JSON.stringify({ level: 'info', ...fields, message })),
    error: (fields, message) =>
      console.error(JSON.stringify({ level: 'error', signal: fields.signal, message })),
  },
  forceExit: (code) => process.exit(code),
  setExitCode: (code) => {
    if (process.exitCode === undefined || code !== 0) process.exitCode = code;
  },
});
const removeSignalHandlers = installShutdownSignals(process, shutdown);

try {
  await workerSettled;
  if (workerError !== undefined) {
    console.error(workerError);
    process.exitCode = 1;
  }
} finally {
  await closeWorker();
  removeSignalHandlers();
}
