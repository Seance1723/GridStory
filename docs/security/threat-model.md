# GridStory threat model

This document is the reviewable view of the canonical machine-readable model in [`security/threat-model.json`](../../security/threat-model.json). It follows OWASP's four threat-modeling questions: what are we building, what can go wrong, what will we do, and did we do enough. STRIDE is a discovery aid, not the risk score. This model covers GridStory's current control plane, authoring, preview, assets, regional published delivery, reviewed failover, signed published-only content federation, background operations, search, portability, recovery, plugin-runtime, operator-scoped marketplace, consent-aware targeting, and governed experiment boundaries.

This is a living engineering model. It is not a penetration-test report or a claim that a deployment is secure without its identity provider, TLS edge, secret manager, databases, object stores, egress controls, logging, and application-owned renderers being configured and reviewed.

## System and trust boundaries

```mermaid
flowchart LR
  internet["Untrusted internet"]
  editor["Editor / administrator"]
  studio["Studio or custom authoring client"]
  api["Standalone REST + GraphQL API"]
  core["Framework-neutral core services"]
  db[("SQLite / PostgreSQL")]
  worker["Operations worker"]
  adapters["Search / cache / webhook / notification adapters"]
  analytics["Injected analytics adapters"]
  object[("Private object storage + scanner")]
  preview["Origin-bound preview application"]
  delivery["Published delivery + CDN"]
  app["Application-owned React renderer"]
  idp["OIDC provider"]
  publisher["Plugin publisher"]
  scanner["Trusted marketplace artifact inspector"]
  plugin["External plugin process / container"]
  backup[("Encrypted off-host backup storage")]
  regional["Injected regional read / failover adapters"]
  federation["Configured federation source / signer"]

  editor --> studio
  internet --> delivery
  studio -->|"identity + complete scope"| api
  idp -->|"verified identity assertion"| api
  api --> core
  core -->|"scoped transactions"| db
  core -->|"transactional outbox"| worker
  worker -->|"bounded, signed, scoped calls"| adapters
  api -->|"inspected private bytes"| object
  api -->|"short-lived signed grant"| preview
  preview -->|"origin/token-bound draft requests"| api
  core -->|"published revisions only"| delivery
  delivery --> app
  app -->|"bounded anonymous published event + purpose decision"| api
  worker -->|"normalized evidence + independent retry"| analytics
  publisher -->|"signed manifest + DNS/key identity"| api
  api -->|"opaque reference + exact digest/size"| scanner
  scanner -->|"bounded SBOM/provenance/security evidence"| api
  core -->|"bounded scoped protocol"| plugin
  db -->|"native snapshot/dump + checksum manifest"| backup
  backup -->|"verified isolated restore"| db
  delivery -->|"scoped published read + bounded freshness policy"| regional
  api -->|"digest-bound reviewed idempotent operation"| regional
  core -->|"signed scoped published offer / record / snapshot"| federation
  federation -->|"verified live record or reviewed read-only mirror"| delivery
```

The numbered boundaries in the canonical model are:

1. Public internet to API and delivery.
2. Authoring browser to management API.
3. Tenant scope to persistence, caches, and indexes.
4. Draft/preview to published delivery.
5. API to preview application.
6. API/worker to external adapters.
7. Upload client to private object storage.
8. Transactional write to asynchronous worker.
9. Logical archive to repository.
10. Control plane to signed plugin package and external runtime.
11. Database and recovery operator to protected backup storage.
12. Governance approval and worker to governed resources, KMS, and placement adapters.
13. Migration service to read-only external CMS sources and guarded target writes.
14. Authoring and anonymous applications to targeting and experiment decisions.
15. Anonymous analytics ingestion to durable aggregation and external adapters.
16. Authorized editors and scoped content through the AI gateway to external text providers.
17. Reviewed AI authoring and private semantic index adapters.
18. Published delivery and reviewed regional failover through injected topology adapters.
19. Producer and consumer installations through signed published federation contracts.

A change that crosses or weakens one of these boundaries requires a threat-model review in the same change.

## Security assets

The protected assets are draft history; published content and routes; complete tenant/locale scope; identities, roles, grants, and sessions; signing secrets and service credentials; private asset bytes and verdicts; workflow approvals and release intent; outbox/job state; audit history; search indexes and cache tags; logical archives; service capacity; plugin manifests, marketplace publisher/release evidence, tenant grants, and lifecycle evidence; whole-database backups/recovery manifests; targeting configuration; experiment designs, aggregate evidence, guardrail decisions, and promotion history; normalized analytics evidence, bounded aggregates, release annotations, private receipts, and adapter delivery history; AI gateway/authoring/semantic policy and evidence; regional topology, replica, consistency, backup, approval, and failover evidence; and federation offers, pinned agreements, signed records, attribution, mirror plans, tombstones, and receipts.

