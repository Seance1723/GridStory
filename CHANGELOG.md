# Changelog

All notable changes to GridStory are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow semantic versioning once the first public package is released.

## [Unreleased]

### Added

- Added four generated, committed Draft 2020-12 interoperability schemas/examples for the existing logical archive, canonical schema IR, serializable component manifest, and preview-only node source map; stable public discovery exposes only instance/service/protocol/specification identity and canonical digests with bounded public caching and ETags (M8-004).
- Added empty-by-default complete-scope fleet inventory with memory/SQLite/PostgreSQL persistence, distinct read/manage/check authorization, configured pull-only observation, strict freshness and exact contract compatibility conditions, private REST/client/neutral Studio controls, recovery/PostgreSQL/browser coverage, and verified `THREAT-0038`/`GS-SEC-042` evidence without any remote write or deployment authority (M8-004).
- Added private no-store on-demand relation/taxonomy knowledge graphs with per-entry authorization, cycle-safe bounded traversal, exact revision/path evidence, explicit truncation, and deterministic item recommendations whose visible contributions exactly sum to each score (M8-003).
- Added disabled-by-default least-authority knowledge agents with governed prompt/runtime policy, fixed mediated draft-read tools, redaction and call/time/byte limits, strict expiring single-draft text/slug plans, metadata-only tool evidence, human-only review, ordinary draft-update reauthorization/revalidation, persisted idempotent reconciliation/receipts, complete-scope memory/SQLite/PostgreSQL recovery, typed REST/client and neutral Studio controls, and verified `THREAT-0037`/`GS-SEC-041` evidence (M8-003).
- Added strict signed content-federation contracts, bounded immutable producer offers, pinned consumer agreements, published-only live external records, reviewed read-only mirror synchronization, explicit withdrawal tombstones, mandatory attribution, and complete-scope optimistic memory/SQLite/PostgreSQL persistence (M8-002).
- Added separately authorized private federation management and source routes, no-store minimized public delivery, a bounded same-origin HTTPS adapter, typed client methods, a neutral-palette Studio Federation panel, recovery/PostgreSQL/browser coverage, operator guidance, accepted ADR 0023, and verified `THREAT-0036`/`GS-SEC-040` evidence (M8-002).
- Added provider-neutral regional published delivery with strict topology/read evidence, explicit strong or bounded-staleness policy, trusted-local least-authority readers, response-bound cache partitions, digest-safe consistency headers, exact scope/revision/result validation, residency gating, and explicit primary fallback while remaining disabled and strong-primary by default (M8-001).
- Added complete-scope optimistic memory/SQLite/PostgreSQL regional persistence; distinct private read/manage/failover authorization; typed REST/client controls; a neutral Studio Regions panel; planned zero-loss and accepted bounded-loss emergency preflight; expiring digest-bound different-human approval; persisted idempotent execution; ambiguous reconciliation; single-writer result proof; recovery/PostgreSQL/browser coverage; the regional operator guide; accepted ADR 0022; and verified `THREAT-0035`/`GS-SEC-039` evidence (M8-001).
- Added strict fixed-contract AI authoring schemas, bounded actions and deterministic evaluation, complete-scope optimistic memory/SQLite/PostgreSQL proposal and review persistence, exact prompt/model/source/target provenance, and a separate human-only one-time `ai.review` transition that never writes content (M7-005).
- Added injected tenant-aware semantic adapter contracts, positive redacted text/slug indexing through existing identifier-only search jobs, private fail-closed current-revision search, typed REST/client/Studio controls, visible unsaved approved-value handoff, recovery/PostgreSQL/browser coverage, operator guidance, accepted ADR-0021, and verified `THREAT-0034`/`GS-SEC-038` evidence (M7-005).
- Added strict governed-AI contracts; complete-scope optimistic memory, SQLite, and PostgreSQL policy persistence; immutable active prompts; explicit scoped field retrieval; deterministic outbound/inbound redaction; conservative atomic budgets; metadata-only receipts; generic provider failures; and settlement-safe kill switches (M7-004).
- Added private AI authorization and REST routes, typed universal-client methods, a non-mutating Studio governance workbench, SQLite/PostgreSQL recovery coverage, operator guidance, accepted ADR-0020, and verified `THREAT-0033`/`GS-SEC-037` evidence (M7-004).
- Added strict normalized analytics schemas, bounded complete-scope memory/SQLite/PostgreSQL aggregates, transactional content-lifecycle normalization, idempotent processing, independent durable adapter fan-out, and non-authoritative published/rolled-back release annotations (M7-003).
- Added consent/GPC-gated exact-published public event ingestion, private operational reports, typed universal-client methods, Studio content/component/release/adapter metrics, recovery/PostgreSQL/browser coverage, analytics guidance/ADR, and verified `THREAT-0032`/`GS-SEC-036` controls (M7-003).

### Changed

- Accepted ADR 0025's generated-interoperability and pull-only fleet boundary: canonical contract generation and minimized public discovery are separate from private scoped observations, while arbitrary discovery, credentials, agents, scheduling, provisioning, remote mutation, deployment, upgrade, rollback, traffic, content, and publication control remain excluded.
- Accepted the M8-003 bounded-knowledge and reviewed-agent boundary in ADR 0024: private on-demand relation/taxonomy graph exploration, deterministic path-explained recommendations, fixed mediated read tools, and expiring human-reviewed single-draft patches without autonomous publication, arbitrary code, network access, or hidden memory.
- Accepted the M8-002 contract-bound content-federation boundary in ADR 0023: disabled complete-scope producer offers and pinned consumer agreements, signed published-only live reads, reviewed read-only mirror synchronization, explicit withdrawal tombstones, and mandatory source/version/license/credit attribution without remote or local editorial mutation.
- Accepted the M8-001 single-writer regional-delivery boundary in ADR 0022: only published reads may use evidence-bearing regional adapters, while drafts, preview, control reads, and writes remain strong-primary and failover remains a reviewed external-adapter operation.
- Accepted the M7-005 boundary for fixed-contract AI field suggestions, provenance, deterministic evaluation, human-only review, unsaved-editor handoff, and private allowlisted semantic search through derived adapter indexes.
- Recorded the accepted M7-004 governed AI gateway boundary: injected text-only providers, immutable active prompts, explicit allowlisted scoped retrieval, conservative usage/cost reservations, deterministic redaction, generic external failures, and rechecked kill switches without tools, raw histories, automatic fallback, or content mutation.
- Recorded the accepted M7-003 analytics boundary: anonymous consent-gated published content/component events, durable provider-neutral adapter fan-out, bounded complete-scope aggregates, and non-authoritative release annotations without identity, raw-event warehousing, or provider credentials in core.
- Recorded the accepted M7-002 governed-experiment decision: immutable running designs, consent-gated stateless deterministic allocation, externally computed bounded aggregate evidence, enforced allocation/metric guardrails, and explicit draft-only winner promotion without raw event ingestion or statistical-significance claims.
- Recorded the accepted M7-001 consent-aware targeting decision: bounded typed attributes, purpose-specific consent/GPC handling, deterministic first-match rules, authenticated hypothetical preview, published-only edge evaluation, and conservative cache guidance without persistent profiles or experiment allocation.
- Recorded the accepted M6-005 evidence-bound marketplace decision: operator-scoped publisher verification, signed compatibility/support metadata, injected non-executing artifact review, separate human approval, and approved-only handoff to the existing disabled plugin installation lifecycle.

### Fixed

