import {
  type AuthorizationPolicy,
  GridStoryActions,
  GridStoryError,
  type RegionalService,
} from '@gridstory/core';
import {
  regionalExpectedVersionInputSchema,
  regionalFailoverApprovalInputSchema,
  regionalFailoverPreflightInputSchema,
  regionalPolicyInputSchema,
} from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import {
  authorize,
  contentScope,
  requestContext,
  requestReauthenticationTime,
} from './request-context.js';

interface RegionalRouteOptions {
  service: RegionalService;
  policy: AuthorizationPolicy;
}

interface BodySchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: unknown } };
}

function parseBody<T>(schema: BodySchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new GridStoryError(
      'Regional control request is invalid.',
      'invalid_regional_request',
      400,
      {
        issues: parsed.error.issues,
      },
    );
  }
  return parsed.data;
}

export async function registerRegionalRoutes(
  server: FastifyInstance,
  options: RegionalRouteOptions,
): Promise<void> {
  server.get('/api/v1/regional', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.regionalRead, { kind: 'regional' });
    return options.service.snapshot(contentScope(context));
  });

  server.put('/api/v1/regional/policy', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.regionalManage, { kind: 'regional' });
    return options.service.updatePolicy(
      contentScope(context),
      parseBody(regionalPolicyInputSchema, request.body),
      context.principal.id,
    );
  });

  server.post('/api/v1/regional/failover/preflight', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.regionalFailover, { kind: 'regional' });
    const document = await options.service.preflight(
      contentScope(context),
      parseBody(regionalFailoverPreflightInputSchema, request.body),
      context.principal.id,
    );
    return reply.status(201).send(document);
  });

  server.post('/api/v1/regional/failover/:planId/approve', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.regionalFailover, { kind: 'regional' });
    const params = request.params as { planId: string };
    return options.service.approve(
      contentScope(context),
      params.planId,
      parseBody(regionalFailoverApprovalInputSchema, request.body),
      {
        id: context.principal.id,
        type: context.principal.type,
        reauthenticatedAt: requestReauthenticationTime(request),
      },
    );
  });

  server.post('/api/v1/regional/failover/:planId/execute', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.regionalFailover, { kind: 'regional' });
    const params = request.params as { planId: string };
    return options.service.execute(
      contentScope(context),
      params.planId,
      parseBody(regionalExpectedVersionInputSchema, request.body),
      context.principal.id,
    );
  });

  server.post('/api/v1/regional/failover/:planId/reconcile', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.regionalFailover, { kind: 'regional' });
    const params = request.params as { planId: string };
    return options.service.reconcile(
      contentScope(context),
      params.planId,
      parseBody(regionalExpectedVersionInputSchema, request.body),
      context.principal.id,
    );
  });
}
