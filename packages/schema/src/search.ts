import { z } from 'zod';
import type { ContentEntry, ContentPerspective } from './content.js';
import type { ContentScope } from './context.js';

export const searchQuerySchema = z.object({
  text: z.string().max(500).default(''),
  perspective: z.enum(['draft', 'published']).default('published'),
  contentTypes: z.array(z.string().min(1).max(100)).max(50).default([]),
  taxonomies: z
    .record(z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(50))
    .default({}),
  first: z.number().int().min(1).max(100).default(20),
});

export interface SearchHit {
  entry: ContentEntry;
  score: number;
  highlights: string[];
  taxonomies: Record<string, string[]>;
}

export interface SearchFacetTerm {
  id: string;
  label: string;
  count: number;
}

export interface SearchFacet {
  taxonomyId: string;
  label: string;
  terms: SearchFacetTerm[];
}

export interface SearchResponse {
  hits: SearchHit[];
  facets: SearchFacet[];
  total: number;
}

export interface BacklinkRecord {
  source: ContentEntry;
  targetEntryId: string;
  paths: Array<Array<string | number>>;
}

export interface RelatedContentRecord {
  entry: ContentEntry;
  score: number;
  reasons: string[];
}

export interface SearchIndexStatus extends ContentScope {
  adapter: string;
  state: 'ready' | 'rebuilding' | 'degraded';
  draftDocuments: number;
  publishedDocuments: number;
  pendingJobs: number;
  deadJobs: number;
  lastRebuiltAt?: string;
}

export type SearchQuery = z.input<typeof searchQuerySchema>;
export type ParsedSearchQuery = z.output<typeof searchQuerySchema>;

export interface SearchDocument extends ContentScope {
  entryId: string;
  contentType: string;
  perspective: ContentPerspective;
  revisionId: string;
  updatedAt: string;
  text: string;
  taxonomies: Record<string, string[]>;
}
