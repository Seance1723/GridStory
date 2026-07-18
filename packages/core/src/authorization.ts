import type { AuthorizationGrant, Principal, RequestContext } from '@gridstory/schema';
import { GridStoryError } from './errors.js';

export const GridStoryActions = {
  schemaRead: 'schema.read',
  schemaPlan: 'schema.plan',
  schemaDeploy: 'schema.deploy',
  componentRead: 'component.read',
  contentRead: 'content.read',
  contentCreate: 'content.create',
  contentDraftUpdate: 'content.draft.update',
  contentPublish: 'content.publish',
  contentHistoryRead: 'content.history.read',
  deliveryRead: 'delivery.read',
  operationsRead: 'operations.read',
  operationsManage: 'operations.manage',
  operationsRun: 'operations.run',
  operationsReplay: 'operations.replay',
  portabilityExport: 'portability.export',
  portabilityImport: 'portability.import',
  auditRead: 'audit.read',
  auditExport: 'audit.export',
} as const;

export type GridStoryAction = (typeof GridStoryActions)[keyof typeof GridStoryActions];

export interface AuthorizationResource {
  kind: 'schema' | 'component' | 'content' | 'delivery' | 'platform';
  id?: string;
  contentType?: string;
  ownerId?: string;
  attributes?: Record<string, string | string[] | boolean | number>;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
  matchedRole?: string;
  matchedGrant?: AuthorizationGrant;
}

export interface RoleDefinition {
  id: string;
  actions: Array<GridStoryAction | '*'>;
}

export class AuthorizationError extends GridStoryError {
  constructor(action: GridStoryAction) {
    super(`Principal is not authorized to perform ${action}.`, 'forbidden', 403, { action });
    this.name = 'AuthorizationError';
  }
}

export const defaultRoles: RoleDefinition[] = [
  { id: 'admin', actions: ['*'] },
  {
    id: 'viewer',
    actions: [
      GridStoryActions.schemaRead,
      GridStoryActions.componentRead,
      GridStoryActions.contentRead,
      GridStoryActions.contentHistoryRead,
    ],
  },
  {
    id: 'author',
    actions: [
      GridStoryActions.schemaRead,
      GridStoryActions.componentRead,
      GridStoryActions.contentRead,
      GridStoryActions.contentHistoryRead,
      GridStoryActions.contentCreate,
      GridStoryActions.contentDraftUpdate,
    ],
  },
  {
    id: 'publisher',
    actions: [
      GridStoryActions.schemaRead,
      GridStoryActions.componentRead,
      GridStoryActions.contentRead,
      GridStoryActions.contentHistoryRead,
      GridStoryActions.contentCreate,
      GridStoryActions.contentDraftUpdate,
      GridStoryActions.contentPublish,
    ],
  },
  { id: 'delivery', actions: [GridStoryActions.deliveryRead] },
  { id: 'anonymous', actions: [GridStoryActions.deliveryRead] },
];

function includesAction(actions: string[], action: GridStoryAction): boolean {
  return actions.includes('*') || actions.includes(action);
}

function grantMatches(
  grant: AuthorizationGrant,
  context: RequestContext,
  action: GridStoryAction,
  resource: AuthorizationResource,
): boolean {
  if (!includesAction(grant.actions, action)) return false;
  if (grant.organizationId && grant.organizationId !== context.organizationId) return false;
  if (grant.tenantId && grant.tenantId !== context.tenantId) return false;
  if (grant.workspaceId && grant.workspaceId !== context.workspaceId) return false;
  if (grant.siteId && grant.siteId !== context.siteId) return false;
  if (grant.environmentIds && !grant.environmentIds.includes(context.environmentId)) return false;
  if (grant.locales && !grant.locales.includes(context.locale)) return false;
  if (grant.contentTypes && !resource.contentType) return false;
  if (grant.contentTypes && !grant.contentTypes.includes(resource.contentType ?? '')) return false;
  return true;
}

export class AuthorizationPolicy {
  readonly #roles: ReadonlyMap<string, RoleDefinition>;

  constructor(roles: RoleDefinition[] = defaultRoles) {
    this.#roles = new Map(roles.map((role) => [role.id, role]));
  }

  decide(
    context: RequestContext,
    action: GridStoryAction,
    resource: AuthorizationResource,
  ): AuthorizationDecision {
    for (const roleId of context.principal.roles) {
      const role = this.#roles.get(roleId);
      if (role && includesAction(role.actions, action)) {
        return { allowed: true, reason: `Allowed by role ${roleId}.`, matchedRole: roleId };
      }
    }
    for (const grant of context.principal.grants ?? []) {
      if (grantMatches(grant, context, action, resource)) {
        return {
          allowed: true,
          reason: 'Allowed by a scoped principal grant.',
          matchedGrant: grant,
        };
      }
    }
    return { allowed: false, reason: 'Denied by default because no role or scoped grant matched.' };
  }

  assert(context: RequestContext, action: GridStoryAction, resource: AuthorizationResource): void {
    if (!this.decide(context, action, resource).allowed) throw new AuthorizationError(action);
  }

  principalForDevelopment(id: string, roles: string[] = ['admin']): Principal {
    return { id, type: 'user', roles, authenticationMethod: 'development' };
  }
}
