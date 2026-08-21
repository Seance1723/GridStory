import {
  type BacklinkRecord,
  type ContentEntry,
  type ContentPerspective,
  type ContentSchemaDefinition,
  type ContentScope,
  collectContentReferences,
  type ParsedSearchQuery,
  type RelatedContentRecord,
  resourceLimits,
  type SearchDocument,
  type SearchFacet,
  type SearchIndexStatus,
  type SearchQuery,
  type SearchResponse,
  searchQuerySchema,
  type TaxonomyDefinition,
} from '@gridstory/schema';
import { NotFoundError } from './errors.js';
import {
  assertSameContentScope,
  contentScopeKey,
  emitTenantTelemetry,
  type TenantTelemetrySink,
} from './tenant-scope.js';
import type { Awaitable, ContentRepository, DurableJob } from './types.js';

export interface SearchAdapterHit {
  entryId: string;
  score: number;
  highlights: string[];
  taxonomies: Record<string, string[]>;
}

export interface SearchAdapterResult {
  scope: ContentScope;
  perspective: ContentPerspective;
  hits: SearchAdapterHit[];
  facets: SearchFacet[];
  total: number;
}

export interface SearchAdapterStatus {
  scope: ContentScope;
  state: 'ready' | 'rebuilding' | 'degraded';
  draftDocuments: number;
  publishedDocuments: number;
  lastRebuiltAt?: string;
}

export interface SearchAdapter {
  readonly name: string;
  search(input: {
    scope: ContentScope;
    query: ParsedSearchQuery;
    taxonomies: TaxonomyDefinition[];
  }): Awaitable<SearchAdapterResult>;
  upsert(document: SearchDocument): Awaitable<void>;
  rebuild(input: {
    scope: ContentScope;
    perspective: ContentPerspective;
    documents: SearchDocument[];
  }): Awaitable<void>;
  status(scope: ContentScope): Awaitable<SearchAdapterStatus>;
}

function valueAt(data: Record<string, unknown>, path: string): unknown {
  let value: unknown = { data };
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function stringsAt(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(stringsAt);
  return [];
}

function collectText(value: unknown, output: string[], depth = 0): void {
  if (
    depth > resourceLimits.search.maximumTraversalDepth ||
    output.length >= resourceLimits.search.maximumIndexedStringsPerEntry
  ) {
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child) => {
      collectText(child, output, depth + 1);
    });
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((child) => {
      collectText(child, output, depth + 1);
    });
  }
}

interface TaxonomyBinding {
  taxonomyId: string;
  contentType: string;
  path: string;
}

export function deriveTaxonomies(schemas: ContentSchemaDefinition[]): TaxonomyDefinition[] {
  const definitions = new Map<string, TaxonomyDefinition>();
  schemas.forEach((schema) => {
    schema.taxonomies?.forEach((taxonomy) => {
      if (!definitions.has(taxonomy.id)) {
        definitions.set(taxonomy.id, {
          ...taxonomy,
          hierarchical: taxonomy.hierarchical ?? false,
          terms: taxonomy.terms ?? [],
        });
      }
    });
  });
  return [...definitions.values()];
}

function deriveTaxonomyBindings(schemas: ContentSchemaDefinition[]): TaxonomyBinding[] {
  return schemas.flatMap((schema) =>
    schema.fields.flatMap((field) =>
      field.type === 'taxonomy'
        ? [{ taxonomyId: field.taxonomy, contentType: schema.id, path: `data.${field.name}` }]
        : [],
    ),
  );
}

