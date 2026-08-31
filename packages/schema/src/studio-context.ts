import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const label = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value);
const localeCode = identifier.regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);

export const studioScopeSchema = z
  .object({
    organizationId: identifier,
    tenantId: identifier,
    workspaceId: identifier,
    siteId: identifier,
    environmentId: identifier,
    locale: identifier,
  })
  .strict();

export const studioScopeSelectionSchema = studioScopeSchema.pick({
  siteId: true,
  environmentId: true,
  locale: true,
});
export type StudioScopeSelection = z.infer<typeof studioScopeSelectionSchema>;

export const studioDestinations = [
  'home',
  'pages',
  'collections',
  'menus',
  'schemas',
  'workflows',
  'releases',
  'search',
  'operations',
  'identity',
  'data-governance',
  'migrations',
  'marketplace',
  'targeting',
  'experiments',
  'ai-gateway',
  'knowledge',
  'quality',
  'federation',
  'fleet',
  'regions',
  'components',
  'assets',
  'settings',
] as const;
export type StudioDestinationId = (typeof studioDestinations)[number];

// Operation keys describe existing route checks, not new authorization actions.
// Typed page list/create are deliberately distinct from untyped entry/preview checks.
export const studioOperations = [
  'home.read',
  'settings.read',
  'pages.list',
  'pages.create',
  'content.create',
  'content.read',
  'content.draft.update',
  'content.publish',
  'content.history.read',
  'quality.read',
  'quality.assess',
  'preview.manage',
  'locales.read',
  'schema.read',
  'schema.plan',
  'schema.deploy',
  'component.read',
  'asset.read',
  'asset.create',
  'asset.update',
  'collaboration.read',
  'collaboration.write',
  'presence.write',
  'search.read',
  'search.manage',
  'search.related.read',
  'workflow.read',
  'workflow.manage',
  'workflow.transition',
  'workflow.approve',
  'workflow.schedule',
  'workflow.action.read',
  'workflow.action.run',
  'workflow.action.replay',
  'release.read',
  'release.manage',
  'release.execute',
  'release.schedule',
  'release.rollback',
  'operations.read',
  'operations.manage',
  'operations.run',
  'operations.replay',
  'portability.export',
  'portability.import',
  'audit.read',
  'audit.export',
  'identity.manage',
  'plugin.read',
  'plugin.manage',
  'plugin.invoke',
  'governance.read',
  'governance.manage',
  'governance.execute',
  'migration.read',
  'migration.manage',
  'migration.execute',
  'marketplace.read',
  'marketplace.manage',
  'marketplace.review',
  'personalization.read',
  'personalization.manage',
  'personalization.preview',
  'experiment.read',
  'experiment.manage',
  'experiment.metrics',
  'experiment.promote',
  'ai.read',
  'ai.manage',
  'ai.execute',
  'ai.review',
  'regional.read',
  'regional.manage',
  'regional.failover',
  'federation.read',
  'federation.manage',
  'federation.consume',
  'federation.sync',
  'knowledge.read',
  'agent.read',
  'agent.manage',
  'agent.plan',
  'agent.review',
  'agent.execute',
  'fleet.read',
  'fleet.manage',
  'fleet.check',
] as const;
export type StudioOperation = (typeof studioOperations)[number];

export const studioCapabilitiesSchema = z
  .object({
    screens: z.record(z.enum(studioDestinations), z.boolean()),
    operations: z.record(z.enum(studioOperations), z.boolean()),
  })
  .strict();
export type StudioCapabilities = z.infer<typeof studioCapabilitiesSchema>;

export const studioScopeChoiceSchema = z
  .object({
    scope: studioScopeSchema,
    labels: z.object({ site: label, environment: label, locale: label }).strict(),
  })
  .strict();
export type StudioScopeChoice = z.infer<typeof studioScopeChoiceSchema>;

export const studioContextSchema = z
  .object({
    version: z.literal(1),
    scope: studioScopeSchema,
    principalId: z.string().min(1).max(128),
    capabilities: studioCapabilitiesSchema,
    selection: z
      .object({
        mode: z.enum(['configured', 'current-only']),
        choices: z.array(studioScopeChoiceSchema).max(256),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = new Set<string>();
    for (const choice of value.selection.choices) {
      const scope = choice.scope;
      const key = JSON.stringify(scope);
      if (
        keys.has(key) ||
        scope.organizationId !== value.scope.organizationId ||
        scope.tenantId !== value.scope.tenantId ||
        scope.workspaceId !== value.scope.workspaceId ||
        (value.selection.mode === 'current-only' && key !== JSON.stringify(value.scope))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Studio choices must be unique and anchored to the current context.',
        });
      }
      keys.add(key);
    }
  });
export type StudioContext = z.infer<typeof studioContextSchema>;

const namedEntity = { id: identifier, name: label };
const activeStatus = z.enum(['active', 'suspended']);
const array = <T extends z.ZodType>(schema: T) => z.array(schema).max(256);

// Trusted deployment configuration only; this object must never be returned to Studio.
export const studioTopologySchema = z
  .object({
    organizations: array(z.object({ ...namedEntity, status: activeStatus }).strict()),
    tenants: array(
      z.object({ ...namedEntity, organizationId: identifier, status: activeStatus }).strict(),
    ),
    workspaces: array(
      z
        .object({ ...namedEntity, tenantId: identifier, status: z.enum(['active', 'archived']) })
        .strict(),
    ),
    sites: array(
      z
        .object({ ...namedEntity, workspaceId: identifier, status: z.enum(['active', 'archived']) })
        .strict(),
    ),
    environments: array(
      z
        .object({
          ...namedEntity,
          siteId: identifier,
          kind: z.enum(['development', 'preview', 'production']),
          status: z.enum(['active', 'locked']),
        })
        .strict(),
    ),
    locales: array(
      z
        .object({
          code: localeCode,
          siteId: identifier,
          label,
          default: z.boolean(),
          enabled: z.boolean(),
          fallbackLocale: localeCode.optional(),
          fallbackLocales: array(localeCode).optional(),
          routePrefix: z.string().max(256).optional(),
          required: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    const invalid = () =>
      context.addIssue({
        code: 'custom',
        message: 'Studio topology must have unique identifiers and valid ownership.',
      });
    for (const entities of [
      value.organizations,
      value.tenants,
      value.workspaces,
      value.sites,
      value.environments,
    ]) {
      if (new Set(entities.map((entity) => entity.id)).size !== entities.length) invalid();
    }
    if (
      new Set(value.locales.map((locale) => JSON.stringify([locale.siteId, locale.code]))).size !==
      value.locales.length
    )
      invalid();
    if (
      value.tenants.some(
        (tenant) => !value.organizations.some((org) => org.id === tenant.organizationId),
      ) ||
      value.workspaces.some(
        (workspace) => !value.tenants.some((tenant) => tenant.id === workspace.tenantId),
      ) ||
      value.sites.some(
        (site) => !value.workspaces.some((workspace) => workspace.id === site.workspaceId),
      ) ||
      value.environments.some(
        (environment) => !value.sites.some((site) => site.id === environment.siteId),
      ) ||
      value.locales.some((locale) => !value.sites.some((site) => site.id === locale.siteId))
    )
      invalid();
  });
