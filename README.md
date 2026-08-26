# GridStory

GridStory is a framework-neutral, React-first content management system. Developers register real React components and typed manifests; editors compose, preview, revision, and publish structured content without taking ownership away from the application.

This repository is in active foundation development. The current vertical slice is intentionally small but runnable: content schemas and component manifests validate writes, SQLite or PostgreSQL stores immutable drafts and published revisions, a standalone API serves content, GridStory Studio authors and previews pages, and an ordinary Vite application renders only published content.

## What works today

- Canonical content schema and serializable React component manifests.
- Structured validation for fields, components, props, slots, and versions.
- Advanced content modeling for reusable objects, typed arrays, discriminated unions, scoped relations, hierarchical taxonomies, routes, slugs, and redirects.
- Canonical schema-as-code/visual-model round-trip, stable-ID diffing, risk-aware migration plans, scoped deployment state, and four-way drift detection.
- SQLite development persistence and pooled PostgreSQL production persistence with immutable revisions and sequence-stable, tamper-evident audit chains.
- Canonical collision-safe organization/tenant/workspace/site/environment/locale scope across storage, cache, search, assets, jobs, events, audit, and telemetry.
- Deny-by-default RBAC/ABAC plus a production-selectable OIDC/SAML relying-party boundary, durable opaque sessions, tenant SCIM Users/Groups, scoped group-role mappings, WebAuthn step-up, and audited one-time break-glass access.
- OWASP ASVS 5.0.0 Level 2-oriented security requirements, a STRIDE threat register, explicit chapter applicability, evidence links, and automated model validation.
- Signed Plugin SDK v1 manifests, constrained tenant grants, durable lifecycle/revocation, and bounded invocation through an injected external process/container adapter.
- Operator-scoped plugin marketplace with DNS-backed publisher enrollment, separate human approval, signed compatibility/support metadata, injected exact-artifact review, immutable release decisions, and disabled/no-grant installation handoff.
- Optional OpenTelemetry OTLP logs, metrics, and traces for API/worker seams with protected health, Collector redaction/queueing, dashboards, alerts, retention targets, and incident runbooks.
- Guarded, fully scoped retention and data-subject workflows with explicit resource links, legal holds/restrictions, digest-bound independent approval, worker revalidation/receipts, encrypted exports, CMK wrappers, and placement attestations.
- Guarded read-only Contentful, Sanity, and WordPress migration sources with versioned deterministic mappings, exact-effect dry-runs, drift-safe/restart-safe dual-run sync, and content-only cutover evidence.
- Consent-aware targeting with typed bounded attributes, purpose/GPC gates, deterministic audience priority and fallback, isolated draft preview, published-only edge decisions, and explicit shared/private/no-store cache guidance.
- Governed content experiments with immutable running designs, consent-gated stateless weighted allocation, aggregate evidence/guardrails, safe pause/complete/cancel transitions, and explicit winner promotion to a reviewable targeting draft only.
- Bounded content analytics with consent/GPC-gated published content/component events, normalized lifecycle evidence, durable injected-adapter fan-out, release annotations, and complete-scope operational aggregates without identity or raw-event storage.
- Governed provider-neutral AI text generation with immutable active prompts, explicit field-scoped retrieval, deterministic redaction, conservative request/token/cost budgets, metadata-only receipts, and an in-flight-safe kill switch without tools or content mutation.
- Reviewed AI authoring proposals with fixed structured output, complete-candidate evaluation, exact provenance, human-only one-time review, visible unsaved Studio handoff, and tenant-safe private semantic search over derived indexes.
- Provider-neutral regional published reads with explicit strong/bounded-staleness evidence, conservative cache guidance, residency checks, and digest-bound independently approved single-writer failover/reconciliation controls.
- Contract-bound cross-instance content federation with exact signed published schema/revision identity, live no-copy reads, reviewed read-only mirrors and withdrawal tombstones, and mandatory canonical/license/credit/agent attribution.
- Private on-demand relation/taxonomy graph exploration, deterministic contribution-explained item recommendations, and disabled-by-default mediated read agents whose expiring single-draft text/slug patches require explicit human review and execution.
- Generated public Draft 2020-12 specifications for logical archives, canonical schema IR, serializable component manifests, and preview-only node source maps, with stable discovery identities/digests and byte-for-byte drift checks.
- Empty-by-default complete-scope self-hosted fleet inventory with private on-demand pull-only health/readiness/contract observations, finite expiring conditions, safe configured HTTPS adapters, and no remote mutation authority.
- Checksummed native SQLite/PostgreSQL backup commands, isolated restore drills, PostgreSQL PITR guidance, bounded API/worker shutdown, and exact current/candidate rollout preflight.
- Evidence-bounded WCAG 2.2 A/AA automation and ATAG-informed review, keyboard/zoom/adaptation checks, three-engine browser gates, and React 18.3/19 plus Vite compatibility fixtures.
- Machine-validated alpha/beta/RC/GA readiness reviews with evidence-linked decisions; the current candidate is private-alpha-ready while beta, RC, and GA remain explicit no-go decisions.
- Deterministic private package archives with package-specific README/SPDX metadata, exact canonical-license and inventory checks, and isolated offline runtime/declaration consumption.
- Draft, changed, and published content states.
- Optimistic concurrency that rejects stale editor writes.
- Canonical route generation with published-path uniqueness, route-based delivery, and loop-safe redirect chains.
- Standalone Fastify API with stable error envelopes and cache separation.
- Bounded REST and GraphQL filtering, boolean predicates, stable sorting, signed cursor pagination, and nested projection.
- Schema-declared localized fields, acyclic ordered fallbacks, translation groups, locale-specific publication state, completeness reporting, and localized routes.
- Transactional content outbox, leased/idempotent durable jobs, cache tags, HMAC-signed HTTPS webhooks, retries, dead letters, worker processing, and replay.
- Pluggable scoped search with durable incremental indexing/rebuilds, index status, hierarchical taxonomy facets, backlinks, and explainable related content.
- Versioned checksummed logical export/import with stable history, dry-runs, JSON Lines streaming, conflict policies, cross-scope protection, and atomic rollback.
- Administrator audit verification/export plus scoped Studio operations and enterprise-identity panels.
- Framework-neutral typed client with matching management and published query methods.
- Universal React component registry and tree renderer.
- Versioned design-system delivery with governed tokens, variants, responsive overrides, reusable symbols, templates, and deterministic React resolution.
- GridStory Studio with a responsive categorized administration rail, local light/dark themes, recursive layers, constrained slots/nesting, drag/drop and keyboard movement, undo/redo, live preview, history, and publishing.
- Vite + React example consuming the public published-content endpoint.

