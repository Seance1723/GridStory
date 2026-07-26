import type {
  AuthorizationGrant,
  Principal,
  RequestContext,
  RoleAssignment,
} from '@gridstory/schema';
import { GridStoryError } from './errors.js';

export const GridStoryActions = {
  schemaRead: 'schema.read',
  schemaPlan: 'schema.plan',
  schemaDeploy: 'schema.deploy',
  componentRead: 'component.read',
  assetRead: 'asset.read',
  assetCreate: 'asset.create',
  assetUpdate: 'asset.update',
  collaborationRead: 'collaboration.read',
  collaborationWrite: 'collaboration.write',
  presenceWrite: 'presence.write',
  contentRead: 'content.read',
  contentCreate: 'content.create',
  contentDraftUpdate: 'content.draft.update',
  contentPublish: 'content.publish',
  contentHistoryRead: 'content.history.read',
  searchRead: 'search.read',
  searchManage: 'search.manage',
  workflowRead: 'workflow.read',
  workflowManage: 'workflow.manage',
  workflowTransition: 'workflow.transition',
  workflowApprove: 'workflow.approve',
  workflowSchedule: 'workflow.schedule',
  workflowActionRead: 'workflow.action.read',
  workflowActionRun: 'workflow.action.run',
  workflowActionReplay: 'workflow.action.replay',
  releaseRead: 'release.read',
  releaseManage: 'release.manage',
  releaseExecute: 'release.execute',
  releaseSchedule: 'release.schedule',
  releaseRollback: 'release.rollback',
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
  kind:
    | 'schema'
    | 'component'
    | 'asset'
    | 'content'
    | 'search'
    | 'workflow'
    | 'release'
    | 'delivery'
    | 'platform';
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
      GridStoryActions.assetRead,
      GridStoryActions.contentRead,
      GridStoryActions.contentHistoryRead,
      GridStoryActions.searchRead,
      GridStoryActions.workflowRead,
      GridStoryActions.releaseRead,
      GridStoryActions.collaborationRead,
    ],
  },
  {
    id: 'author',
    actions: [
      GridStoryActions.schemaRead,
      GridStoryActions.componentRead,
      GridStoryActions.assetRead,
      GridStoryActions.assetCreate,
      GridStoryActions.assetUpdate,
      GridStoryActions.contentRead,
      GridStoryActions.contentHistoryRead,
      GridStoryActions.searchRead,
      GridStoryActions.contentCreate,
      GridStoryActions.contentDraftUpdate,
      GridStoryActions.workflowRead,
      GridStoryActions.workflowTransition,
      GridStoryActions.releaseRead,
      GridStoryActions.releaseManage,
      GridStoryActions.collaborationRead,
      GridStoryActions.collaborationWrite,
      GridStoryActions.presenceWrite,
    ],
  },
  {
    id: 'publisher',
    actions: [
      GridStoryActions.schemaRead,
      GridStoryActions.componentRead,
      GridStoryActions.assetRead,
      GridStoryActions.assetCreate,
      GridStoryActions.assetUpdate,
      GridStoryActions.contentRead,
      GridStoryActions.contentHistoryRead,
      GridStoryActions.searchRead,
      GridStoryActions.contentCreate,
      GridStoryActions.contentDraftUpdate,
      GridStoryActions.contentPublish,
      GridStoryActions.workflowRead,
      GridStoryActions.workflowTransition,
      GridStoryActions.workflowApprove,
      GridStoryActions.workflowSchedule,
      GridStoryActions.releaseRead,
      GridStoryActions.releaseManage,
      GridStoryActions.releaseExecute,
      GridStoryActions.releaseSchedule,
      GridStoryActions.releaseRollback,
      GridStoryActions.collaborationRead,
      GridStoryActions.collaborationWrite,
      GridStoryActions.presenceWrite,
    ],
  },
  { id: 'delivery', actions: [GridStoryActions.deliveryRead] },
  { id: 'anonymous', actions: [GridStoryActions.deliveryRead] },
];

function includesAction(actions: string[], action: GridStoryAction): boolean {
  return actions.includes('*') || actions.includes(action);
}

function assignmentScopeMatches(
  assignment: Omit<AuthorizationGrant, 'actions'>,
  context: RequestContext,
  resource: AuthorizationResource,
): boolean {
  if (assignment.organizationId && assignment.organizationId !== context.organizationId)
    return false;
  if (assignment.tenantId && assignment.tenantId !== context.tenantId) return false;
  if (assignment.workspaceId && assignment.workspaceId !== context.workspaceId) return false;
  if (assignment.siteId && assignment.siteId !== context.siteId) return false;
  if (assignment.environmentIds && !assignment.environmentIds.includes(context.environmentId)) {
    return false;
  }
  if (assignment.locales && !assignment.locales.includes(context.locale)) return false;
  if (assignment.contentTypes && !resource.contentType) return false;
  if (assignment.contentTypes && !assignment.contentTypes.includes(resource.contentType ?? '')) {
    return false;
  }
  return true;
}

function grantMatches(
  grant: AuthorizationGrant,
  context: RequestContext,
  action: GridStoryAction,
  resource: AuthorizationResource,
): boolean {
  return includesAction(grant.actions, action) && assignmentScopeMatches(grant, context, resource);
}

function roleAssignmentMatches(
  assignment: RoleAssignment,
  context: RequestContext,
  resource: AuthorizationResource,
): boolean {
  return assignmentScopeMatches(assignment, context, resource);
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
    for (const assignment of context.principal.roleAssignments ?? []) {
      const role = this.#roles.get(assignment.roleId);
      if (
        role &&
        includesAction(role.actions, action) &&
        roleAssignmentMatches(assignment, context, resource)
      ) {
        return {
          allowed: true,
          reason: `Allowed by scoped role ${assignment.roleId}.`,
          matchedRole: assignment.roleId,
        };
      }
    }
    const acceptsLegacyRoles =
      context.principal.authenticationMethod === 'development' ||
      context.principal.authenticationMethod === 'anonymous';
    if (acceptsLegacyRoles) {
      for (const roleId of context.principal.roles) {
        const role = this.#roles.get(roleId);
        if (role && includesAction(role.actions, action)) {
          return { allowed: true, reason: `Allowed by role ${roleId}.`, matchedRole: roleId };
        }
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
