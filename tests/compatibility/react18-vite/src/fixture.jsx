import { createComponentRegistry, GridStoryRenderer } from '@gridstory/react';

const registry = createComponentRegistry({
  hero: ({ heading }) => <h1>{String(heading)}</h1>,
});

const nodes = [
  {
    id: 'react-18-hero',
    component: 'hero',
    version: 1,
    props: { heading: 'GridStory on React 18.3' },
  },
];

export function Fixture() {
  return <GridStoryRenderer nodes={nodes} registry={registry} />;
}
