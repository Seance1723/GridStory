import type { ContentScope } from './context.js';

export type ContentPerspective = 'draft' | 'published';
export type ContentStatus = 'draft' | 'published' | 'changed';

export interface ContentEntry<TData extends Record<string, unknown> = Record<string, unknown>>
  extends ContentScope {
  id: string;
  contentType: string;
  status: ContentStatus;
  draftRevisionId: string;
  publishedRevisionId?: string;
  createdAt: string;
  updatedAt: string;
  data: TData;
}

export interface ContentRevision<TData extends Record<string, unknown> = Record<string, unknown>>
  extends ContentScope {
  id: string;
  entryId: string;
  sequence: number;
  baseRevisionId?: string;
  createdAt: string;
  actorId: string;
  data: TData;
}
