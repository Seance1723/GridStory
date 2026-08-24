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

## Guarded data governance

- `GS-SEC-031`: governance reads, policy, subjects, links, holds, restrictions, rights requests, exports, plans, approvals, execution, receipts, and events SHALL carry the complete tenant scope, use distinct deny-by-default permissions, and remain private with `no-store`.
- Subject access/export/erasure SHALL inventory only explicit resource links. Missing discovery, external resources, or an unavailable processor SHALL be reported as blockers rather than silently omitted or treated as completed.
- Active legal holds and processing restrictions SHALL dominate retention and erasure both when a dry-run plan is created and immediately before every effect. A release SHALL require a new plan.
- Irreversible execution SHALL require another authorized administrator, a fresh server-validated enterprise session, the exact SHA-256 plan digest, recent verified coordinated-backup evidence, and execution-time plan/policy/resource/key/placement revalidation with a bounded receipt.
- Customer-managed key integration SHALL store opaque references only, bind wrap/unwrap to tenant/request context, use fresh authenticated export envelopes, avoid plaintext DEK persistence, and SHALL NOT grant GridStory key creation/rotation/disablement/destruction/recovery authority.
- Residency policy SHALL compare explicit allowed locations to adapter attestations and fail closed when required evidence is unknown or disallowed. A configured label SHALL NOT be represented as migration, routing, replication, or legal compliance proof.

The implementation, limitations, operator workflow, and recovery boundary are documented in [Data governance and guarded erasure](../data-governance.md). `THREAT-0025` owns irreversible-loss, overbroad-export, hold-bypass, approval, key, and placement abuse cases.

## Guarded CMS migration

- `GS-SEC-032`: CMS source adapters SHALL be composed only by the trusted server runtime, use read-only least-privilege credentials, accept credential-free configured HTTPS origins, disable redirects, reject cross-origin pagination/continuation, bound response bytes and records, validate normalized records, and keep credentials and raw private content out of client responses, errors, and telemetry.
- Recipes, projects, source links, dry-run plans, mapped private plan data, checkpoints, runs, and cutover reports SHALL carry the complete organization, tenant, workspace, site, environment, and locale scope; management routes SHALL use distinct deny-by-default read/manage/execute permissions and `private, no-store` responses.
- A target mutation SHALL require an unexpired exact SHA-256 plan digest and unchanged project, recipe, source record, and target revision evidence. The service SHALL persist a deterministic pending link before mutation, recover checksum-identical partial writes, finalize receipts before checkpoint advancement, and return the same completed receipt on retry.
- Every target create, update, and publication SHALL pass the normal schema, reference, route, workflow, quality, governance, revision, and publication gates. Manual target drift, source drift, invalid mapping, unsupported media, incomplete snapshots, missing targets, and stale publication SHALL fail closed.
- Source deletion or unpublish SHALL NOT automatically delete or unpublish target content. It SHALL appear as a blocker requiring an independently reviewed retention/editorial decision.
- Cutover validation SHALL use a complete full reconciliation and describe only observed mapped-content currency/publication. It SHALL NOT change DNS, CDN, routers, application configuration, or source state and SHALL NOT claim media, SEO, analytics, identity, legal, infrastructure, or decommissioning readiness.

The operator boundary, provider setup, rollback sequence, and claim limits are documented in [CMS migration and cutover](../migration-and-cutover.md). `THREAT-0026` owns source credential/SSRF/exhaustion abuse, and `THREAT-0027` owns drift, retry, destructive reconciliation, and false-readiness abuse.

## Evidence-bound plugin marketplace

