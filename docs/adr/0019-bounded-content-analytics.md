# ADR 0019: Content analytics use anonymous normalized events and durable adapter jobs

- Status: Accepted
- Date: 2026-08-24
- Task: M7-003

## Context

GridStory already emits complete-scope content lifecycle outbox events, exports low-cardinality operational telemetry, executes retried durable jobs, publishes atomic releases, and accepts aggregate experiment evidence. It does not define how a delivery application names content/component engagement, how a deployment sends the same evidence to different analytics systems, how releases are correlated with later performance, or how content operators inspect bounded engagement totals.

M7-003 must close that gap without admitting draft data, provider credentials, raw URLs, device/network data, free-form properties, or subject/session identifiers into the control plane. Analytics failure must not change the truth of a successful content publication or rollback. Retry and replay must not double-count aggregates or require a new queue implementation.

## Prior-art comparison

| Approach | Evidence and fit | Decision |
|---|---|---|
| Install one provider SDK in every delivery application | Mature provider features, but each SDK has different identity, automatic context, property, consent, and retry defaults. It fragments the GridStory contract and cannot annotate server-side releases consistently. | Applications may still use provider SDKs independently, but this is rejected as the GridStory boundary. |
| Proxy arbitrary provider event names and property bags | Maximally flexible and resembles Segment Track or PostHog capture, but turns GridStory into a raw event/CDP ingress and admits unbounded cardinality and personal data. | Rejected. |
| Export only OpenTelemetry counters | Reuses current infrastructure and is appropriate for service health, but operational telemetry is not a durable application event contract, provider delivery queue, release annotation record, or content/component report. | Retained for service health, rejected as the product analytics contract. |
| Add normalized anonymous events, aggregate them by bounded content/component keys, and fan them out through existing durable jobs | Keeps one typed vocabulary, reuses scope/idempotency/retry/dead-letter behavior, avoids raw history, and lets adapters map to provider conventions outside schema/core. | Selected. |
| Store every event row and build funnels, cohorts, attribution, and experiment statistics | Powerful, but adds retention, deletion, identity, warehouse, query, and statistical responsibilities far beyond M7-003. | Rejected. |
| Do nothing | Avoids code, but leaves the explicit roadmap item and M7-002 event/adapter deferral unresolved. | Rejected. |

## Decision

GridStory defines a closed normalized vocabulary. Public delivery input contains only `content.viewed`, `component.viewed`, or `component.interacted`; exact published content and component identifiers/revisions describe the subject. Component interaction names are bounded tokens, not arbitrary properties. The server contributes `content.created`, `content.draft.updated`, and `content.published` from the existing outbox, plus `release.published` and `release.rolled_back` annotations from successful release transitions.

Public ingestion is anonymous, no-store, and asynchronous. It requires a configured analytics purpose to be explicitly granted and rejects Global Privacy Control suppression. Scope is derived from the validated published request context, never trusted from the body. Client occurrence time is bounded against server receipt time. No visitor, account, assignment, device, network, URL, referrer, draft, preview, or free-form property value is accepted.

Accepted evidence becomes an idempotently keyed durable processing job. Processing updates one optimistic complete-scope analytics aggregate document with bounded receipt IDs, event totals, per-content totals, per-component totals, and retained release annotations. It then enqueues one independently retried delivery job per injected adapter. Adapters receive the normalized schema value and own provider mapping/credentials outside schema and core. Aggregate receipts prevent replay double-counting; durable job keys prevent duplicate enqueue.

Release publication/rollback first persists its authoritative release result and then requests an analytics annotation. Annotation enqueue or provider failure is operational evidence only: it cannot turn published content back into a failed release response. Adapter delivery jobs use the established lease, backoff, replay, and dead-letter behavior, and authenticated operations reports expose their health without exposing provider credentials or raw payload history.

## Necessity gate

1. **Traceable:** M7-003 explicitly names analytics adapters, normalized content/component events, release annotations, and content-operations metrics; M7-002 explicitly defers raw event/provider integration here.
2. **Not already solved:** webhooks contain content payloads for customer automation, OpenTelemetry describes service operations, and experiment snapshots contain external aggregates. None is the minimized public event or adapter/report contract.
3. **Minimal form:** one schema vocabulary, one aggregate document/repository/service, two durable job phases, two routes, client methods, and one existing Studio panel extension form the smallest complete loop.
4. **Dependencies justified:** no package is added. Zod, Node/runtime primitives, and the existing memory/SQLite/PostgreSQL and durable-job boundaries suffice.
5. **Rule of three:** no generic CDP, query language, provider configuration framework, or statistics engine is introduced. The adapter interface supports only this concrete normalized evidence.
6. **Reversible:** all contracts, routes, tables/documents, UI, and injected callbacks are additive. Applications can stop ingestion and remove adapters before reverting the single task commit; content delivery and release truth remain independent.

## Sources that changed the decision

- [Segment Track specification](https://segment-docs.netlify.app/docs/connections/spec/track/) models named actions plus properties. GridStory keeps a named action model but replaces arbitrary properties and identities with a closed content/component union.
- [Segment common fields](https://segment-docs.netlify.app/docs/connections/spec/common/) shows the broad identity and context surface typical of a CDP. GridStory intentionally accepts none of those subject/network context fields.
- [PostHog events](https://posthog.com/docs/data/events) treats events as named interactions with timestamps, properties, identities, and deduplication. GridStory retains timestamp and event-ID retry safety while excluding identities and arbitrary properties.
- [PostHog JavaScript usage](https://posthog.com/docs/libraries/js/usage) distinguishes anonymous events but also documents automatic URL, referrer, device, campaign, and IP properties. GridStory therefore avoids SDK-shaped automatic context at its ingress.
- [Google Analytics event setup](https://developers.google.com/analytics/devguides/collection/ga4/events) and [Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4) use bounded named events/parameters and state that server collection supplements client tagging. GridStory adapters map outward; the core contract is not a GA transport replacement.
- [Grafana annotations API](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/api-legacy/annotations/) models operational annotations as timestamped text and tags. GridStory uses typed release metadata rather than provider-specific dashboard/panel identifiers.
- [OpenTelemetry naming](https://opentelemetry.io/docs/specs/semconv/general/naming/) recommends lowercase namespacing, while [attribute requirement levels](https://opentelemetry.io/docs/specs/semconv/general/attribute-requirement-level/) makes high-cardinality metric attributes opt-in. GridStory uses namespaced event names and bounded aggregate dimensions.

## Consequences and revisit triggers

- Content teams get comparable totals and release markers, not user journeys, attribution, or statistical conclusions.
- Applications must generate a unique event UUID, obtain the configured analytics-purpose decision, and instrument semantic component interactions explicitly.
- Providers may receive the normalized event after the local aggregate because delivery is asynchronous and retried. Operations must monitor dead adapter jobs.
- Revisit batch ingress only after measured request pressure; revisit aggregate retention/windowing only with a concrete reporting requirement; revisit identified analytics or raw export only with an approved privacy, deletion, residency, and retention design.
