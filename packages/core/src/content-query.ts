import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ContentConnection,
  ContentEntry,
  ContentFilter,
  ContentQuery,
  ContentSort,
} from '@gridstory/schema';
import { contentFilterOperators, resourceLimits } from '@gridstory/schema';
import { GridStoryError } from './errors.js';
import type { ContentRepository, PublishedContentReader } from './types.js';

const forbiddenPathSegments = new Set(['__proto__', 'prototype', 'constructor']);
const systemPaths = new Set([
  'id',
  'contentType',
  'status',
  'draftRevisionId',
  'publishedRevisionId',
  'createdAt',
  'updatedAt',
]);
const operatorSet = new Set<string>(contentFilterOperators);
const defaultSort: ContentSort[] = [{ path: 'updatedAt', direction: 'desc', nulls: 'last' }];

interface CursorPayload {
  v: 1;
  query: string;
  values: unknown[];
  id: string;
}

export interface ContentQueryServiceOptions {
  repository: ContentRepository;
  cursorSecret: string;
}

function invalidQuery(message: string, details?: unknown): never {
  throw new GridStoryError(message, 'invalid_query', 400, details);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function pathSegments(path: string, projection = false): string[] {
  if (!path || path.length > resourceLimits.contentQuery.maximumPathCharacters) {
    invalidQuery(
      `Query paths must contain 1 to ${resourceLimits.contentQuery.maximumPathCharacters} characters.`,
    );
  }
  const segments = path.split('.');
  if (
    segments.some(
      (segment) =>
        !segment || forbiddenPathSegments.has(segment) || !/^[A-Za-z0-9_-]+$/.test(segment),
    )
  ) {
    invalidQuery(`Query path ${path} is invalid.`);
  }
  if (projection && segments[0] !== 'data') {
    invalidQuery('Projection paths must start with data.');
  }
  if (!projection && segments[0] !== 'data' && !systemPaths.has(path)) {
    invalidQuery(`Query path ${path} is not an allowed system or data path.`);
  }
  return segments;
}

function valueAt(entry: ContentEntry, path: string): unknown {
  const segments = pathSegments(path);
  let value: unknown = entry;
  for (const segment of segments) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if (!Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function normalizedText(value: unknown, caseSensitive = false): string {
  const text = typeof value === 'string' ? value : String(value);
  return caseSensitive ? text : text.toLocaleLowerCase('en-US');
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function compareValues(left: unknown, right: unknown): number {
  if (sameValue(left, right)) return 0;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left ? 1 : -1;
  return normalizedText(left, true).localeCompare(normalizedText(right, true), 'en-US');
}

function predicateMatches(
  entry: ContentEntry,
  filter: Exclude<
    ContentFilter,
    { and: ContentFilter[] } | { or: ContentFilter[] } | { not: ContentFilter }
  >,
): boolean {
  const actual = valueAt(entry, filter.path);
  const expected = filter.value;
  const operator = filter.operator;
  if (operator === 'exists')
    return expected === false ? actual === undefined : actual !== undefined;
  if (operator === 'eq') return sameValue(actual, expected);
  if (operator === 'ne') return !sameValue(actual, expected);
  if (operator === 'in' || operator === 'notIn') {
    const values = Array.isArray(expected) ? expected : [];
    const included = values.some((value) => sameValue(actual, value));
    return operator === 'in' ? included : !included;
  }
  if (actual === undefined || actual === null) return false;
  if (operator === 'contains') {
    if (Array.isArray(actual)) return actual.some((value) => sameValue(value, expected));
    return normalizedText(actual, filter.caseSensitive).includes(
      normalizedText(expected, filter.caseSensitive),
    );
  }
  if (operator === 'startsWith')
    return normalizedText(actual, filter.caseSensitive).startsWith(
      normalizedText(expected, filter.caseSensitive),
    );
  if (operator === 'endsWith')
    return normalizedText(actual, filter.caseSensitive).endsWith(
      normalizedText(expected, filter.caseSensitive),
    );
  const comparison = compareValues(actual, expected);
  if (operator === 'gt') return comparison > 0;
  if (operator === 'gte') return comparison >= 0;
  if (operator === 'lt') return comparison < 0;
  return comparison <= 0;
}

function validateFilter(filter: ContentFilter, depth = 1, state = { predicates: 0 }): void {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    invalidQuery('Every filter must be an object.');
  }
  if (depth > resourceLimits.contentQuery.maximumFilterDepth) {
    invalidQuery(
      `Filter nesting cannot exceed ${resourceLimits.contentQuery.maximumFilterDepth} levels.`,
    );
  }
  if ('and' in filter || 'or' in filter) {
    const children = 'and' in filter ? filter.and : filter.or;
    if (
      !Array.isArray(children) ||
      children.length < 1 ||
      children.length > resourceLimits.contentQuery.maximumBooleanGroupSize
    ) {
      invalidQuery(
        `Boolean filter groups must contain 1 to ${resourceLimits.contentQuery.maximumBooleanGroupSize} filters.`,
      );
    }
    children.forEach((child) => {
      validateFilter(child, depth + 1, state);
    });
    return;
  }
  if ('not' in filter) {
    validateFilter(filter.not, depth + 1, state);
    return;
  }
  state.predicates += 1;
  if (state.predicates > resourceLimits.contentQuery.maximumPredicates) {
    invalidQuery(
      `A query cannot contain more than ${resourceLimits.contentQuery.maximumPredicates} predicates.`,
    );
  }
  if (typeof filter.path !== 'string') invalidQuery('Every predicate requires a string path.');
  pathSegments(filter.path);
  if (typeof filter.operator !== 'string' || !operatorSet.has(filter.operator))
    invalidQuery(`Filter operator ${String(filter.operator)} is invalid.`);
  if (
    (filter.operator === 'in' || filter.operator === 'notIn') &&
    (!Array.isArray(filter.value) ||
      filter.value.length > resourceLimits.contentQuery.maximumSetValues)
  ) {
    invalidQuery(
      `${filter.operator} requires an array with at most ${resourceLimits.contentQuery.maximumSetValues} values.`,
    );
  }
}

function matches(entry: ContentEntry, filter: ContentFilter): boolean {
  if ('and' in filter) return filter.and.every((child) => matches(entry, child));
  if ('or' in filter) return filter.or.some((child) => matches(entry, child));
  if ('not' in filter) return !matches(entry, filter.not);
  return predicateMatches(entry, filter);
}

function normalizedSort(sort: ContentSort[] | undefined): Required<ContentSort>[] {
  const selected = sort?.length ? sort : defaultSort;
  if (!Array.isArray(selected)) invalidQuery('sort must be an array.');
  if (selected.length > resourceLimits.contentQuery.maximumSortFields) {
    invalidQuery(
      `A query cannot contain more than ${resourceLimits.contentQuery.maximumSortFields} sort fields.`,
    );
  }
  const normalized: Required<ContentSort>[] = selected.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.path !== 'string') {
      invalidQuery('Every sort rule requires a string path.');
    }
    pathSegments(item.path);
    if (item.direction && item.direction !== 'asc' && item.direction !== 'desc')
      invalidQuery(`Sort direction ${item.direction} is invalid.`);
    if (item.nulls && item.nulls !== 'first' && item.nulls !== 'last')
      invalidQuery(`Null placement ${item.nulls} is invalid.`);
    return {
      path: item.path,
      direction: item.direction ?? 'asc',
      nulls: item.nulls ?? 'last',
    } satisfies Required<ContentSort>;
  });
  if (!normalized.some((item) => item.path === 'id')) {
    normalized.push({ path: 'id', direction: 'asc', nulls: 'last' });
  }
  return normalized;
}