- `GS-SEC-033`: marketplace publisher, release, review, and decision state SHALL carry the complete organization, tenant, workspace, site, environment, and locale scope; management responses SHALL be private/no-store and use distinct deny-by-default read/manage/review permissions, with plugin management additionally required for installation.
- Publisher registration SHALL validate stable identities, registrable domain ownership links, and Ed25519 public verification keys. Verification SHALL require an unpredictable exact-name DNS TXT token before its bounded expiry plus a different authenticated human reviewer with an evidence reference and reason. Suspension SHALL immediately remove marketplace trust.
- Marketplace discovery, compatibility ranges, tested-runtime links, support status/policy/contact, requested capabilities, exact package digest/size, publisher/key, and version SHALL be covered by the publisher signature. A submitted plugin/version SHALL be immutable.
- Automated review SHALL never import or execute the package. It SHALL fail closed without a configured trusted inspector and bind current exact digest/size, safe archive inventory, SPDX SBOM, provenance subject, malware, vulnerability, and license evidence to a stable inspector version/reference. Adapter errors and missing/stale/mismatched/unsafe evidence SHALL block approval.
- Release approval SHALL require the latest current passing review and an authenticated approver distinct from submission and automated-review actors. Rejected/yanked history SHALL be retained. Installation SHALL revalidate current publisher/key/review/release state, invoke the existing signed installer disabled, and SHALL NOT grant capabilities automatically.
- Interfaces SHALL distinguish DNS possession, human identity approval, cryptographic authorship/integrity, automated evidence, publisher-declared support, release approval, installation, capability grants, and runtime isolation. No badge, provenance, or scan SHALL be represented as proof of package safety.

The implementation, limits, operator workflow, incident response, and recovery boundary are documented in [Evidence-bound plugin marketplace](../marketplace.md). `THREAT-0028` owns publisher identity/key/trust abuse, while `THREAT-0029` owns forged, stale, incomplete, or overtrusted package-review evidence.

## Consent-aware personalization

- `GS-SEC-034`: purposes, attributes, audiences, decisions, draft/published revisions, and management responses SHALL carry complete organization, tenant, workspace, site, environment, and locale scope; read/manage/preview permissions SHALL be deny-by-default and management/preview SHALL remain private with `no-store`.
- Every runtime attribute SHALL be declared as a boolean or bounded enum with source, classification, purposes, and cacheability. Personal attributes SHALL require declared purposes and SHALL NOT be shared-cache inputs. Authentication state SHALL remain private-cache only. Unknown keys, values, types, and purposes SHALL fail closed.
- Missing or explicitly denied required consent SHALL prevent a condition match. A received GPC signal SHALL suppress only purposes explicitly configured to honor it; GridStory SHALL NOT represent that switch as a universal legal interpretation.
- Draft preview SHALL accept only hypothetical bounded inputs or declared overrides, SHALL NOT look up or persist a subject/profile, SHALL omit raw values from its trace, and SHALL never change published state or prime a published cache.
- Publishing SHALL copy only the exact optimistic draft revision. Anonymous decisions SHALL read only the published snapshot, use unique-priority deterministic first-match rules with a required fallback, and SHALL NOT perform random or sticky experiment allocation.
- Shared-cache guidance SHALL be emitted only when every possible decision input is public, bounded, consent-independent, and explicitly eligible. The key SHALL include complete scope, locale, published revision, resource, and every varying input. All other decisions SHALL be private or no-store, and the decision POST response itself SHALL remain private/no-store.

The configuration, integration contract, privacy boundary, cache rules, recovery, and rollback guidance are documented in [Consent-aware personalization and targeting](../personalization.md). `THREAT-0030` owns overcollection, consent/GPC bypass, draft leakage, scope confusion, and incomplete cache keys.

## Governed content experiments

- `GS-SEC-035`: experiment designs, lifecycle evidence, aggregate snapshots, guardrail decisions, promotions, and management responses SHALL carry complete organization, tenant, workspace, site, environment, and locale scope. Read, manage, metric-recording, and promotion permissions SHALL be distinct and deny by default; management SHALL remain private/no-store.
- A design SHALL have bounded unique variants whose positive basis-point weights total exactly 10,000, exactly one primary metric, bounded sample/allocation thresholds, a declared purpose, and valid published targeting references. Only drafts may change. Start SHALL pin the exact published targeting revision and reject active overlap at one resource/audience placement.
- Participation SHALL require a random per-experiment UUID supplied by the application only after purpose grant. GridStory SHALL use it only for deterministic scope/experiment/revision allocation, SHALL NOT persist or echo the token, bucket, or raw context, SHALL set no assignment cookie, and SHALL return private/no-store guidance. Missing/denied purpose, applicable GPC, targeting ineligibility/drift, and inactive state SHALL return the ordinary published-targeting baseline without participation.
- Metric input SHALL contain bounded complete aggregates for every declared variant and metric, an immutable snapshot/evidence identity, and an evidence SHA-256 digest. GridStory SHALL expose no raw exposure/conversion event or subject-row ingestion route. Allocation deviation, per-variant sample minima, and absolute guardrails SHALL be enforced; a failed snapshot SHALL pause a running experiment.
- Promotion SHALL require a completed experiment, elapsed duration, a retained passing snapshot, acceptable allocation and samples, unchanged published/draft control targeting, and an explicit non-control treatment whose primary aggregate improves in the declared direction. Promotion SHALL atomically change only a new targeting draft revision, retain actor/reason/evidence history, and SHALL NOT publish, automatically choose a winner, or claim statistical significance.

