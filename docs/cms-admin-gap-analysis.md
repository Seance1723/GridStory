# CMS administration: feasibility, gap analysis, and delivery plan

- Reviewed: 2026-08-26 by Codex.
- Task: GOV-006. Implementation baseline: `72fbc62`.
- Input: user-supplied `CMS_Admin_Menu_Structure_Reference.md` (August 2026).
- Input SHA-256: `fb558e9fa7e425c8f3028c845344d7066d8df5e2ce29db12b0891afb12e51fca`; the original attachment is unchanged and is not copied into the application.
- Status: GOV-006 analysis complete; the inventories below retain their planning baseline. CMS-001 navigation implementation is tracked separately in section 12; the rest is a recommendation, not an implemented feature set.
- Queue: [TASKS.md](../TASKS.md), CMS-001 through CMS-031.
- Decision: [proposed ADR 0027](adr/0027-cms-administration-information-architecture.md).

## 1. Answer and scope

Yes. A familiar CMS administration structure fits GridStory without replacing its React application, content engine, database adapters, or security architecture. The work has three different sizes:

1. **Reorganize working features:** Pages, Assets, Workflows, Releases, Search, component governance, identity, marketplace, quality, targeting, and operations already have Studio surfaces.
2. **Finish the admin product over existing foundations:** collections, list views, taxonomy/schema inspection, user administration, installed-plugin management, analytics reporting, import/export, and configuration visibility need dedicated or expanded screens. Some require small authorized API projections, not merely labels.
3. **Add missing domain behavior:** visitor navigation, revisioned site settings, complete SEO delivery, mutable redirects, safe content retirement, and governed appearance overrides require new contracts and lifecycle behavior.

Commerce transactions, marketing delivery/CRM, visitor memberships, and public comment moderation are optional integration programs, not hidden existing CMS features. They need a product/provider decision before implementation. Raw theme/plugin/code editors conflict with GridStory's code-owned rendering and isolation rules and are not recommended.

This change edits documentation and tasks only. It does not reorganize the running UI, install providers, alter data, or approve future T2/T3 implementation. Existing colors, shared SCSS, header-only preview, and every current feature remain requirements for subsequent work.

## 2. Reference qualifications