## Requirements

- Node.js 22.12 or newer.
- pnpm 10 or newer.
- Docker is optional and only required for the local PostgreSQL conformance command.

## Quick start

```bash
pnpm setup
pnpm dev
```

The default local services are:

| Service | URL | Purpose |
|---|---|---|
| GridStory API | `http://localhost:4000` | Standalone content control plane and delivery API. |
| GridStory Studio | `http://localhost:5173` | Author, preview, revision, and publish content. |
| Vite React example | `http://localhost:5174` | Render the published `welcome` page in a normal React application. |

The first start creates `.gridstory/gridstory.db`, initializes the schema, and idempotently publishes the welcome page. Local development retains the explicit header identity. Production mode rejects actor/role headers and uses maintained OIDC/SAML/WebAuthn verification, backend-held opaque sessions, and tenant-bound SCIM credentials. See [Enterprise identity and access](docs/identity-and-access.md); live IdP interoperability, trusted-proxy/TLS, secret-manager, and deployment conformance remain `BETA-003` evidence.

Optional environment settings are documented in `.env.example`. The applications also have safe local defaults, so copying the file is not required for the first run.

Production preview credentials are single-purpose: only the matched draft-read, message and self-revocation routes accept them through the preview verifier. They cannot authorize management endpoints or create grants. Unbound production management requests fail closed; local authoring fallback requires explicit development mode. See [the authentication boundary](docs/adr/0029-production-preview-authentication-boundary.md) for its verification and deployment limits.

