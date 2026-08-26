# ADR 0028: Stable Studio locations and guarded browser history

- Status: Proposed — awaiting explicit implementation approval.
- Created: 2026-08-26T12:46:25+05:30 by Codex.
- Task: CMS-002 (T2), dependent on completed CMS-001.
- Source baseline: `92fa167`. This checkpoint changes documentation only.

## Ask and inspected seams

Make all 19 current Studio destinations addressable and restorable through direct links, reload and Back/Forward, without losing unsaved entry changes, changing application-site routes, exposing preview credentials or replacing the current visual system.

The finite [navigation metadata](../../apps/studio/src/navigation.ts) already supplies stable destination IDs. [App.tsx](../../apps/studio/src/App.tsx) owns one active destination, on-demand feature loaders and a shared selected entry/draft. It currently initializes Pages and the first returned page regardless of the address. There is no Studio history listener or router dependency.

`requestSelectEntry` confirms before replacing a dirty entry; the search-result button bypasses it and calls `selectEntry` directly (BUG-0421). The loader replaces draft/composition state and has no request-generation check, although the existing client methods already accept AbortSignals. Bootstrap has an AbortController, but its asynchronous selection must also respect cancellation. Same-entry refreshes after successful mutations must remain separate from user navigation.

The standalone preview uses browser-only transport and backend revocation. The patch effect precedes the entry-change cleanup effect; the new transition must explicitly prevent a new entry from being patched into an old entry's session, including a grant that resolves late. This is a required race regression, not a claim that runtime leakage was demonstrated during planning.

Vite's current Studio configuration has no custom base or committed production rewrite configuration. The existing `#studio-editor` skip link also occupies the fragment; it must remain a focus action without overwriting the new route. Readiness and authorization boundaries remain as documented in ADRs 0003, 0004, 0013, 0026 and 0027.

## Options and prior art

