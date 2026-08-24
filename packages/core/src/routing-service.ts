import {
  RedirectResolver,
  buildContentRoute,
  normalizeRoutePath,
  type ContentEntry,
  type ContentScope,
  type RedirectDefinition,
} from '@gridstory/schema';
import { ConflictError, NotFoundError } from './errors.js';
import type { ContentService } from './content-service.js';
import type { PublishedContentReader } from './types.js';

export type ContentRouteResolution =
  | { kind: 'content'; path: string; entry: ContentEntry }
  | { kind: 'redirect'; path: string; location: string; status: RedirectDefinition['status'] };

export interface ContentRoutingServiceOptions {
  contentService: ContentService;
  redirects?: RedirectDefinition[];
}

export class ContentRoutingService {
  readonly #contentService: ContentService;
  readonly #redirects: RedirectResolver;

  constructor({ contentService, redirects = [] }: ContentRoutingServiceOptions) {
    this.#contentService = contentService;
    this.#redirects = new RedirectResolver(redirects);
  }

  async resolve(
    scope: ContentScope,
    inputPath: string,
    publishedReader?: PublishedContentReader,
  ): Promise<ContentRouteResolution> {
    const path = normalizeRoutePath(inputPath);
    const redirect = this.#redirects.resolve(path);
    if (redirect) {
      return { kind: 'redirect', path, location: redirect.to, status: redirect.status };
    }

    const matches: ContentEntry[] = [];
    for (const schema of this.#contentService.getSchemas()) {
      if (!schema.route) continue;
      const entries = publishedReader
        ? await publishedReader.list({ scope, contentType: schema.id, perspective: 'published' })
        : await this.#contentService.list({
            scope,
            contentType: schema.id,
            perspective: 'published',
          });
      for (const entry of entries) {
        if (buildContentRoute(schema, entry.data) === path) matches.push(entry);
      }
    }

    if (matches.length === 0) throw new NotFoundError(`Published route ${path} was not found.`);
    if (matches.length > 1) {
      throw new ConflictError(`Published route ${path} resolves to multiple content entries.`, {
        entryIds: matches.map((entry) => entry.id),
      });
    }
    return { kind: 'content', path, entry: matches[0] as ContentEntry };
  }
}