The integration, metric-evidence, lifecycle, recovery, rollback, and statistical-claim boundaries are documented in [Governed content experiments](../experiments.md). `THREAT-0031` owns assignment-token misuse, lifecycle/design tampering, invalid aggregate evidence, allocation/guardrail bypass, and unsafe winner promotion.

## Bounded content analytics

- `GS-SEC-036`: public analytics SHALL accept only the closed content-view, component-view, and component-interaction union. Complete organization, tenant, workspace, site, environment, and locale scope SHALL come only from validated delivery context; an explicit configured-purpose grant is mandatory and a received GPC signal SHALL suppress acceptance.
- Public events SHALL use bounded UUID/time/token fields, SHALL reference the exact current published content ID/type/revision, and SHALL NOT accept visitor/account/session/assignment IDs, URL/referrer/IP/user-agent/device values, draft/preview data, arbitrary event names, or property bags. Age, future skew, aggregate cardinality, receipts, annotations, and report size SHALL be bounded with explicit truncation.
- Server lifecycle evidence SHALL originate only from the complete-scope transactional outbox. Release publication/rollback annotations SHALL be enqueued only after authoritative persistence, SHALL be described as correlation rather than causality, and analytics failure SHALL NOT reverse content or release state.
- Processing SHALL be idempotent and complete-scope. Each injected adapter SHALL receive an independent leased/retried/dead-lettered/replayable job; provider credentials SHALL remain outside schema/core, and thrown adapter detail SHALL be replaced by a stable generic error before durable retention.
- Analytics reports SHALL require `operations.read`, remain private/no-store, omit raw evidence and private event receipt IDs, and expose bounded aggregate plus adapter-job health. Deployments SHALL own consent/legal interpretation, public rate controls, provider TLS/egress/timeout/credential/idempotency policy, protected diagnostics, retention/deletion/access controls, data quality, attribution, statistics, and causal use.

The event contract, adapter composition, aggregate limits, recovery, rollback, and interpretation boundaries are documented in [Bounded content analytics](../analytics.md). `THREAT-0032` owns fabricated/identifying/replayed evidence, consent/scope/published-revision bypass, cardinality exhaustion, adapter leakage/unavailability, and false release-causality claims.

## Governed AI gateway

- `GS-SEC-037`: AI policy, prompt registry, budgets, state history, and usage receipts SHALL be stored under complete organization, tenant, workspace, site, environment, and locale scope. `ai.read`, `ai.manage`, and `ai.execute` SHALL be distinct private permissions; delivery and anonymous roles SHALL have no AI access.
- Prompt versions SHALL be immutable and active pointers explicit. Every request SHALL select one enabled prompt-allowed provider/model, use a one-time UUID, and remain bounded by prompt/model input, output, cost, timeout, source, field, and text limits.
- Retrieval SHALL accept explicit source IDs only. Every source SHALL be reauthorized with `content.read` for the configured draft/published perspective, match exact complete scope and configured content type, and expose only positive allowlisted field paths. Ambient search, wildcard fields, relation traversal, preview credentials, and published-cache writes SHALL NOT occur.
- Fixed instructions, user input, and selected source fields SHALL remain structurally separate. Recognized credentials, email, phone, and IP values SHALL be redacted before provider egress; output SHALL be strictly validated, redacted again, marked untrusted, and SHALL have no tool, content-write, publication, or automatic-approval path.
- Provider adapters SHALL be injected only in trusted server composition. Provider requests SHALL omit tenant routing and credentials; exceptions SHALL become generic responses; timeouts SHALL abort where supported; provider estimates/results SHALL be validated; and provider-specific SDKs, credentials, diagnostics, retention, training, regional, egress, and billing truth SHALL remain outside schema/core and persisted invocation history.
- Request, estimated input, maximum output, and conservative cost SHALL be atomically reserved before execution. Duplicate IDs and exhausted daily budgets SHALL fail closed; failure or invalid/over-reservation results SHALL retain the reservation; successful usage MAY reconcile downward. Receipts SHALL retain metadata only and histories SHALL be bounded.
- Enabled state and exact active prompt/model SHALL be checked before retrieval, during reservation immediately before provider execution, and during atomic success settlement. A disablement or incompatible policy change during execution SHALL discard output and mark the metadata receipt failed.