| Approach | Evidence and fit | Cost / decision |
|---|---|---|
| Reuse local React state unchanged | Current single-page selection and loaders work. | Lowest cost, but cannot meet direct-link, reload or history acceptance. Reuse state/loaders, not the missing location behavior. |
| Fragment addresses plus a finite native history adapter | [React Router's hash approach](https://reactrouter.com/api/declarative-routers/HashRouter) keeps its routing portion out of server requests. Native History APIs can update the same document. | Recommended: works at the current served Studio document without requesting a new server path. Explicit parsing and guarded history still need tests. |
| Path/history addresses | Clean path names; native History APIs support same-origin URLs. | Requires agreeing production fallback rewrites/base handling that are not currently part of the repository. Defer rather than changing deployment and application routes in this slice. |
| Query-string addresses | Would retain the current document path without consuming its fragment. | Sends Studio selection metadata to servers and shares a namespace with host/auth query parameters. Not chosen. |
| Install a general routing/data framework | Mature route integration and blockers could be useful for a larger extracted screen tree. | Not justified for 19 finite destinations with existing data loaders. No dependency in this proposal; revisit if the minimal adapter cannot satisfy the tests without growing into a router framework. |

Browser constraints informing the design:

- [`pushState`](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState) does not emit `hashchange`; some browsers persist history state. Commit local selection explicitly and put no drafts/credentials in history state.
- [`popstate`](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event) arrives after location has changed; fragment traversal may also emit `hashchange`. Deduplicate the events and compensate a cancelled traversal rather than assuming it can be cancelled like a click.
- [`beforeunload`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event) is a best-effort browser warning, particularly on mobile. Register it while dirty, retain the native prompt, and do not promise crash recovery or automatic draft persistence.

Four official documentation sources were sufficient. The finite representation and guard policy below are GridStory design choices, not a claim of router equivalence.

## Proposed address contract

Use the fragment `#/<destination>` with optional paired `entry` and `type` parameters, for example `#/pages?entry=<encoded-id>&type=page` and `#/quality?entry=<encoded-id>&type=page`.

1. Destination IDs are exactly the current metadata keys, not display labels. Renaming Library does not change the `assets` ID. No unimplemented destination is valid.
2. Entry context may accompany any destination because the current header, quality checks and other existing controls share the selected page. Sidebar transitions carry that context without reloading it. A search-result entry link targets Pages explicitly.
3. `entry` is an opaque, nonempty identifier, not a title, slug or assumed UUID. Bound the decoded identifier to 256 characters, reject control characters, and encode reserved characters using standard URL APIs. Bound the whole fragment to 4096 characters. Reject malformed percent encoding, duplicate/unknown parameters, incomplete entry/type pairs and unsupported route forms.
4. The only supported type in this slice is `page`, verified against the fetched entry/schema. Omitted context uses the existing first-available-page policy, then canonicalizes once with `replaceState`; an empty list remains an honest empty state. Non-page authoring belongs to CMS-004, not this routing task.
5. Explicit IDs are fetched directly through the current authenticated, scoped client, including IDs not present on the loaded list page. Never silently substitute the first entry for a missing, forbidden or mismatched explicit target. A cold-load failure shows an unavailable-entry state with disabled entry actions; a failed in-app transition preserves the prior accepted editor and restores its address.
6. Invalid syntax/unknown destinations normalize to Pages with a generic notice, without echoing raw input. Existing in-memory entry state survives normalization. Valid but unavailable IDs are not treated as malformed syntax.
7. No tenant/site/environment/locale selectors, authorization grants, draft values, tokens, search text, revisions, release IDs or preview state enter the address. The URL cannot change the client's trusted scope. A shared link identifies an entry only within the recipient's already-authorized current scope.
8. Keep the served pathname and host-owned outer query unchanged. Handle only the Studio fragment. The skip link focuses the editor, or the current destination's primary content when no editor is rendered, without adding/replacing history. No application preview route is interpreted as a Studio route.

## Guarded transition policy

| Transition | Required behavior |
|---|---|
| Group disclosure, theme/compact toggle, same selected leaf | No history entry, data fetch, draft reset or preview lifecycle change. |
| Different destination, same entry | Push one canonical address; preserve dirty draft/composition and the same-entry preview; reveal the group and close the mobile drawer. |
| Entry-list/search-result/deep-link/history change to another entry | One shared guard asks before discarding dirty edits. Cancellation leaves the accepted entry/draft/composition/preview and canonical address intact. Acceptance loads/validates the target before replacing editor state. |
| Entry fetch, history or bootstrap becomes stale | Abort supported reads and check a request generation before any state/URL/notice/busy update. A late response must not replace a newer entry or the user's new edit. Prevent conflicting edit/save/publish actions during an accepted entry replacement. |
| Existing save/publish/workflow refresh of the same entry | Refresh without a new navigation history entry; do not re-run the discard guard for the mutation's own approved result. Existing guarded creation adds a location only after successful creation/selection. |
| Entry-changing navigation while a mutation is in flight | Keep the current entry/address until the write settles; serialize or reject the transition with a clear notice. Do not pretend cancelling a client request undoes a server write. Mutation completion cannot replace a newer entry; same-entry destination navigation remains harmless. |
| Preview during entry replacement | Dispose old transport and close the popup before committing another entry. Invoke scoped revocation, report failure honestly, and never patch through a mismatched grant. A late preview grant is revoked instead of connected. Same-entry destination changes keep preview; no route opens a popup automatically. |
| Reload/tab close/document exit | Retain a dirty-only browser warning. A cancelled supported warning preserves the document; an accepted reload restores saved content, not unsaved data. No autosave/local draft store is added. |

The native adapter owns one versioned namespace in `history.state`, containing only an ownership marker and finite index, while preserving unrelated state. Initial/canonical normalization replaces; genuine committed selections push; reselection does neither. It does not create global history monkey patches.

For owned Back/Forward entries, use the known index delta to return to the accepted entry after a cancellation. Suppress only the exact compensating event and serialize/deduplicate `popstate`/`hashchange`; repeated Back, Forward and multi-entry `go()` must remain usable after cancellation or acceptance. Do not overwrite historical targets with the current page as the ordinary cancellation strategy.

For a manually typed fragment or restored/unowned history state whose index cannot be trusted, validate it as an external navigation request. On cancellation replace only that current unowned address with the accepted canonical address, without guessing a traversal delta. A duplicate address may remain in that externally created history slot; do not claim recovery of an unknown prior stack. Subsequent owned navigation must still work without loops. Cross-document navigation remains browser-owned.

A destination load denied by the server gets a truthful unavailable/error state, not previously cached privileged output under a new URL. This task does not introduce menu capability projection or claim to solve CMS-003's authorized-context work.

## Sequence and exact implementation fence

1. Define/test a pure parser/formatter against the finite metadata. This must precede history integration so the URL contract is not inferred from component state.
2. Add/test the native history adapter, especially cancelled/rapid/unknown-entry traversal. This is the highest-risk unknown and must pass before wiring all user entry transitions.
3. Integrate bootstrap, destination selection, guarded entry selection, existing mutation refreshes, abort/generation handling and preview lifetime. Repair BUG-0421 through that shared entry path, preserving the visual shell and feature loaders.
4. Verify all current destinations, new direct links/history paths and preview/publication boundaries; update operational guidance and ledgers; commit the completed implementation separately from this proposal.

Exact files permitted after approval:

- `apps/studio/src/App.tsx`
- `apps/studio/src/navigation.ts`
- `apps/studio/src/studio-location.ts` (new, finite parsing/formatting)
- `apps/studio/src/studio-history.ts` (new, native browser adapter)
- `apps/studio/test/App.test.tsx`
- `apps/studio/test/navigation.test.ts`
- `apps/studio/test/studio-location.test.ts` (new)
- `apps/studio/test/studio-history.test.ts` (new)
- `tests/e2e/studio-navigation.spec.ts` (new)
- `tests/e2e/accessibility.spec.ts`
- `tests/e2e/vertical-slice.spec.ts`
- `README.md`, `docs/troubleshooting.md`, `docs/cms-admin-gap-analysis.md`, this ADR
- `TASKS.md`, `CHANGELOG.md`, `BUGS.md`

No API, storage, package exports, dependency/lockfile, application consumer, hosting configuration, SCSS palette/control system or new domain screen is in scope. Use existing notice/loading/empty styles. Amend the plan before any additional file or contract is needed.

## Observable acceptance and verification

- Every destination ID round-trips; direct load/reload restores the correct destination and authorized page; empty, malformed, duplicate, unknown, overlong, missing/forbidden and wrong-type links behave as specified. No raw invalid value is rendered or logged.
- All entry-list and search-result transitions use the same guard. Dirty cancellation preserves URL, selected entry, text, composition history and preview. Same-entry destination transitions preserve edits without a discard prompt.
- Back/Forward, rapid repeated traversal, multi-entry jumps, cancellation followed by accepted traversal, manual fragments, initial/restored history without metadata, React StrictMode setup/cleanup and listener disposal have deterministic regressions with no duplicate pushes or event loops.
- Delay two entry responses and preview creation out of order: only the newest accepted target commits; no stale busy/notice/selection update and no mismatched preview patch is allowed. A failed target does not clear the current draft or make Save/Publish act on the wrong entry.
- URL and history-state assertions reject draft text, credentials and preview/session data. Current backend authorization still handles direct-ID reads; no URL value selects a new trusted scope.
- Skip-link/keyboard focus works without replacing the address. All 19 screens retain one active leaf/one visible destination, current group behavior, global styles, six-width/light-dark/zoom/forced-colors/WCAG checks and the standalone edit-save-publish-deliver path.
- Run focused parser/history/Studio tests, `pnpm check`, and `pnpm test:e2e` across Chromium, Firefox and WebKit. Perform a real browser smoke covering copied deep links, reload, Back/Forward, cancelled edits, mobile selection and preview lifecycle, using isolated synthetic data. Verify loading/error/forbidden paths and the existing all-destination suite rather than just a happy-path URL assertion.
- Only mark CMS-002 complete after observed results, resolved/deferred bug records, documentation updates and its completion commit. No live provider, PostgreSQL migration or production deployment is needed or claimed for this Studio-only contract.

## Necessity, risks, rollback and approval

1. Traceable: CMS-002 explicitly requires stable locations/history, and BUG-0421 demonstrates a guard seam that must be unified.
2. Not already solved: destination state and selection loaders exist, but addresses are not read/written; guarding only the entry-list click cannot protect history or search-result navigation.
3. Minimal form: finite parser and browser adapter for existing screens. No route framework, generic plugin/config layer, autosave, draft persistence, new collections or scope switcher.
4. Dependency justified: reuse standard URL/History APIs and existing client AbortSignals. No new dependency is proposed; re-plan if native history correctness cannot stay bounded.
5. Rule of three: the same location/guard policy serves 19 destinations plus entry-list, search, direct-load and browser-history transitions; that repetition justifies a single finite path.
6. Reversible: revert the eventual CMS-002 implementation commit. No database/content migration or published route changes occur. Fragment bookmarks would cease restoring selection on the old Studio, which must be noted in rollback guidance.

Primary risks are address/view divergence, history loops, dirty-state loss, stale async commits, skip-link collisions and preview session races. The tests above are release blockers, not deferred cleanup. Browser shutdown/mobile termination cannot be made lossless by this slice; no guarantee of unsaved recovery is offered.

Approval requested: accept the hash address contract, page-only context, guard/history fallback semantics, exact scope and verification boundary above. Until then CMS-002 remains planned and this ADR proposed; no application implementation is authorized by the proposal itself.

## Planning checkpoint verification

At 2026-08-26T12:49:16+05:30, Codex observed passing `pnpm lint`, `pnpm format:check`, `node scripts/check-ledgers.mjs`, `git diff --check` and `pnpm --filter @gridstory/studio build`. Read-only checks confirm that only the five declared planning documents changed, all 136 task statuses remain unchanged, 11 local plan/ledger links resolve, the required proposal sections exist and BUG-0420's stale pointer is corrected. BUG-0421 remains open; its source evidence is not misrepresented as a passing runtime regression.

No unit/integration/browser suite or external provider/deployment certification was rerun for this documentation checkpoint. All proposed runtime tests remain implementation work after approval. Handoff: `main`, documentation-only planning commit tagged `[CMS-002]`; the single next action is owner approval of this proposal, not the next CMS task.
