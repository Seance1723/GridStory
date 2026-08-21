import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { contentScopeKey } from './tenant-scope.js';
import {
  collaborationDocumentSchema,
  collaborationOperationSchema,
  type CollaborationBranch,
  type CollaborationBranchState,
  type CollaborationChangeTarget,
  type CollaborationConflict,
  type CollaborationDocument,
  type CollaborationMerge,
  type CollaborationOperation,
  type CollaborationOperationInput,
  type CollaborationSnapshot,
  type CollaborationSuggestion,
  type CollaborationTarget,
  type CommentMessage,
  type CommentThread,
  type ContentScope,
  type PresenceParticipant,
} from '@gridstory/schema';
import {
  InMemoryCollaborationRepository,
  type CollaborationRepository,
} from './collaboration-repository.js';
import { GridStoryError } from './errors.js';

const PRESENCE_TTL_MS = 30_000;
const EMPTY_DOCUMENT_TIME = '1970-01-01T00:00:00.000Z';
const WRITE_RETRIES = 4;

type OperationValue = CollaborationOperation['value'];

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
  id: string,
  actorId: string,
  body: string,
  mentions: string[] | undefined,
  now: Date,
): CommentMessage {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new GridStoryError('Comment body is required.', 'invalid_comment', 400);
  }
  return {
    id,
    actorId,
    body: trimmed,
    mentions: mentionIds(trimmed, mentions),
    createdAt: now.toISOString(),
  };
}

function emptyDocument(scope: ContentScope, entryId: string): CollaborationDocument {
  return {
    ...scope,
    entryId,
    version: 0,
    threads: [],
    operations: [],
    branches: [
      {
        id: 'main',
        entryId,
        name: 'Main',
        status: 'open',
        baseOperationIds: [],
        operationIds: [],
        headOperationIds: [],
        createdBy: 'system',
        createdAt: EMPTY_DOCUMENT_TIME,
        updatedAt: EMPTY_DOCUMENT_TIME,
      },
    ],
    suggestions: [],
    merges: [],
    conflicts: [],
    createdAt: EMPTY_DOCUMENT_TIME,
    updatedAt: EMPTY_DOCUMENT_TIME,
  };
}

function targetKey(target: CollaborationTarget): string {
  return [target.entryId, target.field ?? '', target.nodeId ?? '', target.property ?? ''].join(
    '\u001f',
  );
}

function operationMap(document: CollaborationDocument): Map<string, CollaborationOperation> {
  return new Map(document.operations.map((operation) => [operation.id, operation]));
}

function isAncestor(
  ancestorId: string,
  descendantId: string,
  operations: Map<string, CollaborationOperation>,
  visited = new Set<string>(),
): boolean {
  if (ancestorId === descendantId) return true;
  if (visited.has(descendantId)) return false;
  visited.add(descendantId);
  const descendant = operations.get(descendantId);
  if (!descendant) return false;
  return descendant.dependencies.some(
    (dependency) =>
      dependency === ancestorId || isAncestor(ancestorId, dependency, operations, visited),
  );
}

function operationOrder(left: CollaborationOperation, right: CollaborationOperation): number {
  return (
    left.actorSequence - right.actorSequence ||
    left.actorId.localeCompare(right.actorId) ||
    left.id.localeCompare(right.id)
  );
}

