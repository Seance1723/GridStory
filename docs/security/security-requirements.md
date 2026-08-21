# GridStory security requirements

These requirements are normative for GridStory code and supported production deployments. `SHALL` is mandatory, `SHOULD` is the expected default with a documented exception, and `MAY` is optional. The canonical requirement records, ASVS references, status, evidence, owner, threats, and delivery tasks live in [`security/asvs-v5.0.0-profile.json`](../../security/asvs-v5.0.0-profile.json).

The profile is Level 2-oriented because GridStory handles authenticated authoring, multi-tenant private drafts, privileged publication, private assets, and service integrations. It is not an ASVS certification. A production deployment must verify its own identity, infrastructure, transport, secret, data-protection, logging, and application-rendering controls.

## Security invariants

- Tenant scope SHALL be explicit in storage, API, cache, search, asset, event, job, audit, export/import, and telemetry contracts.
- Authorization SHALL be deny by default and checked at the trusted service/API layer for both function and object.
- Browser, server, worker, and React Server Component entry points SHALL remain explicit; secrets and privileged adapters SHALL not enter browser bundles.
- Preview credentials and draft/private content SHALL never enter published caches, public asset storage, public routes, analytics URLs, or ordinary delivery responses.
- Published delivery SHALL resolve exact published revisions only. Management, GraphQL, preview, private asset, audit, workflow, and operational responses SHALL use private, no-store caching.
- GridStory SHALL store validated structured data and code-owned component identifiers; it SHALL never execute editor-authored JavaScript.
- Security-critical verification SHALL fail closed. A scanner, identity verifier, signature check, authorization decision, import check, or release validation failure SHALL not silently permit the protected action.
- Stable security identifiers (`GS-SEC-###` and `THREAT-####`) SHALL not be recycled.
- Arbitrary plugin packages SHALL never be imported into the control-plane process; plugin authority SHALL cross a versioned, tenant-scoped, capability-mediated external-runtime boundary.

## Data classification

| Class | Examples | Required protection |
|---|---|---|
| Public | Published content, published routes, public component/schema metadata intended for delivery | Integrity, exact tenant/revision cache keys, availability, safe rendering. Public caching is allowed only for exact published responses. |
| Internal | Non-sensitive configuration metadata, health/readiness summaries, aggregate operational counts | Authenticated access unless explicitly public; no unnecessary implementation detail. |
| Confidential | Drafts, revision history, workflows, releases, preview data, private assets, user attributes, search/index state, job payloads, audit exports, logical archives | Least privilege, complete tenant scope, private/no-store delivery, protected transport/storage, controlled export and retention, log minimization. |
| Restricted secret | OIDC/session material, service tokens, preview/cursor/asset/webhook signing keys, database/object-store credentials | Approved secret manager, least privilege, never logged or placed in URLs/source/build artifacts, independent purpose, rotation and emergency revocation. |

Published status does not remove integrity or tenant-isolation requirements. A customer's content classification may be stricter than this baseline.

Publisher public keys are integrity trust configuration; private publisher keys remain outside GridStory and are restricted secrets. Plugin manifests, grants, configuration, and lifecycle history are confidential management records even when the plugin package is publicly distributed.

## Identity, sessions, and authorization

- `GS-SEC-013`: production authentication SHALL replace development identity headers and verify every documented user/service path consistently, including issuer namespace, signature, audience, time, nonce/replay semantics, and required authentication strength.
- `GS-SEC-014`: production sessions SHALL use backend verification, at least 128 bits of CSPRNG entropy, documented idle/absolute lifetimes, rotation, logout, expiry, account-disable, and administrative revocation.
- `GS-SEC-015`: every non-public operation SHALL authorize both the action and object against complete organization, tenant, workspace, site, environment, and locale scope. No role/grant match means deny.
- Service-account grants SHALL be least privilege, tenant scoped, expiring where practical, hashed at rest, revocable, and attributable in audit/security events.
- High-value workflow and release operations SHOULD use distinct permissions and separation of duties. Expected revisions and policy snapshots SHALL prevent stale or reordered approval.

M6-002 adds a production-selectable API identity boundary and a framework-neutral durable identity kernel. Maintained OIDC/SAML/WebAuthn adapters pass only verified results inward; SQLite/PostgreSQL persist hashed opaque sessions, directory lifecycle, group mappings, challenges, authenticators, break-glass records, and security events. [Enterprise identity and access](../identity-and-access.md) documents configuration and the exact deployment evidence that remains.

## Input, content, and browser safety

