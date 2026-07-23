import { z } from 'zod';

export const propDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('text'),
    required: z.boolean().default(false),
    defaultValue: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('textarea'),
    required: z.boolean().default(false),
    defaultValue: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('enum'),
    required: z.boolean().default(false),
    defaultValue: z.string().optional(),
    values: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('number'),
    required: z.boolean().default(false),
    defaultValue: z.number().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('boolean'),
    required: z.boolean().default(false),
    defaultValue: z.boolean().optional(),
  }),
]);

export type PropDefinition = z.infer<typeof propDefinitionSchema>;

export const slotDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  accepts: z.array(z.string().min(1)).default([]),
  min: z.number().int().nonnegative().default(0),
  max: z.number().int().positive().optional(),
});

export type SlotDefinition = z.infer<typeof slotDefinitionSchema>;

export const componentManifestSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().default(''),
  category: z.string().min(1).default('General'),
  props: z.array(propDefinitionSchema).default([]),
  slots: z.array(slotDefinitionSchema).default([]),
  strictProps: z.boolean().default(true),
});

export type ComponentManifest = z.infer<typeof componentManifestSchema>;

export const componentPresentationSchema = z
  .object({
    designSystemVersion: z.number().int().positive().optional(),
    variantId: z.string().min(1).optional(),
    tokenBindings: z.record(z.string().min(1), z.string().min(1)).optional(),
    responsive: z.record(z.string().min(1), z.record(z.string().min(1), z.unknown())).optional(),
    symbol: z
      .object({
        id: z.string().min(1),
        detached: z.boolean().optional(),
      })
      .optional(),
  })
  .superRefine((presentation, context) => {
    if (
      presentation.designSystemVersion === undefined &&
      (presentation.variantId ||
        presentation.tokenBindings ||
        presentation.responsive ||
        presentation.symbol)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['designSystemVersion'],
        message: 'Bound presentation data must pin its design system version.',
      });
    }
  });

export type ComponentPresentation = z.infer<typeof componentPresentationSchema>;

export interface ComponentNode {
  id: string;
  component: string;
  version: number;
  props: Record<string, unknown>;
  slots?: Record<string, ComponentNode[]> | undefined;
  presentation?: ComponentPresentation | undefined;
}

export const componentNodeSchema: z.ZodType<ComponentNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    component: z.string().min(1),
    version: z.number().int().positive(),
    props: z.record(z.string(), z.unknown()),
    slots: z.record(z.string(), z.array(componentNodeSchema)).optional(),
    presentation: componentPresentationSchema.optional(),
  }),
);

export const contentReferenceSchema = z.object({
  id: z.string().min(1),
  contentType: z.string().min(1),
});

export type ContentReference = z.infer<typeof contentReferenceSchema>;

export const taxonomyTermSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().min(1),
  parentId: z.string().min(1).optional(),
});

export type TaxonomyTerm = z.infer<typeof taxonomyTermSchema>;

export const taxonomyDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hierarchical: z.boolean().default(false),
  terms: z.array(taxonomyTermSchema).default([]),
});

export type TaxonomyDefinition = z.infer<typeof taxonomyDefinitionSchema>;

export const objectFieldDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal('number'),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  }),
  z.object({ type: z.literal('boolean') }),
  z.object({ type: z.literal('enum'), values: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('object'), objectType: z.string().min(1) }),
  z.object({ type: z.literal('relation'), targets: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('taxonomy'), taxonomy: z.string().min(1) }),
]);

export type ArrayItemDefinition = z.input<typeof objectFieldDefinitionSchema>;

export const reusableObjectDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  fields: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      label: z.string().min(1),
      required: z.boolean().default(false),
      value: objectFieldDefinitionSchema,
    }),
  ),
});

export type ReusableObjectDefinition = z.input<typeof reusableObjectDefinitionSchema>;

export const unionVariantDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  objectType: z.string().min(1),
});

export type UnionVariantDefinition = z.infer<typeof unionVariantDefinitionSchema>;