Draft content, identity attributes, credentials/tokens, private assets, and operational/audit data are sensitive. Published content is intentionally public, but its integrity, freshness, route correctness, and tenant separation remain security properties.

## Risk method

Likelihood and impact use integer values from 1 to 5. Risk is `likelihood × impact`:

| Score | Rating | Required handling |
|---:|---|---|
| 17-25 | Critical | Do not release; remove or mitigate immediately. |
| 10-16 | High | Mitigate before the affected production capability ships, or record an explicit time-bounded acceptance by the security owner. |
| 5-9 | Medium | Assign an owner and target milestone; verify the compensating controls. |
| 1-4 | Low | Track and review when the boundary changes. |

Every modeled threat has a response, owner, concrete mitigations, and verification references. `security/threat-model.json` is validated automatically for those invariants.

## Priority threat register

| ID | Threat | STRIDE | Inherent risk | Current position / residual work |
|---|---|---|---:|---|
| THREAT-0001 | Cross-tenant object access or mutation | S/I/E | 20 Critical | M5-002 established canonical collision-safe scope contracts and fail-closed repository/adapter/queue/telemetry checks; production database and object-store policy conformance remains deployment evidence. |
| THREAT-0023 | Malicious, forged, over-granted, or escaped plugin | S/T/I/D/E | 20 Critical | M5-003 verifies signed digest-bound metadata, compatibility, constrained tenant grants, authorized lifecycle/revocation, and bounded external-runtime messages without importing plugin modules. M6-005 adds current approved marketplace-release revalidation and disabled/no-grant install handoff; OS/container hardening remains deployment evidence. |
| THREAT-0028 | Forged, stale, or overclaimed marketplace publisher identity | S/T/R/E | 20 Critical | Validated identity/key input, exact expiring DNS possession, distinct evidence-referenced human approval, private summaries, current-trust install checks, and immediate suspension mitigate the repository boundary. Business-legitimacy review and DNS operations remain operator evidence. |
| THREAT-0029 | Forged, stale, incomplete, or overtrusted marketplace release review | S/T/R/D/E | 20 Critical | A configured non-executing inspector must bind current inventory/SBOM/provenance/malware/vulnerability/license evidence to the exact signed artifact; unsafe/missing/error evidence blocks, another human approves, releases remain immutable/yankable, and UI/docs separate evidence from safety. Scanner transport, engine/policy, and evidence-store conformance remain deployment evidence. |
| THREAT-0030 | Personal-data overcollection, consent bypass, draft leakage, or targeting cache confusion | S/T/R/I/D/E | 20 Critical | Typed finite allowlists, purpose-specific consent/GPC gates, no profile/input persistence, private draft preview, exact published revision, deterministic fallback, and complete scope/revision/input cache keys fail closed. Customer consent/legal decisions, input provenance, CDN behavior, and purge operations remain deployment evidence. |
| THREAT-0031 | Experiment assignment, evidence, guardrail, or promotion abuse | S/T/R/I/D/E | 20 Critical | Complete-scope permissions, immutable pinned designs, application-owned random tokens with no persistence/echo, consent/GPC gates, no-store allocation, complete aggregate evidence, enforced guardrails/auto-pause, and explicit draft-only promotion fail closed. Analytics/evidence integrity, statistics, consent/legal review, rate limits, and application token/cache behavior remain deployment evidence. |
| THREAT-0032 | Fabricated, identifying, replayed, or unavailable content analytics | S/T/R/I/D/E | 20 Critical | Closed identity-free published-only events, configured-purpose/GPC gates, request-context scope, age/cardinality bounds, idempotent aggregates, independent adapter jobs, generic retained failures, and non-authoritative release annotations fail closed. Deployment consent/legal review, public rate limits, provider credentials/egress/retention/deletion, data quality, attribution, statistics, and causality remain external evidence. |
| THREAT-0033 | Prompt injection, scoped-source disclosure, unbounded spend, or stale AI disablement | S/T/R/I/D/E | 20 Critical | Separate private permissions, complete-scope optimistic policy, immutable active prompts, explicit source/type/field allowlists with per-source reauthorization, deterministic redaction, structured text-only requests, conservative atomic budgets, generic errors, bounded timeout/output, metadata-only receipts, untrusted results, and settlement-time kill-switch rechecks fail closed. Provider credentials, TLS/egress, regional/retention/training policy, billing truth, and complete DLP remain deployment evidence. |
| THREAT-0034 | AI proposal poisoning, non-human approval, stale handoff, or semantic index scope bleed | S/T/R/I/D/E | 20 Critical | Fixed bounded output, declared text/slug targets, complete-candidate and deterministic evaluation, exact provenance, separate human-only one-time review, revision-rechecked unsaved handoff, allowlisted redacted indexing, identifier-only jobs, derived vectors, and complete adapter/hit/current-revision/content-authorization validation fail closed. Provider/vector quality, TLS/egress/secrets/retention/rates and factuality/safety/legal review remain deployment/editorial evidence. |
| THREAT-0035 | Regional scope bleed, stale replica publication, cache confusion, split brain, or unsafe failover | S/T/R/I/D/E | 20 Critical | Trusted deployment-region selection, published-only least-authority reads, complete scope/result/topology/freshness/residency/cache validation, explicit primary fallback, reviewed digest-bound zero-loss or accepted bounded-loss operation, persisted idempotency, ambiguity reconciliation, single-writer proof, generic errors, and hashed watermarks fail closed. Provider replication/fencing/traffic truth, backup durability, actual CDN partitions, regional infrastructure, and measured RPO/RTO remain deployment evidence. |
| THREAT-0036 | Federation source spoofing, scope/schema/revision substitution, draft leakage, attribution tampering, SSRF, replay, or unsafe mirror overwrite | S/T/R/I/D/E | 20 Critical | Configured HTTPS origins, no redirects, exact complete-scope Ed25519 envelopes, published-only allowlisted schemas, pinned key/offer/type/attribution contracts, live no-retention reads, digest-reviewed source-revalidated idempotent read-only mirrors, sequence blockers, tombstones, generic failures, and no-store minimized public delivery fail closed. Source rights, attribution placement, key/credential lifecycle, egress, and availability remain operator evidence. |
| THREAT-0024 | Database backup disclosure, tampering, or unsafe restore | T/I/D | 20 Critical | M5-005 adds native consistent backup formats, minimal SHA-256 manifests, integrity/table checks, credential-safe PostgreSQL invocation, absent/empty isolated restore targets, live SQLite and disposable PostgreSQL restore drills, and protected storage/PITR guidance. Provider storage, keys, retention, access logging, and physical PITR proof remain deployment evidence. |
| THREAT-0026 | CMS source credential disclosure, SSRF, hostile continuation, or source exhaustion | S/T/I/D/E | 20 Critical | Server-only read credentials, credential-free fixed HTTPS origins, disabled redirects, same-origin continuation, response/record bounds, strict normalization, private state, and mocked hostile adapter regressions mitigate the repository boundary. Egress policy, secret-manager lifecycle, provider logs/revocation, and production throttling remain deployment evidence. |
| THREAT-0027 | Migration drift, retry duplication, destructive reconciliation, or false cutover readiness | T/R/I/D/E | 20 Critical | Exact-effect dry-runs, digest/expiry/version/revision binding, pending links, checksum recovery, post-success checkpoints, normal content gates, non-destructive deletion blockers, full reconciliation, and an explicit content-only readiness claim fail closed. External traffic/application/SEO/analytics acceptance remains operator work. |
| THREAT-0007 | Malicious or mislabeled asset upload | T/D/E | 16 High | Descriptor matching, byte inspection, SVG sanitization, quarantine, and verified-only delivery exist; deployment quotas and scanner conformance remain. |
| THREAT-0010 | GraphQL/query complexity exhaustion | D | 16 High | Depth, aliases, field selections, body size, batching/subscriptions, shared query shapes, and application-pipeline budgets are bounded; the M5-008 review records deployment rate/concurrency and introspection policy as absent beta/RC evidence. |
| THREAT-0017 | Stored content script/markup execution | T/E | 16 High | Structured manifests and code-owned components constrain execution; every application renderer remains responsible for contextual encoding. |
| THREAT-0019 | Resource exhaustion and unbounded retention | D | 16 High | M5-004 adds saturation signals/telemetry retention; M5-007 adds body/upload/archive/query/job/plugin limits and SQLite/PostgreSQL regression budgets. The M5-008 review leaves deployment quotas/rates/concurrency no-go; product retention remains M6-003. |
| THREAT-0002 | Development identity exposed in production | S/E | 15 High | Production mode rejects actor/role/principal headers, backend-verifies opaque sessions, and tenant-binds SCIM credentials; trusted-proxy/TLS and live IdP deployment conformance remain explicit beta evidence. |
| THREAT-0004 | Draft content enters public cache | I/T | 15 High | Public delivery remains published-only; full-scope cache prefixes, scoped invalidator inputs, namespaced workflow tags, and cross-scope regressions are verified. |
| THREAT-0005 | Webhook SSRF or DNS rebinding | I/E | 15 High | HTTPS/public-host/no-redirect validation exists; production egress, allow-list, and DNS controls are required. |
| THREAT-0009 | Archive tampering or cross-scope import | T/E/D | 15 High | Checksums, versions, dry-run, scope checks, rollback, a 16 MiB body, and bounded entries/revisions/audit events are enforced before mutation. |
| THREAT-0012 | Search perspective or tenant bleed | I/T | 15 High | Adapter scope/perspective is checked, hits reload through scoped storage, hostile totals/facets are discarded, and identifier-only jobs remain enforced. |
| THREAT-0013 | Job scope confusion or duplicate effect | T/R/I | 15 High | Claimed/enqueued/replayed records and embedded webhook/cache inputs fail closed on scope mismatch; external receivers still require delivery-ID idempotency. |
| THREAT-0014 | Workflow/release policy bypass | T/R/E | 15 High | Distinct permissions, separation of duties, revision checks, atomic validation, and audit exist. |
| THREAT-0016 | Secret or service credential compromise | S/I/E | 15 High | Separate configurable secrets, hashing, expiry, and revocation exist; M5-004 excludes exporter headers/credentials from health and signals and adds exposure response, while vault-backed lifecycle and full rotation evidence remain. |
| THREAT-0018 | External adapter failure or compromise | T/I/D | 15 High | Search, asset, audit, cache, webhook, job, and telemetry interfaces carry explicit scope and validate returned data; M5-004 adds bounded Collector health, degradation alerts, retry/queue guidance, and failure isolation. Non-telemetry adapter conformance remains deployment evidence. |
| THREAT-0015 | Audit tampering, truncation, or log injection | T/R/I | 12 High | M5-004 keeps audit authoritative and separate while exporting fixed-body, bounded-attribute telemetry through a fail-closed Collector allow-list with access, retention, correlation, and incident policy. Backend append-only/deletion protection remains a deployment control. |
| THREAT-0022 | Sensitive error or debug disclosure | I | 12 High | Generic responses remain enforced; M5-004 removes detailed public readiness drift, excludes raw URLs/headers/bodies/error messages from OTLP, and verifies credentials/query strings do not reach live exports. Production debug-off validation remains deployment evidence. |
| THREAT-0020 | Dependency/build compromise | T/E | 15 High | M5-007 adds OSV/Dependabot policy, reviewed package inventories, SHA-256 verification, pinned SPDX generation, and GitHub/Sigstore provenance/SBOM workflows; M5-008 records hosted issuance/verification as unmet `RC-004`, so RC/GA remain no-go. |
| THREAT-0021 | Transport/proxy misconfiguration | S/I | 15 High | Explicit origin policy exists; TLS/proxy/deployment conformance is required before GA. |
| THREAT-0025 | Governance bypass, overbroad export, or irreversible deletion | S/T/R/I/D/E | 20 Critical | Explicit links, scoped permissions, hold/restriction dominance, exact plan digests, separate fresh approval, verified backup evidence, worker-time revalidation, narrow KMS/placement/processors, and receipts fail closed; customer discovery/legal decisions and production provider conformance remain external. |