The provider contract, route sequence, retrieval semantics, budget accounting, recovery behavior, and limitations are documented in [Governed AI gateway](../ai-gateway.md). `THREAT-0033` owns injection, scoped-source leakage, replay, model/prompt bypass, unbounded spend, provider leakage/unavailability, malformed metering/output, and stale kill-switch races.

## Reviewed AI authoring and semantic search

- `GS-SEC-038`: Authoring policy, evaluated proposals, provenance, and review evidence SHALL use complete-scope optimistic bounded persistence, private/no-store routes, disabled defaults, and fixed top-level text/slug target allowlists. Raw provider JSON, rendered prompts, source values, diagnostics, hidden reasoning, semantic queries, embeddings, and vectors SHALL have no persistence path.
- Generation SHALL require `ai.execute`, a known enabled action and active prompt/model, exact current saved draft, ordinary target/source reads, a complete fixed `gridstory.authoring-suggestions.v1` result, unique declared changes, complete candidate validation, and every deterministic rule. Failure SHALL produce no approvable proposal.
- `ai.review` SHALL be distinct from execute/manage, granted by default only to publisher/admin users, rejected for service-account/anonymous principals, allowed once only for a passed pending proposal, and recheck the target revision. Approval SHALL NOT save content, transition workflow, satisfy workflow approval, or publish. Studio handoff SHALL be visibly unsaved.
- Semantic indexing SHALL reuse identifier-only durable search jobs, re-resolve authoritative content, select and redact only positive configured top-level text/slug fields, bound source text, call only the configured injected tenant-aware adapter/model, and treat all adapter indexes/vectors as derived rebuildable state.
- Semantic queries SHALL be private, bounded, redacted, and non-persistent. Complete results SHALL fail closed on adapter/model/scope/perspective/index mismatch, duplicate or non-finite hits, disallowed fields, stale revisions, or failed ordinary content authorization. Adapter diagnostics SHALL be generic at retained boundaries.

The full lifecycle, adapter contract, route sequence, recovery behavior, removal order, and limitations are documented in [Reviewed AI authoring and private semantic search](../ai-authoring-and-semantic-search.md). `THREAT-0034` owns proposal poisoning, non-human or replayed review, stale handoff, sensitive-field indexing, semantic poisoning/scope bleed, stale/hostile hits, and derived-index recovery assumptions.

## Regional published delivery and reviewed failover

- `GS-SEC-039`: Regional policy, replica evidence, consistency indicators, backup attestations, and failover plans/results SHALL use complete organization, tenant, workspace, site, environment, and locale scope; bounded optimistic persistence; private/no-store management; disabled defaults; and distinct `regional.read`, `regional.manage`, and `regional.failover` authorization.
- The trusted server runtime SHALL select its local deployment region and inject capability-limited published-read/failover adapters. Public callers SHALL NOT select a region. Regional readers SHALL expose no draft, preview, write, workflow, identity, asset, job, or arbitrary repository authority.
- A bounded-staleness read SHALL require exact adapter, complete/base scope, served region, replica role, topology, current observation, finite policy-bounded lag, opaque watermark, residency reference, and published result validation. Missing or hostile evidence SHALL follow only the configured explicit primary fallback or unavailable path. Shared caching SHALL require complete scope/region/consistency/topology/content-revision partition evidence; otherwise the response SHALL be private/no-store.
- Public indicators SHALL contain only bounded region, role, consistency, observation, lag, topology, content-revision digest, cache mode, fallback status, and an optional watermark digest. Provider credentials, raw positions, diagnostics, preview credentials, and drafts SHALL NOT enter public bodies, headers, caches, logs, or persisted regional state.
- Failover SHALL require current source/target residency, fresh verified backup evidence, exact readiness, an expiring scope/topology/RPO/RTO/reason-bound digest, a different recently reauthenticated human, and optimistic current state. Planned mode SHALL require caught-up zero-loss evidence; emergency mode SHALL require an explicit nonzero RPO covering observed loss and explicit data-loss acceptance.
- Execution SHALL persist before provider effects, reuse the request UUID as the idempotency key, retain uncertain or malformed outcomes as ambiguous, and require reconciliation before later transitions. Success SHALL require an exact adapter result proving the source non-writable and target writable before advancing topology and resetting reads to primary-only.