### Studio navigation

The Studio sidebar groups all 19 existing destinations by task:

| Group | Destinations |
|---|---|
| Content | Pages, Workflows, Releases, Search |
| Media | Library (the existing Asset library) |
| Design | Components |
| SEO & quality | Page checks |
| Insights | Targeting, Experiments |
| Apps | Marketplace |
| Tools | Migrations |
| Advanced | Operations, Identity providers, Data governance, Federation, Fleet, Regions, AI gateway, Knowledge |

Group headings expand or collapse their links using a click, Enter or Space; they do not select a page or reload its data. Exactly one destination is selected at a time. The header search shortcut opens Content when needed. Desktop compact mode exposes every destination as a named icon with a tooltip, while retaining group preferences for the expanded rail and mobile drawer. These preferences last for the current Studio session. Selecting a mobile destination closes the drawer.

Only implemented destinations appear. Studio addresses use `#/<destination>` with optional paired `entry` and `type=page`, for example `#/pages?entry=<encoded-id>&type=page`. Copying the address, reloading, and Back/Forward restore the current screen and saved authorized page. A link does not grant access or change the client's tenant/site/environment/locale. The served path and outer query remain host-owned; no server rewrite or consuming-application route change is required.

Changing screens preserves unsaved entry edits and the same-entry preview. Opening another entry (including from Search or browser history) asks before discarding unsaved changes. Cancellation or a failed target preserves the prior editor/address. Accepted entry replacement closes its old preview window; pending grants are revoked instead of connected. Save/publish keep the current location. Explicit missing, denied or wrong-type entries show an unavailable state and never silently select another page. Invalid addresses normalize to Pages with a generic notice.

Studio stores no drafts, credentials, search terms or preview sessions in its location/history metadata. The native reload/exit warning is registered only while dirty and is best effort, not autosave or crash recovery. Unknown/manual/restored history slots use a conservative replacement fallback on cancellation and may leave a duplicate address; subsequent known navigation remains usable. Authorized context selection and non-page authoring remain separate queued tasks in [the CMS gap analysis](docs/cms-admin-gap-analysis.md).

### Authorized Studio context API

`GET /api/v1/studio/context` is the version-1 private, no-store capability endpoint. It returns the current six-part scope, the caller's own principal ID, explicit booleans for existing screen/operation checks, and permitted site/environment/locale choices. It never returns the principal's roles, grants, attributes or raw topology. Existing `GET /api/v1/context` remains compatible. Production requires a workforce session; a preview token alone cannot call this endpoint.

Trusted API composition may provide `studioTopology`, or operators may set `GRIDSTORY_STUDIO_TOPOLOGY_JSON` using the example in `.env.example`. The catalog is not a permission grant. Each entity array and the selectable tuple set are limited to 256; duplicate IDs, invalid ownership, oversized values and locale drift fail startup without echoing configuration. Only active same-organization/tenant/workspace choices permitted by the current principal are returned. Without a catalog, discovery returns only the permitted current context. No other tenant/workspace is listed; no data or topology is provisioned.

The universal client exposes `getStudioContext({ signal? })` and `withStudioScope({ siteId, environmentId, locale })`. A clone preserves the identity transport and organization/tenant/workspace, leaving the original unchanged. Always validate a candidate using its new context call before using it; cloning itself does not authorize anything. Unsupported/malformed or wrong-scope responses fail closed. Operation booleans represent policy preconditions, not entry existence, workflow readiness, provider availability or an authorization credential. Typed page list/create checks remain separate from untyped entry and preview checks.

CMS-032 supplies this API/client foundation. Studio does not yet consume it: permission-aware navigation is CMS-033, and guarded visible scope controls/preview cleanup are CMS-034. Its approved navigation repair also prevents delayed editor focus from interrupting typing; normal keyboard navigation, dirty-history and preview behavior remain intact. No feature or color was removed or redesigned. See [ADR 0030](docs/adr/0030-studio-capabilities-and-scope-selection.md) and [troubleshooting](docs/troubleshooting.md) for the bounded contract and configuration guidance.

