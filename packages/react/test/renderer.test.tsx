import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ComponentNode } from '@gridstory/schema';
import { createComponentRegistry, GridStoryRenderer } from '../src/index.js';

const registry = createComponentRegistry({
  hero: ({ heading }) => <h1>{String(heading)}</h1>,
});
const nodes: ComponentNode[] = [
  { id: 'hero-1', component: 'hero', version: 1, props: { heading: 'GridStory' } },
];

describe('GridStoryRenderer', () => {
  it('renders code-owned React components from a content tree', () => {
    const html = renderToStaticMarkup(<GridStoryRenderer nodes={nodes} registry={registry} />);
    expect(html).toBe('<h1>GridStory</h1>');
  });

  it('adds source attributes only in preview mode', () => {
    const published = renderToStaticMarkup(<GridStoryRenderer nodes={nodes} registry={registry} />);
    const preview = renderToStaticMarkup(
      <GridStoryRenderer nodes={nodes} registry={registry} preview />,
    );

    expect(published).not.toContain('data-gridstory-node');
    expect(preview).toContain('data-gridstory-node="hero-1"');
  });
});
