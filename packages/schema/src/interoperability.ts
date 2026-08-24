import { z } from 'zod';
import { canonicalStringify, schemaIrDocumentSchema, sha256 } from './canonical.js';
import { componentManifestSchema, type ComponentNode } from './contracts.js';
import type { ContentScope } from './context.js';
import { resourceLimits } from './resource-limits.js';

export const LOGICAL_ARCHIVE_FORMAT = 'gridstory.logical-content' as const;
export const LOGICAL_ARCHIVE_VERSION = 1 as const;
export const PREVIEW_SOURCE_MAP_FORMAT = 'gridstory.preview-source-map' as const;
export const PREVIEW_SOURCE_MAP_VERSION = 1 as const;
export const INTEROPERABILITY_FORMAT = 'gridstory.interoperability' as const;
export const INTEROPERABILITY_PROTOCOL_VERSION = 1 as const;

export const interoperabilitySpecificationKinds = [
  'logical-content-archive',
  'content-schema-ir',
  'component-manifest',
  'preview-source-map',
] as const;

export const interoperabilitySpecificationKindSchema = z.enum(interoperabilitySpecificationKinds);
export type InteroperabilitySpecificationKind = z.infer<
  typeof interoperabilitySpecificationKindSchema
>;

const identifierSchema = z.string().min(1).max(200);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const contentScopeSchema: z.ZodType<ContentScope> = z
  .object({
    organizationId: identifierSchema,
    tenantId: identifierSchema,
    workspaceId: identifierSchema,
    siteId: identifierSchema,
    environmentId: identifierSchema,
    locale: identifierSchema,
  })
  .strict();

export const portableRevisionSchema = z
  .object({
    id: identifierSchema,
    sequence: z.number().int().positive(),
    baseRevisionId: identifierSchema.optional(),
    actorId: identifierSchema,
    data: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const portableAuditEventSchema = z
  .object({
    id: identifierSchema,
    sequence: z.number().int().positive(),
    actorId: identifierSchema,
    action: z.enum(['content.created', 'content.draft.updated', 'content.published']),
    revisionId: identifierSchema,
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const portableContentRecordSchema = z
  .object({
    entryId: identifierSchema,
    contentType: identifierSchema,
    currentDraftRevisionId: identifierSchema,
    publishedRevisionId: identifierSchema.optional(),
    translationGroupId: identifierSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    revisions: z
      .array(portableRevisionSchema)
      .min(1)
      .max(resourceLimits.portability.maximumRevisionsPerEntry),
    auditEvents: z
      .array(portableAuditEventSchema)
      .max(resourceLimits.portability.maximumAuditEventsPerEntry),
  })
  .strict();

export const logicalArchiveManifestSchema = z
  .object({
    kind: z.literal('manifest'),
    format: z.literal(LOGICAL_ARCHIVE_FORMAT),
    version: z.literal(LOGICAL_ARCHIVE_VERSION),
    sourceScope: contentScopeSchema,
    exportedAt: z.string().datetime({ offset: true }),
    entryCount: z.number().int().nonnegative().max(resourceLimits.portability.maximumEntries),
    archiveChecksum: sha256Schema,
    schemaFingerprint: identifierSchema.optional(),
  })
  .strict();

export const logicalArchiveEntrySchema = z
  .object({
    kind: z.literal('entry'),
    checksum: sha256Schema,
    record: portableContentRecordSchema,
  })
  .strict();

export const logicalArchiveSchema = z
  .object({
    manifest: logicalArchiveManifestSchema,
    entries: z.array(logicalArchiveEntrySchema).max(resourceLimits.portability.maximumEntries),
  })
  .strict();

export type PortableRevision = z.infer<typeof portableRevisionSchema>;
export type PortableAuditEvent = z.infer<typeof portableAuditEventSchema>;
export type PortableContentRecord = z.infer<typeof portableContentRecordSchema>;
export type LogicalArchiveManifest = z.infer<typeof logicalArchiveManifestSchema>;
export type LogicalArchiveEntry = z.infer<typeof logicalArchiveEntrySchema>;
export type LogicalArchive = z.infer<typeof logicalArchiveSchema>;

export const previewSourceMapSchema = z
  .object({
    format: z.literal(PREVIEW_SOURCE_MAP_FORMAT),
    version: z.literal(PREVIEW_SOURCE_MAP_VERSION),
    entry: z
      .object({
        entryId: identifierSchema,
        contentType: identifierSchema,
        revisionId: identifierSchema.optional(),
      })
      .strict(),
    mappings: z
      .array(
        z
          .object({
            nodeId: identifierSchema,
            componentId: identifierSchema,
            componentVersion: z.number().int().positive(),
            selector: z
              .object({
                attribute: z.literal('data-gridstory-node'),
                value: identifierSchema,
              })
              .strict(),
          })
          .strict(),
      )
      .max(resourceLimits.interoperability.maximumSourceMappings),
  })
  .strict()
  .superRefine((sourceMap, context) => {
    const seen = new Set<string>();
    sourceMap.mappings.forEach((mapping, index) => {
      if (seen.has(mapping.nodeId)) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', index, 'nodeId'],
          message: `Preview source-map node ${mapping.nodeId} is duplicated.`,
        });
      }
      seen.add(mapping.nodeId);
    });
  });

export type PreviewSourceMap = z.infer<typeof previewSourceMapSchema>;

export function createPreviewSourceMap(input: {
  entryId: string;
  contentType: string;
  revisionId?: string;
  nodes: ComponentNode[];
}): PreviewSourceMap {
  const mappings: PreviewSourceMap['mappings'] = [];
  const visit = (node: ComponentNode): void => {
    mappings.push({
      nodeId: node.id,
      componentId: node.component,
      componentVersion: node.version,
      selector: { attribute: 'data-gridstory-node', value: node.id },
    });
    for (const children of Object.values(node.slots ?? {})) {
      for (const child of children) visit(child);
    }
  };
  for (const node of input.nodes) visit(node);
  return previewSourceMapSchema.parse({
    format: PREVIEW_SOURCE_MAP_FORMAT,
    version: PREVIEW_SOURCE_MAP_VERSION,
    entry: {
      entryId: input.entryId,
      contentType: input.contentType,
      ...(input.revisionId ? { revisionId: input.revisionId } : {}),
    },
    mappings,
  });
}

export const interoperabilitySpecificationDescriptorSchema = z
  .object({
    kind: interoperabilitySpecificationKindSchema,
    version: z.literal(1),
    id: z.string().regex(/^urn:gridstory:spec:[a-z-]+:1$/u),
    mediaType: z.literal('application/schema+json'),
    digest: sha256Schema,
    href: z.string().regex(/^\/api\/v1\/interoperability\/specifications\/[a-z-]+\/1$/u),
  })
  .strict();

export const interoperabilityDiscoverySchema = z
  .object({
    format: z.literal(INTEROPERABILITY_FORMAT),
    protocolVersion: z.literal(INTEROPERABILITY_PROTOCOL_VERSION),
    instanceId: identifierSchema,
    serviceVersion: z.string().min(1).max(resourceLimits.fleet.maximumServiceVersionCharacters),
    healthPath: z.literal('/health'),
    readinessPath: z.literal('/ready'),
    specifications: z
      .array(interoperabilitySpecificationDescriptorSchema)
      .length(resourceLimits.interoperability.maximumSpecifications),
  })
  .strict()
  .superRefine((descriptor, context) => {
    const kinds = descriptor.specifications.map((item) => item.kind);
    if (
      new Set(kinds).size !== interoperabilitySpecificationKinds.length ||
      interoperabilitySpecificationKinds.some((kind) => !kinds.includes(kind))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['specifications'],
        message: 'Discovery must describe each GridStory v1 specification exactly once.',
      });
    }
  });

