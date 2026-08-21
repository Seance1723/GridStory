import {
  type AuthorizationPolicy,
  type AuthorizationResource,
  assertValidContentScope,
  type GridStoryAction,
} from '@gridstory/core';
import type {
  ContentPerspective,
  ContentScope,
  Principal,
  PrincipalType,
  RequestContext,
} from '@gridstory/schema';
import type { FastifyRequest } from 'fastify';

interface BoundRequestIdentity {
  organizationId: string;
  tenantId: string;
  principal: Principal;
}

const boundIdentities = new WeakMap<FastifyRequest, BoundRequestIdentity>();

export function bindRequestIdentity(request: FastifyRequest, identity: BoundRequestIdentity): void {
  boundIdentities.set(request, identity);
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function principal(request: FastifyRequest, publicRequest: boolean): Principal {
  const authenticated = boundIdentities.get(request);
  if (authenticated) return authenticated.principal;
  const actorId = header(request, 'x-gridstory-actor');
  if (publicRequest && !actorId) {
    return {
      id: 'anonymous',
      type: 'anonymous',
      roles: ['anonymous'],
      authenticationMethod: 'anonymous',
    };
  }
  const principalType = header(request, 'x-gridstory-principal-type');
  const type: PrincipalType = principalType === 'service-account' ? 'service-account' : 'user';
  return {
    id: actorId ?? 'local-admin',
    type,
    roles: (header(request, 'x-gridstory-roles') ?? 'admin')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
    authenticationMethod: 'development',
  };
}

export function requestContext(
  request: FastifyRequest,
  perspective: ContentPerspective,
  publicRequest = false,
): RequestContext {
  const authenticated = boundIdentities.get(request);
  const scope = assertValidContentScope({
    organizationId:
      authenticated?.organizationId ?? header(request, 'x-gridstory-organization') ?? 'local',
    tenantId: authenticated?.tenantId ?? header(request, 'x-gridstory-tenant') ?? 'default',
    workspaceId: header(request, 'x-gridstory-workspace') ?? 'default',
    siteId: header(request, 'x-gridstory-site') ?? 'default',
    environmentId: header(request, 'x-gridstory-environment') ?? 'development',
    locale: header(request, 'x-gridstory-locale') ?? 'en',
  });
  return {
    ...scope,
    perspective,
    principal: principal(request, publicRequest),
  };
}

export function authorize(
  policy: AuthorizationPolicy,
  context: RequestContext,
  action: GridStoryAction,
  resource: AuthorizationResource,
): RequestContext {
  policy.assert(context, action, resource);
  return context;
}

export function contentScope(context: RequestContext): ContentScope {
  const { organizationId, tenantId, workspaceId, siteId, environmentId, locale } = context;
  return { organizationId, tenantId, workspaceId, siteId, environmentId, locale };
}
