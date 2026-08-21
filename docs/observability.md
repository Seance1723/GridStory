# Observability and operational response

GridStory exposes an optional Node-only OpenTelemetry boundary for the API and worker. It emits OTLP/HTTP logs, metrics, and traces to an operator-managed Collector while preserving the framework-neutral core and the existing Pino stdout and durable audit paths. Observability is disabled by default and is never required for content-plane correctness.

JavaScript traces and metrics are stable in OpenTelemetry. The JavaScript log SDK is still developmental, so GridStory isolates it inside the API runtime and identifies that maturity in private health output. Telemetry is not an audit source of truth.

## Enable and connect

Run an OpenTelemetry Collector on a private network, then configure both the API and worker:

```dotenv
GRIDSTORY_OTEL_ENABLED=true
OTEL_SERVICE_NAME=gridstory-api
GRIDSTORY_SERVICE_VERSION=2026.08.21
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20replace-me
OTEL_METRIC_EXPORT_INTERVAL=60000
GRIDSTORY_OTEL_HEALTHCHECK_URL=http://otel-collector:13133/
GRIDSTORY_OTEL_HEALTH_TIMEOUT_MS=2000
```

Use a distinct `OTEL_SERVICE_NAME=gridstory-worker` for the worker process. Standard per-signal endpoint, header, timeout, compression, sampler, and resource variables are read by the official exporters. Never put credentials in `GRIDSTORY_OTEL_HEALTHCHECK_URL`; it only accepts an HTTP(S) URL without user info, query, or fragment. Invalid booleans, resource tokens, intervals, timeouts, and health URLs fail configuration before the service listens.

The reference [Collector configuration](../deploy/observability/otel-collector.yaml), [Grafana dashboard](../deploy/observability/grafana-dashboard.json), and [Prometheus alert rules](../deploy/observability/prometheus-alerts.yaml) are deployment starting points. The Collector requires the contrib distribution because the fail-closed redaction processor and persistent file-storage queue are not both present in the core distribution. Pin and review the image digest in production.

The reference Collector sends all signals to `GRIDSTORY_TELEMETRY_BACKEND_ENDPOINT` and reads the backend authorization value from `GRIDSTORY_TELEMETRY_BACKEND_AUTHORIZATION`. Protect its OTLP, internal-metrics, health, and persistent-queue endpoints with network policy and filesystem permissions. The queue improves exporter-outage resilience; it is not a retention archive or a substitute for backend durability.

## Signal and log inventory

| Event/signal | Metadata recorded | Sink and format | Access | Default retention target | Correlation and alert |
|---|---|---|---|---|---|
| `gridstory.http.request.completed` log and server span | Route template, method, response status, bounded error type, request ID, duration; no raw URL/query, headers, body, response, or error message | OTLP logs/traces; Pino separately writes its existing structured process log | Operations/security roles in the protected backend | Logs 30 days hot/90 days maximum; traces 7 days | Trace/span context and request ID; page on 5xx ratio, ticket on p95 latency |
| `gridstory.tenant.event` metric and validated domain event log/span event | Complete validated organization/tenant/workspace/site/environment/locale scope in protected logs/traces; bounded event, outcome, operation, subject, and metadata | OTLP logs/traces/metrics | Tenant-scoped operations/security access | Logs 30/90 days; traces 7 days; raw metrics 30 days | Active trace context and operation ID; alert on error outcomes relevant to the worker |
| `gridstory.worker.scope` consumer span and duration histogram | Complete scope only on the span; metric uses bounded success/error outcome | OTLP traces/metrics | Operations access | Traces 7 days; raw metrics 30 days | Trace context; page on failed drain events |
| Collector internal telemetry | Queue size/capacity, accepted/refused/exported/failed signal counts, process health | Prometheus scrape on private port 8888 | Platform operations only | Raw metrics 30 days, downsampled aggregates 13 months | Ticket on export failure; page above 80% queue utilization |
| Immutable GridStory audit chain | Actor, action, scoped target, revision linkage, hashes, occurrence time | Authoritative content database and authorized audit export, not OTLP | Audit read/export permissions | Product governance policy; never shortened by telemetry retention | Request/operation identifiers where available; integrity verification in operations view |

M6-002 adds ordered tenant identity events for federation success/denial, directory user/group lifecycle, mappings, sessions, WebAuthn credentials/verification, and break-glass creation/failure/activation/revocation. These records contain stable action/outcome/actor/subject/incident/reason fields but exclude tokens, secrets, assertions, certificates, public keys, SCIM bodies, and free-form provider errors. Route telemetry still reports only bounded error types; deployments that export identity events must map them into the same protected low-cardinality log/trace policy and alert on repeated federation or break-glass denial. The development-header identity remains local-only. Plugin code, payloads, credentials, and draft content are likewise excluded.

