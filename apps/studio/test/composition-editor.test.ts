import { describe, expect, it } from 'vitest';
import type { ComponentManifest, ComponentNode } from '@gridstory/schema';
import {
  addNode,
  commitComposition,
  createCompositionHistory,
  findNode,
  flattenLayers,
  instantiateSymbol,
  instantiateTemplate,
  moveNode,
  redoComposition,
  removeNode,
  undoComposition,
  updateNodeProps,
  updateNodePresentation,
  type CompositionRules,
} from '../src/composition-editor.js';

const manifests = [
  {
    id: 'layout',
    version: 1,
    name: 'Layout',
    description: '',
    category: 'Layout',
    strictProps: true,
    props: [],
    slots: [
      {
        id: 'layout.content',
        name: 'content',
        label: 'Content',
        accepts: ['text'],
        min: 1,
        max: 2,
      },
    ],
  },
  {
    id: 'text',
    version: 1,
    name: 'Text',
    description: '',
    category: 'Content',
    strictProps: true,
    props: [],
    slots: [],
  },
  {
    id: 'image',
    version: 1,
    name: 'Image',
    description: '',
    category: 'Media',
    strictProps: true,
    props: [],
    slots: [],
  },
] satisfies ComponentManifest[];

const layout: ComponentNode = {
  id: 'layout-1',
  component: 'layout',
  version: 1,
  props: {},
  slots: {
    content: [{ id: 'text-1', component: 'text', version: 1, props: { body: 'One' } }],
  },
};
const rootText: ComponentNode = {
  id: 'text-2',
  component: 'text',
  version: 1,
  props: { body: 'Two' },
};
const rules: CompositionRules = {
  manifests,
  rootAccepts: ['layout', 'text'],
  rootMinimum: 1,
  rootMaximum: 3,
};

describe('composition editor commands', () => {
  it('enforces root and slot constraints while moving nested nodes immutably', () => {
    const original = [layout, rootText];
    const nested = moveNode(
      original,
      rootText.id,
      { parentId: layout.id, slotName: 'content', index: 1 },
      rules,
    );
    expect(nested).toMatchObject({ ok: true });
    expect(original).toHaveLength(2);
    expect(nested.nodes).toHaveLength(1);
    expect(findNode(nested.nodes, layout.id)?.slots?.content.map((node) => node.id)).toEqual([
      'text-1',
      'text-2',
    ]);

    expect(
      addNode(
        nested.nodes,
        { id: 'image-1', component: 'image', version: 1, props: {} },
        { parentId: layout.id, slotName: 'content' },
        rules,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('not allowed') });
    expect(
      addNode(
        nested.nodes,
        { id: 'text-3', component: 'text', version: 1, props: {} },
        { parentId: layout.id, slotName: 'content' },
        rules,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('maximum') });
    expect(
      moveNode(nested.nodes, layout.id, { parentId: layout.id, slotName: 'content' }, rules),
    ).toMatchObject({ ok: false, error: expect.stringContaining('inside itself') });
  });

  it('protects minimum cardinality, supports reorder, and exposes a complete layers tree', () => {
    const nodes = [layout, rootText];
    expect(removeNode(nodes, 'text-1', rules)).toMatchObject({
      ok: false,
      error: expect.stringContaining('requires at least 1'),
    });
    const reordered = moveNode(nodes, rootText.id, { index: 0 }, rules);
    expect(reordered.ok).toBe(true);
    expect(reordered.nodes.map((node) => node.id)).toEqual(['text-2', 'layout-1']);
    expect(flattenLayers(nodes).map((layer) => [layer.node.id, layer.depth])).toEqual([
      ['layout-1', 0],
      ['text-1', 1],
      ['text-2', 0],
    ]);
    expect(moveNode(nodes, layout.id, { index: 0 }, rules).nodes).toBe(nodes);
    expect(moveNode(nodes, rootText.id, { index: nodes.length }, rules).nodes).toBe(nodes);
  });

  it('keeps bounded undo/redo history and clears redo after a new branch', () => {
    let history = createCompositionHistory([layout], layout.id);
    const changed = updateNodeProps(history.present, layout.id, { gap: 'large' });
    history = commitComposition(history, changed, layout.id, 2);
    history = commitComposition(history, [...history.present, rootText], rootText.id, 2);
    history = commitComposition(
      history,
      [...history.present, { id: 'text-3', component: 'text', version: 1, props: {} }],
      'text-3',
      2,
    );
    expect(history.past).toHaveLength(2);

    history = undoComposition(history);
    expect(findNode(history.present, 'text-3')).toBeUndefined();
    history = redoComposition(history);
    expect(findNode(history.present, 'text-3')).toBeTruthy();
    history = undoComposition(history);
    history = commitComposition(
      history,
      updateNodeProps(history.present, layout.id, { gap: 'none' }),
    );
    expect(history.future).toEqual([]);
  });

  it('instantiates symbols and templates with fresh recursive IDs and immutable presentation data', () => {
    let sequence = 0;
    const createId = () => `new-${++sequence}`;
    const symbol = instantiateSymbol(
      {
        id: 'symbol.text',
        name: 'Shared text',
        description: '',
        allowedPropOverrides: ['body'],
        node: rootText,
      },
      1,
      createId,
    );
    const template = instantiateTemplate(
      {
        id: 'template.layout',
        name: 'Layout',
        description: '',
        category: 'General',
        nodes: [layout],
      },
      createId,
    );

    expect(symbol.id).toBe('new-1');
    expect(symbol.presentation?.symbol).toEqual({ id: 'symbol.text' });
    expect(symbol.presentation?.designSystemVersion).toBe(1);
    expect(template[0]?.id).toBe('new-2');
    expect(template[0]?.slots?.content[0]?.id).toBe('new-3');
    expect(layout.slots?.content[0]?.id).toBe('text-1');

    const presented = updateNodePresentation([layout], layout.id, {
      designSystemVersion: 1,
      variantId: 'layout.compact',
      tokenBindings: { gap: 'spacing.small' },
    });
    expect(presented[0]?.presentation?.variantId).toBe('layout.compact');
    expect(layout.presentation).toBeUndefined();
  });
});
