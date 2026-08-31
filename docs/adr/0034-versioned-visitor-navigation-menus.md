# ADR 0034: Versioned visitor navigation menus

- Status: Proposed — implementation requires explicit approval after the planning commit.
- Created: 2026-08-31 by Codex.
- Task: CMS-011. Delivery defects: none yet.
- Baseline: `0b69c37` on `codex/website-management-gaps`.
- Tier: T2 because a new publishable domain crosses canonical content validation, references, releases, public delivery/cache behavior, the universal client, Studio and an application consumer.

## Ask and delivery boundary

Add visitor-facing navigation that editors can name, order, localize, preview and publish without confusing it with the Studio sidebar. Reuse GridStory's immutable content revisions, optimistic writes, translation groups, workflows, releases, audit/outbox and complete tenant scope. A connected application receives a small published-only route-aware projection and retains ownership of semantic markup, placement, interaction and CSS.

CMS-011 is the first task on the shared `codex/website-management-gaps` branch. It receives a dedicated planning commit and, after approval, a separate verified implementation commit. This proposal does not authorize CMS-012 through CMS-015, a second menu store, automatic page discovery, host-router control, arbitrary markup/script, a Studio theme change, merge, push, deployment or a production-readiness claim.

## Inward evidence

| Existing seam | Reuse | Missing behavior / constraint |
|---|---|---|
| Canonical `ContentSchemaDefinition`, reusable objects, arrays and relation references | A reserved code-owned menu type can represent a bounded ordered flat item list, and existing relation traversal already finds references inside array objects. | Declarative fields do not express unique item IDs, exclusive target kinds, safe URL schemes, parent cycles/depth, stable menu-key identity or route-bearing target requirements. A trusted domain validator must run at every content lifecycle boundary. |
| `ContentService` and repositories | Draft creation/save, expected-revision concurrency, immutable history, workflow, publication, audit/outbox, portability and complete-scope storage already exist. | Generic content validation currently checks draft reference existence, but ordinary publication does not prove that a menu target is published or that domain invariants still hold. Reserved menu writes must not bypass the menu validator. |
| `collectContentReferences`, `ContentService.assessRelease` and `ReleaseService` | Existing future-state validation already permits a menu and newly published target in one atomic release and rejects references absent from that future published set. | Menu-specific invariants and route-bearing target checks must use the same future view. Existing rollback deliberately cannot undo a release containing a first publication; this task must expose that truth rather than invent unpublish semantics. |
| `buildContentRoute`, locale configuration, published readers and regional delivery | Internal references can resolve from current published target data instead of storing paths that become stale after slug changes. Published readers preserve regional and complete-scope boundaries. | There is no named-menu resolver, localized route projection or cache response that tags both the menu and every internal target whose route affects the result. |
| Generic management API/client and CMS-004 authoring | Existing content read/create/update/publish/history/translation actions remain the authorization and revision boundary. | Menus need stable-key creation, a private draft projection, strict public output and a purpose-built editor. The reserved type must not appear as an ordinary Collection or require a component tree. |
| Finite Studio navigation and shared SCSS | One permitted destination, lazy feature state, capability guards, scope/session cleanup and global form/button/card/typography rules are established. | There is no **Navigation > Menus** leaf or reorder/indent/target editor. Menu UI must not add another global styling layer or render the connected application's header/footer inside Studio. |

No database schema or second repository is required. The only persisted objects remain ordinary scoped content entries and revisions.

## Outward prior art

Official sources were reviewed on 2026-08-31. They inform the information model and accessibility boundary, not vendor parity.

