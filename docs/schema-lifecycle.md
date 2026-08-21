# Schema lifecycle

GridStory uses one versioned, JSON-serializable IR for schema-as-code, the visual model, validation, generated contracts, migration review, persistence, and drift detection. Stable schema, field, object, taxonomy, component, prop, and slot IDs are identity; names and labels may evolve independently.

## Controlled workflow

1. Change the code-owned schema or export the visual model's `ir` back into code review.
2. Run `pnpm schema:generate` and commit the generated projection.
3. Request `POST /api/v1/schema-lifecycle/plan` with canonical IR or the visual-model envelope.
4. Review every stable-ID change, risk, affected surface, entry count, backfill hook, data-scan requirement, lock estimate, and rollback policy.
5. Complete required content transforms until `invalidEntries` is empty.
6. Deploy only the code-owned source using the exact plan ID and `approved: true` when approval is required.
7. Confirm `GET /api/v1/schema-lifecycle/drift` and `/ready` report synchronization.

The deployment endpoint never accepts an alternate runtime schema. A visual change must round-trip into the code-owned IR first, preserving normal review and CI controls.

For rolling deployment, use expand/contract sequencing: deploy additive compatibility first, keep current and candidate code tolerant of both representations, perform application-owned backfills separately, and contract only after the old generation is gone. Both generations must return exact successful `/ready` responses against the same PostgreSQL database before traffic shifts. The runnable preflight, backup prerequisite, shutdown contract, and rollback boundary are in [Database recovery, graceful shutdown, and rolling upgrades](recovery-and-rollouts.md).

## Risk model

- `safe`: additive or metadata-only; no approval is required.
- `backfill`: stored content, routes, components, or constraints may need transformation; exact-plan approval is required.
- `destructive`: data or public contracts may be removed or made incompatible; approval is required and rollback may be unavailable.

GridStory stores structured content as revision JSON, so the current lock estimate describes the logical migration and data scan rather than table-column DDL. Generated hook names are stable integration points for application-owned transforms. Deployment remains blocked while existing scoped entries fail the target schema.

## Drift sources

The drift report compares four sources independently:

- code-owned source IR;
- persisted deployed IR;
- the database's persisted deployment fingerprint;
- persisted generated TypeScript declarations.

Missing state is not considered synchronized. Default development startup safely bootstraps the initial deployment; subsequent source changes leave readiness at `503 schema_drift` until they are assessed and promoted.