The adapter contracts, headers, cache requirements, operational runbooks, recovery scope, rollback order, and limitations are documented in [Regional published delivery and reviewed failover](../regional-delivery-and-failover.md). `THREAT-0035` owns region/scope spoofing, stale or hostile replica evidence, cache confusion, residency/RPO/approval bypass, duplicate or ambiguous effects, split brain, and provider-detail disclosure.

## Contract-bound content federation and syndication

- `GS-SEC-040`: Federation offers, consumer agreements, mirror records, plans, tombstones, and receipts SHALL use complete organization, tenant, workspace, site, environment, and locale scope; bounded optimistic memory/SQLite/PostgreSQL persistence; private/no-store management; no-store public delivery; disabled defaults; and distinct `federation.read`, `federation.manage`, `federation.consume`, and `federation.sync` authorization.
- Producers SHALL allowlist exact supported deployed schema versions/fingerprints and emit only exact published revisions in an Ed25519-signed canonical envelope. Drafts, preview grants, credentials, assets, components/code, relations, rich text, workflow state, and unsupported schema features SHALL NOT enter offers or records. Private signing keys SHALL remain outside schema, persistence, browsers, responses, logs, and ledgers.
- Consumers SHALL pin a configured adapter, complete source scope, source instance, canonical base, offer ID/version/digest, Ed25519 public key, namespaced type versions/fingerprints, attribution terms, and live/mirror mode. Every envelope SHALL match its fresh request ID, bounded issue/expiry time, exact scope/instance/offer/type/requested identity, monotonic source revision, checksum, mandatory attribution, and complete-snapshot checkpoint before use.
- The maintained HTTP source SHALL accept only a deployment-configured credential-free HTTPS origin, disable redirects, reject changed response origin, send complete source scope, bound timeout/bytes/records, parse JSON only, and expose generic failures. Public callers SHALL NOT provide an origin, credential, remote scope, key, or arbitrary source query.
- Every public record SHALL include a canonical source URL, license URL, credit text, attributed agents, and exact source entry/revision/sequence, offer, and type identities. These SHALL be described as source assertions rather than rights verification. Public output SHALL omit complete remote scope, adapter configuration, key body, credentials, and raw evidence/errors.
- Live mode SHALL retain no remote record. Mirror mode SHALL keep a separate read-only projection, require an expiring digest-reviewed exact-effect preview, revalidate source/agreement/offer/type/checkpoint during execution, persist executing first, apply atomically and idempotently, block revision regression or same-sequence mutation, and represent reviewed disappearance as a tombstone rather than editing/deleting ordinary local content.

The full composition, operator sequence, routes, recovery/removal order, and limitations are documented in [Contract-bound content federation and syndication](../content-federation-and-syndication.md). `THREAT-0036` owns source/key/scope/schema/revision spoofing, draft leakage, attribution tampering, SSRF/redirect/diagnostic exposure, replay, resource exhaustion, unsafe mirror overwrite/withdrawal, and public contract leakage.

## Derived knowledge and reviewed agent draft operations

