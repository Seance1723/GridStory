# GridStory implementation task list

**Last updated:** 2026-07-19  
**Source plan:** `REACT_CMS_RESEARCH_AND_IMPLEMENTATION_PLAN.md`

## Working agreement

- Statuses: `[ ]` planned, `[~]` in progress, `[x]` verified, `[!]` blocked.
- New implementation work receives a stable task ID before code changes begin.
- A task is complete only when its acceptance criteria and relevant automated checks pass.
- Every completed or materially changed task must have a matching `CHANGELOG.md` entry.
- Every bug found during verification must be entered in `BUGS.md` before it is fixed or deferred.

## Milestone 0 — Governance and repository foundation

- [x] **GOV-001** Add the research-backed product and architecture plan to the repository.
- [x] **GOV-002** Establish the permanent task-list workflow and stable task IDs.
- [x] **GOV-003** Establish a Keep a Changelog-compatible changelog.
- [x] **GOV-004** Establish a permanent bug ledger and bug lifecycle.
- [x] **GOV-005** Add repository-level instructions enforcing ledger updates for every change.
- [x] **FND-001** Create the pnpm TypeScript monorepo with applications, packages, examples, and shared scripts.
- [x] **FND-002** Add shared TypeScript, formatting, linting, test, and package-boundary configuration.
- [x] **FND-003** Add environment templates, ignored runtime data, and reproducible local-development commands.
- [x] **FND-004** Add CI workflows for type-check, unit/integration tests, builds, browser verification, and ledger validation.
- [x] **FND-005** Add architecture decision records for the schema IR, revision model, tenant context, preview protocol, and plugin capabilities.

## Milestone 1 — First end-to-end CMS vertical slice

### Schema and component contracts

- [x] **SCH-001** Implement the canonical, versioned schema intermediate representation.
- [x] **SCH-002** Implement content field validation with stable field IDs and structured errors.
- [x] **SCH-003** Implement the serializable React component manifest with props, slots, defaults, and version metadata.
- [x] **SCH-004** Add schema and component-manifest fixtures and unit tests.
- [x] **SCH-005** Generate TypeScript-facing content and component types from the canonical contracts.

### Core content engine

- [x] **CORE-001** Define tenant-aware repository, revision, audit, and clock/ID contracts.
- [x] **CORE-002** Implement SQLite local persistence and automatic schema initialization.
- [x] **CORE-003** Implement create, update-draft, list, read, publish, and version-history services.
- [x] **CORE-004** Enforce optimistic revision checks and preserve immutable revisions.
- [x] **CORE-005** Record attributable audit events for every content mutation.
- [x] **CORE-006** Seed a default tenant, page schema, component manifests, and welcome page idempotently.

### Standalone control-plane API

- [x] **API-001** Implement the Fastify server, configuration validation, CORS policy, health, and readiness endpoints.
- [x] **API-002** Implement tenant-scoped schema and component-manifest delivery endpoints.
- [x] **API-003** Implement content list, draft read/write, publish, and revision-history management endpoints.
- [x] **API-004** Implement the public published-content endpoint with private/no-store draft separation.
- [x] **API-005** Add consistent error envelopes, request IDs, validation responses, and API integration tests.

### Universal client and React renderer

- [x] **SDK-001** Implement a framework-neutral typed client for schemas, content, drafts, publication, and history.
- [x] **SDK-002** Support AbortSignal, configurable fetch, normalized errors, tenant context, and draft/published perspectives.
- [x] **REACT-001** Implement a React component registry and deterministic component-tree renderer.
- [x] **REACT-002** Add safe unknown-component and invalid-props fallbacks.
- [x] **REACT-003** Add preview source attributes without shipping them in normal published rendering.
- [x] **REACT-004** Add renderer unit tests and server-render/hydration compatibility checks.

### GridStory Studio

