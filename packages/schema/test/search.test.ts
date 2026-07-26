import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from '../src/index.js';

describe('search contracts', () => {
  it('normalizes bounded search inputs and taxonomy filters', () => {
    expect(
      searchQuerySchema.parse({ text: 'Launch plan', taxonomies: { topics: ['product'] } }),
    ).toEqual({
      text: 'Launch plan',
      perspective: 'published',
      contentTypes: [],
      taxonomies: { topics: ['product'] },
      first: 20,
    });
  });

  it('rejects unbounded search input', () => {
    expect(() => searchQuerySchema.parse({ text: 'x'.repeat(501) })).toThrow();
    expect(() => searchQuerySchema.parse({ first: 101 })).toThrow();
  });
});
