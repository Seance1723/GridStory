# Design-system authoring

GridStory treats design decisions as versioned, serializable contracts. The CMS delivers approved choices; the React application still owns every component and the final rendering behavior.

## Manifest

A design-system manifest has a stable ID, positive immutable version, and five governed catalogs:

- Tokens contain a stable ID, display name, category, primitive value, and description.
- Breakpoints are ordered from the smallest to largest minimum width.
- Variants target exactly one component ID and supply an approved prop overlay.
- Symbols provide a reusable component tree and an explicit list of props an editor may override.
- Templates provide one or more component trees that Studio clones with fresh recursive node IDs.

Duplicate IDs and unordered breakpoints are rejected by the canonical schema. Management clients read the active manifest through `GET /api/v1/design-system`; it uses the existing component-read permission and private/no-store caching.

## Presentation resolution

A component node can bind a variant, prop-to-token mappings, breakpoint-specific prop values, and a linked symbol. Any bound presentation pins the exact design-system version. This prevents a code deployment from silently changing published output that was authored against another version.

The React renderer applies presentation in a deterministic order:

1. Resolve a linked symbol and accept only its declared prop overrides.
2. Apply a variant only when it targets the resolved component ID.
3. Resolve known token IDs into their primitive values.
4. Apply the explicitly selected breakpoint's prop overrides.

If the application's design-system version differs from the node's pinned version, the renderer uses the stored component and props without applying bindings. The application can therefore coordinate upgrades through normal schema/component migration policy.

Breakpoint selection is explicit rather than derived from browser globals. This keeps SSR and hydration deterministic. Applications may select the breakpoint from their own responsive context; Studio exposes it in the live preview toolbar.

## Studio controls

The selected-component inspector offers only variants for that component. Token choices must satisfy the prop's primitive type plus enum, numeric range, and string-length constraints. Editors can capture or clear a prop override for the current preview breakpoint.

Linked symbols expose only their approved override fields. Their governed props and slots resolve from the versioned design system. Templates are inserted as one undoable command; insertion is rejected atomically if any root acceptance or cardinality rule fails.

Presentation changes remain unsaved draft state until the editor chooses Save draft. They participate in the same immutable revision, validation, audit, undo/redo, publish, and delivery boundaries as other structured content.