export function buildSearchDocument(input: {
  entry: ContentEntry;
  perspective: ContentPerspective;
  taxonomies: TaxonomyDefinition[];
  taxonomyBindings: TaxonomyBinding[];
}): SearchDocument {
  const text: string[] = [];
  collectText(input.entry.data, text);
  const taxonomies: Record<string, string[]> = {};
  for (const taxonomy of input.taxonomies) {
    const binding = input.taxonomyBindings.find(
      (candidate) =>
        candidate.taxonomyId === taxonomy.id && candidate.contentType === input.entry.contentType,
    );
    if (!binding) continue;
    const allowed = new Set(taxonomy.terms.map((term) => term.id));
    const values = [
      ...new Set(
        stringsAt(valueAt(input.entry.data, binding.path)).filter(
          (value) => allowed.size === 0 || allowed.has(value),
        ),
      ),
    ];
    if (values.length) taxonomies[taxonomy.id] = values;
  }
  return {
    organizationId: input.entry.organizationId,
    tenantId: input.entry.tenantId,
    workspaceId: input.entry.workspaceId,
    siteId: input.entry.siteId,
    environmentId: input.entry.environmentId,
    locale: input.entry.locale,
    entryId: input.entry.id,
    contentType: input.entry.contentType,
    perspective: input.perspective,
    revisionId:
      input.perspective === 'published'
        ? (input.entry.publishedRevisionId ?? input.entry.draftRevisionId)
        : input.entry.draftRevisionId,
    updatedAt: input.entry.updatedAt,
    text: text.join(' ').slice(0, resourceLimits.search.maximumIndexedTextCharacters),
    taxonomies,
  };
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US').normalize('NFKC');
}

function matchesTaxonomies(document: SearchDocument, selected: Record<string, string[]>): boolean {
  return Object.entries(selected).every(([taxonomyId, terms]) =>
    terms.some((term) => document.taxonomies[taxonomyId]?.includes(term)),
  );
}
function safeAdapterFacets(
  hits: SearchResponse['hits'],
  taxonomies: TaxonomyDefinition[],
): SearchFacet[] {
  return taxonomies.flatMap((taxonomy) => {
    const counts = new Map<string, number>();
    hits.forEach((hit) => {
      hit.taxonomies[taxonomy.id]?.forEach((term) => {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      });
    });
    const terms = taxonomy.terms
      .map((term) => ({ ...term, count: counts.get(term.id) ?? 0 }))
      .filter((term) => term.count > 0);
    return terms.length ? [{ taxonomyId: taxonomy.id, label: taxonomy.name, terms }] : [];
  });
}

export class RepositorySearchAdapter implements SearchAdapter {
  readonly name = 'repository-scan';
  readonly #repository: ContentRepository;
  readonly #taxonomyBindings: TaxonomyBinding[];
  readonly #lastRebuiltAt = new Map<string, string>();

  constructor(input: {
    repository: ContentRepository;
    taxonomyBindings: TaxonomyBinding[];
  }) {
    this.#repository = input.repository;
    this.#taxonomyBindings = input.taxonomyBindings;
  }

