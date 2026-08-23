import { type AuthorizationPolicy, GridStoryActions, type MigrationService } from '@gridstory/core';
import {
  migrationPlanExecutionInputSchema,
  migrationProjectInputSchema,
  migrationProjectStateInputSchema,
  migrationRecipeInputSchema,
} from '@gridstory/schema';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorize, contentScope, requestContext } from './request-context.js';

interface MigrationRouteOptions {
  service: MigrationService;
  policy: AuthorizationPolicy;
}

function migrationContext(
  request: FastifyRequest,
  options: MigrationRouteOptions,
  action: 'read' | 'manage' | 'execute',
) {
  const context = requestContext(request, 'draft');
  authorize(
    options.policy,
    context,
    action === 'read'
      ? GridStoryActions.migrationRead
      : action === 'manage'
        ? GridStoryActions.migrationManage
        : GridStoryActions.migrationExecute,
    { kind: 'migration' },
  );
  return { context, scope: contentScope(context) };
}

export async function registerMigrationRoutes(
  server: FastifyInstance,
  options: MigrationRouteOptions,
): Promise<void> {
  server.get('/api/v1/migrations', async (request) => {
    const { scope } = migrationContext(request, options, 'read');
    return options.service.overview(scope);
  });
  server.put('/api/v1/migrations/recipes/:id', async (request) => {
    const { context, scope } = migrationContext(request, options, 'manage');
    const { id } = request.params as { id: string };
    const body = typeof request.body === 'object' && request.body ? request.body : {};
    return options.service.upsertRecipe(
      scope,
      context.principal.id,
      migrationRecipeInputSchema.parse({ ...body, id }),
    );
  });
  server.post('/api/v1/migrations/projects', async (request, reply) => {
    const { context, scope } = migrationContext(request, options, 'manage');
    return reply
      .status(201)
      .send(
        await options.service.createProject(
          scope,
          context.principal.id,
          migrationProjectInputSchema.parse(request.body),
        ),
      );
  });
  server.post('/api/v1/migrations/projects/:id/state', async (request) => {
    const { context, scope } = migrationContext(request, options, 'manage');
    const { id } = request.params as { id: string };
    const input = migrationProjectStateInputSchema.parse(request.body);
    return options.service.setProjectState(scope, context.principal.id, id, input.state);
  });
  server.post('/api/v1/migrations/projects/:id/plans', async (request, reply) => {
    const { context, scope } = migrationContext(request, options, 'manage');
    const { id } = request.params as { id: string };
    return reply.status(201).send(await options.service.planSync(scope, context.principal.id, id));
  });
  server.post('/api/v1/migrations/plans/:id/execute', async (request) => {
    const { context, scope } = migrationContext(request, options, 'execute');
    const { id } = request.params as { id: string };
    const input = migrationPlanExecutionInputSchema.parse(request.body);
    return options.service.executePlan(scope, context.principal, id, input.digest);
  });
  server.post('/api/v1/migrations/projects/:id/cutover-reports', async (request, reply) => {
    const { context, scope } = migrationContext(request, options, 'execute');
    const { id } = request.params as { id: string };
    return reply
      .status(201)
      .send(await options.service.validateCutover(scope, context.principal.id, id));
  });
}
