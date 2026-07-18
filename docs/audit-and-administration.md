# Audit integrity and administrator operations

Every GridStory content mutation appends an attributable audit event inside the same SQLite or PostgreSQL transaction as its immutable revision, entry pointer, and outbox event. Audit history is never updated through the repository or management API.

## Hash-chain model

Audit chains are scoped to one content entry. Every event has a contiguous sequence, the preceding event hash, and a SHA-256 hash over its stable ID, complete organization/tenant/workspace/site/environment/locale scope, entry and revision IDs, sequence, actor, action, occurrence time, and predecessor hash.

The explicit sequence makes chain order stable even when several mutations share a timestamp or use unordered UUIDs. A missing/reordered event, changed field, broken predecessor, or sequence gap makes verification fail. Existing pre-chain SQLite/PostgreSQL events receive deterministic sequences and hashes during the idempotent repository migration; already-chained events are not silently rehashed.

Hash chaining is tamper-evident, not an external signature. A database superuser who can rewrite every event and recompute every hash can forge a new chain. For stronger non-repudiation, regularly export the chain and seal its manifest checksum in an independent immutable/WORM store or external signing system.

## Verification and export

The default roles reserve both actions for administrators:

- `audit.read`: `GET /api/v1/audit/verify`
- `audit.export`: `GET /api/v1/audit/export`

Verification returns `valid`, event/entry counts, and exact failures (`sequence_mismatch`, `previous_hash_mismatch`, or `event_hash_mismatch`). Export returns a versioned manifest, complete scoped events, failures, and an aggregate SHA-256 checksum over ordered event hashes.

Use `GET /api/v1/audit/export?format=ndjson` for streamed JSON Lines. The first line is the manifest and each following line is one event. Management cache policy remains `private, no-store`.

The universal client exposes `verifyAudit()` and `exportAudit()` with typed results.

## Administrator operations view

`GET /api/v1/operations/summary` requires `operations.read` and returns one explicit scope only:

- content totals by draft, changed, and published status;
- outbox and durable-job totals by lifecycle state;
- active and total webhook subscriptions;
- current audit verification and the 20 newest audit events.

Outbox and job aggregation is bounded at 1,000 records and reports `truncated=true` at that boundary. This protects the control plane from unbounded dashboard reads; production telemetry should provide long-range trends.

GridStory Studio exposes this endpoint through the **Operations** button. The on-demand administrator panel shows audit integrity, content count, pending events, dead jobs, and active webhooks without loading privileged operational data during ordinary authoring.

## Response procedure

If verification is invalid:

1. stop automated promotion and destructive maintenance for the affected scope;
2. export the failing chain and preserve database/WAL evidence;
3. compare with the most recent independently sealed export checksum;
4. identify the first failed sequence and correlate actor, revision, and infrastructure logs;
5. restore through a reviewed logical archive or database recovery procedure;
6. verify again before resuming publication or promotion.
