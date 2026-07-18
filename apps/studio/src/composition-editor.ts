import type {
  ComponentManifest,
  ComponentNode,
  ComponentPresentation,
  CompositionSymbolDefinition,
  CompositionTemplateDefinition,
  SlotDefinition,
} from '@gridstory/schema';

export interface NodeLocation {
  parentId?: string;
  slotName?: string;
  index: number;
}

export interface MoveTarget {
  parentId?: string;
  slotName?: string;
  index?: number;
}

export interface CompositionRules {
  manifests: ComponentManifest[];
  rootAccepts?: string[];
  rootMinimum?: number;
  rootMaximum?: number;
}

export interface CompositionResult {
  ok: boolean;
  nodes: ComponentNode[];
  error?: string;
}

export interface LayerNode {
  node: ComponentNode;
  location: NodeLocation;
  depth: number;
}

export interface CompositionHistory {
  past: ComponentNode[][];
  present: ComponentNode[];
  future: ComponentNode[][];
  selectedId?: string;
}

function locationTarget(location: NodeLocation): MoveTarget {
  return {
    ...(location.parentId ? { parentId: location.parentId } : {}),
    ...(location.slotName ? { slotName: location.slotName } : {}),
  };
}

function sameTarget(left: MoveTarget, right: MoveTarget): boolean {
  return left.parentId === right.parentId && left.slotName === right.slotName;
}

export function findNode(nodes: ComponentNode[], id: string): ComponentNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    for (const children of Object.values(node.slots ?? {})) {
      const found = findNode(children, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function locateNode(
  nodes: ComponentNode[],
  id: string,
  parentId?: string,
  slotName?: string,
): NodeLocation | undefined {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) {
      return {
        ...(parentId ? { parentId } : {}),
        ...(slotName ? { slotName } : {}),
        index,
      };
    }
    for (const [childSlot, children] of Object.entries(node.slots ?? {})) {
      const found = locateNode(children, id, node.id, childSlot);
      if (found) return found;
    }
  }
  return undefined;
}

function containsNode(node: ComponentNode, id: string): boolean {
  if (node.id === id) return true;
  return Object.values(node.slots ?? {}).some((children) =>
    children.some((child) => containsNode(child, id)),
  );
}

function updateChildren(
  nodes: ComponentNode[],
  target: MoveTarget,
  updater: (children: ComponentNode[]) => ComponentNode[],
): ComponentNode[] | undefined {
  if (!target.parentId) return updater(nodes);
  if (!target.slotName) return undefined;
  let found = false;
  const next = nodes.map((node) => {
    if (node.id === target.parentId) {
      found = true;
      return {
        ...node,
        slots: {
          ...node.slots,
          [target.slotName as string]: updater(node.slots?.[target.slotName as string] ?? []),
        },
      };
    }
    const slots = Object.fromEntries(
      Object.entries(node.slots ?? {}).map(([name, children]) => {
        const updated = updateChildren(children, target, updater);
        if (updated) found = true;
        return [name, updated ?? children];
      }),
    );
    return found ? { ...node, slots } : node;
  });
  return found ? next : undefined;
}

function childrenAt(nodes: ComponentNode[], target: MoveTarget): ComponentNode[] | undefined {
  if (!target.parentId) return nodes;
  if (!target.slotName) return undefined;
  return findNode(nodes, target.parentId)?.slots?.[target.slotName] ?? [];
}

function manifestFor(rules: CompositionRules, component: string): ComponentManifest | undefined {
  return rules.manifests.find((manifest) => manifest.id === component);
}

function slotFor(
  nodes: ComponentNode[],
  target: MoveTarget,
  rules: CompositionRules,
): SlotDefinition | undefined {
  if (!target.parentId || !target.slotName) return undefined;
  const parent = findNode(nodes, target.parentId);
  return parent
    ? manifestFor(rules, parent.component)?.slots.find((slot) => slot.name === target.slotName)
    : undefined;
}