  async search(input: {
    scope: ContentScope;
    query: ParsedSearchQuery;
    taxonomies: TaxonomyDefinition[];
  }): Promise<SearchAdapterResult> {
    const entries = await this.#repository.list({
      scope: input.scope,
      perspective: input.query.perspective,
    });
    const terms = normalize(input.query.text).split(/\s+/).filter(Boolean).slice(0, 20);
    const rows = entries
      .filter(
        (entry) =>
          input.query.contentTypes.length === 0 ||
          input.query.contentTypes.includes(entry.contentType),
      )
      .map((entry) => ({
        entry,
        document: buildSearchDocument({
          entry,
          perspective: input.query.perspective,
          taxonomies: input.taxonomies,
          taxonomyBindings: this.#taxonomyBindings,
        }),
      }))
      .filter(({ document }) => matchesTaxonomies(document, input.query.taxonomies))
      .map(({ entry, document }) => {
        const normalized = normalize(document.text);
        const matched = terms.filter((term) => normalized.includes(term));
        if (terms.length && matched.length !== terms.length) return null;
        const title = stringsAt(entry.data.title)[0] ?? stringsAt(entry.data.name)[0] ?? entry.id;
        const titleText = normalize(title);
        const score =
          terms.length === 0
            ? 1
            : matched.reduce((total, term) => total + 1 + (titleText.includes(term) ? 3 : 0), 0);
        return {
          entry,
          document,
          hit: {
            entryId: entry.id,
            score,
            highlights: matched.slice(0, 5),
            taxonomies: document.taxonomies,
          },
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort(
        (left, right) =>
          right.hit.score - left.hit.score ||
          right.entry.updatedAt.localeCompare(left.entry.updatedAt) ||
          left.entry.id.localeCompare(right.entry.id),
      );
    const facets = input.taxonomies.map((taxonomy) => {
      const counts = new Map<string, number>();
      rows.forEach(({ document }) => {
        document.taxonomies[taxonomy.id]?.forEach((term) => {
          counts.set(term, (counts.get(term) ?? 0) + 1);
        });
      });
      return {
        taxonomyId: taxonomy.id,
        label: taxonomy.name,
        terms: taxonomy.terms
          .map((term) => ({ ...term, count: counts.get(term.id) ?? 0 }))
          .filter((term) => term.count > 0)
          .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
      };
    });
    return {
      scope: input.scope,
      perspective: input.query.perspective,
      hits: rows.slice(0, input.query.first).map((row) => row.hit),
      facets,
      total: rows.length,
    };
  }

  upsert(_document: SearchDocument): void {}

  rebuild(input: { scope: ContentScope; perspective: ContentPerspective }): void {
    this.#lastRebuiltAt.set(
      `${contentScopeKey(input.scope)}:${input.perspective}`,
      new Date().toISOString(),
    );
  }

  async status(scope: ContentScope): Promise<SearchAdapterStatus> {
    const [draft, published] = await Promise.all([
      this.#repository.list({ scope, perspective: 'draft' }),
      this.#repository.list({ scope, perspective: 'published' }),
    ]);
    const rebuilt = ['draft', 'published']
      .map((perspective) => this.#lastRebuiltAt.get(`${contentScopeKey(scope)}:${perspective}`))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return {
      scope,
      state: 'ready',
      draftDocuments: draft.length,
      publishedDocuments: published.length,
      ...(rebuilt ? { lastRebuiltAt: rebuilt } : {}),
    };
  }
}

export interface SearchServiceOptions {
  repository: ContentRepository;
  schemas: ContentSchemaDefinition[];
  adapter?: SearchAdapter;
  taxonomies?: TaxonomyDefinition[];
  now?: () => Date;
  createId?: () => string;
  telemetry?: TenantTelemetrySink;
}

export class SearchService {
  readonly #repository: ContentRepository;
  readonly #schemas: Map<string, ContentSchemaDefinition>;
  readonly #adapter: SearchAdapter;
  readonly #taxonomies: TaxonomyDefinition[];
  readonly #taxonomyBindings: TaxonomyBinding[];
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #telemetry: TenantTelemetrySink | undefined;

  constructor(input: SearchServiceOptions) {
    this.#repository = input.repository;
    this.#schemas = new Map(input.schemas.map((schema) => [schema.id, schema]));
    this.#taxonomies = input.taxonomies ?? deriveTaxonomies(input.schemas);
    this.#taxonomyBindings = deriveTaxonomyBindings(input.schemas);
    this.#adapter =
      input.adapter ??
      new RepositorySearchAdapter({
        repository: input.repository,
        taxonomyBindings: this.#taxonomyBindings,
      });
    this.#now = input.now ?? (() => new Date());
    this.#createId = input.createId ?? (() => crypto.randomUUID());
    this.#telemetry = input.telemetry;
  }

