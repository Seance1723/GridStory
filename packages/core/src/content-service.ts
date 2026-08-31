import {
  assertValidContent,
  buildContentRoute,
  type ComponentManifest,
  type ContentSchemaDefinition,
  collectContentReferences,
  type ReleaseMember,
  type ReleasePreviewEntry,
  type ReleaseValidationIssue,
  SchemaValidationError,
} from '@gridstory/schema';
import {
  ConflictError,
  ContentValidationError,
  GridStoryError,
  NotFoundError,
  PublishQualityGateError,
} from './errors.js';
import type {
  Actor,
  ContentEntry,
  ContentPerspective,
  ContentRevision,
  ContentLifecycleReadView,
  ContentScope,
  ContentServiceOptions,
} from './types.js';

export class ContentService {
  readonly #repository: ContentServiceOptions['repository'];
  readonly #schemas: ReadonlyMap<string, ContentSchemaDefinition>;
  readonly #componentManifests: ComponentManifest[];
  readonly #qualityGate?: ContentServiceOptions['qualityGate'];
  readonly #workflowGate?: ContentServiceOptions['workflowGate'];
  readonly #governanceGate?: ContentServiceOptions['governanceGate'];
  readonly #lifecycleValidators: ReadonlyMap<
    string,
    NonNullable<ContentServiceOptions['lifecycleValidators']>[number]
  >;

