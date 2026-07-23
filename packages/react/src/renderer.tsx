import { Fragment, createElement, type ReactNode } from 'react';
import type { ComponentNode, DesignSystemManifest } from '@gridstory/schema';
import type { ComponentRegistry, GridStoryComponentProps } from './registry.js';
import { resolveNodePresentation } from './presentation.js';

export interface GridStoryRendererProps {
  nodes: ComponentNode[];
  registry: ComponentRegistry;
  preview?: boolean;
  designSystem?: DesignSystemManifest;
  breakpoint?: string;
  unknownComponent?: (node: ComponentNode) => ReactNode;
}

function defaultUnknownComponent(node: ComponentNode): ReactNode {
  return createElement(
    'div',
    {
      role: 'status',
      style: {
        border: '1px dashed #dc2626',
        borderRadius: '0.5rem',
        color: '#991b1b',
        padding: '0.75rem',
      },
    },
    `GridStory component “${node.component}” is not registered in this application.`,
  );
}

function renderNode(
  node: ComponentNode,
  registry: ComponentRegistry,
  preview: boolean,
  unknownComponent: (node: ComponentNode) => ReactNode,
  designSystem?: DesignSystemManifest,
  breakpoint?: string,
): ReactNode {
  const resolved = resolveNodePresentation(node, {
    ...(designSystem ? { designSystem } : {}),
    ...(breakpoint ? { breakpoint } : {}),
  });
  const Component = registry.get(resolved.component);
  if (!Component) {
    return createElement(Fragment, { key: node.id }, unknownComponent(resolved));
  }

  const slots = Object.fromEntries(
    Object.entries(resolved.slots ?? {}).map(([name, children]) => [
      name,
      children.map((child) =>
        renderNode(child, registry, preview, unknownComponent, designSystem, breakpoint),
      ),
    ]),
  );
  const props: GridStoryComponentProps = { ...resolved.props, slots };
  const rendered = createElement(Component, props);

  if (!preview) {
    return createElement(Fragment, { key: node.id }, rendered);
  }

  return createElement(
    'div',
    {
      key: node.id,
      'data-gridstory-node': node.id,
      'data-gridstory-component': resolved.component,
      'data-gridstory-version': resolved.version,
      'data-gridstory-visual-hook': `${resolved.component}@${resolved.version}`,
      style: { display: 'contents' },
    },
    rendered,
  );
}

export function GridStoryRenderer({
  nodes,
  registry,
  preview = false,
  designSystem,
  breakpoint,
  unknownComponent = defaultUnknownComponent,
}: GridStoryRendererProps): ReactNode {
  return nodes.map((node) =>
    renderNode(node, registry, preview, unknownComponent, designSystem, breakpoint),
  );
}
