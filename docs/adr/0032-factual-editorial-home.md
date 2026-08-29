# ADR 0032: Factual editorial Home

- Status: Delivered and verified for CMS-006 on 2026-08-29 after the user's explicit `proceed`.
- Created: 2026-08-29 by Codex.
- Task: CMS-006. Planning defect: BUG-0488.
- Baseline: `519235f` on `codex/content-configuration-foundations`.

## Ask and delivery boundary

Add one permission-aware Home destination that helps an editor resume recent work, see exact scoped content states, reach reviews and releases, and create a registered content type through the existing CMS-004 authoring path. Every number and item must come from current authoritative repositories, declare its coverage and bound, and fail independently. Home must not infer access from roles in the browser, load operator-only data for ordinary authors, invent trends, or claim a partial page is a total.

CMS-006 stays on the single `codex/content-configuration-foundations` branch used by CMS-004 through CMS-010 and receives its own verified implementation commit. This proposal does not approve CMS-007–010, merge, push, deployment, production readiness, a configurable dashboard framework, or analytics collection.

## Inward evidence

| Existing seam | Reuse | Missing behavior / constraint |
|---|---|---|
| `ContentQueryService`, CMS-005 query client and canonical schemas | Exact `totalCount`, stable updated ordering, registered title/slug fields, status and explicit page bounds already exist. | Studio can query one list, but Home needs one minimized cross-type/page-only projection without returning entry bodies or issuing one browser request per type. |
| `WorkflowRepository.listInstances`, workflow definitions and approval rules | Complete scoped workflow instances contain pending approval, due date, transition, requestor and revision evidence. | The public API only lists definitions and reads one entry's workflow. Browser fan-out over recent entries cannot truthfully find every pending review and could expose the wrong population. |
| `ReleaseRepository.list` and existing release routes | Releases are already scope-keyed, ordered by update time and independently authorized with `release.read`. | The full release objects contain member details that Home does not need. Return only bounded name/state/time summaries and an exact count. |
| `OperationsService.dashboard` | Existing operations projection already computes audit validity and bounded outbox/job states. | Authors must not load it. Home may show only a minimized attention summary when `operations.read` is actually permitted; truncation remains explicit. |
| ADR 0030 capability/session boundary and ADR 0028 locations | Complete verified scope, finite screens/operations, stale-request rejection, scope-free history and private lifetime are already enforced. | No `home` destination or composite Home-read capability exists. A summary response must remain private/no-store and tied to the client's complete scope. |
| CMS-004 candidate creation and CMS-005 content lists | Registered Page/Collection create behavior, canonical preflight validation, type-aware locations and stable editor selection already work. | Home quick create must delegate to that exact path rather than create a second candidate/form lifecycle. |

The repository list interfaces are currently full-scope in memory for these read models. CMS-006 therefore bounds the response and browser work, not an unclaimed database-level aggregate optimization. A future scale-specific aggregate/read-model task requires evidence and a separate plan.

## Outward prior art

Official product documentation was checked on 2026-08-29. The sources inform information shape only; GridStory does not claim feature parity or import their dashboard/plugin systems.

