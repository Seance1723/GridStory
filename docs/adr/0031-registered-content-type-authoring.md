# ADR 0031: Registered content-type authoring

- Status: Implemented and verified on 2026-08-28 after acceptance at 2026-08-28T21:51:08+05:30.
- Created: 2026-08-28T21:38:37+05:30 by Codex.
- Task: CMS-004. Defect input: BUG-0427.
- Baseline: `9bdd891` on `codex/content-configuration-foundations`.

## Ask and delivery boundary

Make the existing Studio authoring lifecycle work for an explicitly selected registered schema instead of assuming `page`, `schemas[0]`, a `gridstory.hero`, and the currently loaded page list. Prove the same existing content engine through a routed component page and a non-component-tree article collection. Pages keep composition, workflow, standalone preview, revisions and publication. Articles use their own schema, fields, workflow and published delivery without acquiring page composition or preview controls.

CMS-004 is the first task on the single `codex/content-configuration-foundations` branch shared by CMS-004 through CMS-010. Each task still receives a separate verified completion commit. This proposal approves no later task, merge, push or deployment.

## Inward evidence

| Existing seam | Reuse | Missing behavior / constraint |
|---|---|---|
| Canonical schema IR and `validateContent` | Stable type/field IDs, field constraints, relations, taxonomies, component trees and the same validation used by the core service. | Studio creation ignores the selected type and does not validate its generated candidate before transport. Do not add a second form/model schema. |
| `ContentService` and `/api/v1/content` | Already create, list, read, revise and publish by `contentType`; repositories and delivery are type-neutral. | The default API registers only the page example and only the page workflow. The default example needs one explicit nonvisual type and matching workflow evidence; no storage change is needed. |
| Studio `App.tsx`, `authoring-controls.tsx` and composition editor | Existing field controls cover the canonical field kinds; composition is already isolated around a `component-tree` field. | Bootstrap, list refresh, entry validation, history, labels and creation are hard-coded to page. Relation choices only see the current page list. The composition surface appears from component permission rather than from the selected schema. |
| ADR 0028 history and ADR 0030 capability/session boundaries | Scope-free hashes, dirty/write guards, stale-request rejection and API-as-authorization-boundary remain mandatory. | Location `type` accepts only `page`; the capability map has no Collections destination or generic-create UI flag. Page-scoped users must not lose their existing Pages behavior. |
| Example page schema | Real component-tree, relation, taxonomy, rich-text, asset and route constraints reproduce production-like creation. | The current factory creates an empty required Hero heading/body. A deterministic baseline run returns two `required` issues at `blocks.0.props.heading` and `blocks.0.props.body`, reproducing BUG-0427 without making a request. |

## Outward prior art

Seven official pages, grouped into four product patterns, were checked on 2026-08-28. This remains below the T2 budget, and the final two product patterns add no new architectural requirement.

