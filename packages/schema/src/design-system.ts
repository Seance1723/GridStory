import { z } from 'zod';
import { componentNodeSchema } from './contracts.js';

export const designTokenCategorySchema = z.enum([
  'color',
  'spacing',
  'size',
  'radius',
  'shadow',
  'typography',
  'motion',
  'other',
]);

export const designTokenDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: designTokenCategorySchema,
  value: z.union([z.string(), z.number(), z.boolean()]),
  description: z.string().default(''),
});

export const breakpointDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  minWidth: z.number().int().nonnegative(),
});

export const componentVariantDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  component: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  description: z.string().default(''),
});

export const compositionSymbolDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  node: componentNodeSchema,
  allowedPropOverrides: z.array(z.string().min(1)).default([]),
});

export const compositionTemplateDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  category: z.string().min(1).default('General'),
  nodes: z.array(componentNodeSchema).min(1),
});

export const designSystemManifestSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    tokens: z.array(designTokenDefinitionSchema).default([]),
    breakpoints: z.array(breakpointDefinitionSchema).default([]),
    variants: z.array(componentVariantDefinitionSchema).default([]),
    symbols: z.array(compositionSymbolDefinitionSchema).default([]),
    templates: z.array(compositionTemplateDefinitionSchema).default([]),
  })
  .superRefine((manifest, context) => {
    const unique = (kind: string, values: Array<{ id: string }>) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value.id)) {
          context.addIssue({
            code: 'custom',
            path: [kind, index, 'id'],
            message: `Duplicate ${kind} ID ${value.id}.`,
          });
        }
        seen.add(value.id);
      });
    };
    unique('tokens', manifest.tokens);
    unique('breakpoints', manifest.breakpoints);
    unique('variants', manifest.variants);
    unique('symbols', manifest.symbols);
    unique('templates', manifest.templates);
    const sorted = [...manifest.breakpoints].sort((left, right) => left.minWidth - right.minWidth);
    if (sorted.some((breakpoint, index) => breakpoint.id !== manifest.breakpoints[index]?.id)) {
      context.addIssue({
        code: 'custom',
        path: ['breakpoints'],
        message: 'Breakpoints must be ordered from the smallest to largest minimum width.',
      });
    }
  });

export type DesignTokenCategory = z.infer<typeof designTokenCategorySchema>;
export type DesignTokenDefinition = z.infer<typeof designTokenDefinitionSchema>;
export type BreakpointDefinition = z.infer<typeof breakpointDefinitionSchema>;
export type ComponentVariantDefinition = z.infer<typeof componentVariantDefinitionSchema>;
export type CompositionSymbolDefinition = z.infer<typeof compositionSymbolDefinitionSchema>;
export type CompositionTemplateDefinition = z.infer<typeof compositionTemplateDefinitionSchema>;
export type DesignSystemManifest = z.infer<typeof designSystemManifestSchema>;

export function defineDesignSystem<const T extends DesignSystemManifest>(manifest: T): T {
  return manifest;
}