| Source | Useful pattern | GridStory decision / omission |
|---|---|---|
| [WordPress Navigation block](https://wordpress.org/documentation/article/navigation-block/) | Editors can select named menus, add page or custom links, reorder items and create submenus. | Adopt named/order/parent-child editing. Omit block-theme styling, automatic page insertion and presentation controls. |
| [Sanity scalable navigation](https://www.sanity.io/docs/developer-guides/navigation-with-sanity) | Structured navigation separates content references from external URLs and lets internal links follow document slug changes. | Store scoped references, resolve routes at read time and keep UI rendering in the app. Omit mega-menu and arbitrary component schemas. |
| [Contentful navigation modeling](https://www.contentful.com/help/modeling-navigation/) | A link has a label and target, and navigation may be modeled hierarchically for editor and delivery use. | Use one bounded flat list with `parentId`; do not create a separate document for every item or an unbounded recursive graph. |
| [WAI disclosure navigation example](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/) and [navigation landmark guidance](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/navigation.html) | Ordinary site navigation uses links and labelled navigation landmarks; expandable groups can use disclosure behavior without pretending to be an application menu widget. | The Vite example demonstrates semantic `<nav>`/list/link output. GridStory returns data only and does not impose ARIA, keyboard JavaScript or CSS on host applications. |

Research saturated after the structured-reference, hierarchy and application-owned accessibility decisions repeated across these sources. No dependency or vendor runtime is necessary.

## Options and decision

| Option | Fit | Cost / risk | Decision |
|---|---|---|---|
| Reserved versioned content plus a bounded flat node list | Reuses current revisions, localization, workflow, release, audit, portability and relation traversal. App can derive a tree without stored routes or markup. | Requires one code-owned domain validator/resolver and lifecycle integration. | **Selected.** Smallest end-to-end slice that satisfies the task. |
| Nested menu/item documents or a generic navigation builder | Can model very large/heterogeneous mega menus. | Adds document fan-out, recursive ordering, additional authorization and editorial complexity before a demonstrated need. | Rejected for CMS-011. Revisit only after a concrete second navigation shape. |
| Derive navigation automatically from published routes | No new editor or content type. | Cannot provide deliberate header/footer order, labels, external links, locale-specific structures or explicit publication. | Rejected; routes are targets, not editorial navigation. |
| Leave menus in application source | Preserves today's boundary and requires no CMS work. | Does not satisfy the requested editor/version/release workflow. | Retained as an application choice, but insufficient as the GridStory feature. |

## Necessity gate

1. **Traceable:** directly implements CMS-011 and the approved administration plan's **Navigation > Menus** gap.
2. **Not already solved:** routes resolve published entries and Collections can edit declarative fields, but neither supplies named menu identity, tree/URL validation, draft/public projections or app-consumable menu delivery.
3. **Minimal form:** one reserved content definition, one bounded validator/resolver, one public projection, one private draft projection and one finite Studio leaf. No second revision store, menu-item documents, mega-menu system or presentation engine.
4. **Dependency justified:** no package is added. Reuse Zod, canonical schemas, content/release/localization/routing services, the universal client, React and shared Sass.
5. **Rule of three:** repeated validation at create, update, ordinary publish and atomic release justifies one trusted code-owned lifecycle-invariant seam. It is not a runtime plugin registry and accepts only validators supplied by trusted server composition. No broader navigation framework is introduced for hypothetical variants.
6. **Reversible:** the implementation is one dedicated task commit with no storage migration. Reverting removes the type, resolver, Studio leaf and example integration; existing menu revisions remain inert ordinary content that can still be exported. Updated releases roll back through existing revision pointers, while first-publication rollback remains explicitly unavailable under the current release contract.

## Decision and sequence

### 1. Register one reserved canonical menu type

Add `navigation-menu` through the example kit's code-owned schema factory, supplied with the currently registered route-bearing content types. It has no public route and is hidden from generic Collections. Its top-level fields are:

- immutable `key`: a lowercase slug of 1–64 characters used by management and delivery;
- `name`: an editor-facing name of 1–120 characters;
- localized `items`: 0–100 ordered `navigation-menu-item` objects.

Each item has a unique stable slug-like `id` (1–64 characters), optional `parentId`, label (1–160 characters), `kind: internal | external`, optional declared-target content relation and optional absolute external URL (maximum 2,048 characters). Array order is canonical global and sibling order; every parent must occur earlier than its descendants. Roots count as depth 1 and maximum depth is 3.

The strict domain validator rejects unknown item keys, duplicate/self/missing/forward parents, cycles, excessive depth/count/length, missing or multiple targets, mismatched relation types, non-route-bearing internal targets, and URL credentials, controls or schemes other than absolute `http:`/`https:`. Queries/fragments remain application-visible. It validates exact-scope draft targets while editing and exact published/future targets for publication.

The default locale owns `key` and `name`; the entire `items` field is localized so a locale can translate labels and deliberately vary order/targets. Existing translation groups, fallback and completeness remain authoritative. The source entry uses deterministic ID `navigation-menu:<key>`; the dedicated create path and immutable-key check provide stable default-locale identity. Concurrent draft saves continue to fail on stale expected revision IDs.

### 2. Add a narrow trusted lifecycle-invariant seam

Extend the framework-neutral content service with a code-owned validator map supplied at trusted composition. For a candidate it receives the complete scope, content identity/type/data, lifecycle perspective (`draft` or `published`) and a read-only content view. Ordinary create/update/validate/publish and release assessment invoke the same validator after canonical field validation and before mutation.

The draft view sees current exact-scope drafts. The ordinary publication view overlays the candidate on current published content. The release view overlays every pinned candidate on current published content, so a new page and menu can validate and publish together. Validation issues keep stable paths/codes and flow through current content/release error envelopes. Generic API writes cannot bypass this service; creation of the reserved type is routed through stable-key creation, and import/release candidates are revalidated before publication.

Existing relation traversal remains the general reference check. The menu invariant additionally proves target routability, key uniqueness/immutability and the tree/URL rules; it does not change unrelated content semantics.

### 3. Expose minimized private and public projections

Add strict version-1 `NavigationMenuProjection` contracts with menu key/name, requested/resolved locale, immutable published or draft revision ID, and the ordered flat items. Internal items contain only target identity/type and a computed canonical localized `href`; external items contain only their validated `href`. No target data, draft state, credentials, preview token, workflow, audit or Studio presentation value enters the projection.

- A private no-store management preview resolves one current draft menu and draft targets, requires the existing applicable content-read decision and never accepts a preview credential as management authority.
- `GET /api/v1/delivery/navigation-menus/:key` is anonymous `delivery.read`, published-only, exact-scope and locale-fallback aware. It uses the active regional published reader, rejects duplicate/malformed state fail closed, and sets cache tags for the menu plus every internal target so slug publication invalidates derived hrefs. Existing public `Vary` scope headers and cache policy apply.

Add strict universal-client methods for stable-key creation and draft/public projection. Existing list/get/save/publish/history/translation methods continue to carry revisions and permission meanings; no menu-specific authorization action is introduced.

### 4. Add one purpose-built Studio menu editor

Add a finite **Navigation > Menus** destination, visible from existing schema/content permission preconditions and still enforced by each API request. It lazily lists reserved menus, creates Header/Footer or another named key, and reuses current content entry/revision/workflow/publication state.

The editor provides accessible add/remove, move up/down and indent/outdent controls; label and internal/external target controls use existing global form styles and declared route-bearing choices. It displays exact depth/item limits, field-path validation, stale-revision conflicts, loading/empty/error/retry, dirty/context/session guards and a read-only resolved draft preview. Translation creation/completeness delegates to the existing localization client. It renders no connected-site header/footer and adds only a feature-owned `_navigation-menus.scss` partial composed by the one Studio Sass entry.

Menu data is not exposed in Pages or generic Collections. Existing colors, buttons, inputs, cards, typography, one-current-page behavior, compact/mobile navigation and header-only standalone page preview remain unchanged.

### 5. Demonstrate application-owned consumption

Seed development Header and Footer menus only when example seeding is enabled and after the referenced Welcome page exists. Update the ordinary Vite consumer to request the two published projections and render its own semantic labelled navigation/list/link markup with its own CSS. Missing optional menu delivery does not prevent the page itself from rendering.

The SDK returns data rather than a React menu component. Application code owns whether submenus are always visible or disclosures, focus/keyboard behavior, active-link policy, router integration, placement and styling. Studio Sass is never imported by the example site.

### 6. Retain the existing release rollback contract

Menu revisions participate in release pinning, validation, preview, execution and rollback exactly like other content. A release updating already published menus/pages can restore their previous published pointers atomically. The current service deliberately rejects rollback when any member was first published because no prior pointer exists; CMS-011 surfaces that existing limitation and does not invent unpublish/tombstone behavior. First-publication recovery is a new reviewed corrective release, while durable retirement remains CMS-023.

## Implementation scope fence

Implementation may touch only:

- Schema/example kit: one navigation contract/validator module, exports/tests, the reserved schema factory, generated example contracts/data and seed wiring.
- Core: the narrow trusted lifecycle-validator/read-view contract, navigation validator/resolver, content/release/localization/routing/cache integration and focused tests.
- API/client: explicit stable-key create, private draft projection and public delivery entry points; server composition, strict client methods and focused authentication/scope/cache/negative tests.
- Studio: finite navigation/capability metadata, `App.tsx` integration, one isolated menu-editor module, one feature Sass partial and focused unit/App/browser fixtures/specs.
- Consumer/docs/ledgers: Vite example application/styles/tests, navigation/release/localization/operations guidance, threat model only if implementation evidence changes, README, administration gap analysis, this ADR, `TASKS.md`, `CHANGELOG.md` and `BUGS.md` for every defect found.

Any new repository/table, public mutation, authorization action, content-field kind, runtime schema/plugin system, menu-item document graph, app router dependency/control, external provider, arbitrary markup/script/style, unpublish/retirement behavior, CMS-012+ implementation, package dependency, merge, push or deployment requires an ADR amendment and new approval before editing.

## Observable acceptance and verification

- Schema/core tests prove strict field/domain parsing, stable key identity, deterministic ordering, 100-item/depth-3 bounds, duplicate/missing/forward/cyclic parents, exclusive target kinds, safe `http:`/`https:` URLs, exact-scope/routable targets, immutable keys and stale-revision rejection.
- Lifecycle tests prove ordinary publish rejects draft-only targets, same-release new page/menu succeeds against future state, missing targets fail with item paths, route changes update resolved hrefs, localized/fallback variants resolve correctly, updated releases roll back and first-publication rollback remains explicitly unavailable.
- API/client tests prove production authentication boundaries, private no-store preview, published-only anonymous output, minimized strict responses, region-reader use, complete-scope isolation, URL/key input rejection, cache tags for menu and targets, invalid-state fail closure and no draft/credential leakage.
- Studio tests prove finite capability/history integration; lazy load; create/edit/reorder/indent/target/save/preview/publish/revision/translation flows; validation and stale conflicts; denied/read-only/loading/empty/error/retry/context cleanup; generic-Collection exclusion; and unchanged global controls.
- Browser tests create and publish real Header/Footer menus, verify connected Vite output and slug-aware links, assert draft labels never appear publicly, and rerun all destinations at six widths, keyboard, 200% zoom, light/dark, forced-colors where covered and unsuppressed WCAG 2.2 A/AA in Chromium, Firefox and WebKit.
- Full `pnpm check`, generated/security/tenant/readiness checks, React 18 SSR, production builds and the full three-engine matrix pass. PostgreSQL is required only if the implementation changes persistence; external-provider/deployment certification is not claimed.

## Risks and rollback

- **Draft leakage:** a generic resolver or cache could expose draft labels/targets. Mitigation: separate private/public entry points, published reader only, strict projections and negative response/cache tests.
- **Broken or unsafe links:** stored slugs and arbitrary schemes can become stale or executable. Mitigation: store internal references, compute routes from current published data and allow only credential-free absolute HTTP(S) external URLs.
- **Tree abuse or unusable editor state:** cycles, very deep trees and unstable identity make rendering/reordering unsafe. Mitigation: 100 items, depth 3, stable IDs, parent-before-child order and one validator used at every lifecycle boundary.
- **Cache staleness after target changes:** hrefs depend on another entry. Mitigation: response tags include the menu and every referenced target within the exact scope.
- **Localization ambiguity:** independently localized item arrays can diverge. Mitigation: make the whole array explicitly localized, show completeness/fallback, validate every variant and report requested/resolved locale.
- **Rollback overstatement:** a first publication has no prior pointer. Mitigation: retain and expose the existing release restriction; no silent delete or invented recovery claim.
- **Application ownership erosion:** a CMS component could impose inaccessible or conflicting markup/styles. Mitigation: SDK data only; the Vite example owns semantic rendering and Studio styles never cross the boundary.

Rollback is the dedicated CMS-011 implementation commit. No data migration or provider cleanup is required; retained entries become inert ordinary revisions. Purging them is out of scope.

## Explicit exclusions

No Studio-sidebar configuration, automatic inclusion of pages, recursive/unbounded or mega-menu content, per-item content documents, arbitrary HTML/Markdown/JavaScript/CSS, icon/media/CTA mega-menu blocks, link analytics, role/personalization-aware menus, open redirects, host-router takeover, React navigation package, second repository, new permission, unpublish/delete, CMS-012 through CMS-015 behavior, dependency, merge, push, deployment or production-readiness upgrade.

## Approval gate

Pending. Commit this documentation-only plan separately, report its exact verification evidence and obtain an explicit go-ahead before editing runtime, tests, generated contracts or example application behavior. Approval starts CMS-011 only; every later website-management task retains its own plan and gate.

## Planning verification

Codex, 2026-08-31:

- `pnpm lint` passes Biome plus package-boundary, ledger, threat/ASVS, tenant-scope and unchanged release-readiness checks across 364 files. `pnpm format:check` passes across 361 files; `git diff --check` passes.
- A read-only audit validates 70 local Markdown links across the exact five-file planning fence: `TASKS.md`, `CHANGELOG.md`, `README.md`, `docs/cms-admin-gap-analysis.md` and this ADR. Git status confirms that no runtime, test, generated contract, package/dependency, persistence, provider or deployment file changed.
- No defect was found during the documentation review, so `BUGS.md` correctly remains unchanged. The last full repository/browser results remain CMS-010's historical evidence; no runtime, unit, browser, database, provider or deployment result is represented as fresh verification of this proposal.
