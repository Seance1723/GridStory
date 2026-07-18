import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ComponentNode, DesignSystemManifest } from '@gridstory/schema';
import {
  createComponentRegistry,
  GridStoryRenderer,
  resolveNodePresentation,
} from '../src/index.js';

const designSystem: DesignSystemManifest = {
  id: 'test',
  version: 1,
  name: 'Test',
  tokens: [{ id: 'tone.brand', name: 'Brand', category: 'color', value: 'brand', description: '' }],
  breakpoints: [
    { id: 'mobile', name: 'Mobile', minWidth: 0 },
    { id: 'desktop', name: 'Desktop', minWidth: 1024 },
  ],
  variants: [
    {
      id: 'card.prominent',
      name: 'Prominent',
      component: 'card',
      props: { emphasis: 'high' },
      description: '',
    },
  ],
  symbols: [
    {
      id: 'card.shared',
      name: 'Shared card',
      description: '',
      allowedPropOverrides: ['heading'],
      node: {
        id: 'source',
        component: 'card',
        version: 1,
        props: { heading: 'Shared', locked: 'governed', emphasis: 'normal' },
      },
    },
  ],
  templates: [],
};

const node: ComponentNode = {
  id: 'instance',
  component: 'card',
  version: 1,
  props: { heading: 'Override', locked: 'attempted', emphasis: 'normal' },
  presentation: {
    designSystemVersion: 1,
    variantId: 'card.prominent',
    tokenBindings: { tone: 'tone.brand' },
    responsive: { heading: { mobile: 'Compact', desktop: 'Wide heading' } },
    symbol: { id: 'card.shared' },
  },
};

describe('React presentation resolution', () => {
  it('resolves governed symbols, variants, tokens, and explicit breakpoints in order', () => {
    const resolved = resolveNodePresentation(node, { designSystem, breakpoint: 'desktop' });
    expect(resolved.id).toBe('instance');
    expect(resolved.props).toEqual({
      heading: 'Wide heading',
      locked: 'governed',
      emphasis: 'high',
      tone: 'brand',
    });
    expect(
      resolveNodePresentation(
        {
          ...node,
          presentation: { ...node.presentation, designSystemVersion: 2 },
        },
        { designSystem, breakpoint: 'desktop' },
      ).props,
    ).toEqual(node.props);
  });

  it('passes resolved props to application-owned React components', () => {
    const registry = createComponentRegistry({
      card: ({ heading, locked, emphasis, tone }) => (
        <p>{[heading, locked, emphasis, tone].map(String).join('|')}</p>
      ),
    });
    const html = renderToStaticMarkup(
      <GridStoryRenderer
        nodes={[node]}
        registry={registry}
        designSystem={designSystem}
        breakpoint="mobile"
      />,
    );
    expect(html).toBe('<p>Compact|governed|high|brand</p>');
  });
});
