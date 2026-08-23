import {
  type AuthorizationPolicy,
  GridStoryActions,
  GridStoryError,
  type PersonalizationService,
} from '@gridstory/core';
import {
  personalizationConfigurationSchema,
  personalizationDecisionRequestSchema,
  personalizationPreviewRequestSchema,
} from '@gridstory/schema';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface PersonalizationRouteOptions {
  service: PersonalizationService;
  policy: AuthorizationPolicy;
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
    throw new GridStoryError('A JSON request body is required.', 'invalid_request', 400);
  }
  return request.body as Record<string, unknown>;
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new GridStoryError(`${name} must be a non-negative integer.`, 'invalid_request', 400);
  }
  return value;
}

function managementContext(
  request: FastifyRequest,
  options: PersonalizationRouteOptions,
  action: 'read' | 'manage' | 'preview',
) {
  const context = requestContext(request, 'draft');
  authorize(
    options.policy,
    context,
    action === 'read'
      ? GridStoryActions.personalizationRead
      : action === 'manage'
        ? GridStoryActions.personalizationManage
        : GridStoryActions.personalizationPreview,
    { kind: 'personalization' },
  );
  return { context, scope: contentScope(context) };
}

function parseConfiguration(value: unknown) {
  const parsed = personalizationConfigurationSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError(
    'Personalization configuration is invalid.',
    'invalid_personalization_configuration',
    400,
    { issues: parsed.error.issues },
  );
}

function parseDecision(value: unknown) {
  const parsed = personalizationDecisionRequestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError(
    'Personalization decision request is invalid.',
    'invalid_personalization_decision',
    400,
    { issues: parsed.error.issues },
  );
}

function parsePreview(value: unknown) {
  const parsed = personalizationPreviewRequestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new GridStoryError(
    'Personalization preview request is invalid.',
    'invalid_personalization_preview',
    400,
    { issues: parsed.error.issues },
  );
}

export async function registerPersonalizationRoutes(
  server: FastifyInstance,
  options: PersonalizationRouteOptions,
): Promise<void> {
  server.get('/api/v1/personalization', async (request) => {
    const { context, scope } = managementContext(request, options, 'read');
    return options.service.overview(scope, context.principal.id);
  });

  server.put('/api/v1/personalization/draft', async (request) => {
    const { context, scope } = managementContext(request, options, 'manage');
    const body = bodyOf(request);
    return options.service.replaceDraft({
      scope,
      actorId: context.principal.id,
      expectedVersion: requiredInteger(body.expectedVersion, 'expectedVersion'),
      configuration: parseConfiguration(body.configuration),
    });
  });

  server.post('/api/v1/personalization/publish', async (request) => {
    const { context, scope } = managementContext(request, options, 'manage');
    const body = bodyOf(request);
    return options.service.publish({
      scope,
      actorId: context.principal.id,
      expectedVersion: requiredInteger(body.expectedVersion, 'expectedVersion'),
      expectedDraftRevision: requiredInteger(body.expectedDraftRevision, 'expectedDraftRevision'),
    });
  });

  server.post('/api/v1/personalization/preview', async (request) => {
    const { scope } = managementContext(request, options, 'preview');
    return options.service.preview(scope, parsePreview(request.body));
  });

  server.post('/api/v1/personalization/decide', async (request) => {
    const context = requestContext(request, 'published', true);
    authorize(options.policy, context, GridStoryActions.deliveryRead, {
      kind: 'personalization',
    });
    const parsed = parseDecision(request.body);
    const secGpc = request.headers['sec-gpc'];
    return options.service.decidePublished(contentScope(context), {
      ...parsed,
      consent: {
        ...parsed.consent,
        globalPrivacyControl: parsed.consent.globalPrivacyControl || secGpc === '1',
      },
    });
  });
}
