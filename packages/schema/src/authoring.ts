import { z } from 'zod';
import { contentReferenceSchema } from './contracts.js';

export const richTextMarkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['bold', 'italic', 'underline', 'code']) }),
  z.object({ type: z.literal('link'), href: z.string().url() }),
]);

export const richTextInlineSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    marks: z.array(richTextMarkSchema).default([]),
  }),
  z.object({
    type: z.literal('mention'),
    actorId: z.string().min(1),
    label: z.string().min(1),
  }),
]);

const richTextInlineContentSchema = z.array(richTextInlineSchema);

export const richTextBlockSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('paragraph'),
    content: richTextInlineContentSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('heading'),
    level: z.number().int().min(2).max(6),
    content: richTextInlineContentSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('list'),
    ordered: z.boolean().default(false),
    items: z.array(richTextInlineContentSchema).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('quote'),
    content: richTextInlineContentSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('code'),
    language: z.string().min(1).default('text'),
    code: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('embed'),
    reference: contentReferenceSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('table'),
    rows: z.array(z.array(richTextInlineContentSchema).min(1)).min(1),
  }),
]);

export const richTextDocumentSchema = z.object({
  version: z.literal(1),
  blocks: z.array(richTextBlockSchema),
});

export type RichTextMark = z.infer<typeof richTextMarkSchema>;
export type RichTextInline = z.infer<typeof richTextInlineSchema>;
export type RichTextBlock = z.infer<typeof richTextBlockSchema>;
export type RichTextDocument = z.infer<typeof richTextDocumentSchema>;

export const assetReferenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['image', 'video', 'file']),
  url: z.string().url(),
  title: z.string().min(1),
  alt: z.string().optional(),
  mimeType: z.string().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type AssetReference = z.infer<typeof assetReferenceSchema>;
