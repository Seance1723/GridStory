import { z } from 'zod';
import { contentReferenceSchema } from './contracts.js';
import type { ContentScope } from './context.js';

export const NAVIGATION_MENU_CONTENT_TYPE = 'navigation-menu' as const;
export const navigationMenuLimits = {
  maximumItems: 100,
  maximumDepth: 3,
  maximumKeyCharacters: 64,
  maximumNameCharacters: 120,
  maximumItemIdCharacters: 64,
  maximumLabelCharacters: 160,
  maximumUrlCharacters: 2_048,
} as const;

export const navigationMenuKeySchema = z
  .string()
  .min(1)
  .max(navigationMenuLimits.maximumKeyCharacters)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const itemId = z
  .string()
  .min(1)
  .max(navigationMenuLimits.maximumItemIdCharacters)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const trimmedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim() === value, 'Text must not have outer whitespace.');

export const navigationExternalUrlSchema = z
  .string()
  .min(1)
  .max(navigationMenuLimits.maximumUrlCharacters)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      }),
    'URL contains control characters.',
  )
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
        context.addIssue({
          code: 'custom',
          message: 'External URLs must use HTTP(S) and must not contain credentials.',
        });
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'External URL must be absolute and valid.' });
    }
  });

export const navigationMenuItemDataSchema = z
  .object({
    id: itemId,
    parentId: itemId.optional(),
    label: trimmedText(navigationMenuLimits.maximumLabelCharacters),
    kind: z.enum(['internal', 'external']),
    target: contentReferenceSchema.strict().optional(),
    externalUrl: navigationExternalUrlSchema.optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.kind === 'internal') {
      if (!item.target) {
        context.addIssue({
          code: 'custom',
          path: ['target'],
          message: 'Internal menu items require one content target.',
        });
      }
      if (item.externalUrl !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['externalUrl'],
          message: 'Internal menu items cannot also contain an external URL.',
        });
      }
    } else {
      if (!item.externalUrl) {
        context.addIssue({
          code: 'custom',
          path: ['externalUrl'],
          message: 'External menu items require one absolute HTTP(S) URL.',
        });
      }
      if (item.target !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['target'],
          message: 'External menu items cannot also contain a content target.',
        });
      }
    }
  });

export const navigationMenuDataSchema = z
  .object({
    key: navigationMenuKeySchema,
    name: trimmedText(navigationMenuLimits.maximumNameCharacters),
    items: z.array(navigationMenuItemDataSchema).max(navigationMenuLimits.maximumItems),
  })
  .strict()
  .superRefine((menu, context) => {
    const indexes = new Map<string, number>();
    menu.items.forEach((item, index) => {
      const duplicate = indexes.get(item.id);
      if (duplicate !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: `Menu item ID ${item.id} duplicates item ${duplicate + 1}.`,
        });
      } else indexes.set(item.id, index);
    });

    menu.items.forEach((item, index) => {
      if (!item.parentId) return;
      if (item.parentId === item.id) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'parentId'],
          message: 'A menu item cannot be its own parent.',
        });
        return;
      }
      const parentIndex = indexes.get(item.parentId);
      if (parentIndex === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'parentId'],
          message: `Parent item ${item.parentId} does not exist.`,
        });
        return;
      }
      if (parentIndex >= index) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'parentId'],
          message: 'A parent must occur before its descendants in canonical order.',
        });
        return;
      }
      let depth = 2;
      let parent = menu.items[parentIndex];
      const visited = new Set([item.id]);
      while (parent?.parentId) {
        if (visited.has(parent.id)) {
          context.addIssue({
            code: 'custom',
            path: ['items', index, 'parentId'],
            message: 'Menu parent references contain a cycle.',
          });
          return;
        }
        visited.add(parent.id);
        depth += 1;
        parent = menu.items[indexes.get(parent.parentId) ?? -1];
      }
      if (depth > navigationMenuLimits.maximumDepth) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'parentId'],
          message: `Menu depth cannot exceed ${navigationMenuLimits.maximumDepth}.`,
        });
      }
    });
  });

export type NavigationMenuData = z.infer<typeof navigationMenuDataSchema>;
export type NavigationMenuItemData = z.infer<typeof navigationMenuItemDataSchema>;

const contentScopeSchema: z.ZodType<ContentScope> = z
  .object({
    organizationId: z.string().min(1).max(128),
    tenantId: z.string().min(1).max(128),
    workspaceId: z.string().min(1).max(128),
    siteId: z.string().min(1).max(128),
    environmentId: z.string().min(1).max(128),
    locale: z.string().min(1).max(128),
  })
  .strict();

const projectionBase = z
  .object({
    id: itemId,
    parentId: itemId.optional(),
    label: trimmedText(navigationMenuLimits.maximumLabelCharacters),
    href: z.string().min(1).max(navigationMenuLimits.maximumUrlCharacters),
  })
  .strict();

export const navigationMenuProjectionItemSchema = z.discriminatedUnion('kind', [
  projectionBase.extend({
    kind: z.literal('internal'),
    target: contentReferenceSchema.strict(),
  }),
  projectionBase.extend({ kind: z.literal('external') }),
]);

export const navigationMenuProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: contentScopeSchema,
    entryId: z.string().min(1).max(128),
    key: navigationMenuKeySchema,
    name: trimmedText(navigationMenuLimits.maximumNameCharacters),
    requestedLocale: z.string().min(1).max(128),
    resolvedLocale: z.string().min(1).max(128),
    perspective: z.enum(['draft', 'published']),
    revisionId: z.string().min(1).max(256),
    items: z.array(navigationMenuProjectionItemSchema).max(navigationMenuLimits.maximumItems),
  })
  .strict();

export type NavigationMenuProjection = z.infer<typeof navigationMenuProjectionSchema>;
export type NavigationMenuProjectionItem = z.infer<typeof navigationMenuProjectionItemSchema>;

export function navigationMenuEntryId(key: string): string {
  return `${NAVIGATION_MENU_CONTENT_TYPE}:${navigationMenuKeySchema.parse(key)}`;
}