export const fieldDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('text'),
    required: z.boolean().default(false),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('slug'),
    required: z.boolean().default(false),
    pattern: z.string().default('^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('rich-text'),
    required: z.boolean().default(false),
    allowedBlocks: z
      .array(z.enum(['paragraph', 'heading', 'list', 'quote', 'code', 'embed', 'table']))
      .default(['paragraph', 'heading', 'list', 'quote', 'code', 'embed', 'table']),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('asset'),
    required: z.boolean().default(false),
    accepts: z.array(z.enum(['image', 'video', 'file'])).default(['image', 'video', 'file']),
    requiredAlt: z.boolean().default(false),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('component-tree'),
    required: z.boolean().default(false),
    minimum: z.number().int().nonnegative().default(0),
    maximum: z.number().int().positive().optional(),
    accepts: z.array(z.string().min(1)).default([]),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('number'),
    required: z.boolean().default(false),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('boolean'),
    required: z.boolean().default(false),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('enum'),
    required: z.boolean().default(false),
    values: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('object'),
    required: z.boolean().default(false),
    objectType: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('array'),
    required: z.boolean().default(false),
    minimum: z.number().int().nonnegative().default(0),
    maximum: z.number().int().positive().optional(),
    items: objectFieldDefinitionSchema,
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('union'),
    required: z.boolean().default(false),
    discriminator: z.string().min(1).default('type'),
    variants: z.array(unionVariantDefinitionSchema).min(1),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('relation'),
    required: z.boolean().default(false),
    targets: z.array(z.string().min(1)).min(1),
    multiple: z.boolean().default(false),
    minimum: z.number().int().nonnegative().default(0),
    maximum: z.number().int().positive().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('taxonomy'),
    required: z.boolean().default(false),
    taxonomy: z.string().min(1),
    multiple: z.boolean().default(false),
    minimum: z.number().int().nonnegative().default(0),
    maximum: z.number().int().positive().optional(),
  }),
]);

export type FieldDefinition = z.input<typeof fieldDefinitionSchema>;

