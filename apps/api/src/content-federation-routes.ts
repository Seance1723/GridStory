import {
  type AuthorizationPolicy,
  type ContentFederationService,
  GridStoryActions,
  GridStoryError,
} from '@gridstory/core';
import {
  federationAgreementInspectionInputSchema,
  federationAgreementStateInputSchema,
  federationExpectedVersionInputSchema,
  federationOfferInputSchema,
  federationSyncPlanExecutionInputSchema,
  resourceLimits,
} from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface ContentFederationRouteOptions {
  service: ContentFederationService;
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
      'Content federation request is invalid.',
      'invalid_content_federation_request',
      400,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

function requestId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw new GridStoryError(
      'Content federation request is invalid.',
      'invalid_content_federation_request',
      400,
    );
  }
  return value;
}

function maximumRecords(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > resourceLimits.contentFederation.maximumRecordsPerSnapshot
  ) {
    throw new GridStoryError(
      'Content federation request is invalid.',
      'invalid_content_federation_request',
      400,
    );
  }
  return parsed;
}

export async function registerContentFederationRoutes(
  server: FastifyInstance,
  options: ContentFederationRouteOptions,
): Promise<void> {
  server.get('/api/v1/federation', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.federationRead, { kind: 'federation' });
    return options.service.snapshot(contentScope(context));
  });

  server.put('/api/v1/federation/offers/:offerId', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.federationManage, { kind: 'federation' });
    const params = request.params as { offerId: string };
    const body = parseBody(federationOfferInputSchema, request.body);
    if (body.id !== params.offerId) {
      throw new GridStoryError(
        'Content federation request is invalid.',
        'invalid_content_federation_request',
        400,
      );
    }
    return options.service.upsertOffer(contentScope(context), context.principal.id, body);
  });

  server.post('/api/v1/federation/agreements/:agreementId/inspect', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.federationManage, { kind: 'federation' });
    const params = request.params as { agreementId: string };
    const agreement = await options.service.inspectAgreement(
      contentScope(context),
      params.agreementId,
      context.principal.id,
      parseBody(federationAgreementInspectionInputSchema, request.body),
    );
    return reply.status(201).send(agreement);
  });

  server.post('/api/v1/federation/agreements/:agreementId/state', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.federationManage, { kind: 'federation' });
    const params = request.params as { agreementId: string };
    return options.service.setAgreementState(
      contentScope(context),
      params.agreementId,
      context.principal.id,
      parseBody(federationAgreementStateInputSchema, request.body),
    );
  });

  server.post('/api/v1/federation/agreements/:agreementId/plans', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.federationSync, { kind: 'federation' });
    const params = request.params as { agreementId: string };
    const body = parseBody(federationExpectedVersionInputSchema, request.body);
    const plan = await options.service.planSync(
      contentScope(context),
      params.agreementId,
      body.expectedVersion,
      context.principal.id,
    );
    return reply.status(201).send(plan);
  });

  server.post('/api/v1/federation/plans/:planId/execute', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.federationSync, { kind: 'federation' });
    const params = request.params as { planId: string };
    return options.service.executeSync(
      contentScope(context),
      params.planId,
      context.principal.id,
      parseBody(federationSyncPlanExecutionInputSchema, request.body),
    );
  });

  server.get('/api/v1/federation/source/offers/:offerId', async (request) => {
    const context = requestContext(request, 'published');
    authorize(options.policy, context, GridStoryActions.federationConsume, {
      kind: 'federation',
    });
    const params = request.params as { offerId: string };
    const query = request.query as { requestId?: unknown };
    return options.service.offerEnvelope(
      contentScope(context),
      params.offerId,
      requestId(query.requestId),
    );
  });

  server.get(
    '/api/v1/federation/source/offers/:offerId/records/:namespace/:sourceEntryId',
    async (request) => {
      const context = requestContext(request, 'published');
      authorize(options.policy, context, GridStoryActions.federationConsume, {
        kind: 'federation',
      });
      const params = request.params as {
        offerId: string;
        namespace: string;
        sourceEntryId: string;
      };
      const query = request.query as { requestId?: unknown };
      return options.service.recordEnvelope({
        scope: contentScope(context),
        ...params,
        requestId: requestId(query.requestId),
      });
    },
  );

  server.get('/api/v1/federation/source/offers/:offerId/snapshot', async (request) => {
    const context = requestContext(request, 'published');
    authorize(options.policy, context, GridStoryActions.federationConsume, {
      kind: 'federation',
    });
    const params = request.params as { offerId: string };
    const query = request.query as { requestId?: unknown; maximumRecords?: unknown };
    return options.service.snapshotEnvelope({
      scope: contentScope(context),
      offerId: params.offerId,
      requestId: requestId(query.requestId),
      maximumRecords: maximumRecords(query.maximumRecords),
    });
  });

  server.get(
    '/api/v1/federation/delivery/:agreementId/:namespace/:sourceEntryId',
    async (request, reply) => {
      const context = requestContext(request, 'published', true);
      authorize(options.policy, context, GridStoryActions.deliveryRead, { kind: 'federation' });
      const params = request.params as {
        agreementId: string;
        namespace: string;
        sourceEntryId: string;
      };
      const record = await options.service.publicRecord({
        scope: contentScope(context),
        ...params,
      });
      if (!record) throw new GridStoryError('Federated content was not found.', 'not_found', 404);
      reply.header('cache-control', 'private, no-store');
      return record;
    },
  );
}