function targetError(
  nodes: ComponentNode[],
  node: ComponentNode,
  target: MoveTarget,
  rules: CompositionRules,
  movingFrom?: NodeLocation,
): string | undefined {
  const children = childrenAt(nodes, target);
  if (!children) return 'The composition target does not exist.';
  const retainedCount =
    movingFrom && sameTarget(locationTarget(movingFrom), target)
      ? children.length - 1
      : children.length;
  if (!target.parentId) {
    if (rules.rootAccepts?.length && !rules.rootAccepts.includes(node.component)) {
      return `${node.component} is not allowed at the composition root.`;
    }
    if (rules.rootMaximum !== undefined && retainedCount >= rules.rootMaximum) {
      return 'The composition root has reached its maximum size.';
    }
    return undefined;
  }
  const slot = slotFor(nodes, target, rules);
  if (!slot) return 'The target slot is not declared by its parent component.';
  if (slot.accepts.length > 0 && !slot.accepts.includes(node.component)) {
    return `${node.component} is not allowed in ${slot.label}.`;
  }
  if (slot.max !== undefined && retainedCount >= slot.max) {
    return `${slot.label} has reached its maximum size.`;
  }
  return undefined;
}

function sourceError(
  nodes: ComponentNode[],
  location: NodeLocation,
  target: MoveTarget | undefined,
  rules: CompositionRules,
): string | undefined {
  if (target && sameTarget(locationTarget(location), target)) return undefined;
  const sourceChildren = childrenAt(nodes, locationTarget(location));
  if (!sourceChildren) return 'The source collection does not exist.';
  if (!location.parentId) {
    if (sourceChildren.length <= (rules.rootMinimum ?? 0)) {
      return 'The composition root minimum would be violated.';
    }
    return undefined;
  }
  const slot = slotFor(nodes, locationTarget(location), rules);
  if (slot && sourceChildren.length <= slot.min) {
    return `${slot.label} requires at least ${slot.min} component${slot.min === 1 ? '' : 's'}.`;
  }
  return undefined;
}

export function addNode(
  nodes: ComponentNode[],
  node: ComponentNode,
  target: MoveTarget,
  rules: CompositionRules,
): CompositionResult {
  if (findNode(nodes, node.id)) return { ok: false, nodes, error: 'Component IDs must be unique.' };
  const error = targetError(nodes, node, target, rules);
  if (error) return { ok: false, nodes, error };
  const children = childrenAt(nodes, target) ?? [];
  const index = Math.max(0, Math.min(target.index ?? children.length, children.length));
  const updated = updateChildren(nodes, target, (current) => [
    ...current.slice(0, index),
    node,
    ...current.slice(index),
  ]);
  return updated ? { ok: true, nodes: updated } : { ok: false, nodes, error: 'Target missing.' };
}

export function removeNode(
  nodes: ComponentNode[],
  id: string,
  rules: CompositionRules,
): CompositionResult {
  const location = locateNode(nodes, id);
  if (!location) return { ok: false, nodes, error: 'Component was not found.' };
  const error = sourceError(nodes, location, undefined, rules);
  if (error) return { ok: false, nodes, error };
  const updated = updateChildren(nodes, locationTarget(location), (children) =>
    children.filter((node) => node.id !== id),
  );
  return updated ? { ok: true, nodes: updated } : { ok: false, nodes, error: 'Source missing.' };
}

export function moveNode(
  nodes: ComponentNode[],
  id: string,
  target: MoveTarget,
  rules: CompositionRules,
): CompositionResult {
  const node = findNode(nodes, id);
  const source = locateNode(nodes, id);
  if (!node || !source) return { ok: false, nodes, error: 'Component was not found.' };
  if (target.parentId && containsNode(node, target.parentId)) {
    return { ok: false, nodes, error: 'A component cannot be nested inside itself.' };
  }
  const sourceProblem = sourceError(nodes, source, target, rules);
  if (sourceProblem) return { ok: false, nodes, error: sourceProblem };
  const targetProblem = targetError(nodes, node, target, rules, source);
  if (targetProblem) return { ok: false, nodes, error: targetProblem };

  const sourceTarget = locationTarget(source);
  const removed = updateChildren(nodes, sourceTarget, (children) =>
    children.filter((candidate) => candidate.id !== id),
  );
  if (!removed) return { ok: false, nodes, error: 'Source missing.' };
  const destination = childrenAt(removed, target);
  if (!destination) return { ok: false, nodes, error: 'Target missing.' };
  const sourceAndDestinationMatch = sameTarget(sourceTarget, target);
  const requested =
    target.index ?? (sourceAndDestinationMatch ? destination.length + 1 : destination.length);
  const adjusted =
    sourceAndDestinationMatch && source.index < requested ? requested - 1 : requested;
  const index = Math.max(0, Math.min(adjusted, destination.length));
  if (sourceAndDestinationMatch && index === source.index) return { ok: true, nodes };
  const updated = updateChildren(removed, target, (children) => [
    ...children.slice(0, index),
    node,
    ...children.slice(index),
  ]);
  return updated ? { ok: true, nodes: updated } : { ok: false, nodes, error: 'Target missing.' };
}