- Sized the expanded Studio accessibility sweep for WebKit's runtime while preserving the complete multi-panel Axe and color checks (BUG-0374).
- Serialized root package test suites while preserving package-internal parallelism so heavyweight API/core work cannot starve Studio interaction tests (BUG-0373).
- Bounded API Vitest concurrency so complete Windows verification runs do not starve worker startup or time-sensitive observability fixtures (BUG-0372).
- Kept generator-owned interoperability artifacts out of a competing formatter pass while retaining exact generated-spec drift checks (BUG-0371).
- Preserved the established semantic archive-limit diagnostics while enforcing the new canonical archive shape at untrusted ingress (BUG-0370).
- Removed stale archive-contract type imports after canonicalization so the complete lint and architectural-policy chain remains warning-free (BUG-0369).
- Distinguished a persisted empty fleet document from repository absence so the first post-restore mutation updates version zero instead of conflicting (BUG-0368).
- Narrowed the discovery minimization regression to sensitive field names so legitimate public content-format identifiers remain covered (BUG-0367).
- Retained the fleet checked-event literal through document transforms so the bounded event contract compiles without widening (BUG-0366).
- Revalidated expiry and the current knowledge/AI policy before a crash-recovery retry may perform any still-needed agent draft mutation, with disabled-policy and expired-plan regressions proving fail-closed behavior (BUG-0365).
- Removed the unused knowledge-service policy import so the complete lint and architectural-policy chain remains warning-free (BUG-0364).
- Built the cycle-safety regression through valid revision-checked draft updates so existing reference-integrity validation remains exercised before graph traversal (BUG-0363).
- Closed the bounded knowledge-agent content projection expression so the schema/core boundary compiles cleanly (BUG-0362).
- Made the federation recovery fixture's timestamp deterministic and its direct SQLite handle unconditionally closable; the full recovery suite passes (BUG-0361).
- Removed stale federation-service imports and aligned equivalent state guards with the repository's optional-chain quality contract (BUG-0360).
- Made the API's deployed schema inventory injectable across schema-aware services so producers can explicitly offer supported text-only contracts, and aligned the API regression with durable source IDs and canonical attribution paths (BUG-0358, BUG-0359).
- Passed authenticated federation sync actor identity and validated execution input to the service in its exact contract order, restoring strict API compilation (BUG-0357).
- Preserved exact federation signing-key identity through strict parsing and aligned the external-type schema fixture with canonical default materialization (BUG-0354, BUG-0355).
- Calculated federated type fingerprints from the canonical parsed schema so producer signatures and consumer verification bind the same representation (BUG-0356).
- Reran the M8-002 focused schema/core TypeScript build through the approved Windows child-process path after the restricted sandbox denied compiler spawning (BUG-0353).
- Corrected regional schema initialization, hostile adapter error normalization, draft-result rejection, localized fallback scope, exact response-bound cache attestation, lint/browser fixtures, Windows worker/Docker verification paths, and stale README/security narratives found during M8-001; all defects BUG-0341 through BUG-0352 are resolved.
- Restored the AI workbench to the established neutral Studio page/content palette and prevented its broad supporting-text rule from overriding safety-warning colors; browser regressions now pin the computed surface, copy, input, boundary, and warning colors (BUG-0340, STUDIO-008).
- Preserved exact immutable AI action/evaluation provenance without retaining evaluation-failed suggested values, rebuilt the current package boundary for API verification, corrected Studio lint/accessibility and security-document drift, and used supported Windows formatting, child-process, config-inventory, and network verification paths (BUG-0332 through BUG-0339, M7-005).
- Reran the focused schema suite through the approved Windows child-process path after the restricted sandbox denied Vitest workers, then corrected the recovery inventory to use exact Windows paths (BUG-0330, BUG-0331).
- Confirmed a one-off WebKit process stall was non-reproducible through passing isolated and complete unchanged reruns of the standalone-preview vertical slice (BUG-0329).
- Corrected the governed-AI regex, optional receipt guard, and API source-entry typing found by the root lint gate (BUG-0328).
- Added the missing governed-AI operator/security guide required by verified `GS-SEC-037` evidence (BUG-0327).
- Corrected the AI route integration fixture to satisfy the current required component-tree page contract before exercising governed retrieval (BUG-0326).
- Updated legacy API outbox/workflow job-count fixtures to include the intended normalized content-lifecycle analytics processing jobs (BUG-0325).
- Made the analytics report's durable-job scope audit explicitly side-effect-only so the full repository lint gate remains warning-free (BUG-0324).
- Redacted hostile analytics-adapter exception text into a stable generic delivery failure before durable job/report retention, while preserving independent retry and aggregate truth (BUG-0323).
- Aligned the analytics adapter fixture with seeded server lifecycle evidence and verified created, published, and browser component deliveries independently (BUG-0322).
- Required every public analytics event to match the current exact published content ID, type, and revision before durable processing, rejecting fabricated, draft, or stale references (BUG-0321).
- Made the analytics API denial fixture explicitly anonymous so it tests the private-report authorization boundary rather than the development identity default (BUG-0320).
- Kept private analytics idempotency receipts out of the strict authenticated report projection so bounded metrics remain readable without exposing event receipt IDs (BUG-0319).
- Returned grammatically correct explicit Studio notices for every experiment lifecycle transition instead of generating `pauseed`/`resumeed` labels (BUG-0318).
- Bounded the existing multi-step guarded-migration Studio regression exposed by the M7-002 full parallel gate without increasing the suite-wide timeout (BUG-0317).
- Bounded the multi-step M7-002 Studio lifecycle regression timeout so it remains reliable under the full parallel workspace gate (BUG-0316).
- Corrected the M7-002 machine-readable threat-model insertion so THREAT-0031 is registered as a threat rather than an actor (BUG-0315).
- Corrected the M7-002 invalid-control regression fixture so schema validation remains intact while the intended published-target service gate is exercised (BUG-0314).
- Preserved Studio header contrast in WebKit forced-colors mode at 200% zoom by resolving its foreground, background, and boundary from one system palette (BUG-0313).
- Tightened M7-001 token-only value minimization, fixed-length complete cache identifiers, public audience redaction, Studio unsaved-publication protection, exact-optional/test trace fixtures, lint-safe schema regressions, and managed Windows verification paths discovered during implementation and audit (BUG-0304 through BUG-0312).
- Corrected marketplace public-summary projection, strict SemVer typing, bodyless API fixtures, Studio review-region semantics, deterministic test-ID construction, and exact configured-inspector identity binding discovered during M6-005 verification and final audit (BUG-0298 through BUG-0303).
- Corrected M6-004 schema/repository/API/workflow/publication/WordPress fixtures and exact-optional boundaries, verified pending-link crash recovery, restored scoped Windows formatter and audit invocation, formatted the exact migration change set, and removed the Studio cascade override found during verification (BUG-0286 through BUG-0297).
- Corrected the M6-003 service/telemetry/cache exact-optional boundaries, bodyless API fixture, scoped formatter/import/lint quality, and broad Studio fixture timing discovered during verification (BUG-0278 through BUG-0285).
- Corrected enterprise identity dependency boundaries and exact types, optimistic/durable mutation behavior, denial persistence, federated-role reconstruction, one-time test fixtures, SCIM filtering, production cookie defaults, exact audit-event coverage, forced-colors contrast, lint quality, and final security-document consistency found during M6-002 (BUG-0259 through BUG-0273, BUG-0275 through BUG-0277).
- Overrode vulnerable Fastify/Mercurius transitive production dependencies with patched compatible releases; `pnpm audit --prod` reports no known vulnerabilities (BUG-0274).
- Corrected collaboration schema evaluation, service defaults and exact targets, SQLite test cleanup, API request typing, Studio JSON containment, interaction fixtures, review-region semantics, PostgreSQL schema qualification, and an API diagnostic dependency-boundary violation found during M6-001 (BUG-0248 through BUG-0258).
- Corrected the five-package README/SPDX gap, inaccurate baseline wording, unpublished offline dependency resolution, missing installed `pg` declarations, and cleanup control flow found during M5-009 (BUG-0243 through BUG-0247).
- Corrected the staged-readiness validator's formatter wrapping found during M5-008 verification (BUG-0242) and logged its publication-metadata gap as BUG-0243 for M5-009/RC-003.
- Aligned the API's binary multipart route with its advertised 5 MiB part size and corrected M5-007 type, benchmark-concurrency/output/memory, archive-layout/inventory, checksum-callback, lint, and restricted Windows verification defects (BUG-0232 through BUG-0241).
- Corrected accessibility contrast, browser-native picker backgrounds, WebKit sequential bypass focus, forced-colors cascade ordering, cross-engine scenario timing, generated SSR source-gate scope, and Windows verification/install-path issues found during M5-006 (BUG-0225 through BUG-0231).
- Corrected shutdown-state TypeScript narrowing, recovery/rollout/process-smoke fixtures, and restricted Windows process execution encountered during M5-005 verification (BUG-0219 through BUG-0224).
- Corrected OpenTelemetry 0.221 log-processor construction, minimized public readiness failures, preserved handled authorization errors in correlated logs with correct HTTP span semantics, made the reference Collector persistent queue bootable, corrected README/lint drift, and restored frozen workspace links after the dependency update (BUG-0212 through BUG-0218, M5-004).
- Corrected plugin schema typing/traceability/lint issues and eliminated a PostgreSQL schema-initialization race; the PostgreSQL gate now rebuilds current packages before running core/API conformance (BUG-0205 through BUG-0211, M5-003).
- Required LF working-tree checkout for tracked text so Windows `core.autocrlf` cannot break Biome or generated-contract validation; restored the complete repository, PostgreSQL, browser, and final whitespace gates (BUG-0203, BUG-0204, FND-006).
- Resolved tenant-isolation, hostile-adapter, collision-safe cache/key, scoped identity/grant, canonical telemetry, and Windows verification defects found during M5-002 (BUG-0194 through BUG-0202).
- Corrected stale README capability/identity milestones and used the verified exact-formatter and unrestricted full-check paths for Windows validation (BUG-0191 through BUG-0193).

- Corrected search contract defaults, adapter wiring, Windows edit artifacts, operations expectations, and the unsafe successful no-op search runner found during M4-006 verification (BUG-0181 through BUG-0190).

