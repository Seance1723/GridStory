import {
  type AuthorizationPolicy,
  type ExperimentService,
  GridStoryActions,
  GridStoryError,
} from '@gridstory/core';
import {
  experimentAllocationRequestSchema,
  experimentDesignSchema,
  experimentMetricSnapshotInputSchema,
  experimentPromotionRequestSchema,
  experimentTransitionRequestSchema,
} from '@gridstory/schema';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface ExperimentRouteOptions {
  service: ExperimentService;
  policy: AuthorizationPolicy;
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
    throw new GridStoryError('A JSON request body is required.', 'invalid_request', 400);
  }
  return request.body as Record<string, unknown>;
}

function experimentIdOf(request: FastifyRequest): string {
  const value = (request.params as { experimentId?: unknown }).experimentId;
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value)
  ) {
    throw new GridStoryError('Experiment ID is invalid.', 'invalid_experiment_id', 400);
  }
  return value;
}

function parsed<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
  },
  value: unknown,
  code: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new GridStoryError('Experiment request is invalid.', code, 400, {
    issues: result.error,
  });
}

function managementContext(
  request: FastifyRequest,
  options: ExperimentRouteOptions,
  action:
    | typeof GridStoryActions.experimentRead
    | typeof GridStoryActions.experimentManage
    | typeof GridStoryActions.experimentMetrics
    | typeof GridStoryActions.experimentPromote,
) {
  const context = requestContext(request, 'draft');
  authorize(options.policy, context, action, {
    kind: 'experiment',
    ...(typeof (request.params as { experimentId?: unknown }).experimentId === 'string'
      ? { id: (request.params as { experimentId: string }).experimentId }
      : {}),
  });
  return { context, scope: contentScope(context) };
}

export async function registerExperimentRoutes(
  server: FastifyInstance,
  options: ExperimentRouteOptions,
): Promise<void> {
  server.get('/api/v1/experiments', async (request) => {
    const { context, scope } = managementContext(request, options, GridStoryActions.experimentRead);
    return options.service.overview(scope, context.principal.id);
  });

  server.put('/api/v1/experiments/:experimentId', async (request) => {
    const experimentId = experimentIdOf(request);
    const { context, scope } = managementContext(
      request,
      options,
      GridStoryActions.experimentManage,
    );
    const body = bodyOf(request);
    const design = parsed(experimentDesignSchema, body.design, 'invalid_experiment_design');
    if (design.id !== experimentId) {
      throw new GridStoryError(
        'Experiment path and design IDs must match.',
        'experiment_id_mismatch',
        400,
      );
    }
    const expectedVersion = parsed(
      experimentTransitionRequestSchema.pick({ expectedVersion: true }),
      { expectedVersion: body.expectedVersion },
      'invalid_experiment_version',
    ).expectedVersion;
    return options.service.saveDraft({
      scope,
      actorId: context.principal.id,
      expectedVersion,
      design,
    });
  });

  server.post('/api/v1/experiments/:experimentId/transition', async (request) => {
    const experimentId = experimentIdOf(request);
    const { context, scope } = managementContext(
      request,
      options,
      GridStoryActions.experimentManage,
    );
    const transition = parsed(
      experimentTransitionRequestSchema,
      request.body,
      'invalid_experiment_transition',
    );
    return options.service.transition({
      scope,
      actorId: context.principal.id,
      experimentId,
      ...transition,
    });
  });

  server.post('/api/v1/experiments/:experimentId/metrics', async (request) => {
    const experimentId = experimentIdOf(request);
    const { context, scope } = managementContext(
      request,
      options,
      GridStoryActions.experimentMetrics,
    );
    const body = bodyOf(request);
    const expectedVersion = parsed(
      experimentTransitionRequestSchema.pick({ expectedVersion: true }),
      { expectedVersion: body.expectedVersion },
      'invalid_experiment_version',
    ).expectedVersion;
    const snapshot = parsed(
      experimentMetricSnapshotInputSchema,
      body.snapshot,
      'invalid_experiment_metrics',
    );
    return options.service.recordMetrics({
      scope,
      actorId: context.principal.id,
      experimentId,
      expectedVersion,
      snapshot,
    });
  });

  server.post('/api/v1/experiments/:experimentId/promote', async (request) => {
    const experimentId = experimentIdOf(request);
    const { context, scope } = managementContext(
      request,
      options,
      GridStoryActions.experimentPromote,
    );
    const promotion = parsed(
      experimentPromotionRequestSchema,
      request.body,
      'invalid_experiment_promotion',
    );
    return options.service.promote({
      scope,
      actorId: context.principal.id,
      experimentId,
      ...promotion,
    });
  });

  server.post('/api/v1/experiments/:experimentId/allocate', async (request) => {
    const experimentId = experimentIdOf(request);
    const context = requestContext(request, 'published', true);
    authorize(options.policy, context, GridStoryActions.deliveryRead, {
      kind: 'experiment',
      id: experimentId,
    });
    const allocation = parsed(
      experimentAllocationRequestSchema,
      request.body,
      'invalid_experiment_allocation',
    );
    const secGpc = request.headers['sec-gpc'];
    return options.service.allocate(contentScope(context), experimentId, {
      ...allocation,
      consent: {
        ...allocation.consent,
        globalPrivacyControl: allocation.consent.globalPrivacyControl || secGpc === '1',
      },
    });
  });
}
