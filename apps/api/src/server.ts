import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import cors from '@fastify/cors';
import {
  type AssetContentInspector,
  AssetDeliveryService,
  type AssetMalwareScanner,
  type AssetRenditionAdapter,
  type AssetRepository,
  AssetService,
  type AssetStorageAdapter,
  AuditService,
  AuthorizationPolicy,
  type CacheInvalidator,
  CollaborationService,
  ComponentLifecycleService,
  type ContentEventType,
  type ContentPerspective,
  ContentQualityService,
  ContentQueryService,
  type ContentRepository,
  ContentRoutingService,
  ContentService,
  contentCacheTags,
  type DueWorkflowExecution,
  type ExternalLinkChecker,
  GridStoryActions,
  GridStoryError,
  type ImportConflictPolicy,
  InMemoryAssetRepository,
  InMemoryAssetStorageAdapter,
  LocaleRegistry,
  LocalizationService,
  logicalArchiveFromUnknown,
  OperationsService,
  type PluginRepository,
  type PluginRuntimeAdapter,
  PluginService,
  PortabilityService,
  PostgresContentRepository,
  PostgresPluginRepository,
  PostgresReleaseRepository,
  PostgresWorkflowRepository,
  PreviewSessionService,
  parseLogicalArchive,
  type ReleaseRepository,
  ReleaseService,
  SchemaLifecycleService,
  type SearchAdapter,
  SearchService,
  SqliteAssetRepository,
  SqliteContentRepository,
  SqlitePluginRepository,
  SqliteReleaseRepository,
  SqliteWorkflowRepository,
  serializeAuditExport,
  serializeLogicalArchive,
  type TenantTelemetrySink,
  type TrustedPluginPublisher,
  type WebhookTransport,
  type WorkflowRepository,
  WorkflowService,
} from '@gridstory/core';
import { exampleDesignSystem } from '@gridstory/example-kit/design-system';
import { componentManifests, pageSchema, welcomePage } from '@gridstory/example-kit/manifests';
import {
  assetRenditionPresetSchema,
  type ContentQualityPolicy,
  collaborationTargetSchema,
  completeAssetUploadSchema,
  createAssetDeliverySchema,
  generatedTypesFingerprint,
  type LocaleConfiguration,
  type ParsedSearchQuery,
  type PluginCapabilityGrant,
  type PluginCapabilityName,
  pluginCapabilityGrantSchema,
  pluginCapabilityNameSchema,
  previewMessageSchema,
  type RedirectDefinition,
  type ReleaseInput,
  releaseInputSchema,
  type SchemaIrDocument,
  type SignedPluginManifest,
  schemaIrDocumentSchema,
  schemaIrFingerprint,
  schemaIrToVisualModel,
  searchQuerySchema,
  signedPluginManifestSchema,
  startAssetUploadSchema,
  updateAssetSchema,
  visualModelDocumentSchema,
  visualModelToSchemaIr,
  type WorkflowDefinitionInput,
  workflowDefinitionInputSchema,
} from '@gridstory/schema';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { parseContentQuery } from './content-query.js';
import { defaultPageQualityPolicies, defaultWorkflowDefinitions } from './defaults.js';
import { registerGridStoryGraphql } from './graphql.js';
import { authorize, contentScope, requestContext } from './request-context.js';

export interface BuildServerOptions {
  databasePath?: string;
  databaseUrl?: string;
  allowedOrigins?: string[];
  seed?: boolean;
  logger?: boolean;
  redirects?: RedirectDefinition[];
  cursorSecret?: string;
  locales?: LocaleConfiguration[];
  webhookSigningSecret?: string;
  webhookTransport?: WebhookTransport;
  cacheInvalidator?: CacheInvalidator;
  allowedWebhookHosts?: string[];
  previewSigningSecret?: string;
  allowedPreviewOrigins?: string[];
  qualityPolicies?: ContentQualityPolicy[];
  externalLinkChecker?: ExternalLinkChecker;
  assetRepository?: AssetRepository;
  workflowRepository?: WorkflowRepository;
  releaseRepository?: ReleaseRepository;
  pluginRepository?: PluginRepository;
  pluginRuntime?: PluginRuntimeAdapter;
  trustedPluginPublishers?: TrustedPluginPublisher[];
  searchAdapter?: SearchAdapter;
  assetStorage?: AssetStorageAdapter;
  assetRenditionAdapter?: AssetRenditionAdapter;
  assetContentInspector?: AssetContentInspector;
  assetMalwareScanner?: AssetMalwareScanner;
  assetDeliverySigningSecret?: string;
  tenantTelemetry?: TenantTelemetrySink;
}

interface RequestBody {
  contentType?: unknown;
  expectedRevisionId?: unknown;
  data?: unknown;
  candidate?: unknown;
  expectedPlanId?: unknown;
  approved?: unknown;
  locale?: unknown;
  url?: unknown;
  eventTypes?: unknown;
  active?: unknown;
  limit?: unknown;
  previewUrl?: unknown;
  route?: unknown;
  mode?: unknown;
  entryId?: unknown;
  ttlSeconds?: unknown;
  body?: unknown;
  mentions?: unknown;
  assigneeId?: unknown;
  dueAt?: unknown;
  resolved?: unknown;
  displayName?: unknown;
  field?: unknown;
  nodeId?: unknown;
  target?: unknown;
  channel?: unknown;
  transitionId?: unknown;
  changedFields?: unknown;
  decision?: unknown;
  comment?: unknown;
  runAt?: unknown;
  timeZone?: unknown;
  name?: unknown;
  entries?: unknown;
  rollbackPolicy?: unknown;
  reason?: unknown;
  perspective?: unknown;
  manifest?: unknown;
  artifactDigest?: unknown;
  grantedCapabilities?: unknown;
  operation?: unknown;
  capability?: unknown;
  input?: unknown;
}

function perspective(value: unknown): ContentPerspective {
  if (value === undefined || value === 'draft') return 'draft';
  if (value === 'published') return 'published';
  throw new GridStoryError('Perspective must be draft or published.', 'invalid_perspective', 400);
}

function parsedSearchQuery(value: unknown): ParsedSearchQuery {
  const parsed = searchQuerySchema.safeParse(value);
  if (!parsed.success) {
    throw new GridStoryError('Search query is invalid.', 'invalid_search', 400, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GridStoryError(`${name} is required.`, 'invalid_request', 400);
  }
  return value;
}

function boundedLimit(value: unknown, fallback = 100): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(parsed) || (parsed as number) < 1 || (parsed as number) > 1000) {
    throw new GridStoryError(
      'limit must be an integer between 1 and 1000.',
      'invalid_request',
      400,
    );
  }
  return parsed as number;
}

function webhookEventTypes(value: unknown): ContentEventType[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new GridStoryError('eventTypes must be an array of event names.', 'invalid_request', 400);
  }
  return value as ContentEventType[];
}

function booleanQuery(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new GridStoryError('Boolean query values must be true or false.', 'invalid_request', 400);
}