- Corrected exact-optional integration, missing Studio action type import, and saved-input assertion defects found during M4-005 verification (BUG-0174 through BUG-0180).

- Corrected release schedule narrowing, collection callbacks, unused types, and Studio release-list accessibility, stable-key, and responsive list-reset defects found during M4-004 verification (BUG-0169 through BUG-0173).

- Corrected workflow initialization, accessibility, verification fixtures, HTTP handling, matcher usage, Awaitable assertions, and cleanup regressions found during M4-003 verification (BUG-0155 through BUG-0168).

- Closed SVG namespace, XML processing-instruction, and external-URI sanitizer bypasses; corrected M4-002 fixture, patching, lint, graph, ledger, process-launch, and root test-runner defects (BUG-0140 through BUG-0154).
- Required completion descriptors to match server-recorded multipart ETags and sizes before consuming storage, chunked Studio files by the negotiated part size, and corrected asset implementation/test integration defects (BUG-0109 through BUG-0139).

- Aligned the temporary browser bundle API URL and CORS origin for deterministic local walkthroughs (BUG-0108).
- Normalized new report punctuation for Windows-safe source encoding and restored a split changelog bullet (BUG-0106, BUG-0107).
- Kept the quality-gate error test import type-only under the repository lint contract (BUG-0105).
- Normalized temporary semantic test nodes to Graphify's supported code type (BUG-0104).
- Used PowerShell 5.1-compatible UTF-8 output for temporary semantic graph assembly (BUG-0103).
- Preserved publish authorization while testing explicitly configured quality-gate role bypass (BUG-0102).
- Used the approved Vitest worker path and aligned the score regression with the configured threshold (BUG-0100, BUG-0101).
- Removed literal newline escape tokens from the client type surface after a Windows edit-path regression (BUG-0099).
- Modeled the optional external-link checker explicitly under exact optional property semantics (BUG-0098).
- Made nested quality-policy defaults explicit so strict schema types and runtime resolution stay aligned (BUG-0097).
- Used the exact workspace formatter binary when the scoped package-manager wrapper could not resolve Biome (BUG-0095).
- Used Graphify's deterministic sequential AST path when the managed Windows sandbox denied multiprocessing pipe creation (BUG-0094).
- Consolidated the Studio component-governance styles and added intentional two-/one-column breakpoints so narrow viewports do not inherit the desktop grid (BUG-0093).
- Isolated canonical Edge verification from narrower temporary walkthrough servers so the preview application always receives its required origin policy (BUG-0092).
- Used a direct scoped Biome invocation after the root format wrapper ignored appended path arguments, preventing broad incidental formatting during component-lifecycle work (BUG-0091).
- Returned stable `invalid_due_date` errors, admitted browser `PATCH` preflight, excluded trailing punctuation from actor mentions, honored default asset-kind inputs, corrected Studio collaboration semantics, target coherence, and lifecycle dependencies, restored lint-clean tests and ledgers, kept localization completeness fixtures aligned, made generated imports formatter-stable, and bounded browser and Windows formatter lifecycle verification (`BUG-0078` through `BUG-0090`).
- Added scope-checked management revocation for origin-bound preview grants so Studio can close sessions without impersonating the preview application (`BUG-0066`).
- Kept the explicit browser preview entry free of the Zod-backed schema barrel, restoring small production module graphs while retaining compile-time protocol drift detection (`BUG-0067`).
- Serialized application-side message acceptance so back-to-back navigation and patch messages cannot be reordered into false replay failures (`BUG-0071`).
- Corrected preview configuration, bodyless revocation, and status-text regressions discovered during focused verification (`BUG-0068` through `BUG-0070`).
- Allowed the browser preview runtime's token-authenticated message requests through CORS preflight by admitting the `authorization` header (`BUG-0073`).
- Corrected the Edge iframe assertion to distinguish the entry title from the rendered Hero heading (`BUG-0074`).
- Prevented embedded and opener-controlled preview applications from fetching or priming published delivery caches while awaiting authenticated draft patches (`BUG-0075`).
- Preserved Studio's authoritative queued preview route when the runtime becomes ready, removing a timing-dependent bootstrap-path overwrite (`BUG-0076`).
- Preserved formatter-required LF line endings during Windows verification (`BUG-0072`).
- Removed a recurring CRLF/byte-order-marker artifact from the final preview patch set (`BUG-0077`).
- Normalized optional root component acceptance before Studio palette filtering so strict type checking remains sound.
- Documented and used scoped process-launch approval for Windows schema generation and Vite-backed verification in the managed workspace.
- Replaced static composition interactions with semantic buttons, sections, and fieldsets and simplified slot typography selectors so accessibility and stylesheet lint remain clean.
- Prevented slot help activation from attempting self-nesting and made clamped same-position moves true no-ops so they do not dirty drafts or add misleading undo steps.
- Derived component-presentation TypeScript output from its canonical Zod contract, eliminating exact-optional drift between runtime validation and public types.
- Corrected the governed-reuse Studio regression's recursive layer-count expectation and verified all nine composition/design interaction tests.
- Made focused React package typechecks rebuild the public schema declaration boundary, preventing stale design-contract types from producing false failures.
- Restricted Studio token choices by the complete prop contract—including enum membership, numeric bounds, and string lengths—and added responsive override removal coverage.
- Kept design-system constants type-only in browser bundles, removing accidental runtime validation code and reducing the Vite/Studio outputs from 284/315 KB to 203/234 KB.
- Mapped malformed preview targets into the stable `invalid_preview_url` response boundary instead of allowing generic URL exceptions to become server errors.

### Added

- Added bounded experiment design/lifecycle/aggregate-evidence contracts, stateless SHA-256 weighted allocation, consent/GPC and targeting eligibility gates, active-placement exclusion, immutable running designs/snapshots, allocation/sample/absolute guardrails with automatic pause, and explicit evidence-backed targeting-draft-only promotion.
- Added complete-scope optimistic experiment persistence inside targeting; distinct authorized management/metric/promotion and anonymous no-store allocation routes; typed universal-client methods; a responsive accessible Studio workbench; SQLite/PostgreSQL restart/restore evidence; governed experiment guidance; ADR 0018; `THREAT-0031`; and verified `GS-SEC-035`.
- Added bounded consent-purpose, targeting-attribute, audience, resource-decision, context, preview, result, cache-guidance, and draft/published snapshot contracts with strict cross-reference, type, value, priority, purpose, classification, cacheability, and resource limits.
- Added deterministic first-match/fallback evaluation with denied-consent and purpose-specific GPC gates, private redacted hypothetical audience/variant preview, public audience-identity redaction, published-only anonymous decisions, and fixed-length complete shared-cache keys only for bounded public consent-independent inputs.
- Added complete-scope optimistic in-memory, SQLite, and qualified PostgreSQL personalization persistence; private authorized management/preview and anonymous published-only REST routes; typed universal-client methods; a responsive accessible Studio workbench; SQLite/PostgreSQL recovery coverage; ADR 0017; operator/privacy/cache guidance; `THREAT-0030`; and verified `GS-SEC-034`.
- Added bounded signed marketplace discovery, compatibility, tested-runtime, support, capability, digest, and size metadata; expiring DNS publisher possession with separate evidence-referenced human approval/suspension; immutable release submission/review/approval/rejection/yanking; injected non-executing exact-artifact inspection; and approved-only disabled/no-grant Plugin SDK installation handoff.
- Added complete-scope optimistic memory, SQLite, and qualified PostgreSQL marketplace persistence; private/no-store authorized REST and typed-client operations; a responsive accessible Studio workbench; recovery/PostgreSQL/browser coverage; operator/support/incident guidance; accepted ADR 0016; `THREAT-0028`/`THREAT-0029`; and verified `GS-SEC-033`.
- Added bounded CMS-migration contracts and limits; complete-scope optimistic in-memory, SQLite, and qualified PostgreSQL documents for versioned recipes, projects, links, private plans, checkpoints, runs, and cutover reports; and deterministic mapping/reconciliation above normal content schema, reference, workflow, quality, governance, revision, route, and publication gates.
- Added maintained read-only Contentful Sync, Sanity NDJSON export, and WordPress REST adapters with injected fetch/credentials, fixed credential-free HTTPS origins, disabled redirects, same-origin continuation, response/record bounds, strict normalization, trustworthy delta/full-reconciliation semantics, and no source mutation surface.
- Added exact-effect expiring dry-runs, digest-bound idempotent execution, target/source/project/recipe drift blockers, non-destructive deletion reporting, pending-link crash recovery, post-success checkpoints, complete cutover validation, private authorized REST and typed-client methods, and a responsive accessible Studio migration workbench.
- Added CMS migration/operator/rollback guidance, accepted ADR 0015, live SQLite migration-state recovery, PostgreSQL conformance, `THREAT-0026`/`THREAT-0027`, and verified `GS-SEC-032` while retaining credentials, egress, provider backups, binary media, application acceptance, traffic switching, and source decommissioning as explicit operator/deployment responsibilities.
- Added bounded fully scoped governance contracts, optimistic in-memory/SQLite/PostgreSQL persistence, explicit subject/resource links, retention rules, active/released legal holds, processing restrictions, rights request state, ordered hash-chained events, and recovery coverage.
- Added dry-run retention/erasure plans with exact effect/blocker summaries, SHA-256 digests, separate fresh approval and verified-backup evidence, worker-time revalidation, idempotent receipts, and built-in content/asset/identity processors that destructively execute only against isolated test fixtures.
- Added deterministic subject exports with optional AES-256-GCM envelopes and tenant-bound wrapped DEKs, narrow injected AWS KMS/Google Cloud KMS wrappers, CMK describe/wrap/unwrap-only authority, placement attestations and allowed-region gates without migration/routing claims, private REST and typed universal-client operations, and a responsive Studio governance panel.
- Added data-governance/rollback/restore/operator guidance, accepted ADR 0014, `THREAT-0025`, and verified `GS-SEC-031` evidence while retaining customer discovery, legal decisions, external processors, live provider configuration, and actual placement as deployment responsibilities.
- Added bounded tenant-scoped enterprise identity contracts, optimistic in-memory/SQLite/PostgreSQL persistence, scoped group-to-role materialization, ordered security events, and an ADR separating maintained Node protocol verification from the framework-neutral identity kernel.
- Added production OIDC Authorization Code with discovery/state/nonce/S256 PKCE, signed SAML Web SSO with durable RelayState/InResponseTo replay protection, exact-origin/RP/user-verified WebAuthn enrollment and step-up, and fail-closed production request authentication using hashed opaque secure-cookie sessions.
- Added RFC-shaped tenant-authenticated SCIM Users/Groups discovery, filtering, PATCH, ETags, lifecycle revocation, and one-time directory credentials; added idle/absolute/reauthentication/concurrency session policy and single-use, incident-bound, rate-limited, audited break-glass access.
- Added typed universal-client identity operations, a responsive Studio enterprise identity administration panel, deployment/operations guidance, PostgreSQL conformance, security-model evidence, and direct keyboard/axe coverage across Chromium, Firefox, and WebKit.
- Added bounded CRDT-compatible collaboration contracts with stable operation identity, actor clocks, causal dependency heads, deterministic multi-value field/block state, preserved conflict variants, suggestions, branches, merge records, and explicit resolution operations.
- Added optimistic fully scoped in-memory, SQLite, and PostgreSQL collaboration repositories, durable comments/history, authorized private/no-store REST and universal-client methods, arrival-order/idempotency/tenant/restart regressions, and ADR 0012.
- Added a responsive Studio collaboration workbench for sharing current field or selected-block values, creating branches, reviewing suggestions, merging into Main, and resolving competing variants without changing published delivery.

