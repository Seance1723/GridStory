import { describe, expect, it } from 'vitest';
import { componentNodeSchema, designSystemManifestSchema } from '../src/index.js';

const node = {
  id: 'hero-1',
  component: 'gridstory.hero',
  version: 1,
  props: { heading: 'Hello', tone: 'indigo' },
};

describe('design system contracts', () => {
  it('normalizes governed tokens, breakpoints, variants, symbols, and templates', () => {
    const parsed = designSystemManifestSchema.parse({
      id: 'example',
      version: 1,
      name: 'Example',
      tokens: [{ id: 'color.brand', name: 'Brand', category: 'color', value: '#4338ca' }],
      breakpoints: [
        { id: 'mobile', name: 'Mobile', minWidth: 0 },
        { id: 'desktop', name: 'Desktop', minWidth: 1024 },
      ],
      variants: [
        {
          id: 'hero.sunrise',
          name: 'Sunrise hero',
          component: 'gridstory.hero',
          props: { tone: 'sunrise' },
        },
      ],
      symbols: [{ id: 'hero.brand', name: 'Brand hero', node, allowedPropOverrides: ['heading'] }],
      templates: [{ id: 'landing', name: 'Landing page', nodes: [node] }],
    });

    expect(parsed.tokens[0]?.description).toBe('');
    expect(parsed.templates[0]?.category).toBe('General');
    expect(parsed.symbols[0]?.allowedPropOverrides).toEqual(['heading']);
  });

  it('rejects duplicate IDs and unordered responsive breakpoints', () => {
    const parsed = designSystemManifestSchema.safeParse({
      id: 'invalid',
      version: 1,
      name: 'Invalid',
      tokens: [
        { id: 'space.small', name: 'Small', category: 'spacing', value: 8 },
        { id: 'space.small', name: 'Duplicate', category: 'spacing', value: 12 },
      ],
      breakpoints: [
        { id: 'desktop', name: 'Desktop', minWidth: 1024 },
        { id: 'mobile', name: 'Mobile', minWidth: 0 },
      ],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['tokens.1.id', 'breakpoints']),
    );
  });

  it('preserves node-level variant, token, responsive, and symbol bindings', () => {
    const parsed = componentNodeSchema.parse({
      ...node,
      presentation: {
        designSystemVersion: 1,
        variantId: 'hero.sunrise',
        tokenBindings: { tone: 'color.brand' },
        responsive: { heading: { mobile: 'Short', desktop: 'A longer desktop heading' } },
        symbol: { id: 'hero.brand' },
      },
    });

    expect(parsed.presentation?.responsive?.heading?.desktop).toBe('A longer desktop heading');
    expect(parsed.presentation?.symbol?.detached).toBeUndefined();
    expect(
      componentNodeSchema.safeParse({
        ...node,
        presentation: { variantId: 'hero.sunrise' },
      }).success,
    ).toBe(false);
  });
});