function conflictPolicy(value: unknown): ImportConflictPolicy {
  if (value === undefined || value === 'reject') return 'reject';
  if (value === 'skip' || value === 'replace') return value;
  throw new GridStoryError(
    'conflictPolicy must be reject, skip, or replace.',
    'invalid_request',
    400,
  );
}

function setCacheTags(
  reply: FastifyReply,
  entries: Array<Parameters<typeof contentCacheTags>[0]>,
): void {
  reply.header(
    'cache-tag',
    [...new Set(entries.flatMap((entry) => contentCacheTags(entry)))].join(','),
  );
}

function bodyOf(request: FastifyRequest): RequestBody {
  if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
    throw new GridStoryError('A JSON request body is required.', 'invalid_request', 400);
  }
  return request.body as RequestBody;
}

function candidateDocument(value: unknown, fallback: SchemaIrDocument): SchemaIrDocument {
  if (value === undefined) return fallback;
  const parsed = schemaIrDocumentSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const visual = visualModelDocumentSchema.safeParse(value);
  if (visual.success) return visualModelToSchemaIr(visual.data);
  throw new GridStoryError(
    'Candidate schema IR or visual model is invalid.',
    'invalid_schema_ir',
    400,
    {
      issues: parsed.error.issues,
    },
  );
}

function workflowDefinition(value: unknown): WorkflowDefinitionInput {
  const parsed = workflowDefinitionInputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError('Workflow definition is invalid.', 'invalid_workflow_definition', 400, {
    issues: parsed.error.issues,
  });
}

function releaseDefinition(value: unknown): ReleaseInput {
  const parsed = releaseInputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError('Release definition is invalid.', 'invalid_release', 400, {
    issues: parsed.error.issues,
  });
}

function pluginManifest(value: unknown): SignedPluginManifest {
  const parsed = signedPluginManifestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError('Plugin manifest is invalid.', 'invalid_plugin_manifest', 400, {
    issues: parsed.error.issues,
  });
}

function pluginGrants(value: unknown): PluginCapabilityGrant[] {
  if (!Array.isArray(value)) {
    throw new GridStoryError('grantedCapabilities must be an array.', 'invalid_plugin_grants', 400);
  }
  const parsed = pluginCapabilityGrantSchema.array().safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError('Plugin capability grants are invalid.', 'invalid_plugin_grants', 400, {
    issues: parsed.error.issues,
  });
}

