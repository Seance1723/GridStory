import {
  editorialOverviewSchema,
  type ContentEntry,
  type ContentSchemaDefinition,
  type ContentScope,
  type EditorialContentItem,
  type EditorialOverview,
  type EditorialReleaseItem,
  type EditorialReviewItem,
} from '@gridstory/schema';
import type { OperationsDashboard } from './operations-service.js';
import type { ReleaseRepository } from './release-repository.js';
import { assertSameContentScope, assertValidContentScope } from './tenant-scope.js';
import type { ContentRepository } from './types.js';
import type { WorkflowRepository } from './workflow-repository.js';

const itemLimit = 5 as const;

export type EditorialContentCoverage = 'all-registered' | 'pages-only';

export interface EditorialOverviewVisibility {
  content?: EditorialContentCoverage;
  reviews: boolean;
  releases: boolean;
  operations: boolean;
}

export interface EditorialOverviewReader {
  read(input: {
    scope: ContentScope;
    principal: { id: string; roles: string[] };
    visibility: EditorialOverviewVisibility;
  }): Promise<EditorialOverview>;
}

export interface EditorialOverviewServiceOptions {
  content: ContentRepository;
  workflows: WorkflowRepository;
  releases: ReleaseRepository;
  schemas: ContentSchemaDefinition[];
  operations: (scope: ContentScope) => Promise<OperationsDashboard>;
  now?: () => Date;
}

type WidgetError = { availability: 'error'; reason: 'source-unavailable' };
type WidgetUnavailable = { availability: 'unavailable' };

function unavailable(): WidgetUnavailable {
  return { availability: 'unavailable' };
}

async function isolated<T>(read: () => Promise<T>): Promise<T | WidgetError> {
  try {
    return await read();
  } catch {
    return { availability: 'error', reason: 'source-unavailable' };
  }
}

function bounds(totalCount: number, displayedCount: number) {
  return {
    totalCount,
    displayedCount,
    limit: itemLimit,
    hasMore: totalCount > displayedCount,
  };
}

function visibleEntries(
  entries: ContentEntry[],
  coverage: EditorialContentCoverage,
): ContentEntry[] {
  return coverage === 'pages-only'
    ? entries.filter((entry) => entry.contentType === 'page')
    : entries;
}

function safeTitle(
  entry: ContentEntry,
  schemas: ReadonlyMap<string, ContentSchemaDefinition>,
): string {
  const schema = schemas.get(entry.contentType);
  const candidates = [schema?.titleField, schema?.route?.slugField]
    .filter((field): field is string => Boolean(field))
    .map((field) => entry.data[field]);
  const selected = candidates.find((value) => typeof value === 'string' && value.trim());
  return (typeof selected === 'string' ? selected.trim() : entry.id).slice(0, 256);
}

function compareUpdated(
  left: Pick<ContentEntry, 'updatedAt' | 'id'>,
  right: Pick<ContentEntry, 'updatedAt' | 'id'>,
): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

export class EditorialOverviewService implements EditorialOverviewReader {
  readonly #content: ContentRepository;
  readonly #workflows: WorkflowRepository;
  readonly #releases: ReleaseRepository;
  readonly #schemas: ReadonlyMap<string, ContentSchemaDefinition>;
  readonly #operations: (scope: ContentScope) => Promise<OperationsDashboard>;
  readonly #now: () => Date;

  constructor({
    content,
    workflows,
    releases,
    schemas,
    operations,
    now = () => new Date(),
  }: EditorialOverviewServiceOptions) {
    this.#content = content;
    this.#workflows = workflows;
    this.#releases = releases;
    this.#schemas = new Map(schemas.map((schema) => [schema.id, structuredClone(schema)]));
    this.#operations = operations;
    this.#now = now;
  }

