import { z } from 'zod';
import { canonicalStringify } from './canonical.js';
import { resourceLimits } from './resource-limits.js';

export const PLUGIN_MANIFEST_FORMAT = 'gridstory.plugin' as const;
export const PLUGIN_MANIFEST_VERSION = 1 as const;
export const PLUGIN_PROTOCOL_VERSION = 1 as const;
export const GRIDSTORY_PLUGIN_SDK_VERSION = '1.0.0' as const;

export const pluginCapabilityNames = [
  'schema.read',
  'content.read',
  'content.draft.write',
  'asset.read',
  'asset.write',
  'workflow.transition',
  'search.read',
  'events.subscribe',
  'jobs.enqueue',
  'network.request',
  'secrets.read',
  'studio.embed',
] as const;

export const pluginCapabilityNameSchema = z.enum(pluginCapabilityNames);
export type PluginCapabilityName = z.output<typeof pluginCapabilityNameSchema>;

const identifierSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const httpsUrlSchema = z
  .url()
  .max(500)
  .refine((value) => new URL(value).protocol === 'https:', 'URL must use HTTPS.');
const exactHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?=.{1,253}$)(?![-.])[a-z0-9.-]+(?<![-.])$/);
const contentScopeSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  environmentId: z.string().min(1),
  locale: z.string().min(1),
});

export const pluginMarketplaceCategorySchema = z.enum([
  'authoring',
  'assets',
  'automation',
  'delivery',
  'governance',
  'integration',
  'localization',
  'search',
]);