| Source | Useful shape | GridStory decision / omission |
|---|---|---|
| [Contentful content types](https://www.contentful.com/developers/docs/references/content-management-api/content-types/) and [entries](https://www.contentful.com/developers/docs/references/content-management-api/entries/) | Entry creation names the content type; field and link-target validations belong to that type; defaults apply at creation and do not replace validation. | Select the registered schema first, derive a candidate from its existing constraints, then run GridStory's canonical validator. Do not copy Contentful APIs or add locale wrappers. |
| [Sanity schema](https://www.sanity.io/docs/apis-and-sdks/schema-types) and [initial value templates](https://www.sanity.io/docs/studio/initial-value-templates-api) | Document types drive editor fields, while initial values are explicitly associated with a schema type. | Keep creation type-bound. Do not add a user-programmable template system or asynchronous initial-value execution. |
| [Payload fields](https://payloadcms.com/docs/fields/overview) and [relationships](https://payloadcms.com/docs/fields/relationship) | A collection's field definitions generate its editor; relationships constrain one or more target collections and filter choices accordingly. | Reuse canonical field controls and query only declared relation targets. Do not add inverse joins, arbitrary filters or a new query language. |
| [Strapi documentation](https://docs.strapi.io/) | Content types define structure and Content Manager performs create/edit/publish over those types. | Add one honest Collections authoring destination, not a second content engine or runtime type builder. |

## Necessity gate

1. **Traceable:** directly implements CMS-004 and repairs open BUG-0427; CMS-005, CMS-006, CMS-009 and later website-management work depend on it.
2. **Not already solved:** the core is generic, but the Studio and default runnable example are page-only at every selection/creation boundary named above.
3. **Minimal form:** one additional registered article fixture, one Collections destination, one type-aware authoring path and one pure initial-candidate helper. A live model builder, template marketplace, collection preference system and bulk/list program are excluded.
4. **Dependency justified:** no new package. Reuse React, the client and canonical validator.
5. **Rule of three:** do not create a plugin/form framework. The helper handles the already-real canonical field union and is exercised by page plus article.
6. **Reversible:** no migration or stored representation changes. Revert the CMS-004 completion commit to return to page-only Studio; existing page records remain compatible.

## Decision and sequence

### 1. Register truthful example evidence first

Add a source-owned `article` schema in `@gridstory/example-kit` with title, slug, rich text, taxonomy and an optional page relation, but no component tree. Register the page and article in the default API and give each an explicit workflow definition. Keep the existing welcome page; add only the minimum seeded article needed to demonstrate the second collection and relation choices. Generated example types must be regenerated through the repository script, not hand-edited.

The server construction boundary will accept an explicit workflow-definition list alongside an explicit schema list so tests and integrators can keep those source-owned contracts aligned. This is configuration injection, not runtime workflow/model creation. Existing defaults remain compatible.

### 2. Add an authorized Collections destination without new permission meanings

Add `collections` to the finite Studio destination contract, API projection, navigation and parity tests. It is available only when the existing generic `content.read` and `schema.read` decisions are both true. Page-scoped callers retain the existing Pages destination and operations. Existing API route authorization remains final.

Add an existing-action `content.create` capability for the generic Collections create control while retaining `pages.create`. The guarded SDK resolves page list/create through the page-specific flags and non-page list/create through the generic flags; unknown methods and missing flags still deny. No role inference, grant expansion or per-type metadata discovery is introduced. A caller with only a type-scoped non-page grant but no generic schema/content projection remains an explicitly unsupported limitation rather than being over-advertised; solving that requires a separately approved bounded per-type capability projection.

### 3. Make location, selection and loading type-aware

Pages remains the stable shortcut for type `page`. Collections shows an explicit selector containing registered non-page schemas and loads one type at a time. Type changes and entry changes use the existing dirty/write/preview guards. Successful selection/list/create commits a scope-free location such as `#/collections?entry=<id>&type=article`; the parser accepts only a bounded identifier, and the loaded entry must match both that type and a currently registered schema. Invalid, denied, stale or wrong-type direct links do not substitute another entry or expose private data.

Bootstrap obtains authorized schemas before choosing the requested/default authoring type, then lists only that type. It must not depend on schema array order. Feature navigation continues to render exactly one current destination and one content workspace.

### 4. Generate and validate creation candidates locally

Extract a pure candidate builder beside the Studio authoring code. It derives only deterministic minimum values from the selected canonical schema and registered component manifests: title/slug text, numeric/boolean/enum minima, empty valid rich text/lists where cardinality permits, declared taxonomy terms, reusable-object/union minima, and the minimum allowed component nodes with valid required props/defaults. Optional unresolved asset/relation values stay absent. It never selects an unrelated Hero or another schema.

Run `validateContent` before `createContent`. If the schema cannot produce a valid candidate—for example a required asset or relation has no safe choice—do not send a request or change history; show the validator's field path and message in an accessible actionable summary. This deliberately avoids a second pre-entry draft lifecycle. The example page and article must both produce valid candidates.

### 5. Keep schema-specific editor features honest

Field controls render from the selected schema. Relation and rich-text reference choices query the distinct declared target content types, merge/deduplicate results and retain current selected labels; they no longer reuse only the current list. Composition, component palette, template/symbol tools and standalone application preview render only when the selected schema has a component-tree field. The article keeps field editing, save, immutable revisions, configured workflow and publish/delivery, but does not pretend to have page composition or application preview. Page behavior and colors remain unchanged.

## Scope fence

Implementation may touch only:

- Canonical/example registration: `packages/example-kit/src/manifests.ts`, generated example output produced by `pnpm schema:generate`, `apps/api/src/defaults.ts`, `apps/api/src/server.ts` and their focused tests.
- Finite capability/navigation/location contracts: `packages/schema/src/studio-context.ts`, `apps/api/src/studio-context.ts`, `packages/client` context tests, `apps/studio/src/studio-capabilities.ts`, `navigation.ts`, `studio-location.ts` and focused tests.
- Authoring slice: `apps/studio/src/App.tsx`, `authoring-controls.tsx`, one new pure content-authoring helper and tests, plus existing `_authoring.scss`, `_shell.scss` and `_responsive.scss` only if the real UI requires contained type controls/states.
- Browser acceptance: existing navigation/accessibility/vertical-slice fixtures and one focused registered-content-type scenario if separation improves clarity.
- Required ledgers/docs: `TASKS.md`, `CHANGELOG.md`, `BUGS.md`, this ADR, `docs/cms-admin-gap-analysis.md`, `README.md` and `docs/troubleshooting.md` where behavior changes.

Any core repository/storage change, canonical field-kind/default contract, API query operator, dependency, migration or additional feature file requires an explicit fence amendment before editing.

## Observable acceptance and verification

- A failing-before regression reproduces BUG-0427's two required Hero-prop issues using the exact old candidate algorithm; the corrected page candidate validates and API creation returns a new draft without changing schema order.
- Page and article each list independently. Create, edit, save and revision history use their exact type/schema; wrong-type and stale direct links fail without fallback or cross-type content.
- Page still completes composition, workflow, popup preview, save, publish and application delivery. Article completes non-component field editing, workflow, save/revision, publish and published delivery while composition/preview are absent or truthfully unavailable.
- Article relation choices issue page-target queries, show permitted page candidates and save a valid `{id, contentType}` reference; undeclared target types and denied calls are not exposed.
- Invalid initial candidates show at least the field path and canonical validation message, make zero create requests, preserve the prior entry/draft/history and remain keyboard/screen-reader readable.
- Page-scoped, read-only, generic editor and no-access capability regressions pass. All destinations—including new Collections—retain one-current-item semantics, direct history, empty/loading/error/denied states and six-width containment.
- Focused schema/example/API/client/Studio tests, generated-contract check, security/tenant checks, full `pnpm check`, and Chromium/Firefox/WebKit navigation/accessibility/registered-content/vertical-slice scenarios pass. Manual desktop/mobile smoke covers page/article switching, invalid dirty cancellation, relation choice, creation, save, workflow/publication and preview availability. Existing optional database/recovery skips are reported, never converted into passing evidence.

## Risks and rollback

- **State contamination:** a type switch could retain another type's draft, preview, relation choices or history. Mitigation: reuse the existing serialized navigation/dirty/preview guards, abort old reads and validate returned type before commit.
- **Partial workflow configuration:** registering a schema without a matching workflow can make authoring unavailable. Mitigation: explicit injected/default workflow definitions, truthful unavailable state and page/article contract tests; do not auto-invent operator workflows.
- **Invalid generated defaults:** nested/component constraints may be unsatisfiable. Mitigation: canonical validation before transport and actionable issues; no API mutation on failure.
- **Authorization overstatement:** generic Collections visibility must not imply per-type grants. Mitigation: existing generic decisions gate the destination, page-specific behavior remains, every API request reauthorizes and the type-scoped limitation is documented.
- **Regression breadth:** `App.tsx` is load-bearing. Mitigation: pure helper tests, focused App/history/capability tests, full repository gate and all three browser engines before completion.

Rollback is the single eventual CMS-004 implementation commit. It changes no persisted schema format or database migration; content already created under registered schemas remains readable by the unchanged core/API even if the Studio returns to page-only navigation.

## Explicit exclusions

No runtime schema/taxonomy editing, field-kind/default IR expansion, saved views/filtering/pagination (CMS-005), Home dashboard (CMS-006), Media/Design/Schema/Settings work (CMS-007–010), bulk actions, delete/archive, page-to-article preview renderer, arbitrary template execution, new package, database migration, provider certification, merge, push or deployment.

## Approval gate

This T2 proposal was explicitly approved by the user with `proceed` on 2026-08-28T21:51:08+05:30 after the separate planning commit. Approval starts CMS-004 only; CMS-005 through CMS-010 retain their own task boundaries and T2 gates where applicable.

## Planning verification

Codex, 2026-08-28: the read-only Node reproduction executed the exact current `createPage` candidate rules against the built example schema/manifests and canonical validator; it returned only the expected missing required Hero heading/body issues and made no request. `pnpm lint`, `pnpm format:check`, `node scripts/check-ledgers.mjs`, `git diff --check` and a five-file local Markdown-link audit pass. The fence contains only `TASKS.md`, `CHANGELOG.md`, `BUGS.md`, `docs/cms-admin-gap-analysis.md` and this ADR. No unit, integration, browser, provider, database or deployment result is claimed for this documentation-only plan; the fully verified `9bdd891` runtime baseline remains unchanged.

## Implementation verification

Codex, 2026-08-28: the default API now registers explicit Page and Article schemas/workflows and seeds each independently. Studio exposes an authorized Collections route, carries bounded registered type through loading/history, derives and canonically validates initial candidates, loads declared relation targets, and renders composition/standalone preview only for component-tree schemas. Page behavior remains intact; Article field editing, relation selection, immutable revision, workflow, publication and delivery are covered across focused Studio/API tests and the real-browser vertical slices.

The final `pnpm check` passes lint, format, boundaries, ledgers, security, tenant scope, readiness self-tests, generated schema/interoperability checks, strict types, React 18.3.1 SSR, production builds and 646 active tests with 17 existing optional skips. The exact candidate then passes **54/54** browser scenarios: 18 Chromium, 18 Firefox and 18 WebKit, each on fresh memory-backed services. Coverage includes all 20 destinations, one-current-item semantics, page/article switching and creation, declared page relations, page preview/publish/delivery, article revision behavior without preview/composition, WCAG scans, light/dark, keyboard/200% zoom and 1440/1280/1024/768/390/320px containment.

BUG-0427 and verification defects BUG-0469–BUG-0476 are resolved with their failing evidence retained in `BUGS.md`. No database/provider conformance, production deployment, merge, push or release-readiness upgrade is claimed. Rollback remains the single CMS-004 implementation commit; no persisted schema format changed.
