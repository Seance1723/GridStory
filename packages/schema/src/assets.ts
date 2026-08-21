import { z } from 'zod';
import { resourceLimits } from './resource-limits.js';

const contentScopeSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  environmentId: z.string().min(1),
  locale: z.string().min(1),
});

export const assetKindSchema = z.enum(['image', 'video', 'file']);

export const assetMalwareStatusSchema = z.enum(['not_configured', 'clean', 'infected', 'error']);

export const assetSecuritySchema = z.object({
  status: z.enum(['verified', 'quarantined']),
  declaredMediaType: z.string().min(1),
  detectedMediaType: z.string().min(1),
  sanitized: z.boolean().default(false),
  inspectedAt: z.string().datetime(),
  malware: z.object({
    status: assetMalwareStatusSchema,
    provider: z.string().min(1).optional(),
    signature: z.string().min(1).optional(),
    checkedAt: z.string().datetime().optional(),
  }),
  findings: z.array(z.string().min(1)).default([]),
});

export const assetFocalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const assetMetadataSchema = z.object({
  title: z.string().min(1),
  alt: z.string().optional(),
  caption: z.string().optional(),
  credit: z.string().optional(),
  rights: z.string().optional(),
  license: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  tags: z.array(z.string().min(1)).default([]),
  collections: z.array(z.string().min(1)).default([]),
  custom: z.record(z.string(), z.string()).default({}),
});

export const assetObjectSchema = z.object({
  objectKey: z.string().min(1),
  url: z.string().url(),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  size: z.number().int().nonnegative().max(resourceLimits.assets.maximumBytes),
  checksum: z.string().min(1),
  width: z.number().int().positive().max(resourceLimits.assets.maximumDimensionPixels).optional(),
  height: z.number().int().positive().max(resourceLimits.assets.maximumDimensionPixels).optional(),
});

export const assetRenditionPresetSchema = z
  .object({
    id: z.string().min(1),
    width: z.number().int().positive().max(resourceLimits.assets.maximumDimensionPixels).optional(),
    height: z
      .number()
      .int()
      .positive()
      .max(resourceLimits.assets.maximumDimensionPixels)
      .optional(),
    fit: z.enum(['cover', 'contain', 'crop']).default('cover'),
    format: z.enum(['original', 'jpeg', 'png', 'webp', 'avif']).default('original'),
    quality: z.number().int().min(1).max(100).default(80),
  })
  .refine((value) => value.width !== undefined || value.height !== undefined, {
    message: 'A rendition preset requires a width or height.',
  });

export const assetRenditionSchema = z.object({
  id: z.string().min(1),
  preset: assetRenditionPresetSchema,
  object: assetObjectSchema,
  createdAt: z.string().datetime(),
});

export const assetRevisionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  original: assetObjectSchema,
  metadata: assetMetadataSchema,
  focalPoint: assetFocalPointSchema.optional(),
  createdAt: z.string().datetime(),
  security: assetSecuritySchema.optional(),
  actorId: z.string().min(1),
});

export const assetRecordSchema = contentScopeSchema.extend({
  id: z.string().min(1),
  kind: assetKindSchema,
  currentRevisionId: z.string().min(1),
  revisions: z.array(assetRevisionSchema).min(1),
  renditions: z.array(assetRenditionSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const assetUploadPartSchema = z.object({
  partNumber: z.number().int().positive().max(resourceLimits.assets.maximumParts),
  etag: z.string().min(1),
  size: z.number().int().nonnegative().max(resourceLimits.api.assetPartBodyBytes),
});

export const assetUploadSessionSchema = contentScopeSchema.extend({
  id: z.string().min(1),
  storageUploadId: z.string().min(1),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  size: z.number().int().positive().max(resourceLimits.assets.maximumBytes),
  kind: assetKindSchema,
  state: z.enum(['pending', 'uploading', 'completed', 'aborted']),
  partSize: z.number().int().positive().max(resourceLimits.api.assetPartBodyBytes),
  parts: z.array(assetUploadPartSchema).max(resourceLimits.assets.maximumParts).default([]),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const startAssetUploadSchema = z.object({
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  size: z.number().int().positive().max(resourceLimits.assets.maximumBytes),
  kind: assetKindSchema,
  metadata: assetMetadataSchema,
  width: z.number().int().positive().max(resourceLimits.assets.maximumDimensionPixels).optional(),
  height: z.number().int().positive().max(resourceLimits.assets.maximumDimensionPixels).optional(),
});

export const completeAssetUploadSchema = z.object({
  parts: z.array(assetUploadPartSchema).min(1).max(resourceLimits.assets.maximumParts),
});

export const createAssetDeliverySchema = z.object({
  revisionId: z.string().min(1).optional(),
  ttlSeconds: z.number().int().min(30).max(900).default(300),
});

export const assetDeliveryGrantSchema = z.object({
  assetId: z.string().min(1),
  revisionId: z.string().min(1),
  url: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const updateAssetSchema = z
  .object({
    metadata: assetMetadataSchema.optional(),
    focalPoint: assetFocalPointSchema.nullable().optional(),
  })
  .refine((value) => value.metadata !== undefined || value.focalPoint !== undefined, {
    message: 'Metadata or focal point is required.',
  });

export const assetUsageLocationSchema = z.object({
  entryId: z.string().min(1),
  contentType: z.string().min(1),
  perspective: z.enum(['draft', 'published']),
  revisionId: z.string().min(1),
  field: z.string().min(1),
  path: z.string().min(1),
});

export const assetUsageReportSchema = z.object({
  assetId: z.string().min(1),
  totalReferences: z.number().int().nonnegative(),
  entries: z.number().int().nonnegative(),
  byPerspective: z.object({ draft: z.number().int(), published: z.number().int() }),
  locations: z.array(assetUsageLocationSchema),
});

export type AssetKind = z.infer<typeof assetKindSchema>;
export type AssetMalwareStatus = z.infer<typeof assetMalwareStatusSchema>;
export type AssetSecurity = z.infer<typeof assetSecuritySchema>;
export type AssetFocalPoint = z.infer<typeof assetFocalPointSchema>;
export type AssetMetadata = z.infer<typeof assetMetadataSchema>;
export type AssetObject = z.infer<typeof assetObjectSchema>;
export type AssetRenditionPreset = z.infer<typeof assetRenditionPresetSchema>;
export type AssetRendition = z.infer<typeof assetRenditionSchema>;
export type AssetRevision = z.infer<typeof assetRevisionSchema>;
export type AssetRecord = z.infer<typeof assetRecordSchema>;
export type AssetUploadPart = z.infer<typeof assetUploadPartSchema>;
export type AssetUploadSession = z.infer<typeof assetUploadSessionSchema>;
export type StartAssetUploadInput = z.input<typeof startAssetUploadSchema>;
export type CompleteAssetUploadInput = z.input<typeof completeAssetUploadSchema>;
export type CreateAssetDeliveryInput = z.input<typeof createAssetDeliverySchema>;
export type AssetDeliveryGrant = z.infer<typeof assetDeliveryGrantSchema>;
export type UpdateAssetInput = z.input<typeof updateAssetSchema>;
export type AssetUsageLocation = z.infer<typeof assetUsageLocationSchema>;
export type AssetUsageReport = z.infer<typeof assetUsageReportSchema>;