function pluginCapability(value: unknown): PluginCapabilityName {
  const parsed = pluginCapabilityNameSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError('Plugin capability is invalid.', 'invalid_plugin_capability', 400);
}
export async function buildServer({
  databasePath = '.gridstory/gridstory.db',
  databaseUrl,
  allowedOrigins = ['http://localhost:5173', 'http://localhost:5174'],
  seed = true,
  logger = false,
  redirects = [],
  cursorSecret = 'gridstory-local-cursor-secret-change-me',
  locales = [
    {
      code: 'en',
      siteId: 'default',
      label: 'English',
      default: true,
      enabled: true,
      required: true,
      routePrefix: '',
    },
  ],
  webhookSigningSecret = 'gridstory-local-webhook-signing-secret-change-me',
  webhookTransport,
  cacheInvalidator,
  allowedWebhookHosts,
  previewSigningSecret = 'gridstory-local-preview-signing-secret-change-me',
  allowedPreviewOrigins = ['http://localhost:5174', 'http://127.0.0.1:5174'],
  qualityPolicies = defaultPageQualityPolicies,

  externalLinkChecker,
  assetRepository,
  workflowRepository,
  releaseRepository,
  pluginRepository,
  pluginRuntime,
  trustedPluginPublishers = [],
  searchAdapter,
  assetStorage = new InMemoryAssetStorageAdapter(),
  assetRenditionAdapter,
  assetContentInspector,
  assetMalwareScanner,
  assetDeliverySigningSecret = 'gridstory-local-asset-delivery-secret-change-me',
  tenantTelemetry,
}: BuildServerOptions): Promise<FastifyInstance> {
  if (!databaseUrl && databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }
  const repository: ContentRepository = databaseUrl
    ? new PostgresContentRepository({ connectionString: databaseUrl })
    : new SqliteContentRepository({ filename: databasePath });
  const resolvedAssetRepository: AssetRepository =
    assetRepository ??
    (databaseUrl
      ? new InMemoryAssetRepository()
      : new SqliteAssetRepository({ filename: databasePath }));
  const resolvedWorkflowRepository: WorkflowRepository =
    workflowRepository ??
    (databaseUrl
      ? new PostgresWorkflowRepository({ connectionString: databaseUrl })
      : new SqliteWorkflowRepository({ filename: databasePath }));
  const resolvedReleaseRepository: ReleaseRepository =
    releaseRepository ??
    (databaseUrl
      ? new PostgresReleaseRepository({ connectionString: databaseUrl })
      : new SqliteReleaseRepository({ filename: databasePath }));
  const resolvedPluginRepository: PluginRepository =
    pluginRepository ??
    (databaseUrl
      ? new PostgresPluginRepository({ connectionString: databaseUrl })
      : new SqlitePluginRepository({ filename: databasePath }));
  const workflows = new WorkflowService({
    repository: resolvedWorkflowRepository,
    jobRepository: repository,
    defaultDefinitions: defaultWorkflowDefinitions,
  });
  const quality = new ContentQualityService({
    repository,
    schemas: [pageSchema],
    policies: qualityPolicies,
    ...(externalLinkChecker ? { externalLinkChecker } : {}),
  });
  const service = new ContentService({
    repository,
    schemas: [pageSchema],
    componentManifests,
    qualityGate: quality,
    workflowGate: workflows,
  });
  const releases = new ReleaseService({
    repository: resolvedReleaseRepository,
    contentService: service,
  });
  const plugins = new PluginService({
    repository: resolvedPluginRepository,
    trustedPublishers: trustedPluginPublishers,
    ...(pluginRuntime ? { runtime: pluginRuntime } : {}),
  });
  const executeWorkflowSchedule = async ({
    scope,
    instance,
    schedule,
  }: DueWorkflowExecution): Promise<void> => {
    const entry = await service.get({ scope, id: instance.entryId, perspective: 'draft' });
    const definition = await workflows.getDefinition(scope, instance.workflowId);
    const transition = definition.transitions.find(
      (candidate) => candidate.id === schedule.transitionId && candidate.from === instance.stateId,
    );
    if (!transition) {
      throw new GridStoryError(
        'The scheduled transition is no longer available from the current state.',
        'workflow_transition_unavailable',
        409,
      );
    }
    const actor = { id: schedule.requestedBy, roles: schedule.requestedByRoles };
    const target = definition.states.find((state) => state.id === transition.to);
    if (target?.kind === 'published') {
      await service.publish({
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
  };
  const assets = new AssetService({
    storage: assetStorage,
    contentService: service,
    repository: resolvedAssetRepository,
    ...(assetRenditionAdapter ? { renditionAdapter: assetRenditionAdapter } : {}),
    ...(assetContentInspector ? { contentInspector: assetContentInspector } : {}),
    ...(assetMalwareScanner ? { malwareScanner: assetMalwareScanner } : {}),
    ...(tenantTelemetry ? { telemetry: tenantTelemetry } : {}),
  });
  const assetDeliveries = new AssetDeliveryService({
    signingSecret: assetDeliverySigningSecret,
  });
  const componentLifecycle = new ComponentLifecycleService({ contentService: service });
  const collaboration = new CollaborationService();
  const routing = new ContentRoutingService({ contentService: service, redirects });
  const contentQueries = new ContentQueryService({ repository, cursorSecret });
  const search = new SearchService({
    repository,
    schemas: [pageSchema],
    ...(searchAdapter ? { adapter: searchAdapter } : {}),
    ...(tenantTelemetry ? { telemetry: tenantTelemetry } : {}),
  });
  const localization = new LocalizationService({
    repository,
    contentService: service,
    locales: new LocaleRegistry(locales),
  });
  const operations = new OperationsService({
    repository,
    webhookSigningSecret,
    ...(webhookTransport ? { webhookTransport } : {}),
    ...(cacheInvalidator ? { cacheInvalidator } : {}),
    searchJobRunner: (job) => search.processJob(job),
    ...(allowedWebhookHosts ? { allowedWebhookHosts } : {}),
    ...(tenantTelemetry ? { telemetry: tenantTelemetry } : {}),
  });
  const portability = new PortabilityService({ repository });
  const audit = new AuditService({ repository });
  const previews = new PreviewSessionService({
    signingSecret: previewSigningSecret,
    allowedOrigins: allowedPreviewOrigins,
  });
  const lifecycle = new SchemaLifecycleService({
    repository,
    schemas: [pageSchema],
    componentManifests,
  });
  const policy = new AuthorizationPolicy();
  const server = Fastify({ logger });
  server.addContentTypeParser(
    'application/x-ndjson',
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );
  server.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );
  const seedScope = {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
  };

  await server.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by GridStory CORS policy.'), false);
    },
    allowedHeaders: [
      'authorization',
      'content-type',
      'x-gridstory-organization',
      'x-gridstory-tenant',
      'x-gridstory-workspace',
      'x-gridstory-site',
      'x-gridstory-environment',
      'x-gridstory-locale',
      'x-gridstory-actor',
      'x-gridstory-principal-type',
      'x-gridstory-roles',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  server.addHook('onClose', async () => {
    await repository.close();
    await resolvedAssetRepository.close?.();
    await resolvedWorkflowRepository.close();
    await resolvedReleaseRepository.close();
    await resolvedPluginRepository.close();
  });
  server.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/v1/delivery/')) {
      reply.header('cache-control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
      reply.header(
        'vary',
        [
          'x-gridstory-organization',
          'x-gridstory-tenant',
          'x-gridstory-workspace',
          'x-gridstory-site',
          'x-gridstory-environment',
          'x-gridstory-locale',
        ].join(', '),
      );
    } else if (request.url.startsWith('/api/') || request.url.startsWith('/graphql')) {
      reply.header('cache-control', 'private, no-store');
    }
    return payload;
  });

  server.setErrorHandler((error, request, reply) => {
    const known = error instanceof GridStoryError;
    const frameworkStatus =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const safeFrameworkError = !known && frameworkStatus >= 400 && frameworkStatus < 500;
    const statusCode = known ? error.statusCode : safeFrameworkError ? frameworkStatus : 500;
    const frameworkMessage = error instanceof Error ? error.message : 'The request is invalid.';
    if (statusCode >= 500) request.log.error(error);
    return reply.status(statusCode).send({
      error: {
        code: known ? error.code : safeFrameworkError ? 'invalid_request' : 'internal_error',
        message:
          known || safeFrameworkError
            ? frameworkMessage
            : 'An unexpected GridStory error occurred.',
        ...(known && error.details !== undefined ? { details: error.details } : {}),
        requestId: request.id,
      },
    });
  });

  server.get('/health', async () => ({ status: 'ok', service: 'gridstory-api' }));
  server.get('/ready', async (_request, reply) => {
    const drift = await lifecycle.drift(seedScope);
    return reply.status(drift.inSync ? 200 : 503).send({
      status: drift.inSync ? 'ready' : 'not_ready',
      ...(drift.inSync ? {} : { reason: 'schema_drift', drift }),
    });
  });
  server.get('/api/v1/context', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentRead, { kind: 'platform' });
    return context;
  });
  server.get('/api/v1/schemas', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.schemaRead, { kind: 'schema' });
    return service.getSchemas();
  });
  server.get('/api/v1/components', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.componentRead, { kind: 'component' });
    return componentLifecycle.catalog();
  });
  server.get('/api/v1/components/:id/usage', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.componentRead, {
      kind: 'component',
      id: params.id,
    });
    return componentLifecycle.usage(contentScope(context), params.id);
  });
  server.get('/api/v1/components/:id/migration', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.componentRead, {
      kind: 'component',
      id: params.id,
    });
    return componentLifecycle.planMigration(contentScope(context), params.id);
  });
  server.get('/api/v1/components/:id/visual-regression', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.componentRead, {
      kind: 'component',
      id: params.id,
    });
    return componentLifecycle.visualRegression(contentScope(context), params.id);
  });
  server.post('/api/v1/content/:id/components/:componentId/migrate', async (request) => {
    const params = request.params as { id: string; componentId: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentDraftUpdate, {
      kind: 'content',
      id: params.id,
    });
    return componentLifecycle.migrateEntry({
      scope: contentScope(context),
      entryId: params.id,
      componentId: params.componentId,
      expectedRevisionId: requiredString(body.expectedRevisionId, 'expectedRevisionId'),
      actor: { id: context.principal.id },
    });
  });
  server.get('/api/v1/design-system', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.componentRead, { kind: 'component' });
    return exampleDesignSystem;
  });
  server.get('/api/v1/assets', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetRead, { kind: 'asset' });
    return assets.list(contentScope(context));
  });
  server.post('/api/v1/assets/uploads', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetCreate, { kind: 'asset' });
    const parsed = startAssetUploadSchema.safeParse(bodyOf(request));
    if (!parsed.success) {
      throw new GridStoryError('Asset upload input is invalid.', 'invalid_asset_upload', 400, {
        issues: parsed.error.issues,
      });
    }
    const upload = await assets.startUpload({ scope: contentScope(context), asset: parsed.data });
    return reply.status(201).send(upload);
  });
  server.get('/api/v1/assets/uploads/:id', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetCreate, { kind: 'asset' });
    return assets.getUpload(contentScope(context), params.id);
  });
  server.put('/api/v1/assets/uploads/:id/parts/:partNumber', async (request) => {
    const params = request.params as { id: string; partNumber: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetCreate, { kind: 'asset' });
    const partNumber = Number(params.partNumber);
    if (!(request.body instanceof Uint8Array) || !Number.isInteger(partNumber) || partNumber < 1) {
      throw new GridStoryError(
        'A binary body and positive part number are required.',
        'invalid_asset_upload_part',
        400,
      );
    }
    return assets.uploadPart({
      scope: contentScope(context),
      uploadId: params.id,
      partNumber,
      body: request.body,
    });
  });
  server.post('/api/v1/assets/uploads/:id/complete', async (request, reply) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetCreate, { kind: 'asset' });
    const parsed = completeAssetUploadSchema.safeParse(bodyOf(request));
    if (!parsed.success) {
      throw new GridStoryError('Upload completion is invalid.', 'invalid_asset_upload', 400, {
        issues: parsed.error.issues,
      });
    }
    const asset = await assets.completeUpload({
      scope: contentScope(context),
      uploadId: params.id,
      parts: parsed.data.parts,
      actor: { id: context.principal.id },
    });
    return reply.status(201).send(asset);
  });
  server.delete('/api/v1/assets/uploads/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetCreate, { kind: 'asset' });
    await assets.abortUpload(contentScope(context), params.id);
    return reply.status(204).send();
  });
  server.post('/api/v1/assets/:id/delivery', async (request, reply) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetRead, { kind: 'asset', id: params.id });
    const parsed = createAssetDeliverySchema.safeParse(bodyOf(request));
    if (!parsed.success) {
      throw new GridStoryError('Asset delivery input is invalid.', 'invalid_asset_delivery', 400, {
        issues: parsed.error.issues,
      });
    }
    const { revision } = await assets.getDeliverableRevision(
      contentScope(context),
      params.id,
      parsed.data.revisionId,
    );
    const grant = assetDeliveries.create({
      scope: contentScope(context),
      assetId: params.id,
      revisionId: revision.id,
      ttlSeconds: parsed.data.ttlSeconds,
    });
    return reply.status(201).send(grant);
  });
  server.get('/api/v1/assets/:id/content', async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { token?: unknown };
    const token = requiredString(query.token, 'token');
    const claims = assetDeliveries.authenticate(token, params.id);
    const { revision, body } = await assets.readPrivateObject(claims, params.id, claims.revisionId);
    const dispositionFilename = encodeURIComponent(revision.original.filename).replaceAll(
      "'",
      '%27',
    );
    reply.header('content-type', revision.original.mediaType);
    reply.header('content-length', body.byteLength);
    reply.header('content-disposition', `inline; filename*=UTF-8''${dispositionFilename}`);
    reply.header('x-content-type-options', 'nosniff');
    if (revision.original.mediaType === 'image/svg+xml') {
      reply.header(
        'content-security-policy',
        "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      );
    }
    return reply.send(Buffer.from(body));
  });
  server.get('/api/v1/assets/:id', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetRead, { kind: 'asset', id: params.id });
    return assets.get(contentScope(context), params.id);
  });
  server.patch('/api/v1/assets/:id', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetUpdate, { kind: 'asset', id: params.id });
    const parsed = updateAssetSchema.safeParse(bodyOf(request));
    if (!parsed.success) {
      throw new GridStoryError('Asset update is invalid.', 'invalid_asset_update', 400, {
        issues: parsed.error.issues,
      });
    }
    return assets.update({
      scope: contentScope(context),
      id: params.id,
      changes: parsed.data,
      actor: { id: context.principal.id },
    });
  });
  server.post('/api/v1/assets/:id/renditions', async (request, reply) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetUpdate, { kind: 'asset', id: params.id });
    const parsed = assetRenditionPresetSchema.safeParse(bodyOf(request));
    if (!parsed.success) {
      throw new GridStoryError('Rendition preset is invalid.', 'invalid_asset_rendition', 400, {
        issues: parsed.error.issues,
      });
    }
    const rendition = await assets.createRendition({
      scope: contentScope(context),
      id: params.id,
      preset: parsed.data,
    });
    return reply.status(201).send(rendition);
  });
  server.get('/api/v1/assets/:id/usage', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.assetRead, { kind: 'asset', id: params.id });
    return assets.usage(contentScope(context), params.id);
  });
  server.post<{ Body: RequestBody }>('/api/v1/preview/sessions', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentRead, { kind: 'content' });
    const mode = request.body.mode;
    if (mode !== 'iframe' && mode !== 'standalone') {
      throw new GridStoryError('mode must be iframe or standalone.', 'invalid_preview_mode', 400);
    }
    const ttlSeconds =
      request.body.ttlSeconds === undefined ? undefined : Number(request.body.ttlSeconds);
    const grant = previews.create({
      scope: contentScope(context),
      previewUrl: requiredString(request.body.previewUrl, 'previewUrl'),
      route: requiredString(request.body.route, 'route'),
      mode,
      ...(typeof request.body.entryId === 'string' ? { entryId: request.body.entryId } : {}),
      ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
    });
    return reply.status(201).send(grant);
  });
  server.get<{ Params: { id: string } }>('/api/v1/preview/content/:id', async (request) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token)
      throw new GridStoryError('Preview token is required.', 'invalid_preview_token', 401);
    const claims = previews.authenticate(token, request.headers.origin);
    if (claims.entryId && claims.entryId !== request.params.id) {
      throw new GridStoryError(
        'Preview entry does not match the session.',
        'preview_scope_denied',
        403,
      );
    }
    return service.get({ scope: claims.scope, id: request.params.id, perspective: 'draft' });
  });
  server.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/preview/sessions/:id/messages',
    async (request) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token)
        throw new GridStoryError('Preview token is required.', 'invalid_preview_token', 401);
      const claims = previews.authenticate(token, request.headers.origin);
      const message = previewMessageSchema.parse(request.body);
      if (claims.sessionId !== request.params.id || message.sessionId !== request.params.id) {
        throw new GridStoryError('Preview session does not match.', 'preview_scope_denied', 403);
      }
      previews.acceptMessage(request.params.id, message.sequence, message.nonce);
      return { accepted: true, sequence: message.sequence };
    },
  );
  server.delete<{ Params: { id: string } }>(
    '/api/v1/preview/sessions/:id',
    async (request, reply) => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (token) {
        const claims = previews.authenticate(token, request.headers.origin);
        if (claims.sessionId !== request.params.id) {
          throw new GridStoryError('Preview session does not match.', 'preview_scope_denied', 403);
        }
        previews.revoke(request.params.id);
      } else {
        const context = requestContext(request, 'draft');
        authorize(policy, context, GridStoryActions.contentRead, { kind: 'content' });
        previews.revoke(request.params.id, contentScope(context));
      }
      return reply.status(204).send();
    },
  );
  server.get('/api/v1/locales', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentRead, { kind: 'platform' });
    return localization.listLocales(context.siteId);
  });

  server.get('/api/v1/schema-lifecycle', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.schemaRead, { kind: 'schema' });
    const source = lifecycle.getSource();
    return {
      source,
      visualModel: schemaIrToVisualModel(source),
      fingerprint: schemaIrFingerprint(source),
      generatedTypes: lifecycle.getGeneratedTypes(),
      generatedTypesFingerprint: generatedTypesFingerprint(source),
      deployment: await lifecycle.getDeployment(contentScope(context)),
    };
  });

  server.get('/api/v1/schema-lifecycle/drift', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.schemaRead, { kind: 'schema' });
    return lifecycle.drift(contentScope(context));
  });

  server.post('/api/v1/schema-lifecycle/plan', async (request) => {
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.schemaPlan, { kind: 'schema' });
    return lifecycle.assess(
      contentScope(context),
      candidateDocument(body.candidate, lifecycle.getSource()),
    );
  });

  server.post('/api/v1/schema-lifecycle/deploy', async (request) => {
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.schemaDeploy, { kind: 'schema' });
    return lifecycle.deploySource({
      scope: contentScope(context),
      actor: { id: context.principal.id },
      ...(body.expectedPlanId !== undefined
        ? { expectedPlanId: requiredString(body.expectedPlanId, 'expectedPlanId') }
        : {}),
      approved: body.approved === true,
    });
  });

  server.get('/api/v1/portability/export', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.portabilityExport, { kind: 'platform' });
    const archive = await portability.export(contentScope(context));
    const query = request.query as { format?: unknown };
    if (query.format === undefined || query.format === 'json') return archive;
    if (query.format !== 'ndjson') {
      throw new GridStoryError('format must be json or ndjson.', 'invalid_request', 400);
    }
    reply.type('application/x-ndjson');
    return reply.send(Readable.from(serializeLogicalArchive(archive)));
  });

  server.post('/api/v1/portability/import', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.portabilityImport, { kind: 'platform' });
    const query = request.query as {
      dryRun?: unknown;
      conflictPolicy?: unknown;
      allowSchemaMismatch?: unknown;
    };
    const archive =
      typeof request.body === 'string'
        ? parseLogicalArchive(request.body)
        : logicalArchiveFromUnknown(request.body);
    return portability.import({
      scope: contentScope(context),
      archive,
      dryRun: booleanQuery(query.dryRun, true),
      conflictPolicy: conflictPolicy(query.conflictPolicy),
      allowSchemaMismatch: booleanQuery(query.allowSchemaMismatch, false),
    });
  });

  server.get('/api/v1/audit/verify', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.auditRead, { kind: 'platform' });
    return audit.verify(contentScope(context));
  });

  server.get('/api/v1/audit/export', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.auditExport, { kind: 'platform' });
    const auditExport = await audit.export(contentScope(context));
    const query = request.query as { format?: unknown };
    if (query.format === undefined || query.format === 'json') return auditExport;
    if (query.format !== 'ndjson') {
      throw new GridStoryError('format must be json or ndjson.', 'invalid_request', 400);
    }
    reply.type('application/x-ndjson');
    return reply.send(Readable.from(serializeAuditExport(auditExport)));
  });

  server.get('/api/v1/operations/outbox', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsRead, { kind: 'platform' });
    const query = request.query as { limit?: unknown };
    return operations.listOutbox(contentScope(context), boundedLimit(query.limit));
  });

  server.get('/api/v1/operations/jobs', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsRead, { kind: 'platform' });
    const query = request.query as { limit?: unknown };
    return operations.listJobs(contentScope(context), boundedLimit(query.limit));
  });

  server.get('/api/v1/operations/summary', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsRead, { kind: 'platform' });
    return operations.dashboard(contentScope(context));
  });

  server.get('/api/v1/operations/webhooks', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsRead, { kind: 'platform' });
    return operations.listWebhooks(contentScope(context));
  });

  server.post('/api/v1/operations/webhooks', async (request, reply) => {
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsManage, { kind: 'platform' });
    const subscription = await operations.saveWebhook({
      scope: contentScope(context),
      url: requiredString(body.url, 'url'),
      eventTypes: webhookEventTypes(body.eventTypes),
      ...(body.active !== undefined ? { active: body.active === true } : {}),
    });
    return reply.status(201).send(subscription);
  });

  server.put('/api/v1/operations/webhooks/:id', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsManage, { kind: 'platform' });
    return operations.saveWebhook({
      scope: contentScope(context),
      id: params.id,
      url: requiredString(body.url, 'url'),
      eventTypes: webhookEventTypes(body.eventTypes),
      ...(body.active !== undefined ? { active: body.active === true } : {}),
    });
  });

  server.delete('/api/v1/operations/webhooks/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsManage, { kind: 'platform' });
    const deleted = await operations.deleteWebhook(contentScope(context), params.id);
    return deleted
      ? reply.status(204).send()
      : reply.status(404).send({
          error: {
            code: 'not_found',
            message: 'Webhook subscription was not found.',
            requestId: request.id,
          },
        });
  });

  server.post('/api/v1/operations/drain', async (request) => {
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsRun, { kind: 'platform' });
    return operations.drain({
      scope: contentScope(context),
      workerId: `api-${request.id}`,
      limit: boundedLimit(body.limit, 25),
    });
  });

  server.post('/api/v1/operations/jobs/:id/replay', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsReplay, { kind: 'platform' });
    return operations.replayJob(contentScope(context), params.id);
  });

  server.post('/api/v1/search', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.searchRead, { kind: 'search' });
    return search.search(contentScope(context), parsedSearchQuery(request.body));
  });

  server.get('/api/v1/taxonomies', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.searchRead, { kind: 'search' });
    return search.listTaxonomies();
  });

  server.get('/api/v1/search/index/status', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.searchRead, { kind: 'search' });
    return search.status(contentScope(context));
  });

  server.post('/api/v1/search/index/rebuild', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.searchManage, { kind: 'search' });
    const body = bodyOf(request);
    const selected = body.perspective === undefined ? 'published' : perspective(body.perspective);
    const job = await search.requestRebuild(contentScope(context), selected);
    return reply.status(202).send(job);
  });

  server.get('/api/v1/content/:id/backlinks', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { perspective?: unknown };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.searchRead, { kind: 'content', id: params.id });
    const selected = query.perspective === undefined ? 'published' : perspective(query.perspective);
    return search.backlinks(contentScope(context), params.id, selected);
  });

  server.get('/api/v1/content/:id/related', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { perspective?: unknown; limit?: unknown };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.searchRead, { kind: 'content', id: params.id });
    const selected = query.perspective === undefined ? 'published' : perspective(query.perspective);
    return search.related(
      contentScope(context),
      params.id,
      selected,
      boundedLimit(query.limit, 10),
    );
  });
  server.get('/api/v1/workflow-actions', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowActionRead, { kind: 'workflow' });
    const query = request.query as { limit?: unknown };
    return operations.listWorkflowActions(contentScope(context), boundedLimit(query.limit));
  });

  server.post('/api/v1/workflow-actions/drain', async (request) => {
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowActionRun, { kind: 'workflow' });
    const scope = contentScope(context);
    const reconciliation = await workflows.reconcileActions(scope);
    const delivery = await operations.drain({
      scope,
      workerId: `workflow-api-${request.id}`,
      limit: boundedLimit(body.limit, 25),
    });
    return { reconciliation, delivery };
  });

  server.post('/api/v1/workflow-actions/:id/replay', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowActionReplay, {
      kind: 'workflow',
      id: params.id,
    });
    return operations.replayWorkflowAction(contentScope(context), params.id);
  });

  server.get('/api/v1/workflows', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowRead, { kind: 'workflow' });
    return workflows.listDefinitions(contentScope(context));
  });

  server.put('/api/v1/workflows/:id', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowManage, {
      kind: 'workflow',
      id: params.id,
    });
    return workflows.saveDefinition({
      scope: contentScope(context),
      id: params.id,
      definition: workflowDefinition(request.body),
    });
  });

  server.get('/api/v1/content/:id/workflow', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowRead, {
      kind: 'workflow',
      id: params.id,
    });
    const entry = await service.get({ scope: contentScope(context), id: params.id });
    return workflows.getInstance({ scope: contentScope(context), entry });
  });

  server.post('/api/v1/content/:id/workflow/transitions/:transitionId', async (request) => {
    const params = request.params as { id: string; transitionId: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowTransition, {
      kind: 'workflow',
      id: params.id,
    });
    const entry = await service.get({ scope: contentScope(context), id: params.id });
    return workflows.requestTransition({
      scope: contentScope(context),
      entry,
      transitionId: params.transitionId,
      actor: { id: context.principal.id, roles: context.principal.roles },
      ...(Array.isArray(body.changedFields)
        ? {
            changedFields: body.changedFields.filter(
              (field): field is string => typeof field === 'string' && field.length > 0,
            ),
          }
        : {}),
    });
  });

  server.post('/api/v1/content/:id/workflow/approvals/:requestId', async (request) => {
    const params = request.params as { id: string; requestId: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowApprove, {
      kind: 'workflow',
      id: params.id,
    });
    if (body.decision !== 'approved' && body.decision !== 'rejected') {
      throw new GridStoryError('decision must be approved or rejected.', 'invalid_request', 400);
    }
    const entry = await service.get({ scope: contentScope(context), id: params.id });
    return workflows.decideApproval({
      scope: contentScope(context),
      entry,
      requestId: params.requestId,
      decision: body.decision,
      actor: { id: context.principal.id, roles: context.principal.roles },
      ...(typeof body.comment === 'string' && body.comment.length > 0
        ? { comment: body.comment }
        : {}),
    });
  });

  server.post('/api/v1/content/:id/workflow/schedules', async (request, reply) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowSchedule, {
      kind: 'workflow',
      id: params.id,
    });
    const entry = await service.get({ scope: contentScope(context), id: params.id });
    const instance = await workflows.scheduleTransition({
      scope: contentScope(context),
      entry,
      transitionId: requiredString(body.transitionId, 'transitionId'),
      runAt: requiredString(body.runAt, 'runAt'),
      timeZone: requiredString(body.timeZone, 'timeZone'),
      actor: { id: context.principal.id, roles: context.principal.roles },
    });
    return reply.status(201).send(instance);
  });

  server.delete('/api/v1/content/:id/workflow/schedules/:scheduleId', async (request) => {
    const params = request.params as { id: string; scheduleId: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.workflowSchedule, {
      kind: 'workflow',
      id: params.id,
    });
    const entry = await service.get({ scope: contentScope(context), id: params.id });
    return workflows.cancelSchedule({
      scope: contentScope(context),
      entry,
      scheduleId: params.scheduleId,
      actor: { id: context.principal.id, roles: context.principal.roles },
    });
  });

  server.post('/api/v1/workflows/process-due', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsRun, { kind: 'platform' });
    return workflows.processDue({
      scope: contentScope(context),
      execute: executeWorkflowSchedule,
    });
  });

  server.get('/api/v1/plugins', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.pluginRead, { kind: 'plugin' });
    return plugins.list(contentScope(context));
  });

  server.post('/api/v1/plugins/install', async (request, reply) => {
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.pluginManage, { kind: 'plugin' });
    const installation = await plugins.install({
      scope: contentScope(context),
      manifest: pluginManifest(body.manifest),
      artifactDigest: requiredString(body.artifactDigest, 'artifactDigest'),
      grantedCapabilities: pluginGrants(body.grantedCapabilities),
      actorId: context.principal.id,
      reason: requiredString(body.reason, 'reason'),
    });
    return reply.status(201).send(installation);
  });

  server.get('/api/v1/plugins/:id', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.pluginRead, { kind: 'plugin', id: params.id });
    return plugins.get(contentScope(context), params.id);
  });

  for (const action of ['enable', 'disable', 'revoke'] as const) {
    server.post(`/api/v1/plugins/:id/${action}`, async (request) => {
      const params = request.params as { id: string };
      const body = bodyOf(request);
      const context = requestContext(request, 'draft');
      authorize(policy, context, GridStoryActions.pluginManage, {
        kind: 'plugin',
        id: params.id,
      });
      return plugins[action]({
        scope: contentScope(context),
        id: params.id,
        actorId: context.principal.id,
        reason: requiredString(body.reason, 'reason'),
      });
    });
  }

  server.get('/api/v1/plugins/:id/uninstall-preview', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.pluginManage, { kind: 'plugin', id: params.id });
    return plugins.uninstallPreview(contentScope(context), params.id);
  });

  server.delete('/api/v1/plugins/:id', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.pluginManage, { kind: 'plugin', id: params.id });
    return plugins.uninstall({
      scope: contentScope(context),
      id: params.id,
      actorId: context.principal.id,
      reason: requiredString(body.reason, 'reason'),
    });
  });

  server.post('/api/v1/plugins/:id/invoke', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.pluginInvoke, { kind: 'plugin', id: params.id });
    if (typeof body.input !== 'object' || body.input === null || Array.isArray(body.input)) {
      throw new GridStoryError('Plugin input must be a JSON object.', 'invalid_plugin_input', 400);
    }
    return plugins.invoke({
      scope: contentScope(context),
      id: params.id,
      operation: requiredString(body.operation, 'operation'),
      capability: pluginCapability(body.capability),
      payload: body.input as Record<string, unknown>,
    });
  });

  server.get('/api/v1/releases', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseRead, { kind: 'release' });
    return releases.list(contentScope(context));
  });

  server.post('/api/v1/releases', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseManage, { kind: 'release' });
    const release = await releases.create({
      scope: contentScope(context),
      release: releaseDefinition(request.body),
      actor: { id: context.principal.id, roles: context.principal.roles },
    });
    return reply.status(201).send(release);
  });

  server.get('/api/v1/releases/:id', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseRead, { kind: 'release', id: params.id });
    return releases.get(contentScope(context), params.id);
  });

  server.post('/api/v1/releases/:id/validate', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseManage, { kind: 'release', id: params.id });
    return releases.validate({
      scope: contentScope(context),
      id: params.id,
      actor: { id: context.principal.id, roles: context.principal.roles },
      ...(typeof body.channel === 'string' && body.channel ? { channel: body.channel } : {}),
    });
  });

  server.get('/api/v1/releases/:id/preview', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseRead, { kind: 'release', id: params.id });
    return releases.preview(contentScope(context), params.id);
  });

  server.post('/api/v1/releases/:id/schedule', async (request, reply) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseSchedule, {
      kind: 'release',
      id: params.id,
    });
    const release = await releases.schedule({
      scope: contentScope(context),
      id: params.id,
      runAt: requiredString(body.runAt, 'runAt'),
      timeZone: requiredString(body.timeZone, 'timeZone'),
      actor: { id: context.principal.id, roles: context.principal.roles },
    });
    return reply.status(201).send(release);
  });

  server.delete('/api/v1/releases/:id/schedule', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseSchedule, {
      kind: 'release',
      id: params.id,
    });
    return releases.cancelSchedule({
      scope: contentScope(context),
      id: params.id,
      actor: { id: context.principal.id, roles: context.principal.roles },
    });
  });

  server.post('/api/v1/releases/:id/execute', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseExecute, {
      kind: 'release',
      id: params.id,
    });
    return releases.execute({
      scope: contentScope(context),
      id: params.id,
      actor: { id: context.principal.id, roles: context.principal.roles },
      ...(typeof body.channel === 'string' && body.channel ? { channel: body.channel } : {}),
    });
  });

  server.post('/api/v1/releases/:id/rollback', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.releaseRollback, {
      kind: 'release',
      id: params.id,
    });
    return releases.rollback({
      scope: contentScope(context),
      id: params.id,
      reason: requiredString(body.reason, 'reason'),
      actor: { id: context.principal.id, roles: context.principal.roles },
    });
  });

  server.post('/api/v1/releases/process-due', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.operationsRun, { kind: 'platform' });
    return releases.processDue(contentScope(context));
  });
  server.get('/api/v1/content', async (request) => {
    const query = request.query as { contentType?: string; perspective?: string };
    const selectedPerspective = perspective(query.perspective);
    const context = requestContext(request, selectedPerspective);
    authorize(policy, context, GridStoryActions.contentRead, {
      kind: 'content',
      ...(query.contentType ? { contentType: query.contentType } : {}),
    });
    return service.list({
      scope: contentScope(context),
      perspective: selectedPerspective,
      ...(query.contentType ? { contentType: query.contentType } : {}),
    });
  });

  server.get('/api/v1/content/query', async (request) => {
    const query = parseContentQuery(request.query);
    const selectedPerspective = perspective(query.perspective);
    const context = requestContext(request, selectedPerspective);
    authorize(policy, context, GridStoryActions.contentRead, {
      kind: 'content',
      ...(query.contentType ? { contentType: query.contentType } : {}),
    });
    return contentQueries.query(contentScope(context), {
      ...query,
      perspective: selectedPerspective,
    });
  });

  server.post('/api/v1/content/query', async (request) => {
    const query = parseContentQuery(request.body);
    const selectedPerspective = perspective(query.perspective);
    const context = requestContext(request, selectedPerspective);
    authorize(policy, context, GridStoryActions.contentRead, {
      kind: 'content',
      ...(query.contentType ? { contentType: query.contentType } : {}),
    });
    return contentQueries.query(contentScope(context), {
      ...query,
      perspective: selectedPerspective,
    });
  });

  server.get('/api/v1/content/:id/translations', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    const source = await service.get({ scope: contentScope(context), id: params.id });
    authorize(policy, context, GridStoryActions.contentRead, {
      kind: 'content',
      id: params.id,
      contentType: source.contentType,
    });
    return localization.completeness(contentScope(context), params.id);
  });

  server.post('/api/v1/content/:id/translations', async (request, reply) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const sourceContext = requestContext(request, 'draft');
    const source = await service.get({ scope: contentScope(sourceContext), id: params.id });
    const locale = requiredString(body.locale, 'locale');
    const targetContext = { ...sourceContext, locale };
    authorize(policy, targetContext, GridStoryActions.contentCreate, {
      kind: 'content',
      contentType: source.contentType,
    });
    const entry = await localization.createTranslation({
      sourceScope: contentScope(sourceContext),
      sourceId: params.id,
      locale,
      data: body.data,
      actor: { id: sourceContext.principal.id },
    });
    return reply.status(201).send(entry);
  });

  server.post('/api/v1/content', async (request, reply) => {
    const body = bodyOf(request);
    const contentType = requiredString(body.contentType, 'contentType');
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentCreate, { kind: 'content', contentType });
    const entry = await service.create({
      scope: contentScope(context),
      contentType,
      data: body.data,
      actor: { id: context.principal.id },
    });
    return reply.status(201).send(entry);
  });

  server.get('/api/v1/content/:id', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { perspective?: string };
    const selectedPerspective = perspective(query.perspective);
    const context = requestContext(request, selectedPerspective);
    authorize(policy, context, GridStoryActions.contentRead, { kind: 'content', id: params.id });
    return service.get({
      scope: contentScope(context),
      id: params.id,
      perspective: selectedPerspective,
    });
  });

  server.get('/api/v1/content/:id/quality', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { channel?: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentRead, { kind: 'content', id: params.id });
    const entry = await service.get({ scope: contentScope(context), id: params.id });
    return quality.assess({
      scope: contentScope(context),
      entry,
      channel: query.channel ?? 'web',
      roles: context.principal.roles,
    });
  });

  server.post('/api/v1/content/:id/quality', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { channel?: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentDraftUpdate, {
      kind: 'content',
      id: params.id,
    });
    const entry = await service.get({ scope: contentScope(context), id: params.id });
    if (typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) {
      throw new GridStoryError(
        'Quality assessment data must be an object.',
        'invalid_request',
        400,
      );
    }
    return quality.assess({
      scope: contentScope(context),
      entry: { ...entry, data: body.data as Record<string, unknown> },
      channel: query.channel ?? 'web',
      roles: context.principal.roles,
    });
  });
  server.put('/api/v1/content/:id/draft', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentDraftUpdate, {
      kind: 'content',
      id: params.id,
    });
    return service.updateDraft({
      scope: contentScope(context),
      id: params.id,
      expectedRevisionId: requiredString(body.expectedRevisionId, 'expectedRevisionId'),
      data: body.data,
      actor: { id: context.principal.id },
    });
  });

  server.post('/api/v1/content/:id/publish', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentPublish, {
      kind: 'content',
      id: params.id,
    });
    return service.publish({
      scope: contentScope(context),
      id: params.id,
      expectedRevisionId: requiredString(body.expectedRevisionId, 'expectedRevisionId'),
      actor: { id: context.principal.id, roles: context.principal.roles },
      ...(body.channel !== undefined ? { channel: requiredString(body.channel, 'channel') } : {}),
    });
  });

  server.get('/api/v1/content/:id/revisions', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.contentHistoryRead, {
      kind: 'content',
      id: params.id,
    });
    return service.listRevisions({ scope: contentScope(context), id: params.id });
  });

  server.get('/api/v1/content/:id/collaboration', async (request) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.collaborationRead, {
      kind: 'content',
      id: params.id,
    });
    await service.get({ scope: contentScope(context), id: params.id });
    return collaboration.snapshot(contentScope(context), params.id);
  });

  server.post('/api/v1/content/:id/comments', async (request, reply) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.collaborationWrite, {
      kind: 'content',
      id: params.id,
    });
    await service.get({ scope: contentScope(context), id: params.id });
    const parsedTarget = collaborationTargetSchema.safeParse({
      ...(typeof body.target === 'object' && body.target !== null ? body.target : {}),
      entryId: params.id,
    });
    if (!parsedTarget.success) {
      throw new GridStoryError('Comment target is invalid.', 'invalid_comment_target', 400);
    }
    const thread = collaboration.createThread({
      scope: contentScope(context),
      target: parsedTarget.data,
      actorId: context.principal.id,
      body: requiredString(body.body, 'body'),
      ...(Array.isArray(body.mentions)
        ? { mentions: body.mentions.filter((value): value is string => typeof value === 'string') }
        : {}),
      ...(typeof body.assigneeId === 'string' ? { assigneeId: body.assigneeId } : {}),
      ...(typeof body.dueAt === 'string' ? { dueAt: body.dueAt } : {}),
    });
    return reply.status(201).send(thread);
  });

  server.post('/api/v1/content/:id/comments/:threadId/replies', async (request, reply) => {
    const params = request.params as { id: string; threadId: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.collaborationWrite, {
      kind: 'content',
      id: params.id,
    });
    const thread = collaboration.reply({
      scope: contentScope(context),
      entryId: params.id,
      threadId: params.threadId,
      actorId: context.principal.id,
      body: requiredString(body.body, 'body'),
      ...(Array.isArray(body.mentions)
        ? { mentions: body.mentions.filter((value): value is string => typeof value === 'string') }
        : {}),
    });
    return reply.status(201).send(thread);
  });

  server.patch('/api/v1/content/:id/comments/:threadId', async (request) => {
    const params = request.params as { id: string; threadId: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.collaborationWrite, {
      kind: 'content',
      id: params.id,
    });
    return collaboration.updateThread({
      scope: contentScope(context),
      entryId: params.id,
      threadId: params.threadId,
      actorId: context.principal.id,
      ...(body.assigneeId === null || typeof body.assigneeId === 'string'
        ? { assigneeId: body.assigneeId }
        : {}),
      ...(body.dueAt === null || typeof body.dueAt === 'string' ? { dueAt: body.dueAt } : {}),
      ...(typeof body.resolved === 'boolean' ? { resolved: body.resolved } : {}),
    });
  });

  server.put('/api/v1/content/:id/presence', async (request) => {
    const params = request.params as { id: string };
    const body = bodyOf(request);
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.presenceWrite, { kind: 'content', id: params.id });
    await service.get({ scope: contentScope(context), id: params.id });
    return collaboration.heartbeat({
      scope: contentScope(context),
      entryId: params.id,
      actorId: context.principal.id,
      displayName: requiredString(body.displayName, 'displayName'),
      ...(typeof body.field === 'string' ? { field: body.field } : {}),
      ...(typeof body.nodeId === 'string' ? { nodeId: body.nodeId } : {}),
    });
  });

  server.delete('/api/v1/content/:id/presence', async (request, reply) => {
    const params = request.params as { id: string };
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.presenceWrite, { kind: 'content', id: params.id });
    collaboration.leave(contentScope(context), params.id, context.principal.id);
    return reply.status(204).send();
  });
  server.get('/api/v1/delivery/:contentType/:slug', async (request, reply) => {
    const params = request.params as { contentType: string; slug: string };
    const context = requestContext(request, 'published', true);
    authorize(policy, context, GridStoryActions.deliveryRead, {
      kind: 'delivery',
      contentType: params.contentType,
    });
    const entry = await service.getBySlug({
      scope: contentScope(context),
      contentType: params.contentType,
      slug: params.slug,
      perspective: 'published',
    });
    setCacheTags(reply, [entry]);
    return entry;
  });

  server.get('/api/v1/delivery/localized/:translationGroupId', async (request, reply) => {
    const params = request.params as { translationGroupId: string };
    const context = requestContext(request, 'published', true);
    const result = await localization.resolve({
      scope: contentScope(context),
      translationGroupId: params.translationGroupId,
      perspective: 'published',
    });
    authorize(policy, context, GridStoryActions.deliveryRead, {
      kind: 'delivery',
      contentType: result.entry.contentType,
    });
    setCacheTags(reply, [result.entry]);
    return result;
  });

  server.get('/api/v1/delivery/localized-routes/*', async (request, reply) => {
    const params = request.params as { '*': string };
    const context = requestContext(request, 'published', true);
    const result = await localization.resolveRoute(contentScope(context), `/${params['*']}`);
    authorize(policy, context, GridStoryActions.deliveryRead, {
      kind: 'delivery',
      contentType: result.entry.contentType,
    });
    setCacheTags(reply, [result.entry]);
    return result;
  });

  server.get('/api/v1/delivery/query', async (request, reply) => {
    const query = parseContentQuery(request.query, 'published');
    const context = requestContext(request, 'published', true);
    authorize(policy, context, GridStoryActions.deliveryRead, {
      kind: 'delivery',
      ...(query.contentType ? { contentType: query.contentType } : {}),
    });
    const result = await contentQueries.query(contentScope(context), query);
    setCacheTags(reply, result.nodes);
    return result;
  });

  server.post('/api/v1/delivery/query', async (request, reply) => {
    const query = parseContentQuery(request.body, 'published');
    const context = requestContext(request, 'published', true);
    authorize(policy, context, GridStoryActions.deliveryRead, {
      kind: 'delivery',
      ...(query.contentType ? { contentType: query.contentType } : {}),
    });
    const result = await contentQueries.query(contentScope(context), query);
    setCacheTags(reply, result.nodes);
    return result;
  });

  server.get('/api/v1/delivery/routes/*', async (request, reply) => {
    const params = request.params as { '*': string };
    const context = requestContext(request, 'published', true);
    authorize(policy, context, GridStoryActions.deliveryRead, { kind: 'delivery' });
    const result = await routing.resolve(contentScope(context), `/${params['*']}`);
    if (result.kind === 'redirect') {
      return reply.status(result.status).header('location', result.location).send();
    }
    setCacheTags(reply, [result.entry]);
    return result.entry;
  });

  if (seed && (await service.list({ scope: seedScope, contentType: 'page' })).length === 0) {
    const created = await service.create({
      scope: seedScope,
      contentType: 'page',
      data: welcomePage,
      actor: { id: 'gridstory-seed' },
    });
    const seedRequester = { id: 'gridstory-seed', roles: ['publisher'] };
    await workflows.requestTransition({
      scope: seedScope,
      entry: created,
      transitionId: 'submit-review',
      actor: seedRequester,
    });
    const pending = await workflows.requestTransition({
      scope: seedScope,
      entry: created,
      transitionId: 'approve',
      actor: seedRequester,
    });
    const seedReviewer = { id: 'gridstory-seed-reviewer', roles: ['publisher'] };
    await workflows.decideApproval({
      scope: seedScope,
      entry: created,
      requestId: pending.pendingApproval?.id ?? '',
      decision: 'approved',
      actor: seedReviewer,
    });
    await service.publish({
      scope: seedScope,
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      actor: seedReviewer,
    });
  }
  if (seed) await lifecycle.initialize(seedScope, { id: 'gridstory-schema-bootstrap' });

  await registerGridStoryGraphql(server, {
    content: service,
    queries: contentQueries,
    lifecycle,
    policy,
    localization,
  });

  return server;
}