The canonical register also covers preview and asset grant replay, forged webhooks, cursor tampering, audit/log attacks, and error disclosure.

## Security assumptions and non-goals

- Production TLS and least-privilege infrastructure are deployment requirements, not properties of the local HTTP development server.
- Development actor/role/scope headers and default local secrets must never be reachable from an untrusted network.
- Production identity repository tests do not certify a customer's IdP, reverse proxy, TLS termination, secret manager, or authenticator fleet; those deployment controls must be verified independently.
- GridStory validates structured content but cannot make arbitrary application-owned React code safe. Consuming applications own contextual output encoding, dependency review, and CSP compatibility.
- Provider adapters must preserve complete tenant scope and the documented timeout, redirect, credential, and failure behavior.
- Server plugin packages remain outside the control-plane process and execute only in operator-provided external processes/containers. GridStory verifies and mediates the protocol; operators own OS identity, filesystem, network, CPU, memory, and process isolation.
- M6-005 supplies scoped publisher enrollment and evidence-bound release review, but package bytes/download, scanner engines, publisher business-legitimacy checks, automated safety guarantees, and the Studio/runtime sandbox remain external. Provenance, a verified badge, or a passing scan does not prove safety.
- Whole-database backups contain every tenant and are never a tenant-scoped portability mechanism. Operators own encrypted off-host storage, key custody, retention/deletion, restore approvals, and provider-specific physical PITR evidence.
- Governance automation is not legal advice or automatic personal-data discovery. Operators own classifications, link completeness, lawful-basis/hold decisions, external-system processors, coordinated backups, provider KMS/placement evidence, and production approval policy.
- CMS source credentials are server-only, read-only, least privilege, and operator-managed. GridStory does not write to or decommission a source CMS, move binary media, or administer its credentials.
- A migration cutover report covers only the normalized content observed during that validation. It does not certify routes outside mapped schemas, binary assets, application behavior, SEO, analytics, identity, infrastructure, legal readiness, traffic switching, or source retirement.
- Targeting configuration is not a consent manager, customer profile store, legal interpretation, behavioral collector, or CDN. Applications own consent evidence, lawful use, source normalization, rendered-response isolation, and exact use/purge of shared cache keys.
- Experiment allocation is not a subject/profile store, analytics warehouse, statistical engine, or automatic rollout system. Applications own random token generation/retention, consent and rendered-response isolation; analytics owners prove experiment attribution, evidence integrity, and statistical validity independently of the bounded general content counters.
- Content analytics is not an identity/session store, raw-event warehouse, consent manager, attribution/funnel/cohort system, statistical engine, billing record, or proof of release causality. Deployments own public rate controls and provider credentials, egress, diagnostics, retention, deletion, access, data-quality, bot/late-event, and legal policy.
- Regional policy is not a database, replica, DNS/load-balancer, CDN, backup, or fencing controller. Deployments own adapter authentication, truthful provider evidence, single-writer enforcement, traffic and cache configuration, physical recovery, measured RPO/RTO, and regional/legal acceptance.
- No threat is accepted merely because it is listed. Any residual high or critical risk needs a task or explicit, named, expiring acceptance.