  constructor({
    repository,
    schemas,
    componentManifests,
    qualityGate,
    workflowGate,
    governanceGate,
    lifecycleValidators = [],
  }: ContentServiceOptions) {
    this.#repository = repository;
    this.#schemas = new Map(schemas.map((schema) => [schema.id, schema]));
    this.#componentManifests = componentManifests;
    this.#qualityGate = qualityGate;
    this.#workflowGate = workflowGate;
    this.#governanceGate = governanceGate;
    this.#lifecycleValidators = new Map(
      lifecycleValidators.map((validator) => [validator.contentType, validator]),
    );
    if (this.#lifecycleValidators.size !== lifecycleValidators.length) {
      throw new Error('Content lifecycle validators must have unique content types.');
    }
  }

  getSchemas(): ContentSchemaDefinition[] {
    return [...this.#schemas.values()];
  }

  getComponentManifests(): ComponentManifest[] {
    return [...this.#componentManifests];
  }

  #schema(contentType: string): ContentSchemaDefinition {
    const schema = this.#schemas.get(contentType);
    if (!schema) throw new NotFoundError(`Content type ${contentType} is not registered.`);
    return schema;
  }

  #validate(contentType: string, data: unknown): asserts data is Record<string, unknown> {
    try {
      assertValidContent(this.#schema(contentType), data, this.#componentManifests);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        throw new ContentValidationError(error.issues);
      }
      throw error;
    }
  }

  async #validateReferences(
    scope: ContentScope,
    contentType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const issues = [];
    for (const located of collectContentReferences(this.#schema(contentType), data)) {
      const target = await this.#repository.getById({
        scope,
        id: located.reference.id,
        perspective: 'draft',
      });
      if (!target || target.contentType !== located.reference.contentType) {
        issues.push({
          code: 'invalid_reference' as const,
          path: located.path,
          message: `Referenced ${located.reference.contentType} content ${located.reference.id} was not found in the active scope.`,
        });
      }
    }
    if (issues.length > 0) throw new ContentValidationError(issues);
  }

  #repositoryView(
    scope: ContentScope,
    perspective: ContentPerspective,
    overrides: ContentEntry[] = [],
  ): ContentLifecycleReadView {
    const byId = new Map(overrides.map((entry) => [entry.id, entry]));
    return {
      getById: async (id) =>
        byId.get(id) ?? (await this.#repository.getById({ scope, id, perspective })),
      list: async (contentType) => {
        const entries = await this.#repository.list({
          scope,
          perspective,
          ...(contentType ? { contentType } : {}),
        });
        const merged = new Map(entries.map((entry) => [entry.id, entry]));
        for (const entry of overrides) {
          if (!contentType || entry.contentType === contentType) merged.set(entry.id, entry);
        }
        return [...merged.values()];
      },
    };
  }

  #fixedView(entries: ReadonlyMap<string, ContentEntry>): ContentLifecycleReadView {
    return {
      getById: (id) => entries.get(id) ?? null,
      list: (contentType) =>
        [...entries.values()].filter((entry) => !contentType || entry.contentType === contentType),
    };
  }

  async #validateLifecycle(input: {
    scope: ContentScope;
    perspective: ContentPerspective;
    contentType: string;
    data: Record<string, unknown>;
    view: ContentLifecycleReadView;
    entryId?: string;
    previousData?: Record<string, unknown>;
    translationGroupId?: string;
  }): Promise<void> {
    const validator = this.#lifecycleValidators.get(input.contentType);
    if (!validator) return;
    const issues = await validator.validate(input);
    if (issues.length > 0) throw new ContentValidationError(issues);
  }

  async #validatePublishedRoute(scope: ContentScope, entry: ContentEntry): Promise<void> {
    const schema = this.#schema(entry.contentType);
    if (!schema.route) return;
    const route = buildContentRoute(schema, entry.data);
    for (const candidateSchema of this.#schemas.values()) {
      if (!candidateSchema.route) continue;
      const published = await this.#repository.list({
        scope,
        contentType: candidateSchema.id,
        perspective: 'published',
      });
      const collision = published.find(
        (candidate) =>
          candidate.id !== entry.id && buildContentRoute(candidateSchema, candidate.data) === route,
      );
      if (collision) {
        throw new ConflictError(`Canonical route ${route} is already published.`, {
          route,
          entryId: collision.id,
        });
      }
    }
  }

  async list(input: {
    scope: ContentScope;
    contentType?: string;
    perspective?: ContentPerspective;
  }): Promise<ContentEntry[]> {
    return await this.#repository.list({
      scope: input.scope,
      perspective: input.perspective ?? 'draft',
      ...(input.contentType ? { contentType: input.contentType } : {}),
    });
  }

  async get(input: {
    scope: ContentScope;
    id: string;
    perspective?: ContentPerspective;
  }): Promise<ContentEntry> {
    const entry = await this.#repository.getById({
      scope: input.scope,
      id: input.id,
      perspective: input.perspective ?? 'draft',
    });
    if (!entry) throw new NotFoundError('Content entry was not found.');
    return entry;
  }

  async getBySlug(input: {
    scope: ContentScope;
    contentType: string;
    slug: string;
    perspective?: ContentPerspective;
  }): Promise<ContentEntry> {
    this.#schema(input.contentType);
    const entry = await this.#repository.getBySlug({
      scope: input.scope,
      contentType: input.contentType,
      slug: input.slug,
      perspective: input.perspective ?? 'published',
    });
    if (!entry) throw new NotFoundError('Published content was not found.');
    return entry;
  }

  async create(input: {
    scope: ContentScope;
    id?: string;
    contentType: string;
    data: unknown;
    actor: Actor;
    translationGroupId?: string;
  }): Promise<ContentEntry> {
    await this.#governanceGate?.assertWrite(input.scope, 'content');
    this.#validate(input.contentType, input.data);
    await this.#validateLifecycle({
      scope: input.scope,
      perspective: 'draft',
      contentType: input.contentType,
      data: input.data,
      view: this.#repositoryView(input.scope, 'draft'),
      ...(input.id ? { entryId: input.id } : {}),
      ...(input.translationGroupId ? { translationGroupId: input.translationGroupId } : {}),
    });
    await this.#validateReferences(input.scope, input.contentType, input.data);
    const entry = await this.#repository.create({
      scope: input.scope,
      ...(input.id ? { id: input.id } : {}),
      contentType: input.contentType,
      data: input.data,
      actor: input.actor,
      ...(input.translationGroupId ? { translationGroupId: input.translationGroupId } : {}),
    });
    await this.#workflowGate?.contentCreated({ scope: input.scope, entry, actor: input.actor });
    return entry;
  }

  async validateCandidate(input: {
    scope: ContentScope;
    contentType: string;
    data: unknown;
  }): Promise<void> {
    this.#validate(input.contentType, input.data);
    await this.#validateLifecycle({
      scope: input.scope,
      perspective: 'draft',
      contentType: input.contentType,
      data: input.data,
      view: this.#repositoryView(input.scope, 'draft'),
    });
    await this.#validateReferences(input.scope, input.contentType, input.data);
  }

  async updateDraft(input: {
    scope: ContentScope;
    id: string;
    expectedRevisionId: string;
    data: unknown;
    actor: Actor;
  }): Promise<ContentEntry> {
    await this.#governanceGate?.assertWrite(input.scope, 'content', input.id);
    const current = await this.get({ scope: input.scope, id: input.id, perspective: 'draft' });
    this.#validate(current.contentType, input.data);
    await this.#validateLifecycle({
      scope: input.scope,
      perspective: 'draft',
      contentType: current.contentType,
      data: input.data,
      view: this.#repositoryView(input.scope, 'draft'),
      entryId: current.id,
      previousData: current.data,
    });
    await this.#validateReferences(input.scope, current.contentType, input.data);
    const entry = await this.#repository.updateDraft({
      scope: input.scope,
      id: input.id,
      expectedRevisionId: input.expectedRevisionId,
      data: input.data,
      actor: input.actor,
    });
    await this.#workflowGate?.draftUpdated({ scope: input.scope, entry, actor: input.actor });
    return entry;
  }

  async publish(input: {
    scope: ContentScope;
    id: string;
    expectedRevisionId: string;
    actor: Actor;
    channel?: string;
  }): Promise<ContentEntry> {
    await this.#governanceGate?.assertWrite(input.scope, 'content', input.id);
    const current = await this.get({ scope: input.scope, id: input.id, perspective: 'draft' });
    this.#validate(current.contentType, current.data);
    const previousPublication = await this.#repository.getById({
      scope: input.scope,
      id: current.id,
      perspective: 'published',
    });
    await this.#validateLifecycle({
      scope: input.scope,
      perspective: 'published',
      contentType: current.contentType,
      data: current.data,
      view: this.#repositoryView(input.scope, 'published', [current]),
      entryId: current.id,
      ...(previousPublication ? { previousData: previousPublication.data } : {}),
    });
    await this.#workflowGate?.assertCanPublish({
      scope: input.scope,
      entry: current,
      actor: input.actor,
    });
    if (this.#qualityGate) {
      const report = await this.#qualityGate.assess({
        scope: input.scope,
        entry: current,
        channel: input.channel ?? 'web',
        roles: input.actor.roles ?? [],
      });
      if (!report.passed) throw new PublishQualityGateError(report);
    }
    await this.#validatePublishedRoute(input.scope, current);
    const published = await this.#repository.publish(input);
    await this.#workflowGate?.contentPublished({
      scope: input.scope,
      entry: published,
      actor: input.actor,
    });
    return published;
  }

  async getRevision(input: {
    scope: ContentScope;
    id: string;
    revisionId: string;
  }): Promise<ContentRevision> {
    const revision = await this.#repository.getRevision(input);
    if (!revision) throw new NotFoundError('Content revision was not found.');
    return revision;
  }

  async assessRelease(input: {
    scope: ContentScope;
    entries: ReleaseMember[];
    actor: Actor;
    channel?: string;
  }): Promise<ReleaseValidationIssue[]> {
    const issues: ReleaseValidationIssue[] = [];
    const candidates: ContentEntry[] = [];
    for (const member of input.entries) {
      const current = await this.#repository.getById({
        scope: input.scope,
        id: member.entryId,
        perspective: 'draft',
      });
      const revision = await this.#repository.getRevision({
        scope: input.scope,
        id: member.entryId,
        revisionId: member.revisionId,
      });
      if (!current || !revision) {
        issues.push({
          code: 'entry-not-found',
          severity: 'error',
          entryId: member.entryId,
          message: 'The pinned release entry or revision was not found in the active scope.',
        });
        continue;
      }
      const candidate: ContentEntry = {
        ...current,
        draftRevisionId: revision.id,
        data: revision.data,
      };
      candidates.push(candidate);
      if (current.draftRevisionId !== revision.id) {
        issues.push({
          code: 'stale-revision',
          severity: 'error',
          entryId: member.entryId,
          message: 'The draft changed after this revision was added to the release.',
          details: {
            pinnedRevisionId: revision.id,
            currentDraftRevisionId: current.draftRevisionId,
          },
        });
        continue;
      }
      try {
        this.#validate(candidate.contentType, candidate.data);
      } catch (error) {
        if (error instanceof ContentValidationError) {
          for (const issue of error.issues) {
            issues.push({
              code: 'content-invalid',
              severity: 'error',
              entryId: member.entryId,
              message: issue.message,
              path: issue.path,
            });
          }
          continue;
        }
        throw error;
      }
      try {
        await this.#workflowGate?.assertCanPublish({
          scope: input.scope,
          entry: candidate,
          actor: input.actor,
        });
      } catch (error) {
        const known = error instanceof GridStoryError;
        issues.push({
          code: 'workflow-blocked',
          severity: 'error',
          entryId: member.entryId,
          message: known ? error.message : 'The workflow gate rejected this release entry.',
          ...(known ? { details: { code: error.code } } : {}),
        });
      }
      if (this.#qualityGate) {
        const report = await this.#qualityGate.assess({
          scope: input.scope,
          entry: candidate,
          channel: input.channel ?? 'web',
          roles: input.actor.roles ?? [],
        });
        if (!report.passed) {
          issues.push({
            code: 'quality-blocked',
            severity: 'error',
            entryId: member.entryId,
            message: `Content quality score ${report.score} did not pass the publication policy.`,
            details: { score: report.score, findingCount: report.findings.length },
          });
        }
      }
    }

    const publishedEntries = await this.#repository.list({
      scope: input.scope,
      perspective: 'published',
    });
    const futureEntries = new Map<string, ContentEntry>();
    for (const published of publishedEntries) {
      futureEntries.set(published.id, published);
    }
    candidates.forEach((candidate) => {
      futureEntries.set(candidate.id, candidate);
    });

    const routes = new Map<string, ContentEntry[]>();
    for (const entry of futureEntries.values()) {
      const schema = this.#schema(entry.contentType);
      if (!schema.route) continue;
      const route = buildContentRoute(schema, entry.data);
      routes.set(route, [...(routes.get(route) ?? []), entry]);
    }
    for (const [route, entries] of routes) {
      if (entries.length < 2) continue;
      for (const entry of entries.filter((candidate) =>
        input.entries.some((member) => member.entryId === candidate.id),
      )) {
        issues.push({
          code: 'route-collision',
          severity: 'error',
          entryId: entry.id,
          message: `Future canonical route ${route} belongs to more than one entry.`,
          details: { route, entryIds: entries.map((candidate) => candidate.id) },
        });
      }
    }

    for (const entry of candidates) {
      try {
        const previousPublication = publishedEntries.find((candidate) => candidate.id === entry.id);
        await this.#validateLifecycle({
          scope: input.scope,
          perspective: 'published',
          contentType: entry.contentType,
          data: entry.data,
          view: this.#fixedView(futureEntries),
          entryId: entry.id,
          ...(previousPublication ? { previousData: previousPublication.data } : {}),
        });
      } catch (error) {
        if (error instanceof ContentValidationError) {
          for (const issue of error.issues) {
            issues.push({
              code: 'content-invalid',
              severity: 'error',
              entryId: entry.id,
              message: issue.message,
              path: issue.path,
            });
          }
          continue;
        }
        throw error;
      }
      for (const located of collectContentReferences(this.#schema(entry.contentType), entry.data)) {
        const target = futureEntries.get(located.reference.id);
        if (!target || target.contentType !== located.reference.contentType) {
          issues.push({
            code: 'reference-unpublished',
            severity: 'error',
            entryId: entry.id,
            path: located.path,
            message: `Referenced ${located.reference.contentType} content ${located.reference.id} is absent from the future published state.`,
          });
        }
      }
    }
    return issues;
  }

  async previewRelease(input: {
    scope: ContentScope;
    entries: ReleaseMember[];
  }): Promise<ReleasePreviewEntry[]> {
    const preview: ReleasePreviewEntry[] = [];
    for (const member of input.entries) {
      const current = await this.get({
        scope: input.scope,
        id: member.entryId,
        perspective: 'draft',
      });
      const revision = await this.getRevision({
        scope: input.scope,
        id: member.entryId,
        revisionId: member.revisionId,
      });
      const schema = this.#schema(current.contentType);
      preview.push({
        ...member,
        data: revision.data,
        ...(schema.route ? { route: buildContentRoute(schema, revision.data) } : {}),
      });
    }
    return preview;
  }

  async publishRelease(input: {
    scope: ContentScope;
    entries: ReleaseMember[];
    actor: Actor;
    channel?: string;
  }): Promise<ContentEntry[]> {
    for (const member of input.entries) {
      await this.#governanceGate?.assertWrite(input.scope, 'content', member.entryId);
    }
    const issues = await this.assessRelease(input);
    if (issues.some((issue) => issue.severity === 'error')) {
      throw new GridStoryError(
        'Release validation failed before atomic publication.',
        'release_validation_failed',
        409,
        { issues },
      );
    }
    const published = await this.#repository.publishMany({
      scope: input.scope,
      entries: input.entries.map((entry) => ({
        entryId: entry.entryId,
        targetRevisionId: entry.revisionId,
        expectedDraftRevisionId: entry.revisionId,
        expectedPublishedRevisionId: entry.previousPublishedRevisionId,
      })),
      actor: input.actor,
    });
    for (const entry of published) {
      await this.#workflowGate?.contentPublished({ scope: input.scope, entry, actor: input.actor });
    }
    return published;
  }

  async rollbackRelease(input: {
    scope: ContentScope;
    entries: ReleaseMember[];
    actor: Actor;
  }): Promise<ContentEntry[]> {
    for (const member of input.entries) {
      await this.#governanceGate?.assertWrite(input.scope, 'content', member.entryId);
    }
    if (input.entries.some((entry) => entry.previousPublishedRevisionId === null)) {
      throw new GridStoryError(
        'A release containing a first publication cannot be rolled back atomically.',
        'release_rollback_unavailable',
        409,
      );
    }
    return await this.#repository.publishMany({
      scope: input.scope,
      entries: input.entries.map((entry) => ({
        entryId: entry.entryId,
        targetRevisionId: entry.previousPublishedRevisionId ?? '',
        expectedPublishedRevisionId: entry.revisionId,
      })),
      actor: input.actor,
    });
  }
  async listRevisions(input: { scope: ContentScope; id: string }): Promise<ContentRevision[]> {
    await this.get({ scope: input.scope, id: input.id, perspective: 'draft' });
    return await this.#repository.listRevisions(input);
  }
}