- `GS-SEC-001`: every untrusted input SHALL pass a positive schema or explicit allow-list at a trusted boundary. Client-side checks are usability only.
- `GS-SEC-002`: all database statements SHALL be parameterized.
- `GS-SEC-003`: structured content and application-owned rendering SHALL use context-appropriate encoding/sanitization; unsafe rich-text, URL, Markdown/template, and CSS contexts require an explicit policy.
- `GS-SEC-004`: SVG SHALL be conservatively sanitized or rejected before delivery.
- Mutation handlers SHALL select allowed fields explicitly; arbitrary object binding and prototype-sensitive path segments are prohibited.
- `GS-SEC-008`: CORS and preview messaging SHALL enforce exact configured origins; postMessage SHALL enforce source, origin, and message schema.
- `GS-SEC-009`: production HTML and sensitive files SHALL use reviewed CSP, nosniff, anti-framing, referrer, and resource policies appropriate to intentional preview embedding.
- The project SHALL keep the supported browser/security matrix and repository evidence in `docs/accessibility-and-compatibility.md`; each production application SHALL separately verify its exact components, CSP/headers, target browsers, operating systems, and assistive technologies.

## API, query, file, and archive safety

- REST and GraphQL SHALL use bounded bodies and stable generic error envelopes.
- `GS-SEC-011`: GraphQL SHALL bound depth, amount, aliases, and execution cost. Batching and subscriptions remain disabled unless separately threat-modeled. Production introspection requires an explicit decision.
- Signed cursors SHALL be purpose-, scope-, perspective-, filter-, sort-, projection-, and expiry/version-bound as applicable and verified in constant time.
- `GS-SEC-012`: uploads SHALL have documented permitted types and limits, exact multipart descriptor checks, byte/signature validation, internally generated keys, quarantine, malware policy, and safe download headers.
- Production asset processing SHALL set byte, part, pixel, decompression, file-count, per-tenant storage, concurrency, and timeout limits. Missing mandatory malware scanning SHALL fail closed.
- Logical archives SHALL verify format/schema versions, exact scope, per-record and aggregate checksums before mutation, support dry-run/conflict reporting, and roll back atomically. Archive bytes, records, nesting, and processing time SHALL be bounded.
- Whole-database backups SHALL use a database-native consistent format, be classified as confidential across all tenants, exclude credentials from names/manifests/process arguments, carry a verified format/size/SHA-256 manifest, and be encrypted in protected off-host storage with explicit access, retention, and restore approval. Restore SHALL use an isolated absent/empty target and pass database integrity, required-table, readiness, audit, and representative content checks before cutover.

## Preview, tokens, caching, and delivery

- `GS-SEC-016`: every self-contained grant SHALL use a fixed approved MAC/signature algorithm, trusted purpose-specific key, verification before claim use, explicit audience/purpose, exact relevant scope, bounded lifetime, and constant-time comparison.
- Preview grants SHALL be short lived, origin/route/mode/scope bound, revocable, and replay checked. Preview applications SHALL not load published delivery while an authenticated draft session is active.
- Private asset grants SHALL be short lived, scope/asset/revision bound, and recheck immutable security verdict and storage scope when read.
- `GS-SEC-024`: draft/private responses SHALL be private, no-store. Public cache tags/keys SHALL include complete scope and exact revision/perspective semantics; invalidation SHALL never be derived from caller-only scope.
- Published caches SHALL never contain credentials, preview data, draft content, private assets, audit data, job payloads, or administrator responses.

## Jobs, integrations, and external requests

- `GS-SEC-005`: outbound URLs SHALL use explicit protocol/host policy, reject embedded credentials and private/reserved destinations, avoid redirects by default, and be revalidated at execution. Production egress and DNS controls SHALL enforce the same or stricter allow-list.
- `GS-SEC-021`: every adapter SHALL document complete tenant scope, authentication, least privilege, destinations, connection/concurrency limits, timeouts, retry/backoff, failure behavior, and health signals.
- Content writes SHALL use a transactional outbox. Jobs SHALL carry bounded payloads and complete scope, use owner-checked expiring leases and full-scope idempotency keys, and preserve immutable failure/replay history.
- Search/index adapters SHALL key by complete scope and perspective. Incremental jobs SHOULD carry identifiers instead of draft content and reload under the claimed scope.
- Webhooks SHALL use TLS, HMAC over timestamp plus exact raw body, immutable delivery/event identifiers, bounded response time, and no redirects. Receiver documentation SHALL require freshness and delivery-ID deduplication.
- Security-sensitive adapters SHALL fail closed; availability fallbacks SHALL not weaken authorization, tenant, integrity, or confidentiality decisions.

## Plugin packages and runtimes

