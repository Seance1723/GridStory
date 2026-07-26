# Editorial workflows, approvals, and schedules

GridStory keeps editorial governance in the framework-neutral control plane. Workflow definitions, entry instances, approvals, schedules, history, and notification records are canonical schema contracts; React applications only consume published content and never receive workflow records through delivery endpoints or cache tags.

## Default editorial flow

A fresh `page` scope receives the versioned `page-editorial` definition on first use:

```text
Draft -> In review -> Approved -> Published -> Archived
```

Submitting review is immediate. Moving from `In review` to `Approved` requires a publisher or administrator approval from an actor other than the requester. Publication is only possible from `Approved`; the workflow gate is inside `ContentService`, so REST and GraphQL publication use the same decision. Saving a new immutable draft resets the entry to the workflow's initial state, clears stale approval, and cancels pending schedules bound to the older revision.

The default is replaceable through `PUT /api/v1/workflows/:id`. Updates must increment `version`, all state and transition identifiers are validated, and one scoped workflow is allowed per content type. A definition can set transition roles and approval rules with:

- a required distinct approval count;
- reviewer roles and requester/reviewer separation of duties;
- locale and changed-field conditions;
- a deadline in hours and escalation roles.

Definitions and instances are keyed by organization, tenant, workspace, site, environment, and locale in both SQLite and PostgreSQL adapters. A record from a neighboring scope cannot satisfy a lookup or policy decision.

## Review and approval API

Management endpoints are private and return `Cache-Control: private, no-store`:

- `GET /api/v1/workflows` lists the active scope's definitions.
- `PUT /api/v1/workflows/:id` creates a new definition version (`workflow.manage`).
- `GET /api/v1/content/:id/workflow` returns the entry instance (`workflow.read`).
- `POST /api/v1/content/:id/workflow/transitions/:transitionId` requests an available transition (`workflow.transition`).
- `POST /api/v1/content/:id/workflow/approvals/:requestId` approves or rejects (`workflow.approve`).
- `POST /api/v1/content/:id/workflow/schedules` creates a future transition and `DELETE .../schedules/:scheduleId` cancels it (`workflow.schedule`).
- `POST /api/v1/workflows/process-due` is the administrator/testing boundary for due schedules and escalations; production uses the worker.

Transition-level role checks are enforced inside `WorkflowService` in addition to route authorization. Approval decisions retain actor ID, roles, time, and optional comment. The service rejects self-approval before counting a decision and rejects duplicate reviewers, stale revisions, unavailable transitions, invalid IANA time zones, and schedule instants that are not in the future.

The universal client exposes corresponding `listWorkflows`, `saveWorkflow`, `getContentWorkflow`, `requestWorkflowTransition`, `decideWorkflowApproval`, `scheduleWorkflowTransition`, and `cancelWorkflowSchedule` methods. Studio shows the configured version and state, available actions, pending approval/deadline/escalation status, future schedules, and bounded notification activity. The Studio Publish action remains disabled until a configured transition can reach the published state.

## Schedules, notifications, and escalations

Schedules store an absolute ISO-8601 instant plus the originating IANA time zone. The instant is unambiguous across daylight-saving changes; the time zone remains available for operator display and audit. A schedule is bound to the exact draft revision and originating actor roles. The worker fails the schedule safely if the revision or state changes before execution.

Approval deadlines are processed by the same worker loop. Passing a deadline marks the request escalated once and creates a notification for the configured escalation roles. Notifications are durable, bounded records containing only workflow metadata and audience roles. They do not contain draft field values, preview credentials, tokens, webhook secrets, or published-cache payloads. An injected notifier can deliver those records to an external system without moving vendor code into the control plane.

Workflow history is append-only within the durable instance and records initialization, transitions, approvals, rejection, scheduling, escalation, and exact completed-transition action snapshots. Content publication continues to use the existing hash-chained content audit and transactional outbox. Durable transition actions, recovery, retries, dead letters, idempotency, and delivery logs are documented in [Durable workflow actions](workflow-actions.md).

## Deployment notes

Run the API and worker against the same database. SQLite is appropriate for local single-worker use. PostgreSQL uses a separate workflow repository pool with the same fully scoped JSON contracts. Keep both processes on compatible application versions during a definition upgrade, and update definitions by version rather than mutating stored instances.

Do not expose workflow routes under delivery caching or copy approval notifications into published entry data. Applications should render only content fetched with the published perspective; Studio and other authenticated management tools use the private workflow/client surface.