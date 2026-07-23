# Component lifecycle governance

GridStory keeps component execution in the React application while exposing code-owned lifecycle metadata to the control plane. Component manifests can declare an immutable current version, a deprecation notice and replacement, ordered data-only migrations, and deterministic visual regression scenarios.

## Manifest contract

A component remains `active` by default. A `deprecated` component must include a reason and may name a replacement component and ISO sunset timestamp. Migration steps have one source version and a later target version no greater than the manifest's current version. Duplicate source steps and non-advancing targets are rejected.

Migration operations are deliberately non-executable:

- `rename-prop` moves a stored property, preserving an existing destination value.
- `set-default` fills only a missing property.
- `remove-prop` deletes an obsolete property.

This keeps the framework-neutral control plane deterministic and prevents arbitrary application code from running in API or worker processes. Applications remain responsible for their React registry and for shipping implementations that support the current manifest version.

## Usage and migration workflow

Management APIs scan only fields declared as `component-tree` in the active schema. Reports are bound to the complete organization, tenant, workspace, site, environment, and locale scope and separate draft from published locations.

1. Inspect `GET /api/v1/components/:id/usage` for entry, field, node, path, perspective, revision, and version impact.
2. Inspect `GET /api/v1/components/:id/migration` for a stable plan ID, outdated count, and missing migration paths.
3. Use `POST /api/v1/content/:entryId/components/:componentId/migrate` with the expected draft revision ID.
4. Review the new immutable draft revision and publish it through the ordinary publication workflow.

Migration never rewrites a published revision. It transforms the draft successor, validates it against the current schema and manifest, and uses the existing optimistic revision boundary. Preview and delivery cache policies are unchanged.

## Visual regression hooks

Manifest scenarios contain only serializable props and an optional viewport. `GET /api/v1/components/:id/visual-regression` combines these code-owned scenarios with scoped content locations and returns a stable plan ID plus a renderer selector.

In preview mode, `@gridstory/react` emits:

- `data-gridstory-node`
- `data-gridstory-component`
- `data-gridstory-version`
- `data-gridstory-visual-hook="component@version"`

Published rendering does not add these wrappers. Application-owned Playwright, Chromatic, or other screenshot runners can consume the scenario list and selector without transferring component implementation or credentials into GridStory.

## Studio

The **Components** panel displays lifecycle status, deprecation/replacement guidance, scoped usage counts, outdated instances, screenshot hooks, and eligible draft migrations. It blocks a migration for the currently selected entry while local unsaved edits exist.