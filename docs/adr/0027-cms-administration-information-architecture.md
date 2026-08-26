# ADR 0027: Task-oriented administration over existing CMS boundaries

- Status: Proposed — no application implementation approved by this record.
- Date: 2026-08-26.
- Author: Codex.
- Planning task: GOV-006. Proposed delivery: CMS-001 through CMS-031.
- Implementation checkpoint: 2026-08-26, CMS-001 only authorized by the user's instruction to proceed. The broader T2/T3 program remains proposed. Reuse current loaders/selection with a finite typed leaf/group map, native `aria-expanded`/`aria-controls` disclosure buttons and nested lists; keep all existing leaves reachable in compact mode. This adapts the [WAI disclosure navigation pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/) without copying its example implementation or adding menu-widget semantics, URL routing or dependencies.
- CMS-001 delivery evidence: 37 Studio tests, the complete repository gate, final production/E2E builds and 21 browser scenarios pass; the in-app walkthrough additionally verified compact/mobile behavior and fixed BUG-0418/0419. This checkpoint accepts only that reversible presentation slice, not the remaining proposed program or CMS-002's URL strategy.

## Context

The user supplied a cross-platform CMS menu reference and requested feasibility, inspection of the current tool, a gap analysis and an updated task plan before implementing one task at a time. The reference enumerates 13 common jobs despite describing them as 11. It mixes administration navigation, visitor navigation, content capabilities, optional business domains and platform-specific code editors.

GridStory has 19 exclusive Studio destinations backed by substantial bounded content/governance services. Studio still lists only `page` content, uses local destination state instead of URL locations, exposes analytics inside Operations and lacks a visitor-menu/settings product surface. Some apparent features are serialization or adapter contracts rather than complete end-user experiences: schema visual modeling, plugin runtimes and mutable taxonomy/design administration are important examples.

The [gap analysis](../cms-admin-gap-analysis.md) inventories exact source seams and maps every existing destination and reference job. It is the detailed companion to this decision. Existing ADRs 0001, 0002, 0003, 0004, 0005, 0013, 0019 and 0026 retain their boundaries.

## Options and prior art

| Approach | Evidence / stack fit | Cost | Deliberately skipped |
|---|---|---|---|
| Copy WordPress's admin and runtime feature set | Familiar vocabulary, but PHP themes, code editors, plugin execution, public comments and account management have different trust/data ownership. | High; substantial incompatible new domains. | Runtime code editing, automatic theme/plugin installation and public identity reuse. |
| Group jobs into content, structure/design, administration and tools | [Drupal's administrative overview](https://www.drupal.org/docs/user_guide/en/config-overview.html) separates these jobs; fits existing services. | Moderate UI/IA work; preserves core. | Copying Drupal internals or hiding all advanced features from their authorized operators. |
| Type-aware content collections and distinct visitor menus | [Webflow collections](https://help.webflow.com/hc/en-us/articles/33961289539347-Collection-items-overview) and [Shopify menus](https://help.shopify.com/en/manual/online-store/menus-and-links) show these separate product jobs. | UI reuse for collections; new validated menu lifecycle/delivery. | Designer/hosting takeover and native commerce. |
| Reuse the 19 current panels unchanged | Already tested and the cheapest baseline. | Zero feature cost; high discoverability/gap cost. | Insufficient alone: no visitor menus/settings/SEO output appears by relabeling. |
| Introduce a new generic admin/plugin/router framework now | Could support arbitrary extension screens but exceeds the current task and existing sandbox support. | High dependency, migration and security cost. | Rejected for this program; a finite registry is enough for the current 19 screens. |

The [WordPress administration reference](https://wordpress.org/documentation/article/administration-screens/) informs familiar task labels, not a requirement to reproduce unsafe source editors. Exact vendor menu names are not GridStory contracts.

## Proposed decision

1. Organize existing screens first, preserve all 19 canonical homes and use one active leaf/one visible page. Do not render unimplemented destinations. Keep current shared SCSS, colors and header-only standalone preview.
2. Add stable validated locations/history separately, followed by a minimized server-derived capability/scope projection. Retain server authorization regardless of menu visibility. Dirty-state and preview cleanup apply to location and scope changes.
3. Reuse the generic content lifecycle for type-aware collections. Keep Pages as a shortcut, not the only supported type or a second engine.
4. Add visitor menus as bounded validated versioned content with published-only resolution; keep admin navigation and application rendering separate. Review the exact contract in CMS-011 before implementation.
5. Separate publishable site settings from operational configuration and secrets. Review fixed identity/cardinality, allowed fields and lifecycle in CMS-012 before implementation.
6. Expose code-owned schema, taxonomy and design definitions honestly. Start with read views and reviewed proposals. Do not turn lifecycle deployment records into an unreviewed runtime schema registry. Any runtime-authority change requires CMS-027 and a new/updated approved ADR.
7. Add full SEO delivery, redirect lifecycle and content retirement as explicit missing domain work, not cosmetic screens. Bounded analytics remains bounded, without new visitor/revenue claims.
8. Keep workforce identity, editorial collaboration, visitor identities, CRM and commerce as distinct domains. Commerce, marketing/forms/CRM and public comments/memberships remain optional owner/provider decisions (CMS-028/029/030).
9. Decline raw theme/plugin/source editors and browser-triggered production restore/self-update in this program. Existing code review, deployment, recovery and plugin isolation boundaries already supply the safe ownership path.

## Necessity gate

1. **Traceable:** the user explicitly requested reference-to-repository feasibility and planned gap closure. Each category/submenu maps to an existing capability, queued task or explicit optional/rejected disposition.
2. **Not already solved:** `App.tsx` is page-filtered and local-state navigated; menu/settings services are absent; model/taxonomy/design definitions are code-owned; plugin runtime and reports have documented limits. Existing core is reused rather than rewritten.
3. **Minimal form:** documentation now, then preserve/reorganize real screens, expose existing services, and add only identified website-management gaps. No monolithic competitor clone, new CMS engine or business suite.
4. **Dependency justified:** this planning change adds none. A finite navigation registry needs no framework. Any future router, provider or parser dependency needs its own evidence/security review before approval.
5. **Rule of three:** 19 real destinations justify a single finite navigation representation; repeated content types justify existing schema-driven authoring. No generic extension/configuration framework is introduced on the strength of hypothetical plugins.
6. **Reversible:** this change is documentation-only. Navigation/UI slices can be reverted independently. New domain tasks must record versioning, migration and rollback before implementation; destructive customer-data actions are separately T3 and not authorized by this ADR.

## Approval, verification and revisit triggers

GOV-006 can complete when reference coverage, source evidence, task dependencies, scope fences and documentation verification are recorded. It does not accept this ADR on the user's behalf or start the queued application work. CMS-001 is a contained T1 reorganization; each T2/T3 task needs its implementation plan and go-ahead first.

Each future slice must retain the original 19 capability paths and expand the existing all-destination visual/accessibility and published-delivery regressions. Scope/public-cache/preview/auth failures block delivery. All new persisted state needs audit, concurrency, import/export and recovery decisions proportional to its risk.

Revisit the finite registry if a real approved sandboxed extension needs to contribute navigation. Revisit source-owned models only after CMS-027 establishes why proposal/export is insufficient. Revisit native business domains only after explicit owner demand and a provider/build comparison. This program does not clear beta/RC/GA readiness criteria or authorize deployments.