- [x] **STUDIO-001** Build the accessible Studio shell, navigation, content list, status indicators, and responsive layout.
- [x] **STUDIO-002** Build schema-driven page fields and block/prop editing.
- [x] **STUDIO-003** Add dirty-state handling, save-draft, validation, optimistic revision conflicts, and feedback.
- [x] **STUDIO-004** Add live in-process React preview using the same registered application components.
- [x] **STUDIO-005** Add publish action, version-history panel, and published/draft perspective switching.
- [x] **STUDIO-006** Add empty, loading, error, and keyboard-accessible interaction states.

### Example React application and developer experience

- [x] **EX-001** Create a Vite React example consuming published GridStory content.
- [x] **EX-002** Demonstrate code-owned Hero, RichText, and Callout components with editor-owned composition.
- [x] **EX-003** Document integration without replacing the example application's router or styling.
- [x] **DX-001** Add root dev/build/test/typecheck commands and concurrent local development.
- [x] **DX-002** Add `.env.example`, one-command setup, seeded data, and troubleshooting guidance.
- [x] **DOC-001** Replace the placeholder README with architecture, quick start, scripts, and repository map.

### Verification

- [x] **TEST-001** Add schema/core unit tests for validation, drafts, publish, conflicts, and history.
- [x] **TEST-002** Add API integration tests using isolated temporary SQLite databases.
- [x] **TEST-003** Add React renderer and Studio component tests.
- [x] **TEST-004** Verify production builds for server, Studio, packages, and example application.
- [x] **TEST-005** Exercise the complete vertical slice in Edge and record every discovered defect in `BUGS.md`.

### Milestone 1 verification evidence — 2026-07-17

- `pnpm typecheck`: passed for all five packages, API, Studio, and Vite example.
- `pnpm test:run`: 8 test files and 14 tests passed (schema 3, client 1, core 3, React renderer 3, API 2, Studio 2).
- `pnpm build`: all packages, compiled API, Studio production bundle, and Vite example production bundle passed.
- Compiled API smoke test: health `ok`; seeded `welcome` entry returned as `published` with three blocks and an exact published revision ID.
- Playwright Edge walkthrough: dirty-edit guard, immutable draft save, publish, and delivery into the standalone Vite React application passed.
- `BUG-0001` through `BUG-0005` were recorded before correction; no defects remain open at this checkpoint.

## Milestone 2 — Production content foundation

- [x] **M2-001** Add organizations, tenants, workspaces, sites, environments, locales, and explicit request context.
- [x] **M2-002** Add OIDC identity, sessions, service accounts, scoped tokens, RBAC, and ABAC foundations.
- [x] **M2-003** Add PostgreSQL production adapter and cross-adapter conformance tests.
- [x] **M2-004** Add relations, reusable objects, arrays, blocks/unions, taxonomies, routes, slugs, and redirects.
- [x] **M2-005** Add schema-as-code/visual-model round-trip, diff, migration plans, drift detection, and generated types.
- [x] **M2-006** Add REST filtering/sorting/cursor pagination/projection and GraphQL delivery/management APIs.
- [x] **M2-007** Add localization, fallback graphs, locale-specific status, routes, and translation completeness.
- [x] **M2-008** Add transactional outbox, durable jobs, cache tags, signed webhooks, and replay tooling.
  - Implemented atomic SQLite/PostgreSQL outbox emission, leased durable jobs, signed webhook dispatch, cache invalidation/tagging, management APIs/SDK, scope-aware worker execution, retry/dead-letter/replay, and an operations runbook.
- [x] **M2-009** Add logical export/import with checksums, dry-run, streaming, stable IDs, and rollback boundaries.
  - Implemented versioned canonical archives, per-record/aggregate SHA-256 verification, JSON/JSON Lines export and import, stable content/history/translation IDs, schema checks, dry-run and reject/skip/replace policies, cross-scope protection, and atomic SQLite/PostgreSQL rollback.
- [x] **M2-010** Add immutable/tamper-evident audit exports and administrator operational views.
  - Implemented scope-bound, sequence-stable per-entry SHA-256 audit chains with legacy backfill, persisted-tamper detection, integrity verification and JSON/JSON Lines export, administrator-only APIs/SDK, a bounded operations summary, and an on-demand Studio integrity panel.

