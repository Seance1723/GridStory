import {
  type AuthorizationPolicy,
  type AuthorizationResource,
  type GridStoryAction,
  GridStoryError,
  LocaleRegistry,
  ScopeRegistry,
  contentScopeKey,
} from '@gridstory/core';
import {
  type LocaleConfiguration,
  type PlatformTopology,
  type RequestContext,
  type StudioCapabilities,
  type StudioContext,
  type StudioOperation,
  type StudioScopeChoice,
  studioContextSchema,
  studioOperations,
  studioTopologySchema,
} from '@gridstory/schema';
import { hasIdentityAdministrationAccess } from './identity-routes.js';
import { contentScope } from './request-context.js';

// These are policy preconditions, not guarantees of entry existence, workflow readiness,
// step-up or provider availability. Routes continue to enforce every operation themselves.
const checks: Record<
  Exclude<StudioOperation, 'home.read' | 'settings.read' | 'identity.manage'>,
  readonly [GridStoryAction, AuthorizationResource]
> = {
  'pages.list': ['content.read', { kind: 'content', contentType: 'page' }],
  'pages.create': ['content.create', { kind: 'content', contentType: 'page' }],
  'content.create': ['content.create', { kind: 'content' }],
  'quality.read': ['content.read', { kind: 'content' }],
  'quality.assess': ['content.draft.update', { kind: 'content' }],
  'preview.manage': ['content.read', { kind: 'content' }],
  'locales.read': ['content.read', { kind: 'platform' }],
  'search.related.read': ['search.read', { kind: 'content' }],
  'schema.read': ['schema.read', { kind: 'schema' }],
  'schema.plan': ['schema.plan', { kind: 'schema' }],
  'schema.deploy': ['schema.deploy', { kind: 'schema' }],
  'component.read': ['component.read', { kind: 'component' }],
  'asset.read': ['asset.read', { kind: 'asset' }],
  'asset.create': ['asset.create', { kind: 'asset' }],
  'asset.update': ['asset.update', { kind: 'asset' }],
  'content.read': ['content.read', { kind: 'content' }],
  'content.draft.update': ['content.draft.update', { kind: 'content' }],
  'content.publish': ['content.publish', { kind: 'content' }],
  'content.history.read': ['content.history.read', { kind: 'content' }],
  'collaboration.read': ['collaboration.read', { kind: 'content' }],
  'collaboration.write': ['collaboration.write', { kind: 'content' }],
  'presence.write': ['presence.write', { kind: 'content' }],
  'search.read': ['search.read', { kind: 'search' }],
  'search.manage': ['search.manage', { kind: 'search' }],
  'workflow.read': ['workflow.read', { kind: 'workflow' }],
  'workflow.manage': ['workflow.manage', { kind: 'workflow' }],
  'workflow.transition': ['workflow.transition', { kind: 'workflow' }],
  'workflow.approve': ['workflow.approve', { kind: 'workflow' }],
  'workflow.schedule': ['workflow.schedule', { kind: 'workflow' }],
  'workflow.action.read': ['workflow.action.read', { kind: 'workflow' }],
  'workflow.action.run': ['workflow.action.run', { kind: 'workflow' }],
  'workflow.action.replay': ['workflow.action.replay', { kind: 'workflow' }],
  'release.read': ['release.read', { kind: 'release' }],
  'release.manage': ['release.manage', { kind: 'release' }],
  'release.execute': ['release.execute', { kind: 'release' }],
  'release.schedule': ['release.schedule', { kind: 'release' }],
  'release.rollback': ['release.rollback', { kind: 'release' }],
  'operations.read': ['operations.read', { kind: 'platform' }],
  'operations.manage': ['operations.manage', { kind: 'platform' }],
  'operations.run': ['operations.run', { kind: 'platform' }],
  'operations.replay': ['operations.replay', { kind: 'platform' }],
  'portability.export': ['portability.export', { kind: 'platform' }],
  'portability.import': ['portability.import', { kind: 'platform' }],
  'audit.read': ['audit.read', { kind: 'platform' }],
  'audit.export': ['audit.export', { kind: 'platform' }],
  'plugin.read': ['plugin.read', { kind: 'plugin' }],
  'plugin.manage': ['plugin.manage', { kind: 'plugin' }],
  'plugin.invoke': ['plugin.invoke', { kind: 'plugin' }],
  'governance.read': ['governance.read', { kind: 'governance' }],
  'governance.manage': ['governance.manage', { kind: 'governance' }],
  'governance.execute': ['governance.execute', { kind: 'governance' }],
  'migration.read': ['migration.read', { kind: 'migration' }],
  'migration.manage': ['migration.manage', { kind: 'migration' }],
  'migration.execute': ['migration.execute', { kind: 'migration' }],
  'marketplace.read': ['marketplace.read', { kind: 'marketplace' }],
  'marketplace.manage': ['marketplace.manage', { kind: 'marketplace' }],
  'marketplace.review': ['marketplace.review', { kind: 'marketplace' }],
  'personalization.read': ['personalization.read', { kind: 'personalization' }],
  'personalization.manage': ['personalization.manage', { kind: 'personalization' }],
  'personalization.preview': ['personalization.preview', { kind: 'personalization' }],
  'experiment.read': ['experiment.read', { kind: 'experiment' }],
  'experiment.manage': ['experiment.manage', { kind: 'experiment' }],
  'experiment.metrics': ['experiment.metrics', { kind: 'experiment' }],
  'experiment.promote': ['experiment.promote', { kind: 'experiment' }],
  'ai.read': ['ai.read', { kind: 'ai' }],
  'ai.manage': ['ai.manage', { kind: 'ai' }],
  'ai.execute': ['ai.execute', { kind: 'ai' }],
  'ai.review': ['ai.review', { kind: 'ai' }],
  'regional.read': ['regional.read', { kind: 'regional' }],
  'regional.manage': ['regional.manage', { kind: 'regional' }],
  'regional.failover': ['regional.failover', { kind: 'regional' }],
  'federation.read': ['federation.read', { kind: 'federation' }],
  'federation.manage': ['federation.manage', { kind: 'federation' }],
  'federation.consume': ['federation.consume', { kind: 'federation' }],
  'federation.sync': ['federation.sync', { kind: 'federation' }],
  'knowledge.read': ['knowledge.read', { kind: 'knowledge' }],
  'agent.read': ['agent.read', { kind: 'agent' }],
  'agent.manage': ['agent.manage', { kind: 'agent' }],
  'agent.plan': ['agent.plan', { kind: 'agent' }],
  'agent.review': ['agent.review', { kind: 'agent' }],
  'agent.execute': ['agent.execute', { kind: 'agent' }],
  'fleet.read': ['fleet.read', { kind: 'fleet' }],
  'fleet.manage': ['fleet.manage', { kind: 'fleet' }],
  'fleet.check': ['fleet.check', { kind: 'fleet' }],
};

