import {
  type AuthorizationPolicy,
  GridStoryActions,
  GridStoryError,
  type KnowledgeService,
} from '@gridstory/core';
import {
  knowledgeAgentExecuteInputSchema,
  knowledgeAgentPlanRequestSchema,
  knowledgeAgentPolicyInputSchema,
  knowledgeAgentReviewInputSchema,
  knowledgeGraphQuerySchema,
  knowledgeRecommendationQuerySchema,
} from '@gridstory/schema';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface KnowledgeRouteOptions {
  service: KnowledgeService;
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
    throw new GridStoryError('Knowledge request is invalid.', 'invalid_knowledge_request', 400, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function privateResponse(reply: FastifyReply): void {
  reply.header('cache-control', 'private, no-store');
  reply.header('vary', 'authorization, cookie');
}

export async function registerKnowledgeRoutes(
  server: FastifyInstance,
  options: KnowledgeRouteOptions,
): Promise<void> {
  const authorizer = (context: ReturnType<typeof requestContext>) => ({
    canRead(entry: { id: string; contentType: string }) {
      return options.policy.decide(context, GridStoryActions.contentRead, {
        kind: 'content',
        id: entry.id,
        contentType: entry.contentType,
      }).allowed;
    },
  });

  server.post('/api/v1/knowledge/graph', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.knowledgeRead, { kind: 'knowledge' });
    privateResponse(reply);
    return options.service.exploreGraph({
      scope: contentScope(context),
      query: parseBody(knowledgeGraphQuerySchema, request.body),
      authorizer: authorizer(context),
    });
  });

  server.post('/api/v1/knowledge/recommendations', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.knowledgeRead, { kind: 'knowledge' });
    privateResponse(reply);
    return options.service.recommend({
      scope: contentScope(context),
      query: parseBody(knowledgeRecommendationQuerySchema, request.body),
      authorizer: authorizer(context),
    });
  });

  server.get('/api/v1/knowledge/agent', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.agentRead, { kind: 'agent' });
    privateResponse(reply);
    return options.service.snapshot(contentScope(context));
  });

  server.put('/api/v1/knowledge/agent/policy', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.agentManage, { kind: 'agent' });
    privateResponse(reply);
    return options.service.updatePolicy(
      contentScope(context),
      parseBody(knowledgeAgentPolicyInputSchema, request.body),
      context.principal.id,
    );
  });

  server.post('/api/v1/knowledge/agent/plans', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.agentPlan, { kind: 'agent' });
    const input = parseBody(knowledgeAgentPlanRequestSchema, request.body);
    authorize(options.policy, context, GridStoryActions.contentRead, {
      kind: 'content',
      id: input.targetEntryId,
    });
    privateResponse(reply);
    const document = await options.service.createPlan({
      scope: contentScope(context),
      request: input,
      actorId: context.principal.id,
      authorizer: authorizer(context),
    });
    return reply.status(201).send(document);
  });

  server.post('/api/v1/knowledge/agent/plans/:planId/review', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.agentReview, { kind: 'agent' });
    const params = request.params as { planId: string };
    const snapshot = await options.service.snapshot(contentScope(context));
    const plan = snapshot.plans.find((candidate) => candidate.id === params.planId);
    if (plan) {
      authorize(options.policy, context, GridStoryActions.contentRead, {
        kind: 'content',
        id: plan.target.entryId,
        contentType: plan.target.contentType,
      });
    }
    privateResponse(reply);
    return options.service.reviewPlan({
      scope: contentScope(context),
      planId: params.planId,
      review: parseBody(knowledgeAgentReviewInputSchema, request.body),
      actorId: context.principal.id,
      principalType: context.principal.type,
    });
  });

  server.post('/api/v1/knowledge/agent/plans/:planId/execute', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.agentExecute, { kind: 'agent' });
    const params = request.params as { planId: string };
    const snapshot = await options.service.snapshot(contentScope(context));
    const plan = snapshot.plans.find((candidate) => candidate.id === params.planId);
    if (plan) {
      authorize(options.policy, context, GridStoryActions.contentDraftUpdate, {
        kind: 'content',
        id: plan.target.entryId,
        contentType: plan.target.contentType,
      });
    }
    privateResponse(reply);
    return options.service.executePlan({
      scope: contentScope(context),
      planId: params.planId,
      execution: parseBody(knowledgeAgentExecuteInputSchema, request.body),
      actor: { id: context.principal.id, roles: context.principal.roles },
      principalType: context.principal.type,
    });
  });
}