## M6-003 evidence update

`THREAT-0025` adds the governance approval/worker-to-resource/KMS/placement boundary. The implemented mitigations use explicit subject links, distinct scoped permissions, legal-hold/restriction precedence, immutable dry-run candidates and digest, a different freshly authenticated approver, current backup evidence, execution-time revalidation, fail-closed processors and placement/key state, envelope encryption, idempotent receipts, and hash-chained events. Focused core/API/Studio/recovery/PostgreSQL evidence uses only isolated fixtures and mocked KMS clients.

Residual deployment risk remains high until the customer proves data discovery/classification, applicable policy, all external processors, object/provider backups, live KMS credentials/key policy/region, actual storage and support locations, and operational separation of duties. Configured placement is an attestation input, not routing or compliance certification.

## M6-004 evidence update

`THREAT-0026` adds the trusted runtime-to-external-CMS boundary, and `THREAT-0027` covers source/target drift, crash recovery, destructive reconciliation, and overclaimed cutover readiness. Contentful, Sanity, and WordPress transports use injected fetch implementations, credential-free fixed HTTPS origins, no redirects, same-origin pagination/continuation, bounded response bytes/records, strict response normalization, read-only methods, and redacted failures. Source credentials never enter migration documents, API summaries, Studio, or telemetry.