  async #entries(scope: ContentScope, coverage: EditorialContentCoverage) {
    const entries = await this.#content.list({ scope, perspective: 'draft' });
    entries.forEach((entry) => {
      assertSameContentScope(scope, entry, 'editorial overview content');
    });
    return visibleEntries(entries, coverage);
  }

  async #contentWidget(scope: ContentScope, coverage: EditorialContentCoverage) {
    const entries = (await this.#entries(scope, coverage)).sort(compareUpdated);
    const states = { draft: 0, changed: 0, published: 0 };
    for (const entry of entries) states[entry.status] += 1;
    const recent: EditorialContentItem[] = entries.slice(0, itemLimit).map((entry) => ({
      id: entry.id,
      contentType: entry.contentType,
      title: safeTitle(entry, this.#schemas),
      status: entry.status,
      updatedAt: entry.updatedAt,
      destination: entry.contentType === 'page' ? 'pages' : 'collections',
    }));
    return {
      availability: 'available' as const,
      coverage,
      exact: true as const,
      bounds: bounds(entries.length, recent.length),
      states,
      recent,
    };
  }

  async #reviewsWidget(
    scope: ContentScope,
    coverage: EditorialContentCoverage,
    principal: { id: string; roles: string[] },
  ) {
    const [entries, instances, definitions] = await Promise.all([
      this.#entries(scope, coverage),
      this.#workflows.listInstances(scope),
      this.#workflows.listDefinitions(scope),
    ]);
    instances.forEach((instance) => {
      assertSameContentScope(scope, instance, 'editorial overview workflow instance');
    });
    definitions.forEach((definition) => {
      assertSameContentScope(scope, definition, 'editorial overview workflow definition');
    });
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const reviews: EditorialReviewItem[] = [];
    for (const instance of instances) {
      const entry = entriesById.get(instance.entryId);
      const pending = instance.pendingApproval;
      const definition = definitionsById.get(instance.workflowId);
      const transition = definition?.transitions.find(
        (candidate) => candidate.id === pending?.transitionId,
      );
      const state = definition?.states.find((candidate) => candidate.id === instance.stateId);
      const approval = transition?.approval;
      if (
        !entry ||
        !pending ||
        !definition ||
        !transition ||
        !state ||
        !approval ||
        definition.version !== instance.workflowVersion ||
        definition.contentType !== instance.contentType ||
        transition.from !== instance.stateId ||
        pending.revisionId !== instance.revisionId ||
        !principal.roles.some((role) => approval.allowedRoles.includes(role)) ||
        (approval.separationOfDuties && pending.requestedBy === principal.id) ||
        pending.decisions.some((decision) => decision.actorId === principal.id)
      ) {
        continue;
      }
      reviews.push({
        entryId: entry.id,
        contentType: entry.contentType,
        title: safeTitle(entry, this.#schemas),
        workflowName: definition.name,
        stateLabel: state.label,
        transitionLabel: transition.label,
        requestedAt: pending.requestedAt,
        ...(pending.dueAt ? { dueAt: pending.dueAt } : {}),
        destination: entry.contentType === 'page' ? 'pages' : 'collections',
      });
    }
    reviews.sort(
      (left, right) =>
        (left.dueAt ?? '9999').localeCompare(right.dueAt ?? '9999') ||
        right.requestedAt.localeCompare(left.requestedAt) ||
        left.entryId.localeCompare(right.entryId),
    );
    const items = reviews.slice(0, itemLimit);
    return {
      availability: 'available' as const,
      coverage,
      exact: true as const,
      bounds: bounds(reviews.length, items.length),
      items,
    };
  }

  async #releasesWidget(scope: ContentScope) {
    const releases = await this.#releases.list(scope);
    releases.forEach((release) => {
      assertSameContentScope(scope, release, 'editorial overview release');
    });
    releases.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    );
    const items: EditorialReleaseItem[] = releases.slice(0, itemLimit).map((release) => ({
      id: release.id,
      name: release.name,
      state: release.state,
      updatedAt: release.updatedAt,
      ...(release.schedule?.runAt ? { runAt: release.schedule.runAt } : {}),
      destination: 'releases',
    }));
    return {
      availability: 'available' as const,
      exact: true as const,
      bounds: bounds(releases.length, items.length),
      items,
    };
  }

  async #operationsWidget(scope: ContentScope) {
    const dashboard = await this.#operations(scope);
    return {
      availability: 'available' as const,
      auditValid: dashboard.audit.valid,
      deadOutbox: dashboard.outbox.dead,
      deadJobs: dashboard.jobs.dead,
      outboxTruncated: dashboard.outbox.truncated,
      jobsTruncated: dashboard.jobs.truncated,
      destination: 'operations' as const,
    };
  }

  async read({ scope, principal, visibility }: Parameters<EditorialOverviewReader['read']>[0]) {
    assertValidContentScope(scope);
    const content = visibility.content
      ? isolated(() => this.#contentWidget(scope, visibility.content as EditorialContentCoverage))
      : Promise.resolve(unavailable());
    const reviews =
      visibility.reviews && visibility.content
        ? isolated(() =>
            this.#reviewsWidget(scope, visibility.content as EditorialContentCoverage, principal),
          )
        : Promise.resolve(unavailable());
    const releases = visibility.releases
      ? isolated(() => this.#releasesWidget(scope))
      : Promise.resolve(unavailable());
    const operations = visibility.operations
      ? isolated(() => this.#operationsWidget(scope))
      : Promise.resolve(unavailable());
    const [contentWidget, reviewsWidget, releasesWidget, operationsWidget] = await Promise.all([
      content,
      reviews,
      releases,
      operations,
    ]);
    return editorialOverviewSchema.parse({
      version: 1,
      scope,
      generatedAt: this.#now().toISOString(),
      widgets: {
        content: contentWidget,
        reviews: reviewsWidget,
        releases: releasesWidget,
        operations: operationsWidget,
      },
    });
  }
}
