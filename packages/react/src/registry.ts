import type { ComponentType, ReactNode } from 'react';

export interface GridStoryComponentProps {
  slots?: Record<string, ReactNode>;
  [key: string]: unknown;
}

export type GridStoryComponent = ComponentType<GridStoryComponentProps>;
export type ComponentRegistry = ReadonlyMap<string, GridStoryComponent>;

export function createComponentRegistry(
  components: Record<string, GridStoryComponent>,
): ComponentRegistry {
  return new Map(Object.entries(components));
}