### Milestone 2 foundation evidence — 2026-07-17

- Full storage scope is mandatory across organization, tenant, workspace, site, environment, and locale; cross-site reads return no content.
- A legacy tenant-only SQLite file migrates scope columns before the composite scope index and remains writable.
- Deny-by-default RBAC/ABAC, OIDC verifier/session contracts, service accounts, hashed opaque scoped tokens, and API 403 behavior are covered by tests.
- `pnpm test:run`: 11 test files and 22 tests pass; the authorized/scoped Edge edit-publish-deliver walkthrough also passes.
- PostgreSQL 17 conformance: three shared repository suites plus the real API create-publish-deliver integration pass in an automatically removed Docker container.
- `pnpm check`: 13 test files and 26 tests pass alongside all lint, format, ledger, boundary, type, and production-build gates; the authorized Edge walkthrough remains green.
- `BUG-0022` and `BUG-0023` were logged before repair; no defects remain open at the M2-003 checkpoint.
- Advanced modeling now covers reusable objects, scalar/array/union/block fields, scoped relation integrity, hierarchical taxonomies, semantic model validation, exact generated types, canonical routes, publication-time slug/path uniqueness, and loop-safe redirects.
- M2-008 operations verification: 60 normal tests pass across 22 files, six live PostgreSQL repository suites plus its API integration pass, the complete lint/format/ledger/boundary/type/build gate passes, and the Edge edit-publish-deliver walkthrough remains green.
- `BUG-0042` through `BUG-0045` were recorded before repair; no defects remain open at the M2-008 checkpoint.
- M2-009 portability verification: 65 normal tests pass across 23 files, seven live PostgreSQL repository suites plus its API integration pass, all quality/build gates are clean, and the Edge authoring/delivery walkthrough remains green.
- `BUG-0046` through `BUG-0048` were recorded before repair; no defects remain open at the M2-009 checkpoint.
- M2-010 audit/administration verification: 70 normal tests pass across 24 files, seven live PostgreSQL repository suites plus its API integration pass, persisted SQLite tampering and legacy backfill are covered, all quality/build gates are clean, and the Edge walkthrough remains green.
- `BUG-0049` through `BUG-0053` were recorded before repair; no defects remain open at the Milestone 2 completion checkpoint.
- Route-based API delivery returns published content or explicit redirects; Studio safely edits every new field family and retains existing schema compatibility.
- `pnpm check`: 15 test files and 32 tests pass with all lint, format, boundary, ledger, type, and production-build gates; four live PostgreSQL tests and the Edge walkthrough also pass.
- `BUG-0024` through `BUG-0028` were recorded before correction; no defects remain open at the M2-004 checkpoint.
- The versioned canonical IR now round-trips losslessly through schema-as-code, deterministic JSON, and the visual-model envelope; stable IDs and immutable schema/component versions govern evolution.
- Semantic diff and migration plans classify safe/backfill/destructive changes, affected surfaces and entries, backfill hooks, data scans, lock estimates, exact approval identity, reversibility, and rollback policy.
- Full-scope SQLite/PostgreSQL deployment state, drift-aware readiness, lifecycle APIs/SDK, four-source drift, exported generated contracts, and the `schema:check` CI gate are verified.
- `pnpm check`: 18 test files and 42 tests pass with generation drift, lint, format, boundary, ledger, type, and production-build gates; five live PostgreSQL tests and the Edge walkthrough also pass.
- `BUG-0029` through `BUG-0031` were recorded before correction; no defects remain open at the M2-005 checkpoint.
- A single bounded query contract now provides recursive boolean filtering, 13 predicate operators, deterministic multi-sort with stable ID tie-breaking, signed query-bound cursors, nested projections, and connection metadata across REST, GraphQL, and the SDK.
- REST management/delivery and GraphQL management/delivery preserve full hierarchy scope, resolver/route RBAC/ABAC, draft/published isolation, public REST delivery caching, and private GraphQL caching; PostgreSQL exercises all three new API paths.
- `pnpm check`: 19 test files and 47 tests pass with all schema-drift, lint, format, boundary, ledger, strict-type, and production-build gates; five live PostgreSQL tests and the Edge walkthrough also pass.
- `BUG-0032` through `BUG-0038` were recorded before correction; no defects remain open at the M2-006 checkpoint.
- Canonical schema localization now declares versioned localized fields; ordered site fallback graphs reject invalid references/cycles and resolve explicitly to published locale variants without merging draft caches.
- SQLite/PostgreSQL translation groups preserve full base scope, locale-specific immutable revisions/status/routes, canonical shared fields, legacy-entry backfill, completeness percentages, missing fields, and all-required-locales publication state.
- Localized REST/GraphQL/SDK management and delivery are verified with explicit fallback metadata; all public REST delivery now includes six-dimension scope `Vary` protection.
- `pnpm check`: 21 test files and 55 tests pass with schema generation, lint, format, boundary, ledger, strict-type, and production-build gates; six live PostgreSQL tests and the Edge walkthrough also pass.
- `BUG-0039` through `BUG-0041` were recorded before correction; no defects remain open at the M2-007 checkpoint.