function compareSemver(left: string, right: string): number {
  const leftParts = (left.split('-', 1)[0] ?? '').split('.').map(Number);
  const rightParts = (right.split('-', 1)[0] ?? '').split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export const pluginMarketplaceMetadataSchema = z
  .object({
    categories: z.array(pluginMarketplaceCategorySchema).min(1).max(5),
    keywords: z
      .array(identifierSchema)
      .max(resourceLimits.marketplace.maximumKeywords)
      .refine((values) => new Set(values).size === values.length, 'Keywords must be unique.'),
    homepageUrl: httpsUrlSchema,
    documentationUrl: httpsUrlSchema,
    repositoryUrl: httpsUrlSchema,
    compatibility: z
      .object({
        gridstory: z
          .object({ minVersion: semverSchema, maxVersionExclusive: semverSchema })
          .strict(),
        testedRuntimes: z
          .array(
            z
              .object({
                runtime: z.enum(['node', 'browser']),
                version: z.string().min(1).max(50),
                testedAt: z.string().datetime(),
                evidenceUrl: httpsUrlSchema,
              })
              .strict(),
          )
          .min(1)
          .max(resourceLimits.marketplace.maximumTestedRuntimes),
      })
      .strict(),
    support: z
      .object({
        status: z.enum(['maintained', 'community', 'deprecated']),
        policyUrl: httpsUrlSchema,
        contactUrl: httpsUrlSchema,
        supportedUntil: z.string().datetime().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((metadata, context) => {
    const categories = new Set(metadata.categories);
    if (categories.size !== metadata.categories.length) {
      context.addIssue({
        code: 'custom',
        path: ['categories'],
        message: 'Marketplace categories must be unique.',
      });
    }
    const range = metadata.compatibility.gridstory;
    if (compareSemver(range.minVersion, range.maxVersionExclusive) >= 0) {
      context.addIssue({
        code: 'custom',
        path: ['compatibility', 'gridstory'],
        message: 'GridStory compatibility maximum must be greater than the minimum.',
      });
    }
  });

export type PluginMarketplaceMetadata = z.output<typeof pluginMarketplaceMetadataSchema>;

export const pluginCapabilityConstraintsSchema = z
  .object({
    contentTypes: z.array(identifierSchema).max(100).optional(),
    networkHosts: z.array(exactHostSchema).max(50).optional(),
    secretNames: z.array(identifierSchema).max(50).optional(),
    eventTypes: z.array(identifierSchema).max(100).optional(),
  })
  .strict();

export const pluginCapabilityGrantSchema = z
  .object({
    capability: pluginCapabilityNameSchema,
    constraints: pluginCapabilityConstraintsSchema.optional(),
  })
  .strict()
  .superRefine((grant, context) => {
    const requiredConstraint =
      grant.capability === 'network.request'
        ? 'networkHosts'
        : grant.capability === 'secrets.read'
          ? 'secretNames'
          : grant.capability === 'events.subscribe'
            ? 'eventTypes'
            : undefined;
    if (requiredConstraint && !grant.constraints?.[requiredConstraint]?.length) {
      context.addIssue({
        code: 'custom',
        path: ['constraints', requiredConstraint],
        message: `${grant.capability} requires a non-empty ${requiredConstraint} allow-list.`,
      });
    }
  });

export type PluginCapabilityGrant = z.output<typeof pluginCapabilityGrantSchema>;

const serverRuntimeSchema = z
  .object({
    isolation: z.literal('external'),
    protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
  })
  .strict();

const studioRuntimeSchema = z
  .object({
    isolation: z.literal('sandboxed-frame'),
    protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
    entrypoint: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z0-9_./-]+$/),
  })
  .strict();

const unsignedPluginManifestSchema = z
  .object({
    format: z.literal(PLUGIN_MANIFEST_FORMAT),
    manifestVersion: z.literal(PLUGIN_MANIFEST_VERSION),
    id: identifierSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(500),
    version: semverSchema,
    publisher: z.object({ id: identifierSchema, name: z.string().min(1).max(120) }).strict(),
    sdk: z.object({ minVersion: semverSchema, maxVersionExclusive: semverSchema }).strict(),
    package: z
      .object({
        sha256: sha256Schema,
        sizeBytes: z.number().int().positive().max(resourceLimits.plugins.maximumArtifactBytes),
      })
      .strict(),
    runtimes: z
      .object({ server: serverRuntimeSchema.optional(), studio: studioRuntimeSchema.optional() })
      .strict(),
    requestedCapabilities: z.array(pluginCapabilityGrantSchema).max(pluginCapabilityNames.length),
    operations: z.array(identifierSchema).min(1).max(100),
    configurationSchema: z.record(z.string(), z.unknown()).optional(),
    marketplace: pluginMarketplaceMetadataSchema.optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (!manifest.runtimes.server && !manifest.runtimes.studio) {
      context.addIssue({
        code: 'custom',
        path: ['runtimes'],
        message: 'At least one plugin runtime must be declared.',
      });
    }
    const capabilities = manifest.requestedCapabilities.map(({ capability }) => capability);
    const duplicateCapability = capabilities.find(
      (value, index) => capabilities.indexOf(value) !== index,
    );
    if (duplicateCapability) {
      context.addIssue({
        code: 'custom',
        path: ['requestedCapabilities'],
        message: `${duplicateCapability} is duplicated.`,
      });
    }
    const duplicateOperation = manifest.operations.find(
      (value, index) => manifest.operations.indexOf(value) !== index,
    );
    if (duplicateOperation) {
      context.addIssue({
        code: 'custom',
        path: ['operations'],
        message: `${duplicateOperation} is duplicated.`,
      });
    }
  });

export const signedPluginManifestSchema = unsignedPluginManifestSchema.safeExtend({
  signature: z
    .object({
      algorithm: z.literal('ed25519'),
      keyId: identifierSchema,
      value: z
        .string()
        .min(40)
        .max(512)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict(),
});

export type UnsignedPluginManifest = z.output<typeof unsignedPluginManifestSchema>;
export type SignedPluginManifest = z.output<typeof signedPluginManifestSchema>;

export function pluginManifestSigningPayload(manifest: SignedPluginManifest): string {
  const { signature: _signature, ...unsigned } = signedPluginManifestSchema.parse(manifest);
  return canonicalStringify(unsigned);
}

export const pluginInstallationStateSchema = z.enum([
  'installed',
  'enabled',
  'disabled',
  'revoked',
  'uninstalled',
]);

export const pluginLifecycleEventSchema = z
  .object({
    id: identifierSchema,
    action: z.enum(['installed', 'enabled', 'disabled', 'revoked', 'uninstalled']),
    actorId: z.string().min(1).max(128),
    reason: z.string().min(1).max(500),
    occurredAt: z.string().datetime(),
  })
  .strict();

export const pluginInstallationSchema = contentScopeSchema.extend({
  id: identifierSchema,
  manifest: signedPluginManifestSchema,
  artifactDigest: sha256Schema,
  state: pluginInstallationStateSchema,
  grantedCapabilities: z.array(pluginCapabilityGrantSchema).max(pluginCapabilityNames.length),
  installedAt: z.string().datetime(),
  installedBy: z.string().min(1).max(128),
  updatedAt: z.string().datetime(),
  events: z.array(pluginLifecycleEventSchema).min(1).max(1000),
});

export type PluginInstallation = z.output<typeof pluginInstallationSchema>;
export type PluginInstallationState = z.output<typeof pluginInstallationStateSchema>;
export type PluginLifecycleEvent = z.output<typeof pluginLifecycleEventSchema>;

export const pluginInvocationSchema = z
  .object({
    operation: identifierSchema,
    capability: pluginCapabilityNameSchema,
    input: z.record(z.string(), z.unknown()),
  })
  .strict();

export const pluginInvocationResultSchema = z
  .object({
    output: z.record(z.string(), z.unknown()),
  })
  .strict();

export type PluginInvocation = z.output<typeof pluginInvocationSchema>;
export type PluginInvocationResult = z.output<typeof pluginInvocationResultSchema>;

export const pluginUninstallPreviewSchema = z.object({
  pluginId: identifierSchema,
  state: pluginInstallationStateSchema,
  externalDataDeletionRequired: z.boolean(),
  retainedLifecycleEvents: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type PluginUninstallPreview = z.output<typeof pluginUninstallPreviewSchema>;