- Part 3 says “11 jobs” but actually enumerates **13 categories**. This audit covers all 13.
- The embedded `<cite index=...>` markers have no resolvable bibliography. Treat them as reference claims, not independently established evidence or instructions.
- Menu names vary by permissions, enabled modules, product edition, and theme. For example, WordPress distinguishes classic-theme customization from its block-theme editor; Shopify currently documents visitor menus at **Content > Menus**, not solely under Online Store. See [WordPress administration](https://wordpress.org/documentation/article/administration-screens/) and [Shopify menus](https://help.shopify.com/en/manual/online-store/menus-and-links).
- The common categories are an evaluation checklist, not evidence that every CMS implements every business function. Do not create 13 mandatory top-level items or empty screens to simulate parity.
- **Admin navigation** chooses a Studio screen. **Visitor navigation** is versioned site content consumed by the application. They must remain separate.
- WordPress reader comments, Shopify customers, and HubSpot contacts must not be mapped to GridStory's private editorial comments or workforce identity records.
- Wix/Squarespace commerce, scheduling, finances, HubSpot CRM/memberships, and Shopify tax/fulfilment examples indicate optional business domains. Their exact contemporary menus were not exhaustively revalidated; the plan does not depend on them.

## 3. What is actually implemented

Evidence below comes from source inspection, not just completed milestone titles. Prior verification remains historical; new verification for this documentation change is recorded in GOV-006.

| Layer | Current evidence | Consequence for this upgrade |
|---|---|---|
| Studio shell | `apps/studio/src/App.tsx`: `StudioDestination`, `navigationGroups`, `selectNavigationItem`; 19 destinations in four groups; `activeStudioDestination` is local React state. | Reuse single-destination behavior. There is no URL-addressable admin route hierarchy yet. Add history/deep-link behavior deliberately. |
| Content authoring | `App.tsx`: initial load and `refreshList` request `contentType: 'page'`; `createPage` uses `schemas[0]` and requires a registered component. | A multi-schema backend does not mean collection authoring is finished. Collections must select an explicit schema and allow types without component trees. |
| Content engine | `packages/core/src/content-service.ts`: schema-keyed create/read/list/update/publish/revisions; query, localization, audit, workflow, releases and references in adjacent services. | Reuse existing lifecycle for pages, posts and other collections. General content unpublish/archive/trash is not exposed by this service; governance erasure is not a substitute. |
| Content models | `packages/schema/src/canonical.ts`, `lifecycle.ts`; `packages/core/src/schema-lifecycle-service.ts`; `/api/v1/schema-lifecycle/*`. | Visual-model serialization, plan/diff/drift and deployment records exist. `deploySource` deploys the configured source, not arbitrary UI-created runtime schemas. A live model builder is a separate architectural decision. |
| Taxonomy | `packages/schema/src/search.ts`, `contracts.ts`; `search-service.ts`; `/api/v1/taxonomies`. | Definitions and terms are code-owned; fields/facets work. No mutable term-management UI/service is established. Start with inspection and reviewed proposals. |
| Routes | `packages/schema/src/routing.ts`, `packages/core/src/routing-service.ts`; API composition injects redirects. | Canonical paths, uniqueness and loop checks exist. No durable editable redirect manager or automatic slug-history lifecycle is established. |
| Design | `packages/schema/src/design-system.ts`, `packages/react`, `docs/design-system.md`; `/api/v1/design-system` is a read endpoint. | Approved tokens, variants, responsive overrides, symbols and templates exist. Global token editing, arbitrary themes and a theme installer do not. |
| Assets | `asset-service.ts`, `asset-security.ts`, `asset-delivery-service.ts`, `s3-asset-storage.ts`; Studio asset library. | Upload, metadata, revisions, renditions, usage and quarantine boundaries exist. UI discoverability and production storage/scanner conformance are different gaps. |
| Identity | `enterprise-identity-service.ts`, `authorization.ts`, `identity-routes.ts`; Studio Identity panel. | Reuse OIDC/SAML/SCIM/WebAuthn, sessions and group mappings. No local password/reset service is implied. Existing nav is not derived from server-returned effective capabilities. |
| Apps | `plugin-service.ts`, `marketplace-service.ts`, API plugin lifecycle routes; Studio Marketplace panel. | Catalog/review/install handoff exists. A dedicated installed-extension manager is missing. Runtime provisioning and Studio sandbox loading remain separate limitations. |
| Quality/analytics | `content-quality-service.ts`, `analytics-service.ts`, `analytics-routes.ts`; Studio Quality and Operations panels. | Deterministic content checks and bounded counters exist. Full SEO output and traffic/funnel/attribution dashboards do not follow from those counters. |
| Configuration | `scope-registry.ts`, `apps/api/src/config.ts`, `server.ts`; Studio `defaultClient` is configured at startup. | Topology is validated and explicit, but a site-settings editor/scope-switching administration workflow is not established. Environment secrets must not become browser-editable settings. |

The baseline includes additional enterprise features not emphasized in the reference: Data governance, Migrations, Federation, Fleet, Regions, AI gateway and Knowledge. They are retained, not removed to make the menu resemble WordPress.

The old task ledger has completed bounded slices, while the broader feature catalog remains aspirational in places. A checked M2-005 is evidence for its described schema-lifecycle slice, not proof that every P0 modeling bullet has shipped. The dated [readiness review](release-readiness.md) still says private technical alpha go and beta/RC/GA no-go; this plan does not change that decision.

## 4. Thirteen-category gap matrix

“Existing” below means the named bounded behavior exists. “Partial” explicitly does not claim full platform parity.

| Reference category | Current coverage | Missing work / proposed location | Queue |
|---|---|---|---|
| 1. Static pages | Existing schema fields, composition, draft/save/publish, history, preview, workflow and quality. | **Content > Pages**: usable list/filter views; retirement/trash and bulk behavior need new lifecycle work. | CMS-001, CMS-005, CMS-023, CMS-024 |
| 2. Posts/collections/articles | Generic models, queries and content engine; Studio is page-specific. | **Content > Collections > type > entries**. Posts/case studies are configured schemas, not separate engines. Schema/type and taxonomy inspection live alongside them. | CMS-004, CMS-005, CMS-009, CMS-025, CMS-027 |
| 3. Media/assets | Existing asset library, uploads, metadata, usage, revisions, renditions/security. | **Media > Library / Upload / asset details**; improve discovery/filtering and surface policy/provider limitations. No new DAM/storage vendor. | CMS-007, CMS-010 |
| 4. Visitor navigation | No first-class menu authoring or published menu resolver found. Routes alone are insufficient. | **Navigation > Menus**: header/footer named menus, bounded hierarchy, internal/external links, localization, draft/preview/publish and app-owned rendering. | CMS-011 |
| 5. Design/appearance | Existing code-owned components/tokens/variants/symbols/templates and inspector controls. | **Design > Components / Tokens & variants / Templates & symbols**. Browse first; approved versioned overrides later. No raw source editor or automatic theme replacement. | CMS-008, CMS-026 |
| 6. Commerce | Product-like content can be modeled. No orders, checkout, inventory ledger, payment, tax, shipping or discount engine. | Conditional **Commerce** integration only after choosing use cases/provider and data ownership. External commerce remains authoritative. | CMS-028, decision-gated |
| 7. Users/permissions | Existing workforce identities, RBAC/ABAC, federation, SCIM, sessions and group roles. | **People > Users & groups / Roles & access / My profile**; admin Identity providers remain advanced. Invitations/provisioning must follow IdP ownership. | CMS-003, CMS-016, CMS-017 |
| 8. Apps/extensions | Existing signed manifests, grants, lifecycle, marketplace review/install boundary. | **Apps > Installed extensions / Marketplace**. Show missing runtime and ungranted state truthfully; do not infer runtime provisioning from an install record. | CMS-018; runtime remains separate |
| 9. SEO | Partial: title/description/canonical checks, route validation, redirect resolver and quality gates. | **SEO & quality > Page checks / Metadata / Redirects / Sitemaps & feeds**. Add actual application output, not only form fields. Search Console remains optional integration. | CMS-013, CMS-014, CMS-015, CMS-029 |
| 10. Analytics | Existing consent-gated event adapters, bounded content/component counters and release annotations, visible under Operations. | **Insights > Content analytics** with honest bounds, truncation and provenance. No invented traffic history, visitors, conversion rate, revenue or significance. | CMS-019 |
| 11. Marketing | Existing targeting, experiments, releases, CTA components and workflow/webhook foundations. | **Insights > Targeting / Experiments**, **Content > Releases**; campaigns/forms/email/social/ads/CRM require a selected connector and PII/consent review. | CMS-001, CMS-029, decision-gated |
| 12. Settings | Explicit scoped topology and code/server configuration; local Studio theme choice. | **Settings > General / Writing & reading / Media policies / Locales & environments / Privacy links**. Separate content settings from secrets, DNS, hosting and workforce security. | CMS-010, CMS-012, CMS-017 |
| 13. Tools/utilities | Existing logical archive APIs, guarded CMS migration, recovery CLI/runbooks, audit/operations/fleet health. | **Tools > Import & export / Migrations / Site health / Help**. Backup/restore and deployment updates remain operator-run; no browser code injection. | CMS-020, CMS-021 |

## 5. WordPress submenu and cross-platform job disposition

This expands the category matrix so familiar submenu names do not conceal missing behavior.

| Reference jobs | GridStory disposition |
|---|---|
| Dashboard Home, recent activity, quick draft | New read-only Home in CMS-006; counters use authorized actual data with loading/empty/truncated states. Quick create delegates to existing content creation. |
| Dashboard Updates | Tools > Site health/version information in CMS-021. Package/deployment upgrades remain reviewed CLI/CI work, not in-process self-update. |
| Posts All / Add New; Pages All / Add New | Shared type-aware entries UI, CMS-004/005. Pages remain a dedicated shortcut. No forced blog schema in every tenant. |
| Posts Categories / Tags | Hierarchical/non-hierarchical taxonomy definitions already supported. Read/usage view CMS-009, candidate changes CMS-025; live mutable terms require CMS-027's ownership decision. |
| All-content bulk edit/delete | CMS-024 only after CMS-023 defines safe unpublish/archive/trash semantics. No shortcut through privacy-erasure APIs. |
| Media Library / Add New | Existing feature moved and improved in CMS-007; unsafe uploads remain blocked, storage and scanner availability remain visible. |
| Comments approve/spam/reply/delete | Public reader feedback is absent; optional CMS-030 discovery. Existing private collaboration/replies/resolution remain in the editor, plus CMS-022's editorial inbox. |
| Appearance Themes / Customize | Approved catalog CMS-008 and bounded overrides CMS-026. Installing a WordPress/PHP theme or taking over application CSS is incompatible. |
| Appearance Widgets / Patterns | Registered components, governed slots, symbols and templates cover the equivalent reusable-layout job. CMS-008 exposes these without a duplicate widget engine. |
| Appearance Menus | CMS-011 visitor navigation, not the Studio sidebar. Placement in headers/footers remains application-owned. |
| Theme File Editor / Plugin Editor; Webflow or HubSpot custom source injection | Not planned: arbitrary code would cross rendering/plugin/preview trust boundaries. Use the application repository, review and normal deployment instead. |
| Plugins Installed / Add New | Existing Marketplace plus CMS-018 lifecycle/grant manager. Installing a reviewed manifest is not downloading, hosting or enabling arbitrary code. |
| Users All / Add New / Profile | CMS-016 directory and access administration, provider-owned create/invite guidance, CMS-017 safe preferences/profile. Password reset and user authentication remain IdP-owned. |
| Tools Available / Site Health / Help | CMS-021 diagnostics and contextual docs, preserving Operations and advanced controls. No unbounded external crawler. |
| Tools Import / Export | CMS-020 wraps existing checksummed dry-run/conflict/scoped archive behavior; CMS Migrations stays its separate existing workflow. |
| Tools backups | Expose runbooks and only real evidence in CMS-021. Database restore is hazardous operator work with a backup/explicit approval, not a web convenience action. |
| Settings General | CMS-012 site title/tagline/logo/favicon, validated canonical base URL and display timezone. URL metadata is not domain registration, DNS or TLS provisioning. |
| Settings Writing | CMS-012 approved default content type/taxonomy choices. Do not silently rewrite existing entries or code-owned schemas. |
| Settings Reading | CMS-012 explicit home/listing references and bounded list defaults; CMS-015 indexing output. The host app opts into consuming settings. |
| Settings Discussion | Applicable only if CMS-030 later approves a public-comment feature. Do not expose a nonfunctional global switch. |
| Settings Media | CMS-010/007 show active security/rendition policies and ownership. Editable provider presets need a later justified contract; do not pretend a form changes the deployed image service. |
| Settings Permalinks | Existing code-owned schema routes shown in CMS-009; CMS-014 handles redirects. Arbitrary route-pattern changes stay in reviewed schema lifecycle, not unchecked URL text boxes. |
| Settings Privacy | CMS-012 privacy/legal page references. Data-subject workflows remain Data governance. Neither creates legal compliance or legal advice. |
| Webflow CMS / HubDB / Drupal content types and fields | CMS-004/009 expose existing models and entries. CMS-025 is a proposal/plan workflow; CMS-027 decides whether hot activation is ever supported. |
| Webflow Navigator / Add / Variables; Joomla modules | Existing layers, palette, slots and tokens remain in the editor and CMS-008 catalog; no new renderer. |
| HubSpot website / landing / blog distinctions | Configured content types or filtered views in CMS-004/005, using one content lifecycle. |
| Wix/HubSpot customers, leads, forms, campaigns, ads, pop-ups, CTAs and reviews | CTA/page composition already exists. CRM/contact storage, submissions and outbound delivery are CMS-029/030 decision gates, not workforce users or editorial comments. |
| Wix finance/loyalty, Squarespace scheduling/subscriptions, Shopify discounts/orders/tax/shipping | CMS-028/029 discovery records demand and providers. These are optional business integrations; no native commerce/accounting/booking platform is authorized. |
| Drupal Reports/Configuration/People/Extend; Joomla System/Components | Map to Tools/Settings/People/Apps while retaining GridStory's advanced governance. Same job may have different labels; no platform-specific duplicate subsystem. |

## 6. Proposed information architecture

This is the **target**, not a promise to render every item on day one. A leaf appears only when implemented, configured and permitted. Existing authorized features remain reachable throughout migration. Group labels are disclosure controls; exactly one leaf is the current page. Contextual tabs/actions are not additional simultaneous pages.

```text
Home
Content
  Pages · Collections · Schemas & taxonomies · Editorial inbox
  Workflows · Releases · Search
Media
  Library (Upload is an action)
Navigation
  Menus (header/footer/other named visitor menus)
Design
  Components · Tokens & variants · Templates & symbols
SEO & quality
  Page checks · Metadata · Redirects · Sitemaps & feeds
Insights
  Content analytics · Targeting · Experiments
Apps
  Installed extensions · Marketplace · Integrations [conditional]
People
  Users & groups · Roles & access · My profile
Settings
  General · Writing & reading · Media policies
  Locales & environments · Privacy links
Tools
  Import & export · Migrations · Site health · Help
Advanced
  Operations · Identity providers · Data governance
  Federation · Fleet · Regions · AI gateway · Knowledge
Commerce [only after an approved, configured integration]
```

Header: explicit authorized scope selector, search/commands, contextual Save/Publish, existing preview pop-out, local theme and account controls. Switching scope must resolve dirty state, revoke old preview, abort requests and clear scope-keyed caches before new data appears. A hidden menu is never the authorization boundary.

“Design” controls the connected site's approved presentation. Studio's light/dark preference and SCSS are separate and must not change site styling.

### Every existing destination retains a home

| Current destination | Proposed canonical location |
|---|---|
| Pages | Content > Pages |
| Workflows | Content > Workflows |
| Releases | Content > Releases |
| Search | Content > Search; header shortcut points to the same leaf |
| Operations | Advanced > Operations; analytics extracted to Insights without losing operational information |
| Identity | Advanced > Identity providers; People adds focused directory/access views |
| Data governance | Advanced > Data governance |
| Migrations | Tools > Migrations |
| Marketplace | Apps > Marketplace |
| Targeting | Insights > Targeting |
| Experiments | Insights > Experiments |
| AI gateway | Advanced > AI gateway |
| Knowledge | Advanced > Knowledge |
| Quality | SEO & quality > Page checks, retaining selected-entry context |
| Federation | Advanced > Federation |
| Fleet | Advanced > Fleet |
| Regions | Advanced > Regions |
| Components | Design > Components |
| Assets | Media > Library |

## 7. Architecture and data seams

- **Navigation shell:** begin with a typed, finite registry for the 19 real screens, not a plugin/router framework. Extract screen components when touched, not a wholesale `App.tsx` rewrite. Stable URLs/history follow as a separate task. URL parameters are validated and contain no credentials or draft values.
- **Authorization/scope:** add a minimized effective-capability/context projection from existing authorization, never hard-coded role-name guesses. Lists, deep links, writes, search and switches must still authorize server-side and tolerate revoked access. No topology is returned across unauthorized tenants.
- **Collections:** reuse `ContentService`, canonical schema fields, queries, localization, immutable history and workflow. Display labels derive from the selected schema. Types without component trees must not require a Hero or preview.
- **Visitor menus:** proposed minimal representation is a reserved code-defined content type using existing revisions/publication, with a bounded flat node list (`id`, `parentId`, label and validated entry/external target). Validate cycles/depth/order, exact-scope references, localization and published targets. A published-only resolver computes current canonical routes; the React app owns markup, placement, keyboard behavior and CSS. Menu and target publication in a release need future-state validation. Do not create a second revision database.
- **Site settings:** proposed fixed-identity, revisioned site content with enforced singleton cardinality per scope and an explicit public-field allowlist. Separate operational configuration from publishable branding/home/privacy/defaults. Reuse content revisions only if uniqueness, permission and release invariants can be enforced; decide exact contract in CMS-012 before code.
- **SEO:** title/description/social/canonical/robots/structured-data fields require validated mappings and published application output. Feed/sitemap/robots helpers consume published scoped data; indexing directives are not access control. New output needs SSR/static-compatible seams even though only Vite is currently certified. No draft credentials, private URLs or authenticated asset grants in public metadata.
- **Redirects:** existing resolver is immutable/configured. A durable scoped redirect catalog needs a migration/merge policy with code-provided redirects, immutable versions, collisions/loops checks, audit and rollback; it must not silently change routes on ordinary draft edits.
- **Schema/taxonomy:** source definitions and generated types remain authoritative. Inspect and export candidate IR first. Model hot activation, per-tenant schema authority, multi-process refresh, generated types, worker/search reconfiguration and data backfills remain CMS-027's decision; an editable JSON pane is not a safe model builder.
- **Design:** browsing uses the current manifest. New overrides may expose only approved tokens/props and must pin versions without mutating old published rendering. No CSS/JS injection, template execution, source-file editor or third-party theme loading.
- **Business integrations:** reuse external adapters, signed plugin grants and durable jobs when a provider is selected. A menu item neither provisions a sandbox nor supplies consent, retention, anti-abuse, payments or provider certification.

## 8. Sequence, dependencies, and scope control

The task ledger is authoritative for individual acceptance and file fences. All CMS implementation tasks were created `[ ]` with owner unassigned; their live status is in `TASKS.md`. Each needs a scoped start/research pass; T2/T3 requires approval before application edits.

| Wave | Tasks | Why this order |
|---|---|---|
| A. Preserve and organize | CMS-001, CMS-002, CMS-003 | First retain every existing screen, then make location/history stable, then supply authorized context/capabilities used by new screens. Shell regressions are caught before adding domains. |
| B. Expose real foundations | CMS-004 through CMS-010 | Type-aware content and lists precede dashboard summaries and content-linked settings. Media/design/model/configuration views reuse actual services and expose limitations. |
| C. Complete website essentials | CMS-011 through CMS-015 | Visitor menus reuse type-aware content; public settings supply canonical site/default data; SEO fields precede feed output; redirects must be correct before public discovery output. |
| D. Focused administration | CMS-016 through CMS-022 | Access projection precedes people/apps/tools; existing analytics and archive contracts supply reporting and utilities; editorial inbox needs generic entry navigation. These can be reordered by their explicit dependencies, but are delivered one task at a time. |
| E. Governed depth | CMS-023 through CMS-026 | Retirement semantics precede bulk mutation; model and design changes require explicit review/version boundaries. Do not add destructive shortcuts to earlier UI tasks. |
| F. Product decisions, optional | CMS-027 through CMS-030 | Runtime modeling, commerce, marketing/CRM/forms and visitor identity/comments need choices/evidence before concrete integration slices are created. No provider credentials or customer data are needed for this planning pass. |
| G. Acceptance | CMS-031 | Audit all shipped leaves and end-to-end journeys; optional decisions do not block core acceptance and do not imply features shipped. |

No calendar estimate is asserted: scope varies materially between moving an existing panel, adding domain lifecycles and certifying providers. The original multi-person roadmap's month/week estimates are historical planning assumptions, not a schedule for this queue.

### Common definition of done for each future slice

1. Matching task/Unreleased/bug records; commit only after acceptance evidence. Do not delete old completed history or recast bounded tasks as failures.
2. No feature removal, new theme, duplicate global styling layer, inline preview return, or published application style takeover.
3. Explicit scope and authorization; draft/published separation; optimistic writes, audit/outbox and migration/restore evidence wherever applicable.
4. Tests for authorized/forbidden, empty/loading/error, stale/conflict, invalid inputs and supported browser navigation; integration/storage tests when contracts or persistence change.
5. Re-run all current destinations and every new leaf at 1440, 1280, 1024, 768, 390 and 320px, light/dark, keyboard, 200% zoom, forced colors and WCAG checks. Assert one active leaf and one visible destination, not just absence of horizontal scroll. Check forms/buttons/text/spacing with the global SCSS contract.
6. Verify live header-only preview, draft synchronization, explicit revocation, Save/Publish, published delivery and existing advanced controls; no route/scope transition can leak or silently discard data.
7. A provider-dependent control must accurately say unavailable/not configured. No fake metrics, inert submenu promises or “complete integration” claims from interface-only tests.

## 9. Recommended next action

The original first recommendation was **CMS-001: reorganize only the 19 existing destinations** using the mapping above. CMS-001 and **CMS-002: stable Studio locations, deep links and history-safe navigation** are now implemented and verified; their checkpoints are below. CMS-003 inspection subsequently confirmed the critical production-authentication defect BUG-0433. The next action is approval and verified implementation of **AUTH-001** in [ADR 0029](adr/0029-production-preview-authentication-boundary.md), followed by CMS-003's separately approved capability/context plan. The broader program does not approve either contract automatically.

After that, proceed through the queue by dependency. CMS-002 and other T2 tasks require their own implementation plan/approval. CMS-027 through CMS-030 are questions/discovery tasks, not authorization to build a model-hosting platform, store PII, send email, process payments or deploy services.

## 10. Prior art used

Four official sources were sufficient to establish the relevant shapes; exhaustive competitor cloning is not needed.

| Approach/source | Useful pattern | Cost / what GridStory deliberately skips |
|---|---|---|
| [WordPress administration](https://wordpress.org/documentation/article/administration-screens/) | Task-based menus with scoped work areas; clear separation of content, appearance, people, tools and settings. | Do not copy its runtime theme/plugin editing, PHP coupling or assume a fixed menu for every installation. |
| [Drupal administrative overview](https://www.drupal.org/docs/user_guide/en/config-overview.html) | Separate content editing from structural definitions, configuration and people. | Do not turn all advanced platform operations into everyday editorial navigation. |
| [Webflow collection items](https://help.webflow.com/hc/en-us/articles/33961289539347-Collection-items-overview) | Collections are reusable record types; item lists and lifecycle controls serve repeated content. | Do not adopt the designer/hosting system or treat a schema contract as an already-finished collection screen. |
| [Shopify menus](https://help.shopify.com/en/manual/online-store/menus-and-links) | Visitor link management is distinct from theme placement. | No commerce engine or theme takeover is necessary to implement CMS-managed visitor menus. |
| Reuse current GridStory panels without new domains | Lowest immediate cost; preserves tested functionality. | Useful first slice, but alone cannot supply visitor menus, site settings or missing lifecycle/output behavior. |

These are architectural inferences from the documented patterns plus the inspected repository, not claims of feature equivalence or certified compatibility with those products.

## 11. Planning verification and handoff

- `node scripts/check-ledgers.mjs`: passes; stable IDs/statuses and required Unreleased structure are valid.
- Read-only `node --input-type=module` stdin audit: 13 category rows, 19 actual source navigation labels mapped, 31 planned task cards with required fields, no dependency cycles, 10 valid local links/anchors, all 104 pre-existing task statuses preserved, ADR still proposed, and the preview-guide text regression passes.
- `pnpm format:check`: 317 managed files checked, no fixes required. Markdown links and structure were checked separately above; this formatter result alone does not validate Markdown.
- `pnpm check`: passes lint/boundaries/ledgers/security/tenant/readiness, format, generated-contract checks (eight interoperability artifacts), strict types, all workspace tests including 33 Studio tests, React 18.3.1 SSR certification and all production builds. Initial restricted child-process failures are documented in BUG-0417; the approved rerun changes no source/tests.
- `git diff --check`: passes. All changed tracked/new files are documentation/ledgers; no application, provider, dependency or deployment change.
- Not rerun: browser visual walkthroughs, PostgreSQL/provider conformance and production deployment. They are unnecessary to claim this documentation plan is complete, and this work does not claim fresh evidence for those surfaces.

Handoff: GOV-006 completes analysis/planning only on `main`. All CMS tasks remain planned. The next implementation task is CMS-001, preserving all existing functionality and styling. The source attachment remains unchanged; the new decision remains proposed. No finding needed for the next task is intentionally left outside these documents.

## 12. CMS-001 implementation checkpoint

- Updated: 2026-08-26 by Codex. Status: implemented and verified; completion commit is tagged `[CMS-001]`. This section updates the historical planning handoff above, not the original baseline inventory.
- All 19 destinations now have exactly one home in eight nonempty groups: Content, Media, Design, SEO & quality, Insights, Apps, Tools and Advanced. Assets is labeled Library, Quality is Page checks, and Identity is Identity providers; the existing panel content remains intact. No Home, Settings, People, visitor Navigation or optional-business placeholder has been added.
- The finite typed [navigation metadata](../apps/studio/src/navigation.ts) owns labels, icons and grouping; [App.tsx](../apps/studio/src/App.tsx) retains feature state/actions. Native disclosure buttons and lists expose expansion state without menu-widget semantics. Group toggles do not select, fetch or save a page; existing single-destination selection/loaders and editor state are reused. Header search reveals Content when necessary.
- Desktop compact mode exposes every named leaf icon and retains expanded-mode group preferences. Mobile restores the full labels/disclosures and closes the drawer after selection. The green/lime palette, shared SCSS control styles and header-only live preview are unchanged.
- Manual verification found and corrected two existing edge cases: compact-footer text escaping the rail because of selector specificity (BUG-0418), and a fixed body minimum defeating a native scrollbar's available width at 320px (BUG-0419). Both have browser regressions.
- No new framework, dependency, route, API, authorization, data model, provider or saved-content mutation is part of this slice. Scope/capability gaps and the beta/RC/GA no-go decisions remain unchanged.
- Evidence: 37 Studio tests, the full `pnpm check` gate, repeated final lint/format/production/E2E builds, and `pnpm test:e2e` with 21/21 passing scenarios across Chromium, Firefox and WebKit. The all-destination sweep covers six widths, light/dark, readable text/control containment, keyboard, zoom/forced colors, accessibility, header-only preview and published delivery. Manual in-app clicks covered disclosures, compact Library selection, mobile Regions/drawer behavior, header search and theme switching; the native-scrollbar layout now fits 305px of usable space inside a 320px viewport. Documentation links and all other task statuses are preserved. Opt-in PostgreSQL, external-provider certification and deployment were not rerun or claimed.
- Follow-up: CMS-002 only, after its scoped plan/approval. CMS-003 through CMS-031 retain their dependency and decision gates.

## 13. CMS-002 planning checkpoint

Implementation update (2026-08-26): the user approved ADR 0028 in response to its explicit approval question. CMS-002 progressed through `[~]` to verified `[x]`; section 14 records completion. The planning evidence below remains historical.

- Updated: 2026-08-26T12:46:25+05:30 by Codex. The scoped [Studio locations/history proposal](adr/0028-studio-locations-and-history.md) is ready for approval; CMS-002 is not implemented and remains `[ ]`.
- Recommended contract: finite hash destinations with optional page entry/type context, native history without a router dependency or server rewrite, one guarded entry-transition path, stale-read protection and entry-bound preview cleanup. Same-entry destination changes preserve drafts. Invalid/unavailable targets and cancelled owned/unowned history have explicit behavior.
- Source review logged BUG-0421: search-result entry clicks bypass the existing dirty confirmation. Its runtime regression and fix are part of the proposed implementation, not this documentation pass. BUG-0420 corrects the stale queue summary that still named completed CMS-001.
- This checkpoint does not change application behavior, authorize CMS-003 scope/permissions or CMS-004 non-page authoring, add deployment claims, or turn the broader proposed program into approval. The next action is owner approval of ADR 0028.

## 14. CMS-002 implementation checkpoint

- Updated: 2026-08-26 by Codex. Status: implemented and verified; completion commit is tagged `[CMS-002]`. The finite native location/history contract supports all 19 existing destinations and optional authorized page entry context, with no router dependency, server rewrite, trusted URL scope or published-application route change.
- Direct links/reload, invalid and unavailable targets, owned/unowned Back/Forward, dirty cancellation, stale reads, entry-bound writes and preview replacement have explicit guarded behavior and regressions. Same-entry destination changes preserve drafts/preview, and skip focus preserves the route. Current colors, shared SCSS, grouped navigation and every existing feature remain intact.
- Evidence: complete repository checkpoint followed by final lint/format/type/unit-integration gates (430 active tests, including 78 Studio; 17 existing opt-in skips), production/E2E builds and 30/30 Chromium/Firefox/WebKit scenarios. These retain all 19 destinations at six widths, light/dark, text/control containment, keyboard, zoom/forced colors, WCAG and preview/publishing delivery. The isolated final WebKit sweep passed its unchanged deadline after the overlapping-run timeout logged as BUG-0432.
- Isolated manual smoke verified copied links, reload, Back/Forward, mobile drawer/containment, theme switching and connected-preview closure on accepted entry replacement. Automated tests supply native-cancellation evidence; the manual smoke does not claim it. Own test tabs/services were closed, viewport reset and user data/services preserved. PostgreSQL, external-provider and deployment certification were not rerun or claimed.
- BUG-0421 through BUG-0426 and BUG-0428 through BUG-0432 are resolved. BUG-0427 remains open for CMS-004: existing Create page defaults fail the full example schema, while preserving current editor/address on rejection. Successful creation location behavior is verified with a valid unit fixture; schema-aware defaults are not silently added to this slice.
- Follow-up: prepare and obtain approval for CMS-003's minimized authenticated capabilities/context contract and safe scope switching. All later tasks retain their dependencies and decision gates; existing beta/RC/GA no-go boundaries are unchanged.

## 15. CMS-003 research and security prerequisite

- Updated: 2026-08-26T16:03:30+05:30 by Codex, baseline `1de8211`. This is a planning-only checkpoint. CMS-003 is now blocked on AUTH-001; no source or permission change has been made. The existing Create page validation BUG-0427 remains CMS-004 work.
- Confirmed BUG-0433: the production request hook treats an unverified preview-token prefix as a route-independent authentication exemption, and unbound request context falls back to development admin. Isolated in-memory, seed-free API injection reproduced HTTP 200 on private context with that identity. No real server, credential, content or deployment was touched. [ADR 0029](adr/0029-production-preview-authentication-boundary.md) freezes the small prerequisite fix and its exact approval/verification boundary; this takes precedence over adding new capability endpoints.

### Retained CMS-003 inward findings

| Existing seam | Reuse | Gap to resolve after AUTH-001 |
|---|---|---|
| `packages/core/src/authorization.ts` | Existing deny-by-default action/resource decisions and scoped assignments/grants. | Do not infer permissions from browser role names or a generic `canEdit` flag; projection must match each route's actual resource/type checks. |
| `packages/core/src/scope-registry.ts` | Full organization/tenant/workspace/site/environment/locale hierarchy and active parent/locale validation. | It is not currently wired into API context discovery; no trusted selectable-topology contract exists. Approve a bounded code-owned catalog and missing-configuration behavior before implementation; never enumerate raw topology to a user. |
| `GET /api/v1/context` and client `getRequestContext` | Existing authenticated request context, after AUTH-001 fixes its outer boundary. | It returns the whole principal and requires a platform-level content-read decision; not a minimized capability projection, and not a general entry point for content-type-limited or operations-only users. Preserve compatibility or explicitly approve its replacement. |
| Enterprise identity hook and `requireIdentityAdmin` | Tenant-bound session revalidation, plus the existing distinct identity administration gate. | Identity gate currently uses server-side admin/identity-admin roles. A new projection must reuse the same gate server-side, not invent a frontend role mapping or silently replace the policy. |
| `packages/client/src/index.ts` | Fixed complete-scope headers, production cookies, development-mode opt-in and AbortSignals. | Client scope is immutable with no cloning/switch API. Scope switching must preserve trusted identity/transport, never accept tenant authority from a URL, and distinguish abortable reads from writes that may already have committed. |
| `apps/studio/src/App.tsx` | CMS-002 entry/history/preview guards, one selected destination and existing feature loaders. | Startup unconditionally loads content/schema/components/design/workflows, and entry selection additionally requires history/workflow reads. Permission-aware bootstrap must isolate optional reads so one denial does not prevent another authorized screen. |
| Finite navigation and shared SCSS | All 19 stable destination IDs, task groups and consistent controls. | Filter only by verified server capabilities; denied deep links must not show cached privileged output. Context replacement must clear every panel/draft/undo/search/selection/preview generation, not just change the client prop. Retain all features for authorized users and preserve the theme. |

The future scope UI needs a reviewed rule for organization/tenant/workspace anchoring, site/environment/locale choices, empty/denied configuration, dirty/mutation guards, authorization revalidation and reload/history behavior. Those choices are not approved by this inventory. In particular, type-restricted grants must not be advertised as usable on a route that omits the type from its authorization resource; surface the actual limitation or approve a separately tested correction.

### Retained outward findings

| Primary source | Useful shape / failure mode | What GridStory deliberately does not infer or copy |
|---|---|---|
| [Sanity roles](https://www.sanity.io/docs/user-guides/roles) | Resource-specific and additive grants; a role can edit content yet lack ancillary Studio feature permissions. | No role-name shortcut, SaaS billing model, GROQ policy engine or assumption that document read permits all bootstrap reads. |
| [Sanity multi-tenancy](https://www.sanity.io/docs/developer-guides/multi-tenancy-implementation) | Studio workspaces can represent different content contexts; member permissions determine actual access. | Workspace visibility is not authorization; do not copy provider project/dataset infrastructure. |
| [Contentful environment access](https://www.contentful.com/developers/docs/tutorials/general/managing-access-to-environments/) | Selected-environment access can coexist with content restrictions; management rights can be much broader. Its documented environment-list API exposes names even for inaccessible environments. | GridStory's requirement is stricter: do not enumerate unauthorized context choices. No environment aliases, provisioning or implicit broad management grants. |
| [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Deny by default and validate each request; UI filtering cannot enforce access. | No new generic authorization engine. Reuse and repair the existing backend boundary. |

Four sources were sufficient for the current architectural shapes. The synthesis above is a proposal input, not a claim of feature equivalence. Further capability design pauses until the confirmed authentication prerequisite is closed.

### Current handoff

The task ledger retains all 136 existing IDs and adds AUTH-001 before CMS-003. Historical completed tasks remain unchanged. Approve AUTH-001's T2 plan, implement and verify it in a separate commit, then resume CMS-003's plan/approval. This checkpoint does not close the security bug or alter historical release-readiness artifacts; it adds a current release blocker that must be resolved before treating the affected build as safe for untrusted access.

Planning verification (Codex, 2026-08-26T16:06:58+05:30): lint/format/ledger checks, the unchanged API build and whitespace audit pass. The documentation audit confirms the five-file fence, 137 tasks with only the described prerequisite/status changes, and 13 resolving local links. Repeated isolated production API controls confirm BUG-0433; full runtime/browser/provider/deployment verification belongs to the approved fix and is not claimed here.