## Milestone 3 — Visual composition and authoring depth

- [x] **M3-001** Add component palette, layers, slots, nesting rules, drag/drop, keyboard movement, and undo/redo.
  - Added the immutable composition command/history foundation with recursive node lookup, layer flattening, root/slot acceptance and cardinality enforcement, cycle-safe add/remove/reparent/reorder operations, prop updates, selection retention, and bounded branching undo/redo.
  - Wired root and slot palettes, recursive layer selection, drag/drop reparenting, keyboard reorder/nesting/removal, selected-node property editing, slot capacity guidance, and undo/redo into Studio.
  - Added a slot-capable Stack example component and advanced the page contract to version 3 so nesting is exercised by the same application-owned React renderer used for delivery.
  - Focused verification found `BUG-0054` through `BUG-0059`; all corrections are retained in the permanent bug ledger.
  - Verification: `pnpm check` passes with 74 tests across 25 passing files, all schema/lint/format/ledger/boundary/type/build gates are clean, seven focused Studio tests cover commands and user interactions, and the Edge author-save-publish-deliver walkthrough passes.
- [x] **M3-002** Add design-token bindings, variants, responsive controls, reusable symbols, and templates.
  - Preserved serializable design data and application-owned React rendering through an explicit versioned contract and resolver boundary.
  - Added canonical design-system and node-presentation contracts for tokens, ordered breakpoints, component variants, controlled linked symbols, templates, and responsive prop overrides.
  - Focused contract verification found `BUG-0060`; its correction is retained in the permanent bug ledger.
  - Added a versioned example design system plus authorized control-plane and typed-client delivery for tokens, breakpoints, variants, a controlled linked symbol, and a nested campaign template.
  - Added deterministic React presentation resolution for controlled symbol overrides, variants, token values, and explicit responsive breakpoints, retaining application-owned rendering and preview source identity.
  - Wired API-delivered variants, compatible token selectors, breakpoint override capture/preview, governed symbol insertion, recursive template cloning, and linked-symbol override restrictions into Studio.
  - Focused interaction verification found `BUG-0061`; its test correction is retained in the permanent bug ledger.
  - Pinned every bound presentation to an immutable design-system version; canonical validation rejects unpinned bindings and runtime resolution safely falls back when application/content versions differ.
  - Verification found and resolved `BUG-0060` through `BUG-0064`; `pnpm check` passes with 83 tests across 27 files, all schema/lint/format/ledger/boundary/type/build gates are clean, nine Studio tests cover composition/design authoring, browser bundles are 203 KB/234 KB, and the Edge walkthrough passes.
