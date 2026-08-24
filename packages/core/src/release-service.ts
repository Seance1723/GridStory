import { randomUUID } from 'node:crypto';
import {
  releaseInputSchema,
  releasePreviewSchema,
  releaseSchema,
  type ContentScope,
  type Release,
  type ReleaseInput,
  type ReleasePreview,
} from '@gridstory/schema';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import type { ReleaseRepository } from './release-repository.js';
import type { Actor } from './types.js';
import type { ContentService } from './content-service.js';

export interface ReleaseServiceOptions {
  repository: ReleaseRepository;
  contentService: ContentService;
  analyticsAnnotator?: (input: {
    scope: ContentScope;
    name: 'release.published' | 'release.rolled_back';
    releaseId: string;
    releaseName: string;
    entryCount: number;
    occurredAt: string;
  }) => Promise<unknown>;
  now?: () => Date;
  createId?: () => string;
}

function iso(date: Date): string {
  return date.toISOString();
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

export class ReleaseService {
  readonly #repository: ReleaseRepository;
  readonly #content: ContentService;
  readonly #analyticsAnnotator: NonNullable<ReleaseServiceOptions['analyticsAnnotator']>;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor({
    repository,
    contentService,
    analyticsAnnotator = async () => undefined,
    now = () => new Date(),
    createId = randomUUID,
  }: ReleaseServiceOptions) {
    this.#repository = repository;
    this.#content = contentService;
    this.#analyticsAnnotator = analyticsAnnotator;
    this.#now = now;
    this.#createId = createId;
  }

  async list(scope: ContentScope): Promise<Release[]> {
    return await this.#repository.list(scope);
  }

  async get(scope: ContentScope, id: string): Promise<Release> {
    const release = await this.#repository.get(scope, id);
    if (!release) throw new NotFoundError('Release was not found.');
    return release;
  }

  async create(input: {
    scope: ContentScope;
    release: ReleaseInput;
    actor: Actor;
  }): Promise<Release> {
    const candidate = releaseInputSchema.parse(input.release);
    const entries = [];
    for (const member of candidate.entries) {
      const entry = await this.#content.get({
        scope: input.scope,
        id: member.entryId,
        perspective: 'draft',
      });
      if (entry.draftRevisionId !== member.revisionId) {
        throw new ConflictError('A release must pin the current immutable draft revision.', {
          entryId: entry.id,
          requestedRevisionId: member.revisionId,
          currentDraftRevisionId: entry.draftRevisionId,
        });
      }
      await this.#content.getRevision({
        scope: input.scope,
        id: member.entryId,
        revisionId: member.revisionId,
      });
      entries.push({
        ...member,
        contentType: entry.contentType,
        previousPublishedRevisionId: entry.publishedRevisionId ?? null,
      });
    }
    const now = iso(this.#now());
    return await this.#repository.save(
      releaseSchema.parse({
        ...input.scope,
        id: this.#createId(),
        name: candidate.name,
        state: 'draft',
        entries,
        rollbackPolicy: candidate.rollbackPolicy,
        createdBy: input.actor.id,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  async validate(input: {
    scope: ContentScope;
    id: string;
    actor: Actor;
    channel?: string;
  }): Promise<Release> {
    const release = await this.get(input.scope, input.id);
    if (
      release.state === 'executing' ||
      release.state === 'published' ||
      release.state === 'rolled-back'
    ) {
      throw new ConflictError('This release can no longer be revalidated in its current state.', {
        state: release.state,
      });
    }
    const issues = await this.#content.assessRelease({
      scope: input.scope,
      entries: release.entries,
      actor: input.actor,
      ...(input.channel ? { channel: input.channel } : {}),
    });
    if (
      release.rollbackPolicy.mode !== 'disabled' &&
      release.entries.some((entry) => entry.previousPublishedRevisionId === null)
    ) {
      issues.push({
        code: 'rollback-unavailable',
        severity: 'warning',
        message:
          'Atomic rollback is unavailable because at least one member has no earlier published revision.',
      });
    }
    const checkedAt = iso(this.#now());
    const valid = !issues.some((issue) => issue.severity === 'error');
    let schedule = release.schedule;
    if (!valid && schedule?.state === 'pending') {
      schedule = {
        ...schedule,
        state: 'failed',
        completedAt: checkedAt,
        error: 'Release validation failed after scheduling.',
      };
    }
    return await this.#repository.save({
      ...release,
      state: valid && schedule?.state === 'pending' ? 'scheduled' : valid ? 'validated' : 'draft',
      validation: { valid, checkedAt, issues },
      ...(schedule ? { schedule } : {}),
      error: undefined,
      updatedAt: checkedAt,
    });
  }

  async preview(scope: ContentScope, id: string): Promise<ReleasePreview> {
    const release = await this.get(scope, id);
    return releasePreviewSchema.parse({
      releaseId: release.id,
      generatedAt: iso(this.#now()),
      ...(release.validation ? { validation: release.validation } : {}),
      entries: await this.#content.previewRelease({ scope, entries: release.entries }),
    });
  }

  async schedule(input: {
    scope: ContentScope;
    id: string;
    runAt: string;
    timeZone: string;
    actor: Actor;
  }): Promise<Release> {
    const validated = await this.validate({
      scope: input.scope,
      id: input.id,
      actor: input.actor,
    });
    if (!validated.validation?.valid) {
      throw new GridStoryError(
        'Release validation failed before scheduling.',
        'release_validation_failed',
        409,
        { issues: validated.validation?.issues ?? [] },
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
    return await this.#repository.save({
      ...validated,
      state: 'scheduled',
      schedule: {
        runAt: iso(runAt),
        timeZone: input.timeZone,
        requestedBy: input.actor.id,
        requestedByRoles: input.actor.roles ?? [],
        state: 'pending',
        createdAt: now,
      },
      updatedAt: now,
    });
  }

  async cancelSchedule(input: { scope: ContentScope; id: string; actor: Actor }): Promise<Release> {
    const release = await this.get(input.scope, input.id);
    if (release.state !== 'scheduled' || release.schedule?.state !== 'pending') {
      throw new NotFoundError('Pending release schedule was not found.');
    }
    const now = iso(this.#now());
    return await this.#repository.save({
      ...release,
      state: 'validated',
      schedule: {
        ...release.schedule,
        state: 'cancelled',
        completedAt: now,
      },
      updatedAt: now,
    });
  }

  async execute(input: {
    scope: ContentScope;
    id: string;
    actor: Actor;
    channel?: string;
  }): Promise<Release> {
    const validated = await this.validate({
      scope: input.scope,
      id: input.id,
      actor: input.actor,
      ...(input.channel ? { channel: input.channel } : {}),
    });
    if (!validated.validation?.valid) {
      throw new GridStoryError(
        'Release validation failed before publication.',
        'release_validation_failed',
        409,
        { issues: validated.validation?.issues ?? [] },
      );
    }
    const startedAt = iso(this.#now());
    const executing = await this.#repository.save({
      ...validated,
      state: 'executing',
      error: undefined,
      updatedAt: startedAt,
    });
    try {
      await this.#content.publishRelease({
        scope: input.scope,
        entries: executing.entries,
        actor: input.actor,
        ...(input.channel ? { channel: input.channel } : {}),
      });
      const executedAt = iso(this.#now());
      const published = await this.#repository.save({
        ...executing,
        state: 'published',
        executedAt,
        executedBy: input.actor.id,
        ...(executing.schedule?.state === 'pending'
          ? {
              schedule: {
                ...executing.schedule,
                state: 'executed' as const,
                completedAt: executedAt,
              },
            }
          : {}),
        updatedAt: executedAt,
      });
      await this.#annotate(published, 'release.published', executedAt);
      return published;
    } catch (error) {
      const failedAt = iso(this.#now());
      await this.#repository.save({
        ...executing,
        state: 'failed',
        error: messageOf(error),
        ...(executing.schedule?.state === 'pending'
          ? {
              schedule: {
                ...executing.schedule,
                state: 'failed' as const,
                completedAt: failedAt,
                error: messageOf(error),
              },
            }
          : {}),
        updatedAt: failedAt,
      });
      throw error;
    }
  }

  async rollback(input: {
    scope: ContentScope;
    id: string;
    reason: string;
    actor: Actor;
  }): Promise<Release> {
    const release = await this.get(input.scope, input.id);
    if (release.state !== 'published' || !release.executedAt) {
      throw new ConflictError('Only a published release can be rolled back.', {
        state: release.state,
      });
    }
    if (release.rollbackPolicy.mode === 'disabled') {
      throw new GridStoryError(
        'Rollback is disabled by this release policy.',
        'release_rollback_disabled',
        409,
      );
    }
    const reason = input.reason.trim();
    if (!reason) throw new GridStoryError('A rollback reason is required.', 'invalid_request', 400);
    if (reason.length > 2000) {
      throw new GridStoryError(
        'Rollback reason must be 2000 characters or fewer.',
        'invalid_request',
        400,
      );
    }
    if (release.rollbackPolicy.mode === 'time-window') {
      const deadline =
        new Date(release.executedAt).getTime() +
        (release.rollbackPolicy.windowHours ?? 0) * 3_600_000;
      if (this.#now().getTime() > deadline) {
        throw new GridStoryError(
          'The configured rollback window has expired.',
          'release_rollback_window_expired',
          409,
          { deadline: new Date(deadline).toISOString() },
        );
      }
    }
    await this.#content.rollbackRelease({
      scope: input.scope,
      entries: release.entries,
      actor: input.actor,
    });
    const rolledBackAt = iso(this.#now());
    const rolledBack = await this.#repository.save({
      ...release,
      state: 'rolled-back',
      rolledBackAt,
      rolledBackBy: input.actor.id,
      rollbackReason: reason,
      updatedAt: rolledBackAt,
    });
    await this.#annotate(rolledBack, 'release.rolled_back', rolledBackAt);
    return rolledBack;
  }

  async #annotate(
    release: Release,
    name: 'release.published' | 'release.rolled_back',
    occurredAt: string,
  ): Promise<void> {
    try {
      await this.#analyticsAnnotator({
        scope: release,
        name,
        releaseId: release.id,
        releaseName: release.name,
        entryCount: release.entries.length,
        occurredAt,
      });
    } catch {
      // Release state is authoritative; analytics enqueue health is operational evidence only.
    }
  }

  async processDue(scope: ContentScope): Promise<{ executed: number; failed: number }> {
    let executed = 0;
    let failed = 0;
    const now = this.#now().getTime();
    for (const release of await this.#repository.list(scope)) {
      const schedule = release.schedule;
      if (
        release.state !== 'scheduled' ||
        schedule?.state !== 'pending' ||
        new Date(schedule.runAt).getTime() > now
      ) {
        continue;
      }
      try {
        await this.execute({
          scope,
          id: release.id,
          actor: { id: schedule.requestedBy, roles: schedule.requestedByRoles },
        });
        executed += 1;
      } catch {
        failed += 1;
      }
    }
    return { executed, failed };
  }
}
