import { randomUUID } from 'node:crypto';
import {
  workflowActionDefinitionSchema,
  workflowDefinitionInputSchema,
  workflowDefinitionSchema,
  workflowInstanceSchema,
  type ContentEntry,
  type ContentScope,
  type WorkflowActionDefinition,
  type WorkflowDefinition,
  type WorkflowDefinitionInput,
  type WorkflowInstance,
  type WorkflowNotification,
  type WorkflowSchedule,
  type WorkflowTransitionDefinition,
} from '@gridstory/schema';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import type { Actor, ContentRepository, ContentWorkflowGate } from './types.js';
import type { WorkflowRepository } from './workflow-repository.js';

export interface WorkflowNotifier {
  deliver(input: {
    scope: ContentScope;
    entryId: string;
    notification: WorkflowNotification;
  }): Promise<void>;
}

export interface WorkflowServiceOptions {
  repository: WorkflowRepository;
  jobRepository?: Pick<ContentRepository, 'enqueueJob' | 'listJobs'>;
  notifier?: WorkflowNotifier;
  now?: () => Date;
  createId?: () => string;
  defaultDefinitions?: Array<{ id: string; definition: WorkflowDefinitionInput }>;
}

export interface DueWorkflowExecution {
  scope: ContentScope;
  instance: WorkflowInstance;
  schedule: WorkflowSchedule;
}

function iso(date: Date): string {
  return date.toISOString();
}

function hasAllowedRole(actor: Actor, allowedRoles: string[]): boolean {
  return (actor.roles ?? []).some((role) => allowedRoles.includes(role));
}

function details(
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
): Record<string, unknown> {
  return {
    workflowId: definition.id,
    workflowVersion: definition.version,
    stateId: instance.stateId,
    pendingApprovalId: instance.pendingApproval?.id,
  };
}

export function defaultEditorialWorkflow(): WorkflowDefinitionInput {
  return workflowDefinitionInputSchema.parse({
    name: 'Editorial review',
    contentType: 'page',
    version: 1,
    initialStateId: 'draft',
    states: [
      { id: 'draft', label: 'Draft', kind: 'draft' },
      { id: 'in-review', label: 'In review', kind: 'review' },
      { id: 'approved', label: 'Approved', kind: 'approved' },
      { id: 'published', label: 'Published', kind: 'published' },
      { id: 'archived', label: 'Archived', kind: 'archived', terminal: true },
    ],
    transitions: [
      {
        id: 'submit-review',
        label: 'Submit for review',
        from: 'draft',
        to: 'in-review',
        allowedRoles: ['author', 'publisher', 'admin'],
      },
      {
        id: 'approve',
        label: 'Request approval',
        from: 'in-review',
        to: 'approved',
        allowedRoles: ['author', 'publisher', 'admin'],
        approval: {
          minimumApprovals: 1,
          allowedRoles: ['publisher', 'admin'],
          separationOfDuties: true,
          dueAfterHours: 24,
          escalateToRoles: ['admin'],
          fields: [],
          locales: [],
        },
      },
      {
        id: 'request-changes',
        label: 'Request changes',
        from: 'in-review',
        to: 'draft',
        allowedRoles: ['publisher', 'admin'],
      },
      {
        id: 'publish',
        label: 'Publish',
        from: 'approved',
        to: 'published',
        allowedRoles: ['publisher', 'admin'],
      },
      {
        id: 'revise',
        label: 'Create new draft',
        from: 'published',
        to: 'draft',
        allowedRoles: ['author', 'publisher', 'admin'],
      },
      {
        id: 'archive',
        label: 'Archive',
        from: 'published',
        to: 'archived',
        allowedRoles: ['publisher', 'admin'],
      },
      {
        id: 'restore',
        label: 'Restore as draft',
        from: 'archived',
        to: 'draft',
        allowedRoles: ['publisher', 'admin'],
      },
    ],
  });
}

export class WorkflowService implements ContentWorkflowGate {
  readonly #repository: WorkflowRepository;
  readonly #jobRepository: Pick<ContentRepository, 'enqueueJob' | 'listJobs'> | undefined;
  readonly #notifier: WorkflowNotifier;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #defaultDefinitions: Array<{ id: string; definition: WorkflowDefinitionInput }>;