- Added package-specific install/export/license guides, exact README/LICENSE/manifest archive validation with 10 negative cases, and an OS-temporary offline consumer that installs all five tarballs, executes every module/stylesheet export, and strictly type-checks installed declarations.
- Added a dated evidence-linked alpha/beta/RC/GA review, fail-closed stage/outcome/path validator with nine negative overclaim tests, staged-readiness guide, ADR 0010, and a root `pnpm readiness:check` gate.
- Added one exported machine resource profile, Zod-validated SQLite/PostgreSQL application-pipeline benchmarks, explicit asset/archive/GraphQL boundary regressions, and a public tested-limit/retention/deployment claim boundary.
- Added pre-v1 support and private vulnerability-reporting/remediation policies, weekly/PR OSV lockfile scans, grouped Dependabot updates, reviewed private package packing, SHA-256 manifests, pinned SPDX SBOM generation, and GitHub/Sigstore provenance plus SBOM attestation workflows.
- Added unsuppressed WCAG 2.2 A/AA-tagged axe audits for critical Studio and published states, plus executable keyboard bypass/movement, 24-by-24 target, 200% zoom/reflow, reduced-motion, and forced-colors checks.
- Added pinned Chromium, Firefox, and WebKit release projects and CI installation, with the complete secure preview, governed authoring, publication, and React-delivery journey running independently on each engine.
- Added isolated React 18.3.1 Vite SPA/SSR certification alongside current React 19.2.7 rendering, static/SSR, hydration, and Vite 8.1.5 production evidence, plus an exact public support matrix and ATAG-informed review.
- Added checksummed native SQLite/PostgreSQL backup, verification, and isolated restore commands; live-WAL SQLite and disposable PostgreSQL dump/mutate/restore drills; and operator guidance separating logical restore from base-backup plus continuous-WAL PITR.
- Added a shared bounded API/worker signal controller, interruptible worker polling with current-cycle drain, configurable shutdown deadline, exact current/candidate HTTP rollout preflight, and recovery/RPO/RTO/expand-contract/rollback guidance.
- Added an opt-in Node OpenTelemetry runtime using official OTLP/HTTP log, metric, and trace exporters, explicit safe Fastify/worker instrumentation, validated tenant-event adaptation, shutdown flushing, and authorized private/no-store Collector health.
- Added a pinned contrib Collector template with memory/redaction/batch/retry/persistent-queue controls, a six-panel Grafana operations dashboard, five Prometheus alerts, live three-signal/leakage regressions, a complete signal inventory, retention targets, and operational/incident runbooks.
- Added Plugin SDK v1 signed capability manifests, constrained tenant grants, compatibility and artifact verification, durable in-memory/SQLite/PostgreSQL lifecycle state, explicit revoke/uninstall history, and a test-only harness behind a production external-runtime adapter.
- Added admin-authorized private/no-store plugin lifecycle and bounded invocation REST routes, matching universal-client methods, cross-layer regressions, PostgreSQL conformance, and an operator/security integration guide.
- Added the canonical validated six-field tenant-scope module, bounded secret-safe telemetry envelope, adversarial cross-scope regression suite, and `pnpm tenant:check` static contract gate.
- Added a canonical STRIDE threat model covering actors, assets, nine trust boundaries, twelve data flows, 22 owned threats, risk scoring, mitigations, evidence, and review triggers.
- Added an OWASP ASVS 5.0.0 Level 2-oriented profile with explicit applicability for all 17 chapters and 29 stable GridStory security requirements linked to threats, evidence, owners, and delivery tasks.
- Added human-readable threat-model, security-requirements, and ASVS-profile guides plus deterministic validation and negative self-tests through pnpm security:check and the root lint gate.

- Added pluggable scoped search contracts and a repository-backed default adapter with bounded full-text queries, content-type filters, hierarchical taxonomy facets, exact-perspective results, and typed universal-client access.
- Added durable incremental indexing and scoped rebuild/status operations, schema-derived backlinks, explainable related-content scoring, authorized private REST routes, worker execution, Studio discovery tooling, focused regressions, and an integration guide.

- Added bounded notification, signed webhook, and cache-tag actions to versioned workflow transitions, with exact completed-transition snapshots and restart-safe reconciliation into tenant-scoped durable jobs.
- Added dedicated workflow-action permissions, private/no-store list, drain, and replay APIs, universal-client methods, worker execution, a responsive Studio state/action designer, and an attempts, errors, results, dead-letter, and replay delivery log.

- Added canonical scoped release, member, validation, future-preview, schedule, and rollback-policy contracts; durable in-memory/SQLite/PostgreSQL release repositories; and a framework-neutral release service.
- Added transactional multi-entry revision publication for SQLite/PostgreSQL, whole-future-state route/reference/workflow/quality validation, exact pinned previews, scheduled execution, policy-aware atomic rollback, authorized REST/client methods, a responsive Studio release manager, regressions, and integration documentation.

- Added canonical versioned workflow state/transition/approval/schedule/notification/history contracts, field/locale approval conditions, fully scoped in-memory/SQLite/PostgreSQL repositories, and a framework-neutral workflow service with separation of duties and deadline escalation.
- Added private authorized workflow definition/entry/transition/approval/schedule endpoints, worker execution, universal-client methods, a responsive Studio governance panel, focused cross-layer regressions, and the editorial workflow integration guide.

