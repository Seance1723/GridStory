import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  ContentService,
  AuditService,
  ContentQueryService,
  LocaleRegistry,
  LocalizationService,
  OperationsService,
  PortabilityService,
  PreviewSessionService,
  logicalArchiveFromUnknown,
  parseLogicalArchive,
  serializeLogicalArchive,
  serializeAuditExport,
  contentCacheTags,
  ContentRoutingService,
  SchemaLifecycleService,
  GridStoryError,
  AuthorizationPolicy,
  GridStoryActions,
  PostgresContentRepository,
  SqliteContentRepository,
  type ContentPerspective,
  type ContentRepository,
  type CacheInvalidator,
  type WebhookTransport,
  type ContentEventType,
  type ImportConflictPolicy,
} from '@gridstory/core';
import {
  generatedTypesFingerprint,
  schemaIrDocumentSchema,
  schemaIrFingerprint,
  schemaIrToVisualModel,
  visualModelDocumentSchema,
  visualModelToSchemaIr,
  type RedirectDefinition,
  type LocaleConfiguration,
  type SchemaIrDocument,
  previewMessageSchema,
} from '@gridstory/schema';
import { componentManifests, pageSchema, welcomePage } from '@gridstory/example-kit/manifests';
import { exampleDesignSystem } from '@gridstory/example-kit/design-system';
import { authorize, contentScope, requestContext } from './request-context.js';
import { parseContentQuery } from './content-query.js';
import { registerGridStoryGraphql } from './graphql.js';

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
}

function perspective(value: unknown): ContentPerspective {
  if (value === undefined || value === 'draft') return 'draft';
  if (value === 'published') return 'published';
  throw new GridStoryError('Perspective must be draft or published.', 'invalid_perspective', 400);
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
}: BuildServerOptions): Promise<FastifyInstance> {
  if (!databaseUrl && databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }
  const repository: ContentRepository = databaseUrl
    ? new PostgresContentRepository({ connectionString: databaseUrl })
    : new SqliteContentRepository({ filename: databasePath });
  const service = new ContentService({
    repository,
    schemas: [pageSchema],
    componentManifests,
  });
  const routing = new ContentRoutingService({ contentService: service, redirects });
  const contentQueries = new ContentQueryService({ repository, cursorSecret });
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
    ...(allowedWebhookHosts ? { allowedWebhookHosts } : {}),
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  server.addHook('onClose', async () => repository.close());
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
    return service.getComponentManifests();
  });
  server.get('/api/v1/design-system', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(policy, context, GridStoryActions.componentRead, { kind: 'component' });
    return exampleDesignSystem;
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
      if (!token)
        throw new GridStoryError('Preview token is required.', 'invalid_preview_token', 401);
      const claims = previews.authenticate(token, request.headers.origin);
      if (claims.sessionId !== request.params.id) {
        throw new GridStoryError('Preview session does not match.', 'preview_scope_denied', 403);
      }
      previews.revoke(request.params.id);
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
      actor: { id: context.principal.id },
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
    await service.publish({
      scope: seedScope,
      id: created.id,
      expectedRevisionId: created.draftRevisionId,
      actor: { id: 'gridstory-seed' },
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
