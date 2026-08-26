# ADR 0030: Authorized Studio capabilities and safe scope selection

- Status: Accepted for sequential delivery on 2026-08-26; CMS-032 is implemented but blocked by the required WebKit gate (BUG-0441). Its additional three-file Studio/test repair amendment below is proposed, not approved. CMS-033/034 have not started. Earlier proposal/planning and in-progress evidence remains historical.
- Created: 2026-08-26T16:58:44+05:30 by Codex.
- Parent: CMS-003. Delivery units: CMS-032, CMS-033, CMS-034, in that order.
- Baseline: `5882398` on `main`; CMS-001, CMS-002 and AUTH-001 are implemented and verified.
- Compatibility defect: BUG-0435, assigned to CMS-034 within CMS-003. BUG-0427 remains CMS-004.

## Ask, assumptions and delivery boundary

Make the existing Studio show only permitted screens/actions and let an authenticated user select an authorized site, environment and locale without carrying drafts, results or preview credentials across scopes. Preserve all 19 destinations and their features for authorized users, the existing theme, global SCSS controls and the framework-neutral control plane.

Organization and tenant stay bound to the existing session; workspace stays fixed to the current authorized request context. This is not an organization/tenant/workspace switcher or a topology editor. Selection is tab-local, is never URL authority, and resets to deployment-configured initial scope on reload. No new dependency, database migration, authorization action, identity protocol or permission grant is proposed.

CMS-003 is too broad for one small delivery: the API contract, 19-screen bootstrap and scope lifetime must each be independently verifiable. Retain its task ID as an aggregate and add three stable child IDs rather than renumbering the queue. Approval of this ADR permits those bounded units in sequence, one task/verified commit at a time; it does not approve CMS-004 or later product work. CMS-003 stays planned until implementation starts and completes only after all three units pass.

## Inward evidence and reuse

| Existing seam | Reuse | Missing behavior / constraint |
|---|---|---|
| [AuthorizationPolicy](../../packages/core/src/authorization.ts) | Deny-by-default decisions using scoped assignments/grants and action/resource pairs. | A content-type grant does not pass a check whose resource lacks `contentType`. Do not flatten actions or infer permissions from browser role names. |
| [ScopeRegistry](../../packages/core/src/scope-registry.ts) and [context types](../../packages/schema/src/context.ts) | Complete six-part scope, topology ownership, active parent and enabled locale checks. | Not wired into Studio discovery; environment status is not a global write lock. Reuse resolution for the selector without changing all management-route semantics. |
| [API context and preview routes](../../apps/api/src/server.ts) | Existing policy checks and preview service validation. | Legacy `GET /api/v1/context` exposes the whole principal and requires platform content read. Preview DELETE treats every bearer as a preview credential (BUG-0435). |
| [Identity edge](../../apps/api/src/identity-routes.ts) | AUTH-001's matched-route/method dispatch, tenant-bound workforce sessions and existing identity-admin gate. | New projection must use this edge and the same server-side admin predicate, not introduce a parallel role mapping. |
| [Universal client](../../packages/client/src/index.ts) | Complete headers, cookie transport, custom fetch, explicit development identity option, AbortSignals. | No minimized capability call or immutable scope clone; transport settings must survive a clone. |
| [Studio](../../apps/studio/src/App.tsx) and [navigation](../../apps/studio/src/navigation.ts) | Finite destinations, feature loaders, entry/history guards and preview generation checks. | Bootstrap requires content/schema/components/workflows together; entry loading requires history/workflow. Many feature drafts and mutations are outside the entry-only dirty/write counters. |

The new projection does not repair or broaden existing by-ID authorization to make type-restricted users appear fully supported. It must expose the actual limitation. Page lists may be permitted while editor metadata, by-ID reads or workflow controls are not. Registered non-page authoring remains CMS-004.

## Prior art and necessity

