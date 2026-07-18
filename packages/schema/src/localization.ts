import type { ContentEntry, ContentPerspective, ContentStatus } from './content.js';

export interface LocalizedContentResolution {
  requestedLocale: string;
  resolvedLocale: string;
  fallbackChain: string[];
  usedFallback: boolean;
  perspective: ContentPerspective;
  entry: ContentEntry;
}

export interface TranslationLocaleCompleteness {
  locale: string;
  required: boolean;
  exists: boolean;
  status: ContentStatus | 'missing';
  translatedFields: number;
  totalFields: number;
  percentage: number;
  missingFields: string[];
  route?: string;
  entryId?: string;
}

export interface TranslationCompletenessReport {
  translationGroupId: string;
  sourceEntryId: string;
  contentType: string;
  localizedFields: string[];
  requiredLocales: string[];
  translatedFields: number;
  totalFields: number;
  percentage: number;
  publicationComplete: boolean;
  locales: TranslationLocaleCompleteness[];
}
