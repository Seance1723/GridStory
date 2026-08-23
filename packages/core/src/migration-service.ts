import { createHash, randomUUID } from 'node:crypto';
import {
  type ContentScope,
  type MigrationBlocker,
  type MigrationCutoverReport,
  type MigrationFieldMapping,
  type MigrationPlan,
  type MigrationPlanCounts,
  type MigrationPlanEffect,
  type MigrationPlanSummary,
  type MigrationProject,
  type MigrationProjectInput,
  type MigrationProjectSummary,
  type MigrationRecipe,
  type MigrationRecipeInput,
  type MigrationRun,
  type MigrationSourceDescriptor,
  type MigrationSourceSnapshot,
  migrationProjectInputSchema,
  migrationRecipeInputSchema,
  migrationSourceSnapshotSchema,
  resourceLimits,
} from '@gridstory/schema';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import {
  emptyMigrationDocument,
  type MigrationDocument,
  type MigrationRepository,
} from './migration-repository.js';
import { logicalChecksum } from './portability-service.js';
import type { ContentService } from './content-service.js';
import type { Actor, Awaitable, ContentEntry, ContentRepository } from './types.js';

export interface MigrationSourceReadInput {
  mode: 'full' | 'delta';
  checkpoint?: string;
  maximumRecords: number;
}

export interface MigrationSourceAdapter {
  readonly descriptor: MigrationSourceDescriptor;
  read(input: MigrationSourceReadInput): Awaitable<MigrationSourceSnapshot>;
}

export interface MigrationOverview {
  sources: MigrationSourceDescriptor[];
  recipes: MigrationRecipe[];
  projects: MigrationProjectSummary[];
  plans: MigrationPlanSummary[];
  runs: MigrationRun[];
  cutoverReports: MigrationCutoverReport[];
}

export interface MigrationServiceOptions {
  repository: MigrationRepository;
  contentRepository: ContentRepository;
  contentService: ContentService;
  sources?: MigrationSourceAdapter[];
  now?: () => string;
  createId?: () => string;
}

class MappingFailure extends Error {
  readonly blocker: MigrationBlocker;

  constructor(blocker: MigrationBlocker) {
    super(blocker.message);
    this.name = 'MappingFailure';
    this.blocker = blocker;
  }
}

function projectSummary(project: MigrationProject): MigrationProjectSummary {
  const { checkpoint: _checkpoint, lastFullSourceIds: _sourceIds, ...summary } = project;
  return summary;
}

function planSummary(plan: MigrationPlan): MigrationPlanSummary {
  const { nextCheckpoint: _checkpoint, fullSourceIds: _sourceIds, effects, ...summary } = plan;
  return {
    ...summary,
    effects: effects.map(({ mappedData: _mappedData, ...effect }) => effect),
  };
}

function emptyCounts(): MigrationPlanCounts {
  return { create: 0, update: 0, publish: 0, noop: 0, sourceDeleted: 0, blocked: 0 };
}

function countEffects(effects: MigrationPlanEffect[]): MigrationPlanCounts {
  const counts = emptyCounts();
  for (const effect of effects) {
    if (effect.action === 'create') counts.create += 1;
    if (effect.action === 'update') counts.update += 1;
    if (effect.action === 'noop') counts.noop += 1;
    if (effect.action === 'source-deleted') counts.sourceDeleted += 1;
    if (effect.action === 'blocked') counts.blocked += 1;
    if (effect.publish) counts.publish += 1;
  }
  return counts;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function targetId(scope: ContentScope, projectId: string, externalId: string): string {
  const value = sha256(
    `${scope.organizationId}\u0000${scope.tenantId}\u0000${scope.workspaceId}\u0000${scope.siteId}\u0000${scope.environmentId}\u0000${scope.locale}\u0000${projectId}\u0000${externalId}`,
  ).slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}

function sourceValue(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function transformedValue(value: unknown, field: MigrationFieldMapping): unknown {
  if (field.transform === 'copy') return structuredClone(value);
  if (field.transform === 'string') {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }
  if (field.transform === 'number') {
    const result =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(result)) return result;
  }
  if (field.transform === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1) return true;
    if (value === 'false' || value === 0) return false;
  }
  if (field.transform === 'slug' && typeof value === 'string') {
    const slug = value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 200);
    if (slug.length > 0) return slug;
  }
  throw new MappingFailure({
    code: 'invalid-transform',
    message: `Source field ${field.sourcePath} cannot use ${field.transform}.`,
  });
}