  listTaxonomies(): TaxonomyDefinition[] {
    return structuredClone(this.#taxonomies);
  }

  async search(scope: ContentScope, query: SearchQuery): Promise<SearchResponse> {
    const parsed = searchQuerySchema.parse(query);
    const result = await this.#adapter.search({
      scope,
      query: parsed,
      taxonomies: this.#taxonomies,
    });
    assertSameContentScope(scope, result.scope, 'search adapter result');
    if (result.perspective !== parsed.perspective) {
      throw new Error('Search adapter returned a different content perspective.');
    }
    if (
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      result.hits.length > parsed.first ||
      result.total < result.hits.length
    ) {
      throw new Error('Search adapter returned invalid bounded result metadata.');
    }
    const hits: SearchResponse['hits'] = [];
    const seenEntryIds = new Set<string>();
    const highlightTerms = normalize(parsed.text).split(/\s+/).filter(Boolean).slice(0, 20);
    for (const hit of result.hits) {
      if (!hit.entryId || !Number.isFinite(hit.score)) {
        throw new Error('Search adapter returned an invalid hit.');
      }
      if (seenEntryIds.has(hit.entryId)) continue;
      seenEntryIds.add(hit.entryId);
      const entry = await this.#repository.getById({
        scope,
        id: hit.entryId,
        perspective: parsed.perspective,
      });
      if (!entry) continue;
      assertSameContentScope(scope, entry, 'search result repository lookup');
      const document = buildSearchDocument({
        entry,
        perspective: parsed.perspective,
        taxonomies: this.#taxonomies,
        taxonomyBindings: this.#taxonomyBindings,
      });
      const normalizedText = normalize(document.text);
      hits.push({
        entry,
        score: hit.score,
        highlights: highlightTerms.filter((term) => normalizedText.includes(term)).slice(0, 5),
        taxonomies: document.taxonomies,
      });
    }
    const response = {
      hits,
      facets: safeAdapterFacets(hits, this.#taxonomies),
      total: hits.length,
    };
    await emitTenantTelemetry(this.#telemetry, {
      scope,
      name: 'search.query.completed',
      outcome: 'success',
      metadata: {
        perspective: parsed.perspective,
        returnedHits: hits.length,
        totalHits: response.total,
      },
    });
    return response;
  }

  async backlinks(
    scope: ContentScope,
    targetEntryId: string,
    perspective: ContentPerspective = 'published',
  ): Promise<BacklinkRecord[]> {
    const entries = await this.#repository.list({ scope, perspective });
    entries.forEach((entry) => {
      assertSameContentScope(scope, entry, 'search backlinks repository list');
    });
    return entries.flatMap((entry) => {
      const schema = this.#schemas.get(entry.contentType);
      if (!schema) return [];
      const paths = collectContentReferences(schema, entry.data)
        .filter(({ reference }) => reference.id === targetEntryId)
        .map(({ path }) => path);
      return paths.length ? [{ source: entry, targetEntryId, paths }] : [];
    });
  }

  async related(
    scope: ContentScope,
    entryId: string,
    perspective: ContentPerspective = 'published',
    first = 10,
  ): Promise<RelatedContentRecord[]> {
    const target = await this.#repository.getById({ scope, id: entryId, perspective });
    if (!target) throw new NotFoundError('Content entry was not found.');
    assertSameContentScope(scope, target, 'search related repository get');
    const entries = await this.#repository.list({ scope, perspective });
    entries.forEach((entry) => {
      assertSameContentScope(scope, entry, 'search related repository list');
    });
    const targetSchema = this.#schemas.get(target.contentType);
    const outgoing = new Set(
      targetSchema
        ? collectContentReferences(targetSchema, target.data).map(({ reference }) => reference.id)
        : [],
    );
    const inbound = new Set(
      (await this.backlinks(scope, entryId, perspective)).map(({ source }) => source.id),
    );
    const targetDocument = buildSearchDocument({
      entry: target,
      perspective,
      taxonomies: this.#taxonomies,
      taxonomyBindings: this.#taxonomyBindings,
    });
    return entries
      .filter((entry) => entry.id !== entryId)
      .map((entry) => {
        const reasons: string[] = [];
        let score = 0;
        if (outgoing.has(entry.id)) {
          score += 4;
          reasons.push('Referenced by this entry');
        }
        if (inbound.has(entry.id)) {
          score += 4;
          reasons.push('Links to this entry');
        }
        const document = buildSearchDocument({
          entry,
          perspective,
          taxonomies: this.#taxonomies,
          taxonomyBindings: this.#taxonomyBindings,
        });
        for (const [taxonomyId, terms] of Object.entries(targetDocument.taxonomies)) {
          const shared = terms.filter((term) => document.taxonomies[taxonomyId]?.includes(term));
          if (shared.length) {
            score += shared.length * 2;
            reasons.push(`Shared ${taxonomyId}: ${shared.join(', ')}`);
          }
        }
        if (entry.contentType === target.contentType) {
          score += 1;
          reasons.push(`Same content type: ${entry.contentType}`);
        }
        return { entry, score, reasons };
      })
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.entry.updatedAt.localeCompare(left.entry.updatedAt) ||
          left.entry.id.localeCompare(right.entry.id),
      )
      .slice(0, Math.max(1, Math.min(first, resourceLimits.search.maximumReturnedResults)));
  }

  async requestRebuild(
    scope: ContentScope,
    perspective: ContentPerspective = 'published',
  ): Promise<DurableJob> {
    const job = await this.#repository.enqueueJob({
      scope,
      type: 'search.rebuild',
      idempotencyKey: `search:rebuild:${perspective}:${this.#createId()}`,
      payload: { perspective },
      runAt: this.#now().toISOString(),
      maxAttempts: 5,
    });
    assertSameContentScope(scope, job, 'search rebuild job enqueue');
    return job;
  }

  async processJob(input: {
    scope: ContentScope;
    type: 'search.index' | 'search.rebuild';
    payload: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (input.type === 'search.rebuild') {
      const perspective = input.payload.perspective === 'draft' ? 'draft' : 'published';
      const entries = await this.#repository.list({ scope: input.scope, perspective });
      entries.forEach((entry) => {
        assertSameContentScope(input.scope, entry, 'search rebuild repository list');
      });
      const documents = entries.map((entry) =>
        buildSearchDocument({
          entry,
          perspective,
          taxonomies: this.#taxonomies,
          taxonomyBindings: this.#taxonomyBindings,
        }),
      );
      await this.#adapter.rebuild({ scope: input.scope, perspective, documents });
      return { perspective, indexedDocuments: documents.length };
    }
    const eventType = typeof input.payload.eventType === 'string' ? input.payload.eventType : '';
    const entryId = typeof input.payload.entryId === 'string' ? input.payload.entryId : '';
    const perspectives: ContentPerspective[] =
      eventType === 'content.published' ? ['draft', 'published'] : ['draft'];
    let indexedDocuments = 0;
    for (const perspective of perspectives) {
      const entry = await this.#repository.getById({
        scope: input.scope,
        id: entryId,
        perspective,
      });
      if (!entry) continue;
      assertSameContentScope(input.scope, entry, 'search index repository get');
      await this.#adapter.upsert(
        buildSearchDocument({
          entry,
          perspective,
          taxonomies: this.#taxonomies,
          taxonomyBindings: this.#taxonomyBindings,
        }),
      );
      indexedDocuments += 1;
    }
    return { eventType, entryId, indexedDocuments };
  }

  async status(scope: ContentScope): Promise<SearchIndexStatus> {
    const [adapter, jobs] = await Promise.all([
      this.#adapter.status(scope),
      this.#repository.listJobs({ scope, limit: 1000 }),
    ]);
    assertSameContentScope(scope, adapter.scope, 'search adapter status');
    jobs.forEach((job) => {
      assertSameContentScope(scope, job, 'search status job list');
    });
    const adapterStatus: Omit<SearchAdapterStatus, 'scope'> = {
      state: adapter.state,
      draftDocuments: adapter.draftDocuments,
      publishedDocuments: adapter.publishedDocuments,
      ...(adapter.lastRebuiltAt ? { lastRebuiltAt: adapter.lastRebuiltAt } : {}),
    };
    const searchJobs = jobs.filter(
      (job) => job.type === 'search.index' || job.type === 'search.rebuild',
    );
    return {
      ...scope,
      adapter: this.#adapter.name,
      ...adapterStatus,
      state: searchJobs.some((job) => job.state === 'dead') ? 'degraded' : adapter.state,
      pendingJobs: searchJobs.filter((job) => job.state === 'pending' || job.state === 'processing')
        .length,
      deadJobs: searchJobs.filter((job) => job.state === 'dead').length,
    };
  }
}
