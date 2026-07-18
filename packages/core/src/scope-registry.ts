import type {
  ContentPerspective,
  PlatformTopology,
  Principal,
  RequestContext,
} from '@gridstory/schema';
import { GridStoryError } from './errors.js';

export interface ResolveContextInput {
  organizationId: string;
  tenantId: string;
  workspaceId: string;
  siteId: string;
  environmentId: string;
  locale: string;
  perspective: ContentPerspective;
  principal: Principal;
}

export class InvalidScopeError extends GridStoryError {
  constructor(message: string) {
    super(message, 'invalid_scope', 400);
    this.name = 'InvalidScopeError';
  }
}

export class ScopeRegistry {
  readonly #topology: PlatformTopology;

  constructor(topology: PlatformTopology) {
    this.#topology = structuredClone(topology);
  }

  topology(): PlatformTopology {
    return structuredClone(this.#topology);
  }

  resolve(input: ResolveContextInput): RequestContext {
    const organization = this.#topology.organizations.find(
      (candidate) => candidate.id === input.organizationId,
    );
    if (organization?.status !== 'active') {
      throw new InvalidScopeError('Organization is not active or does not exist.');
    }
    const tenant = this.#topology.tenants.find((candidate) => candidate.id === input.tenantId);
    if (!tenant || tenant.organizationId !== organization.id || tenant.status !== 'active') {
      throw new InvalidScopeError('Tenant does not belong to the active organization.');
    }
    const workspace = this.#topology.workspaces.find(
      (candidate) => candidate.id === input.workspaceId,
    );
    if (!workspace || workspace.tenantId !== tenant.id || workspace.status !== 'active') {
      throw new InvalidScopeError('Workspace does not belong to the active tenant.');
    }
    const site = this.#topology.sites.find((candidate) => candidate.id === input.siteId);
    if (!site || site.workspaceId !== workspace.id || site.status !== 'active') {
      throw new InvalidScopeError('Site does not belong to the active workspace.');
    }
    const environment = this.#topology.environments.find(
      (candidate) => candidate.id === input.environmentId,
    );
    if (!environment || environment.siteId !== site.id) {
      throw new InvalidScopeError('Environment does not belong to the selected site.');
    }
    const locale = this.#topology.locales.find(
      (candidate) => candidate.siteId === site.id && candidate.code === input.locale,
    );
    if (!locale?.enabled)
      throw new InvalidScopeError('Locale is not enabled for the selected site.');

    return Object.freeze({ ...input, principal: Object.freeze({ ...input.principal }) });
  }
}

export function createLocalTopology(tenantId = 'default'): PlatformTopology {
  return {
    organizations: [{ id: 'local', name: 'Local organization', status: 'active' }],
    tenants: [{ id: tenantId, organizationId: 'local', name: 'Local tenant', status: 'active' }],
    workspaces: [{ id: 'default', tenantId, name: 'Default workspace', status: 'active' }],
    sites: [{ id: 'default', workspaceId: 'default', name: 'Default site', status: 'active' }],
    environments: [
      {
        id: 'development',
        siteId: 'default',
        name: 'Development',
        kind: 'development',
        status: 'active',
      },
      {
        id: 'production',
        siteId: 'default',
        name: 'Production',
        kind: 'production',
        status: 'active',
      },
    ],
    locales: [{ code: 'en', siteId: 'default', label: 'English', default: true, enabled: true }],
  };
}