function mapRecord(
  record: MigrationSourceSnapshot['records'][number],
  recipe: MigrationRecipe,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const field of recipe.fields) {
    const value = sourceValue(record.data, field.sourcePath);
    if (value === undefined || value === null) {
      if (field.required) {
        throw new MappingFailure({
          code: 'missing-required-field',
          externalId: record.externalId,
          message: `Required source field ${field.sourcePath} is missing.`,
        });
      }
      continue;
    }
    mapped[field.targetField] = transformedValue(value, field);
  }
  return mapped;
}

function recipeFor(
  recipes: MigrationRecipe[],
  record: MigrationSourceSnapshot['records'][number],
): MigrationRecipe | undefined {
  return recipes.find(
    (recipe) =>
      recipe.sourceType === record.sourceType &&
      (recipe.sourceLocale === undefined || recipe.sourceLocale === record.locale),
  );
}

function isMediaType(sourceType: string): boolean {
  return /(?:asset|attachment|media)/iu.test(sourceType);
}

function migrationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown migration failure.';
}

function sameRecipeVersions(project: MigrationProject, recipes: MigrationRecipe[]): boolean {
  return recipes.every((recipe) => project.recipeVersions[recipe.id] === recipe.version);
}

function ensureUniqueRecords(snapshot: MigrationSourceSnapshot): void {
  const seen = new Set<string>();
  for (const record of snapshot.records) {
    if (seen.has(record.externalId)) {
      throw new GridStoryError(
        `Migration source returned duplicate ID ${record.externalId}.`,
        'invalid_migration_source',
        400,
      );
    }
    seen.add(record.externalId);
  }
}

export class MigrationService {
  readonly #repository: MigrationRepository;
  readonly #contentRepository: ContentRepository;
  readonly #contentService: ContentService;
  readonly #sources: ReadonlyMap<string, MigrationSourceAdapter>;
  readonly #now: () => string;
  readonly #createId: () => string;

  constructor({
    repository,
    contentRepository,
    contentService,
    sources = [],
    now = () => new Date().toISOString(),
    createId = randomUUID,
  }: MigrationServiceOptions) {
    const sourceMap = new Map<string, MigrationSourceAdapter>();
    for (const source of sources) {
      if (sourceMap.has(source.descriptor.id)) {
        throw new Error(`Migration source ${source.descriptor.id} is registered more than once.`);
      }
      sourceMap.set(source.descriptor.id, source);
    }
    if (sourceMap.size > resourceLimits.migration.maximumSources) {
      throw new Error('Too many migration sources are configured.');
    }
    this.#repository = repository;
    this.#contentRepository = contentRepository;
    this.#contentService = contentService;
    this.#sources = sourceMap;
    this.#now = now;
    this.#createId = createId;
  }

  async #document(scope: ContentScope): Promise<MigrationDocument> {
    return (await this.#repository.get(scope)) ?? emptyMigrationDocument(scope, this.#now());
  }

