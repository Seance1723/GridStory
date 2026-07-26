# Durable workflow actions

GridStory workflow definitions can attach durable actions to a transition. Actions run only after the transition is completed and its exact definition snapshot is stored in workflow history. They are control-plane work: action records and management responses are tenant scoped, private, and never part of published delivery caches.

## Design actions

Open **Workflows** in Studio to inspect the state map and edit actions on each transition. Saving creates the next workflow definition version. An existing instance adopts the active version when its next transition completes, and that completed transition retains both the applied version and exact action snapshot needed for recovery.

Each transition accepts up to 20 actions with unique IDs:

- **Notification** sends a configured message to one or more audience roles through the injected workflow action notifier.
- **Webhook** sends a signed HTTPS event containing workflow and content identifiers.
- **Cache tags** passes explicit cache tags to the injected cache invalidator.

Each action sets a maximum of 1-20 attempts. Notifications and cache invalidations default to five; webhooks default to eight. The schema bounds labels, messages, roles, tags, and URLs so an action definition cannot become an unbounded job payload.

## Durable execution and recovery

After a transition succeeds, `WorkflowService` writes one append-only history event with the transition ID and serialized action definitions. It then enqueues one `workflow.action` job per action. The stable idempotency key includes workflow ID and version, entry and revision IDs, history-event ID, and action ID.

There is a deliberate recovery boundary between saving the workflow instance and enqueuing its jobs. Before processing due workflow work, the worker scans transition history and attempts to enqueue every stored action snapshot. Repository uniqueness makes repeated reconciliation safe, including after a process crash or restart.

Workflow action jobs use the same durable executor as cache invalidations and content webhooks:

1. A worker claims a pending job with an expiring 60-second lease.
2. Claiming increments the attempt counter before the adapter executes.
3. Success stores a bounded result and marks the job succeeded.
4. Failure stores the error and schedules capped exponential backoff.
5. The final failed attempt marks the record dead; operators can replay succeeded or dead records as a new job without overwriting history.

SQLite supports the local single-worker profile. PostgreSQL uses row locks and `SKIP LOCKED` so multiple replicas cannot claim the same delivery concurrently. All repository lookups, leases, idempotency constraints, API reads, and replays include the complete organization, tenant, workspace, site, environment, and locale scope.

## Delivery log and operations

Studio's workflow delivery log shows job state, attempt count, next run time, last error, result, and idempotency key. It can run currently due actions and replay completed or dead deliveries. The equivalent private, no-store API is:

- `GET /api/v1/workflow-actions`
- `POST /api/v1/workflow-actions/drain`
- `POST /api/v1/workflow-actions/:id/replay`

The universal client exposes `listWorkflowActions`, `drainWorkflowActions`, and `replayWorkflowAction`. These routes have dedicated `workflow.action.read`, `workflow.action.run`, and `workflow.action.replay` permissions; default authorization grants them only to administrators. Normal deployments should keep the worker running instead of using the manual drain endpoint.

The log is backed by durable job records and is intentionally bounded when listed. Existing records remain immutable when replayed, while the replay receives its own ID and idempotency key. Retention and archival policy remain deployment responsibilities.

## Webhook security

Workflow webhooks reuse the hardened operations transport. Execution requires HTTPS on a public host, applies the optional `GRIDSTORY_WEBHOOK_ALLOWED_HOSTS` allow-list, rejects embedded credentials, localhost, `.local`, private or reserved IPv4 literals, and IPv6 literals, does not follow redirects, and uses a ten-second timeout.

The request body contains delivery, idempotency, event, workflow/version, entry/revision, transition, and action identifiers. It does not contain draft field values, preview credentials, tokens, or webhook secrets. Receivers get:

- `X-GridStory-Delivery`: durable job ID;
- `X-GridStory-Event`: configured action event name;
- `X-GridStory-Timestamp`: Unix seconds;
- `X-GridStory-Signature`: `v1=` plus HMAC-SHA256 of `<timestamp>.<raw-body>`.

Use a long random `GRIDSTORY_WEBHOOK_SIGNING_SECRET`, compare signatures in constant time, reject stale timestamps, and deduplicate delivery IDs. Production infrastructure should enforce outbound DNS and network egress policy in addition to application validation.

## Adapter boundary

Action definitions and orchestration remain framework neutral. Vendor notification, cache, and HTTP behavior enters through `OperationsService` adapters, while `ContentRepository` supplies the existing leased queue contract. Browser, server, React Server Component, and worker entry points remain explicit; no adapter or draft data is imported into the public delivery surface.
