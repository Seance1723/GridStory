import { z } from 'zod';
const collaborationScopeSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  environmentId: z.string().min(1),
  locale: z.string().min(1),
});

export const collaborationTargetSchema = z.object({
  entryId: z.string().min(1),
  field: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
});

export type CollaborationTarget = z.infer<typeof collaborationTargetSchema>;

export const commentMessageSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  body: z.string().trim().min(1).max(4000),
  mentions: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
});

export type CommentMessage = z.infer<typeof commentMessageSchema>;

export const commentThreadSchema = collaborationScopeSchema.extend({
  id: z.string().min(1),
  target: collaborationTargetSchema,
  messages: z.array(commentMessageSchema).min(1),
  assigneeId: z.string().min(1).optional(),
  dueAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CommentThread = z.infer<typeof commentThreadSchema>;

export const presenceParticipantSchema = z.object({
  actorId: z.string().min(1),
  displayName: z.string().min(1),
  field: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  lastSeenAt: z.string().datetime(),
});

export type PresenceParticipant = z.infer<typeof presenceParticipantSchema>;

export const collaborationSnapshotSchema = z.object({
  threads: z.array(commentThreadSchema),
  presence: z.array(presenceParticipantSchema),
});

export type CollaborationSnapshot = z.infer<typeof collaborationSnapshotSchema>;
