# Atomic multi-entry releases

GridStory releases coordinate two or more immutable draft revisions as one publication unit. Release orchestration stays in the framework-neutral control plane: applications continue to read ordinary published entries, while release definitions, validation results, schedules, previews, and rollback records remain private management data.

## Lifecycle and pinned revisions

A release is created from the current `draftRevisionId` of every selected entry. The service records each exact revision together with the entry's previously published revision and rollback policy. Later draft edits do not silently change the release; validation reports the pinned member as stale and execution stops before any published pointer moves.

The lifecycle is:

```text
draft -> validated -> scheduled -> executing -> published -> rolled-back
                         \-> failed
```

Validation is repeatable until execution. A valid cancelled schedule returns the release to `validated`. Failed releases can be revalidated after their underlying problem is corrected. Published and rolled-back releases are immutable history records.

## Validation and future-state preview

`POST /api/v1/releases/:id/validate` evaluates the entire proposed published state, not only each entry in isolation. It checks:

- pinned revisions still match the current immutable drafts;
- content-schema and component-tree validity;
- the same workflow and quality gates used by ordinary publication;
- canonical-route uniqueness after all release members replace their current published versions;
- content references resolve to another release member or content that remains published;
- whether the rollback policy can restore every member.

Validation returns bounded, stable issues with severity, entry identity, path, and non-content diagnostic metadata. A missing prior publication produces a rollback warning rather than blocking publication.

`GET /api/v1/releases/:id/preview` returns the exact pinned data and future canonical route for each member. This is an authenticated management projection with `Cache-Control: private, no-store`; it never primes delivery caches, issues preview credentials, or exposes neighboring tenant data. Consumers should validate immediately before requesting or displaying a future-state preview because preview itself intentionally does not mutate release state.

## Atomic publication and cache behavior

The final revision-pointer swap is implemented by `ContentRepository.publishMany`. SQLite uses one `BEGIN IMMEDIATE` transaction and PostgreSQL uses one database transaction with locked entry rows. Every member and target revision is resolved and every expected draft/published pointer is checked before the first update. The transaction then updates all published pointers and appends each member's hash-chained content audit event and transactional outbox event. A failure rolls back every pointer, audit row, and outbox event.

After commit, existing outbox processing invalidates the ordinary entry, revision, content-type, locale, site, environment, and tenant cache tags for every member. Published delivery APIs do not understand release records and cannot see partial release state.

Workflow completion is notified after the atomic content commit, matching the existing single-entry publication boundary. Deploy compatible API and worker versions together so workflow and release services interpret the same contracts.

## Schedules and worker execution

A validated release can be scheduled with an absolute ISO-8601 instant and an IANA time zone. The instant is authoritative across daylight-saving transitions; the time zone is retained for operator display and audit. Schedules retain the requesting actor and roles and are revalidated at execution time.

The API exposes `POST /api/v1/releases/process-due` for authorized operational checks and tests. Production workers process due releases before individual workflow schedules and ordinary outbox/jobs. A changed draft, workflow state, route, reference, quality result, or previously published pointer fails safely before the atomic database write.

Workflow transition actions now use the generalized leased executor, idempotency keys, retries, dead letters, and delivery logs described in [Durable workflow actions](workflow-actions.md). Release scheduling remains protected by transactional expected-pointer checks; run one active scheduler loop for SQLite, while PostgreSQL supports concurrent job workers with row locking and `SKIP LOCKED`.

## Rollback policy

Each release chooses one policy:

- `manual`: an authorized publisher or administrator can roll back at any later time.
- `time-window`: rollback is allowed only within the configured `windowHours` after execution.
- `disabled`: rollback is forbidden.

Rollback is all-or-nothing and requires an operator reason. Every member must have a prior published revision, and every current published pointer must still equal the release revision. A release containing a first publication therefore cannot be rolled back atomically, and a later publication prevents an older release from overwriting it. Successful rollback restores all earlier revision pointers in one repository transaction and emits the same scoped content audit/outbox signals used by publication.

Rollback does not discard or rewrite current drafts and does not reopen editorial approval. It changes only the published revision set; teams can create a new release from current drafts when forward remediation is preferable.

## Management API and authorization

All release routes are private and no-store:

- `GET /api/v1/releases` and `GET /api/v1/releases/:id` (`release.read`).
- `POST /api/v1/releases`, `POST /:id/validate` (`release.manage`).
- `GET /:id/preview` (`release.read`).
- `POST /:id/schedule` and `DELETE /:id/schedule` (`release.schedule`).
- `POST /:id/execute` (`release.execute`).
- `POST /:id/rollback` (`release.rollback`).
- `POST /api/v1/releases/process-due` (`operations.run`).

Viewers can inspect releases, authors can compose and validate them, and publishers can schedule, execute, and roll back. Administrators retain wildcard access. Universal-client methods mirror every route. Studio provides a responsive release manager for selecting saved revisions, reviewing validation issues, loading the future state, scheduling/cancelling, publishing, and policy-aware rollback.

Release repositories persist the complete organization, tenant, workspace, site, environment, and locale scope alongside an opaque scope key in memory, SQLite, and PostgreSQL. Cross-scope lookups return not found rather than revealing whether a release ID exists elsewhere.