Delivery status: CMS-032 is verified on `codex/cms032-context-checkpoint`: the full 465-test repository gate (17 existing optional skips), all 30 three-browser scenarios, nine repeated WebKit navigation checks and the bounded manual smoke pass. ADR 0030 records evidence and manual-tool limitations. CMS-033 is the next approved task; CMS-003 is not complete until CMS-033/034 also pass. No production readiness or deployment is claimed.

### Studio styles and preview

GridStory Studio imports one `apps/studio/src/styles/studio.scss` entry. It composes ordered Sass `@use` partials for foundation/tokens, management surfaces, authoring, collaboration/assets, workflow/search, shell/navigation, calls to action, typography, forms, cards/spacing, states/themes, responsive layout, and accessibility. Shared native-control appearance belongs in `_form.scss`; button variants belong in `_cta.scss`; card surfaces and structural gaps belong in `_cards.scss`; readable text behavior belongs in `_typographic.scss`. Keep feature-only layout in its feature partial and do not add a second global override layer.

The authoring workspace does not embed application content. Its header preview button creates one scoped standalone draft-preview session in an application-only window; the same button closes the window and revokes the session. Responsive component values remain authored through the component inspector's **Responsive override** selector.

## Verification

```bash
# Formatting, lint, ledgers, boundaries, types, tests, and builds
pnpm check

# The full Chromium, Firefox, and WebKit edit-publish-deliver plus accessibility matrix
pnpm test:e2e

# Isolated React 18.3 and current React 19/Vite/SSR/hydration compatibility
pnpm test:compatibility

# Repository parity plus API create-publish-deliver against disposable PostgreSQL 17
# The disposable path also proves native dump, post-backup mutation, and isolated restore.
pnpm test:postgres

# Focused SQLite recovery, shutdown, worker-drain, and rollout checks
pnpm test:recovery

# Run durable outbox/job processing beside the API
pnpm worker

# Regenerate or verify canonical TypeScript projections and public interoperability specifications
pnpm schema:generate
pnpm schema:check

# Validate the threat model and ASVS profile (including negative validator tests)
pnpm security:check

# Produce schema-validated application-pipeline benchmark reports
pnpm benchmark:sqlite -- --output .gridstory/benchmark-sqlite.json

# Pack reviewed private workspaces, validate an isolated offline consumer, and verify SHA-256 evidence (no publish)
pnpm release:self-test
pnpm release:prepare -- --output release-artifacts
pnpm release:manifest -- --output release-artifacts
pnpm release:verify -- --output release-artifacts

# Validate the dated staged-readiness review and its negative overclaim tests
pnpm readiness:check
```

See [Data governance and guarded erasure](docs/data-governance.md) for retention, subject links, holds/restrictions, reviewed deletion, encrypted exports, customer-managed key boundaries, residency attestation, and recovery limitations.

See [CMS migration and cutover](docs/migration-and-cutover.md) for trusted provider setup, mapping recipes, reviewed dual-run synchronization, blockers, full reconciliation, cutover claim limits, and backup/rollback procedures.

See [Evidence-bound plugin marketplace](docs/marketplace.md) for publisher enrollment, signed metadata, automated inspection, accountable release approval, installation boundaries, and incident rollback.

See [Consent-aware personalization and targeting](docs/personalization.md) for audience configuration, decision inputs, preview, publication, GPC handling, edge cache keys, integration examples, and privacy boundaries.

See [Governed content experiments](docs/experiments.md) for weighted allocation, application-owned random assignment tokens, consent/GPC behavior, aggregate metric evidence, guardrails, lifecycle operations, draft-only promotion, recovery, and statistical claim limits.

See [Bounded content analytics](docs/analytics.md) for the closed published event vocabulary, consent/GPC handling, lifecycle and release evidence, durable adapter contract, aggregate limits, recovery, and interpretation boundaries.

See [Governed AI gateway](docs/ai-gateway.md) for provider composition, permissions, immutable prompts, explicit retrieval, redaction, conservative usage reservation, metadata-only receipts, kill-switch semantics, recovery, and the untrusted-output boundary.

