import {
  type AiAuthoringService,
  type AiGatewayService,
  type AuthorizationPolicy,
  type ContentService,
  GridStoryActions,
  GridStoryError,
} from '@gridstory/core';
import {
  aiGatewayPolicyInputSchema,
  aiGatewayStateInputSchema,
  aiAuthoringPolicyInputSchema,
  aiAuthoringProposalInputSchema,
  aiAuthoringReviewInputSchema,
  aiGenerateInputSchema,
  aiPromptActivationInputSchema,
  aiPromptVersionInputSchema,
  aiSemanticQuerySchema,
} from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface AiRouteOptions {
  service: AiGatewayService;
  authoring: AiAuthoringService;
  content: ContentService;
  policy: AuthorizationPolicy;
}

interface BodySchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: unknown } };
}

function parseBody<T>(schema: BodySchema<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new GridStoryError('AI gateway request is invalid.', code, 400, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export async function registerAiRoutes(
  server: FastifyInstance,
  options: AiRouteOptions,
): Promise<void> {
  const sourceReader = (
    context: ReturnType<typeof requestContext>,
    scope: ReturnType<typeof contentScope>,
  ) => ({
    async read(source: {
      scope: ReturnType<typeof contentScope>;
      id: string;
      perspective: 'published' | 'draft';
    }) {
      authorize(options.policy, context, GridStoryActions.contentRead, {
        kind: 'content',
        id: source.id,
      });
      const entry = await options.content.get(source).catch((error: unknown) => {
        if (error instanceof GridStoryError && error.code === 'not_found') return null;
        throw error;
      });
      if (!entry) return null;
      authorize(options.policy, context, GridStoryActions.contentRead, {
        kind: 'content',
        id: entry.id,
        contentType: entry.contentType,
      });
      const revisionId =
        source.perspective === 'published' ? entry.publishedRevisionId : entry.draftRevisionId;
      if (!revisionId) return null;
      return {
        ...scope,
        id: entry.id,
        contentType: entry.contentType,
        revisionId,
        data: entry.data,
      };
    },
  });

  server.get('/api/v1/ai', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiRead, { kind: 'ai' });
    return options.service.snapshot(contentScope(context));
  });

  server.put('/api/v1/ai/policy', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiManage, { kind: 'ai' });
    const input = parseBody(aiGatewayPolicyInputSchema, request.body, 'invalid_ai_policy');
    return options.service.updatePolicy(contentScope(context), input);
  });

  server.post('/api/v1/ai/prompts', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiManage, { kind: 'ai' });
    const input = parseBody(aiPromptVersionInputSchema, request.body, 'invalid_ai_prompt');
    const document = await options.service.createPromptVersion(
      contentScope(context),
      input,
      context.principal.id,
    );
    return reply.status(201).send(document);
  });

  server.post('/api/v1/ai/prompts/:promptId/versions/:version/activate', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiManage, { kind: 'ai' });
    const params = request.params as { promptId: string; version: string };
    const version = Number(params.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new GridStoryError('Prompt version is invalid.', 'invalid_ai_prompt', 400);
    }
    const input = parseBody(
      aiPromptActivationInputSchema,
      request.body,
      'invalid_ai_prompt_activation',
    );
    return options.service.activatePrompt(
      contentScope(context),
      params.promptId,
      version,
      input.expectedVersion,
    );
  });

  server.post('/api/v1/ai/kill-switch', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiManage, { kind: 'ai' });
    const input = parseBody(aiGatewayStateInputSchema, request.body, 'invalid_ai_gateway_state');
    return options.service.setState(contentScope(context), input, context.principal.id);
  });

  server.post('/api/v1/ai/generate', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiExecute, { kind: 'ai' });
    const scope = contentScope(context);
    const input = parseBody(aiGenerateInputSchema, request.body, 'invalid_ai_request');
    return options.service.execute({
      scope,
      request: input,
      sourceReader: sourceReader(context, scope),
    });
  });

  server.get('/api/v1/ai/authoring', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiRead, { kind: 'ai' });
    return options.authoring.snapshot(contentScope(context));
  });

  server.put('/api/v1/ai/authoring/policy', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiManage, { kind: 'ai' });
    const input = parseBody(
      aiAuthoringPolicyInputSchema,
      request.body,
      'invalid_ai_authoring_policy',
    );
    return options.authoring.updatePolicy(contentScope(context), input);
  });

  server.post('/api/v1/ai/authoring/proposals', async (request, reply) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiExecute, { kind: 'ai' });
    const scope = contentScope(context);
    const input = parseBody(
      aiAuthoringProposalInputSchema,
      request.body,
      'invalid_ai_authoring_proposal',
    );
    authorize(options.policy, context, GridStoryActions.contentRead, {
      kind: 'content',
      id: input.targetEntryId,
    });
    const target = await options.content.get({
      scope,
      id: input.targetEntryId,
      perspective: 'draft',
    });
    authorize(options.policy, context, GridStoryActions.contentRead, {
      kind: 'content',
      id: target.id,
      contentType: target.contentType,
    });
    const document = await options.authoring.createProposal({
      scope,
      actorId: context.principal.id,
      proposal: input,
      sourceReader: sourceReader(context, scope),
    });
    return reply.status(201).send(document);
  });

  server.post('/api/v1/ai/authoring/proposals/:proposalId/review', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiReview, { kind: 'ai' });
    const params = request.params as { proposalId: string };
    const input = parseBody(
      aiAuthoringReviewInputSchema,
      request.body,
      'invalid_ai_authoring_review',
    );
    const scope = contentScope(context);
    const proposal = (await options.authoring.snapshot(scope)).proposals.find(
      (candidate) => candidate.id === params.proposalId,
    );
    if (proposal) {
      authorize(options.policy, context, GridStoryActions.contentRead, {
        kind: 'content',
        id: proposal.target.entryId,
        contentType: proposal.target.contentType,
      });
    }
    return options.authoring.reviewProposal({
      scope,
      proposalId: params.proposalId,
      actorId: context.principal.id,
      principalType: context.principal.type,
      review: input,
    });
  });

  server.post('/api/v1/ai/semantic/search', async (request) => {
    const context = requestContext(request, 'draft');
    authorize(options.policy, context, GridStoryActions.aiRead, { kind: 'ai' });
    const input = parseBody(aiSemanticQuerySchema, request.body, 'invalid_ai_semantic_query');
    return options.authoring.semanticSearch({
      scope: contentScope(context),
      query: input,
      authorizer: {
        authorize(entry) {
          authorize(options.policy, context, GridStoryActions.contentRead, {
            kind: 'content',
            id: entry.id,
            contentType: entry.contentType,
          });
        },
      },
    });
  });
}