  constructor({
    repository,
    jobRepository,
    notifier = { deliver: async () => undefined },
    now = () => new Date(),
    createId = randomUUID,
    defaultDefinitions = [],
  }: WorkflowServiceOptions) {
    this.#repository = repository;
    this.#jobRepository = jobRepository;
    this.#notifier = notifier;
    this.#now = now;
    this.#createId = createId;
    this.#defaultDefinitions = defaultDefinitions.map((candidate) => ({
      id: candidate.id,
      definition: workflowDefinitionInputSchema.parse(candidate.definition),
    }));
  }

  async #ensureDefaults(scope: ContentScope): Promise<void> {
    const existing = await this.#repository.listDefinitions(scope);
    for (const candidate of this.#defaultDefinitions) {
      if (
        existing.some((definition) => definition.contentType === candidate.definition.contentType)
      )
        continue;
      const now = iso(this.#now());
      await this.#repository.saveDefinition(
        workflowDefinitionSchema.parse({
          ...scope,
          ...candidate.definition,
          id: candidate.id,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  }

  async listDefinitions(scope: ContentScope): Promise<WorkflowDefinition[]> {
    await this.#ensureDefaults(scope);
    return await this.#repository.listDefinitions(scope);
  }

  async getDefinition(scope: ContentScope, id: string): Promise<WorkflowDefinition> {
    const definition = await this.#repository.getDefinition(scope, id);
    if (!definition) throw new NotFoundError('Workflow definition was not found.');
    return definition;
  }

  async saveDefinition(input: {
    scope: ContentScope;
    id: string;
    definition: WorkflowDefinitionInput;
  }): Promise<WorkflowDefinition> {
    const candidate = workflowDefinitionInputSchema.parse(input.definition);
    await this.#ensureDefaults(input.scope);
    const existing = await this.#repository.getDefinition(input.scope, input.id);
    if (existing && candidate.version <= existing.version) {
      throw new ConflictError('Workflow updates must increment the definition version.', {
        currentVersion: existing.version,
      });
    }
    const conflicting = (await this.#repository.listDefinitions(input.scope)).find(
      (definition) =>
        definition.contentType === candidate.contentType && definition.id !== input.id,
    );
    if (conflicting) {
      throw new ConflictError(
        `Content type ${candidate.contentType} already uses workflow ${conflicting.id}.`,
      );
    }
    const now = iso(this.#now());
    return await this.#repository.saveDefinition(
      workflowDefinitionSchema.parse({
        ...input.scope,
        ...candidate,
        id: input.id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }),
    );
  }

  async ensureInstance(input: {
    scope: ContentScope;
    entryId: string;
    contentType: string;
    revisionId: string;
    published?: boolean;
    actorId?: string;
  }): Promise<WorkflowInstance> {
    const existing = await this.#repository.getInstance(input.scope, input.entryId);
    if (existing) return existing;
    const definition = (await this.listDefinitions(input.scope)).find(
      (candidate) => candidate.contentType === input.contentType,
    );
    if (!definition) {
      throw new GridStoryError(
        `No workflow is configured for content type ${input.contentType}.`,
        'workflow_not_configured',
        409,
      );
    }
    const stateId = input.published
      ? (definition.states.find((state) => state.kind === 'published')?.id ??
        definition.initialStateId)
      : definition.initialStateId;
    const now = iso(this.#now());
    return await this.#repository.saveInstance(
      workflowInstanceSchema.parse({
        ...input.scope,
        entryId: input.entryId,
        contentType: input.contentType,
        workflowId: definition.id,
        workflowVersion: definition.version,
        stateId,
        revisionId: input.revisionId,
        schedules: [],
        notifications: [],
        history: [
          {
            id: this.#createId(),
            kind: 'initialized',
            actorId: input.actorId ?? 'gridstory-workflow',
            toStateId: stateId,
            occurredAt: now,
            details: {},
          },
        ],
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  async getInstance(input: {
    scope: ContentScope;
    entry: ContentEntry;
  }): Promise<WorkflowInstance> {
    return await this.ensureInstance({
      scope: input.scope,
      entryId: input.entry.id,
      contentType: input.entry.contentType,
      revisionId: input.entry.draftRevisionId,
      published: input.entry.status === 'published',
    });
  }

  async #context(instance: WorkflowInstance): Promise<{
    instance: WorkflowInstance;
    definition: WorkflowDefinition;
  }> {
    const definition = await this.getDefinition(instance, instance.workflowId);
    return { instance, definition };
  }

  #transition(
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
    transitionId: string,
  ): WorkflowTransitionDefinition {
    const transition = definition.transitions.find(
      (candidate) => candidate.id === transitionId && candidate.from === instance.stateId,
    );
    if (!transition) {
      throw new GridStoryError(
        'The requested workflow transition is not available from the current state.',
        'workflow_transition_unavailable',
        409,
        details(instance, definition),
      );
    }
    return transition;
  }

  #assertTransitionRole(actor: Actor, transition: WorkflowTransitionDefinition): void {
    if (!hasAllowedRole(actor, transition.allowedRoles)) {
      throw new GridStoryError(
        'The actor does not hold a role allowed by this workflow transition.',
        'workflow_transition_forbidden',
        403,
        { transitionId: transition.id, allowedRoles: transition.allowedRoles },
      );
    }
  }

  async #notify(
    instance: WorkflowInstance,
    kind: WorkflowNotification['kind'],
    message: string,
    audienceRoles: string[],
  ): Promise<WorkflowInstance> {
    const notification: WorkflowNotification = {
      id: this.#createId(),
      kind,
      message,
      audienceRoles: [...new Set(audienceRoles)],
      createdAt: iso(this.#now()),
    };
    const updated = await this.#repository.saveInstance({
      ...instance,
      notifications: [...instance.notifications, notification].slice(-200),
      updatedAt: notification.createdAt,
    });
    await this.#notifier.deliver({ scope: updated, entryId: updated.entryId, notification });
    return updated;
  }

  async #enqueueTransitionActions(input: {
    instance: WorkflowInstance;
    transitionId: string;
    eventId: string;
    workflowVersion: number;
    actions: WorkflowActionDefinition[];
  }): Promise<number> {
    if (!this.#jobRepository || input.actions.length === 0) return 0;
    const runAt = iso(this.#now());
    for (const action of input.actions) {
      await this.#jobRepository.enqueueJob({
        scope: input.instance,
        type: 'workflow.action',
        idempotencyKey: [
          'workflow',
          input.instance.workflowId,
          input.workflowVersion,
          input.instance.entryId,
          input.instance.revisionId,
          input.eventId,
          action.id,
        ].join(':'),
        payload: {
          eventId: input.eventId,
          workflowId: input.instance.workflowId,
          workflowVersion: input.workflowVersion,
          entryId: input.instance.entryId,
          revisionId: input.instance.revisionId,
          transitionId: input.transitionId,
          action,
        },
        runAt,
        maxAttempts: action.maxAttempts,
      });
    }
    return input.actions.length;
  }

  async reconcileActions(scope: ContentScope): Promise<{ discovered: number; reconciled: number }> {
    if (!this.#jobRepository) return { discovered: 0, reconciled: 0 };
    let discovered = 0;
    let reconciled = 0;
    for (const instance of await this.#repository.listInstances(scope)) {
      for (const event of instance.history) {
        if (!event.transitionId || !event.details.actions) continue;
        let actions: WorkflowActionDefinition[];
        try {
          actions = workflowActionDefinitionSchema.array().parse(JSON.parse(event.details.actions));
        } catch {
          continue;
        }
        const storedVersion = Number(event.details.workflowVersion);
        const workflowVersion =
          Number.isInteger(storedVersion) && storedVersion > 0
            ? storedVersion
            : instance.workflowVersion;
        discovered += actions.length;
        reconciled += await this.#enqueueTransitionActions({
          instance,
          workflowVersion,
          transitionId: event.transitionId,
          eventId: event.id,
          actions,
        });
      }
    }
    return { discovered, reconciled };
  }

  async #completeTransition(input: {
    instance: WorkflowInstance;
    definition: WorkflowDefinition;
    transition: WorkflowTransitionDefinition;
    actor: Actor;
    kind?: 'transition' | 'approval';
  }): Promise<WorkflowInstance> {
    const now = iso(this.#now());
    const eventId = this.#createId();
    const updated = await this.#repository.saveInstance({
      ...input.instance,
      stateId: input.transition.to,
      workflowVersion: input.definition.version,
      pendingApproval: undefined,
      history: [
        ...input.instance.history,
        {
          id: eventId,
          kind: input.kind ?? 'transition',
          actorId: input.actor.id,
          transitionId: input.transition.id,
          fromStateId: input.transition.from,
          toStateId: input.transition.to,
          occurredAt: now,
          details: {
            workflowVersion: String(input.definition.version),
            ...(input.transition.actions.length
              ? { actions: JSON.stringify(input.transition.actions) }
              : {}),
          },
        },
      ],
      updatedAt: now,
    });
    await this.#enqueueTransitionActions({
      instance: updated,
      transitionId: input.transition.id,
      eventId,
      workflowVersion: input.definition.version,
      actions: input.transition.actions,
    });
    return await this.#notify(
      updated,
      'transition-completed',
      `${input.transition.label} completed.`,
      input.transition.allowedRoles,
    );
  }

  async requestTransition(input: {
    scope: ContentScope;
    entry: ContentEntry;
    transitionId: string;
    actor: Actor;
    changedFields?: string[];
  }): Promise<WorkflowInstance> {
    let instance = await this.getInstance({ scope: input.scope, entry: input.entry });
    const { definition } = await this.#context(instance);
    if (instance.revisionId !== input.entry.draftRevisionId) {
      throw new ConflictError('The workflow state belongs to an older draft revision.', {
        workflowRevisionId: instance.revisionId,
        draftRevisionId: input.entry.draftRevisionId,
      });
    }
    if (instance.pendingApproval) {
      throw new ConflictError(
        'Resolve the pending approval before requesting another transition.',
        {
          pendingApprovalId: instance.pendingApproval.id,
        },
      );
    }
    const transition = this.#transition(instance, definition, input.transitionId);
    this.#assertTransitionRole(input.actor, transition);
    const target = definition.states.find((state) => state.id === transition.to);
    if (target?.kind === 'published') {
      throw new GridStoryError(
        'Published workflow state is completed only by the content publish operation.',
        'workflow_publish_required',
        409,
      );
    }
    const changedFields = [...new Set(input.changedFields ?? [])];
    const approval = transition.approval;
    const approvalApplies =
      approval !== undefined &&
      (approval.locales.length === 0 || approval.locales.includes(input.scope.locale)) &&
      (approval.fields.length === 0 ||
        changedFields.some((field) => approval.fields.includes(field)));
    if (!approvalApplies) {
      return await this.#completeTransition({
        instance,
        definition,
        transition,
        actor: input.actor,
      });
    }
    const now = this.#now();
    instance = await this.#repository.saveInstance({
      ...instance,
      pendingApproval: {
        id: this.#createId(),
        transitionId: transition.id,
        revisionId: instance.revisionId,
        requestedBy: input.actor.id,
        requestedByRoles: input.actor.roles ?? [],
        requestedAt: iso(now),
        changedFields,
        decisions: [],
        ...(approval.dueAfterHours
          ? { dueAt: iso(new Date(now.getTime() + approval.dueAfterHours * 3_600_000)) }
          : {}),
      },
      history: [
        ...instance.history,
        {
          id: this.#createId(),
          kind: 'approval',
          actorId: input.actor.id,
          transitionId: transition.id,
          fromStateId: transition.from,
          occurredAt: iso(now),
          details: { action: 'requested' },
        },
      ],
      updatedAt: iso(now),
    });
    return await this.#notify(
      instance,
      'transition-requested',
      `${transition.label} requires ${approval.minimumApprovals} approval(s).`,
      approval.allowedRoles,
    );
  }

  async decideApproval(input: {
    scope: ContentScope;
    entry: ContentEntry;
    requestId: string;
    decision: 'approved' | 'rejected';
    actor: Actor;
    comment?: string;
  }): Promise<WorkflowInstance> {
    let instance = await this.getInstance({ scope: input.scope, entry: input.entry });
    const { definition } = await this.#context(instance);
    const request = instance.pendingApproval;
    if (!request || request.id !== input.requestId) {
      throw new NotFoundError('Pending workflow approval was not found.');
    }
    if (request.revisionId !== input.entry.draftRevisionId) {
      throw new ConflictError('The draft changed after approval was requested.');
    }
    const transition = this.#transition(instance, definition, request.transitionId);
    const approval = transition.approval;
    if (!approval) throw new ConflictError('The workflow transition no longer requires approval.');
    if (!hasAllowedRole(input.actor, approval.allowedRoles)) {
      throw new GridStoryError(
        'The actor does not hold a reviewer role for this approval.',
        'workflow_approval_forbidden',
        403,
        { allowedRoles: approval.allowedRoles },
      );
    }
    if (approval.separationOfDuties && request.requestedBy === input.actor.id) {
      throw new GridStoryError(
        'Separation of duties prevents a requester from approving their own transition.',
        'workflow_separation_of_duties',
        403,
      );
    }
    if (request.decisions.some((decision) => decision.actorId === input.actor.id)) {
      throw new ConflictError('This actor has already decided the approval request.');
    }
    const now = iso(this.#now());
    const decision = {
      actorId: input.actor.id,
      actorRoles: input.actor.roles ?? [],
      decision: input.decision,
      ...(input.comment ? { comment: input.comment } : {}),
      decidedAt: now,
    } as const;
    const updatedRequest = { ...request, decisions: [...request.decisions, decision] };
    instance = await this.#repository.saveInstance({
      ...instance,
      pendingApproval: input.decision === 'rejected' ? undefined : updatedRequest,
      history: [
        ...instance.history,
        {
          id: this.#createId(),
          kind: input.decision === 'rejected' ? 'rejection' : 'approval',
          actorId: input.actor.id,
          transitionId: transition.id,
          occurredAt: now,
          details: { decision: input.decision },
        },
      ],
      updatedAt: now,
    });
    if (input.decision === 'rejected') {
      return await this.#notify(
        instance,
        'approval-rejected',
        `${transition.label} was rejected.`,
        request.requestedByRoles,
      );
    }
    instance = await this.#notify(
      instance,
      'approval-recorded',
      `Approval recorded for ${transition.label}.`,
      request.requestedByRoles,
    );
    const approvals = updatedRequest.decisions.filter(
      (candidate) => candidate.decision === 'approved',
    );
    if (approvals.length >= approval.minimumApprovals) {
      return await this.#completeTransition({
        instance: { ...instance, pendingApproval: updatedRequest },
        definition,
        transition,
        actor: input.actor,
        kind: 'approval',
      });
    }
    return instance;
  }

  async scheduleTransition(input: {
    scope: ContentScope;
    entry: ContentEntry;
    transitionId: string;
    runAt: string;
    timeZone: string;
    actor: Actor;
  }): Promise<WorkflowInstance> {
    let instance = await this.getInstance({ scope: input.scope, entry: input.entry });
    const { definition } = await this.#context(instance);
    const transition = this.#transition(instance, definition, input.transitionId);
    this.#assertTransitionRole(input.actor, transition);
    if (transition.approval) {
      throw new GridStoryError(
        'Approval transitions must be approved before a later transition can be scheduled.',
        'workflow_schedule_requires_approval',
        409,
      );
    }
    const runAt = new Date(input.runAt);
    if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= this.#now().getTime()) {
      throw new GridStoryError('runAt must be a future ISO-8601 instant.', 'invalid_schedule', 400);
    }
    try {
      new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format(runAt);
    } catch {
      throw new GridStoryError('timeZone must be a valid IANA time zone.', 'invalid_schedule', 400);
    }
    const now = iso(this.#now());
    const schedule: WorkflowSchedule = {
      id: this.#createId(),
      transitionId: transition.id,
      revisionId: instance.revisionId,
      requestedBy: input.actor.id,
      requestedByRoles: input.actor.roles ?? [],
      runAt: iso(runAt),
      timeZone: input.timeZone,
      state: 'pending',
      createdAt: now,
    };
    instance = await this.#repository.saveInstance({
      ...instance,
      schedules: [...instance.schedules, schedule].slice(-100),
      history: [
        ...instance.history,
        {
          id: this.#createId(),
          kind: 'schedule',
          actorId: input.actor.id,
          transitionId: transition.id,
          occurredAt: now,
          details: { action: 'created', runAt: schedule.runAt, timeZone: schedule.timeZone },
        },
      ],
      updatedAt: now,
    });
    return await this.#notify(
      instance,
      'schedule-created',
      `${transition.label} scheduled for ${schedule.runAt} (${schedule.timeZone}).`,
      transition.allowedRoles,
    );
  }

  async cancelSchedule(input: {
    scope: ContentScope;
    entry: ContentEntry;
    scheduleId: string;
    actor: Actor;
  }): Promise<WorkflowInstance> {
    let instance = await this.getInstance({ scope: input.scope, entry: input.entry });
    const schedule = instance.schedules.find((candidate) => candidate.id === input.scheduleId);
    if (schedule?.state !== 'pending') {
      throw new NotFoundError('Pending workflow schedule was not found.');
    }
    const { definition } = await this.#context(instance);
    const transition = definition.transitions.find(
      (candidate) => candidate.id === schedule.transitionId,
    );
    if (!transition) throw new ConflictError('The scheduled workflow transition no longer exists.');
    this.#assertTransitionRole(input.actor, transition);
    const now = iso(this.#now());
    instance = await this.#repository.saveInstance({
      ...instance,
      schedules: instance.schedules.map((candidate) =>
        candidate.id === schedule.id
          ? { ...candidate, state: 'cancelled' as const, completedAt: now }
          : candidate,
      ),
      updatedAt: now,
    });
    return await this.#notify(
      instance,
      'schedule-cancelled',
      `${transition.label} schedule was cancelled.`,
      transition.allowedRoles,
    );
  }

  async processDue(input: {
    scope: ContentScope;
    execute: (input: DueWorkflowExecution) => Promise<void>;
  }): Promise<{ escalated: number; executed: number; failed: number }> {
    await this.reconcileActions(input.scope);
    const now = this.#now();
    let escalated = 0;
    let executed = 0;
    let failed = 0;
    for (const original of await this.#repository.listInstances(input.scope)) {
      let instance = original;
      const definition = await this.getDefinition(input.scope, instance.workflowId);
      const request = instance.pendingApproval;
      if (
        request?.dueAt &&
        !request.escalatedAt &&
        new Date(request.dueAt).getTime() <= now.getTime()
      ) {
        const transition = definition.transitions.find(
          (candidate) => candidate.id === request.transitionId,
        );
        const roles = transition?.approval?.escalateToRoles ?? [];
        const occurredAt = iso(now);
        instance = await this.#repository.saveInstance({
          ...instance,
          pendingApproval: { ...request, escalatedAt: occurredAt },
          history: [
            ...instance.history,
            {
              id: this.#createId(),
              kind: 'escalation',
              actorId: 'gridstory-workflow-worker',
              transitionId: request.transitionId,
              occurredAt,
              details: { dueAt: request.dueAt },
            },
          ],
          updatedAt: occurredAt,
        });
        instance = await this.#notify(
          instance,
          'approval-escalated',
          `Approval deadline passed for ${transition?.label ?? request.transitionId}.`,
          roles,
        );
        escalated += 1;
      }
      for (const schedule of instance.schedules.filter(
        (candidate) =>
          candidate.state === 'pending' && new Date(candidate.runAt).getTime() <= now.getTime(),
      )) {
        try {
          await input.execute({ scope: input.scope, instance, schedule });
          instance =
            (await this.#repository.getInstance(input.scope, instance.entryId)) ?? instance;
          const completedAt = iso(this.#now());
          instance = await this.#repository.saveInstance({
            ...instance,
            schedules: instance.schedules.map((candidate) =>
              candidate.id === schedule.id
                ? { ...candidate, state: 'executed' as const, completedAt }
                : candidate,
            ),
            updatedAt: completedAt,
          });
          instance = await this.#notify(
            instance,
            'schedule-completed',
            `Scheduled transition ${schedule.transitionId} completed.`,
            schedule.requestedByRoles,
          );
          executed += 1;
        } catch (error) {
          const completedAt = iso(this.#now());
          const message =
            error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
          instance = await this.#repository.saveInstance({
            ...instance,
            schedules: instance.schedules.map((candidate) =>
              candidate.id === schedule.id
                ? { ...candidate, state: 'failed' as const, completedAt, error: message }
                : candidate,
            ),
            updatedAt: completedAt,
          });
          instance = await this.#notify(
            instance,
            'schedule-failed',
            `Scheduled transition ${schedule.transitionId} failed.`,
            schedule.requestedByRoles,
          );
          failed += 1;
        }
      }
    }
    return { escalated, executed, failed };
  }

  async contentCreated(input: {
    scope: ContentScope;
    entry: ContentEntry;
    actor: Actor;
  }): Promise<void> {
    await this.ensureInstance({
      scope: input.scope,
      entryId: input.entry.id,
      contentType: input.entry.contentType,
      revisionId: input.entry.draftRevisionId,
      actorId: input.actor.id,
    });
  }

  async draftUpdated(input: {
    scope: ContentScope;
    entry: ContentEntry;
    actor: Actor;
  }): Promise<void> {
    const instance = await this.ensureInstance({
      scope: input.scope,
      entryId: input.entry.id,
      contentType: input.entry.contentType,
      revisionId: input.entry.draftRevisionId,
      actorId: input.actor.id,
    });
    const definition = await this.getDefinition(input.scope, instance.workflowId);
    const now = iso(this.#now());
    await this.#repository.saveInstance({
      ...instance,
      stateId: definition.initialStateId,
      workflowVersion: definition.version,
      revisionId: input.entry.draftRevisionId,
      pendingApproval: undefined,
      schedules: instance.schedules.map((schedule) =>
        schedule.state === 'pending'
          ? { ...schedule, state: 'cancelled' as const, completedAt: now }
          : schedule,
      ),
      history: [
        ...instance.history,
        {
          id: this.#createId(),
          kind: 'transition',
          actorId: input.actor.id,
          fromStateId: instance.stateId,
          toStateId: definition.initialStateId,
          occurredAt: now,
          details: { reason: 'draft-updated' },
        },
      ],
      updatedAt: now,
    });
  }

  async assertCanPublish(input: {
    scope: ContentScope;
    entry: ContentEntry;
    actor: Actor;
  }): Promise<void> {
    const instance = await this.getInstance({ scope: input.scope, entry: input.entry });
    const definition = await this.getDefinition(input.scope, instance.workflowId);
    if (instance.revisionId !== input.entry.draftRevisionId) {
      throw new ConflictError('The approved workflow revision does not match the current draft.');
    }
    if (instance.pendingApproval) {
      throw new GridStoryError(
        'Publication is blocked by a pending approval.',
        'workflow_approval_pending',
        409,
      );
    }
    const transition = definition.transitions.find((candidate) => {
      const target = definition.states.find((state) => state.id === candidate.to);
      return candidate.from === instance.stateId && target?.kind === 'published';
    });
    if (!transition) {
      throw new GridStoryError(
        'The content must reach an approved state before publication.',
        'workflow_publish_blocked',
        409,
        details(instance, definition),
      );
    }
    this.#assertTransitionRole(input.actor, transition);
  }

  async contentPublished(input: {
    scope: ContentScope;
    entry: ContentEntry;
    actor: Actor;
  }): Promise<void> {
    const instance = await this.getInstance({ scope: input.scope, entry: input.entry });
    const definition = await this.getDefinition(input.scope, instance.workflowId);
    const transition = definition.transitions.find((candidate) => {
      const target = definition.states.find((state) => state.id === candidate.to);
      return candidate.from === instance.stateId && target?.kind === 'published';
    });
    if (!transition)
      throw new ConflictError('Published content has no matching workflow transition.');
    await this.#completeTransition({ instance, definition, transition, actor: input.actor });
  }
}