function compareTuple(
  left: { values: unknown[]; id: string },
  right: { values: unknown[]; id: string },
  sort: Required<ContentSort>[],
): number {
  for (let index = 0; index < sort.length; index += 1) {
    const rule = sort[index];
    const leftValue = left.values[index];
    const rightValue = right.values[index];
    if (
      leftValue === undefined ||
      leftValue === null ||
      rightValue === undefined ||
      rightValue === null
    ) {
      if (
        (leftValue === undefined || leftValue === null) &&
        (rightValue === undefined || rightValue === null)
      )
        continue;
      const nullOrder = rule?.nulls === 'first' ? -1 : 1;
      return leftValue === undefined || leftValue === null ? nullOrder : -nullOrder;
    }
    const compared = compareValues(leftValue, rightValue);
    if (compared !== 0) return rule?.direction === 'desc' ? -compared : compared;
  }
  return left.id.localeCompare(right.id, 'en-US');
}

function setProjected(target: Record<string, unknown>, segments: string[], value: unknown): void {
  let cursor = target;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    if (index === segments.length - 1) {
      cursor[segment] = value;
    } else {
      const next = cursor[segment];
      if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
  }
}

function project(entry: ContentEntry, projection: string[] | undefined): ContentEntry {
  if (!projection?.length) return entry;
  if (projection.length > resourceLimits.contentQuery.maximumProjectionFields) {
    invalidQuery(
      `A projection cannot contain more than ${resourceLimits.contentQuery.maximumProjectionFields} fields.`,
    );
  }
  const data: Record<string, unknown> = {};
  for (const path of projection) {
    const segments = pathSegments(path, true).slice(1);
    const value = valueAt(entry, path);
    if (value !== undefined) setProjected(data, segments, value);
  }
  return { ...entry, data };
}

