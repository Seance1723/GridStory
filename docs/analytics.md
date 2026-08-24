# Bounded content analytics

GridStory exposes a deliberately small analytics seam for published content and typed component references. It normalizes lifecycle and anonymous engagement evidence, keeps bounded complete-scope counters for operational review, and fans the same typed evidence out through injected adapters. It is not an identity service, session tracker, raw-event warehouse, attribution engine, or provider SDK.

## Public event contract

Delivery applications may send only three closed event shapes to `POST /api/v1/analytics/events`:

- `content.viewed`, with an exact current published content ID, type, and revision;
- `component.viewed`, adding a registered component ID/version and application node ID;
- `component.interacted`, adding a bounded stable interaction name such as `primary_cta.activate`.

Every request contains a UUID event ID, offset-aware occurrence time, the exact published content reference, and an explicit consent decision for the configured analytics purpose. Scope comes from the ordinary validated delivery request context, never from an event property. The API folds a received `Sec-GPC: 1` header into the consent decision, returns `200` without enqueueing when the purpose is denied or GPC applies, and returns `202` only after durable acceptance.

The schema has no arbitrary event name or property bag. It does not accept visitor, account, session, experiment-assignment, URL, referrer, IP address, user-agent, device, draft/preview, or free-form values. Events older than 24 hours or more than five minutes in the future are rejected. The referenced content type and revision must exactly match the current published pointer, so stale, draft, and fabricated references fail closed.

Example application call:

```ts
await client.trackAnalyticsEvent({
  id: crypto.randomUUID(),
  name: 'component.interacted',
  occurredAt: new Date().toISOString(),
  content: {
    id: page.id,
    contentType: page.contentType,
    revisionId: page.publishedRevisionId,
  },
  component: { id: 'hero', version: 2, nodeId: 'hero-primary' },
  interaction: 'primary_cta.activate',
  consent: {
    purposeId: 'analytics',
    granted: analyticsPurposeGranted,
    globalPrivacyControl: navigator.globalPrivacyControl === true,
  },
});
```

The application remains responsible for collecting a valid consent decision, deciding whether sending the event is lawful, avoiding identifying interaction names, applying public endpoint rate controls, and preventing duplicate generation. GridStory's event UUID makes processing idempotent but is not a subject identifier.

## Lifecycle evidence and release annotations

The existing transactional content outbox normalizes `content.created`, `content.draft.updated`, and `content.published` after the content transaction commits. Successful atomic release publication and rollback enqueue `release.published` and `release.rolled_back` annotations with the release ID, bounded display name, entry count, scope, and time.

Release state is authoritative. If analytics enqueueing fails after a release commit, publication or rollback remains successful; a missing marker is therefore not evidence that the release did not happen. Successfully enqueued adapter work exposes its own job health. An annotation correlates a deployment-like change with later counters; it does not prove that the release caused a performance change.

## Durable processing and adapters

One idempotent `analytics.process` job updates the scoped aggregate and then enqueues one independent `analytics.deliver` job per configured adapter. Adapter jobs inherit leases, exponential retry, a 12-attempt maximum, dead-letter history, and manual replay from the general operations queue. A slow, unavailable, removed, or hostile adapter cannot roll back the aggregate or content/release state.

Adapters implement the framework-neutral `AnalyticsAdapter` interface and are injected by the trusted server composition root:

```ts
const adapter = {
  id: 'warehouse',
  async deliver(evidence) {
    // Map the closed GridStory union to the provider's server-side contract.
  },
};

await buildServer({
  analytics: { adapters: [adapter], purposeId: 'analytics' },
});
```

Provider credentials, endpoint policy, TLS/egress controls, timeouts, provider-specific idempotency, retention, deletion, access policy, and availability remain deployment responsibilities. Core packages have no provider dependency or credential field, and adapter exceptions are replaced with a stable generic message before durable job/report retention. An adapter may send detailed diagnostics only to its separately protected provider log without returning secrets to GridStory.

## Aggregate report and limits

Authenticated operators with `operations.read` can call `GET /api/v1/analytics/report`; Studio loads the same private/no-store projection in its Operations panel. The report includes totals by normalized event, bounded content/revision and component/version counters, bounded interaction-name counts, recent release annotations, truncation flags, and pending/processing/succeeded/dead adapter-job counts. Private event receipt IDs are never returned.

The aggregate retains at most 1,000 content metrics, 1,000 component metrics, 25 interaction names per component, 100 release annotations, and 5,000 private idempotency receipts. A report examines at most the general 1,000-job operational page and marks `deliveriesTruncated` when that bound is reached. These are explicit operational views, not an analytics data-retention promise. Completed/dead job retention and provider-side raw-event retention must be set and monitored by the deployment.

## Recovery, rollback, and interpretation

Analytics aggregates use the same complete organization, tenant, workspace, site, environment, and locale scope in memory, SQLite, and PostgreSQL. Native database backup/restore therefore recovers the aggregate consistent with that database snapshot. Provider deliveries that happened after the restored point are external side effects and may need reconciliation using provider idempotency and retained job evidence.

Rolling back the M7-003 application change removes ingestion, aggregation, and adapter execution but cannot recall provider deliveries. Do not use these bounded counters for billing, legal records, statistical significance, experiment winner selection, or causal release decisions without independently governed data quality, bot/late-event policy, attribution, statistics, retention, and audit evidence.
