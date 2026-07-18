import type { ContentPerspective, ContentQuery, ContentSort } from '@gridstory/schema';
import { GridStoryError } from '@gridstory/core';

type QueryRecord = Record<string, unknown>;

function invalid(message: string, details?: unknown): never {
  throw new GridStoryError(message, 'invalid_query', 400, details);
}

function record(value: unknown): QueryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('The content query must be an object.');
  }
  return value as QueryRecord;
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return invalid(`${name} must contain valid JSON.`);
  }
}

function parseSortText(value: string): ContentSort[] {
  if (value.trim().startsWith('[')) return parseJson(value, 'sort') as ContentSort[];
  return value
    .split(',')
    .filter(Boolean)
    .map((rule) => {
      const [path, direction, nulls] = rule.split(':');
      if (!path) invalid('Every sort rule requires a path.');
      const parsed: ContentSort = { path };
      if (direction) parsed.direction = direction as 'asc' | 'desc';
      if (nulls) parsed.nulls = nulls as 'first' | 'last';
      return parsed;
    });
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(`${name} must be a string.`);
  return value;
}

export function parseContentQuery(
  value: unknown,
  perspectiveOverride?: ContentPerspective,
): ContentQuery {
  const source = record(value);
  const firstValue = source.first;
  const first =
    typeof firstValue === 'string' && firstValue !== ''
      ? Number(firstValue)
      : (firstValue as number | undefined);
  const filter =
    typeof source.filter === 'string' ? parseJson(source.filter, 'filter') : source.filter;
  const sort =
    typeof source.sort === 'string'
      ? parseSortText(source.sort)
      : (source.sort as ContentSort[] | undefined);
  const projection =
    typeof source.projection === 'string'
      ? source.projection.split(',').filter(Boolean)
      : (source.projection as string[] | undefined);
  const selectedPerspective =
    perspectiveOverride ?? optionalString(source.perspective, 'perspective');
  return {
    ...(optionalString(source.contentType, 'contentType')
      ? { contentType: String(source.contentType) }
      : {}),
    ...(selectedPerspective ? { perspective: selectedPerspective as ContentPerspective } : {}),
    ...(filter !== undefined ? { filter: filter as NonNullable<ContentQuery['filter']> } : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(first !== undefined ? { first } : {}),
    ...(optionalString(source.after, 'after') ? { after: String(source.after) } : {}),
    ...(projection !== undefined ? { projection } : {}),
  };
}
