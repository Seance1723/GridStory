# ADR 0033: Safe configuration inventory before editable settings

- Status: Accepted, implemented and verified.
- Created: 2026-08-29 by Codex.
- Approved: 2026-08-29 by the user through the explicit `proceed` instruction after planning commit `03b96b9`.
- Task: CMS-010. Delivery defects: BUG-0534–BUG-0552.
- Baseline: `ec408a6` on `codex/content-configuration-foundations`.
- Tier: T2 because a new private configuration projection crosses schema, core, API, client, authorization metadata and Studio navigation.

## Ask and delivery boundary

Expose the effective configuration an authorized Studio user needs to understand: active permitted environments/locales, code-owned registered model/routes, and media policy/provider availability. Every returned item must identify its ownership as `code`, `operator` or `editor`, remain read-only in this slice and come from the effective server composition rather than browser assumptions.

CMS-010 stays on the shared `codex/content-configuration-foundations` branch and receives its own verified implementation commit after this separate planning commit is explicitly approved. This proposal does not authorize environment-variable or process configuration dumps, secrets, credentials, provider endpoints/identities, raw topology, mutable settings, DNS/TLS/domain/storage/scanner provisioning, merge, push, deployment or production-readiness claims.

## Inward evidence

| Existing seam | Reuse | Missing behavior / constraint |
|---|---|---|
| `ApiConfig`, `loadConfig` and `buildServer` composition | Validated effective locales/topology and explicit asset storage/rendition/inspection/scanner adapters already enter at the trusted server boundary. | `ApiConfig` also carries host, paths, origins, secrets, identity/provider endpoints and cookie details. It must never be serialized or passed to Studio. Provider availability must be deliberately projected from safe booleans/modes. |
| ADR 0030 `StudioContextProjection` | It already validates raw topology, filters complete Site/Environment/Locale tuples through current policy and returns only permitted choices or the current-only fallback. | No screen summarizes the permitted effective environment/locale catalog. CMS-010 must consume the already filtered choices, not enumerate the trusted topology again. |
| Canonical `ContentSchemaDefinition[]` and CMS-009 catalog | Schema IDs, names, versions, collections, localization and public route patterns are code-owned and strictly validated. | CMS-009 gives detailed model inspection, but Settings has no concise ownership inventory or link back to that authoritative detail. Do not add a second schema registry. |
| `resourceLimits` and `AssetService` composition | Upload/body/part/dimension limits, verified-only delivery, built-in inspection, storage, optional rendition and optional malware scanning are actual runtime boundaries. | Library exposes evidence per asset, not the effective global policy/provider availability. Adapter class names, URLs, credentials, opaque references and raw errors remain private. |
| Finite Studio context/navigation/capability adapters | Every screen/method is explicit, denied reads are absent, private lifetime replacement and one-page rendering are already tested. | There is no Settings group/destination or safe configuration client method. A composite screen flag must not become a new authorization grant. |

No repository, database or persisted settings record is required. The effective configuration exists in code and trusted operator composition; CMS-010 only adds a minimized read projection.

## Outward prior art

Official sources were reviewed on 2026-08-29. They inform information shape and security boundaries only; GridStory does not claim vendor parity.

