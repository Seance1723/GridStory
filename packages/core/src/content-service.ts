import {
  SchemaValidationError,
  assertValidContent,
  buildContentRoute,
  collectContentReferences,
  type ComponentManifest,
  type ContentSchemaDefinition,
} from '@gridstory/schema';
import {
  ConflictError,
  ContentValidationError,
  NotFoundError,
  PublishQualityGateError,
} from './errors.js';
import type {
  Actor,
  ContentEntry,
  ContentPerspective,
  ContentRevision,
  ContentScope,
  ContentServiceOptions,
} from './types.js';

export class ContentService {
  readonly #repository: ContentServiceOptions['repository'];
  readonly #schemas: ReadonlyMap<string, ContentSchemaDefinition>;
  readonly #componentManifests: ComponentManifest[];
  readonly #qualityGate?: ContentServiceOptions['qualityGate'];
  readonly #workflowGate?: ContentServiceOptions['workflowGate'];

  constructor({
    repository,
    schemas,
    componentManifests,
    qualityGate,
    workflowGate,
  }: ContentServiceOptions) {
    this.#repository = repository;
    this.#schemas = new Map(schemas.map((schema) => [schema.id, schema]));
    this.#componentManifests = componentManifests;
    this.#qualityGate = qualityGate;
    this.#workflowGate = workflowGate;
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
    contentType: string;
    data: unknown;
    actor: Actor;
    translationGroupId?: string;
  }): Promise<ContentEntry> {
    this.#validate(input.contentType, input.data);
    await this.#validateReferences(input.scope, input.contentType, input.data);
    const entry = await this.#repository.create({
      scope: input.scope,
      contentType: input.contentType,
      data: input.data,
      actor: input.actor,
      ...(input.translationGroupId ? { translationGroupId: input.translationGroupId } : {}),
    });
    await this.#workflowGate?.contentCreated({ scope: input.scope, entry, actor: input.actor });
    return entry;
  }

  async updateDraft(input: {
    scope: ContentScope;
    id: string;
    expectedRevisionId: string;
    data: unknown;
    actor: Actor;
  }): Promise<ContentEntry> {
    const current = await this.get({ scope: input.scope, id: input.id, perspective: 'draft' });
    this.#validate(current.contentType, input.data);
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
    const current = await this.get({ scope: input.scope, id: input.id, perspective: 'draft' });
    this.#validate(current.contentType, current.data);
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

  async listRevisions(input: { scope: ContentScope; id: string }): Promise<ContentRevision[]> {
    await this.get({ scope: input.scope, id: input.id, perspective: 'draft' });
    return await this.#repository.listRevisions(input);
  }
}