- Added immutable per-revision asset security verdicts, magic-byte/text MIME and kind verification, conservative fail-closed SVG sanitization, injected malware scanning, infection/scanner-failure quarantine, and verified-only rendition/private-read enforcement.
- Added scope/asset/revision-bound short-lived HMAC private-delivery grants, private/no-store streaming with `nosniff` and SVG CSP headers, S3 private-object reads, API configuration, universal-client resolution, verified/quarantined Studio states, focused cross-layer regressions, and completed asset-security documentation.
- Made intentionally testless example-kit and example Vite packages compatible with the root interactive test command while retaining their one-shot verification scripts.
- Added canonical scoped asset, immutable revision, portable metadata, focal-point, rendition, multipart upload, and draft/published usage contracts.
- Added framework-neutral asset service/repository/storage/rendition boundaries, durable local SQLite metadata, an S3-compatible multipart adapter, resumable completion integrity, and scoped usage scanning.
- Added authorized private/no-store asset REST routes and matching universal-client methods for listing, upload resume/abort/complete, metadata revisions, renditions, and usage.
- Added a responsive Studio asset library and managed field picker, negotiated browser chunking, focused schema/core/API/client/Studio regressions, and an asset integration/security-boundary guide.

- Added serializable content-quality policies and explainable SEO, accessibility, scoped link-integrity, and editorial findings with stable paths, severities, deductions, and scores.
- Added framework-neutral candidate assessment, injected external-link adapters, private REST/client endpoints, revision-safe pre-publication gates, and explicit authorized role bypasses.
- Added a responsive Studio Quality panel with candidate rechecks, severity summaries, field/block paths, remediation guidance, and authoritative blocked-publish reports.
- Added focused schema, core, API, client, and Studio regressions plus a content-quality integration guide covering cache, tenant, adapter, and application-rendered audit boundaries.
- Added component lifecycle governance with deprecation metadata, deterministic declarative prop migrations, scope- and perspective-aware usage impact, draft-only revision-safe migration APIs/client methods, code-owned visual regression scenarios, preview renderer hooks, and a Studio Components panel.
- Added versioned semantic rich-text documents, typed asset references, rich-text/asset field definitions and validation, generated authoring types, and a version 4 example page schema with story, social-image, and related-page fields.
- Added an explicitly tenant-scoped collaboration service and private API/client surface for entry/field/node comment threads, actor mentions, assignees, due dates, replies, resolution, and expiring presence heartbeats with viewer/author permissions.
- Added Studio semantic block controls, rich-text marks, demonstration asset and searchable reference pickers, selected-component inline preview editing, active-editor presence, and threaded comment authoring through the typed client.
- Added schema, core, API, client, and Studio regressions plus the authoring/collaboration guide covering validation, authorization, cache/preview isolation, adapter durability, and M4 asset boundaries.
- Added an explicit `@gridstory/client/preview` browser entry with exact-origin/source-checked controller and application runtimes, credential-free preview URLs, bounded bootstrap retry, queued live patches, bidirectional route synchronization, replay-checked readiness, and click-to-edit selection messages.
- Added typed universal-client methods for preview session creation, isolated token-authenticated draft/message requests, self-revocation, and management revocation without leaking tenant or actor headers into preview requests.
- Added Studio application-preview controls for sandboxed iframes and standalone popup sessions, live unsaved draft patches, route/status display, source-click selection, session cleanup, and scoped revocation.
- Added the preview runtime and source overlays to the ordinary Vite React application plus dedicated preview secret/origin/application/Studio environment configuration and an Edge walkthrough covering iframe, standalone, routing, live patching, selection, publication, and delivery.