| Source | Useful pattern | GridStory decision / omission |
|---|---|---|
| [Sanity schema configuration](https://www.sanity.io/docs/studio/schema-types) and [Studio configuration](https://www.sanity.io/docs/studio/configuration) | Content models and workspace behavior are declared in JavaScript/TypeScript configuration. | Mark registered models/routes as code-owned and link to CMS-009. Do not add an unchecked runtime model editor. |
| [Contentful environment access](https://www.contentful.com/developers/docs/tutorials/general/managing-access-to-environments/) | Environment access is distinct from content/media access; its documented list behavior can reveal names beyond usable environments. | GridStory uses the stricter existing policy-filtered choice set and never returns unauthorized topology or environment names. No environment management is added. |
| [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Enforce least privilege, default deny and permission checks on every request. | Reuse exact existing `locales.read`/`schema.read`/`asset.read` decisions per section; a composite Settings flag is presentation only. |
| [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) | Secrets need fine-grained access and must not leak through external mechanisms or output. | The response contract has no generic key/value bag and accepts no `ApiConfig`, environment object, URL or credential field. Tests scan serialized responses for forbidden configuration material. |

## Necessity gate

1. **Traceable:** directly implements CMS-010 and the Settings/Media gaps in the approved administration plan.
2. **Not already solved:** context, schema and asset facts exist separately, but no single safe effective-config inventory or ownership presentation exists. Operations and Library expose different operational/asset detail and cannot substitute for it.
3. **Minimal form:** one strict versioned response, one private GET route/client method and one read-only Settings leaf with three fixed sections. No generic settings engine, key/value store, provider registry or form framework.
4. **Dependency justified:** no new package. Reuse Zod, core services, policy/context projection, universal client and shared Studio SCSS.
5. **Rule of three:** three concrete fixed sections justify one explicit contract/component, not a dynamic configuration plugin system.
6. **Reversible:** no migration, persisted state, provider action or public delivery change. Revert the dedicated CMS-010 implementation commit.

## Decision and sequence

### 1. Define one strict minimized contract

Add `ConfigurationInventory` version 1 with the complete current content scope and three fixed section results. A section is `available` with its exact items or `unavailable` with a fixed authorization reason. Every setting/item carries `ownership: code | operator | editor` and `mutable: false`. Arrays are bounded to 256, identifiers/labels are bounded, objects are strict and there is no arbitrary metadata/value record.

- **Locales and environments** (`locales.read`, operator-owned): current Site/Environment/Locale plus only distinct environment and enabled-locale choices already present in the permission-filtered Studio context for the fixed organization/tenant/workspace/current site. Include safe IDs/labels, environment kind and locale default/required/route-prefix/fallback facts only after intersecting with authorized choices. In current-only mode return exactly the current tuple and label the coverage `current-only`; never infer or enumerate missing topology.
- **Models and routes** (`schema.read`, code-owned): bounded model ID/name/version/collection and optional public route pattern/slug-field, plus localized field names. Do not repeat field contracts, source IR, generated types, deployment data or schema-plan controls; link to CMS-009 for detail.
- **Media policy and providers** (`asset.read`): code-owned supported asset kinds, upload/part/dimension/part-count limits and verified-only rendition/delivery rule; operator-owned availability modes for object storage (`built-in-local` or `configured`), content inspection (`built-in` or `configured`), rendition (`configured` or `unavailable`) and malware scanning (`configured` or `unavailable`). Return no adapter class/name, endpoint, bucket/path, region, credential state, secret state, scanner signature/reference or raw error.

The ownership enum includes `editor` for stable future compatibility, but CMS-010 invents no editor-owned setting. The UI says so rather than fabricating an editable value.

### 2. Build the projection at the framework-neutral core boundary

Add a pure `ConfigurationInventoryService` that receives only already-safe inputs: current scope, permission-filtered Studio choices plus safe environment/locale metadata, canonical schemas, resource policy values and explicit provider availability modes. It never imports `ApiConfig`, reads `process.env`, introspects adapter instances or accesses a repository.

The service validates complete-scope agreement, intersects environment/locale metadata with authorized choice identities before output, deduplicates and deterministically sorts arrays, applies section visibility before projection and parses the final strict schema. Unknown/mismatched context facts fail closed with a generic configuration-unavailable error. Section denial never falls back to another permission.

### 3. Expose one private parameter-free route and client method

Add `GET /api/v1/configuration/inventory`. It accepts no query/body, requires an authenticated Studio request context, sets `Cache-Control: private, no-store` on success and errors, and denies generically if none of `locales.read`, `schema.read` or `asset.read` is permitted.

The API obtains permitted choices from the existing `StudioContextProjection`, derives three independent visibility flags from existing policy decisions and constructs only the safe core input from `contentSchemas`, validated locale/topology metadata, `resourceLimits` and adapter-presence values captured during `buildServer`. It must not spread/serialize `ApiConfig` or expose raw topology. Add `getConfigurationInventory` to the universal client with strict parsing and complete-scope equality validation.

Add finite Studio operation `settings.read`, computed only as the OR of existing `locales.read`, `schema.read` and `asset.read`; it is not a new `GridStoryAction` or route authority. Add screen `settings` from that composite and map only `getConfigurationInventory` to it. The endpoint still enforces every section independently.

### 4. Add one Settings group and read-only Configuration leaf

Add a finite `Settings` navigation group with one `Configuration` destination. Later CMS-012/CMS-017 leaves may join the group only when implemented. The screen lazily requests the inventory when selected, owns isolated loading/error/retry state and renders one responsive component/SCSS partial over existing global typography, button, form, card, spacing, theme and accessibility rules.

Each section states coverage and ownership, renders unavailable truthfully, and exposes no input/select/editor/save/deploy/configure control. Authorized links may navigate to the existing Schemas & taxonomies or Library destinations; they do not grant access or carry configuration values. One current page remains visible, and context/session replacement clears the inventory through the existing keyed private lifetime.

### 5. Keep mutable settings and operational tooling separate

CMS-012 will define versioned public site settings and application consumption. CMS-017 owns safe local Studio preferences. CMS-021 owns site health/help. Operations, Identity providers, Data governance and provider-specific administration retain their existing homes. CMS-010 adds no General/Writing/Reading/Privacy form and does not imply DNS, TLS, hosting, storage, scanning or identity is configured for production.

## Implementation scope fence

Implementation may touch only:

- Contract/core: one new `packages/schema/src/configuration-inventory.ts`, schema exports/tests, one new `packages/core/src/configuration-inventory-service.ts`, core exports/tests.
- API/client: `apps/api/src/server.ts`, `apps/api/src/studio-context.ts`, focused server/context/asset-security tests, `packages/client/src/index.ts` and one focused client test.
- Studio: `apps/studio/src/navigation.ts`, `studio-capabilities.ts`, `App.tsx`, one new `configuration-inventory.tsx`, focused navigation/capability/App/component tests, `styles/studio.scss` and one new `_settings.scss`.
- Browser acceptance: existing context/navigation/accessibility/vertical-slice specs and fixtures only.
- Security/docs/ledgers: `security/threat-model.json`, `docs/security/threat-model.md` only if the minimized configuration-disclosure threat evidence changes; `README.md`, `docs/cms-admin-gap-analysis.md`, one operator/configuration guide if needed, this ADR and mandatory `TASKS.md`, `CHANGELOG.md`, `BUGS.md`.

Any new authorization action, database/repository schema, persisted setting, generic key/value payload, raw environment/config input, provider SDK/identity/endpoint, topology mutation, config editing, secret-state reporting, dependency, public route/cache change or additional application surface requires an ADR amendment and new approval before editing.

## Observable acceptance and verification

- Schema/core tests prove strict parsing, no arbitrary keys, exact ownership/read-only markers, deterministic bounds/order, current-only behavior, authorized-choice intersection, complete-scope mismatch rejection, fixed unavailable sections and exact safe provider modes.
- API tests prove production authentication, no query/body, private/no-store, generic denial when no section is permitted, exact independent policy projection, no unauthorized environment/locale/model/media values, no raw topology, and serialized absence of environment-variable names/values, host/port/database paths/URLs, origins, secrets, cookie/identity/provider endpoints, adapter class names and raw errors.
- Client/Studio tests prove scope validation, explicit fail-closed method mapping, Settings group/one-current-page behavior, Home lazy-load boundary, schema-only/asset-only/locales-only section states, loading/error/retry, ownership labels, truthful current-only coverage, zero form controls and precise links only when their destinations are permitted.
- Browser tests exercise full, schema-only, asset-only and denied profiles; inspect real effective facts; assert no configuration mutation requests; and pass six widths, keyboard, 200% zoom, light/dark, forced-colors where covered and unsuppressed WCAG 2.2 A/AA in Chromium, Firefox and WebKit.
- Full `pnpm check`, security/tenant/readiness/generated checks, strict types, React 18 SSR and production builds pass. PostgreSQL/recovery/external-provider/deployment checks are not claimed because no persistence or provider execution changes.

## Risks and rollback

- **Secret or endpoint disclosure:** accidental reuse of `ApiConfig` could expose credentials, paths or private endpoints. Mitigation: a closed safe-input service, strict output schema, no generic records and serialized forbidden-material tests.
- **Unauthorized topology enumeration:** raw configured environments/locales could reveal names outside access. Mitigation: use only ADR 0030's permission-filtered choices and intersect metadata before output; current-only never expands.
- **Composite-capability overstatement:** a visible Settings leaf could imply access to every section. Mitigation: fixed unavailable sections, independent existing decisions and no denied source projection.
- **Provider-readiness overstatement:** adapter presence is not credential, connectivity, policy or production certification. Mitigation: use only `configured`/`unavailable`/built-in modes, explicit claim text and no “healthy/ready” wording.
- **Ownership confusion:** an inventory item could look editable. Mitigation: item-level ownership plus `mutable: false`, no form controls and links only to existing read/workflow homes.
- **Studio monolith regression:** a new destination touches finite navigation and `App.tsx`. Mitigation: isolate rendering/state and rerun the complete navigation/accessibility/browser matrix.

Rollback is the dedicated CMS-010 implementation commit. No data restoration, provider cleanup or cache invalidation is required. Existing Studio context, schema catalog, Library and advanced operations remain authoritative and unchanged.

## Explicit exclusions

No configuration or secret editor, environment-variable browser, generic settings registry, persisted public site settings, DNS/TLS/domain/hosting provisioning, object-store/scanner/rendition setup, provider credentials/endpoints/health certification, topology create/update/delete, locale/environment management, schema/source/route mutation, asset-policy mutation, identity/security settings, site-health replacement, dependency, migration, merge, push, deployment or release-readiness upgrade.

## Approval gate

Satisfied. Planning commit `03b96b9` preserved the documentation-only checkpoint, and the user's following `proceed` explicitly approved this exact T2 scope. That approval starts CMS-010 only; CMS-011 and later tasks retain their own gates.

## Planning verification

Codex, 2026-08-29:

- `pnpm lint` passes Biome plus package-boundary, ledger, threat/ASVS, tenant-scope and unchanged release-readiness checks across 356 files. `pnpm format:check` passes across 353 files; `pnpm check:ledgers` and `git diff --check` pass.
- A read-only audit verifies 64 local Markdown links across the exact six-file planning fence: `BUGS.md`, `CHANGELOG.md`, `README.md`, `TASKS.md`, `docs/cms-admin-gap-analysis.md` and this ADR. Git status confirms no runtime, test, package, dependency, generated artifact, provider or deployment file changed.
- BUG-0534 is resolved by updating only README's current delivery/style snapshot. The last full repository and browser results remain CMS-009's historical evidence; no runtime, unit, browser, database, recovery, provider or deployment check is represented as fresh verification of this proposal.

Historical handoff: the six planning documents were committed separately as `03b96b9` (`docs(plan): define safe configuration inventory [CMS-010]`) before approval and implementation began.

## Implementation result

Codex, 2026-08-29:

- Added the strict version-1 schema, pure core projection, authenticated private/no-store parameter-free API route, exact-scope universal client method, finite composite capability and one lazy **Settings > Configuration** destination. The response contains only the three approved fixed sections, fixed provider tuple/modes, ownership and `mutable: false`; denied sections do not project source data.
- Studio renders real current/configured coverage, model/route and media-policy/provider facts with isolated loading/error/retry states, no editable controls and links only to already permitted Schemas & taxonomies or Library destinations. Direct `#/settings` does not bootstrap the detailed schema catalog, and context/session replacement owns inventory cleanup.
- API regressions cover production authentication, scope, authorization, query/body rejection, private/no-store caching, current-only non-inference, unauthorized-topology exclusion, fixed provider availability and serialized forbidden material. Schema/core/client/Studio tests cover strictness, deterministic safe projection, exact scope, fail-closed method mapping, independent permission profiles and one-current-page behavior.
- Real browser coverage passes 25/25 in Chromium, 25/25 in Firefox and 25/25 in the final WebKit rerun (75/75 total), including all three single-permission profiles, denied/no-access behavior, the full effective-inventory journey, zero configuration mutation requests, 1440/1280/1024/768/390/320px containment, keyboard/200% zoom, light/dark themes and unsuppressed WCAG 2.2 A/AA. BUG-0552's one retained WebKit draft assertion failure is non-reproducing after six exact passes and the clean full rerun; no timeout, retry or assertion changed.
- Full `pnpm check` passes 716 active tests with 17 existing optional skips (306/306 Studio), strict types, generated contracts, security/ASVS, tenant-scope and release-readiness checks, React 18.3.1 SSR and all production builds. PostgreSQL, recovery, external-provider execution and deployment certification are deliberately not claimed because this slice adds no persistence, provider operation or deployment.
