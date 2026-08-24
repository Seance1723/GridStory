import {
  type AiGatewayService,
  type AuthorizationPolicy,
  type ContentService,
  GridStoryActions,
  GridStoryError,
} from '@gridstory/core';
import {
  aiGatewayPolicyInputSchema,
  aiGatewayStateInputSchema,
  aiGenerateInputSchema,
  aiPromptActivationInputSchema,
  aiPromptVersionInputSchema,
} from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface AiRouteOptions {
  service: AiGatewayService;
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
      sourceReader: {
        async read(source) {
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
      },
    });
  });
}