| Source | Useful pattern | GridStory decision / omission |
|---|---|---|
| [Sanity Studio dashboard](https://www.sanity.io/docs/studio/dashboard) | Recent-document widgets use an explicit item limit and optional type filter; dashboard layout is separate from document editing. | Use fixed, bounded widgets and existing entry routes. Do not add a widget marketplace, configuration API or dependency. |
| [Sanity content-operator guide](https://www.sanity.io/docs/user-guides/content-operations-cheatsheet) | Recent edits are resumable links; draft/published indicators remain explicit. | Show authoritative recent entries with status and update time, never fabricated activity or engagement insight. |
| [Contentful content views](https://www.contentful.com/help/content-and-entries/create-content-views/) | Entry lists distinguish name, status, content type and update time; recent and scheduled views are separate jobs. | Reuse CMS-005 status semantics and existing Releases destination; do not collapse different concepts into one count. |
| [Contentful tasks](https://www.contentful.com/help/content-and-entries/tasks/) | Pending work is filtered to the assigned user/team and links back to the entry. | Show only workflow approvals for which the current principal's server-side roles are eligible and separation-of-duties permits review. Do not expose other users' queues or add notifications/tasks. |

## Necessity gate

1. **Traceable:** directly implements CMS-006 after its CMS-003/CMS-005 dependencies.
2. **Not already solved:** content and release reads exist, but the only complete pending-review source is a private repository method. Recent-entry fan-out cannot prove the complete review queue.
3. **Minimal form:** one strict versioned overview response, one private GET route/client method, one finite Home destination and four fixed widgets. No generic dashboard/widget framework.
4. **Dependency justified:** no new package. Reuse Zod, repositories, policy decisions, the universal client and shared Studio SCSS.
5. **Rule of three:** fixed product widgets are explicit components; no abstract plugin/metric registry is introduced for one screen.
6. **Reversible:** no database schema, stored preference or content representation changes. Revert the dedicated CMS-006 implementation commit.

## Decision and sequence

### 1. Add one strict minimized editorial-overview contract

Add a framework-neutral version-1 `EditorialOverview` schema. It includes the complete content scope and `generatedAt`, then four independent widget results using `available`, `unavailable` or `error`. Errors use fixed public reasons only and never reflect repository messages, values, credentials or policy explanations.

Available widgets declare their bounds:

- **Content:** coverage is exactly `all-registered` or `pages-only`; exact total plus exact `draft`, `changed` and `published` counts; at most five newest entries with ID, content type, derived title/slug fallback, status and update time. No entry `data`, revisions, author/principal fields or cursor is returned.
- **Reviews:** exact count within the same readable content coverage and at most five eligible pending approvals, sorted by due/request/update time. Each item contains only entry ID/type/title, workflow/state/transition labels, request/due time and a safe entry destination. Eligibility requires existing `workflow.read` and `workflow.approve`, readable content type, a current matching definition/transition, an allowed principal role and satisfied separation of duties. The decision route remains authoritative.
- **Releases:** exact scoped release count and at most five newest release IDs/names/states/update/schedule times. Member IDs/revisions, creators, errors and validation details are excluded. Availability requires `release.read`.
- **Operations attention:** only for `operations.read`; return audit validity, dead outbox/job counts and their existing truncation flags, plus an Operations destination. Do not return audit events, webhook endpoints, tenant topology or adapter details.

Every array has a fixed limit of five and reports `displayedCount`, `totalCount`, `limit` and whether more exists. Counts are called exact only for their stated coverage. `unavailable` means the current capability projection does not permit that widget; `error` means its independent source failed. A widget failure must not fail or suppress another successful widget.

### 2. Build the projection at the framework-neutral core boundary

Add an `EditorialOverviewService` composed with the existing content, workflow and release repositories plus an injected existing operations-summary reader. The API supplies a small visibility input derived from current policy decisions: content coverage (`all-registered`, `pages-only` or unavailable), review eligibility, release visibility and operations visibility. The core does not interpret browser role names or mint grants.

The service asserts complete-scope agreement on every repository result, derives titles only through registered schemas, sorts deterministically, and uses `Promise.allSettled`-equivalent isolation per widget. It joins review items only to entries permitted by the selected content coverage. Unknown workflows/transitions and unreadable types are omitted from the actionable review population rather than guessed.

This is a read projection only. It creates no event, cache entry, preference, task, notification or aggregate table and changes no repository interface/storage schema.

### 3. Expose one private, parameter-free authorized route and client method

Add `GET /api/v1/editorial/overview`. It accepts no query/body, uses the existing production session/request-context edge and sets `Cache-Control: private, no-store` for success and error responses. The route derives each widget's visibility from the existing exact actions/resources. If the caller has none of the underlying Home reads, return the existing generic denial; otherwise return unavailable states for unpermitted widgets and independently load only permitted sources.

Add no authorization action. Add a finite composite `home.read` Studio operation flag computed from existing `pages.list`, generic `content.read`, `workflow.read`, `release.read` or `operations.read` policy decisions. `screens.home` follows that composite flag, but every source route/service decision remains authoritative. Add `getEditorialOverview` to the universal client with strict response parsing and complete-scope equality validation, then map it explicitly to `home.read` in the fail-closed Studio client adapter.

### 4. Add Home as one top-level routed destination

Add Home before the disclosure groups, not inside Content. It participates in finite fragment history as `#/home`, one-current-page rendering, permitted fallback, stale-request cancellation and verified-scope lifetime. A root/empty Studio fragment resolves to Home when permitted; restricted users fall back to their first permitted existing destination without receiving hidden Home data.

Home renders fixed responsive cards for content status/recent work, reviews, releases and operator attention. Each card owns its loading/empty/unavailable/error/retry state so one failed source remains isolated. Links navigate through existing Studio history to the precise page/collection entry or existing Workflows/Releases/Operations destination. No chart, percentage, trend, greeting personalization or unverifiable “all clear” message is shown.

Quick create lists only registered schemas for which the existing Page or generic create capability is available. It invokes the existing CMS-004 canonical candidate/preflight/create path, including dirty/write/preview guards, then lands on the new entry's established Pages/Collections location. No second form, optimistic placeholder or background draft is added.

### 5. Preserve existing presentation and feature boundaries

Use the established neutral page/content colors, global buttons/forms/typography/cards and responsive spacing. Add a Home-specific SCSS partial only for the card grid and compact data layout. Home does not load published preview credentials, operations details for authors, analytics, collaboration, assets or cross-tenant data. Existing 20 destinations and all current features remain unchanged and reachable.

## Scope fence

Implementation may touch only:

- Contract/core: one new `packages/schema/src/editorial-overview.ts`, schema exports/tests, one new `packages/core/src/editorial-overview-service.ts`, core exports/tests.
- API/client: `apps/api/src/server.ts`, `apps/api/src/studio-context.ts`, focused API/context tests, `packages/client/src/index.ts` and focused client tests.
- Studio: `apps/studio/src/navigation.ts`, `studio-location.ts`, `studio-capabilities.ts`, `App.tsx`, one new `editorial-home.tsx`, focused tests, `styles/studio.scss`, one new `_home.scss`, and existing responsive/state partials only if required.
- Browser acceptance: existing navigation/context/accessibility/vertical-slice specifications and their fixtures.
- Required ledgers/docs: `TASKS.md`, `CHANGELOG.md`, `BUGS.md`, this ADR, `docs/cms-admin-gap-analysis.md`, `README.md` and `docs/troubleshooting.md`.

Any dependency, database/repository schema change, new permission action, background aggregate, analytics event, cross-tenant query, configurable widget system, notification/task model or additional application surface requires an explicit amendment and new approval before editing.

## Observable acceptance and verification

- Schema/core tests prove strict parsing, complete-scope rejection, exact status totals, deterministic five-item bounds, page-only versus all-registered coverage, title fallback, role/separation review filtering, release minimization, operations truncation and independent source errors.
- API tests prove production authentication, no query/body, private/no-store, generic denial with no eligible read, exact existing-action projection, no unpermitted repository calls, scope isolation and sanitized widget errors.
- Client/Studio tests prove response scope validation, explicit fail-closed method mapping, Home-first/permitted fallback history, one current destination, per-card loading/empty/error/retry, correct exact/bounded wording, quick-create delegation and no author operations request.
- Browser tests exercise editor, reviewer, release/operations and restricted profiles; recent-entry and review links reach exact registered types; quick create completes existing canonical creation; six widths, keyboard, 200% zoom, forced colors, light/dark and unsuppressed WCAG 2.2 A/AA checks pass in Chromium, Firefox and WebKit.
- Full `pnpm check`, generated/security/tenant/readiness checks and production/React 18 SSR builds pass. Applicable browser evidence is exact; PostgreSQL/recovery/provider/deployment checks are not claimed because no storage/provider/deployment boundary changes.

## Risks and rollback

- **Authorization overstatement:** a composite Home flag could be mistaken for broad data access. Mitigation: widget-level server decisions, unavailable states, no source call when denied and route-level parity tests.
- **Misleading totals:** a five-row list could be presented as complete. Mitigation: exact coverage, total/displayed/limit fields and UI wording tested at zero, five and more-than-five records.
- **Review leakage or false eligibility:** pending approvals contain other actors and workflow details. Mitigation: server-side readable-type/role/separation filtering, minimized fields and the existing decision route as final authority.
- **Fan-out/performance:** browser calls per type/entry would grow with tenant content. Mitigation: one fixed endpoint and server projection; document that current repositories still perform full-scope reads and claim no database aggregate optimization.
- **Stale scope/session data:** Home results could survive a context change. Mitigation: existing session generation, AbortSignal, scope equality and keyed private-lifetime replacement.
- **Monolithic Studio regression:** adding another destination touches navigation and `App.tsx`. Mitigation: isolate rendering in one module and run the complete unit/three-engine navigation/accessibility matrix.

Rollback is the dedicated CMS-006 implementation commit. No data migration or stored preference requires reversal; existing content, workflows, releases and operations remain authoritative and untouched.

## Explicit exclusions

No configurable dashboard/widget framework, analytics/trend collection, chart, notification/task subsystem, collaboration inbox, cross-tenant portfolio metric, server-persisted preference, new authorization action, entry mutation beyond existing quick create, workflow/release/operations mutation, database aggregate/materialized view, dependency, palette replacement, merge, push, deployment or release-readiness upgrade.

## Approval gate

The user explicitly approved this T2 proposal with `proceed` on 2026-08-29T09:18:11+05:30 after the separate `58fc548` planning commit. Approval starts CMS-006 only inside this fence. CMS-007–010 retain their own task boundaries and T2 gates where applicable.

## Planning verification

Codex, 2026-08-29: `pnpm lint`, `pnpm format:check`, `node scripts/check-ledgers.mjs`, `git diff --check`, a six-file local Markdown-link audit and the exact documentation/ledger fence audit pass. Only `TASKS.md`, `CHANGELOG.md`, `BUGS.md`, `README.md`, `docs/cms-admin-gap-analysis.md` and this ADR are included. BUG-0488 is resolved. No runtime, unit, API, database, browser, provider or deployment behavior changes are claimed by this proposal; the unchanged `519235f` baseline retains CMS-005's separately recorded full repository and 57-scenario browser evidence.

## Implementation and verification

Codex, 2026-08-29: the accepted slice is implemented without extending the approved behavior boundary. The strict schema, core projection, authenticated API route, universal client parser, finite capability/location changes and isolated Home component are additive. Root Home starts from the minimized overview and schema/manifest metadata required for canonical quick create; full content, workflow, release and operations lists remain lazy. Widget-level policy checks deny without calling their repositories, core scope assertions precede visibility filtering, and no repository/storage/permission contract changed. BUG-0498/0499 use the existing `_cta.scss` and `_collaboration.scss` component-state homes required by the approved shared-state clause and the user's standing global-style requirement; no second override layer or palette change was introduced.

Focused schema/core/client/API/Studio suites pass the strict scope, exact-bound, review eligibility, per-widget failure, no-store/non-enumeration, history and quick-create cases. Final `pnpm check` passes lint/format, ledgers, boundaries, generated contracts, security/threat/tenant/readiness checks, strict types, 669 active tests with 17 existing optional skips, React 18.3.1 SSR and production builds. The rebuilt unchanged Playwright matrix passes 60/60 scenarios: 20 each in Chromium, Firefox and WebKit, including precise Home links, minimized startup requests, canonical creation, six responsive widths, keyboard operation, 200% zoom, light/dark rendering and unsuppressed WCAG 2.2 A/AA audits. BUG-0489–BUG-0500 retain all defects found and their verified corrections. No PostgreSQL, recovery, provider, deployment or production-readiness result is claimed because those boundaries did not change.

BUG-0500 test-harness decision: the final aggregate run and an exact paired rerun report only wall-clock timeouts at 5.305s/15.217s and 5.293s/15.034s; all earlier assertions and 271 sibling Studio tests pass. Each case passes unchanged alone at 4.92s and 14.39s, leaving 1.6% or less scheduling margin under its former deadline. This is not evidence of a product failure, and the complete real-browser acceptance is green. Retain every interaction/assertion and use bounded 10s/30s case ceilings. The exact pair, full 273-test Studio file and final repository gate pass. No global timeout, retry, skip or assertion changed.
