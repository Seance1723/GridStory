# Visual composition editor

GridStory Studio edits the same serializable component tree that the application renders. The control plane stores component IDs, versions, props, and slots; it does not store React elements or application code.

## Component palette and layers

The root palette is derived from the active schema's `component-tree.accepts` list. Selecting a component in the recursive Layers panel opens its prop inspector and any slots declared by its manifest. Layer rows expose stable node IDs so repeated components remain distinguishable.

Every composition mutation uses an immutable command and becomes one bounded undo/redo step. A new edit after undo clears the abandoned redo branch. Composition changes participate in Studio's normal unsaved-change guard and are persisted only by Save draft.

## Slots and nesting

A component manifest declares each slot's stable ID, name, label, accepted component IDs, minimum, and optional maximum. Studio uses those declarations for its add buttons, capacity display, drag targets, and rejection messages. The schema validator enforces the same rules when the draft is saved, so the interface is guidance rather than a trust boundary.

Moving a node checks both its source and destination. The editor rejects unknown slots, disallowed child types, minimum or maximum violations, duplicate node IDs, and attempts to move a component inside itself or one of its descendants. Root acceptance and cardinality are enforced in the same command model.

The example kit includes `gridstory.stack`, an application-owned React layout component with a bounded `content` slot. It demonstrates nested rendering without moving layout ownership into the CMS.

## Keyboard and pointer controls

Focus a layer and use:

- `ArrowUp` or `ArrowDown` to reorder within its current root or slot.
- `ArrowRight` to nest it in the first compatible slot of the previous sibling.
- `ArrowLeft` to move a nested component after its parent.
- `Delete` to remove it when cardinality rules allow.

Pointer users can drag a layer onto another layer position, the root target, or a selected component's slot target. Buttons remain available for adding, moving, removing, undoing, and redoing without drag and drop.

## Application integration

Nested children reach registered React components through the renderer's `slots` prop. Each slot value is a rendered `ReactNode`, and normal published rendering contains no Studio-only source attributes. Preview mode adds source attributes only around component output for editor tooling.

To add a layout component:

1. Declare a serializable manifest with its props and slots.
2. Register the matching React component in the application registry.
3. Add its ID to the schema's root acceptance list where appropriate.
4. Advance immutable schema/component versions when changing deployed contracts.
5. Regenerate application-facing contracts with `pnpm schema:generate`.

