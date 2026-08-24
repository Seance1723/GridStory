import { type FleetService, GridStoryActions, GridStoryError } from '@gridstory/core';
import {
  type FleetExpectedVersionInput,
  fleetExpectedVersionInputSchema,
  type FleetMemberInput,
  fleetMemberInputSchema,
  type FleetMemberStateInput,
  fleetMemberStateInputSchema,
  type InteroperabilityDiscovery,
  type InteroperabilitySpecification,
  canonicalStringify,
  interoperabilitySpecificationKindSchema,
  sha256,
} from '@gridstory/schema';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';
import type { AuthorizationPolicy } from '@gridstory/core';

interface InteroperabilityRouteOptions {
  discovery: InteroperabilityDiscovery;
  specifications: InteroperabilitySpecification[];
  fleet: FleetService;
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
    throw new GridStoryError('Fleet request is invalid.', 'invalid_fleet_request', 400, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function sendCacheable(
  request: FastifyRequest,
  reply: FastifyReply,
  value: unknown,
  digest: string,
  cacheControl: string,
  contentType: string,
) {
  const etag = `"sha256-${digest}"`;
  reply.header('cache-control', cacheControl);
  reply.header('etag', etag);
  reply.type(contentType);
  if (request.headers['if-none-match'] === etag) return reply.status(304).send();
  return reply.send(value);
}

export async function registerInteroperabilityRoutes(
  server: FastifyInstance,
  options: InteroperabilityRouteOptions,
): Promise<void> {
  const descriptorDigest = sha256(canonicalStringify(options.discovery));

  server.get('/api/v1/interoperability', async (request, reply) =>
    sendCacheable(
      request,
      reply,
      options.discovery,
      descriptorDigest,
      'public, max-age=60',
      'application/json',
    ),
  );

  server.get('/api/v1/interoperability/specifications/:kind/:version', async (request, reply) => {
    const params = request.params as { kind: string; version: string };
    const kind = interoperabilitySpecificationKindSchema.safeParse(params.kind);
    if (!kind.success || params.version !== '1') {
      throw new GridStoryError('Interoperability specification was not found.', 'not_found', 404);
    }
    const specification = options.specifications.find(
      (candidate) => candidate.kind === kind.data && candidate.version === 1,
    );
    if (!specification) {
      throw new GridStoryError('Interoperability specification was not found.', 'not_found', 404);
    }
    return sendCacheable(
      request,
      reply,
      specification.schema,
      specification.digest,
      'public, max-age=31536000, immutable',
      'application/schema+json',
    );
  });

  server.get('/api/v1/fleet', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.fleetRead, { kind: 'fleet' });
    reply.header('cache-control', 'private, no-store');
    return options.fleet.snapshot(contentScope(context));
  });

  server.put('/api/v1/fleet/members/:memberId', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.fleetManage, { kind: 'fleet' });
    const params = request.params as { memberId: string };
    reply.header('cache-control', 'private, no-store');
    return options.fleet.upsertMember({
      scope: contentScope(context),
      memberId: params.memberId,
      member: parseBody<FleetMemberInput>(fleetMemberInputSchema, request.body),
      actorId: context.principal.id,
    });
  });

  server.post('/api/v1/fleet/members/:memberId/state', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.fleetManage, { kind: 'fleet' });
    const params = request.params as { memberId: string };
    reply.header('cache-control', 'private, no-store');
    return options.fleet.setMemberState({
      scope: contentScope(context),
      memberId: params.memberId,
      state: parseBody<FleetMemberStateInput>(fleetMemberStateInputSchema, request.body),
      actorId: context.principal.id,
    });
  });

  server.delete('/api/v1/fleet/members/:memberId', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.fleetManage, { kind: 'fleet' });
    const params = request.params as { memberId: string };
    const body = parseBody<FleetExpectedVersionInput>(
      fleetExpectedVersionInputSchema,
      request.body,
    );
    reply.header('cache-control', 'private, no-store');
    return options.fleet.removeMember({
      scope: contentScope(context),
      memberId: params.memberId,
      expectedVersion: body.expectedVersion,
      actorId: context.principal.id,
    });
  });

  server.post('/api/v1/fleet/members/:memberId/check', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.fleetCheck, { kind: 'fleet' });
    const params = request.params as { memberId: string };
    const body = parseBody<FleetExpectedVersionInput>(
      fleetExpectedVersionInputSchema,
      request.body,
    );
    reply.header('cache-control', 'private, no-store');
    return options.fleet.checkMember({
      scope: contentScope(context),
      memberId: params.memberId,
      expectedVersion: body.expectedVersion,
      actorId: context.principal.id,
    });
  });
}