Versioned deterministic recipes and complete-scope private repositories retain projects, links, plans, runs, checkpoints, and reports. Execution requires the exact unexpired plan digest, project/recipe/source checksums, and expected target revision; it records a pending deterministic link before content mutation, recovers a checksum-identical partial write, advances the checkpoint only after every effect and receipt completes, and sends mutations through normal content/reference/workflow/quality/governance/publication checks. Source deletions, unpublishes, unsupported media, incomplete snapshots, and manual target changes block rather than delete or overwrite.

Residual production risk stays high until an operator proves least-privilege provider credentials and revocation, egress/DNS/rate/timeout policy, a coordinated database/provider/object/config backup, representative source fixtures and mapping acceptance, application/route/media/SEO/analytics/identity checks, and an independently controlled traffic rollback. The source remains authoritative until that external cutover is accepted; GridStory's report neither switches traffic nor certifies those systems.

## M6-005 evidence update

`THREAT-0028` covers deceptive/stale publisher identity, challenge replay, key substitution, self-approval, and continued trust after suspension. Publisher enrollment validates domains, same-domain ownership links, and Ed25519 public keys; short-lived exact-name TXT possession precedes a distinct evidence-referenced human approval, while suspension immediately removes marketplace trust. Catalog summaries omit challenges and public-key bodies, and every marketplace install revalidates publisher/key/signature state.

