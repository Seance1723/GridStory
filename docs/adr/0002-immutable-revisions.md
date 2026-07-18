# ADR 0002: Immutable content revisions

- Status: Accepted
- Date: 2026-07-17

## Context

Editors need autosave and drafts while delivery must resolve an exact, cacheable published state. Auditing, rollback, releases, localization, and collaboration cannot depend on mutable content rows alone.

## Decision

Treat every accepted write as an immutable revision. A content entry stores identity and pointers to its current draft and published revisions. Updates require the expected draft revision ID and fail on stale writes. Publication advances the published pointer to an exact validated revision; it never copies a mutable snapshot.

Audit events are written for content creation, draft updates, and publication with actor and tenant attribution.

## Consequences

- Published delivery is deterministic and safely cacheable.
- Revision history and optimistic concurrency are native rather than bolted on.
- Storage grows monotonically and requires explicit retention/export policy.
- Multi-entry releases will atomically move a set of published pointers.
