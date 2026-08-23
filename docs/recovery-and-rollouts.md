# Database recovery, graceful shutdown, and rolling upgrades

GridStory treats database recovery as an infrastructure operation, not as tenant-scoped logical portability. A backup contains all tenants, drafts, revisions, workflows, jobs, audit history, schema state, governance rules/subjects/links/holds/requests/plans/receipts/events, migration recipes/projects/private plans/links/checkpoints/runs/cutover reports, and any credentials or identity records stored by the selected deployment. Provider migration credentials are injected at runtime and are not stored in migration documents, but mapped source data inside private plans is confidential. Classify the whole backup as confidential, restrict and audit access, encrypt it in transit and at rest, keep an off-host copy, and never place database URLs or passwords in filenames, manifests, logs, or command arguments.

The recovery commands produce or require a versioned sidecar manifest at `<archive>.manifest.json`. It contains only the database kind, native format, creation time, basename, byte length, and SHA-256 checksum. Verification checks the manifest and checksum plus SQLite integrity/required tables or the PostgreSQL archive table of contents. These checks detect damage and substitution; they do not replace protected storage, tested retention, or recovery approval.

Logical content export remains a different feature. It supports scoped portability and conflict-controlled import, but it omits operational database state and is not a database backup. Database backup also does not include external object-store bytes, telemetry backends, identity-provider state, secret-manager values, or operator-managed plugin data; each deployed adapter needs a coordinated backup and restore plan.

## Recovery objectives and evidence

Before production, the deployment owner records:

| Objective | Required deployment record |
|---|---|
| Recovery point objective (RPO) | Maximum tolerable data loss and the snapshot/WAL schedule that meets it. SQLite RPO cannot be smaller than the last completed snapshot; PostgreSQL PITR depends on an unbroken archived-WAL chain after a usable base backup. |
| Recovery time objective (RTO) | Maximum restoration time, including artifact retrieval, database replay, integrity/readiness checks, asset/secret coordination, traffic cutover, and rollback. Measure it in drills rather than copying a vendor estimate. |
| Retention | Daily/weekly/monthly or provider policy, legal/privacy deletion interaction, immutable/off-host duration, and expiry owner. Retention must cover the RPO window without becoming unlimited storage. |
| Custody | Backup principal, storage/key owner, restore approvers, break-glass process, access log, and separation between the live database and backup administrator where practical. |
| Drill cadence | At least before each major release and at the deployment's risk-based recurring interval; record archive ID/time (never credentials), target, timings, recovered point, verification, and cleanup. |

An archive is not successful evidence until an isolated restore passes database integrity, GridStory readiness, audit and governance-chain verification, active-hold/approved-plan inspection, migration recipe/project/link/checkpoint/run inspection, representative governed draft/published reads, pending-job inspection, and application-owned asset checks. The live SQLite recovery regression proves the earlier governance subject and migration recipe/project documents are restored alongside earlier content. Keep the original failed/live database and authoritative source CMS immutable until the recovered target is accepted and cut over.

## SQLite snapshot and restore drill

SQLite is intended for local, single-host, or small deployments with one active worker. `VACUUM INTO` creates a consistent snapshot of the live WAL database without copying `-wal` and `-shm` sidecars. The output must not already exist. An interrupted snapshot may be incomplete, so GridStory verifies it before writing the manifest.

Create and verify a snapshot from the configured `GRIDSTORY_DATABASE_PATH`:

```bash
pnpm database:backup -- --output ./backups/gridstory-2026-08-21.db
pnpm database:verify -- --backup ./backups/gridstory-2026-08-21.db
```

Restore only to an absent, isolated path while the live API/worker continue using the source:

```bash
pnpm database:restore -- --backup ./backups/gridstory-2026-08-21.db --target ./restore-drill/gridstory.db
```

Start a temporary API against the isolated target, verify `/ready`, audit integrity, and representative content, then stop it. For a real cutover, stop the live API and worker, retain the original database plus sidecars as the rollback set, place the verified restored file at a new path, point `GRIDSTORY_DATABASE_PATH` to that path, start one API, verify readiness and content, then resume the worker and traffic. Do not overwrite or copy a running SQLite database file. SQLite has snapshot recovery, not continuous point-in-time recovery; snapshot frequency and off-host transfer define its RPO.

## PostgreSQL logical backup and restore drill

The wrapper requires compatible `pg_dump`, `pg_restore`, and (for restore) `psql` client tools on `PATH`. It uses custom format, excludes ownership/ACL reassignment, and passes connection fields through libpq environment variables so passwords do not appear in the process argument list. The supported URL form names one database and may include only `sslmode`; use direct reviewed PostgreSQL tooling or a managed-service job for more advanced libpq/service configuration.

Create and verify a portable logical archive from `GRIDSTORY_DATABASE_URL`:

```bash
pnpm database:backup -- --output ./backups/gridstory-2026-08-21.dump
pnpm database:verify -- --backup ./backups/gridstory-2026-08-21.dump
```

Create a separate empty drill database with a least-privilege owner. Put its URL in `GRIDSTORY_RECOVERY_TARGET_DATABASE_URL`, then name that database again as the destructive-action confirmation:

```bash
pnpm database:restore -- --backup ./backups/gridstory-2026-08-21.dump --confirm-target gridstory_restore_drill
```

