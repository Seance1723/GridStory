import {
  type AuthorizationPolicy,
  type GovernanceService,
  GridStoryActions,
} from '@gridstory/core';
import {
  dataSubjectInputSchema,
  dataSubjectRequestInputSchema,
  governanceExportInputSchema,
  governancePlanApprovalInputSchema,
  governancePolicyInputSchema,
  governanceReasonInputSchema,
  governanceRequestReviewInputSchema,
  governanceRequestVerificationInputSchema,
  legalHoldInputSchema,
  subjectResourceLinkInputSchema,
} from '@gridstory/schema';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  authorize,
  contentScope,
  requestContext,
  requestReauthenticationTime,
} from './request-context.js';

interface GovernanceRouteOptions {
  service: GovernanceService;
  policy: AuthorizationPolicy;
}

function governed(
  request: FastifyRequest,
  options: GovernanceRouteOptions,
  action: 'read' | 'manage' | 'execute',
) {
  const context = requestContext(request, 'draft');
  authorize(
    options.policy,
    context,
    action === 'read'
      ? GridStoryActions.governanceRead
      : action === 'manage'
        ? GridStoryActions.governanceManage
        : GridStoryActions.governanceExecute,
    { kind: 'governance' },
  );
  return { context, scope: contentScope(context) };
}

export async function registerGovernanceRoutes(
  server: FastifyInstance,
  options: GovernanceRouteOptions,
): Promise<void> {
  server.get('/api/v1/governance', async (request) => {
    const { scope } = governed(request, options, 'read');
    return options.service.snapshot(scope);
  });
  server.put('/api/v1/governance/policy', async (request) => {
    const { context, scope } = governed(request, options, 'manage');
    return options.service.savePolicy(
      scope,
      context.principal.id,
      governancePolicyInputSchema.parse(request.body),
    );
  });
  server.post('/api/v1/governance/subjects', async (request, reply) => {
    const { context, scope } = governed(request, options, 'manage');
    const input = dataSubjectInputSchema.parse(request.body);
    return reply
      .status(201)
      .send(await options.service.createSubject(scope, context.principal.id, input.reference));
  });
  server.post('/api/v1/governance/subjects/:id/links', async (request, reply) => {
    const { context, scope } = governed(request, options, 'manage');
    const { id } = request.params as { id: string };
    return reply
      .status(201)
      .send(
        await options.service.linkSubjectResource(
          scope,
          context.principal.id,
          id,
          subjectResourceLinkInputSchema.parse(request.body),
        ),
      );
  });
  server.post('/api/v1/governance/holds', async (request, reply) => {
    const { context, scope } = governed(request, options, 'manage');
    return reply
      .status(201)
      .send(
        await options.service.createHold(
          scope,
          context.principal.id,
          legalHoldInputSchema.parse(request.body),
        ),
      );
  });
  server.post('/api/v1/governance/holds/:id/release', async (request) => {
    const { context, scope } = governed(request, options, 'manage');
    const { id } = request.params as { id: string };
    const input = governanceReasonInputSchema.parse(request.body);
    return options.service.releaseHold(scope, context.principal.id, id, input.reason);
  });
  server.post('/api/v1/governance/requests', async (request, reply) => {
    const { context, scope } = governed(request, options, 'manage');
    return reply
      .status(201)
      .send(
        await options.service.createRequest(
          scope,
          context.principal.id,
          dataSubjectRequestInputSchema.parse(request.body),
        ),
      );
  });
  server.post('/api/v1/governance/requests/:id/verify', async (request) => {
    const { context, scope } = governed(request, options, 'manage');
    const { id } = request.params as { id: string };
    return options.service.verifyRequest(
      scope,
      context.principal.id,
      id,
      governanceRequestVerificationInputSchema.parse(request.body),
    );
  });
  server.post('/api/v1/governance/requests/:id/review', async (request) => {
    const { context, scope } = governed(request, options, 'manage');
    const { id } = request.params as { id: string };
    return options.service.reviewRequest(
      scope,
      context.principal.id,
      id,
      governanceRequestReviewInputSchema.parse(request.body),
    );
  });
  server.post('/api/v1/governance/requests/:id/plan', async (request, reply) => {
    const { context, scope } = governed(request, options, 'manage');
    const { id } = request.params as { id: string };
    return reply
      .status(201)
      .send(await options.service.createErasurePlan(scope, context.principal.id, id));
  });
  server.post('/api/v1/governance/retention/plans', async (request, reply) => {
    const { context, scope } = governed(request, options, 'manage');
    return reply
      .status(201)
      .send(await options.service.createRetentionPlan(scope, context.principal.id));
  });
  server.post('/api/v1/governance/plans/:id/approve', async (request) => {
    const { context, scope } = governed(request, options, 'execute');
    const { id } = request.params as { id: string };
    const input = governancePlanApprovalInputSchema.parse(request.body);
    return options.service.approvePlan(scope, context.principal.id, id, {
      ...input,
      reauthenticatedAt: requestReauthenticationTime(request),
    });
  });
  server.post('/api/v1/governance/plans/process', async (request) => {
    const { context, scope } = governed(request, options, 'execute');
    return options.service.processApprovedPlans(scope, `api-${context.principal.id}`);
  });
  server.post('/api/v1/governance/requests/:id/export', async (request) => {
    const { context, scope } = governed(request, options, 'execute');
    const { id } = request.params as { id: string };
    const input = governanceExportInputSchema.parse(request.body ?? {});
    return options.service.exportRequest(scope, context.principal.id, id, input.encrypt);
  });
  server.get('/api/v1/governance/residency', async (request) => {
    const { scope } = governed(request, options, 'read');
    return options.service.residencyStatus(scope, 'write');
  });
}