See [Reviewed AI authoring and private semantic search](docs/ai-authoring-and-semantic-search.md) for fixed-contract field proposals, deterministic evaluation, exact provenance, human-only review, unsaved Studio handoff, tenant-aware derived indexes, and fail-closed private semantic results.

See [Regional published delivery and reviewed failover](docs/regional-delivery-and-failover.md) for trusted adapter composition, bounded consistency headers, cache partition evidence, planned/emergency runbooks, ambiguity reconciliation, recovery, rollback order, and provider limitations.

See [Contract-bound content federation and syndication](docs/content-federation-and-syndication.md) for producer signing, consumer trust pinning, live and reviewed-mirror modes, attribution, safe HTTP composition, recovery/removal, and deliberately excluded interoperability.

See [Knowledge graph and reviewed agents](docs/knowledge-and-reviewed-agents.md) for derived graph limits, deterministic scoring evidence, fixed mediated tools, runtime composition, human review, idempotent draft execution, recovery, and explicit non-goals.

See [Public interoperability and self-hosted fleet observation](docs/interoperability-and-fleet.md) for generated schema identities/examples, semantic conformance rules, public caching, preview-only mappings, configured observer composition, private fleet actions, freshness semantics, recovery, and explicit no-remote-control limits.

See [Enterprise identity and access](docs/identity-and-access.md), the [security threat model](docs/security/threat-model.md), [security requirements](docs/security/security-requirements.md), and [ASVS 5.0 profile](docs/security/asvs-v5-profile.md) for trust boundaries, abuse cases, normative controls, applicability, evidence, and review workflow. [Release evidence, tested limits, and support](docs/release-and-support.md), [staged release readiness](docs/release-readiness.md), [SECURITY.md](SECURITY.md), and [SUPPORT.md](SUPPORT.md) define capacity claims, package/SBOM/attestation verification, go/no-go criteria, vulnerability handling, and the maintained pre-v1 line. [Accessibility and compatibility](docs/accessibility-and-compatibility.md) records the WCAG/ATAG review, exact browser/framework matrix, header ownership, and untested boundaries. See [visual composition](docs/composition-editor.md) for palettes, layers, slots, nesting constraints, keyboard controls, and application integration. [Design-system authoring](docs/design-system.md) covers tokens, variants, responsive values, symbols, templates, version pins, and resolution order. [Content quality and publish gates](docs/content-quality.md) covers explainable checks, scoring, link adapters, and configurable publication blocking. [Assets and resumable uploads](docs/assets.md) covers scoped metadata, multipart storage adapters, renditions, focal points, usage tracking, and the M4-002 security boundary. [Content queries and GraphQL](docs/content-queries.md) covers filtering, pagination, projection, authorization, and API examples. [Localization](docs/localization.md) covers field declarations, fallback graphs, translation status, completeness, and localized routes. [Editorial workflows](docs/workflows.md) covers custom states, approvals, separation of duties, schedules, notifications, and escalations. [Durable workflow actions](docs/workflow-actions.md) covers action design, reconciliation, leases, retries, dead letters, delivery logs, replay, and webhook security. [Atomic releases](docs/releases.md) covers pinned multi-entry publication, future-state validation and preview, scheduling, and rollback policy. [Search and taxonomies](docs/search-and-taxonomies.md) covers adapter contracts, durable indexing, rebuild/status operations, facets, backlinks, related scoring, and tenant/cache boundaries. [Plugin SDK and isolation](docs/plugins.md) covers signed manifests, grants, external runtimes, lifecycle, limits, and production hardening. [Operations](docs/operations.md) covers the outbox, worker, jobs, cache tags, webhook signatures, retries, dead letters, and replay. [Observability](docs/observability.md) covers OTLP signals, health, dashboards, alerts, retention, redaction, and incident response. [Database recovery and rollouts](docs/recovery-and-rollouts.md) covers native backups, restore drills, PostgreSQL PITR, graceful shutdown, and rolling-upgrade gates. [Audit and administration](docs/audit-and-administration.md) covers hash-chain trust, verification/export, the operations view, and incident response. [Logical portability](docs/portability.md) covers checksummed export/import, JSON Lines, dry-runs, conflicts, and rollback. [Schema lifecycle](docs/schema-lifecycle.md) covers round-trip, migration, approval, promotion, and drift workflows. [Troubleshooting](docs/troubleshooting.md) covers ports, CORS, workspace declarations, databases, local reset, and browser verification. Architectural decisions are recorded under [`docs/adr`](docs/adr).