Primary sources rechecked on 2026-08-26; five sources, below the T2 budget. The proposed application of their patterns is GridStory's design judgment, not a claim of product equivalence.

| Approach / source | Useful pattern | Decision / deliberately omitted |
|---|---|---|
| Existing GridStory policy plus a finite read projection | Reuses the backend's real resource checks. | Selected; no second policy engine or generic expression interpreter. |
| [Sanity roles](https://www.sanity.io/docs/user-guides/roles) | Content access and ancillary Studio permissions can differ; grants are additive. | Load authorized panels independently; do not copy GROQ, billing tiers or assume content access allows every bootstrap request. |
| [Sanity multi-tenancy](https://www.sanity.io/docs/developer-guides/multi-tenancy-implementation) | Configured workspaces provide distinct editing contexts. | Use a bounded selector; omit dataset provisioning and tenant switching. |
| [Contentful environment access](https://www.contentful.com/developers/docs/tutorials/general/managing-access-to-environments/) | Selected-environment access is distinct from management rights; its list endpoint can reveal inaccessible environments. | GridStory requires stricter filtering: no unauthorized names, counts or disabled options. No aliases or environment CRUD. |
| [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Deny by default and check every request. | Projection is UI advice, never an authorization credential or replacement for route checks. |
| [React state reset](https://react.dev/learn/preserving-and-resetting-state) | A changed component key creates a new state lifetime. | Use a scoped Studio session boundary after accepted transitions; key changes alone do not cancel requests or revoke previews. |
| Do nothing / frontend role-name filtering | Smallest immediate edit. | Rejected: cannot meet CMS-003's scoped permission, non-enumeration or stale-data requirements. |

Necessity gate: (1) directly implements CMS-003 and BUG-0435; (2) the seams above exist but lack this projection/lifetime; (3) limit to existing screens, fixed workspace and configured choices; (4) no dependency; (5) one finite mapping covers 19 real screens, not a new framework/configuration engine; (6) additive contracts and sequential commits can be reverted without data migration. A global authorization rewrite, mutable topology, persistent browser draft cache and new routing/state library are rejected for this slice. Revisit only for a separately evidenced task.

## CMS-032: Minimized private contract and client

Add `GET /api/v1/studio/context`, authenticated through the existing production session hook (or explicitly configured development mode). Leave legacy `GET /api/v1/context` and `getRequestContext()` compatible. Preview credentials cannot call the new endpoint.

The version-1 response contains only:

- Current complete scope and the caller's own principal ID for in-memory identity-change detection; no principal object, roles, assignments, grants, attributes, authentication secrets or policy reasons.
- A finite screen-availability map and finite operation booleans needed by existing Studio controls. Missing/unknown operations deny. A screen read never implies its write/manage/execute controls. Entry existence, revision, workflow state and runtime readiness remain separate checks.
- Selector mode (`configured` or `current-only`) and permitted complete-scope choices with bounded display labels. No raw topology, rejected choices, hidden counts, unrelated type configuration or infrastructure values.

Use `Cache-Control: private, no-store` on successful and error responses; never place the result in published caches, browser storage or public discovery. Each request recomputes using the authenticated principal. Invalid/revoked sessions return 401, syntactically invalid input returns 400, and configured invalid/outside-anchor scopes return a generic 403 without naming hidden configuration. A valid current scope with no permitted screen returns a truthful empty-capability response; same-anchor permitted alternatives may still be returned. Network/configuration errors must not synthesize admin capability or reuse another caller's projection.

### Configured selector catalog

Add optional trusted `studioTopology: PlatformTopology` to API construction and `GRIDSTORY_STUDIO_TOPOLOGY_JSON` to startup configuration. This is deployment-owned discovery configuration, not a new permission store. Validate at startup: strict structure, bounded IDs/labels, no duplicate IDs within each topology entity array, valid ownership, locale consistency with the API's existing locale registry, at most 256 entries per array and at most 256 selectable complete tuples. Reject invalid/oversized configuration without logging its raw value.

Reuse ScopeRegistry for hierarchy resolution. Only active parent chains, active environments and enabled configured locales are selectable. A locked environment is excluded from selection; this is not a claim that every existing API write enforces a global environment lock. Filter first to the verified organization/tenant and fixed workspace, then through effective capabilities; return only tuples with at least one usable existing Studio screen. Labels are exposed only after that filtering. Never construct choices from content rows, browser-supplied lists or a cross-tenant query.

Without topology configuration, return the current authorized context only, with scope controls read-only and a factual configuration notice. Do not fabricate alternative scopes in production or development. Existing current-scope API behavior is preserved; this catalog does not confer new grants or become an unapproved access check on every old route. Deployment startup values for Studio's organization/workspace/site/environment/locale will be wired when CMS-034 adds the controls.

### Finite screen/read mapping

The implementation must test route/projection parity against actual route assertions, not merely compare the projection with itself. Use the existing server identity-admin predicate for identity; all other decisions use AuthorizationPolicy. This table identifies the present read families; operation mappings must retain the resource kind and content type used by the corresponding route.

| Existing destination | Read basis / independent dependencies |
|---|---|
| pages | Page-filtered content list; by-ID content, schema and component/design reads separately gate the editor. History, workflow, collaboration, assets and preview are independently optional. |
| workflows | Workflow definition read; designer writes and action-execution reads are distinct. |
| releases | Release read; management, schedule, execution and rollback are distinct. |
| search | Search read; indexing/manage and entry-specific reads are distinct. |
| operations | Platform operations read, including the current analytics report route; controls keep manage/run/replay distinctions. |
| identity | Existing authenticated server-side identity administration predicate. |
| data-governance | Governance read; manage and execute separately. |
| migrations | Migration read; manage and execute separately. |
| marketplace | Marketplace read; manage/review/plugin operations separately. |
| targeting | Personalization read; manage and preview separately. |
| experiments | Experiment read; manage/metrics/promote separately. |
| ai-gateway | AI read; manage/execute/review and authorized entry retrieval separately. |
| knowledge | Knowledge graph and agent reads independently; entry/plan/review/execute dependencies do not become blanket access. |
| quality | Existing content-quality read; assessing unsaved values uses its separate draft-update gate and requires an available entry. |
| federation | Federation read; manage/consume/sync separately. |
| fleet | Fleet read; manage and check separately. |
| regions | Regional read; manage and failover separately. |
| components | Component/governance reads; content migration uses its existing draft-update check. |
| assets | Asset read; upload/create/update separately. |

For example, a page-typed list/create check must not imply an untyped by-ID read, preview or schema read. Do not expose other registered content-type names to a user who lacks the relevant metadata permission. No change to existing content-type authorization semantics is permitted by this ADR.

Add typed `getStudioContext({ signal? })` and `withStudioScope({ siteId, environmentId, locale })` client methods. The clone preserves base URL, fixed organization/tenant/workspace, actor/development mode and custom fetch/credential behavior; the original stays immutable. The method is not proof of authorization: validate a candidate through the endpoint before Studio commits it. Do not add cross-tenant clone parameters or shared mutable client state.

## CMS-033: Permission-aware Studio

Load the minimized contract before any private feature data. Fail closed for unsupported/malformed/failed capability responses, including when pointed at an older API; do not fall back to role names or the legacy whole-principal endpoint. Keep a retry/connection or sign-in-required state without privileged cached output.

Filter navigation and shortcuts from the finite server map. Preserve all 19 destinations for a fully authorized principal. A denied deep link shows an access-unavailable state and safe permitted navigation without firing that destination's loaders. The fallback destination is the first permitted existing leaf, not hard-coded Pages; no-access and operations-only users must render a usable shell without content/schema/workflow requests. Separate permitted empty data from denied, loading and failed data.

Gate every existing operation control using its specific boolean plus current readiness rules. Missing permission means no invocation; read-only state must remain visibly read-only. Keep entry/history behavior, but make history/workflow/design/asset/collaboration requests optional according to permission. Bundled default schemas/manifests must not masquerade as authorized server configuration. On observed 401, clear private state and preview immediately; on 403, remove affected cached output and refresh capabilities before further use. Revalidate on tab focus and before accepting a context transition. Server checks still handle changes between requests; no real-time revocation guarantee is claimed.

A refreshed projection that removes a capability must evict the now-denied panel data even without an intervening 403. A changed principal must replace the entire private session lifetime. A transient refresh/network failure suspends private rendering/actions pending retry without silently discarding same-session unsaved drafts; it must not treat the last projection as fresh authorization. This differs from confirmed session loss, which clears private state immediately.

## CMS-034: Scope lifetime and preview compatibility

Add site/environment/locale controls to the existing header using shared form/CTA and responsive SCSS. A staged choice must resolve to a complete tuple from the allowed list; never invent a cross-product. Keep the committed scope visible until the entire transition succeeds. No popup opens automatically.

1. Serialize transition requests. Block while any management mutation is in flight, including feature forms/uploads, not just entry saves. Do not abort a write and pretend it rolled back; uncertain outcomes require reconciliation before switching.
2. Detect unsaved entry and feature-form changes. Confirm discard; cancellation keeps all data, active scope, history and preview intact. Do not silently throw away workflow, policy JSON or other management drafts.
3. Clone the client and freshly validate the selected tuple. Cancelled/late candidate responses cannot become current. A denied/offline candidate leaves the old authorized scope intact with an actionable error.
4. Dispose transport, close the old popup and confirm old preview revocation using the old client/grant before committing a voluntary switch. If cleanup cannot be confirmed, keep the old scope and report/retry cleanup; an expired/already-revoked grant may count as terminal only with verified service semantics. Revoke late-created grants as well. Forced session loss instead clears privileged state immediately and reports any unsuccessful cleanup; it must never retain data pending a confirmation dialog.
5. Abort old reads and advance the request/identity generation. Commit the candidate in a keyed context-session boundary so entry, undo, selection, feature results, drafts, notices, timers/subscriptions and callbacks cannot carry over. Only harmless theme/navigation-disclosure preferences may persist. A remount is not a substitute for explicit cleanup or write settlement.
6. Replace the current address with a permitted destination without the previous entry. Retain CMS-002's scope-free URL contract: Back/Forward resolves entries within the current scope and cannot restore old scope authority. Reload returns deployment-configured initial scope; never persist credentials/drafts or scope authority in history/local storage.

Fix BUG-0435 only here: authenticated workforce bearer revocation must take the same scope-checked management path as cookie revocation; real preview credentials retain the existing self-revoke verifier and exact method/route exemption. Unknown/malformed bearer values must not open a management fallback. Preserve AUTH-001's fail-closed request context and all negative regressions. No preview-signing, IdP or grant-lifetime redesign is included.

## Sequence and exact file fences

Planning checkpoint only: `TASKS.md`, `CHANGELOG.md`, `BUGS.md`, `docs/cms-admin-gap-analysis.md`, this ADR. No application source is changed before approval.

Every delivery unit includes the same five documents plus `README.md` and `docs/troubleshooting.md` for behavior/setup evidence. Runtime/test fences are:

| Unit | Exact permitted files |
|---|---|
| CMS-032 | `packages/schema/src/studio-context.ts` (new), `packages/schema/src/index.ts`, `packages/schema/test/studio-context.test.ts` (new); `apps/api/src/studio-context.ts` (new), `apps/api/src/server.ts`, `apps/api/src/identity-routes.ts` (reuse/export existing admin predicate only), `apps/api/src/config.ts`, `apps/api/src/index.ts`, `apps/api/test/studio-context.test.ts` (new), `apps/api/test/config.test.ts`, `apps/api/test/identity-server.test.ts`; `packages/client/src/index.ts`, `packages/client/test/client.test.ts`, `packages/client/test/studio-context.test.ts` (new); `.env.example`. |
| CMS-033 | `apps/studio/src/App.tsx`, `apps/studio/src/navigation.ts`, `apps/studio/src/studio-capabilities.ts` (new), `apps/studio/src/studio-session.tsx` (new), `apps/studio/test/App.test.tsx`, `apps/studio/test/navigation.test.ts`, `apps/studio/test/studio-capabilities.test.ts` (new), `apps/studio/test/studio-session.test.tsx` (new); `tests/e2e/studio-context.spec.ts` (new), `tests/e2e/studio-navigation.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/vertical-slice.spec.ts`. |
| CMS-034 | `apps/studio/src/App.tsx`, `apps/studio/src/studio-session.tsx`, `apps/studio/src/studio-context-controls.tsx` (new), `apps/studio/src/studio-history.ts`, `apps/studio/src/styles/_shell.scss`, `apps/studio/src/styles/_responsive.scss`, `apps/studio/test/App.test.tsx`, `apps/studio/test/studio-session.test.tsx`, `apps/studio/test/studio-history.test.ts`, `apps/studio/test/studio-context-controls.test.tsx` (new); `apps/api/src/server.ts` (preview DELETE dispatch only), `apps/api/test/identity-server.test.ts`, `apps/api/test/server.test.ts`, `packages/client/test/preview.test.ts`; `tests/e2e/studio-context.spec.ts`, `tests/e2e/studio-navigation.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/vertical-slice.spec.ts`; `.env.example`. |

CMS-032 comes first because Studio must consume a verified server contract, not invent it. CMS-033 next separates authorized bootstrap/denial from scope lifetime. CMS-034 then switches an already permission-aware session and fixes its preview transport dependency. Extract only the session boundary needed for these units; do not reorganize all feature implementations. Amend this fence before additional files; a new permission meaning, migration, dependency or identity boundary requires renewed approval.

## Observable acceptance and verification

| Unit | Required observations before completion |
|---|---|
| CMS-032 | Real production cookie and workforce-bearer sessions return the minimized no-store contract; missing/invalid/revoked sessions and every preview token fail with 401. Operations-only, read-only, page-type-limited, scoped-role/grant and no-access fixtures match actual route gates. Cross-tenant requests fail closed; unauthorized topology names/counts/configuration never appear. Invalid/duplicate/oversized topology fails startup, absent topology stays current-only, and permitted tuples never imply broader API access. Client clone retains transport/anchor and leaves original headers unchanged. Legacy context/session/preview behavior remains compatible. |
| CMS-033 | All 19 screens remain reachable for admin; restricted users trigger no denied bootstrap/feature calls. Operations-only works without content metadata; a viewer cannot invoke writes; type-limited behavior is honest. Denied direct/history/shortcut navigation cannot reveal stale data. Delayed responses, 401/403, retries, principal changes, focus refresh and StrictMode remain safe. Same-entry navigation preserves legitimate dirty state/preview. |
| CMS-034 | Desktop/mobile selector uses only permitted complete tuples. Cancel preserves state/preview/address; every active write blocks switching; denied/offline targets do not commit. Dirty entry and representative feature-form changes prompt correctly. Successful switch revokes old preview, clears old data, ignores delayed reads/grants and cannot write via old callbacks. Scope-free history/reload obey the contract. Cookie and workforce-bearer scoped revocation pass; wrong-scope/unknown bearer and AUTH-001 regressions deny; legitimate preview self-revocation still works. |

For each implementation unit: run focused positive/negative/regression suites, `pnpm security:check`, full `pnpm check`, and the unchanged plus relevant added `pnpm test:e2e` scenarios across Chromium/Firefox/WebKit. Restore normal Studio/example production builds after E2E. Do not weaken assertions or add skips to pass. Use isolated test data for current-scope/alternate-scope fixtures; no real tenant change or external deployment. UI units also require actual manual keyboard/dirty/preview/switch smoke and the all-destination responsive/containment checks at the existing six widths, light/dark theme and zoom. Record exactly what was run; pending tests are not evidence.

No database migration, external IdP/provider certification, production rollout or release-readiness upgrade is included. Existing optional PostgreSQL/recovery skips must remain disclosed. Log every new defect before fixing it; BUG-0427 is not permission to broaden into creation defaults.

## Risks and rollback

Highest risks are projection/route drift (a shown action still denies), ancillary-read coupling (authorized screens fail to boot), old-scope callbacks/forms (data appears or writes in the wrong scope), preview revocation failure and overly broad topology enumeration. The negative fixtures above are the early gates; stop rather than weaken authorization or hide a failed test.

Before release, revert only this feature's verified implementation commits in reverse dependency order, preserving AUTH-001 (`5882398`) and unrelated user work. This is additive/no migration, so no data restoration is required. Do not fall back to development identity, disable server checks or treat a UI downgrade as security enforcement. If independently shipped clients consume the endpoint, coordinate a compatible deprecation instead of abruptly removing their contract. No rollback is being executed by this planning checkpoint.

## Approval and handoff

Approved/start: Codex, 2026-08-26T17:11:33+05:30. The user replied `proceed to next` to the explicit approval question after planning commit `6e6ea95`, accepting this bounded sequence. Start CMS-032 only; retain the exact per-unit fences and one verified completion commit per task. The aggregate stays unchecked until all children are complete, with only the current leaf marked in progress. No push/deployment or CMS-004 work is authorized.

CMS-032 implementation notes: the response uses `version`, `scope`, `principalId`, `capabilities.screens`, `capabilities.operations` and `selection.{mode,choices}`. Operation flags are explicit existing policy preconditions; they do not claim every workflow/step-up/provider/entry condition is satisfied. `pages.list`/`pages.create` preserve the page type while by-ID content and preview checks remain untyped. The new client rejects unsupported, malformed and mismatched-scope responses; no fallback or persistent cache is added. The trusted catalog is validated before database acquisition and returns detached minimized choices. No core permission engine, identity classifier, preview dispatch or Studio runtime file changed.

Awaiting go-ahead before implementation. The single next action is approval of this ADR, then CMS-032 alone. CMS-003/032/033/034 remain unchecked; no feature or defect is marked complete by a proposed design. Commit this documentation checkpoint separately with `[CMS-003]`; do not push or deploy.

## Planning verification

Codex, 2026-08-26T17:05:12+05:30:

- `pnpm check` passed: lint, formatting, package boundaries, project ledgers, security/tenant models, unchanged release-readiness validation, generated-contract checks, strict type checks, all workspace tests and production builds, including React 18.3.1 SSR. Test totals: schema 80, client 30, core 163, React 5, API 83, Studio 78 = 439 passed; 17 existing optional database/recovery skips. No test or source file changed and no assertion/skip was relaxed.
- `node scripts/check-ledgers.mjs` and `git diff --check` passed again. Read-only PowerShell/Git checks confirmed the five-file planning fence, all 137 prior task IDs/statuses, three new planned IDs (140 total), all 438 bug IDs, 24 resolving local Markdown links, all 19 screen rows, 25 existing implementation-fence paths and required proposal sections. The first ad-hoc fence command incorrectly nested its two path arrays and was corrected/rerun; this was an audit-command error, not a repository defect or source edit.
- No browser/manual UI, new capability endpoint, scope switch, live session/provider, PostgreSQL or deployment check was performed for this documentation-only change. Prior AUTH-001 browser evidence is historical; it is not fresh verification of this proposal. Those implementation gates remain required above.

Handoff: `main`; commit only the five planning documents as `docs(plan): define authorized Studio context [CMS-003]`, with the resulting SHA reported to the user. The single next action is explicit ADR 0030 approval, then CMS-032. No implementation task is marked complete and no push/deployment is included.

## CMS-032 implementation verification

Codex, 2026-08-26; implementation baseline `6e6ea95`. Browser verification failed; this evidence is a blocked WIP checkpoint, not a completion record.

- `pnpm build:packages`, focused schema/client context tests (four each), and the first focused API/config/identity run (29 tests) passed. The first API build then failed with TS2379/TS2345/TS2322, logged as BUG-0439 before correction: parsed optional locale fields allowed explicit `undefined` while the canonical exact-optional type requires omission. The validator now normalizes all four optional fields. The added regression checks the pre-normalization parser control retains those properties while the canonical result omits them; no type relaxation or locale/permission change was made. `pnpm --filter @gridstory/api build` then passed.
- The first `pnpm lint` reported 18 non-null assertion warnings in new test fixtures (BUG-0440, logged before correction). Explicit runtime fixture checks replace those assumptions without changing the scenarios, assertions or lint rules. Repeated lint passes with no warnings.
- Final focused API command: `pnpm --filter @gridstory/api exec vitest run test/studio-context.test.ts test/config.test.ts test/identity-server.test.ts` passed all 30 tests. Real in-memory enterprise sessions cover cookie/workforce-bearer success, all 19 destination read routes for admin/viewer/author/unmapped roles, representative denied writes, page-type and scope restrictions, role-mapping refresh, no-access/current-only mode, minimized output, and malformed/cross-tenant/revoked denial. AUTH-001's valid/invalid/expired/revoked preview-token negative matrix includes the new endpoint. The operations-only/scoped-grant fixtures exercise the actual policy and projection directly; no new externally configurable identity role/protocol was invented for testing.
- `pnpm security:check` and full `pnpm check` passed: security/tenant models, ledgers, boundaries, unchanged readiness checks, lint/format, eight generated specification checks, strict types, workspace tests and production builds including React 18.3.1 SSR. Totals: schema 84, client 34, core 163, React 5, API 97, Studio 78 = 461 passed, with 17 existing optional database/recovery skips. The existing Studio chunk-size advisory remains non-blocking; no assertion, timeout or skip was weakened.
- Isolated API/built-client smoke used a seed-free, in-memory server and custom fetch bridged to server injection: read development context, clone to production, read production context, then reread the unchanged original development context. The configured result contained two permitted tuples and only the five public DTO keys; the server closed afterward. The commented catalog example also passed `loadConfig` against the default locale registry. This is API/client smoke, not a manual browser or external IdP certification claim; no real data, credentials, ports or user services were changed by it.
- The browser result and normal-asset restoration are recorded below; the failing browser gate prevents CMS-032 completion. Studio consumption, manual permission-aware UI testing and scope switching remain CMS-033/034, not evidence claimed by this API/client unit. No PostgreSQL/provider/deployment certification or release-readiness upgrade is included.

### Browser findings and bounded follow-up

The first `pnpm test:e2e` passed all ten Chromium and ten Firefox cases, but WebKit passed nine and failed dirty Back cancellation at `studio-navigation.spec.ts:95` (BUG-0441). The retained trace shows the earlier entry-change confirm dialogs, then the second title fill and Back without a subsequent confirm; the failure snapshot shows the first saved entry. The exact timing/root cause is not yet proven. Source review confirms CMS-032 did not change Studio navigation/history, existing client request implementations or that test. Do not label the intermittent failure fixed merely because a retry passes; it remains open for the already approved CMS-033 App/session/navigation test work.

The diagnostic unchanged WebKit history command with `--repeat-each=3` passed its first scenario, then later repetitions failed before history traversal because duplicate synthetic titles matched two/three entry buttons (BUG-0442). This is a separate repeat-fixture limitation, not two further reproductions of BUG-0441. A separate fresh-server invocation of the original scenario passed (4.5 seconds). The current change alters no assertion, timeout, skip, fixture title or UI guard. Initial failure artifacts are retained locally under ignored `test-results/cms032-webkit-history/`. The proposed amendment below supersedes the initial CMS-033 follow-up only if approved.

## Blocked checkpoint and proposed verification-repair amendment

Codex, 2026-08-26T17:41:30+05:30. The complete fresh-fixture `pnpm exec playwright test --project=webkit` rerun again passed nine and failed the same dirty-history URL assertion at line 95 (3.9 minutes total; responsive sweep passed in 2.7 minutes). This reproduces the full-run failure; it cannot be dismissed as a clean retry or used to mark CMS-032 complete. The exact original isolated command was `pnpm exec playwright test --project=webkit tests/e2e/studio-navigation.spec.ts -g 'entry and history guards preserve drafts and preview until accepted replacement'`; adding `--repeat-each=3` exposed the separate fixture issue described above. No product fix attempt has been made. `pnpm --filter @gridstory/studio --filter @gridstory/example-vite run build` passed afterward, restoring normal production output.

The accepted CMS-032 fence explicitly excludes Studio behavior changes. The delivery loop therefore pauses before repairing that path rather than silently widening the API-only task or declaring a failed gate complete. Proposed bounded T2 amendment:

- Add only `apps/studio/src/App.tsx`, `apps/studio/test/App.test.tsx`, and `tests/e2e/studio-navigation.spec.ts` to CMS-032's implementation fence. Retain its existing documentation/ledger files. The stable task remains CMS-032 and both bugs remain open until verified.
- Diagnose the trace and create a deterministic regression for the unregistered/unguarded edit around entry replacement, input readiness and history traversal before choosing the smallest correction. A delayed focus/state transition is a hypothesis, not a proven root cause. Correct duplicate-title fixture selection independently; do not manufacture a passing dirty-state test by suppressing the edit or confirmation.
- Acceptance: the second edit actually reaches dirty state; cancelling Back retains its draft, address and appropriate preview lifetime; accepting navigation restores saved content; rapid/late transitions cannot overwrite or bypass the edit. Unique fixtures support repeated runs. Require failing-before/fixed-after unit evidence, repeated isolated browser checks, complete Chromium/Firefox/WebKit and repository/security gates, and manual keyboard/dirty/preview smoke before closing CMS-032.
- Exclude permission-aware bootstrap, scope controls, new grants, topology edits, SCSS/palette changes, feature removal, dependency changes, BUG-0435/CMS-004 fixes and deployment. If the root cause requires another file or a different contract, amend before implementation; do not broaden silently. Rollback is the isolated UI/test repair without removing AUTH-001 or the API/client checkpoint; no data migration is involved.

Handoff: save the current 21-file API/client/documentation work as `WIP(studio): checkpoint authorized context [CMS-032]` on `codex/cms032-context-checkpoint`, leaving `main` at `6e6ea95`. Request explicit approval of the amendment above. CMS-032 is blocked, not completed; CMS-003 remains incomplete and CMS-033/034 have not started. BUG-0439/0440 are resolved; BUG-0441/0442 remain open. No push/deployment or successful full-browser certification is claimed.

Final checkpoint audit (Codex, 2026-08-26T17:44:37.4022578+05:30): repeated `pnpm lint`, `pnpm format:check` and `git diff --check` pass with no lint warnings. The read-only scope/history/link audit verifies all 21 changed files remain in the original API-only fence, all 140 task IDs are retained with only CMS-032's status changed to blocked, all 438 historical bug IDs remain (442 total), and 69 local Markdown links resolve. The initial sandbox denied the audit's Git subprocess; the approved rerun passed. An earlier ad-hoc task regex omitted digit-bearing milestone prefixes; the corrected audit and native ledger check both verify the complete history. These audit-command issues are not application fixes. Browser failure remains the explicit unresolved gate.