export type InteroperabilitySpecificationDescriptor = z.infer<
  typeof interoperabilitySpecificationDescriptorSchema
>;
export type InteroperabilityDiscovery = z.infer<typeof interoperabilityDiscoverySchema>;

export interface InteroperabilitySpecification {
  kind: InteroperabilitySpecificationKind;
  version: 1;
  id: string;
  filename: string;
  schema: Record<string, unknown>;
  digest: string;
}

const schemas = {
  'logical-content-archive': logicalArchiveSchema,
  'content-schema-ir': schemaIrDocumentSchema,
  'component-manifest': componentManifestSchema,
  'preview-source-map': previewSourceMapSchema,
} as const;

export function createInteroperabilitySpecifications(): InteroperabilitySpecification[] {
  return interoperabilitySpecificationKinds.map((kind) => {
    const id = `urn:gridstory:spec:${kind}:1`;
    const generated = z.toJSONSchema(schemas[kind], {
      target: 'draft-2020-12',
      io: 'input',
    }) as Record<string, unknown>;
    const schema = {
      ...generated,
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: id,
      title: `GridStory ${kind} v1`,
    };
    return {
      kind,
      version: 1,
      id,
      filename: `${kind}.schema.json`,
      schema,
      digest: sha256(canonicalStringify(schema)),
    };
  });
}

export function createInteroperabilityDiscovery(input: {
  instanceId: string;
  serviceVersion: string;
}): InteroperabilityDiscovery {
  return interoperabilityDiscoverySchema.parse({
    format: INTEROPERABILITY_FORMAT,
    protocolVersion: INTEROPERABILITY_PROTOCOL_VERSION,
    instanceId: input.instanceId,
    serviceVersion: input.serviceVersion,
    healthPath: '/health',
    readinessPath: '/ready',
    specifications: createInteroperabilitySpecifications().map((specification) => ({
      kind: specification.kind,
      version: 1,
      id: specification.id,
      mediaType: 'application/schema+json',
      digest: specification.digest,
      href: `/api/v1/interoperability/specifications/${specification.kind}/1`,
    })),
  });
}

export const interoperabilityExamples = {
  'logical-content-archive': {
    manifest: {
      kind: 'manifest',
      format: LOGICAL_ARCHIVE_FORMAT,
      version: LOGICAL_ARCHIVE_VERSION,
      sourceScope: {
        organizationId: 'example-org',
        tenantId: 'example-tenant',
        workspaceId: 'example-workspace',
        siteId: 'example-site',
        environmentId: 'production',
        locale: 'en',
      },
      exportedAt: '2026-01-01T00:00:00.000Z',
      entryCount: 0,
      archiveChecksum: sha256(canonicalStringify([])),
    },
    entries: [],
  },
  'content-schema-ir': {
    format: 'gridstory.schema-ir',
    irVersion: 1,
    schemas: [],
    components: [],
  },
  'component-manifest': {
    id: 'example.hero',
    version: 1,
    name: 'Example hero',
  },
  'preview-source-map': {
    format: PREVIEW_SOURCE_MAP_FORMAT,
    version: PREVIEW_SOURCE_MAP_VERSION,
    entry: { entryId: 'entry-1', contentType: 'page', revisionId: 'revision-1' },
    mappings: [
      {
        nodeId: 'hero-1',
        componentId: 'example.hero',
        componentVersion: 1,
        selector: { attribute: 'data-gridstory-node', value: 'hero-1' },
      },
    ],
  },
} satisfies Record<InteroperabilitySpecificationKind, unknown>;