- `GS-SEC-030`: installation SHALL verify a publisher-bound Ed25519 signature over canonical metadata and the exact SHA-256 artifact digest before using claims from the manifest.
- Signed SDK/protocol compatibility SHALL be checked before installation; an unknown/revoked key, invalid signature, digest mismatch, or incompatible version SHALL fail closed.
- A tenant grant SHALL be an explicit unique subset of requested capabilities. It SHALL NOT remove a signed constraint or broaden its content-type, network-host, secret-name, or event-type allow-list.
- Plugin management and invocation SHALL authorize separate actions against complete tenant scope. Only an enabled, healthy server runtime may receive a declared operation under one granted capability.
- The control plane SHALL NOT import or evaluate arbitrary plugin modules or expose database handles, ambient credentials, unrestricted filesystems, child-process authority, or internal service objects.
- Server code SHALL execute in an operator-provided external process/container boundary. The protocol SHALL bound JSON input/output, rate, and time; the deployment SHALL separately bound OS identity, filesystem, network, CPU, memory, and processes.
- `PluginTestHarness` SHALL be used only with trusted test fixtures and SHALL NOT be represented as a production sandbox.
- Lifecycle install, enable, disable, revoke, and uninstall events SHALL retain actor, reason, and timestamp. Disabled/revoked/uninstalled plugins SHALL not accept new invocations.
- A Studio loader, when delivered, SHALL use a sandboxed cross-origin frame/worker and validate every versioned message without exposing host DOM/session authority. M5-003 validates metadata only; it does not ship that loader.

## Cryptography, secrets, and transport

- `GS-SEC-018`: deployments SHALL inventory each key, secret, certificate, algorithm, owner, purpose, storage location, rotation period, revocation procedure, and prohibited use.
- Preview, cursor, asset-delivery, webhook, session, and service credentials SHALL use separate high-entropy secrets. One secret SHALL NOT be silently reused across purposes.
- `GS-SEC-019`: implementation cryptography SHALL use maintained platform libraries, approved SHA-256/HMAC-SHA-256-or-stronger primitives, CSPRNGs for unpredictable values, and constant-time comparisons.
- Secret values SHALL come from a production secret manager, never source control or build artifacts; access SHALL be least privilege and rotations SHALL be exercised.
- `GS-SEC-020`: production client, external, database, storage, IdP, monitoring, and service-to-service connections SHALL use TLS 1.2/1.3 or a stronger appropriate encrypted protocol without plaintext fallback and with certificate validation.

## Logging, error handling, and operations

- `GS-SEC-028`: a maintained log inventory SHALL define event, metadata, format, sink, access, retention, correlation, and alerting. At minimum cover authentication, failed authorization, privileged mutation, publication, workflow/release, import/export, credential lifecycle, adapter failure, and control bypass.
- Logs and traces SHALL NOT contain secret values, raw bearer/signed grants, unnecessary draft content, private asset bytes, archive contents, or sensitive user attributes. Required sensitive references SHALL be masked, hashed, or stable opaque identifiers.
- Audit history SHALL remain tenant scoped and hash chained; verification/export access SHALL be administrator-only. Production security logs SHOULD be shipped to a separately protected system because an in-database hash chain is tamper-evident, not deletion-proof.
- `GS-SEC-029`: unexpected errors SHALL return a generic stable response with a request ID and SHALL fail closed. Internal detail belongs only in protected, redacted logs.
- Health/readiness endpoints SHALL reveal only the minimum operational status and SHALL not expose secrets, version inventory, topology, or customer data.

## Secure development and release

- Threat-model and ASVS profile changes SHALL accompany new boundaries, sensitive data, external communication, authentication/authorization, cache/preview, file/import, job, logging, or deployment behavior.
- `GS-SEC-025`: before GA the project SHALL publish vulnerability reporting/remediation timeframes, a current SBOM, trusted dependency policy, artifact provenance, signatures, and verification steps.
- `GS-SEC-026`: before GA the project SHALL publish tested body, query, upload, archive, history, queue, retry, concurrency, and retention limits.
- Security fixes SHALL include focused regression tests where mechanically testable. Critical/high defects SHALL be entered in `BUGS.md` before fixing and linked to their task/changelog entry.
- `pnpm security:check` SHALL pass in the root validation path. Passing shape validation is necessary but does not replace code review, abuse testing, dependency analysis, deployment verification, or penetration testing.

## M5-002 tenant-isolation baseline

The application now has one canonical six-dimensional scope contract for validation, collision-safe keys and paths, cache prefixes, adapter checks, and telemetry envelopes. Storage and repository records, assets, audit events, search results/status, outbox claims, durable jobs, webhook deliveries, cache invalidations, and emitted telemetry fail closed when their returned or embedded scope differs from the request. OIDC roles are materialized as tenant-bound assignments, and service-account grants must name the account tenant.