- `GS-SEC-041`: Graphs and recommendations SHALL be private/no-store, derived from authoritative current content, complete-scope, revision-bound, cycle-safe, finitely bounded, per-entry authorized, explicitly truncated, and deterministic. Every recommendation score SHALL equal its visible relation/taxonomy/type/path contributions; identity, behavior, analytics, semantic, model, popularity, exploration, and hidden signals SHALL NOT participate.
- Agent policy/plans/reviews/execution/receipts SHALL use bounded optimistic memory/SQLite/PostgreSQL state, remain disabled by default, and require distinct `agent.read`, `agent.manage`, `agent.plan`, `agent.review`, and `agent.execute` authority. Graph reads SHALL separately require `knowledge.read` plus ordinary per-entry `content.read`.
- An injected runtime SHALL match one enabled model and exact active immutable governed prompt. It SHALL receive only a redacted bounded goal, one exact draft target, and positively allowed strict `content.get`, `graph.explore`, and `recommendation.list` callbacks. Every call SHALL be parsed, counted, authorized, time/byte bounded, and retained only as metadata digests. Repository/database/network/credential/plugin/filesystem/shell/write/workflow/release/publication authority SHALL NOT be supplied.
- Runtime output SHALL use the fixed single-draft plan contract, target the exact current revision, change unique allowlisted top-level text/slug fields only, expose rationale, and pass complete ordinary schema/reference validation. The persisted digest SHALL bind current policy/runtime/model/prompt, redacted goal, tool metadata, target, changes, result checksum, and expiry without raw prompt/tool/provider data, diagnostics, hidden reasoning, or conversation memory.
- Review SHALL be one-time, exact-digest-bound, human-user-only, and non-mutating. Execution SHALL additionally require ordinary `content.draft.update` on the exact target and revalidate policy, gateway, prompt, runtime, expiry, revision, fields, checksum, schema, and references without consulting the runtime.
- Execution SHALL persist pending state before the ordinary draft update, use a caller idempotency key, return the same receipt on retry, reconcile a checksum-identical partial update, and retain normal immutable draft history. It SHALL NOT create/delete or bulk-edit entries, edit rich text/relations/taxonomies/components/assets, transition workflow/release state, or publish.

The exact route, runtime, recovery, and operational boundaries are documented in [Knowledge graph and reviewed agents](../knowledge-and-reviewed-agents.md). `THREAT-0037` owns scope bleed, path explosion, opaque ranking, prompt-injected excessive agency, ambient authority, non-human review, stale evidence, replay, duplicate mutation, and ambiguous partial execution.

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

## M6-003 data-governance baseline

`GS-SEC-031` and `THREAT-0025` cover fully scoped private governance records, explicit subject/resource links, hold/restriction dominance, rights request evidence, deterministic encrypted exports, digest-bound independent approval, backup and reauthentication gates, worker-time resource/policy/key/placement revalidation, built-in content/asset/identity effects, idempotent receipts, and ordered hash-chained governance events. SQLite/PostgreSQL persist the same optimistic document; the live recovery regression restores the earlier governance subject with the earlier content snapshot.

Repository evidence does not discover all customer personal data, select applicable law, certify a production KMS/client/credential configuration, prove provider placement, move data/keys, route regions, back up external objects/providers, or execute application-specific/external deletion. Those remain customer/deployment evidence and fail-closed processor boundaries.

## M6-004 CMS-migration baseline

`GS-SEC-032`, `THREAT-0026`, and `THREAT-0027` cover server-only read-only provider adapters, same-origin HTTPS continuation, bounded normalization, fully scoped private migration state, deterministic versioned mapping, exact-effect digest review, drift and deletion blockers, crash-safe pending-link recovery, post-success checkpoints, normal content/publication gates, complete full reconciliation, and content-only cutover evidence. SQLite/PostgreSQL persist the same optimistic document, and live SQLite recovery restores the earlier mapping/project state with the earlier target content.

Repository evidence does not certify production provider credentials, egress/DNS/rate policy, source availability, binary media transfer, source history/users/comments, inferred schema/reference semantics, customer mapping correctness, coordinated external backups, application/route/SEO/analytics/identity behavior, traffic operations, or source decommissioning. Those remain operator/deployment evidence while the source remains authoritative.

## M6-005 marketplace baseline

`GS-SEC-033`, `THREAT-0028`, and `THREAT-0029` cover complete-scope private marketplace state, expiring exact DNS possession proof, distinct evidence-referenced publisher approval, immediate trust suspension, signed discovery/compatibility/support/capability metadata, immutable releases, configured exact-artifact inspection, fail-closed evidence policy, distinct release approval, yanking, and approved-only disabled/no-grant installation. SQLite/PostgreSQL persist the same optimistic document, and live SQLite recovery restores the earlier publisher state with the earlier content snapshot.