- Added versioned embedded/standalone preview session and message contracts for handshake, readiness, full-content live patches, route navigation, click-to-edit selection, and stable errors.
- Added short-lived HMAC-signed preview grants bound to audience, full content scope, target origin, route, mode, optional entry, and expiry, with HTTPS/allow-list enforcement, revocation, monotonic message ordering, nonce replay rejection, and bounded replay memory.
- Added authorized preview-session issuance plus origin/token-bound draft retrieval, replay-checked protocol message acceptance, and authenticated revocation endpoints under private/no-store management caching.
- Added canonical design-system contracts for typed design tokens, ordered responsive breakpoints, component variants, controlled reusable symbols, composition templates, and node-level variant/token/responsive/symbol bindings with duplicate/order validation.
- Added schema regressions for normalized design manifests, duplicate IDs, breakpoint ordering, and lossless component presentation bindings.
- Added a versioned example design system with application-approved tokens, responsive breakpoints, variants, a controlled reusable Callout symbol, and a nested campaign template.
- Added an authorized design-system management endpoint and framework-neutral typed client method using the existing component-read permission boundary and private management caching.
- Added deterministic React presentation resolution with controlled linked-symbol overrides, component-checked variants, token bindings, explicit SSR-safe breakpoint selection, nested propagation, and renderer regressions.
- Added Studio design controls for component variants, type-compatible token bindings, breakpoint override capture and live preview, governed symbol insertion/override fields, and atomic recursive template insertion with fresh node IDs.
- Updated the standalone Vite application to resolve the same code-owned design-system presentation metadata during published delivery.
- Pinned bound node presentation metadata to an immutable design-system version, rejected unpinned bindings, and made mismatched application/content versions fall back to stored component props instead of silently changing published output.
- Added the design-system authoring guide covering manifest governance, authorized delivery, deterministic resolution order, version mismatch behavior, SSR-safe breakpoint selection, Studio controls, and revision boundaries.
- Added an immutable Studio composition command model with recursive layers, slot/root constraint enforcement, cycle-safe add/remove/reparent/reorder operations, prop updates, stable selection, and bounded branching undo/redo history.
- Added command regressions for accepted and rejected nesting, slot/root cardinality, immutable reordering, recursive layer projection, self-nesting prevention, history bounds, redo, and branch invalidation.
- Added Studio composition layers, root/slot palettes, nested property inspection, constrained drag/drop reparenting, arrow-key movement, deletion, selection, undo/redo, and visible slot capacity/acceptance guidance.
- Added an application-owned Stack layout component with a bounded content slot, spacing and surface props, production React rendering, and a version 3 example page contract that permits nested composition.
- Added the visual-composition guide covering component ownership, palette/layer behavior, slot constraints, keyboard and pointer controls, history semantics, validation boundaries, and integration steps.
- Added scope-bound per-entry SHA-256 audit hash chains, deterministic legacy-event backfill, integrity verification, aggregate export checksums, and JSON/streamed JSON Lines administrator exports.
- Added administrator-only audit read/export permissions and APIs, typed SDK methods, a scoped operational dashboard for content/outbox/jobs/webhooks/audit integrity, and an on-demand Studio operations panel.
- Added cross-scope audit-chain conformance, deliberate tamper detection, operations aggregation, API authorization/export, SDK routing, and Studio administrator-view regressions.
- Added the versioned GridStory logical-content archive contract with canonical JSON, SHA-256 per-entry and aggregate checksums, source/schema metadata, stable content/revision/audit/translation IDs, and JSON Lines serialization/parsing.
- Added scoped SQLite/PostgreSQL archive export and atomic dry-run/reject/skip/replace import primitives with cross-scope ID protection and explicit rollback boundaries.
- Added administrator-only portability export/import permissions and JSON/streamed JSON Lines APIs, schema mismatch controls, typed client methods, a migration runbook, and corruption/conflict/non-mutation/replacement/rollback regressions.
- Added atomic content outbox emission inside SQLite/PostgreSQL create, draft-update, and publish transactions with immutable payloads, exact revision identity, deterministic cache tags, durable state, attempts, availability, and expiring leases.
- Added full-scope idempotent durable jobs with exclusive SQLite leases, PostgreSQL `SKIP LOCKED` claims, capped exponential retry, dead letters, results/errors, lease recovery, and immutable replay jobs.
- Added scoped webhook subscription persistence, HTTPS/public-host and optional allow-list enforcement, event filtering, redirect-free timeouts, delivery logs, HMAC-SHA256 timestamped signatures, and receiver identity headers.
- Added provider-neutral cache invalidation jobs and `Cache-Tag` response headers for direct, routed, localized, and connection delivery while retaining full-scope `Vary` isolation.
- Added separate operations read/manage/run/replay permissions, management APIs, typed client methods, worker scope discovery, a standalone graceful worker process, runtime configuration, and an operations runbook.
- Made focused API typechecks rebuild their public schema, core, and example-kit declaration boundaries before validating worker and server integration.
- Added canonical schema-declared localized fields with semantic validation, versioned backfill diff classification, migration impact, and unchanged code-generated content value types.
- Advanced the example page schema to version 2 for its localization contract, preserving immutable schema-version evolution.
- Added site locale configuration with one required default, BCP 47-style codes, ordered multi-fallbacks, legacy single fallback support, optional route prefixes/required status, enabled-reference validation, and cycle rejection.
- Added durable SQLite/PostgreSQL translation-group linkage, unique full-scope locale variants, automatic legacy-entry group backfill, and cross-adapter isolation conformance.
- Added translation creation that preserves canonical non-localized fields, independent locale revisions/publication state, duplicate-locale protection, and required-locale field/publication completeness reporting.
- Added explicit published fallback results, locale-prefixed route resolution, REST/GraphQL locale management and delivery, locale-aware SDK methods, runtime JSON configuration, and localization documentation.
- Added a shared, bounded content-query contract with recursive boolean filters, 13 predicate operators, safe nested paths, deterministic multi-field sorting, immutable ID tie-breaking, nested projections, and connection-style results.
- Added HMAC-SHA256 signed opaque cursors bound to exact scope-independent query semantics, with tamper detection, cross-query reuse rejection, stable continuation after deleted rows, and a configurable production signing secret.
- Added management and published REST query endpoints with GET/POST input forms, strict request validation, full hierarchy scope, RBAC/ABAC checks, and separate private/public cache policies.
- Added Mercurius/GraphQL 16 delivery and management APIs for content connections, direct reads, schema/component inspection, lifecycle/drift inspection, content mutations, and schema plan/deploy mutations.
- Added GraphQL resolver-level authorization, anonymous published delivery, query-depth and request-size bounds, disabled batching/subscriptions/embedded IDE, and private no-store protection for mixed documents.
- Extended the universal client with typed management and published content-query methods and exported filter, sort, connection, and cursor-facing contracts.
- Added query-engine, REST, GraphQL, authorization, cache-separation, projection, pagination, cursor-integrity, and client regression coverage plus a complete content-query/GraphQL guide.
- Added the research-backed React-first CMS product, feature, architecture, and implementation plan.
- Added `TASKS.md` with stable task IDs, milestones, acceptance workflow, and completion states.
- Added `BUGS.md` with permanent open/resolved defect tracking and severity definitions.
- Added repository instructions that require task-list, changelog, and bug-ledger maintenance for every application change.
- Added the pnpm workspace, shared strict TypeScript configuration, package boundaries, root development/build/test commands, environment template, and runtime-data ignore rules.
- Added Biome formatting/linting, an executable workspace package-boundary validator, and Playwright browser-test commands.
- Added GitHub Actions quality/browser jobs and executable governance-ledger validation, including pull-request enforcement for task and changelog updates.
- Added accepted architecture decisions for the canonical schema IR, immutable revisions, explicit tenant context, isolated preview sessions, and capability-based plugins.
- Added one-command setup and troubleshooting guidance for ports, CORS, declarations, SQLite, local data reset, and browser verification.
- Added initial package manifests for the schema, core, universal client, React renderer, and example component kit.
- Added type-level schema/manifest inference and deterministic TypeScript declaration generation for application-facing content, props, slots, and ID lookup maps.
- Added shared organization, tenant, workspace, site, environment, locale, principal, request-context, OIDC session, service-account, and scoped-token contracts.
- Added an active-hierarchy scope registry and deny-by-default authorization policy with built-in RBAC roles plus tenant/site/environment/locale/content-type ABAC grants.
- Added an OIDC verifier boundary, trusted issuer/audience enforcement, revocable sessions, group-to-role mapping, service accounts, and hashed opaque scoped service tokens.
- Added explicit API request-context construction, development principal mapping, authorization checks on every management/delivery route, and a context inspection endpoint.
- Extended the universal client with explicit organization/workspace/site/environment/locale scope headers and request-context inspection.
- Enforced full organization/tenant/workspace/site/environment/locale scope in SQLite content reads, writes, revision history, audit queries, and API delivery.
- Generalized repository operations to awaitable contracts and made the content service asynchronous, enabling pooled network database adapters without changing SQLite behavior.
- Added a pooled PostgreSQL repository with qualified schemas, JSONB revisions, parameterized queries, immutable audit/history, full scope isolation, row-locked optimistic updates, and single-client transactions.
- Added a reusable repository conformance suite that verifies SQLite and PostgreSQL against identical revision, perspective, slug, audit, conflict, filtering, and full-scope isolation behavior.
- Added a disposable PostgreSQL 17 conformance-test command and required CI service job with automatic schema cleanup.
- Added a real PostgreSQL API integration test covering runtime selection and the complete create, publish, and delivery boundary.
- Added canonical scalar, reusable-object, array, discriminated-union, content-relation, and hierarchical-taxonomy field contracts with structured validation.
- Added deterministic content-route generation, normalized redirect resolution, multi-hop redirects, duplicate detection, and cycle prevention.
- Added advanced-model regression fixtures covering validation, literal TypeScript inference, generated declarations, canonical routes, redirect chains, and redirect-cycle rejection.
- Added recursive relation discovery and content-service referential-integrity enforcement within the complete active content scope.
- Added published route resolution with normalized paths, route-collision rejection, redirect responses, and a route-based delivery API.
- Enforced canonical route and routed-slug uniqueness across all published content types inside the complete active scope.
- Added relation-integrity regression coverage for valid same-scope targets and denied cross-site references.
- Extended API integration coverage to canonical path delivery and explicit permanent redirects.
- Added canonical-route regression coverage for published resolution, trailing-slash normalization, and duplicate-path collision rejection.
- Added semantic model validation for duplicate fields/objects/terms, unknown reusable objects and taxonomies, title/route correctness, taxonomy parent integrity, and hierarchy cycles.
- Added a versioned canonical schema IR document, normalized schema/component parsing, deterministic serialization, lossless visual-model round-trip, and browser-safe SHA-256 fingerprints.
- Added canonical lifecycle regression coverage for runtime defaults, deterministic JSON, visual round-trip fidelity, stable fingerprints, and the standard SHA-256 test vector.
- Added stable-ID schema/component diffing with safe, backfill, and destructive risk classification plus affected entry/API/component/query/workflow/search surfaces.
- Added deterministic migration plans with CI approval reasons, backfill hook names, data-scan and lock estimates, reversible-step metadata, and rollback policy.
- Added four-way schema drift reports across source IR, deployed IR, database fingerprint, and generated TypeScript declarations.
- Added scoped repository contracts for durable schema deployments, canonical documents, database/generated-type fingerprints, migration-plan identity, deploy actor, and deploy timestamp.
- Added SQLite and PostgreSQL schema-deployment tables with full-scope primary keys, atomic upsert, normalized JSON readback, and adapter-neutral deployment records.
- Extended shared adapter conformance with schema-deployment persistence, replacement, canonical readback, attribution, migration-plan identity, and cross-site isolation.
- Added a schema lifecycle service that assesses every scoped draft against candidate IR, reports affected entries by type, blocks invalid/orphaning promotion, requires exact plan approval for risky changes, initializes safe deployments, and reports persisted drift.
- Enriched migration steps with stable schema/field/component identities so impact assessment counts every affected entry separately from entries that fail target validation.
- Added lifecycle service regression coverage for safe bootstrap, real entry impact counts, exact-plan approval, invalid-data deployment blocking, successful promotion, and independent database/generated-type tamper detection.
- Added separate `schema.plan` and `schema.deploy` authorization actions, drift-aware readiness, canonical/visual/generated lifecycle inspection, candidate plan preview, exact-plan deployment, and default-scope lifecycle bootstrap APIs.
- Added API lifecycle integration coverage for missing-deployment readiness, canonical/visual/generated inspection, viewer denial, safe initial planning and deployment, synchronized drift, and restored readiness.
- Extended the framework-neutral client with typed lifecycle inspection, drift, candidate planning, exact-plan approval/deployment, impact, deployment, and validation-issue contracts.
- Made lifecycle planning accept either canonical schema IR or the visual-model envelope, completing the API-level lossless round-trip path.
- Added committed and exported generated example contracts, a deterministic `schema:generate` command, and a `schema:check` quality gate that rejects source/declaration drift.
- Enforced unique canonical schema IDs, collections, and component IDs plus immutable-version advancement for structural schema and component contract changes.
- Added client regression coverage for lifecycle plan and exact deployment-approval request paths, methods, and payloads.
- Added lifecycle regression coverage for stable-ID rename detection, additive/backfill/destructive classification, impact surfaces, deterministic approval plans, rollback policy, and independent drift sources.
- Added backward-compatible SQLite scope-column migration and cross-site isolation regression coverage.
- Added the first canonical schema IR, serializable component-manifest contract, recursive component-tree contract, structured content validation, and validation unit fixtures.
- Added the universal React component registry and deterministic tree renderer with preview-only source attributes and safe unknown-component fallback.
- Added code-owned Hero, Rich Text, and Callout example components, serializable manifests, page schema, seeded content, and shared presentation styles.
- Added the tenant-aware core content service and SQLite repository with automatic initialization, immutable revisions, draft/published perspectives, optimistic concurrency, status calculation, slug lookup, history, and attributable audit events.
- Added core tests covering revision preservation, publication, post-publication draft changes, stale-write rejection, history, audit records, and tenant isolation.
- Added the framework-neutral client with tenant/actor context, AbortSignal support, configurable fetch, normalized errors, draft and published perspectives, and typed content/schema/component/history operations.
- Added the standalone Fastify control plane with validated configuration, strict local CORS allow-list, health/readiness, schema/component delivery, draft management, publication, revision history, published slug delivery, request IDs, stable error envelopes, and separate cache policies.
- Added idempotent default-tenant seeding and API integration tests for the complete create/publish/deliver path and structured validation failures.
- Added the first GridStory Studio with an accessible responsive shell, page list, content status, schema/manifest-driven fields, block composition, reordering, draft saves, validation/conflict feedback, publication, immutable history, and draft/published React preview.
- Added a polished Vite + React example application that consumes only published GridStory content while retaining ownership of its components, rendering, styles, and application shell.
- Replaced the placeholder README with the working feature set, quick start, verification commands, service URLs, repository map, API snapshot, architecture boundary, governance workflow, and explicit current limitations.