export function updateNodeProps(
  nodes: ComponentNode[],
  id: string,
  props: Record<string, unknown>,
): ComponentNode[] {
  return nodes.map((node) => ({
    ...node,
    props: node.id === id ? props : node.props,
    ...(node.slots
      ? {
          slots: Object.fromEntries(
            Object.entries(node.slots).map(([name, children]) => [
              name,
              updateNodeProps(children, id, props),
            ]),
          ),
        }
      : {}),
  }));
}

export function updateNodePresentation(
  nodes: ComponentNode[],
  id: string,
  presentation: ComponentPresentation | undefined,
): ComponentNode[] {
  return nodes.map((node) => ({
    ...node,
    ...(node.id === id ? (presentation ? { presentation } : { presentation: undefined }) : {}),
    ...(node.slots
      ? {
          slots: Object.fromEntries(
            Object.entries(node.slots).map(([name, children]) => [
              name,
              updateNodePresentation(children, id, presentation),
            ]),
          ),
        }
      : {}),
  }));
}

export function cloneCompositionNode(node: ComponentNode, createId: () => string): ComponentNode {
  return {
    ...node,
    id: createId(),
    props: { ...node.props },
    ...(node.presentation
      ? {
          presentation: {
            ...node.presentation,
            ...(node.presentation.tokenBindings
              ? { tokenBindings: { ...node.presentation.tokenBindings } }
              : {}),
            ...(node.presentation.responsive
              ? {
                  responsive: Object.fromEntries(
                    Object.entries(node.presentation.responsive).map(([name, values]) => [
                      name,
                      { ...values },
                    ]),
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(node.slots
      ? {
          slots: Object.fromEntries(
            Object.entries(node.slots).map(([name, children]) => [
              name,
              children.map((child) => cloneCompositionNode(child, createId)),
            ]),
          ),
        }
      : {}),
  };
}

export function instantiateTemplate(
  template: CompositionTemplateDefinition,
  createId: () => string,
): ComponentNode[] {
  return template.nodes.map((node) => cloneCompositionNode(node, createId));
}

export function instantiateSymbol(
  symbol: CompositionSymbolDefinition,
  designSystemVersion: number,
  createId: () => string,
): ComponentNode {
  const node = cloneCompositionNode(symbol.node, createId);
  return {
    ...node,
    presentation: {
      ...node.presentation,
      designSystemVersion,
      symbol: { id: symbol.id },
    },
  };
}

export function flattenLayers(nodes: ComponentNode[], depth = 0): LayerNode[] {
  const layers: LayerNode[] = [];
  nodes.forEach((node, index) => {
    layers.push({ node, location: { index }, depth });
    for (const [slotName, children] of Object.entries(node.slots ?? {})) {
      flattenLayers(children, depth + 1).forEach((layer) => {
        layers.push({
          ...layer,
          location:
            layer.depth === depth + 1
              ? { parentId: node.id, slotName, index: layer.location.index }
              : layer.location,
        });
      });
    }
  });
  return layers;
}

export function createCompositionHistory(
  nodes: ComponentNode[],
  selectedId?: string,
): CompositionHistory {
  return { past: [], present: nodes, future: [], ...(selectedId ? { selectedId } : {}) };
}

export function commitComposition(
  history: CompositionHistory,
  nodes: ComponentNode[],
  selectedId = history.selectedId,
  limit = 50,
): CompositionHistory {
  if (nodes === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-limit),
    present: nodes,
    future: [],
    ...(selectedId && findNode(nodes, selectedId) ? { selectedId } : {}),
  };
}

export function undoComposition(history: CompositionHistory): CompositionHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    ...(history.selectedId && findNode(previous, history.selectedId)
      ? { selectedId: history.selectedId }
      : {}),
  };
}

export function redoComposition(history: CompositionHistory): CompositionHistory {
  const [next, ...future] = history.future;
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future,
    ...(history.selectedId && findNode(next, history.selectedId)
      ? { selectedId: history.selectedId }
      : {}),
  };
}