`THREAT-0029` covers mismatched, stale, incomplete, unavailable, compromised, or overtrusted inspection. The control plane never imports or executes the package and fails closed without an injected trusted inspector. Review binds exact digest/size and current inventory, SPDX, provenance subject, malware, vulnerability, license, inspector-version, and evidence-reference results; unsafe or missing checks block, capabilities remain warnings for human judgment, a distinct operator approves, releases are immutable/yankable, and approved installation remains disabled with no grants.

Residual deployment risk remains critical until an operator authenticates the scanner transport, validates scanner engines/policy/update/freshness and evidence-store integrity/retention, performs independent publisher due diligence, coordinates package/evidence recovery, and provisions least-privilege plugin runtime isolation. GridStory makes evidence reviewable; it does not certify third-party code as safe or guarantee publisher support.

## M7-001 evidence update

`THREAT-0030` adds the authoring/anonymous-application-to-targeting boundary. Configuration accepts only bounded boolean or finite-enum attributes with explicit source, classification, purposes, and cacheability; personal attributes require purposes and cannot be shared-cache inputs. Runtime calls reject unknown attributes, values, and purposes, do not persist inputs or profiles, make denied/missing consent fail closed, and apply GPC only to purposes configured to honor it.

Management and hypothetical preview require distinct scoped authorization and remain private/no-store. Publishing copies the exact optimistic draft revision. Anonymous evaluation reads only that published snapshot, evaluates unique-priority rules deterministically with a required fallback, omits raw values from explanations, and produces a complete shared key only when every possible input is bounded public and consent-independent. The POST response itself remains private/no-store.

Residual deployment risk remains critical until the customer validates notices, consent evidence and revocation, applicable legal treatment including GPC, upstream trait provenance/minimization, application rendering, edge/CDN cache configuration, purge behavior, rate controls, and any external CDP adapter. Repository evidence proves its contract against synthetic inputs, not lawful use or a production CDN.

## M7-002 evidence update

`THREAT-0031` extends the authoring/anonymous-application boundary with governed experiments. The complete-scope optimistic targeting document retains exact-weight design, actor/reason lifecycle evidence, immutable aggregate snapshots, guardrail evaluations, and promotion history. Started designs are immutable, pin the published targeting revision, and cannot overlap another running/paused resource-audience placement. Allocation requires declared purpose consent and a random application-owned per-experiment UUID; the service hashes it with complete scope, experiment, and revision, never persists or echoes token/bucket/context, sets no cookie, and returns only private/no-store output plus the ordinary targeting baseline when participation is disallowed.

Authenticated snapshots must contain every variant/metric, bounded exposures/samples/values, immutable evidence identity, and an external SHA-256 evidence digest. Allocation deviation, minimum samples, and absolute guardrails are enforced, with a failed running snapshot causing an automatic pause. Promotion requires completion, duration, a retained passing snapshot, unchanged published/draft control targeting, explicit non-control selection, and primary aggregate improvement; one optimistic write changes only the targeting draft and retains evidence. No raw-event route, automatic winner, statistical-significance claim, or automatic publication exists.

Residual deployment risk remains critical until the customer validates consent/legal use and revocation, unpredictable per-experiment token creation/retention, application cache/render isolation, public allocation rate controls, analytics attribution/metric definitions/late-data/bot policy, statistical methodology, and evidence-store authenticity/retention. Repository evidence verifies deterministic allocation and policy gates against synthetic aggregates; it does not certify experiment validity or business causality.

## M7-003 evidence update

`THREAT-0032` adds the anonymous-application-to-analytics-aggregation/adapter boundary. The strict public union accepts only content view, component view, and component interaction with a UUID, bounded time, exact current published content reference, and stable component/interaction tokens. Complete scope comes from the validated delivery context; the configured purpose must be granted and a received GPC signal suppresses acceptance. Identity, session, assignment, URL/referrer/network/device, draft/preview, and arbitrary property values have no schema path.

The transactional outbox normalizes content lifecycle events, while persisted successful release publication/rollback creates typed non-authoritative annotations. One idempotent process job updates an optimistic complete-scope bounded aggregate and creates one independent leased delivery job per injected adapter. Memory, SQLite, and PostgreSQL use the same document; reports require operations authorization, omit private receipt IDs/raw evidence, and expose truncation plus bounded adapter state. Hostile adapter exceptions become a generic retained failure, retry/dead-letter/replay remains available, and neither adapter nor analytics enqueue failure can reverse authoritative content/release state.