## Repository map

```text
apps/api               Standalone Fastify control plane with SQLite/PostgreSQL runtimes
apps/studio            React authoring and live-preview application
examples/vite-site     Ordinary React consumer application
packages/schema        Canonical schema, component contracts, and validation
packages/core          Content service, revision model, audit, and persistence
packages/client        Framework-neutral delivery/management client
packages/react         React registry and component-tree renderer
packages/example-kit   Example manifests and code-owned React components
```

## Core architectural boundary

```text
GridStory Studio ─┐
                  ├─> standalone API ─> content service ─> SQLite / PostgreSQL
React application ┘         │
                            └─ schema + serializable component manifests

React application ─> @gridstory/react ─> application-owned React components
```

The CMS stores component IDs, versions, validated props, and slots. It does not store or execute editor-authored JavaScript. The consuming application retains ownership of production rendering and styling.

## API snapshot

- `GET /health`, `GET /ready`
- `GET /api/v1/studio/context` (minimized private capabilities and permitted context choices)
- `GET /api/v1/interoperability`, `GET /api/v1/interoperability/specifications/:kind/1`
- `GET /api/v1/fleet`, `PUT|DELETE /api/v1/fleet/members/:memberId`, `POST /api/v1/fleet/members/:memberId/state|check`
- `GET /api/v1/schemas`, `GET /api/v1/components`
- `GET /api/v1/locales`
- `GET /api/v1/schema-lifecycle`, `GET /api/v1/schema-lifecycle/drift`
- `GET /api/v1/design-system`
- `POST /api/v1/schema-lifecycle/plan`, `POST /api/v1/schema-lifecycle/deploy`
- `GET|POST /api/v1/content`
- `GET|POST /api/v1/content/query`
- `GET /api/v1/content/:id`
- `PUT /api/v1/content/:id/draft`
- `POST /api/v1/content/:id/publish`
- `GET /api/v1/content/:id/revisions`
- `GET|POST /api/v1/content/:id/translations`
- `GET /api/v1/delivery/:contentType/:slug`
- `GET|POST /api/v1/delivery/query`
- `GET /api/v1/delivery/localized/:translationGroupId`
- `GET /api/v1/delivery/localized-routes/*`
- `GET /api/v1/delivery/routes/*`
- `POST /graphql`
- `GET /api/v1/operations/outbox`, `GET /api/v1/operations/jobs`
- `GET|POST /api/v1/operations/webhooks`
- `PUT|DELETE /api/v1/operations/webhooks/:id`
- `POST /api/v1/operations/drain`, `POST /api/v1/operations/jobs/:id/replay`
- `GET /api/v1/operations/summary`
- `GET|POST /api/v1/identity`, provider/policy/mapping/session/WebAuthn/break-glass lifecycle routes
- `GET|POST|PUT|PATCH|DELETE /api/v1/scim/v2/Users|Groups` plus SCIM discovery
- `POST /api/v1/search`, `GET /api/v1/taxonomies`
- `GET /api/v1/search/index/status`, `POST /api/v1/search/index/rebuild`
- `GET /api/v1/content/:id/backlinks`, `GET /api/v1/content/:id/related`
- `GET /api/v1/workflow-actions`
- `POST /api/v1/workflow-actions/drain`, `POST /api/v1/workflow-actions/:id/replay`
- `GET /api/v1/audit/verify`, `GET /api/v1/audit/export`
- `GET /api/v1/portability/export`, `POST /api/v1/portability/import`
- `GET /api/v1/plugins`, `POST /api/v1/plugins/install`, `GET /api/v1/plugins/:id`
- `POST /api/v1/plugins/:id/enable|disable|revoke|invoke`
- `GET /api/v1/plugins/:id/uninstall-preview`, `DELETE /api/v1/plugins/:id`
- `GET /api/v1/marketplace`, publisher enrollment/challenge/approval routes, and release submit/review/decision/install routes
- `GET /api/v1/personalization`, draft/publish/preview routes, and `POST /api/v1/personalization/decide`
- `GET|PUT /api/v1/experiments`, lifecycle/metrics/promotion routes, and `POST /api/v1/experiments/:id/allocate`
- `POST /api/v1/analytics/events`, `GET /api/v1/analytics/report`
- `GET|PUT /api/v1/ai`, prompt activation, kill-switch, and bounded `POST /api/v1/ai/generate` routes
- `GET|PUT /api/v1/ai/authoring`, proposal/review and private semantic query/rebuild routes
- `GET /api/v1/regional`, `PUT /api/v1/regional/policy`, and reviewed preflight/approve/execute/reconcile failover routes
- `GET /api/v1/federation`, producer offer and consumer agreement routes, reviewed mirror plan/execute routes, protected signed source routes, and no-store public federated delivery
- `POST /api/v1/knowledge/graph`, `POST /api/v1/knowledge/recommendations`, and private knowledge-agent state/policy/plan/review/execute routes

