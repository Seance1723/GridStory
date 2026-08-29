import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const label = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value);
const readOnly = {
  ownership: z.enum(['code', 'operator', 'editor']),
  mutable: z.literal(false),
};
const contentScopeSchema = z
  .object({
    organizationId: identifier,
    tenantId: identifier,
    workspaceId: identifier,
    siteId: identifier,
    environmentId: identifier,
    locale: identifier,
  })
  .strict();
const unavailableSectionSchema = z
  .object({
    availability: z.literal('unavailable'),
    reason: z.literal('not-authorized'),
  })
  .strict();
const siteSchema = z.object({ ...readOnly, id: identifier, label }).strict();
const environmentSchema = z
  .object({
    ...readOnly,
    id: identifier,
    label,
    kind: z.enum(['development', 'preview', 'production', 'not-declared']),
  })
  .strict();
const localeSchema = z
  .object({
    ...readOnly,
    code: identifier,
    label,
    default: z.boolean(),
    required: z.boolean(),
    routePrefix: z.string().max(256),
    fallbackLocales: z.array(identifier).max(256),
  })
  .strict();

const localesAndEnvironmentsAvailableSchema = z
  .object({
    availability: z.literal('available'),
    ownership: z.literal('operator'),
    mutable: z.literal(false),
    coverage: z.enum(['configured', 'current-only']),
    current: z
      .object({
        site: siteSchema,
        environment: environmentSchema,
        locale: localeSchema,
      })
      .strict(),
    environments: z.array(environmentSchema).max(256),
    locales: z.array(localeSchema).max(256),
  })
  .strict();

const modelSchema = z
  .object({
    ...readOnly,
    ownership: z.literal('code'),
    id: identifier,
    name: label,
    version: z.number().int().positive(),
    collection: identifier,
    route: z
      .object({ pattern: z.string().startsWith('/').max(256), slugField: identifier })
      .strict()
      .optional(),
    localizedFields: z.array(identifier).max(256),
  })
  .strict();
const modelsAndRoutesAvailableSchema = z
  .object({
    availability: z.literal('available'),
    ownership: z.literal('code'),
    mutable: z.literal(false),
    models: z.array(modelSchema).max(256),
  })
  .strict();

const providerBase = { ...readOnly, ownership: z.literal('operator') };
const storageProviderSchema = z
  .object({
    ...providerBase,
    kind: z.literal('storage'),
    mode: z.enum(['built-in-local', 'configured']),
  })
  .strict();
const contentInspectionProviderSchema = z
  .object({
    ...providerBase,
    kind: z.literal('content-inspection'),
    mode: z.enum(['built-in', 'configured']),
  })
  .strict();
const optionalMediaProviderSchema = (kind: 'rendition' | 'malware-scanning') =>
  z
    .object({
      ...providerBase,
      kind: z.literal(kind),
      mode: z.enum(['configured', 'unavailable']),
    })
    .strict();
const providerSchema = z.union([
  storageProviderSchema,
  contentInspectionProviderSchema,
  optionalMediaProviderSchema('rendition'),
  optionalMediaProviderSchema('malware-scanning'),
]);
const mediaPolicyAndProvidersAvailableSchema = z
  .object({
    availability: z.literal('available'),
    ownership: z.literal('code'),
    mutable: z.literal(false),
    policy: z
      .object({
        ...readOnly,
        ownership: z.literal('code'),
        supportedKinds: z.array(z.enum(['image', 'video', 'file'])).length(3),
        maximumUploadBytes: z.number().int().positive(),
        uploadPartBytes: z.number().int().positive(),
        maximumDimensionPixels: z.number().int().positive(),
        maximumParts: z.number().int().positive(),
        deliveryRequiresVerified: z.literal(true),
        renditionsRequireVerified: z.literal(true),
      })
      .strict(),
    providers: z.tuple([
      storageProviderSchema,
      contentInspectionProviderSchema,
      optionalMediaProviderSchema('rendition'),
      optionalMediaProviderSchema('malware-scanning'),
    ]),
  })
  .strict();

export const configurationInventorySchema = z
  .object({
    version: z.literal(1),
    scope: contentScopeSchema,
    sections: z
      .object({
        localesAndEnvironments: z.union([
          localesAndEnvironmentsAvailableSchema,
          unavailableSectionSchema,
        ]),
        modelsAndRoutes: z.union([modelsAndRoutesAvailableSchema, unavailableSectionSchema]),
        mediaPolicyAndProviders: z.union([
          mediaPolicyAndProvidersAvailableSchema,
          unavailableSectionSchema,
        ]),
      })
      .strict(),
  })
  .strict();

export type ConfigurationInventory = z.infer<typeof configurationInventorySchema>;
export type ConfigurationInventoryEnvironment = z.infer<typeof environmentSchema>;
export type ConfigurationInventoryLocale = z.infer<typeof localeSchema>;
export type ConfigurationInventoryProvider = z.infer<typeof providerSchema>;