## M7-004 evidence update

`THREAT-0033` adds the authorized-editor-to-AI-provider boundary. AI read, management, and execution permissions are distinct and private/no-store. Complete-scope memory, SQLite, and PostgreSQL documents retain bounded model policy, budgets, immutable prompt versions, active pointers, accountable state events, daily counters, and metadata-only receipts. Request input, selected source values, output, credentials, and provider diagnostics have no invocation-history persistence path.

Execution resolves only explicit source IDs at the active prompt's fixed perspective, reauthorizes every content source, requires exact scope/type and positive field paths, redacts credentials/email/phone/IP, and sends one credential-free structured text request without tenant routing, tools, or mutation authority. Atomic conservative reservation prevents duplicate UUIDs and observed quota oversubscription; invalid/failing calls keep reservations and successes reconcile down. Provider estimates/results are strictly bounded, exceptions are generic, timeouts abort, output is redacted and marked untrusted, and settlement rechecks the gateway/prompt/model so a concurrent disablement discards in-flight output. SQLite restore and PostgreSQL persistence/logical restore cover the same policy boundary.

The gateway does not supply a live provider, complete PII/DLP discovery, provider TLS/egress/secret/region/retention/training/billing certification, streaming, tools, agents, conversations, fallback, or content writes. M7-005 separately governs reviewed authoring proposals and private semantic search below; provider-specific assurances still require deployment evidence.

## M7-005 evidence update

`THREAT-0034` adds evaluated authoring and private semantic adapter boundaries. Authoring policy and bounded redacted proposals use complete-scope optimistic memory, SQLite, and PostgreSQL documents. One enabled action binds a known prompt/content type to unique top-level text/slug fields and deterministic term/length rules. Generation requires ordinary target/source reads and the fixed structured-output contract; complete-candidate schema/reference validation and every rule must pass before a proposal is reviewable. Provenance binds action/request/prompt/model/target/source revisions, usage/redaction, actor/time, evaluations, and the one review record without retaining raw provider JSON or source values.

`ai.review` is separate from execute/manage and requires a publisher/admin user principal. Service accounts and anonymous principals fail even if granted the string action. Review occurs once, rechecks the exact draft revision, and marks drift stale. Approval never changes content or workflow state; Studio can only copy matching approved values to its local dirty editor for the normal save/workflow/quality/publish path.

Existing identifier-only search jobs re-resolve saved content, select configured top-level strings, redact and bound them, and feed an injected tenant-aware semantic adapter. Private bounded queries are redacted and not stored. Adapter identity/model/index and every hit's complete scope, perspective, unique ID, finite score, positive field provenance, current revision, and ordinary content authorization must match; hostile or stale evidence fails the complete request closed. Adapter vectors are derived, excluded from backup truth, and rebuilt after database recovery. No provider/vector dependency or credentials are shipped.

Residual deployment risk remains critical until the customer validates provider/model/vector credentials, TLS/egress/timeout/idempotency/availability, protected diagnostics, retention/deletion/access/training policy, complete DLP, model and index quality, factuality/bias/brand/legal/safety review, and editor accountability. Repository evaluation and provenance make the handoff reviewable; they do not certify generated content or external AI systems.

## M8-001 evidence update

`THREAT-0035` adds the published-delivery and reviewed-regional-failover boundary. Trusted composition supplies the deployment region and capability-limited published-read/failover adapters. The default remains the ordinary strong primary. Enabled bounded-staleness delivery validates exact adapter, complete/base scope, replica role, region, topology, current observation, finite policy-bounded lag, opaque watermark, residency evidence, cache attestation, published revision, requested type/slug, uniqueness, and result count. Caller-selected routing is absent; incomplete cache evidence produces private/no-store delivery and only a watermark digest is exposed.

Complete-scope optimistic memory, SQLite, and PostgreSQL documents retain bounded policy and operation history without endpoints, credentials, raw replication positions, or diagnostics. Private management uses distinct read/manage/failover authority. Preflight rechecks active/target residency and current verified backup evidence; planned mode requires caught-up zero loss, while emergency mode requires an explicit RPO covering observed nonzero loss. An expiring exact digest requires a different recently reauthenticated human. Execution persists before the adapter with a stable idempotency key, malformed or uncertain outcomes remain ambiguous for reconciliation, and success requires proof that only the target is writable before topology advances and reads reset to primary-only.