Repository evidence does not host or download package bytes, implement scanner engines, verify business legitimacy, guarantee third-party support, automatically approve/install/enable/upgrade, certify a package as safe, provision the external runtime sandbox, authenticate a production scanner transport, or prove scanner policy/evidence-store operations. Those remain operator/deployment evidence.

## M7-001 personalization baseline

`GS-SEC-034` and `THREAT-0030` cover complete-scope private targeting configuration, exact draft/published revision separation, bounded typed attributes, required purposes on personal inputs, denied-consent and configured GPC suppression, deterministic first-match/fallback evaluation, non-persistent hypothetical preview, published-only anonymous decisions, redacted explanation traces, and conservative cache guidance bound to scope, revision, resource, and every varying input. SQLite/PostgreSQL persist the same optimistic document, and live SQLite recovery restores the exact earlier draft and published snapshot.

Repository evidence does not collect consent, interpret law, store customer profiles, verify upstream trait truth, ingest behavior, configure a CDN, purge an application cache, prevent an application from ignoring guidance, or implement CDP/experiment adapters. Those remain customer/application/deployment responsibilities; personal, authentication, consent-dependent, and preview results are never eligible for GridStory shared-cache guidance.

## M7-002 experiment baseline

`GS-SEC-035` and `THREAT-0031` cover complete-scope experiment state, immutable running design, exact weighted allocation, consent/GPC gating, non-persistent per-experiment random tokens, no-store application responses, pinned targeting, overlap prevention, bounded immutable aggregate evidence, allocation/sample/absolute guardrails, automatic failure pause, and explicit evidence-backed promotion into the targeting draft only. SQLite/PostgreSQL retain the experiment inside the optimistic targeting document; live SQLite recovery restores a running experiment and PostgreSQL verification covers restart allocation plus logical restore.

Repository evidence does not collect consent, generate or retain the application token, ingest raw experiment exposure/conversion or subject events, validate experiment attribution/evidence-store integrity, calculate statistical significance, select a winner, automatically publish, configure CDN/application isolation, enforce external rate limits, or certify lawful/statistically valid experimentation. Those remain customer/application/analytics/deployment responsibilities. M7-003's bounded general content/component events do not synthesize experiment snapshots or change this boundary.

## M7-003 analytics baseline

`GS-SEC-036` and `THREAT-0032` cover a strict identity-free public event union, configured-purpose/GPC gating, exact current published references, request-context complete scope, age/cardinality bounds, normalized transactional lifecycle evidence, non-authoritative release annotations, idempotent optimistic aggregates, independent durable adapter delivery, generic retained adapter failures, private receipt omission, and explicit report truncation. Memory, SQLite, and PostgreSQL persist the same analytics document; live SQLite recovery restores the earlier aggregate, and PostgreSQL verification covers persistence plus logical restore.

Repository evidence does not collect consent, enforce public edge rates, operate provider credentials/endpoints/egress, prove provider idempotency or availability, retain raw event history, implement attribution/funnels/cohorts/bot rules/statistics, certify retention/deletion/access policy, supply experiment snapshots, or prove release causality. Those remain customer/application/analytics/privacy/deployment responsibilities; bounded operational counters are not billing, legal, experiment, or causal evidence.

## M7-004 governed AI baseline

`GS-SEC-037` and `THREAT-0033` cover complete-scope optimistic policy, separate permissions, immutable active prompts, explicit source/type/field retrieval with per-source authorization, deterministic redaction, credential-free structured provider requests, strict estimate/result validation, conservative atomic daily reservations, metadata-only receipts, generic errors, bounded timeouts, untrusted output, and settlement-time kill-switch enforcement. Memory, SQLite, and PostgreSQL persist the same document; live SQLite recovery restores the earlier enabled policy and PostgreSQL verification covers persistence plus logical restore.

Repository evidence does not provision a model provider, certify provider TLS/egress/secrets/region/retention/training/billing, discover all sensitive data, provide streaming/tools/agents/memory/fallback/semantic search, evaluate suggestion quality/provenance, collect human approval, or mutate content. These remain deployment responsibilities or M7-005 scope.

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
