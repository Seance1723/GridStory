# ADR 0007: Database-native recovery and bounded rollout lifecycle

- Status: Accepted
- Date: 2026-08-21
- Last reviewed: 2026-08-21 (M5-005)

## Context

GridStory has tenant-scoped durable SQLite and PostgreSQL adapters, schema drift readiness, idempotent worker leases, repository close hooks, and optional telemetry flush. It does not yet produce physical backup artifacts, verify restores, document PostgreSQL point-in-time recovery, bound signal handling, interrupt worker sleeps, or prove that both sides of a rolling deployment are ready against the deployed schema.

Database recovery is deliberately different from the existing tenant-scoped logical portability archive. A database backup contains every tenant and operational record and must be handled as confidential infrastructure data. The application must not invent a new storage scheduler, encryption service, or WAL protocol when the supported databases already provide consistent native mechanisms.

## Options considered

| Approach | Who does it this way | Fits our stack? | Cost | What we would skip |
|---|---|---|---|---|
| Native SQLite snapshot plus PostgreSQL logical drill and operator-managed WAL/base-backup PITR | SQLite and PostgreSQL official recovery models | Yes. It preserves adapter ownership, allows local deterministic tests, and leaves physical PostgreSQL recovery with the database platform. | A small Node operator CLI, manifests/checksums, process hooks, tests, and a runbook. | Provisioned storage/schedules, embedded WAL shipping, tenant-selective physical restore, and an orchestrator-specific deployment package. |
| Copy SQLite files and use only periodic PostgreSQL logical dumps | Common minimal deployments | Partly. A raw SQLite copy can miss WAL state, and logical dumps cannot provide PostgreSQL PITR. | Low implementation cost but weak recovery objectives and misleading assurance. | Rejected because it cannot satisfy consistent live snapshots plus PITR guidance. |
| Build a GridStory backup scheduler, encrypted repository, retention engine, and cross-database restore service | Hosted control planes | No. GridStory does not own production infrastructure, key custody, object storage, PostgreSQL clusters, or their privileged recovery identities. | Large security, operational, and long-term compatibility surface. | Rejected; those controls remain operator/platform responsibilities. |
| Do nothing / reuse logical content export and current signal flags | Current GridStory baseline | No. Logical export omits database operations state, raw file copy is unsafe with WAL, the API has no shutdown deadline, the worker sleep delays drain, and no current/candidate rollout contract exists. | Zero. | Fails M5-005 and the Phase 6 recovery/deployment gate. |

## Decision

Add a Node-only recovery boundary in the API application. SQLite backup uses `VACUUM INTO` to create a consistent live snapshot, followed by integrity verification and a sidecar manifest containing only format, database kind, creation time, byte length, and SHA-256 checksum. PostgreSQL backup invokes the supported `pg_dump` custom format without putting credentials on the command line, verifies the archive with `pg_restore --list`, and writes the same bounded manifest. Restore defaults to an isolated, absent target and verifies checksums before any database mutation. Production in-place recovery remains an explicit stop, restore, verify, and cutover procedure; GridStory does not automate destructive cluster replacement.

PostgreSQL point-in-time recovery uses operator-managed base backups and continuous WAL archival. Logical dumps are retained as portable restore drills but are never described as PITR inputs. SQLite provides snapshot-level recovery only.

Centralize the Node signal state machine in `apps/api`: the first `SIGINT`/`SIGTERM` stops new API acceptance or worker polling, drains current work, closes repositories, and flushes telemetry within a configured deadline. A second signal or deadline breach forces a non-zero exit. Worker polling waits are abortable, while an already-started durable scope cycle is allowed to finish so its lease/idempotency contracts remain authoritative.

Add a deployment-neutral rollout preflight that requires distinct current and candidate base URLs to return the exact minimal `/health` and `/ready` success contracts. Because readiness already compares code-owned, deployed, database, and generated schema fingerprints, both generations being ready against the same production database is the smallest useful compatibility proof. Deployment orchestration, traffic shifting, and rollback remain platform-owned.

## Necessity gate

1. **Traceable:** M5-005, the Phase 6 backup/restore/DR and rolling-deployment acceptance gates, and the security profile's V13/V15/V16 recovery gap explicitly require this work.
2. **Not already solved:** logical portability excludes operational database state; repository `close()` hooks lack a deadline/second-signal policy; worker polling is not interruptible; schema readiness has no two-generation preflight; no restore drill exists.
3. **Minimal form:** this adds native command orchestration, checksums, lifecycle helpers, and guidance—not a scheduler, backup store, encryption/KMS system, WAL implementation, hosted control plane, or deployment framework.
4. **Dependency justified:** no dependency is added. Node platform modules, SQLite's native snapshot command, PostgreSQL client tools, Fastify shutdown, and the current readiness contract are reused.
5. **Rule of three:** the shared shutdown state machine covers two real process entry points and one timeout/force policy, without introducing a cross-package framework. Recovery implementations remain explicit per database because their semantics differ.
6. **Reversible:** no schema migration or stored-data rewrite is introduced. Reverting the task removes optional tooling/configuration; restore refuses overwrite by default and operator cutover retains the original database until verification succeeds.

## Sources that changed the decision

- [SQLite `VACUUM INTO`](https://www.sqlite.org/lang_vacuum.html#vacuuminto) documents a transactional, consistent live snapshot and the incomplete-output risk if interrupted.
- [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html) documents concurrent consistent logical backups and custom archives for `pg_restore`.
- [PostgreSQL continuous archiving and PITR](https://www.postgresql.org/docs/17/continuous-archiving.html) distinguishes logical dumps from base-backup plus continuous-WAL recovery.
- [Fastify shutdown lifecycle](https://fastify.dev/docs/latest/Reference/Server/#close) defines new-request rejection, in-flight draining, and `onClose` ordering.
- [Node signal events](https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events) explains that installing `SIGINT`/`SIGTERM` listeners removes the default exit behavior.
- [Kubernetes Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination) establishes readiness removal, `SIGTERM`, a bounded grace period, and eventual forced termination.
- [Kubernetes rolling updates](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#rolling-update-deployment) defines surge/unavailable bounds, minimum readiness, progress deadlines, and rollout status.

## Consequences and revisit triggers

- Backups are whole-database confidential artifacts; tenant-selective portability remains a separate authenticated application feature.
- PostgreSQL client utilities must be compatible with the server and available to the operator job; managed-service native recovery may replace the wrapper while retaining the restore drill and evidence contract.
- Exact readiness intentionally blocks contract-style schema changes that are not expand/contract compatible. Such a change requires its own T2/T3 migration decision and staged plan.
- Revisit an orchestrator-specific reference package only when GridStory supports and tests a named deployment target. Revisit incremental SQLite backup only if measured snapshot pause/CPU exceeds the supported local profile.