Metrics deliberately omit tenant, organization, workspace, site, locale, operation, subject, request, URL, and free-form metadata dimensions. This prevents privacy leakage and unbounded series growth. Use protected logs/traces—not metric labels—for scoped investigation.

## Health semantics

- `GET /health` is liveness only and returns the stable service/status pair.
- `GET /ready` verifies schema readiness and returns only `ready` or `not_ready` with a stable reason code.
- `GET /api/v1/operations/observability` requires `operations.read`, uses `private, no-store`, and reports only whether signals are disabled, healthy, degraded, stopped, or unknown. It never returns endpoints, topology, exporter credentials, package versions, customer data, or failure messages.
- A configured Collector health failure reports `degraded` but does not fail API readiness or acknowledge/drop durable jobs. An invalid local SDK configuration fails startup; an unavailable remote Collector is an operational alert, not a content-plane outage.

## Retention and capacity policy

The application cannot enforce a vendor backend's deletion policy. Operators must configure and test the targets below, document the owner and legal basis, and verify deletion at least quarterly:

| Data | Hot/searchable | Maximum/default archive | Notes |
|---|---:|---:|---|
| OTLP application logs | 30 days | 90 days | Shorten when tenant identifiers are unnecessary; do not ingest bodies or credentials. |
| Traces | 7 days | 7 days | Sampling may reduce volume; never sample or replace durable audit based on traces. |
| Raw application/Collector metrics | 30 days | 30 days | No tenant identifiers; downsample aggregates for longer trends. |
| Downsampled metrics | 13 months | 13 months | Aggregate service-level capacity/SLO data only. |
| Collector persistent queue | Outage buffer, target less than 24 hours | Delete after successful export | Size from measured volume; alert at 80%, encrypt the volume, and never treat it as an archive. |
| Pino/container stdout | 14 days | 30 days | Apply equivalent redaction and backend access controls if shipped externally. |

Capacity limits in the reference config are safe starting values, not application benchmark claims. The M5-007 application-pipeline profiles and their network/deployment exclusions are published in [Release evidence, tested limits, and support](release-and-support.md). If the persistent queue approaches capacity, reduce nonessential sampling volume or add Collector capacity; never block content delivery on telemetry export.

## Runbook

### Collector or exporter degradation

1. Check the authorized observability endpoint and Collector health endpoint from the same private network as the service.
2. Inspect `otelcol_exporter_queue_size`, capacity, send failures, refused records, process memory, and backend status. Do not paste authorization headers or failed payloads into tickets.
3. Restore DNS/TLS/backend credentials or capacity. Confirm the queue falls and successful export counters advance.
4. If the queue threatens disk or service stability, set `GRIDSTORY_OTEL_ENABLED=false` and restart only the affected API/worker process. Durable jobs and audit remain intact; record the telemetry gap.
5. For suspected telemetry data exposure, disable export, revoke/rotate backend credentials, restrict backend access, identify affected retention partitions, purge under the incident policy, and preserve the separate audit evidence.

### API error rate or latency

1. Split the dashboard by stable `http.route`, method, response status, and service name. Never add raw URLs or tenant IDs as metric dimensions.
2. Correlate a bounded request ID or trace with protected logs, then check schema readiness, database health, dependency status, and recent deployment changes.
3. For 5xx, use `error.type`; exception messages and stack traces intentionally remain in protected Pino/application error handling rather than exported attributes.
4. Roll back the responsible release or disable the failing optional adapter. Verify the rate and p95 return below alert thresholds.

### Worker or queue failure

1. Inspect the tenant-scoped operations summary, job/dead-letter list, worker span outcome, and `operations.drain.completed` event.
2. Verify database leases, webhook/search/cache adapter health, retry/backoff state, and Collector health independently.
3. Correct the adapter or destination and replay through the authorized durable operation. Telemetry must never be used to infer that a job succeeded.
4. Confirm pending depth declines, no duplicate side effect occurred, and the alert clears.

### Verification after configuration change

1. Validate the pinned Collector image against `deploy/observability/otel-collector.yaml` with non-production endpoint credentials.
2. Start API and worker, call public health/readiness, then call the authorized observability endpoint.
3. Exercise one successful request, one denied request, and one worker drain. Confirm all three OTLP pipelines receive data and that logs/traces contain no query strings, headers, bodies, credentials, or draft content.
4. Import the dashboard and rules into staging, force an unreachable backend, and confirm degraded health, queue growth, and alerts without API readiness failure. Restore the backend and confirm recovery.
