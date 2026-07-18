# ADR 0001: Canonical serializable schema IR

- Status: Accepted
- Date: 2026-07-17

## Context

GridStory must support schema-as-code, a visual modeler, validation, Studio forms, generated types, migrations, REST/GraphQL delivery, and imports without maintaining a different model for each surface.

## Decision

Use one versioned, JSON-serializable intermediate representation as the canonical content and component contract. Stable schema, field, component, prop, and slot IDs are identity; display names are mutable metadata. Runtime schemas validate this IR at trust boundaries. Type-level inference and deterministic declaration generation project TypeScript types from the same contracts.

React implementation code is never part of the IR. Component manifests contain only IDs, versions, editor metadata, props, slots, defaults, and constraints.

## Consequences

- Every authoring and delivery surface can consume the same contract.
- Schema changes can be diffed and migrated by stable identity instead of labels.
- Application code remains deployable independently from content.
- New field kinds require coordinated validator, editor, type-generator, storage, and migration support.

## Evolution rule

IR versions are immutable after publication. Backward-compatible readers may accept older versions; breaking changes require an explicit migration plan and a new version.