Search adapter totals and facets are treated as untrusted: entries are reloaded under the requested scope and perspective, totals and facets are derived only from accepted hits, and mismatched adapter scope/status is rejected. Cache invalidation adapters receive both the explicit scope and full-scope-prefixed tags; workflow-provided tags are namespaced rather than accepted globally. `pnpm tenant:check` prevents ad hoc scope serializers and incomplete cache tags from returning.

Production identity mode now rejects development actor/role headers and requires a backend-verified session; the local mode remains explicit. Repository evidence covers the application boundary, but trusted-proxy/TLS enforcement, customer-IdP interoperability, secret-manager lifecycle, infrastructure row/object policy, and deployment conformance remain unmet `BETA-003`/`RC-006` evidence. M5-004 supplies the telemetry boundary and reference operations pack described below.

## M5-004 observability baseline

The Node API and worker now adapt the canonical bounded tenant envelope to opt-in OpenTelemetry logs, metrics, and traces through the official OTLP/HTTP SDK/exporters. Explicit request and worker instrumentation records route templates, status, stable error types, request/trace correlation, and validated tenant event attributes without raw URLs/query strings, headers, bodies, exception messages, credentials, draft content, or tenant metric dimensions. Live exporter regressions verify all three signals and negative leakage cases.

Public liveness/readiness expose only stable minimal codes. Authorized private/no-store operations health reports bounded SDK/Collector state without endpoints, topology, versions, credentials, customer data, or failure text; Collector degradation does not weaken or acknowledge content operations. The reference contrib Collector adds memory bounds, batching, retry, a persistent queue, a fail-closed attribute allow-list, and private health/internal metrics. Dashboard, alert rules, event inventory, access, correlation, default retention targets, and exporter/data-exposure incident procedures are maintained in `docs/observability.md` and `deploy/observability`.

`GS-SEC-028` is verified for current product capabilities. M6-002 adds ordered tenant events for federation success/denial, user/group lifecycle, mapping, sessions, WebAuthn, and break-glass creation/failure/activation/revocation; credential values, assertion bodies, and public keys are excluded from event metadata. Backend deletion enforcement, database append-only policy, TLS/network policy, secret-manager lifecycle, event-export wiring, and deployed Collector conformance remain operator evidence; M5-005 retains recovery guidance, M5-007 publishes the repository capacity/supply-chain process, and the M5-008 no-go review records the missing hosted/deployment verification.

## M5-005 recovery and rollout baseline

The Node operations boundary creates consistent SQLite `VACUUM INTO` snapshots or PostgreSQL custom-format logical dumps, verifies a minimal sidecar manifest plus SHA-256 and native format/integrity checks, keeps PostgreSQL credentials out of arguments and manifests, and restores only to an absent SQLite path or explicitly confirmed empty PostgreSQL GridStory target. Live-WAL SQLite and disposable PostgreSQL regressions prove backup-before-mutation restores the earlier application state. `THREAT-0024` models the whole-database artifact and protected-storage boundary.

Production PostgreSQL PITR remains a database/platform control using physical base backups and an unbroken continuous-WAL archive; provider storage, keys, access logging, retention, and physical restore evidence are not certified by the repository. The application adds bounded first-signal drain, timeout/second-signal force behavior, interruptible worker polling, and an exact current/candidate health/readiness preflight. The deployment still owns traffic removal, termination grace, shared-database proof, expand/contract migration sequencing, canary observation, artifact rollback, and provider-specific recovery drills.

## Verification ownership

| Area | Primary owner | Required evidence before v1 GA |
|---|---|---|
| Cross-tenant authorization and data paths | Authorization/control-plane owner | `packages/core/test/tenant-isolation.test.ts`, repository conformance, and `pnpm tenant:check`; deployment database/object policies remain environment evidence. |
| Production identity/session/proxy | Identity/API/deployment owner | OIDC and persistent-session conformance, dev-header rejection, trusted-proxy tests. |
| Browser/rendering | Studio/application owners | M5-006 repository CSP/header/rendering/browser review; deployed-header and independent assistive-technology acceptance remain `BETA-003`, `BETA-005`, and `RC-005`. |
| Operations, secrets, and telemetry | Platform/security operations owner | M5-004 inventory, redaction, alerts, retention, and telemetry health; secret lifecycle and deployment evidence remain `BETA-003`, `RC-006`, and `GA-003`. |
| Recovery and deployment | Reliability/deployment owner | M5-005 restore, graceful shutdown, rolling upgrade, and secret rotation exercises. |
| Limits and supply chain | Release engineering owner | Maintain M5-007 limits/benchmarks/SBOM/vulnerability/provenance workflows; hosted and deployment evidence remain unmet `RC-004`/`RC-006`. |
| GA risk acceptance | Security owner and release owner | Resolve `RC-005`/`GA-001`, retain the current model/profile, close critical risks, and explicitly time-bound any accepted high risk. |
