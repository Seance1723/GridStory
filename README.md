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
- GridStory Studio with recursive layers, constrained slots/nesting, drag/drop and keyboard movement, undo/redo, live preview, history, and publishing.
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

# Regenerate or verify canonical TypeScript projections
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

Management and GraphQL responses use `Cache-Control: private, no-store`. REST delivery endpoints return only exact published revisions and use a CDN-compatible public cache policy. Route delivery may return an explicitly configured `301`, `302`, `307`, or `308` redirect.

## Project governance

- `TASKS.md` is the authoritative implementation backlog and status record.
- `CHANGELOG.md` records every application, architecture, operations, test, security, and documentation change.
- `BUGS.md` records every defect discovered during testing before it is fixed or deferred.
- `AGENTS.md` makes those ledger updates mandatory for future work in this repository.
- `REACT_CMS_RESEARCH_AND_IMPLEMENTATION_PLAN.md` contains the market research, full feature catalog, reference architecture, and long-range roadmap.

## Current limitations

This is an advanced verified foundation, not the v1 production release. The dated readiness review authorizes only a controlled private technical alpha and records beta, RC, and GA as no-go. It does not yet include live customer-IdP interoperability or trusted-proxy/TLS/secret-manager certification, production database/object-store policy conformance, provider backup-storage and physical-PITR evidence, database-level pushdown for collections materially beyond the reference benchmark, built-in execution of application-specific data backfill hooks, a provisioned plugin process/container runtime or Studio sandbox loader, package binary hosting/download or built-in scanning engines, public npm/container distribution, vault-backed secret lifecycle and rotation proof, orchestrator-specific rollout certification, independent/live-assistive-technology accessibility acceptance, adapters for the roadmap frameworks beyond Vite, an executed staged release with hosted attestation verification, automatic personal-data discovery, legal interpretation, application-specific/external deletion processors, CMS binary/history/user/comment migration or automatic traffic/source cutover, data/key migration or multi-region routing, complete SAML SLO/general SCIM filters/account recovery, or realtime push/offline and character-level CRDT editor transport beyond the durable causal field/block contract. Those gaps are recorded in the readiness artifact and `TASKS.md` rather than hidden behind placeholder claims.

## License

Apache-2.0. See `LICENSE`.