Management and GraphQL responses use `Cache-Control: private, no-store`. REST delivery endpoints return only exact published revisions and use a CDN-compatible public cache policy. Route delivery may return an explicitly configured `301`, `302`, `307`, or `308` redirect.

## Project governance

- `TASKS.md` is the authoritative implementation backlog and status record.
- `CHANGELOG.md` records every application, architecture, operations, test, security, and documentation change.
- `BUGS.md` records every defect discovered during testing before it is fixed or deferred.
- `AGENTS.md` makes those ledger updates mandatory for future work in this repository.
- `REACT_CMS_RESEARCH_AND_IMPLEMENTATION_PLAN.md` contains the market research, full feature catalog, reference architecture, and long-range roadmap.

## Current limitations

This is an advanced verified foundation, not the v1 production release. The dated readiness review authorizes only a controlled private technical alpha and records beta, RC, and GA as no-go. It does not yet include live customer-IdP interoperability or trusted-proxy/TLS/secret-manager certification, production database/object-store policy conformance, provider backup-storage and physical-PITR evidence, database-level pushdown for collections materially beyond the reference benchmark, built-in execution of application-specific data backfill hooks, a provisioned plugin or agent process/container runtime or Studio sandbox loader, package binary hosting/download or built-in scanning engines, public npm/container distribution, vault-backed secret lifecycle and rotation proof, orchestrator-specific rollout certification, independent/live-assistive-technology accessibility acceptance, adapters for the roadmap frameworks beyond Vite, an executed staged release with hosted attestation verification, automatic personal-data discovery, legal interpretation, application-specific/external deletion processors, CMS binary/history/user/comment migration or automatic traffic/source cutover, automated data/key residency migration, provisioned regional databases/replicas/DNS/load balancers/CDNs, provider fencing or automatic failover/failback, verified regional cache configuration, guaranteed RPO/RTO or legal residency, public federation-standard interoperability/discovery/key rotation/push subscriptions/shared cache invalidation/multi-hop forwarding, federated rich text/components/assets/relations/remote drafts or automatic legal-rights validation, raw analytics warehousing, attribution/funnels/cohorts, consent collection/legal interpretation, deployed analytics providers/rate controls, statistical-significance/automatic-winner claims, deployed AI/vector providers or provider billing/retention/regional/model-quality conformance, public RDF/SPARQL graph interoperability, learned or behavioral recommendations, dynamic/remote tools, agent conversations or persistent memory, multi-agent orchestration, long-running/scheduled agents, AI model fallback/routing, or automatic AI workflow/publication, complete SAML SLO/general SCIM filters/account recovery, or realtime push/offline and character-level CRDT editor transport beyond the durable causal field/block contract. Those gaps are recorded in the readiness artifact and `TASKS.md` rather than hidden behind placeholder claims.

## License

Apache-2.0. See `LICENSE`.
