# Outbox, jobs, cache tags, and webhooks

GridStory never calls a webhook or CDN from inside a content write. Create, draft update, and publish transactions append an outbox event in the same SQLite or PostgreSQL transaction as the immutable revision, entry pointer, and audit event. If the content commit rolls back, its event rolls back; if it commits, the event remains durable until expanded into idempotent jobs.

## Run the worker

Run the API and operations worker as separate processes against the same database:

```bash
pnpm --filter @gridstory/api start
pnpm worker
```

During development, `pnpm dev:worker` runs the TypeScript worker. `GRIDSTORY_WORKER_INTERVAL_MS` controls polling from 100 to 60000 milliseconds. The worker discovers scopes with pending work, processes due atomic releases before workflow schedules and approval escalations, reconciles completed-transition action snapshots, claims up to 100 outbox/job records per scope, and exits gracefully after `SIGINT` or `SIGTERM`. Release execution is documented in [Atomic multi-entry releases](releases.md), workflow execution is documented in [Editorial workflows, approvals, and schedules](workflows.md), and transition action recovery is documented in [Durable workflow actions](workflow-actions.md).

SQLite is suitable for one local worker. PostgreSQL claims with row locks and `SKIP LOCKED`, allowing multiple worker replicas without duplicate ownership. Both adapters use expiring leases so another worker can recover abandoned work.

## Event and job lifecycle

Content mutations emit `content.created`, `content.draft.updated`, or `content.published`. Events carry the complete immutable scope, aggregate/revision IDs, content payload, occurrence time, and deterministic cache tags.

The worker expands each event into:

- one `cache.invalidate` job;
- one `search.index` job that reloads the scoped revision at execution time;
- one `webhook.deliver` job for each active scoped subscription matching the event type.

Expansion is restart-safe: every job has a full-scope unique idempotency key derived from the outbox event and destination. An event is marked succeeded only after all jobs are durably enqueued. Jobs move through `pending`, `processing`, `succeeded`, or `dead`; claims increment attempts, failures use capped exponential backoff, and exhausted attempts retain their last error as a dead letter.

The administrative API can inspect `/api/v1/operations/outbox` and `/api/v1/operations/jobs`, read the bounded scope summary at `/api/v1/operations/summary`, manually run `/api/v1/operations/drain`, and replay a completed or dead job through `/api/v1/operations/jobs/:id/replay`. Replays create a new job and idempotency key; immutable history is not overwritten. These operations are admin-only by default through separate read/manage/run/replay permissions. Audit integrity and incident handling are documented in [Audit integrity and administrator operations](audit-and-administration.md).

Scoped manual rebuilds enqueue `search.rebuild` jobs into the same leased queue. Incremental and rebuild jobs retain retries, dead letters, and replay, while their payloads contain identifiers rather than draft content. Search adapter configuration and operational status are covered in [Search, taxonomies, backlinks, and related content](search-and-taxonomies.md).

Completed workflow transitions enqueue `workflow.action` jobs into the same leased queue. The worker reconciles exact action snapshots from workflow history before claiming jobs, so a crash between transition persistence and enqueue is restart-safe. Operators can use the dedicated, private/no-store `/api/v1/workflow-actions` list, `/drain`, and `/:id/replay` endpoints or the Studio delivery log without mixing action permissions into general operations permissions.

## Cache tags

Every event and public REST delivery uses a collision-safe cache prefix containing organization, tenant, workspace, site, environment, and locale, followed by content type, entry, and exact revision tags. REST uses the `Cache-Tag` response header and also retains the full scope `Vary` header. Query connections return the union of their page nodes' tags. Workflow-authored cache tags are deduplicated and namespaced beneath the same prefix; raw global tags are never passed through.

The default cache invalidator acknowledges tags without contacting a provider. Production deployments inject a provider adapter into `OperationsService`; the adapter receives `{ scope, tags }`, and execution rejects an empty set or any tag outside that scope before the provider is called. Durable retry semantics remain provider-neutral.

Repository output is treated as an isolation boundary. Listed, claimed, enqueued, and replayed outbox/job records and webhook subscriptions are checked against the requested six-field scope. Webhook transports receive the explicit scope and the signed raw body contains the scope; a mismatched embedded event is rejected before network delivery. The worker emits a bounded `operations.drain.completed` telemetry event with the same canonical scope.

## Signed webhooks

Create and manage subscriptions through:

- `GET|POST /api/v1/operations/webhooks`
- `PUT|DELETE /api/v1/operations/webhooks/:id`

Only HTTPS destinations on public hosts are accepted. Embedded credentials, localhost, `.local`, private/reserved IPv4 literals, and IPv6 literals are rejected. Set `GRIDSTORY_WEBHOOK_ALLOWED_HOSTS` to a comma-separated allow-list in production; outbound infrastructure should also enforce an egress policy and DNS controls.

Set a long random `GRIDSTORY_WEBHOOK_SIGNING_SECRET`. Each delivery sends:

- `X-GridStory-Delivery`: durable job ID;
- `X-GridStory-Event`: immutable outbox event ID;
- `X-GridStory-Timestamp`: Unix seconds;
- `X-GridStory-Signature`: `v1=` followed by HMAC-SHA256 of `<timestamp>.<raw-body>`.

Receivers must compute the signature over the unmodified raw request body, compare it in constant time, reject stale timestamps, and deduplicate delivery IDs. GridStory does not follow redirects and requires a 2xx response within ten seconds.

The universal client exposes typed outbox/job listing, webhook create/update/delete, manual drain, and replay methods. The manual drain endpoint is for operations and testing; normal deployments should keep the worker process running.

## OpenTelemetry operations

The API and worker can emit optional OTLP/HTTP logs, metrics, and traces through the Node-only adapter. It reuses the canonical tenant telemetry envelope and records bounded request and worker seams without moving telemetry concerns into the framework-neutral core. Configuration, dashboards, retention targets, health behavior, redaction, alerting, and incident procedures are documented in [Observability and operational response](observability.md).

Telemetry is disabled by default. An exporter or Collector outage does not acknowledge durable work and does not make the content plane unready. Operators inspect the private/no-store `/api/v1/operations/observability` endpoint with `operations.read`; public `/health` and `/ready` intentionally reveal only minimal stable status.