function branchState(
  document: CollaborationDocument,
  branch: CollaborationBranch,
): CollaborationBranchState {
  const operations = operationMap(document);
  const grouped = new Map<string, CollaborationOperation[]>();
  for (const operationId of branch.operationIds) {
    const operation = operations.get(operationId);
    if (!operation) continue;
    const key = targetKey(operation.target);
    const values = grouped.get(key) ?? [];
    values.push(operation);
    grouped.set(key, values);
  }

  const values = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, candidates]) => {
      const live = candidates.filter(
        (candidate) =>
          !candidates.some(
            (other) => candidate.id !== other.id && isAncestor(candidate.id, other.id, operations),
          ),
      );
      const winner = [...live].sort(operationOrder).at(-1);
      if (!winner) return null;
      const conflictingOperationIds = live
        .filter(
          (candidate) =>
            candidate.id !== winner.id &&
            (candidate.kind !== winner.kind || !isDeepStrictEqual(candidate.value, winner.value)),
        )
        .map((candidate) => candidate.id)
        .sort();
      return {
        target: winner.target,
        operationId: winner.id,
        kind: winner.kind,
        ...(winner.value !== undefined ? { value: winner.value } : {}),
        conflictingOperationIds,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  return {
    branchId: branch.id,
    version: branch.operationIds.length,
    headOperationIds: [...branch.headOperationIds],
    values,
  };
}

function branch(document: CollaborationDocument, branchId: string): CollaborationBranch {
  const found = document.branches.find((candidate) => candidate.id === branchId);
  if (!found) {
    throw new GridStoryError('Collaboration branch was not found.', 'branch_not_found', 404, {
      branchId,
    });
  }
  return found;
}

function ensureOpen(value: CollaborationBranch): void {
  if (value.status !== 'open') {
    throw new GridStoryError('Collaboration branch is not open.', 'branch_not_open', 409, {
      branchId: value.id,
      status: value.status,
    });
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function operationVariant(operation: CollaborationOperation) {
  return {
    operationId: operation.id,
    actorId: operation.actorId,
    branchId: operation.branchId,
    kind: operation.kind,
    ...(operation.value !== undefined ? { value: operation.value } : {}),
  };
}

function sameOperationSet(left: string[], right: string[]): boolean {
  return [...left].sort().join('\u001f') === [...right].sort().join('\u001f');
}

function updateMergeStatuses(document: CollaborationDocument, now: Date): void {
  for (const merge of document.merges) {
    if (merge.status === 'merged') continue;
    const resolved = merge.conflictIds.every(
      (id) => document.conflicts.find((conflict) => conflict.id === id)?.status === 'resolved',
    );
    if (!resolved) continue;
    merge.status = 'merged';
    merge.updatedAt = now.toISOString();
    merge.mergedAt = now.toISOString();
    const source = document.branches.find((candidate) => candidate.id === merge.sourceBranchId);
    if (source) {
      source.status = 'merged';
      source.updatedAt = now.toISOString();
      source.mergedAt = now.toISOString();
    }
  }
}

function synchronizeConflicts(
  document: CollaborationDocument,
  branchId: string,
  targetKeys: string[],
  now: Date,
  mergeId?: string,
): string[] {
  const selectedBranch = branch(document, branchId);
  const state = branchState(document, selectedBranch);
  const operations = operationMap(document);
  const conflictIds: string[] = [];
  for (const key of unique(targetKeys)) {
    const value = state.values.find((candidate) => targetKey(candidate.target) === key);
    const openForTarget = document.conflicts.filter(
      (conflict) =>
        conflict.branchId === branchId &&
        conflict.status === 'open' &&
        targetKey(conflict.target) === key,
    );
    if (!value || value.conflictingOperationIds.length === 0) {
      if (!value) continue;
      const winner = operations.get(value.operationId);
      for (const conflict of openForTarget) {
        if (
          winner &&
          conflict.variants.every((variant) =>
            isAncestor(variant.operationId, winner.id, operations),
          )
        ) {
          conflict.status = 'resolved';
          conflict.updatedAt = now.toISOString();
          conflict.resolution = {
            operationId: winner.id,
            actorId: winner.actorId,
            resolvedAt: now.toISOString(),
          };
        }
      }
      continue;
    }

    const variantIds = [value.operationId, ...value.conflictingOperationIds];
    const existing = openForTarget.find((conflict) =>
      sameOperationSet(
        conflict.variants.map((variant) => variant.operationId),
        variantIds,
      ),
    );
    if (existing) {
      if (mergeId && !existing.mergeId) existing.mergeId = mergeId;
      existing.updatedAt = now.toISOString();
      conflictIds.push(existing.id);
      continue;
    }
    for (const stale of openForTarget) {
      stale.status = 'resolved';
      stale.updatedAt = now.toISOString();
    }
    const variants = variantIds
      .map((id) => operations.get(id))
      .filter((operation): operation is CollaborationOperation => operation !== undefined)
      .sort(operationOrder)
      .map(operationVariant);
    const conflict: CollaborationConflict = {
      id: randomUUID(),
      entryId: document.entryId,
      branchId,
      ...(mergeId ? { mergeId } : {}),
      target: value.target,
      variants,
      status: 'open',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    document.conflicts.push(conflict);
    conflictIds.push(conflict.id);
  }
  updateMergeStatuses(document, now);
  return conflictIds;
}

function nextActorSequence(document: CollaborationDocument, actorId: string): number {
  return (
    document.operations.reduce(
      (maximum, operation) =>
        operation.actorId === actorId ? Math.max(maximum, operation.actorSequence) : maximum,
      0,
    ) + 1
  );
}

function applyOperation(
  document: CollaborationDocument,
  input: CollaborationOperationInput & { id: string; branchId: string },
  entryId: string,
  actorId: string,
  now: Date,
): CollaborationOperation {
  const selectedBranch = branch(document, input.branchId);
  ensureOpen(selectedBranch);
  const kind = input.kind ?? 'set';
  if (kind !== 'delete' && input.value === undefined) {
    throw new GridStoryError(
      `${kind} operations require a JSON value.`,
      'invalid_collaboration_operation',
      400,
    );
  }
  const resolvedTarget = { ...input.target, entryId };
  const existing = document.operations.find((operation) => operation.id === input.id);
  if (existing) {
    const dependenciesMatch =
      input.dependencies === undefined ||
      sameOperationSet(existing.dependencies, input.dependencies);
    if (
      existing.actorId !== actorId ||
      existing.entryId !== entryId ||
      existing.branchId !== input.branchId ||
      (input.actorSequence !== undefined && existing.actorSequence !== input.actorSequence) ||
      !dependenciesMatch ||
      !isDeepStrictEqual(existing.target, resolvedTarget) ||
      existing.kind !== kind ||
      !isDeepStrictEqual(existing.value, input.value)
    ) {
      throw new GridStoryError(
        'Collaboration operation ID is already in use with a different payload.',
        'collaboration_operation_conflict',
        409,
      );
    }
    return existing;
  }
  if (document.operations.length >= 10_000) {
    throw new GridStoryError(
      'Collaboration operation limit has been reached.',
      'collaboration_limit_exceeded',
      409,
    );
  }
  const dependencies = unique(input.dependencies ?? selectedBranch.headOperationIds);
  const selectedIds = new Set(selectedBranch.operationIds);
  if (dependencies.some((dependency) => !selectedIds.has(dependency))) {
    throw new GridStoryError(
      'Operation dependencies must exist on the selected branch.',
      'invalid_collaboration_dependency',
      409,
    );
  }
  const actorSequence = input.actorSequence ?? nextActorSequence(document, actorId);
  if (
    document.operations.some(
      (operation) => operation.actorId === actorId && operation.actorSequence === actorSequence,
    )
  ) {
    throw new GridStoryError(
      'Actor sequence is already in use.',
      'collaboration_actor_sequence_conflict',
      409,
      { actorId, actorSequence },
    );
  }
  const operation = collaborationOperationSchema.parse({
    id: input.id,
    entryId,
    branchId: input.branchId,
    actorId,
    actorSequence,
    dependencies,
    target: resolvedTarget,
    kind,
    ...(input.value !== undefined ? { value: input.value } : {}),
    createdAt: now.toISOString(),
  });
  document.operations.push(operation);
  selectedBranch.operationIds.push(operation.id);
  const operations = operationMap(document);
  selectedBranch.headOperationIds = unique([
    ...selectedBranch.headOperationIds.filter(
      (headId) => !isAncestor(headId, operation.id, operations),
    ),
    operation.id,
  ]).sort();
  selectedBranch.updatedAt = now.toISOString();
  synchronizeConflicts(document, selectedBranch.id, [targetKey(operation.target)], now);
  return operation;
}

export class CollaborationService {
  readonly #repository: CollaborationRepository;
  readonly #presence = new Map<string, Map<string, PresenceParticipant>>();

  constructor(options: { repository?: CollaborationRepository } = {}) {
    this.#repository = options.repository ?? new InMemoryCollaborationRepository();
  }

  async snapshot(
    scope: ContentScope,
    entryId: string,
    now = new Date(),
  ): Promise<CollaborationSnapshot> {
    const key = `${contentScopeKey(scope)}\u001e${entryId}`;
    const participants = this.#presence.get(key);
    if (participants) {
      const cutoff = now.getTime() - PRESENCE_TTL_MS;
      for (const [actorId, participant] of participants) {
        if (Date.parse(participant.lastSeenAt) < cutoff) participants.delete(actorId);
      }
      if (participants.size === 0) this.#presence.delete(key);
    }
    const document = (await this.#repository.get(scope, entryId)) ?? emptyDocument(scope, entryId);
    return structuredClone({
      ...scope,
      entryId,
      version: document.version,
      threads: document.threads,
      presence: [...(participants?.values() ?? [])],
      operations: document.operations,
      branches: document.branches,
      branchStates: document.branches.map((candidate) => branchState(document, candidate)),
      suggestions: document.suggestions,
      merges: document.merges,
      conflicts: document.conflicts,
    });
  }

  async submitOperation(input: {
    scope: ContentScope;
    entryId: string;
    actorId: string;
    operation: CollaborationOperationInput;
    now?: Date;
  }): Promise<CollaborationOperation> {
    const now = input.now ?? new Date();
    const id = input.operation.id ?? randomUUID();
    return this.#mutate(input.scope, input.entryId, now, (document) =>
      applyOperation(
        document,
        {
          ...input.operation,
          id,
          branchId: input.operation.branchId ?? 'main',
          kind: input.operation.kind ?? 'set',
        },
        input.entryId,
        input.actorId,
        now,
      ),
    );
  }

  async createBranch(input: {
    scope: ContentScope;
    entryId: string;
    actorId: string;
    name: string;
    parentBranchId?: string;
    id?: string;
    now?: Date;
  }): Promise<CollaborationBranch> {
    const now = input.now ?? new Date();
    const id = input.id ?? randomUUID();
    return this.#mutate(input.scope, input.entryId, now, (document) => {
      if (document.branches.some((candidate) => candidate.id === id)) {
        throw new GridStoryError(
          'Collaboration branch ID is already in use.',
          'branch_conflict',
          409,
        );
      }
      if (document.branches.length >= 100) {
        throw new GridStoryError(
          'Collaboration branch limit has been reached.',
          'branch_limit',
          409,
        );
      }
      const parent = branch(document, input.parentBranchId ?? 'main');
      ensureOpen(parent);
      const name = input.name.trim();
      if (!name) throw new GridStoryError('Branch name is required.', 'invalid_branch', 400);
      const created: CollaborationBranch = {
        id,
        entryId: input.entryId,
        name,
        status: 'open',
        parentBranchId: parent.id,
        baseOperationIds: [...parent.operationIds],
        operationIds: [...parent.operationIds],
        headOperationIds: [...parent.headOperationIds],
        createdBy: input.actorId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      document.branches.push(created);
      return created;
    });
  }

  async createSuggestion(input: {
    scope: ContentScope;
    entryId: string;
    actorId: string;
    branchId?: string;
    target: Omit<CollaborationChangeTarget, 'entryId'>;
    kind?: CollaborationOperation['kind'];
    value?: OperationValue;
    id?: string;
    now?: Date;
  }): Promise<CollaborationSuggestion> {
    const now = input.now ?? new Date();
    const id = input.id ?? randomUUID();
    return this.#mutate(input.scope, input.entryId, now, (document) => {
      const selectedBranch = branch(document, input.branchId ?? 'main');
      ensureOpen(selectedBranch);
      const kind = input.kind ?? 'set';
      if (kind !== 'delete' && input.value === undefined) {
        throw new GridStoryError(
          'Suggestion value is required.',
          'invalid_collaboration_suggestion',
          400,
        );
      }
      const suggestion: CollaborationSuggestion = {
        id,
        entryId: input.entryId,
        branchId: selectedBranch.id,
        target: { ...input.target, entryId: input.entryId },
        kind,
        ...(input.value !== undefined ? { value: input.value } : {}),
        status: 'open',
        createdBy: input.actorId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      document.suggestions.push(suggestion);
      return suggestion;
    });
  }

  async reviewSuggestion(input: {
    scope: ContentScope;
    entryId: string;
    suggestionId: string;
    actorId: string;
    decision: 'accept' | 'reject';
    actorSequence?: number;
    now?: Date;
  }): Promise<CollaborationSuggestion> {
    const now = input.now ?? new Date();
    const operationId = randomUUID();
    return this.#mutate(input.scope, input.entryId, now, (document) => {
      const suggestion = document.suggestions.find(
        (candidate) => candidate.id === input.suggestionId,
      );
      if (!suggestion) {
        throw new GridStoryError('Suggestion was not found.', 'suggestion_not_found', 404);
      }
      if (suggestion.status !== 'open') {
        throw new GridStoryError('Suggestion was already reviewed.', 'suggestion_reviewed', 409);
      }
      if (input.decision === 'accept') {
        const operation = applyOperation(
          document,
          {
            id: operationId,
            branchId: suggestion.branchId,
            ...(input.actorSequence ? { actorSequence: input.actorSequence } : {}),
            target: {
              field: suggestion.target.field,
              ...(suggestion.target.nodeId ? { nodeId: suggestion.target.nodeId } : {}),
              ...(suggestion.target.property ? { property: suggestion.target.property } : {}),
            },
            kind: suggestion.kind,
            ...(suggestion.value !== undefined ? { value: suggestion.value } : {}),
          },
          input.entryId,
          input.actorId,
          now,
        );
        suggestion.status = 'accepted';
        suggestion.operationId = operation.id;
      } else {
        suggestion.status = 'rejected';
      }
      suggestion.reviewedBy = input.actorId;
      suggestion.reviewedAt = now.toISOString();
      suggestion.updatedAt = now.toISOString();
      return suggestion;
    });
  }

  async mergeBranches(input: {
    scope: ContentScope;
    entryId: string;
    actorId: string;
    sourceBranchId: string;
    targetBranchId?: string;
    id?: string;
    now?: Date;
  }): Promise<CollaborationMerge> {
    const now = input.now ?? new Date();
    const id = input.id ?? randomUUID();
    return this.#mutate(input.scope, input.entryId, now, (document) => {
      const source = branch(document, input.sourceBranchId);
      const target = branch(document, input.targetBranchId ?? 'main');
      ensureOpen(source);
      ensureOpen(target);
      if (source.id === target.id) {
        throw new GridStoryError('A branch cannot be merged into itself.', 'invalid_merge', 400);
      }
      const targetIds = new Set(target.operationIds);
      const sourceOnly = source.operationIds.filter((operationId) => !targetIds.has(operationId));
      const changedTargetKeys = document.operations
        .filter((operation) => sourceOnly.includes(operation.id))
        .map((operation) => targetKey(operation.target));
      target.operationIds = unique([...target.operationIds, ...sourceOnly]);
      const operations = operationMap(document);
      target.headOperationIds = unique([...target.headOperationIds, ...source.headOperationIds])
        .filter(
          (candidate) =>
            ![...target.headOperationIds, ...source.headOperationIds].some(
              (other) => candidate !== other && isAncestor(candidate, other, operations),
            ),
        )
        .sort();
      target.updatedAt = now.toISOString();

      const merge: CollaborationMerge = {
        id,
        entryId: input.entryId,
        sourceBranchId: source.id,
        targetBranchId: target.id,
        status: 'merged',
        conflictIds: [],
        createdBy: input.actorId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      document.merges.push(merge);
      const conflictIds = synchronizeConflicts(
        document,
        target.id,
        changedTargetKeys,
        now,
        merge.id,
      );
      merge.conflictIds = conflictIds;
      if (conflictIds.length > 0) merge.status = 'conflicted';
      else {
        merge.mergedAt = now.toISOString();
        source.status = 'merged';
        source.mergedAt = now.toISOString();
        source.updatedAt = now.toISOString();
      }
      return merge;
    });
  }

  async resolveConflict(input: {
    scope: ContentScope;
    entryId: string;
    conflictId: string;
    actorId: string;
    operationId?: string;
    value?: OperationValue;
    kind?: CollaborationOperation['kind'];
    actorSequence?: number;
    now?: Date;
  }): Promise<CollaborationConflict> {
    const now = input.now ?? new Date();
    const resolutionId = randomUUID();
    return this.#mutate(input.scope, input.entryId, now, (document) => {
      const conflict = document.conflicts.find((candidate) => candidate.id === input.conflictId);
      if (!conflict) {
        throw new GridStoryError(
          'Collaboration conflict was not found.',
          'conflict_not_found',
          404,
        );
      }
      if (conflict.status !== 'open') {
        throw new GridStoryError(
          'Collaboration conflict is already resolved.',
          'conflict_resolved',
          409,
        );
      }
      const chosen = input.operationId
        ? conflict.variants.find((variant) => variant.operationId === input.operationId)
        : undefined;
      if (input.operationId && !chosen) {
        throw new GridStoryError(
          'Conflict variant was not found.',
          'invalid_conflict_variant',
          400,
        );
      }
      if (!chosen && input.value === undefined) {
        throw new GridStoryError(
          'Choose a conflict variant or provide a custom JSON value.',
          'invalid_conflict_resolution',
          400,
        );
      }
      const selectedBranch = branch(document, conflict.branchId);
      const dependencies = unique([
        ...selectedBranch.headOperationIds,
        ...conflict.variants.map((variant) => variant.operationId),
      ]);
      const operation = applyOperation(
        document,
        {
          id: resolutionId,
          branchId: conflict.branchId,
          ...(input.actorSequence ? { actorSequence: input.actorSequence } : {}),
          dependencies,
          target: {
            field: conflict.target.field,
            ...(conflict.target.nodeId ? { nodeId: conflict.target.nodeId } : {}),
            ...(conflict.target.property ? { property: conflict.target.property } : {}),
          },
          kind: chosen?.kind ?? input.kind ?? 'set',
          ...((chosen?.value ?? input.value) !== undefined
            ? { value: chosen?.value ?? input.value }
            : {}),
        },
        input.entryId,
        input.actorId,
        now,
      );
      conflict.status = 'resolved';
      conflict.updatedAt = now.toISOString();
      conflict.resolution = {
        operationId: operation.id,
        actorId: input.actorId,
        resolvedAt: now.toISOString(),
      };
      updateMergeStatuses(document, now);
      return conflict;
    });
  }

  async createThread(input: {
    scope: ContentScope;
    target: CollaborationTarget;
    actorId: string;
    body: string;
    mentions?: string[];
    assigneeId?: string;
    dueAt?: string;
    now?: Date;
  }): Promise<CommentThread> {
    const now = input.now ?? new Date();
    const threadId = randomUUID();
    const messageId = randomUUID();
    return this.#mutate(input.scope, input.target.entryId, now, (document) => {
      const firstMessage = message(messageId, input.actorId, input.body, input.mentions, now);
      const thread: CommentThread = {
        ...input.scope,
        id: threadId,
        target: input.target,
        messages: [firstMessage],
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        ...(input.dueAt ? { dueAt: normalizedDueAt(input.dueAt) } : {}),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      document.threads.push(thread);
      return thread;
    });
  }

  async reply(input: {
    scope: ContentScope;
    entryId: string;
    threadId: string;
    actorId: string;
    body: string;
    mentions?: string[];
    now?: Date;
  }): Promise<CommentThread> {
    const now = input.now ?? new Date();
    const messageId = randomUUID();
    return this.#mutate(input.scope, input.entryId, now, (document) => {
      const thread = this.#thread(document, input.threadId);
      thread.messages.push(message(messageId, input.actorId, input.body, input.mentions, now));
      thread.updatedAt = now.toISOString();
      return thread;
    });
  }

  async updateThread(input: {
    scope: ContentScope;
    entryId: string;
    threadId: string;
    actorId: string;
    assigneeId?: string | null;
    dueAt?: string | null;
    resolved?: boolean;
    now?: Date;
  }): Promise<CommentThread> {
    const now = input.now ?? new Date();
    return this.#mutate(input.scope, input.entryId, now, (document) => {
      const thread = this.#thread(document, input.threadId);
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
      return thread;
    });
  }

  async heartbeat(input: {
    scope: ContentScope;
    entryId: string;
    actorId: string;
    displayName: string;
    field?: string;
    nodeId?: string;
    now?: Date;
  }): Promise<PresenceParticipant[]> {
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
    return (await this.snapshot(input.scope, input.entryId, now)).presence;
  }

  leave(scope: ContentScope, entryId: string, actorId: string): void {
    const key = `${contentScopeKey(scope)}\u001e${entryId}`;
    const participants = this.#presence.get(key);
    participants?.delete(actorId);
    if (participants?.size === 0) this.#presence.delete(key);
  }

  async close(): Promise<void> {
    await this.#repository.close();
  }

  #thread(document: CollaborationDocument, threadId: string): CommentThread {
    const thread = document.threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      throw new GridStoryError('Comment thread was not found.', 'comment_not_found', 404);
    }
    return thread;
  }

  async #mutate<T>(
    scope: ContentScope,
    entryId: string,
    now: Date,
    mutation: (document: CollaborationDocument) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const current = await this.#repository.get(scope, entryId);
      const document = current ? structuredClone(current) : emptyDocument(scope, entryId);
      const beforeMutation = JSON.stringify(document);
      const result = mutation(document);
      if (JSON.stringify(document) === beforeMutation) return structuredClone(result);
      document.version = (current?.version ?? 0) + 1;
      document.updatedAt = now.toISOString();
      if (!current) document.createdAt = now.toISOString();
      const parsed = collaborationDocumentSchema.parse(document);
      try {
        await this.#repository.save(parsed, current?.version ?? null);
        return structuredClone(result);
      } catch (error) {
        if (
          !(error instanceof GridStoryError) ||
          error.code !== 'collaboration_write_conflict' ||
          attempt === WRITE_RETRIES - 1
        ) {
          throw error;
        }
      }
    }
    throw new GridStoryError(
      'Collaboration state could not be updated.',
      'collaboration_write_conflict',
      409,
    );
  }
}
