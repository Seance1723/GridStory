import type { ContentEntry, ContentPerspective } from './content.js';

export const contentFilterOperators = [
  'eq',
  'ne',
  'in',
  'notIn',
  'contains',
  'startsWith',
  'endsWith',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
] as const;

export type ContentFilterOperator = (typeof contentFilterOperators)[number];

export interface ContentFilterPredicate {
  path: string;
  operator: ContentFilterOperator;
  value?: unknown;
  caseSensitive?: boolean;
}

export type ContentFilter =
  | ContentFilterPredicate
  | { and: ContentFilter[] }
  | { or: ContentFilter[] }
  | { not: ContentFilter };

export interface ContentSort {
  path: string;
  direction?: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface ContentQuery {
  contentType?: string;
  perspective?: ContentPerspective;
  filter?: ContentFilter;
  sort?: ContentSort[];
  first?: number;
  after?: string;
  projection?: string[];
}

export interface ContentEdge {
  cursor: string;
  node: ContentEntry;
}

export interface ContentPageInfo {
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ContentConnection {
  edges: ContentEdge[];
  nodes: ContentEntry[];
  pageInfo: ContentPageInfo;
  totalCount: number;
}