export function studioCapabilities(
  context: RequestContext,
  policy: AuthorizationPolicy,
): StudioCapabilities {
  const operations = Object.fromEntries(
    studioOperations.map((operation) => {
      if (operation === 'home.read') return [operation, false];
      if (operation === 'settings.read') return [operation, false];
      if (operation === 'identity.manage')
        return [operation, hasIdentityAdministrationAccess(context.principal)];
      const [action, resource] = checks[operation];
      return [operation, policy.decide(context, action, resource).allowed];
    }),
  ) as StudioCapabilities['operations'];
  operations['home.read'] =
    operations['pages.list'] ||
    operations['content.read'] ||
    operations['workflow.read'] ||
    operations['release.read'] ||
    operations['operations.read'];
  operations['settings.read'] =
    operations['locales.read'] || operations['schema.read'] || operations['asset.read'];
  return {
    operations,
    screens: {
      home: operations['home.read'],
      pages: operations['pages.list'],
      collections: operations['content.read'] && operations['schema.read'],
      schemas: operations['schema.read'],
      workflows: operations['workflow.read'],
      releases: operations['release.read'],
      search: operations['search.read'],
      operations: operations['operations.read'],
      identity: operations['identity.manage'],
      'data-governance': operations['governance.read'],
      migrations: operations['migration.read'],
      marketplace: operations['marketplace.read'],
      targeting: operations['personalization.read'],
      experiments: operations['experiment.read'],
      'ai-gateway': operations['ai.read'],
      knowledge: operations['knowledge.read'] || operations['agent.read'],
      quality: operations['quality.read'],
      federation: operations['federation.read'],
      fleet: operations['fleet.read'],
      regions: operations['regional.read'],
      components: operations['component.read'],
      assets: operations['asset.read'],
      settings: operations['settings.read'],
    },
  };
}

function configurationError(): Error {
  return new Error(
    'GRIDSTORY_STUDIO_TOPOLOGY_JSON must be a valid bounded topology consistent with configured locales.',
  );
}

