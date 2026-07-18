import type { ContentSchemaDefinition, RedirectDefinition } from './contracts.js';
import { contentSchemaDefinitionSchema, redirectDefinitionSchema } from './contracts.js';

export interface RedirectResolution {
  from: string;
  to: string;
  status: RedirectDefinition['status'];
  chain: string[];
}

export function normalizeRoutePath(input: string): string {
  const withoutQuery = input.split(/[?#]/, 1)[0] ?? '';
  const normalized = `/${withoutQuery}`.replace(/\/{2,}/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

export function buildContentRoute(
  schemaInput: ContentSchemaDefinition,
  data: Record<string, unknown>,
): string {
  const schema = contentSchemaDefinitionSchema.parse(schemaInput);
  if (!schema.route) throw new Error(`Content type ${schema.id} does not declare a route.`);

  const route = schema.route.pattern.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, (_, field: string) => {
    const value = data[field];
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
      throw new Error(`Route field ${field} is missing from ${schema.id} content.`);
    }
    return encodeURIComponent(String(value));
  });
  if (route.includes(':')) throw new Error(`Route pattern ${schema.route.pattern} is invalid.`);
  return normalizeRoutePath(route);
}

export class RedirectResolver {
  readonly #redirects: ReadonlyMap<string, RedirectDefinition>;

  constructor(inputs: RedirectDefinition[]) {
    const redirects = new Map<string, RedirectDefinition>();
    for (const input of inputs) {
      const parsed = redirectDefinitionSchema.parse(input);
      const from = normalizeRoutePath(parsed.from);
      const to = normalizeRoutePath(parsed.to);
      if (from === to) throw new Error(`Redirect ${from} cannot target itself.`);
      if (redirects.has(from)) throw new Error(`Redirect source ${from} is duplicated.`);
      redirects.set(from, { ...parsed, from, to });
    }
    this.#redirects = redirects;
    for (const source of redirects.keys()) this.#walk(source);
  }

  #walk(source: string): string[] {
    const chain = [source];
    let current = source;
    while (this.#redirects.has(current)) {
      const next = this.#redirects.get(current)?.to;
      if (!next) break;
      if (chain.includes(next))
        throw new Error(`Redirect cycle detected: ${[...chain, next].join(' -> ')}.`);
      chain.push(next);
      current = next;
    }
    return chain;
  }

  resolve(input: string): RedirectResolution | null {
    const from = normalizeRoutePath(input);
    const first = this.#redirects.get(from);
    if (!first) return null;
    const chain = this.#walk(from);
    return { from, to: chain.at(-1) ?? first.to, status: first.status, chain };
  }
}