- [x] **M3-003** Add secure iframe and standalone preview sessions, route synchronization, live patches, and click-to-edit overlays.
  - Implemented the preview protocol, credential isolation, exact source/origin validation, startup retry, ordered transport lifecycle, and scope-checked management cleanup.
  - Added versioned session/message contracts and an HMAC-signed, audience/scope/origin/route/mode/expiry-bound preview service with allow-listed HTTPS targets, revocation, monotonic sequences, nonce replay protection, and bounded replay memory.
  - Preview service review found and resolved `BUG-0065`; its stable-error correction is retained in the permanent bug ledger.
  - Added authorized session issuance, token-authenticated draft retrieval, replay-checked message acceptance, self-revocation, and scope-checked management revocation endpoints with private/no-store separation.
  - Added an explicit browser client entry with controller/application runtimes, token bootstrap outside URLs, queued live draft patches, bidirectional routes, and source-click selection.
  - Wired sandboxed iframe and standalone popup previews into Studio and the ordinary Vite application with application-owned routing/rendering, source overlays, environment configuration, and lifecycle cleanup.
  - Verification found and resolved `BUG-0066` through `BUG-0077`; `pnpm check` passes with 93 tests across 30 files plus two intentionally skipped tests, all lint/format/ledger/boundary/type/build gates are clean, Studio/example bundles are 241.57/208.09 KB across 28/24 modules, and the Edge walkthrough passes the complete iframe/standalone/edit/select/route/revoke/save/publish/delivery flow.
- [x] **M3-004** Add rich text, references, asset pickers, inline editing, comments, mentions, assignments, and presence.
  - Added canonical semantic rich-text, asset-reference, comment-thread, mention, assignment, resolution, and expiring presence contracts with strict field validation and generated content types.
  - Added a scope-bound framework-neutral collaboration service, permissions, private API routes, browser-safe CORS, stable errors, and typed universal-client methods; collaboration remains outside published delivery and caches.
  - Replaced raw JSON authoring for the new fields with semantic block controls, asset and searchable content-reference pickers, selected-component inline preview controls, and a Studio comment/presence workspace.
  - Added a version 4 example page contract and authoring/collaboration guide, including the explicit process-local collaboration-adapter and demonstration asset-library boundaries ahead of M4 durability and asset infrastructure.
  - Focused and full verification found and resolved `BUG-0078` through `BUG-0090`; schema/core/API/client/Studio regressions cover canonical validation, scope isolation, permissions, CORS, stable due dates, mentions, assignments, resolution, presence expiry, field controls, inline edits, and localization compatibility.
  - Verification: `pnpm check` passes with 100 tests across 32 files plus two intentionally skipped tests, all lint/format/ledger/boundary/schema/type/build gates are clean, Studio/example bundles are 254.55/209.45 KB across 29/24 modules, and the bounded Edge walkthrough passes in 16.5 seconds.
- [x] **M3-005** Add component versioning, migrations, deprecation, usage impact, and visual regression hooks.
  - Added canonical active/deprecated component lifecycle contracts, replacement/sunset guidance, deterministic serializable visual scenarios, and non-executable rename/default/remove migration chains with ambiguity and version validation.
  - Added fully scoped draft/published usage impact, stable migration and visual plan identities, revision-safe draft-only migration, private REST/client surfaces, preview version selectors, and a Studio Components governance panel.
  - Preserved application-owned React execution, schema-declared scan boundaries, optimistic immutable revisions, published-content isolation, and existing private/public cache policies; documented application screenshot-runner integration.
  - Verification: `pnpm check` passes with 107 tests across 35 files plus two intentional skips; focused lifecycle/API/client/React/Studio tests pass; production builds are 258.37/210.13 KB across 29/24 modules; desktop and 700×900 in-app Studio walkthroughs showed no console errors or horizontal overflow and the canonical Edge flow passed in 13.3 seconds.
