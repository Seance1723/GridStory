# Logical content portability

GridStory logical archives move content between installations and database adapters without exposing SQLite or PostgreSQL storage details. An archive preserves entry, revision, publication, translation-group, and audit identities. Operational queues, webhook subscriptions, credentials, and runtime leases are intentionally excluded.

## Format and integrity

The current format is `gridstory.logical-content` version `1`. JSON responses contain one manifest and an ordered entry collection. `format=ndjson` returns the same archive as newline-delimited JSON so callers can process one logical record at a time.

The manifest records the source scope, export time, entry count, optional deployed-schema fingerprint, and an aggregate SHA-256 checksum. Every entry has its own SHA-256 checksum over canonical JSON. Import verifies the format, counts, checksums, stable IDs, revision references, publication pointers, audit references/actions, and duplicate IDs before storage is changed.

## Export

Administrators need `portability.export`.

```http
GET /api/v1/portability/export
GET /api/v1/portability/export?format=ndjson
```

The JSON Lines response uses `application/x-ndjson` and is delivered as a stream. Records are deterministically ordered by stable entry ID; revisions and audit history are ordered oldest-first.

## Import and dry-run

Administrators need `portability.import`. JSON and `application/x-ndjson` request bodies are accepted.

```http
POST /api/v1/portability/import
POST /api/v1/portability/import?dryRun=false&conflictPolicy=replace
```

Import defaults to `dryRun=true` and `conflictPolicy=reject`. A dry-run performs checksum, reference, schema-fingerprint, cross-scope-ID, and conflict checks without writing.

Conflict policies are:

- `reject`: stop if any entry ID already exists.
- `skip`: retain existing entries and import only non-conflicting IDs.
- `replace`: replace conflicting entries in the target scope and preserve archive IDs/history.

An ID owned by another scope is always rejected, including with `replace`. Set `allowSchemaMismatch=true` only for a reviewed migration where the target deployment intentionally differs from the archive fingerprint.

## Transaction and rollback boundary

Each import request is one database transaction. Validation occurs before mutation. SQLite uses one immediate local transaction; PostgreSQL locks conflicting IDs and performs all deletes/inserts in one transaction. Any uniqueness, reference, or storage failure rolls the entire batch back. Replacement also removes obsolete outbox records for replaced entries so old deliveries cannot run against restored content.

Large migrations should be split into independently reviewed archives when a smaller rollback boundary is operationally preferable. The API request-size limit still applies to imports; JSON Lines provides record-oriented transport and streamed export, not an unbounded upload channel.

## Typed client

`GridStoryClient.exportContentArchive()` returns the typed JSON archive. `importContentArchive()` defaults to a dry-run and accepts `dryRun`, `conflictPolicy`, and `allowSchemaMismatch`. Run and inspect a dry-run before every mutating import.

## Operational procedure

1. Export the source scope and retain the original archive unchanged.
2. Verify the target schema deployment or review an intentional mismatch.
3. Submit a dry-run and review `conflicts`, `imported`, `skipped`, and `replaced`.
4. Choose an explicit conflict policy and submit with `dryRun=false`.
5. Read representative draft and published entries and compare revision/audit counts.
6. Retain the archive and import result as migration evidence.
