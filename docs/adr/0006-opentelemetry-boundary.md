# ADR 0006: OpenTelemetry at the Node operational boundary

- Status: Accepted
- Date: 2026-08-21
- Last reviewed: 2026-08-21 (M5-004)

## Context

GridStory already validates a bounded six-dimensional `TenantTelemetryEvent` in the framework-neutral core and emits a few asset, search, and worker events through an injected sink. The API and worker do not initialize a telemetry SDK, export any signal, correlate requests, expose exporter health, or provide a production Collector/dashboard/retention contract. Durable audit records and Pino request logs exist, but neither is a metrics or distributed-tracing pipeline.

The roadmap explicitly says to adopt OpenTelemetry SDKs/exporters behind adapters. Security requirements additionally require minimal health responses, an event/metadata/sink/access/retention/correlation/alert inventory, and protection against secrets or draft content entering logs.

## Options considered

| Approach | Who does it this way | Fits our stack? | Cost | What we would skip |
|---|---|---|---|---|
| Official Node SDK, explicit GridStory instrumentation, OTLP/HTTP to a Collector | OpenTelemetry's documented application and Collector model | Yes. It keeps the core portable, makes signal attributes reviewable, and works for both Fastify and the worker. | Several maintained SDK/exporter packages plus explicit request/worker hooks. | Browser telemetry, automatic dependency instrumentation, tail sampling, and an embedded backend. |
| Node SDK with broad automatic instrumentation | OpenTelemetry Node getting-started examples | Partly. It provides quick coverage, but the ESM loader/order requirements and automatic URL/dependency attributes widen the privacy and regression surface. | Larger transitive tree and more operational review. | Rejected for this slice; add individual instrumentations only after a measured need and attribute review. |
| Pino logs plus bespoke counters/traces/export protocol | Common small Node services | No. Structured stdout remains useful, but implementing OTLP encoding, batching, context propagation, retries, and three signal lifecycles would duplicate mature protocol code. | High ongoing maintenance and compatibility risk. | Rejected; Pino remains the local process log, not the observability protocol. |
| Do nothing / reuse the current tenant sink and audit | Current GridStory baseline | No. The sink is optional and has no production implementation; audit is durable compliance evidence, not operational tracing or metrics. | Zero. | Fails M5-004 and leaves queue, request, and exporter failures invisible. |

## Decision

Use the official OpenTelemetry JavaScript Node SDK and OTLP/HTTP exporters only in `apps/api`. OpenTelemetry is disabled by default and starts before the API or worker begins handling work. GridStory instruments its own stable seams explicitly instead of enabling broad auto-instrumentation: inbound Fastify requests, validated tenant events, and worker scope cycles.

The adapter records route templates, methods, status, duration, request correlation, bounded event metadata, and complete validated scope on logs/traces. It never records request or response bodies, headers, raw URLs/query strings, credentials, draft content, or exception messages in exported attributes. Metrics contain bounded operation/outcome/route/status dimensions and never raw tenant or subject identifiers. Pino stdout and the immutable audit chain remain independent; telemetry failure cannot acknowledge work, authorize a request, or replace audit evidence.

Production deployments send to a private OpenTelemetry Collector. The repository supplies a Collector template, a Prometheus-compatible Grafana dashboard and alert rules, retention targets, and a runbook, while the actual backend, access controls, storage, and enforcement remain operator-owned. Public liveness/readiness remain minimal. A separately authorized, private/no-store operations route reports bounded SDK/Collector signal health without endpoint, topology, version, credential, or customer details.

JavaScript traces and metrics are stable, while its log SDK is still developmental. The log adapter is therefore isolated behind the same runtime and may be disabled or replaced without changing core contracts.

## Necessity gate

1. **Traceable:** M5-004, the Phase 6 GA observability deliverable, `GS-SEC-028`, and threats covering monitoring gaps, adapter failure, secrets, and unbounded retention explicitly require this work.
2. **Not already solved:** `TenantTelemetrySink` only validates/emits to an injected callback; Pino and audit do not provide OTLP metrics, traces, exporter health, dashboards, or retention policy.
3. **Minimal form:** this is an optional Node adapter and reference operations pack, not a hosted backend, browser analytics system, generic instrumentation framework, or every-dependency tracing rollout.
4. **Dependency justified:** the official SDK/exporters remove well over 100 lines of protocol encoding, batching, propagation, retry, and signal lifecycle code and implement a standard boundary the roadmap already selected.
5. **Rule of three:** no new cross-package abstraction is introduced; the existing tenant sink is reused and the Node-only runtime directly covers the three real seams: API requests, domain events, and worker cycles.
6. **Reversible:** disabling `GRIDSTORY_OTEL_ENABLED` removes all exporter activity without data/schema changes; Pino, audit, API, and worker behavior remain available.

## Sources that changed the decision

- [OpenTelemetry JavaScript status](https://opentelemetry.io/docs/languages/js/) establishes stable traces/metrics but developmental JavaScript logs.
- [OpenTelemetry JavaScript exporters](https://opentelemetry.io/docs/languages/js/exporters/) recommends OTLP through a Collector and batched export.
- [HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/) define stable server spans/metrics while highlighting convention-version handling.
- [Handling sensitive telemetry](https://opentelemetry.io/docs/security/handling-sensitive-data/) makes application data minimization and Collector redaction an operator responsibility.
- [Collector resiliency](https://opentelemetry.io/docs/collector/resiliency/) recommends sending queues, retries, monitoring, and persistent storage where loss tolerance requires it.
- [Fastify logging](https://fastify.dev/docs/latest/Reference/Logging/) documents request correlation and warns that headers can expose authentication data.

## Consequences and revisit triggers

- Application startup stays network-free unless observability is explicitly enabled.
- Explicit instrumentation is smaller and safer but will not automatically trace database, HTTP-client, or every framework operation.
- Tenant scope is queryable in protected logs/traces, while aggregate metrics remain safe from tenant-cardinality growth.
- Collector/backend availability is observable but does not make content delivery unavailable.
- Revisit automatic instrumentation only when a measured blind spot cannot be covered at a stable GridStory seam. Revisit the JavaScript log SDK adapter when upstream marks it stable or changes its public lifecycle contract.
