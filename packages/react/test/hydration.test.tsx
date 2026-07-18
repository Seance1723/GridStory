// @vitest-environment jsdom

import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ComponentNode } from '@gridstory/schema';
import { createComponentRegistry, GridStoryRenderer } from '../src/index.js';

const registry = createComponentRegistry({
  hero: ({ heading }) => <h1>{String(heading)}</h1>,
});

const nodes: ComponentNode[] = [
  { id: 'hero-1', component: 'hero', version: 1, props: { heading: 'Hydrated GridStory' } },
];

describe('GridStoryRenderer hydration', () => {
  it('hydrates server-rendered content without recoverable errors', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<GridStoryRenderer nodes={nodes} registry={registry} />);
    const recoverableErrors: unknown[] = [];

    const root = hydrateRoot(container, <GridStoryRenderer nodes={nodes} registry={registry} />, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });
    await act(async () => undefined);

    expect(container.textContent).toBe('Hydrated GridStory');
    expect(recoverableErrors).toEqual([]);
    await act(async () => root.unmount());
  });
});