The command refuses a target that already contains GridStory relations. After restore it confirms the required GridStory tables exist. Start current code against the drill database, require `/ready` to return exactly `{"status":"ready"}`, verify audit/content/jobs, and remove the drill target according to the approved procedure. Never point this drill command at the live database. Production replacement/cutover is intentionally not automated by GridStory.

`pnpm test:postgres` starts a disposable PostgreSQL 17 container, exercises the current core/API adapters, creates a native custom-format dump, mutates the source, restores an isolated database, and proves the earlier published fixture is recovered. An externally supplied `GRIDSTORY_TEST_POSTGRES_URL` runs adapter conformance only because the harness does not have authority to create/drop recovery databases there.

## PostgreSQL point-in-time recovery

A `pg_dump` archive is logical and cannot be replayed with WAL. Production PITR requires a database/platform owner to configure and monitor:

1. `wal_level=replica` or higher, `archive_mode=on`, and a fail-closed `archive_command` or supported `archive_library` that writes completed WAL to protected off-cluster storage.
2. A regular physical base backup (`pg_basebackup` or the managed service's native snapshot) with WAL required to make it usable. Take the first base backup only after archival has been proven.
3. Continuous monitoring of archive failures and age, restore access, storage capacity/retention, encryption, base-backup completion, and the complete WAL chain. Alert before the stated RPO is breached.
4. An isolated recovery cluster using the matching PostgreSQL major version, preserved original data/WAL, the base backup, `restore_command`, a `recovery.signal` file, and one reviewed target such as `recovery_target_time` or a named restore point.
5. Connections blocked during replay. After PostgreSQL reaches the target, verify the timeline/time, GridStory tables and audit chain, application `/ready`, representative tenant reads, jobs, and external assets before promotion/cutover.

PITR changes the PostgreSQL timeline. Retain prior timelines and the original cluster until acceptance so an incorrect target can be retried. A missing/corrupt WAL segment invalidates later recovery points; do not silently promote at an earlier point without the incident owner accepting the increased data loss. Follow the exact procedures for the deployed PostgreSQL version or managed service; the authoritative PostgreSQL 17 procedure is [Continuous Archiving and Point-in-Time Recovery](https://www.postgresql.org/docs/17/continuous-archiving.html).

The repository's disposable logical drill is not physical PITR proof. Each production topology must separately rehearse its provider-specific base-backup/WAL restore and record achieved RPO/RTO before GA.

## Graceful shutdown

The API and worker share one bounded signal policy:

- On the first `SIGINT` or `SIGTERM`, the API calls Fastify close, rejects new requests, drains in-flight requests, closes all repositories, and flushes telemetry. The worker interrupts its polling wait, starts no new scope cycle, lets its current durable scope cycle finish, closes repositories, and flushes telemetry.
- `GRIDSTORY_SHUTDOWN_TIMEOUT_MS` defaults to 25000 and accepts 1000 through 300000 milliseconds. Configure the platform termination grace period longer than this budget, with time for signal delivery and forced cleanup; the common 30-second grace period leaves a five-second buffer at the default.
- A second signal or deadline/finalizer failure forces an immediate non-zero exit. A successful first-signal drain sets exit code zero and never calls `process.exit`, allowing flushed output and closed handles to finish naturally.
- Durable outbox/job leases and idempotency remain the crash-recovery mechanism if the platform uses `SIGKILL`, the host fails, or a forced exit interrupts current work.

The deployment must send `SIGTERM` to the Node process itself, remove a terminating replica from traffic, and avoid a shell wrapper that swallows signals. Readiness must stop routing traffic before the platform's force deadline. Test first-signal drain, deadline behavior, and a second signal in the actual runtime/container before production acceptance.

## Rolling-upgrade gate

Run multiple production replicas only with PostgreSQL. A safe change uses expand/contract sequencing: additive schema/data compatibility first, code that tolerates both forms next, backfill separately, and destructive contraction only after no current replica depends on the old form. GridStory's exact schema drift gate intentionally blocks a source/deployed/generated/database mismatch; a breaking migration needs its own approved migration and rollback plan.

Recommended rollout:

1. Produce and verify a current backup; confirm the physical PITR chain and rollback owner.
2. Deploy one candidate with no general traffic against the same PostgreSQL database as the current generation. Keep at least one current replica available and set bounded surge/unavailable, minimum-ready, progress-deadline, and termination-grace values in the chosen orchestrator.
3. Require distinct current and candidate origins to pass the exact minimal liveness/readiness contract:

   ```bash
   pnpm rollout:check -- --current https://current.internal.example --candidate https://candidate.internal.example
   ```

   The check rejects credentials, URL paths/query/fragment, redirects, oversized/widened responses, non-200 status, schema drift, timeouts, and using one origin for both generations. It does not discover database identity; the deployment owner must prove both origins address the intended replicas and shared database.

4. Send canary management/delivery traffic, confirm error/latency/queue/telemetry signals and published-cache correctness, then shift traffic gradually. Use the platform's rollout-status/progress deadline and stop on either readiness or signal regression.
5. Terminate current replicas through the graceful path. Keep the old artifact/replica-set revision and database recovery point until the observation window closes.

For application-only rollback, stop traffic shift and restore the previous artifact while the database remains backward compatible. If data/schema changed, use the migration's approved rollback or recover the isolated database to the named point; do not improvise an in-place downgrade. The rollout preflight proves that both observed processes are currently live and schema-ready—it does not certify arbitrary older releases, asset stores, secrets, proxies, caches, or provider behavior.