- [x] **M3-006** Add SEO, accessibility, link integrity, content-quality checks, and configurable publish gates.
  - Added canonical serializable policies, deterministic SEO/accessibility/link/editorial findings, stable paths and IDs, explainable deductions/scores, channel/locale/content-type selection, severity thresholds, and authorized role bypasses.
  - Added a scope-bound framework-neutral quality service with published-reference isolation, injected external-link adapters, candidate assessment, private REST/client routes, and revision-safe pre-publication enforcement before repository mutation.
  - Added a responsive Studio Quality panel with candidate rechecks, score/severity summaries, responsible field/block paths, remediation guidance, stale-report invalidation, and authoritative blocked-publish details; documented application-rendered audit boundaries.
  - Verification found and resolved `BUG-0094` through `BUG-0108`; `pnpm check` passes with 114 tests across 34 files plus two intentional skips, all lint/format/ledger/boundary/schema/type/build gates are clean, production bundles are 260.75/210.64 KB across 29/24 modules, desktop and 700x900 in-app checks show no console errors or horizontal overflow, and the canonical Edge flow passes in 11.5 seconds.

## Milestone 4 — Assets, workflow, releases, and search

- [x] **M4-001** Add S3-compatible assets, resumable uploads, renditions, focal points, metadata, and usage tracking.
  - Added canonical fully scoped asset/upload/rendition/metadata/focal-point/usage contracts, immutable asset revisions, framework-neutral repository/storage/rendition boundaries, durable local SQLite metadata, and an S3-compatible multipart client adapter.
  - Added exact recorded-part completion integrity, resume/abort state, private no-store REST authorization, universal-client methods, draft/published usage locations, and injected image-rendition processing without leaking preview or draft credentials into published caches.
  - Added a responsive Studio asset library with negotiated browser chunking, governed card metadata, focal/rendition/revision details, usage inspection, and managed schema-field choices; documented production adapters and the explicit M4-002 MIME/quarantine/private-delivery boundary.
  - Verification found and resolved `BUG-0109` through `BUG-0139`; the full pre-walkthrough `pnpm check` passed with 124 tests across 42 files plus two intentional skips, final lint/format/Studio typecheck and all 16 Studio tests pass, production builds are 265.56/211.97 KB across 29/24 modules, the canonical Playwright flow passes in 19.5 seconds, and 1440x900 plus 700x900 in-app asset upload/usage checks show responsive 3/1-column layouts with no console errors or horizontal overflow.
- [x] **M4-002** Add MIME/content verification, SVG sanitization, malware quarantine hooks, and signed private delivery.
  - Added canonical per-revision security verdicts, built-in MIME/signature and asset-kind inspection, a conservative fail-closed SVG sanitizer, injected malware scanning, and immutable quarantine findings without vendor dependencies in the control plane.
  - Made infection and scanner failure fail closed, denied legacy/unverified/quarantined object reads and renditions, retained full-scope storage isolation, and extended S3-compatible adapters with private object reads.
  - Added 30-900 second HMAC delivery grants bound to full tenant scope plus exact asset/revision identity, private no-store streaming with tamper/expiry checks and hardened response headers, API/client/runtime configuration, verified-only Studio choices, security badges, and the completed asset guide.
  - Verification found and resolved `BUG-0140` through `BUG-0154`; `pnpm check` passes with 133 tests across 46 files plus two intentional skips, all lint/format/ledger/boundary/schema/type/build gates are clean, production bundles are 266.29/212.19 KB across 29/24 modules, the canonical Edge flow passes in 7.5 seconds, and real sanitized-SVG walkthroughs at 1440x900 and 700x900 show verified state, 3/1-column layouts, no console warnings, and no horizontal overflow.
