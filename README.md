# GridStory

GridStory is a framework-neutral, React-first content management system. Developers register real React components and typed manifests; editors compose, preview, revision, and publish structured content without taking ownership away from the application.

This repository is in active foundation development. The current vertical slice is intentionally small but runnable: content schemas and component manifests validate writes, SQLite or PostgreSQL stores immutable drafts and published revisions, a standalone API serves content, GridStory Studio authors and previews pages, and an ordinary Vite application renders only published content.

## What works today

- Canonical content schema and serializable React component manifests.
- Structured validation for fields, components, props, slots, and versions.
- Advanced content modeling for reusable objects, typed arrays, discriminated unions, scoped relations, hierarchical taxonomies, routes, slugs, and redirects.
- Canonical schema-as-code/visual-model round-trip, stable-ID diffing, risk-aware migration plans, scoped deployment state, and four-way drift detection.
- SQLite development persistence and pooled PostgreSQL production persistence with immutable revisions and sequence-stable, tamper-evident audit chains.
- Explicit organization/tenant/workspace/site/environment/locale storage scope.
- Deny-by-default RBAC/ABAC, OIDC verifier/session foundations, and scoped service credentials.
- Draft, changed, and published content states.
- Optimistic concurrency that rejects stale editor writes.
- Canonical route generation with published-path uniqueness, route-based delivery, and loop-safe redirect chains.
- Standalone Fastify API with stable error envelopes and cache separation.
- Bounded REST and GraphQL filtering, boolean predicates, stable sorting, signed cursor pagination, and nested projection.
- Schema-declared localized fields, acyclic ordered fallbacks, translation groups, locale-specific publication state, completeness reporting, and localized routes.
- Transactional content outbox, leased/idempotent durable jobs, cache tags, HMAC-signed HTTPS webhooks, retries, dead letters, worker processing, and replay.
- Versioned checksummed logical export/import with stable history, dry-runs, JSON Lines streaming, conflict policies, cross-scope protection, and atomic rollback.
- Administrator audit verification/export and a scoped Studio operations panel for content, queues, jobs, webhooks, and integrity.
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

The first start creates `.gridstory/gridstory.db`, initializes the schema, and idempotently publishes the welcome page. The current identity headers are development-only; production identity and authorization are tracked in Milestone 2.

Optional environment settings are documented in `.env.example`. The applications also have safe local defaults, so copying the file is not required for the first run.

## Verification

```bash
# Formatting, lint, ledgers, boundaries, types, tests, and builds
pnpm check

# The full Edge/Chromium edit-publish-deliver walkthrough
pnpm test:e2e

# Repository parity plus API create-publish-deliver against disposable PostgreSQL 17
pnpm test:postgres

# Run durable outbox/job processing beside the API
pnpm worker

# Regenerate or verify canonical TypeScript projections
pnpm schema:generate
pnpm schema:check
```

See [visual composition](docs/composition-editor.md) for palettes, layers, slots, nesting constraints, keyboard controls, and application integration. [Design-system authoring](docs/design-system.md) covers tokens, variants, responsive values, symbols, templates, version pins, and resolution order. [Content quality and publish gates](docs/content-quality.md) covers explainable checks, scoring, link adapters, and configurable publication blocking. [Assets and resumable uploads](docs/assets.md) covers scoped metadata, multipart storage adapters, renditions, focal points, usage tracking, and the M4-002 security boundary. [Content queries and GraphQL](docs/content-queries.md) covers filtering, pagination, projection, authorization, and API examples. [Localization](docs/localization.md) covers field declarations, fallback graphs, translation status, completeness, and localized routes. [Editorial workflows](docs/workflows.md) covers custom states, approvals, separation of duties, schedules, notifications, and escalations. [Operations](docs/operations.md) covers the outbox, worker, jobs, cache tags, webhook signatures, retries, dead letters, and replay. [Audit and administration](docs/audit-and-administration.md) covers hash-chain trust, verification/export, the operations view, and incident response. [Logical portability](docs/portability.md) covers checksummed export/import, JSON Lines, dry-runs, conflicts, and rollback. [Schema lifecycle](docs/schema-lifecycle.md) covers round-trip, migration, approval, promotion, and drift workflows. [Troubleshooting](docs/troubleshooting.md) covers ports, CORS, workspace declarations, databases, local reset, and browser verification. Architectural decisions are recorded under [`docs/adr`](docs/adr).

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
- `GET /api/v1/audit/verify`, `GET /api/v1/audit/export`
- `GET /api/v1/portability/export`, `POST /api/v1/portability/import`

Management and GraphQL responses use `Cache-Control: private, no-store`. REST delivery endpoints return only exact published revisions and use a CDN-compatible public cache policy. Route delivery may return an explicitly configured `301`, `302`, `307`, or `308` redirect.

## Project governance

- `TASKS.md` is the authoritative implementation backlog and status record.
- `CHANGELOG.md` records every application, architecture, operations, test, security, and documentation change.
- `BUGS.md` records every defect discovered during testing before it is fixed or deferred.
- `AGENTS.md` makes those ledger updates mandatory for future work in this repository.
- `REACT_CMS_RESEARCH_AND_IMPLEMENTATION_PLAN.md` contains the market research, full feature catalog, reference architecture, and long-range roadmap.

## Current limitations

This is an advanced verified foundation, not the v1 production release. It does not yet include a deployed OIDC adapter or persistent session store, database-level pushdown for the adapter-neutral query engine, built-in execution of application-specific data backfill hooks, uploads/DAM, release bundles, plugin isolation, external visual-preview handshakes, or collaborative editing. Those tasks are sequenced in `TASKS.md` rather than hidden behind placeholder claims.

## License

Apache-2.0. See `LICENSE`.
