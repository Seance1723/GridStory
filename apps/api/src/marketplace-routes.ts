import {
  type AuthorizationPolicy,
  GridStoryActions,
  GridStoryError,
  type MarketplaceService,
  type PluginService,
} from '@gridstory/core';
import {
  marketplacePublisherInputSchema,
  marketplaceReleaseSubmissionSchema,
  pluginCapabilityGrantSchema,
} from '@gridstory/schema';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface MarketplaceRouteOptions {
  service: MarketplaceService;
  plugins: PluginService;
  policy: AuthorizationPolicy;
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
    throw new GridStoryError('A JSON request body is required.', 'invalid_request', 400);
  }
  return request.body as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GridStoryError(`${name} is required.`, 'invalid_request', 400);
  }
  return value;
}

function marketplaceContext(
  request: FastifyRequest,
  options: MarketplaceRouteOptions,
  action: 'read' | 'manage' | 'review',
) {
  const context = requestContext(request, 'draft');
  authorize(
    options.policy,
    context,
    action === 'read'
      ? GridStoryActions.marketplaceRead
      : action === 'manage'
        ? GridStoryActions.marketplaceManage
        : GridStoryActions.marketplaceReview,
    { kind: 'marketplace' },
  );
  return { context, scope: contentScope(context) };
}

function parsePublisher(value: unknown) {
  const parsed = marketplacePublisherInputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError(
    'Marketplace publisher input is invalid.',
    'invalid_marketplace_publisher',
    400,
    {
      issues: parsed.error.issues,
    },
  );
}

function parseRelease(value: unknown) {
  const parsed = marketplaceReleaseSubmissionSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError(
    'Marketplace release input is invalid.',
    'invalid_marketplace_release',
    400,
    {
      issues: parsed.error.issues,
    },
  );
}

export async function registerMarketplaceRoutes(
  server: FastifyInstance,
  options: MarketplaceRouteOptions,
): Promise<void> {
  server.get('/api/v1/marketplace', async (request) => {
    const { scope } = marketplaceContext(request, options, 'read');
    return options.service.overview(scope);
  });

  server.get('/api/v1/marketplace/publishers/:id', async (request) => {
    const { scope } = marketplaceContext(request, options, 'read');
    const { id } = request.params as { id: string };
    return options.service.getPublisher(scope, id);
  });

  server.post('/api/v1/marketplace/publishers', async (request, reply) => {
    const { context, scope } = marketplaceContext(request, options, 'manage');
    return reply
      .status(201)
      .send(
        await options.service.registerPublisher(
          scope,
          context.principal.id,
          parsePublisher(request.body),
        ),
      );
  });

  server.post('/api/v1/marketplace/publishers/:id/challenge', async (request, reply) => {
    const { scope } = marketplaceContext(request, options, 'manage');
    const { id } = request.params as { id: string };
    return reply.status(201).send(await options.service.issueDomainChallenge(scope, id));
  });

  server.post('/api/v1/marketplace/publishers/:id/verify-domain', async (request) => {
    const { scope } = marketplaceContext(request, options, 'manage');
    const { id } = request.params as { id: string };
    return options.service.verifyPublisherDomain(scope, id);
  });

  server.post('/api/v1/marketplace/publishers/:id/approve', async (request) => {
    const { context, scope } = marketplaceContext(request, options, 'review');
    const { id } = request.params as { id: string };
    const body = bodyOf(request);
    return options.service.approvePublisher({
      scope,
      publisherId: id,
      actorId: context.principal.id,
      evidenceReference: requiredString(body.evidenceReference, 'evidenceReference'),
      reason: requiredString(body.reason, 'reason'),
    });
  });

  server.post('/api/v1/marketplace/publishers/:id/suspend', async (request) => {
    const { context, scope } = marketplaceContext(request, options, 'review');
    const { id } = request.params as { id: string };
    const body = bodyOf(request);
    return options.service.suspendPublisher({
      scope,
      publisherId: id,
      actorId: context.principal.id,
      reason: requiredString(body.reason, 'reason'),
    });
  });

  server.post('/api/v1/marketplace/releases', async (request, reply) => {
    const { context, scope } = marketplaceContext(request, options, 'manage');
    return reply.status(201).send(
      await options.service.submitRelease({
        scope,
        actorId: context.principal.id,
        submission: parseRelease(request.body),
      }),
    );
  });

  server.post('/api/v1/marketplace/releases/:id/review', async (request) => {
    const { context, scope } = marketplaceContext(request, options, 'review');
    const { id } = request.params as { id: string };
    return options.service.reviewRelease({ scope, releaseId: id, actorId: context.principal.id });
  });

  for (const action of ['approve', 'reject', 'yank'] as const) {
    server.post(`/api/v1/marketplace/releases/:id/${action}`, async (request) => {
      const { context, scope } = marketplaceContext(request, options, 'review');
      const { id } = request.params as { id: string };
      const body = bodyOf(request);
      return options.service[
        action === 'approve'
          ? 'approveRelease'
          : action === 'reject'
            ? 'rejectRelease'
            : 'yankRelease'
      ]({
        scope,
        releaseId: id,
        actorId: context.principal.id,
        reason: requiredString(body.reason, 'reason'),
      });
    });
  }

  server.post('/api/v1/marketplace/releases/:id/install', async (request, reply) => {
    const { context, scope } = marketplaceContext(request, options, 'read');
    const { id } = request.params as { id: string };
    authorize(options.policy, context, GridStoryActions.pluginManage, { kind: 'plugin' });
    const body = bodyOf(request);
    const grants = pluginCapabilityGrantSchema.array().safeParse(body.grantedCapabilities);
    if (!grants.success) {
      throw new GridStoryError(
        'Plugin capability grants are invalid.',
        'invalid_plugin_grants',
        400,
        {
          issues: grants.error.issues,
        },
      );
    }
    const release = await options.service.getApprovedRelease(scope, id);
    return reply.status(201).send(
      await options.plugins.install({
        scope,
        manifest: release.manifest,
        artifactDigest: release.manifest.package.sha256,
        grantedCapabilities: grants.data,
        actorId: context.principal.id,
        reason: requiredString(body.reason, 'reason'),
      }),
    );
  });
}