export const contentSchemaDefinitionSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().default(''),
    collection: z.string().min(1),
    titleField: z.string().min(1),
    fields: z.array(fieldDefinitionSchema).min(1),
    objects: z.array(reusableObjectDefinitionSchema).default([]),
    taxonomies: z.array(taxonomyDefinitionSchema).default([]),
    localization: z
      .object({
        localizedFields: z.array(z.string().min(1)).default([]),
      })
      .optional(),
    route: z
      .object({
        pattern: z.string().startsWith('/'),
        slugField: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((schema, context) => {
    const duplicate = (values: string[]) =>
      values.find((value, index) => values.indexOf(value) !== index);
    const duplicateField = duplicate(schema.fields.map((field) => field.name));
    if (duplicateField)
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: `Field name ${duplicateField} is duplicated.`,
      });
    if (!schema.fields.some((field) => field.name === schema.titleField)) {
      context.addIssue({
        code: 'custom',
        path: ['titleField'],
        message: 'Title field must reference a declared field.',
      });
    }
    if (schema.localization) {
      const localized = schema.localization.localizedFields;
      const duplicateLocalizedField = duplicate(localized);
      if (duplicateLocalizedField)
        context.addIssue({
          code: 'custom',
          path: ['localization', 'localizedFields'],
          message: `Localized field ${duplicateLocalizedField} is duplicated.`,
        });
      const fieldNames = new Set(schema.fields.map((field) => field.name));
      localized.forEach((fieldName) => {
        if (!fieldNames.has(fieldName))
          context.addIssue({
            code: 'custom',
            path: ['localization', 'localizedFields', fieldName],
            message: `Localized field ${fieldName} is not declared.`,
          });
      });
    }

    const objectIds = new Set(schema.objects.map((object) => object.id));
    if (objectIds.size !== schema.objects.length)
      context.addIssue({
        code: 'custom',
        path: ['objects'],
        message: 'Reusable object IDs must be unique.',
      });
    const assertObject = (objectType: string, path: Array<string | number>) => {
      if (!objectIds.has(objectType))
        context.addIssue({
          code: 'custom',
          path,
          message: `Reusable object ${objectType} is not declared.`,
        });
    };
    for (const object of schema.objects) {
      const duplicateObjectField = duplicate(object.fields.map((field) => field.name));
      if (duplicateObjectField)
        context.addIssue({
          code: 'custom',
          path: ['objects', object.id, 'fields'],
          message: `Object field ${duplicateObjectField} is duplicated.`,
        });
      for (const field of object.fields) {
        if (field.value.type === 'object')
          assertObject(field.value.objectType, ['objects', object.id, field.name]);
      }
    }
    for (const field of schema.fields) {
      if (field.type === 'object') assertObject(field.objectType, ['fields', field.name]);
      if (field.type === 'array' && field.items.type === 'object')
        assertObject(field.items.objectType, ['fields', field.name, 'items']);
      if (field.type === 'union') {
        field.variants.forEach((variant) => {
          assertObject(variant.objectType, ['fields', field.name, 'variants', variant.id]);
        });
      }
    }

    const taxonomyIds = new Set(schema.taxonomies.map((taxonomy) => taxonomy.id));
    if (taxonomyIds.size !== schema.taxonomies.length)
      context.addIssue({
        code: 'custom',
        path: ['taxonomies'],
        message: 'Taxonomy IDs must be unique.',
      });
    for (const taxonomy of schema.taxonomies) {
      const terms = taxonomy.terms;
      const termIds = new Set(terms.map((term) => term.id));
      if (termIds.size !== terms.length)
        context.addIssue({
          code: 'custom',
          path: ['taxonomies', taxonomy.id, 'terms'],
          message: 'Taxonomy term IDs must be unique.',
        });
      for (const term of terms) {
        if (term.parentId && (!taxonomy.hierarchical || !termIds.has(term.parentId)))
          context.addIssue({
            code: 'custom',
            path: ['taxonomies', taxonomy.id, term.id, 'parentId'],
            message: `Term ${term.id} has an invalid parent.`,
          });
        const visited = new Set([term.id]);
        let parentId = term.parentId;
        while (parentId) {
          if (visited.has(parentId)) {
            context.addIssue({
              code: 'custom',
              path: ['taxonomies', taxonomy.id, term.id],
              message: 'Taxonomy hierarchy contains a cycle.',
            });
            break;
          }
          visited.add(parentId);
          parentId = terms.find((candidate) => candidate.id === parentId)?.parentId;
        }
      }
    }
    for (const field of schema.fields) {
      if (field.type === 'taxonomy' && !taxonomyIds.has(field.taxonomy))
        context.addIssue({
          code: 'custom',
          path: ['fields', field.name, 'taxonomy'],
          message: `Taxonomy ${field.taxonomy} is not declared.`,
        });
    }

    if (schema.route) {
      const slug = schema.fields.find((field) => field.name === schema.route?.slugField);
      if (slug?.type !== 'slug')
        context.addIssue({
          code: 'custom',
          path: ['route', 'slugField'],
          message: 'Route slugField must reference a slug field.',
        });
      if (!schema.route.pattern.includes(`:${schema.route.slugField}`))
        context.addIssue({
          code: 'custom',
          path: ['route', 'pattern'],
          message: 'Route pattern must contain its slug field token.',
        });
    }
  });

export type ContentSchemaDefinition = z.input<typeof contentSchemaDefinitionSchema>;

export interface ValidationIssue {
  code:
    | 'invalid_type'
    | 'required'
    | 'too_small'
    | 'too_large'
    | 'invalid_format'
    | 'unknown_component'
    | 'component_version'
    | 'unknown_prop'
    | 'invalid_prop'
    | 'unknown_slot'
    | 'invalid_child'
    | 'unknown_object'
    | 'invalid_reference'
    | 'unknown_taxonomy'
    | 'invalid_term'
    | 'invalid_union';
  path: Array<string | number>;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export const redirectDefinitionSchema = z.object({
  from: z.string().startsWith('/'),
  to: z.string().startsWith('/'),
  status: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(308),
});

export type RedirectDefinition = z.infer<typeof redirectDefinitionSchema>;