Residual production risk remains critical until an operator proves the provider's replication, readiness, fencing, promotion, DNS/load-balancer, cache key/purge, backup/PITR, secrets, logging, regional placement, measured RPO/RTO, failback, and application monitoring through a representative exercise. GridStory validates the declared boundary; it does not provision infrastructure, automatically fail over, or certify provider/legal claims.

## M8-002 evidence update

`THREAT-0036` adds the producer-to-consumer federation boundary. Producer offers and consumer agreements are private, complete-scope, optimistic, bounded, and disabled by default with distinct read/manage/consume/sync authority. Producers allowlist exact deployed schema versions/fingerprints and sign only exact published revisions. Drafts, preview grants, workflow state, components, assets, relations, rich text, credentials, and unsupported types have no envelope path.

The maintained HTTP source accepts only a deployment-configured credential-free HTTPS base, disables redirects, rejects a changed response origin, sends complete source scope, bounds time/bytes/records, parses JSON only, and replaces diagnostics with one generic failure. The core independently validates the Ed25519 signature and exact request/time/source instance/scope/offer/type/revision/checksum/attribution/checkpoint contract. Public callers select only an active local agreement plus namespaced record identity and receive a no-store minimized record with mandatory canonical/license/credit/agent attribution.

Live mode retains no record. Mirror mode creates an expiring exact-effect digest, revalidates the complete source snapshot during execution, persists executing before effects, applies atomically and idempotently, blocks revision regression or same-sequence mutation, and tombstones reviewed withdrawal while keeping mirrors separate from ordinary local content. SQLite/PostgreSQL persistence and native recovery cover agreements, plans, mirrors, tombstones, and receipts.

Residual production risk remains critical until operators prove source legal authority/license/attribution placement, independent key acquisition and rotation/revocation, service credential lifecycle, DNS/egress/TLS/rate/availability controls, cross-instance incident response, and contract-specific retention. GridStory makes source assertions signed and mandatory; it does not verify ownership, enforce royalties, implement a public federation standard, or guarantee source availability.

## M8-003 evidence update

`THREAT-0037` adds the authorized-content-to-derived-knowledge and mediated-runtime boundary. Relation/taxonomy graphs are request-local, private/no-store, revision-bound, reauthorized per content entry, cycle safe, and capped by source, seed, depth, node, edge, path, and result limits with explicit truncation. Recommendations use only visible direct/inverse relation, shared taxonomy, same-type, and bounded-path contributions whose weights exactly sum to deterministic scores.

Complete-scope optimistic memory, SQLite, and PostgreSQL documents retain disabled-by-default policy, expiring plans, human decisions, pending execution, and receipts. One injected runtime/model must match an active immutable governed prompt and receives only a redacted bounded goal plus strict counted/authorized read callbacks. It receives no ambient repository, network, credential, plugin, filesystem, shell, content-write, workflow, release, or publication capability, and durable traces keep metadata digests rather than tool/provider payloads.

One fixed-contract plan targets an exact current draft and allowed top-level text/slug fields, exposes rationale, and passes complete candidate validation. Human-only one-time review changes no content. Explicit execution additionally requires ordinary exact-target draft-update authority and rechecks policy/prompt/runtime/expiry/revision/checksum/schema/references before a persisted idempotent ordinary update; retries return or reconcile the same receipt. Rich/relation/taxonomy/component/asset, multi-entry, workflow, release, and publication effects have no path.

Residual production risk remains critical until operators prove runtime process/container isolation, model credentials and egress, provider retention/deletion/training/regional/billing controls, protected diagnostics, prompt/model evaluation, complete DLP, abuse monitoring, editor accountability, and incident response. The repository makes plans inspectable and least-authority; it does not certify output correctness, factuality, safety, legality, editorial quality, or an external runtime.

## Review workflow

Review at least quarterly, before every release candidate, and whenever identity, authorization, tenant scope, caching, preview, assets, imports, jobs, logging, external adapters, deployment topology, or sensitive-data classification changes.

1. Update actors, assets, boundaries, flows, and assumptions in `security/threat-model.json`.
2. Add or amend stable `THREAT-####` records. Do not recycle identifiers.
3. Choose mitigate, eliminate, transfer, or accept; name the owner and verification evidence.
4. Link unresolved work to a stable `TASKS.md` item. A high/critical acceptance must name the approver and expiry in the threat record.
5. Update the ASVS profile and security requirements where the control set changes.
6. Run `pnpm security:check` and the proportionate tests. Review evidence, not only document shape.

A review is complete when the model is current, all threats have dispositions, high/critical residual work is owned, and the automated profile/model validation passes.