function localeIdentity(locale: LocaleConfiguration): string {
  return JSON.stringify([
    locale.siteId,
    locale.code,
    locale.label,
    locale.default,
    locale.enabled,
    locale.required ?? false,
    locale.routePrefix === '/' ? '' : (locale.routePrefix ?? ''),
    [
      ...new Set([
        ...(locale.fallbackLocales ?? []),
        ...(locale.fallbackLocale ? [locale.fallbackLocale] : []),
      ]),
    ],
  ]);
}

function topologyChoices(topology: PlatformTopology): StudioScopeChoice[] {
  const choices: StudioScopeChoice[] = [];
  for (const site of topology.sites) {
    const workspace = topology.workspaces.find((item) => item.id === site.workspaceId);
    const tenant = topology.tenants.find((item) => item.id === workspace?.tenantId);
    const organization = topology.organizations.find((item) => item.id === tenant?.organizationId);
    if (
      site.status !== 'active' ||
      workspace?.status !== 'active' ||
      tenant?.status !== 'active' ||
      organization?.status !== 'active'
    )
      continue;
    for (const environment of topology.environments.filter(
      (item) => item.siteId === site.id && item.status === 'active',
    )) {
      for (const locale of topology.locales.filter(
        (item) => item.siteId === site.id && item.enabled,
      )) {
        choices.push({
          scope: {
            organizationId: organization.id,
            tenantId: tenant.id,
            workspaceId: workspace.id,
            siteId: site.id,
            environmentId: environment.id,
            locale: locale.code,
          },
          labels: { site: site.name, environment: environment.name, locale: locale.label },
        });
        if (choices.length > 256) throw configurationError();
      }
    }
  }
  return choices;
}

export function validateStudioTopology(
  value: unknown,
  locales: LocaleConfiguration[],
): PlatformTopology {
  const parsed = studioTopologySchema.safeParse(value);
  if (!parsed.success) throw configurationError();
  const topology: PlatformTopology = {
    ...parsed.data,
    locales: parsed.data.locales.map(
      ({ fallbackLocale, fallbackLocales, routePrefix, required, ...locale }) => ({
        ...locale,
        ...(fallbackLocale !== undefined ? { fallbackLocale } : {}),
        ...(fallbackLocales !== undefined ? { fallbackLocales } : {}),
        ...(routePrefix !== undefined ? { routePrefix } : {}),
        ...(required !== undefined ? { required } : {}),
      }),
    ),
  };
  try {
    new LocaleRegistry(locales);
    for (const locale of topology.locales) {
      const actual = locales.find(
        (item) => item.siteId === locale.siteId && item.code === locale.code,
      );
      if (!actual || localeIdentity(actual) !== localeIdentity(locale)) throw configurationError();
    }
    topologyChoices(topology);
  } catch {
    // Never expose raw deployment values, validator input, or internal topology identifiers.
    throw configurationError();
  }
  return topology;
}

export class StudioContextProjection {
  readonly #policy: AuthorizationPolicy;
  readonly #registry: ScopeRegistry | undefined;
  readonly #choices: StudioScopeChoice[];

  constructor(policy: AuthorizationPolicy, topology?: PlatformTopology) {
    this.#policy = policy;
    this.#registry = topology ? new ScopeRegistry(topology) : undefined;
    this.#choices = topology ? topologyChoices(topology) : [];
  }

  project(context: RequestContext): StudioContext {
    if (this.#registry) {
      try {
        this.#registry.resolve(context);
        if (
          !this.#choices.some(
            (choice) => contentScopeKey(choice.scope) === contentScopeKey(context),
          )
        ) {
          throw new Error('Not selectable');
        }
      } catch {
        throw new GridStoryError(
          'Studio context is unavailable.',
          'studio_context_unavailable',
          403,
        );
      }
    }
    const scope = contentScope(context);
    const capabilities = studioCapabilities(context, this.#policy);
    const usable = (value: StudioCapabilities) => Object.values(value.screens).some(Boolean);
    const choices = this.#registry
      ? this.#choices.filter(
          (choice) =>
            choice.scope.organizationId === scope.organizationId &&
            choice.scope.tenantId === scope.tenantId &&
            choice.scope.workspaceId === scope.workspaceId &&
            usable(studioCapabilities({ ...context, ...choice.scope }, this.#policy)),
        )
      : usable(capabilities)
        ? [
            {
              scope,
              labels: {
                site: scope.siteId,
                environment: scope.environmentId,
                locale: scope.locale,
              },
            },
          ]
        : [];
    // Parsing also returns a detached value: callers cannot mutate the configured catalog.
    return studioContextSchema.parse({
      version: 1,
      scope,
      principalId: context.principal.id,
      capabilities,
      selection: { mode: this.#registry ? 'configured' : 'current-only', choices },
    });
  }
}
