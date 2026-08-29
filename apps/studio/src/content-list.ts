import type {
  ContentFilter,
  ContentQuery,
  ContentSchemaDefinition,
  StudioContext,
} from '@gridstory/schema';

export const contentListPageSize = 10;
export const contentListViewVersion = 1 as const;

export type ContentListStatus = 'all' | 'draft' | 'published' | 'changed';
export type ContentListSort = 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc';

export interface ContentListViewState {
  search: string;
  status: ContentListStatus;
  sort: ContentListSort;
}

export interface SavedContentListView extends ContentListViewState {
  version: typeof contentListViewVersion;
  id: string;
  name: string;
  contentType: string;
}

const storageKey = 'gridstory-content-list-views.v1';
const statuses = new Set<ContentListStatus>(['all', 'draft', 'published', 'changed']);
const sorts = new Set<ContentListSort>(['updated-desc', 'updated-asc', 'title-asc', 'title-desc']);

export const defaultContentListView: ContentListViewState = {
  search: '',
  status: 'all',
  sort: 'updated-desc',
};

export function contentListScopeKey(scope: StudioContext['scope']): string {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
    scope.locale,
  ]
    .map(encodeURIComponent)
    .join('/');
}

export function buildContentListQuery(input: {
  contentType: string;
  schema: ContentSchemaDefinition;
  view: ContentListViewState;
  after?: string;
}): ContentQuery {
  const predicates: ContentFilter[] = [];
  const search = input.view.search.trim();
  if (search) {
    const slugField = input.schema.fields.find((field) => field.type === 'slug')?.name;
    const paths = [input.schema.titleField, slugField]
      .filter((path): path is string => Boolean(path))
      .filter((path, index, values) => values.indexOf(path) === index);
    predicates.push({
      or: paths.map((path) => ({
        path: `data.${path}`,
        operator: 'contains',
        value: search,
        caseSensitive: false,
      })),
    });
  }
  if (input.view.status !== 'all') {
    predicates.push({ path: 'status', operator: 'eq', value: input.view.status });
  }
  const titlePath = `data.${input.schema.titleField}`;
  const sort =
    input.view.sort === 'updated-asc'
      ? [{ path: 'updatedAt', direction: 'asc' as const }]
      : input.view.sort === 'title-asc'
        ? [{ path: titlePath, direction: 'asc' as const, nulls: 'last' as const }]
        : input.view.sort === 'title-desc'
          ? [{ path: titlePath, direction: 'desc' as const, nulls: 'last' as const }]
          : [{ path: 'updatedAt', direction: 'desc' as const }];
  return {
    contentType: input.contentType,
    perspective: 'draft',
    first: contentListPageSize,
    sort,
    ...(predicates.length === 1
      ? { filter: predicates[0] }
      : predicates.length > 1
        ? { filter: { and: predicates } }
        : {}),
    ...(input.after ? { after: input.after } : {}),
  };
}

type SavedViewEnvelope = {
  version: typeof contentListViewVersion;
  scopes: Record<string, SavedContentListView[]>;
};

function readEnvelope(storage: Pick<Storage, 'getItem'>): SavedViewEnvelope {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? 'null') as Partial<SavedViewEnvelope>;
    if (
      parsed?.version !== contentListViewVersion ||
      !parsed.scopes ||
      typeof parsed.scopes !== 'object'
    )
      return { version: contentListViewVersion, scopes: {} };
    return { version: contentListViewVersion, scopes: parsed.scopes };
  } catch {
    return { version: contentListViewVersion, scopes: {} };
  }
}

function validView(value: unknown): value is SavedContentListView {
  if (!value || typeof value !== 'object') return false;
  const view = value as Partial<SavedContentListView>;
  return (
    view.version === contentListViewVersion &&
    typeof view.id === 'string' &&
    typeof view.name === 'string' &&
    typeof view.contentType === 'string' &&
    typeof view.search === 'string' &&
    statuses.has(view.status as ContentListStatus) &&
    sorts.has(view.sort as ContentListSort)
  );
}

export function loadContentListViews(
  storage: Pick<Storage, 'getItem'>,
  scopeKey: string,
  contentType: string,
): SavedContentListView[] {
  return (readEnvelope(storage).scopes[scopeKey] ?? []).filter(
    (view) => validView(view) && view.contentType === contentType,
  );
}

export function saveContentListView(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  scopeKey: string,
  input: Omit<SavedContentListView, 'version' | 'id'>,
): SavedContentListView[] {
  const envelope = readEnvelope(storage);
  const view: SavedContentListView = {
    ...input,
    version: contentListViewVersion,
    id: `view-${Date.now().toString(36)}`,
  };
  envelope.scopes[scopeKey] = [
    ...(envelope.scopes[scopeKey] ?? []).filter(
      (candidate) => validView(candidate) && candidate.name !== view.name,
    ),
    view,
  ];
  storage.setItem(storageKey, JSON.stringify(envelope));
  return envelope.scopes[scopeKey].filter(
    (candidate) => validView(candidate) && candidate.contentType === input.contentType,
  );
}

export function removeContentListView(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  scopeKey: string,
  id: string,
  contentType: string,
): SavedContentListView[] {
  const envelope = readEnvelope(storage);
  envelope.scopes[scopeKey] = (envelope.scopes[scopeKey] ?? []).filter(
    (candidate) => validView(candidate) && candidate.id !== id,
  );
  storage.setItem(storageKey, JSON.stringify(envelope));
  return envelope.scopes[scopeKey].filter(
    (candidate) => validView(candidate) && candidate.contentType === contentType,
  );
}