- [x] **M4-003** Add custom workflows, approvals, separation of duties, schedules, notifications, and escalations.
  - Added canonical versioned workflow contracts, graph validation, fully scoped in-memory/SQLite/PostgreSQL repositories, and a framework-neutral service for conditional approvals, distinct-actor separation of duties, escalation deadlines, persisted schedules, bounded notifications, and immutable history metadata.
  - Integrated workflow initialization and revision reset into the shared content lifecycle, enforced approval before REST/GraphQL/worker publication, preserved tenant and private-cache boundaries, and added authorized definition, transition, approval, schedule, cancellation, and due-processing API/client surfaces.
  - Added a responsive Studio governance panel for current state, available actions, approval decisions, Asia/Kolkata-safe IANA scheduling, cancellation, and activity; updated worker/seed behavior and documented authoring, adapter, security, schedule, notification, and M4-004/M4-005 boundaries.
  - Verification found and resolved `BUG-0155` through `BUG-0168`; `pnpm check` passes lint, format, ledger, boundary, schema, type, 142 tests across 48 passing files plus two intentional PostgreSQL skips, and production builds (273.05/213.50 KB across 29/24 modules); the governed Edge flow passes in 4.7 seconds, and 1440x900 plus 700x900 live walkthroughs show the full distinct-reviewer/schedule/cancel/publish lifecycle with no console errors or horizontal overflow.
- [ ] **M4-004** Add atomic multi-entry releases, future-state preview, validation, scheduling, and rollback policy.
- [ ] **M4-005** Add durable workflow designer/actions, retries, dead letters, idempotency, and delivery logs.
- [ ] **M4-006** Add pluggable search, indexing/rebuild/status, taxonomies, backlinks, and related content.

## Milestone 5 — Security, reliability, and v1 GA

- [ ] **M5-001** Complete OWASP ASVS-aligned threat models and security requirements.
- [ ] **M5-002** Harden tenant isolation across storage, cache, search, assets, jobs, events, and telemetry.
- [ ] **M5-003** Add plugin SDK capability manifests, grants, isolation, signatures, test harness, and lifecycle.
- [ ] **M5-004** Add OpenTelemetry logs/metrics/traces, dashboards, retention, health, and operational runbooks.
- [ ] **M5-005** Add backups, point-in-time recovery guidance, restore tests, graceful shutdown, and rolling-upgrade checks.
- [ ] **M5-006** Complete WCAG 2.2 AA/ATAG-informed review and supported browser/framework certification.
- [ ] **M5-007** Publish tested limits, benchmark profiles, support policy, SBOM, signatures, and vulnerability process.
- [ ] **M5-008** Run alpha, design-partner beta, release candidate, and v1 GA readiness reviews.

## Milestone 6 — Collaboration and enterprise governance

- [ ] **M6-001** Add CRDT-compatible field/block collaboration, suggestions, branches, merge, and conflict UI.
- [ ] **M6-002** Add SAML, SCIM, group mapping, WebAuthn, session policy, and audited break-glass access.
- [ ] **M6-003** Add retention, legal hold, data-subject workflows, customer-managed key adapters, and residency policies.
- [ ] **M6-004** Add official major-CMS importers, repeatable mapping recipes, dual-run sync, and cutover validation.
- [ ] **M6-005** Add signed marketplace packages, verified publishers, automated review, compatibility, and support metadata.

## Milestone 7 — Personalization, analytics, and governed AI

- [ ] **M7-001** Add consent-aware audiences, deterministic targeting, preview, edge decisions, and cache guidance.
- [ ] **M7-002** Add experiment lifecycle, allocation, guardrails, metrics contracts, and winner promotion.
- [ ] **M7-003** Add analytics adapters, normalized content/component events, release annotations, and content-operations metrics.
- [ ] **M7-004** Add provider-neutral AI gateway, scoped retrieval, prompt registry, budgets, redaction, and kill switches.
- [ ] **M7-005** Add structured AI authoring suggestions, provenance, evaluation, human approval, and semantic search.

## Milestone 8 — Platform leadership

- [ ] **M8-001** Add regional reads, multi-region control-plane options, failover, consistency indicators, and residency routing.
- [ ] **M8-002** Add federated external content types, cross-instance syndication, and contractual attribution.
- [ ] **M8-003** Add knowledge graph exploration, explainable recommendations, and sandboxed agentic operations.
- [ ] **M8-004** Add self-hosted fleet management and public interoperability specifications for archives, schemas, components, and preview source maps.