### Changed

- Production identity mode now rejects caller-supplied development actor/role headers, missing providers, insecure cookies, local WebAuthn relying-party IDs, and non-HTTPS WebAuthn origins; development identity headers remain an explicit local-only compatibility path.
- Moved `@types/pg` into `@gridstory/core`'s shipped dependencies because public repository declarations import its types; local release evidence now clears the package-metadata/install portion of `RC-003` without changing private versions, registry state, framework coverage, or the historical RC no-go.
- Declared candidate `b31193a` ready only for a controlled private technical alpha; design-partner beta, RC, and GA are explicit no-go decisions with stable unmet criteria, accountable roles, next actions, and no inferred partner/deployment/hosted/independent evidence. Added M5-009 for the archive metadata defect found by the RC review.
- Centralized request, asset, archive, query/search, workflow, and plugin resource values in the exported release profile; support claims now distinguish hard admission bounds, regression budgets, reference-dataset evidence, retention gaps, and deployment-owned saturation/quotas.
- Browser/framework support claims now fail closed against exact executable evidence; unshipped framework adapters, branded Safari/iOS, arbitrary consumer UI, live assistive technology, and deployment header proof remain explicitly outside the M5-006 claim.
- API shutdown now rejects new work, drains in-flight Fastify requests, closes repositories, and flushes telemetry before natural exit; worker shutdown interrupts its wait, finishes only the active durable scope cycle, and uses the same timeout/second-signal force policy.
- Recovery is now an explicit whole-database confidential boundary distinct from tenant-scoped portability; README, operations, schema-lifecycle, ASVS, and threat-model evidence now document native artifacts, deployment-owned protected storage/PITR, and rollout responsibilities.
- API/worker configuration now validates opt-in telemetry state, bounded service resource values, export intervals, and credential-free Collector health URLs; public readiness returns only stable status/reason codes and telemetry remains independent from content-plane readiness and durable audit.
- Moved plugin execution into the current threat/ASVS scope with `THREAT-0023` and verified `GS-SEC-030`; documented the external process/container boundary, signed-digest trust decision, deferred Studio loader/marketplace work, and production runtime obligations.
- Tenant-bound OIDC role assignments and service-account grants now replace globally reusable production roles; cache invalidators and webhook transports receive explicit scope, and search adapters echo scope/perspective while authoritative records determine returned metadata.
- Corrected README capability status and linked the security model, requirements, ASVS profile, and validation command from the primary project guide.

- Expanded each committed content outbox event with an idempotent search.index job and reused the leased retry, dead-letter, and replay machinery for indexing and rebuilds without placing draft content in job payloads.

- Reused the existing leased durable-job executor for workflow actions, including claim recovery, bounded exponential retries, maximum-attempt dead letters, immutable replay records, and adapter-neutral notification, cache, and webhook delivery.

- Process due atomic releases before workflow schedules and ordinary operational jobs, and emit each committed or restored member through the existing hash-chained audit and transactional outbox/cache invalidation path.

- Content publication now uses the workflow gate inside ContentService across REST and GraphQL, saving a new revision invalidates stale approval/schedules, and the operations worker processes due workflow schedules and approval escalations without copying draft data into jobs, notifications, or published caches.

- Local API servers now keep asset metadata in the configured SQLite database; database-URL deployments can inject a durable `AssetRepository` while storage and image processing remain explicit adapters.

- Completed M3-006 with explainable content-quality reports, scoped link checks, configurable publication gates, private management surfaces, Studio remediation workflows, documentation, and full browser/build verification.
- Completed the governed design-system milestone with versioned tokens/variants/breakpoints/symbols/templates, deterministic React resolution, authorized delivery, Studio authoring controls, lean browser bundles, documentation, and full browser/build verification.
- Completed the visual-composition milestone with verified recursive authoring, constrained nesting, accessible pointer/keyboard controls, bounded history, application-owned nested rendering, documentation, and browser delivery coverage.
- Completed M2-010 and Milestone 2 with sequence-stable tamper-evident audit chains, verified exports, scoped administrator APIs/SDK/Studio views, legacy migration, live cross-adapter conformance, and full browser/build verification.
- Made focused Studio typechecks rebuild schema, client, React, and example-kit declaration boundaries before validating application integration.
- Completed M2-009 with checksummed logical JSON/JSON Lines portability, stable history, schema-aware dry-runs, explicit conflict policies, cross-scope defenses, atomic SQLite/PostgreSQL rollback, typed APIs/SDK, and full verification.
- Completed M2-008 with cross-adapter transactional outbox, durable operations, signed delivery, cache invalidation/tagging, replay tooling, worker execution, and full SQLite/PostgreSQL/API/SDK/browser verification.

- Preserved safe framework-generated HTTP 4xx responses in GridStory's stable error envelope instead of converting them to internal errors.
- Completed M2-007 with versioned localized-field contracts, validated fallback graphs, durable translation groups, per-locale revision/publication state, completeness, localized routes, cache isolation, and REST/GraphQL/SDK access.
- Added complete hierarchy and locale `Vary` metadata to every public REST delivery response so shared caches preserve scope isolation.
- Completed M2-006 with shared bounded query semantics, signed cursor connections, projected REST management/published delivery, authorized GraphQL management/delivery, typed SDK access, and SQLite/PostgreSQL/browser verification.
- Completed M2-005 with canonical code/visual round-trip, stable-ID/versioned diffing, risk-aware migration and entry-impact plans, durable scoped deployments, four-way drift, generated-contract enforcement, lifecycle APIs/SDK, and readiness gates.
- Completed M2-004 with an end-to-end advanced content model, scoped referential integrity, semantic schema checks, generated types, routed publication/delivery, redirects, and Studio compatibility.
- Completed M2-003 with a verified pooled PostgreSQL production adapter, cross-adapter conformance, API runtime integration, disposable local verification, and required CI coverage.
- Established the first verified implementation checkpoint: all workspace type checks, nine automated tests, all production builds, and the compiled API smoke test pass.
- Moved browser-safe content entry and revision DTOs into `@gridstory/schema`, removing the universal client's dependency on the Node-only core/SQLite package.
- Exposed type generation through an explicit `@gridstory/schema/typegen` subpath so compile-time helpers do not pull runtime validation dependencies into React bundles.
- Made Studio content fields, entry labels, composition storage, and preview routing derive from the active schema rather than hard-coded page property names.
- Made the API select PostgreSQL through `GRIDSTORY_DATABASE_URL` while retaining SQLite as the zero-configuration development adapter.
- Added server-render/hydration compatibility coverage for the React renderer.
- Added Studio component regression tests for schema-derived fields, repeated-block accessibility, and dirty-navigation protection.
- Added policy, hierarchy-context, scoped-client-header, and API authorization regression coverage.
- Added an Edge/Chromium Playwright walkthrough that exercises dirty-edit protection, immutable draft save, publication, and delivery into the separate Vite React application.
- Isolated browser verification on dedicated high ports with test-mode Vite builds, avoiding collisions with normal development services.
- Updated product documentation to distinguish the verified identity/authorization foundation from still-pending deployed identity adapters and persistent production stores.
- Updated setup, architecture, verification, limitations, and troubleshooting guidance for the verified PostgreSQL production adapter.
- Updated the working feature and API documentation for advanced content modeling, scoped relations, canonical routes, and redirects.
- Added schema lifecycle documentation for canonical round-trip, risk review, entry impact, backfill gates, exact-plan approval, controlled promotion, readiness, and four-way drift; updated README commands, APIs, features, and limitations.

### Fixed

- Fixed audit-chain predecessor selection for equal timestamps by persisting and hashing an explicit contiguous per-entry sequence (`BUG-0050`).
- Fixed focused Studio declaration ordering and the administrator-summary regression's overly narrow recent-event assertion (`BUG-0049`, `BUG-0051`).
- Serialized recursive workspace typechecks to prevent parallel declaration rebuild races on Windows and simplified Studio operations-panel selector specificity (`BUG-0052`, `BUG-0053`).