export class ContentQueryService {
  readonly #repository: ContentRepository;
  readonly #cursorSecret: string;

  constructor({ repository, cursorSecret }: ContentQueryServiceOptions) {
    if (cursorSecret.length < 16)
      invalidQuery('The cursor signing secret must contain at least 16 characters.');
    this.#repository = repository;
    this.#cursorSecret = cursorSecret;
  }

  #signature(payload: string): string {
    return createHmac('sha256', this.#cursorSecret).update(payload).digest('base64url');
  }

  #encodeCursor(payload: CursorPayload): string {
    const encoded = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
    return `${encoded}.${this.#signature(encoded)}`;
  }

  #decodeCursor(cursor: string, queryFingerprint: string): CursorPayload {
    const [encoded, signature, extra] = cursor.split('.');
    if (!encoded || !signature || extra) invalidQuery('The pagination cursor is malformed.');
    const actual = Buffer.from(signature);
    const expected = Buffer.from(this.#signature(encoded));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      invalidQuery('The pagination cursor signature is invalid.');
    }
    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as CursorPayload;
      if (
        parsed.v !== 1 ||
        parsed.query !== queryFingerprint ||
        !Array.isArray(parsed.values) ||
        typeof parsed.id !== 'string'
      ) {
        invalidQuery('The pagination cursor does not belong to this query.');
      }
      return parsed;
    } catch (error) {
      if (error instanceof GridStoryError) throw error;
      return invalidQuery('The pagination cursor payload is invalid.');
    }
  }

  async query(
    scope: Parameters<ContentRepository['list']>[0]['scope'],
    input: ContentQuery,
    publishedReader?: PublishedContentReader,
  ): Promise<ContentConnection> {
    if (input.perspective && input.perspective !== 'draft' && input.perspective !== 'published') {
      invalidQuery('perspective must be draft or published.');
    }
    if (
      input.contentType !== undefined &&
      (typeof input.contentType !== 'string' || !input.contentType)
    ) {
      invalidQuery('contentType must be a non-empty string.');
    }
    if (input.after !== undefined && typeof input.after !== 'string') {
      invalidQuery('after must be a string cursor.');
    }
    const first = input.first ?? 20;
    if (
      !Number.isInteger(first) ||
      first < 1 ||
      first > resourceLimits.contentQuery.maximumPageSize
    ) {
      invalidQuery(
        `first must be an integer between 1 and ${resourceLimits.contentQuery.maximumPageSize}.`,
      );
    }
    if (input.filter) validateFilter(input.filter);
    const sort = normalizedSort(input.sort);
    if (input.projection) {
      if (!Array.isArray(input.projection)) invalidQuery('projection must be an array.');
      input.projection.forEach((path) => {
        if (typeof path !== 'string') invalidQuery('Every projection path must be a string.');
        pathSegments(path, true);
      });
    }
    const perspective = input.perspective ?? 'draft';
    const queryFingerprint = this.#signature(
      canonicalJson({
        contentType: input.contentType ?? null,
        perspective,
        filter: input.filter ?? null,
        sort,
        projection: input.projection ?? null,
      }),
    );
    const entries =
      perspective === 'published' && publishedReader
        ? await publishedReader.list({
            scope,
            perspective: 'published',
            ...(input.contentType ? { contentType: input.contentType } : {}),
          })
        : await this.#repository.list({
            scope,
            perspective,
            ...(input.contentType ? { contentType: input.contentType } : {}),
          });
    const filtered = input.filter
      ? entries.filter((entry) => matches(entry, input.filter as ContentFilter))
      : entries;
    const rows = filtered
      .map((entry) => ({
        entry,
        values: sort.map((item) => valueAt(entry, item.path)),
        id: entry.id,
      }))
      .sort((left, right) => compareTuple(left, right, sort));
    const after = input.after ? this.#decodeCursor(input.after, queryFingerprint) : undefined;
    const available = after
      ? rows.filter((row) => compareTuple(row, { values: after.values, id: after.id }, sort) > 0)
      : rows;
    const page = available.slice(0, first);
    const hasNextPage = available.length > first;
    const edges = page.map((row) => ({
      cursor: this.#encodeCursor({ v: 1, query: queryFingerprint, values: row.values, id: row.id }),
      node: project(row.entry, input.projection),
    }));
    return {
      edges,
      nodes: edges.map((edge) => edge.node),
      pageInfo: {
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges.at(-1)?.cursor ?? null,
        hasNextPage,
        hasPreviousPage: Boolean(after),
      },
      totalCount: rows.length,
    };
  }
}
