import { randomUUID } from 'node:crypto';
import { contentScopeKey } from './tenant-scope.js';
import type {
  CollaborationSnapshot,
  CollaborationTarget,
  CommentMessage,
  CommentThread,
  ContentScope,
  PresenceParticipant,
} from '@gridstory/schema';
import { GridStoryError } from './errors.js';

const PRESENCE_TTL_MS = 30_000;

function mentionIds(body: string, explicit: string[] = []): string[] {
  const parsed = [...body.matchAll(/@([a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9_-])?)/g)].map(
    (match) => match[1] ?? '',
  );
  return [...new Set([...explicit, ...parsed].filter(Boolean))];
}

function normalizedDueAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new GridStoryError('Comment due date is invalid.', 'invalid_due_date', 400);
  }
  return new Date(timestamp).toISOString();
}

function message(
  actorId: string,
  body: string,
  mentions?: string[],
  now = new Date(),
): CommentMessage {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new GridStoryError('Comment body is required.', 'invalid_comment', 400);
  }
  return {
    id: randomUUID(),
    actorId,
    body: trimmed,
    mentions: mentionIds(trimmed, mentions),
    createdAt: now.toISOString(),
  };
}

export class CollaborationService {
  readonly #threads = new Map<string, CommentThread[]>();
  readonly #presence = new Map<string, Map<string, PresenceParticipant>>();

  snapshot(scope: ContentScope, entryId: string, now = new Date()): CollaborationSnapshot {
    const key = `${contentScopeKey(scope)}\u001e${entryId}`;
    const participants = this.#presence.get(key);
    if (participants) {
      const cutoff = now.getTime() - PRESENCE_TTL_MS;
      for (const [actorId, participant] of participants) {
        if (Date.parse(participant.lastSeenAt) < cutoff) participants.delete(actorId);
      }
      if (participants.size === 0) this.#presence.delete(key);
    }
    return {
      threads: structuredClone(this.#threads.get(key) ?? []),
      presence: structuredClone([...(participants?.values() ?? [])]),
    };
  }

  createThread(input: {
    scope: ContentScope;
    target: CollaborationTarget;
    actorId: string;
    body: string;
    mentions?: string[];
    assigneeId?: string;
    dueAt?: string;
    now?: Date;
  }): CommentThread {
    const now = input.now ?? new Date();
    const firstMessage = message(input.actorId, input.body, input.mentions, now);
    const thread: CommentThread = {
      ...input.scope,
      id: randomUUID(),
      target: input.target,
      messages: [firstMessage],
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
      ...(input.dueAt ? { dueAt: normalizedDueAt(input.dueAt) } : {}),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const key = `${contentScopeKey(input.scope)}\u001e${input.target.entryId}`;
    const threads = this.#threads.get(key) ?? [];
    threads.push(thread);
    this.#threads.set(key, threads);
    return structuredClone(thread);
  }

  reply(input: {
    scope: ContentScope;
    entryId: string;
    threadId: string;
    actorId: string;
    body: string;
    mentions?: string[];
    now?: Date;
  }): CommentThread {
    const thread = this.#thread(input.scope, input.entryId, input.threadId);
    const now = input.now ?? new Date();
    thread.messages.push(message(input.actorId, input.body, input.mentions, now));
    thread.updatedAt = now.toISOString();
    return structuredClone(thread);
  }

  updateThread(input: {
    scope: ContentScope;
    entryId: string;
    threadId: string;
    actorId: string;
    assigneeId?: string | null;
    dueAt?: string | null;
    resolved?: boolean;
    now?: Date;
  }): CommentThread {
    const thread = this.#thread(input.scope, input.entryId, input.threadId);
    const now = input.now ?? new Date();
    if (input.assigneeId === null) delete thread.assigneeId;
    else if (input.assigneeId !== undefined) thread.assigneeId = input.assigneeId;
    if (input.dueAt === null) delete thread.dueAt;
    else if (input.dueAt !== undefined) thread.dueAt = normalizedDueAt(input.dueAt);
    if (input.resolved === true) {
      thread.resolvedAt = now.toISOString();
      thread.resolvedBy = input.actorId;
    } else if (input.resolved === false) {
      delete thread.resolvedAt;
      delete thread.resolvedBy;
    }
    thread.updatedAt = now.toISOString();
    return structuredClone(thread);
  }

  heartbeat(input: {
    scope: ContentScope;
    entryId: string;
    actorId: string;
    displayName: string;
    field?: string;
    nodeId?: string;
    now?: Date;
  }): PresenceParticipant[] {
    const key = `${contentScopeKey(input.scope)}\u001e${input.entryId}`;
    const participants = this.#presence.get(key) ?? new Map<string, PresenceParticipant>();
    const now = input.now ?? new Date();
    participants.set(input.actorId, {
      actorId: input.actorId,
      displayName: input.displayName,
      ...(input.field ? { field: input.field } : {}),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      lastSeenAt: now.toISOString(),
    });
    this.#presence.set(key, participants);
    return this.snapshot(input.scope, input.entryId, now).presence;
  }

  leave(scope: ContentScope, entryId: string, actorId: string): void {
    const key = `${contentScopeKey(scope)}\u001e${entryId}`;
    const participants = this.#presence.get(key);
    participants?.delete(actorId);
    if (participants?.size === 0) this.#presence.delete(key);
  }

  #thread(scope: ContentScope, entryId: string, threadId: string): CommentThread {
    const key = `${contentScopeKey(scope)}\u001e${entryId}`;
    const thread = this.#threads.get(key)?.find((candidate) => candidate.id === threadId);
    if (!thread) {
      throw new GridStoryError('Comment thread was not found.', 'comment_not_found', 404);
    }
    return thread;
  }
}