- Fixed the recursive component-node schema's exact-optional `slots` type so its runtime Zod contract and TypeScript output agree (`BUG-0001`).
- Fixed clean-clone workspace verification by building public package declarations before dependent application type checks and test runs (`BUG-0002`).
- Fixed the shared repository stale-write assertion to support both synchronous SQLite conflicts and asynchronous PostgreSQL rejections (`BUG-0022`).
- Fixed the disposable PostgreSQL test harness to invoke pnpm portably on Windows and Unix (`BUG-0023`).
- Fixed readonly reusable-object array inference in the advanced generated contract types (`BUG-0024`).
- Preserved type-generation compatibility for existing schemas that omit the new defaulted reusable-object collection (`BUG-0025`).
- Preserved existing schema-as-code compatibility by keeping defaulted advanced-model collections optional for authors (`BUG-0026`).
- Normalized advanced-model traversal callbacks and removed a stale validation import to satisfy the workspace quality rules (`BUG-0027`).
- Added Studio controls and safe initial values for advanced scalar, object, array, union, relation, and taxonomy fields (`BUG-0028`).
- Fixed exact-optional migration-hook construction and lifecycle risk-count coverage (`BUG-0029`).
- Fixed absent-deployment drift construction under exact-optional TypeScript contracts (`BUG-0030`).
- Made generated contracts formatter/linter-native with demand-driven imports, canonical identifiers/literals, empty record aliases, and normalized EOF (`BUG-0031`).
- Fixed root development and verification scripts that could match zero pnpm workspace projects and return a false success (`BUG-0003`).
- Fixed the Studio package manifest to declare its direct schema-contract dependency and preserve editor prop inference (`BUG-0004`).
- Fixed the README end-of-file formatting detected by the repository consistency check (`BUG-0005`).
- Fixed repeated-block editor labels by namespacing prop-control IDs with immutable block IDs (`BUG-0006`).
- Fixed silent loss of unsaved Studio edits with entry, creation, and browser-unload guards (`BUG-0007`).
- Fixed Studio component-test isolation by registering explicit DOM cleanup between cases (`BUG-0008`).
- Fixed browser requests by binding the default global `fetch` to its required global receiver (`BUG-0010`).
- Fixed Playwright service readiness and teardown by isolating test-mode bundles and direct preview processes on dedicated ports (`BUG-0009`).
- Fixed the browser walkthrough's ambiguous publish selector with exact accessible-name matching (`BUG-0011`).
- Fixed workspace-wide formatting drift and made formatting a passing quality gate (`BUG-0012`).
- Fixed Studio button and perspective-group semantics to satisfy accessible interaction rules (`BUG-0013`).
- Fixed brittle block movement and CSS cascade overrides with bounds-safe logic and class-scoped styles (`BUG-0014`).
- Fixed deprecated Biome configuration and made retry attempts semantically drive connection status (`BUG-0015`).
- Fixed the targeted schema/consumer verification order by rebuilding public declarations before dependent checks (`BUG-0016`).
- Fixed schema type inference with const-preserving definition helpers so field names, required flags, and value kinds remain exact (`BUG-0017`).
- Fixed browser bundle expansion by isolating type generation behind a tree-shakable schema subpath (`BUG-0018`).
- Fixed context/identity lint warnings and kept type-only dependencies out of runtime output (`BUG-0019`).
- Fixed API workspace dependency linking after the schema-context contract was added (`BUG-0020`).
- Fixed SQLite upgrade ordering so existing tenant-only databases gain scope columns before the new composite index (`BUG-0021`).

### Security

- Required complete-scope distinct experiment permissions, exact immutable pinned designs, random application-owned per-experiment tokens with no token/bucket/context persistence or echo, purpose/GPC gates, no-store allocation, complete digest-linked aggregate evidence, enforced guardrails/auto-pause, and explicit supported-treatment promotion into targeting draft only; analytics/statistics/evidence integrity, token retention, consent/legal review, rate limits, and application isolation remain deployment responsibilities.
- Required exact expiring DNS possession plus distinct accountable publisher approval, current publisher/key/signature checks, immutable signed compatibility/support/capability metadata, trusted non-executing artifact inspection bound to digest/size/SBOM/provenance/inventory/malware/vulnerability/license evidence, distinct current-review release approval, retained rejection/yank history, private complete-scope state, and disabled installation with no automatic grants for M6-005; badges, scans, provenance, and support declarations are explicitly not safety or service guarantees.
- Required trusted server-only read credentials, credential-free fixed HTTPS origins, no redirects or cross-origin continuations, bounded/validated source responses, complete-scope private/no-store migration state, separate read/manage/execute authorization, exact digest/expiry/version/revision checks, retry-safe links/receipts/checkpoints, normal content gates, preserved source deletions, and explicitly content-only cutover claims for M6-004.
- Required active hold/restriction dominance, explicit subject links, distinct governance permissions, digest-bound separation of duties, fresh server-validated reauthentication, recent backup evidence, execution-time policy/resource/key/placement checks, fail-closed unsupported resources, envelope encryption without persisted plaintext keys, and private/no-store management responses for M6-003.
- Replaced trusted production identity headers with cryptographically verified federation/WebAuthn results, tenant-bound hashed session and service credentials, one-time protocol challenges, lifecycle/concurrency revocation, private/no-store management boundaries, and exact scoped security events.
- Patched the audited production graph for `fast-uri`, `find-my-way`, `@fastify/static`, and `brace-expansion` advisories while retaining frozen-lockfile reproducibility.
- Made release archives fail closed on missing, duplicate, unexpected, mismatched, or workspace-bound package metadata; the installed-consumer check disables lifecycle scripts, forbids network resolution and workspace/link dependencies, and cleans only a pre-validated OS-temporary path.
- Preserved planned/partial security controls as release-blocking readiness evidence: production identity/proxy/provider controls, live assistive-technology acceptance, hosted SBOM/provenance, independent assessment, production-shaped capacity/recovery, and operating-risk acceptance cannot be changed to met from repository or external-only claims.
- Bounded ordinary, multipart, portability, and GraphQL work before service execution; added archive-history and declared asset limits, private disclosure/remediation targets, lockfile scanning, dependency review automation, reviewed archive inventories, checksums, SBOMs, and keyless hosted attestations while retaining deployment/hosted-release residual evidence under M5-008.
- Updated rendering-security evidence for explicit React SSR/hydration fixtures, unsuppressed three-engine browser audits, exact application-owned CSP/header responsibilities, and the remaining deployment/live-assistive-technology evidence assigned to M5-008.
- Added `THREAT-0024`, a whole-database backup asset/storage boundary, credential-safe PostgreSQL tool invocation, minimal versioned SHA-256 manifests, fail-closed native integrity/table validation, and absent/empty restore targets with explicit PostgreSQL database confirmation; provider storage, keys, retention, and physical PITR remain deployment evidence.
- Verified `GS-SEC-028` for current capabilities with bounded fixed-body telemetry, low-cardinality metrics, explicit tenant scope only in protected logs/traces, live secret/query exclusion, fail-closed Collector attribute allow-listing, minimal public health, protected degradation health, access/retention/correlation/alert inventory, and exposure/availability response procedures; M6-002 now supplies durable scoped identity security events while external Collector wiring remains deployment evidence.
- Plugins now fail closed on untrusted/revoked publisher keys, invalid Ed25519 signatures, artifact-digest or SDK/protocol mismatch, over-broad grants, cross-tenant state, disabled/revoked lifecycle, undeclared operations/capabilities, absent/unhealthy runtimes, rate limits, timeouts, and JSON size bounds; arbitrary plugin modules are never imported into the control plane.
- Hardened storage, cache, search, asset, audit, outbox, durable-job, webhook, and telemetry boundaries to fail closed on scope mismatches; cache/object keys are collision safe and hostile search totals, facets, highlights, and taxonomy values cannot cross tenants.
- Established normative tenant, authorization, preview/cache, input/rendering, API, file/archive, token, integration, cryptography, transport, data-protection, logging/error, and supply-chain requirements without claiming ASVS certification; unresolved production controls remain explicitly assigned to M5-002 through M5-008 and M6-002/M6-003.

- Kept search documents, queries, taxonomy facets, backlinks, related results, rebuilds, jobs, and status explicitly scoped by organization, tenant, workspace, site, environment, locale, and perspective behind private/no-store authorization boundaries.

- Kept workflow action definitions, jobs, logs, execution, and replay inside explicit tenant scope and private management caching; webhook action bodies contain identifiers only and reuse HTTPS/public-host validation, optional allow-listing, redirect refusal, timeouts, and HMAC signing.

- Kept pinned future-state content behind fully tenant-scoped private/no-store management routes and required exact draft and prior-published revision pointers before any atomic release or rollback write.

- Added scope-bound audit integrity verification that detects sequence gaps, reordered/missing predecessors, and changed persisted event fields without silently rehashing already-chained records.

- Added deny-by-default management authorization, scoped grants, trusted OIDC claim enforcement, and revocable hashed service credentials.
