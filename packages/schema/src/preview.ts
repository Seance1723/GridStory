import { z } from 'zod';
import type { ContentScope } from './context.js';

export const PREVIEW_PROTOCOL_VERSION = 1 as const;

export const previewModeSchema = z.enum(['iframe', 'standalone']);

const previewScopeSchema: z.ZodType<ContentScope> = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  environmentId: z.string().min(1),
  locale: z.string().min(1),
});

export const previewSessionClaimsSchema = z.object({
  audience: z.literal('gridstory-preview'),
  protocolVersion: z.literal(PREVIEW_PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  scope: previewScopeSchema,
  origin: z.string().url(),
  route: z.string().startsWith('/'),
  entryId: z.string().min(1).optional(),
  mode: previewModeSchema,
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export const previewSessionGrantSchema = z.object({
  token: z.string().startsWith('gsp_'),
  sessionId: z.string().min(1),
  previewUrl: z.string().url(),
  origin: z.string().url(),
  protocolVersion: z.literal(PREVIEW_PROTOCOL_VERSION),
  expiresAt: z.string().datetime(),
});

const messageBase = z.object({
  protocolVersion: z.literal(PREVIEW_PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  nonce: z.string().min(16).max(200),
});

export const previewMessageSchema = z.discriminatedUnion('type', [
  messageBase.extend({
    type: z.literal('gridstory.preview.handshake'),
    payload: z.object({ origin: z.string().url() }),
  }),
  messageBase.extend({
    type: z.literal('gridstory.preview.ready'),
    payload: z.object({ route: z.string().startsWith('/') }),
  }),
  messageBase.extend({
    type: z.literal('gridstory.preview.patch'),
    payload: z.object({
      entryId: z.string().min(1),
      contentType: z.string().min(1),
      data: z.record(z.string(), z.unknown()),
      revisionId: z.string().min(1).optional(),
    }),
  }),
  messageBase.extend({
    type: z.literal('gridstory.preview.navigate'),
    payload: z.object({ route: z.string().startsWith('/') }),
  }),
  messageBase.extend({
    type: z.literal('gridstory.preview.select'),
    payload: z.object({
      entryId: z.string().min(1),
      nodeId: z.string().min(1).optional(),
      fieldName: z.string().min(1).optional(),
      slotName: z.string().min(1).optional(),
    }),
  }),
  messageBase.extend({
    type: z.literal('gridstory.preview.error'),
    payload: z.object({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);

export type PreviewMode = z.infer<typeof previewModeSchema>;
export type PreviewSessionClaims = z.infer<typeof previewSessionClaimsSchema>;
export type PreviewSessionGrant = z.infer<typeof previewSessionGrantSchema>;
export type PreviewMessage = z.infer<typeof previewMessageSchema>;