  async #mutate<T>(
    scope: ContentScope,
    mutate: (document: MigrationDocument) => Awaitable<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.#repository.get(scope);
      const document = current
        ? structuredClone(current)
        : emptyMigrationDocument(scope, this.#now());
      const expectedVersion = current?.version ?? null;
      const result = await mutate(document);
      document.version += 1;
      document.updatedAt = this.#now();
      try {
        await this.#repository.save(document, expectedVersion);
        return result;
      } catch (error) {
        if (
          error instanceof GridStoryError &&
          error.code === 'migration_write_conflict' &&
          attempt < 4
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictError('Migration state could not be updated after retries.');
  }

  listSources(): MigrationSourceDescriptor[] {
    return [...this.#sources.values()].map((source) => structuredClone(source.descriptor));
  }

  async overview(scope: ContentScope): Promise<MigrationOverview> {
    const document = await this.#document(scope);
    return {
      sources: this.listSources(),
      recipes: document.recipes,
      projects: document.projects.map(projectSummary),
      plans: document.plans.map(planSummary),
      runs: document.runs,
      cutoverReports: document.cutoverReports,
    };
  }

  async upsertRecipe(
    scope: ContentScope,
    actorId: string,
    input: MigrationRecipeInput,
  ): Promise<MigrationRecipe> {
    const parsed = migrationRecipeInputSchema.parse(input);
    return await this.#mutate(scope, (document) => {
      const existing = document.recipes.find((recipe) => recipe.id === parsed.id);
      const timestamp = this.#now();
      const recipe: MigrationRecipe = {
        ...parsed,
        version: (existing?.version ?? 0) + 1,
        createdBy: existing?.createdBy ?? actorId,
        createdAt: existing?.createdAt ?? timestamp,
        updatedBy: actorId,
        updatedAt: timestamp,
      };
      document.recipes = [
        ...document.recipes.filter((candidate) => candidate.id !== recipe.id),
        recipe,
      ].sort((left, right) => left.id.localeCompare(right.id));
      return recipe;
    });
  }

  async createProject(
    scope: ContentScope,
    actorId: string,
    input: MigrationProjectInput,
  ): Promise<MigrationProjectSummary> {
    const parsed = migrationProjectInputSchema.parse(input);
    const source = this.#sources.get(parsed.sourceId);
    if (!source) throw new NotFoundError(`Migration source ${parsed.sourceId} is not configured.`);
    return await this.#mutate(scope, (document) => {
      if (document.projects.some((project) => project.id === parsed.id)) {
        throw new ConflictError(`Migration project ${parsed.id} already exists.`);
      }
      const recipes = parsed.recipeIds.map((id) =>
        document.recipes.find((recipe) => recipe.id === id),
      );
      if (recipes.some((recipe) => !recipe)) {
        throw new NotFoundError('Every migration project recipe must exist.');
      }
      if (recipes.some((recipe) => recipe?.provider !== source.descriptor.provider)) {
        throw new GridStoryError(
          'Migration project recipes must match the source provider.',
          'invalid_migration_project',
          400,
        );
      }
      const timestamp = this.#now();
      const project: MigrationProject = {
        ...parsed,
        provider: source.descriptor.provider,
        state: 'active',
        version: 1,
        recipeVersions: {},
        lastFullSourceIds: [],
        createdBy: actorId,
        createdAt: timestamp,
        updatedBy: actorId,
        updatedAt: timestamp,
      };
      document.projects.push(project);
      return projectSummary(project);
    });
  }

  async setProjectState(
    scope: ContentScope,
    actorId: string,
    projectId: string,
    state: 'active' | 'paused',
  ): Promise<MigrationProjectSummary> {
    return await this.#mutate(scope, (document) => {
      const project = document.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new NotFoundError('Migration project was not found.');
      project.state = state;
      project.version += 1;
      project.updatedBy = actorId;
      project.updatedAt = this.#now();
      return projectSummary(project);
    });
  }

  async #buildEffect(input: {
    scope: ContentScope;
    project: MigrationProject;
    recipes: MigrationRecipe[];
    document: MigrationDocument;
    record: MigrationSourceSnapshot['records'][number];
  }): Promise<MigrationPlanEffect> {
    const { scope, project, recipes, document, record } = input;
    const sourceChecksum = logicalChecksum(record);
    const link = document.links.find(
      (candidate) =>
        candidate.projectId === project.id && candidate.externalId === record.externalId,
    );
    if (record.status === 'deleted') {
      const blocker: MigrationBlocker = {
        code: 'source-deleted',
        externalId: record.externalId,
        ...(link ? { targetEntryId: link.targetEntryId } : {}),
        message: 'Source deletion is reported for operator review and is never propagated.',
      };
      return {
        externalId: record.externalId,
        sourceType: record.sourceType,
        sourceStatus: record.status,
        sourceChecksum,
        action: 'source-deleted',
        publish: false,
        ...(link ? { targetEntryId: link.targetEntryId } : {}),
        blockers: [blocker],
      };
    }
    const recipe = recipeFor(recipes, record);
    if (!recipe) {
      const code = isMediaType(record.sourceType) ? 'unsupported-media' : 'unmapped-source-type';
      return {
        externalId: record.externalId,
        sourceType: record.sourceType,
        sourceStatus: record.status,
        sourceChecksum,
        action: 'blocked',
        publish: false,
        blockers: [
          {
            code,
            externalId: record.externalId,
            message:
              code === 'unsupported-media'
                ? 'Source media requires a separately reviewed binary migration and mapping.'
                : `No mapping recipe matches source type ${record.sourceType}.`,
          },
        ],
      };
    }
    let mappedData: Record<string, unknown>;
    try {
      mappedData = mapRecord(record, recipe);
      await this.#contentService.validateCandidate({
        scope,
        contentType: recipe.targetContentType,
        data: mappedData,
      });
    } catch (error) {
      const blocker =
        error instanceof MappingFailure
          ? { ...error.blocker, externalId: record.externalId }
          : {
              code: 'invalid-target-content' as const,
              externalId: record.externalId,
              message: migrationErrorMessage(error),
            };
      return {
        externalId: record.externalId,
        sourceType: record.sourceType,
        sourceStatus: record.status,
        sourceChecksum,
        action: 'blocked',
        publish: false,
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        blockers: [blocker],
      };
    }
    const dataChecksum = logicalChecksum(mappedData);
    const deterministicId = link?.targetEntryId ?? targetId(scope, project.id, record.externalId);
    const target = await this.#contentRepository.getById({
      scope,
      id: deterministicId,
      perspective: 'draft',
    });
    if (!link && target) {
      return {
        externalId: record.externalId,
        sourceType: record.sourceType,
        sourceStatus: record.status,
        sourceChecksum,
        action: 'blocked',
        publish: false,
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        targetEntryId: deterministicId,
        dataChecksum,
        blockers: [
          {
            code: 'target-drift',
            externalId: record.externalId,
            targetEntryId: deterministicId,
            message: 'Deterministic target ID is already owned by content outside this project.',
          },
        ],
      };
    }
    if (link?.state === 'applied' && !target) {
      return {
        externalId: record.externalId,
        sourceType: record.sourceType,
        sourceStatus: record.status,
        sourceChecksum,
        action: 'blocked',
        publish: false,
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        targetEntryId: deterministicId,
        dataChecksum,
        blockers: [
          {
            code: 'target-missing',
            externalId: record.externalId,
            targetEntryId: deterministicId,
            message: 'Previously linked target content is missing.',
          },
        ],
      };
    }
    if (
      link?.state === 'applied' &&
      target &&
      link.lastAppliedRevisionId !== target.draftRevisionId
    ) {
      return {
        externalId: record.externalId,
        sourceType: record.sourceType,
        sourceStatus: record.status,
        sourceChecksum,
        action: 'blocked',
        publish: false,
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        targetEntryId: deterministicId,
        expectedTargetRevisionId: link.lastAppliedRevisionId,
        dataChecksum,
        blockers: [
          {
            code: 'target-drift',
            externalId: record.externalId,
            targetEntryId: deterministicId,
            message: 'Target draft changed after the last source synchronization.',
          },
        ],
      };
    }
    const unchanged =
      link?.state === 'applied' &&
      link.sourceChecksum === sourceChecksum &&
      link.dataChecksum === dataChecksum &&
      link.recipeId === recipe.id &&
      link.recipeVersion === recipe.version;
    const action = unchanged ? 'noop' : target ? 'update' : 'create';
    const publish =
      recipe.publicationMode === 'mirror-source' &&
      record.status === 'published' &&
      (action !== 'noop' || !target || target.publishedRevisionId !== target.draftRevisionId);
    return {
      externalId: record.externalId,
      sourceType: record.sourceType,
      sourceStatus: record.status,
      sourceChecksum,
      action,
      publish,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      targetEntryId: deterministicId,
      ...(target ? { expectedTargetRevisionId: target.draftRevisionId } : {}),
      mappedData,
      dataChecksum,
      blockers: [],
    };
  }

  async planSync(
    scope: ContentScope,
    actorId: string,
    projectId: string,
  ): Promise<MigrationPlanSummary> {
    const document = await this.#document(scope);
    const project = document.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new NotFoundError('Migration project was not found.');
    if (project.state !== 'active') {
      throw new ConflictError('Paused migration projects cannot create synchronization plans.');
    }
    const source = this.#sources.get(project.sourceId);
    if (!source) throw new NotFoundError('Migration source is no longer configured.');
    const recipes = project.recipeIds.map((id) =>
      document.recipes.find((recipe) => recipe.id === id),
    );
    if (recipes.some((recipe) => !recipe))
      throw new NotFoundError('Migration recipe was not found.');
    const resolvedRecipes = recipes as MigrationRecipe[];
    const canDelta =
      project.mode === 'dual-run' &&
      source.descriptor.supportsDelta &&
      project.checkpoint !== undefined &&
      sameRecipeVersions(project, resolvedRecipes);
    const snapshot = migrationSourceSnapshotSchema.parse(
      await source.read({
        mode: canDelta ? 'delta' : 'full',
        ...(canDelta && project.checkpoint ? { checkpoint: project.checkpoint } : {}),
        maximumRecords: resourceLimits.migration.maximumSourceRecordsPerRun,
      }),
    );
    if (snapshot.kind !== (canDelta ? 'delta' : 'full') || !snapshot.complete) {
      throw new GridStoryError(
        'Migration source did not return the requested complete snapshot.',
        'incomplete_migration_snapshot',
        409,
      );
    }
    ensureUniqueRecords(snapshot);
    const effects: MigrationPlanEffect[] = [];
    for (const record of [...snapshot.records].sort((left, right) =>
      left.externalId.localeCompare(right.externalId),
    )) {
      effects.push(
        await this.#buildEffect({
          scope,
          project,
          recipes: resolvedRecipes,
          document,
          record,
        }),
      );
    }
    if (snapshot.kind === 'full') {
      const sourceIds = new Set(
        snapshot.records
          .filter((record) => record.status !== 'deleted')
          .map((record) => record.externalId),
      );
      for (const link of document.links.filter(
        (candidate) => candidate.projectId === project.id && !sourceIds.has(candidate.externalId),
      )) {
        effects.push({
          externalId: link.externalId,
          sourceType: link.sourceType,
          sourceStatus: 'deleted',
          sourceChecksum: link.sourceChecksum,
          action: 'source-deleted',
          publish: false,
          recipeId: link.recipeId,
          recipeVersion: link.recipeVersion,
          targetEntryId: link.targetEntryId,
          blockers: [
            {
              code: 'source-deleted',
              externalId: link.externalId,
              targetEntryId: link.targetEntryId,
              message: 'Previously synchronized source content is absent from the full snapshot.',
            },
          ],
        });
      }
    }
    effects.sort((left, right) => left.externalId.localeCompare(right.externalId));
    const timestamp = this.#now();
    const expiresAt = new Date(
      Date.parse(timestamp) + resourceLimits.migration.planLifetimeSeconds * 1_000,
    ).toISOString();
    const digestInput = {
      projectId: project.id,
      projectVersion: project.version,
      snapshotKind: snapshot.kind,
      effects,
      nextCheckpoint: snapshot.checkpoint,
      ...(snapshot.kind === 'full'
        ? {
            fullSourceIds: snapshot.records
              .filter((record) => record.status !== 'deleted')
              .map((record) => record.externalId)
              .sort(),
          }
        : {}),
    };
    const plan: MigrationPlan = {
      id: this.#createId(),
      projectId: project.id,
      projectVersion: project.version,
      state: 'preview',
      snapshotKind: snapshot.kind,
      effects,
      counts: countEffects(effects),
      digest: logicalChecksum(digestInput),
      nextCheckpoint: snapshot.checkpoint,
      ...(digestInput.fullSourceIds ? { fullSourceIds: digestInput.fullSourceIds } : {}),
      createdBy: actorId,
      createdAt: timestamp,
      expiresAt,
    };
    return await this.#mutate(scope, (latest) => {
      const currentProject = latest.projects.find((candidate) => candidate.id === project.id);
      if (!currentProject || currentProject.version !== project.version) {
        throw new ConflictError('Migration project changed while its source was being read.');
      }
      for (const recipe of resolvedRecipes) {
        const current = latest.recipes.find((candidate) => candidate.id === recipe.id);
        if (!current || current.version !== recipe.version) {
          throw new ConflictError('Migration recipe changed while its source was being read.');
        }
      }
      latest.plans = [...latest.plans, plan].slice(-resourceLimits.migration.maximumStoredPlans);
      return planSummary(plan);
    });
  }

  async #assertExecutable(
    scope: ContentScope,
    planId: string,
    digest: string,
  ): Promise<{ document: MigrationDocument; plan: MigrationPlan; project: MigrationProject }> {
    const document = await this.#document(scope);
    const plan = document.plans.find((candidate) => candidate.id === planId);
    if (!plan) throw new NotFoundError('Migration plan was not found.');
    if (plan.digest !== digest) {
      throw new ConflictError('Migration plan digest does not match the reviewed preview.');
    }
    if (plan.state === 'completed') {
      const project = document.projects.find((candidate) => candidate.id === plan.projectId);
      if (!project) throw new NotFoundError('Migration project was not found.');
      return { document, plan, project };
    }
    if (Date.parse(plan.expiresAt) <= Date.parse(this.#now())) {
      await this.#mutate(scope, (latest) => {
        const current = latest.plans.find((candidate) => candidate.id === planId);
        if (current && current.state !== 'completed') current.state = 'expired';
      });
      throw new ConflictError('Migration plan expired and must be regenerated.');
    }
    if (plan.counts.blocked > 0 || plan.counts.sourceDeleted > 0) {
      throw new GridStoryError(
        'Migration plan contains blockers or source deletions and cannot execute.',
        'migration_plan_blocked',
        409,
      );
    }
    const project = document.projects.find((candidate) => candidate.id === plan.projectId);
    if (!project || project.version !== plan.projectVersion || project.state !== 'active') {
      throw new ConflictError('Migration project changed after this plan was created.');
    }
    for (const effect of plan.effects) {
      if (!effect.recipeId || !effect.recipeVersion) continue;
      const recipe = document.recipes.find((candidate) => candidate.id === effect.recipeId);
      if (!recipe || recipe.version !== effect.recipeVersion) {
        throw new ConflictError('Migration recipe changed after this plan was created.');
      }
    }
    return { document, plan, project };
  }

  async #prepareLink(
    scope: ContentScope,
    projectId: string,
    planId: string,
    effect: MigrationPlanEffect,
  ): Promise<void> {
    if (
      !effect.targetEntryId ||
      !effect.recipeId ||
      !effect.recipeVersion ||
      !effect.dataChecksum
    ) {
      throw new Error('Executable migration effect is incomplete.');
    }
    await this.#mutate(scope, (document) => {
      const existing = document.links.find(
        (link) => link.projectId === projectId && link.externalId === effect.externalId,
      );
      const next = {
        ...(existing ?? {}),
        projectId,
        externalId: effect.externalId,
        sourceType: effect.sourceType,
        targetEntryId: effect.targetEntryId as string,
        recipeId: effect.recipeId as string,
        recipeVersion: effect.recipeVersion as number,
        state: 'pending' as const,
        sourceStatus: effect.sourceStatus,
        sourceChecksum: effect.sourceChecksum,
        dataChecksum: effect.dataChecksum as string,
        planId,
        updatedAt: this.#now(),
      };
      document.links = [
        ...document.links.filter(
          (link) => !(link.projectId === projectId && link.externalId === effect.externalId),
        ),
        next,
      ];
    });
  }

  async #finalizeLink(
    scope: ContentScope,
    projectId: string,
    planId: string,
    effect: MigrationPlanEffect,
    entry: ContentEntry,
  ): Promise<void> {
    await this.#mutate(scope, (document) => {
      const link = document.links.find(
        (candidate) =>
          candidate.projectId === projectId && candidate.externalId === effect.externalId,
      );
      if (!link || link.planId !== planId) {
        throw new ConflictError('Migration link changed while applying a plan.');
      }
      link.state = 'applied';
      link.lastAppliedRevisionId = entry.draftRevisionId;
      if (entry.publishedRevisionId) link.lastPublishedRevisionId = entry.publishedRevisionId;
      else delete link.lastPublishedRevisionId;
      link.updatedAt = this.#now();
    });
  }

  async #applyEffect(
    scope: ContentScope,
    actor: Actor,
    project: MigrationProject,
    plan: MigrationPlan,
    effect: MigrationPlanEffect,
  ): Promise<void> {
    if (!effect.targetEntryId || !effect.mappedData || !effect.dataChecksum || !effect.recipeId) {
      throw new Error('Executable migration effect is incomplete.');
    }
    const latest = await this.#document(scope);
    const latestProject = latest.projects.find((candidate) => candidate.id === project.id);
    if (!latestProject || latestProject.version !== plan.projectVersion) {
      throw new ConflictError('Migration project changed during execution.');
    }
    const recipe = latest.recipes.find((candidate) => candidate.id === effect.recipeId);
    if (!recipe || recipe.version !== effect.recipeVersion) {
      throw new ConflictError('Migration recipe changed during execution.');
    }
    let current = await this.#contentRepository.getById({
      scope,
      id: effect.targetEntryId,
      perspective: 'draft',
    });
    const currentChecksum = current ? logicalChecksum(current.data) : undefined;
    const link = latest.links.find(
      (candidate) =>
        candidate.projectId === project.id && candidate.externalId === effect.externalId,
    );
    const recovering =
      link?.state === 'pending' &&
      link.planId === plan.id &&
      currentChecksum === effect.dataChecksum;
    if (!recovering) {
      if (effect.action === 'create' && current) {
        throw new ConflictError('Migration target appeared after the plan was reviewed.');
      }
      if (
        effect.action !== 'create' &&
        (!current || current.draftRevisionId !== effect.expectedTargetRevisionId)
      ) {
        throw new ConflictError('Migration target changed after the plan was reviewed.');
      }
    }
    await this.#prepareLink(scope, project.id, plan.id, effect);
    if (!recovering && effect.action === 'create') {
      current = await this.#contentService.create({
        scope,
        id: effect.targetEntryId,
        contentType: recipe.targetContentType,
        data: effect.mappedData,
        actor,
      });
    } else if (!recovering && effect.action === 'update' && current) {
      current = await this.#contentService.updateDraft({
        scope,
        id: current.id,
        expectedRevisionId: current.draftRevisionId,
        data: effect.mappedData,
        actor,
      });
    }
    if (!current) throw new ConflictError('Migration target is missing during execution.');
    if (effect.publish && current.publishedRevisionId !== current.draftRevisionId) {
      current = await this.#contentService.publish({
        scope,
        id: current.id,
        expectedRevisionId: current.draftRevisionId,
        actor,
      });
    }
    await this.#finalizeLink(scope, project.id, plan.id, effect, current);
  }

  async executePlan(
    scope: ContentScope,
    actor: Actor,
    planId: string,
    digest: string,
  ): Promise<MigrationRun> {
    const executable = await this.#assertExecutable(scope, planId, digest);
    if (executable.plan.state === 'completed') {
      const run = [...executable.document.runs]
        .reverse()
        .find((candidate) => candidate.planId === planId && candidate.state === 'succeeded');
      if (!run) throw new ConflictError('Completed migration plan has no execution receipt.');
      return run;
    }
    const startedAt = this.#now();
    await this.#mutate(scope, (document) => {
      const plan = document.plans.find((candidate) => candidate.id === planId);
      if (!plan || plan.digest !== digest || plan.state === 'completed') {
        throw new ConflictError('Migration plan changed before execution.');
      }
      plan.state = 'executing';
      plan.startedAt = startedAt;
      delete plan.error;
    });
    try {
      for (const effect of executable.plan.effects) {
        if (effect.action === 'blocked' || effect.action === 'source-deleted') continue;
        await this.#applyEffect(scope, actor, executable.project, executable.plan, effect);
      }
      const completedAt = this.#now();
      const run: MigrationRun = {
        id: this.#createId(),
        projectId: executable.project.id,
        planId,
        state: 'succeeded',
        counts: executable.plan.counts,
        actorId: actor.id,
        startedAt,
        completedAt,
      };
      await this.#mutate(scope, (document) => {
        const plan = document.plans.find((candidate) => candidate.id === planId);
        const project = document.projects.find(
          (candidate) => candidate.id === executable.project.id,
        );
        if (!plan || !project || project.version !== executable.plan.projectVersion) {
          throw new ConflictError('Migration state changed before checkpoint advancement.');
        }
        plan.state = 'completed';
        plan.completedAt = completedAt;
        delete plan.error;
        project.checkpoint = plan.nextCheckpoint;
        project.checkpointDigest = sha256(plan.nextCheckpoint);
        project.recipeVersions = Object.fromEntries(
          project.recipeIds.map((recipeId) => {
            const recipe = document.recipes.find((candidate) => candidate.id === recipeId);
            if (!recipe) throw new NotFoundError('Migration recipe was not found.');
            return [recipeId, recipe.version];
          }),
        );
        if (plan.fullSourceIds) project.lastFullSourceIds = plan.fullSourceIds;
        project.lastSyncedAt = completedAt;
        project.updatedBy = actor.id;
        project.updatedAt = completedAt;
        document.runs = [...document.runs, run].slice(-resourceLimits.migration.maximumStoredRuns);
      });
      return run;
    } catch (error) {
      const completedAt = this.#now();
      const message = migrationErrorMessage(error);
      const run: MigrationRun = {
        id: this.#createId(),
        projectId: executable.project.id,
        planId,
        state: 'failed',
        counts: executable.plan.counts,
        actorId: actor.id,
        startedAt,
        completedAt,
        error: message,
      };
      await this.#mutate(scope, (document) => {
        const plan = document.plans.find((candidate) => candidate.id === planId);
        if (plan && plan.state !== 'completed') {
          plan.state = 'failed';
          plan.error = message;
        }
        document.runs = [...document.runs, run].slice(-resourceLimits.migration.maximumStoredRuns);
      });
      throw error;
    }
  }

  async validateCutover(
    scope: ContentScope,
    actorId: string,
    projectId: string,
  ): Promise<MigrationCutoverReport> {
    const document = await this.#document(scope);
    const project = document.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new NotFoundError('Migration project was not found.');
    const source = this.#sources.get(project.sourceId);
    if (!source) throw new NotFoundError('Migration source is no longer configured.');
    const recipes = project.recipeIds.map((id) =>
      document.recipes.find((recipe) => recipe.id === id),
    );
    if (recipes.some((recipe) => !recipe))
      throw new NotFoundError('Migration recipe was not found.');
    const resolvedRecipes = recipes as MigrationRecipe[];
    const snapshot = migrationSourceSnapshotSchema.parse(
      await source.read({
        mode: 'full',
        maximumRecords: resourceLimits.migration.maximumSourceRecordsPerRun,
      }),
    );
    if (snapshot.kind !== 'full' || !snapshot.complete) {
      throw new GridStoryError(
        'Cutover validation requires a complete full source snapshot.',
        'incomplete_migration_snapshot',
        409,
      );
    }
    ensureUniqueRecords(snapshot);
    const blockers: MigrationBlocker[] = [];
    let linkedCount = 0;
    let currentCount = 0;
    let publishedCount = 0;
    const activeRecords = snapshot.records.filter((record) => record.status !== 'deleted');
    const activeIds = new Set(activeRecords.map((record) => record.externalId));
    for (const record of activeRecords) {
      const recipe = recipeFor(resolvedRecipes, record);
      if (!recipe) {
        blockers.push({
          code: isMediaType(record.sourceType) ? 'unsupported-media' : 'unmapped-source-type',
          externalId: record.externalId,
          message: `No cutover mapping matches source type ${record.sourceType}.`,
        });
        continue;
      }
      const link = document.links.find(
        (candidate) =>
          candidate.projectId === project.id && candidate.externalId === record.externalId,
      );
      if (!link) {
        blockers.push({
          code: 'target-missing',
          externalId: record.externalId,
          message: 'Source record has not been synchronized to a target entry.',
        });
        continue;
      }
      linkedCount += 1;
      let mapped: Record<string, unknown>;
      try {
        mapped = mapRecord(record, recipe);
      } catch (error) {
        blockers.push(
          error instanceof MappingFailure
            ? { ...error.blocker, externalId: record.externalId, targetEntryId: link.targetEntryId }
            : {
                code: 'invalid-transform',
                externalId: record.externalId,
                targetEntryId: link.targetEntryId,
                message: migrationErrorMessage(error),
              },
        );
        continue;
      }
      if (
        link.state !== 'applied' ||
        link.sourceChecksum !== logicalChecksum(record) ||
        link.dataChecksum !== logicalChecksum(mapped) ||
        link.recipeVersion !== recipe.version
      ) {
        blockers.push({
          code: 'source-drift',
          externalId: record.externalId,
          targetEntryId: link.targetEntryId,
          message: 'Source data or mapping changed after the last completed synchronization.',
        });
      }
      const target = await this.#contentRepository.getById({
        scope,
        id: link.targetEntryId,
        perspective: 'draft',
      });
      if (!target) {
        blockers.push({
          code: 'target-missing',
          externalId: record.externalId,
          targetEntryId: link.targetEntryId,
          message: 'Linked target entry is missing.',
        });
        continue;
      }
      if (target.draftRevisionId !== link.lastAppliedRevisionId) {
        blockers.push({
          code: 'target-drift',
          externalId: record.externalId,
          targetEntryId: link.targetEntryId,
          message: 'Target draft changed after the last completed synchronization.',
        });
        continue;
      }
      currentCount += 1;
      if (record.status === 'published') {
        if (target.publishedRevisionId !== target.draftRevisionId) {
          blockers.push({
            code: 'target-unpublished',
            externalId: record.externalId,
            targetEntryId: link.targetEntryId,
            message: 'Published source content is not published at its current target revision.',
          });
        } else {
          publishedCount += 1;
        }
      }
    }
    for (const record of snapshot.records.filter((candidate) => candidate.status === 'deleted')) {
      blockers.push({
        code: 'source-deleted',
        externalId: record.externalId,
        message: 'Source deletion tombstone requires an explicit operator decision.',
      });
    }
    for (const link of document.links.filter(
      (candidate) => candidate.projectId === project.id && !activeIds.has(candidate.externalId),
    )) {
      blockers.push({
        code: 'source-deleted',
        externalId: link.externalId,
        targetEntryId: link.targetEntryId,
        message: 'Linked content is absent from the complete source snapshot.',
      });
    }
    blockers.sort((left, right) =>
      `${left.externalId ?? ''}:${left.code}`.localeCompare(
        `${right.externalId ?? ''}:${right.code}`,
      ),
    );
    const validatedAt = this.#now();
    const sourceDigest = logicalChecksum(
      [...snapshot.records].sort((left, right) => left.externalId.localeCompare(right.externalId)),
    );
    const reportBase = {
      projectId,
      sourceDigest,
      sourceCount: activeRecords.length,
      linkedCount,
      currentCount,
      publishedCount,
      blockers,
      validatedBy: actorId,
      validatedAt,
    };
    const report: MigrationCutoverReport = {
      id: this.#createId(),
      ...reportBase,
      ready: blockers.length === 0,
      digest: logicalChecksum(reportBase),
    };
    return await this.#mutate(scope, (latest) => {
      const current = latest.projects.find((candidate) => candidate.id === projectId);
      if (!current || current.version !== project.version) {
        throw new ConflictError('Migration project changed during cutover validation.');
      }
      latest.cutoverReports = [...latest.cutoverReports, report].slice(-20);
      return report;
    });
  }
}
