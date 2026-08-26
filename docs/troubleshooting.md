# GridStory troubleshooting

## A local port is already in use

The default services use ports 4000, 5173, and 5174. Change `GRIDSTORY_PORT` for the API and the Vite port in the relevant app config, then update `VITE_GRIDSTORY_API_URL` and `GRIDSTORY_ALLOWED_ORIGINS` together. Browser verification uses isolated high ports and does not reuse development services.

## Studio links, Back/Forward and unsaved changes

Studio owns only `#/<destination>` and the paired `entry`/`type=page` parameters inside that fragment. Keep the host pathname and outer query unchanged when sharing links. Unknown destinations, malformed encoding, duplicate/unknown parameters and unsupported types normalize to the first permitted destination (Pages for a fully authorized user), or show No Studio access when none is permitted, without reflecting the supplied input. The skip link focuses the current content without changing the address.

An explicit unavailable page is not replaced with the first page. Check that the entry exists and that your current authenticated scope permits it, or choose a different page from the list. A failed in-app target keeps the accepted draft unless an observed authorization failure invalidates the session. A capability-denied destination shows Access unavailable without requesting its feature; an observed feature 403 clears private state and rechecks permissions as described below. Neither state fabricates empty success. URLs cannot grant permissions or select another tenant.

Unsaved entry changes are guarded for entry-list, Search and browser-history navigation. Same-entry screen changes do not discard them. Wait for an in-flight save or content operation to finish before opening another entry. A pending read may be superseded; its late response must not overwrite the newer selection. Preview windows close on accepted entry replacement; a reported revocation failure means the window/transport stopped but backend revocation was not confirmed.

Pages navigation normally focuses the editor for keyboard access. Its delayed callback now yields if you have already chosen an input or another control, and is cancelled on superseding navigation/unmount. Typing after selecting an entry must remain in that field and show Unsaved changes; a missing dirty indicator is not evidence that the edit was saved. The BUG-0441 regression covers this timing boundary without changing history or autosave semantics.

Known Back/Forward cancellation returns to the accepted stack entry. Manually typed fragments or restored history without trusted metadata cannot provide an exact stack distance: cancellation replaces that current unknown slot, which may leave a duplicate address. Reload restores saved content only; the browser's dirty warning is best effort, especially on mobile. No drafts are persisted automatically. Reverting CMS-002 requires no data migration, but its fragment bookmarks cease restoring selections on older Studio versions.

## Studio capability discovery or catalog configuration fails

Studio now requires a validated version-1 `GET /api/v1/studio/context` response before private startup (CMS-033). An older, malformed or unavailable API shows Retry access and makes no legacy identity fallback or private feature requests. Visible context selection remains CMS-034; configuring the API catalog does not add a selector.

No Studio access means authentication succeeded but there are no permitted screens. Access unavailable means the address names a denied destination; choose an available section. A page-list grant without schema/entry access shows disabled entry controls and stable IDs when title metadata is unavailable. Missing history, workflow, collaboration or component access does not fabricate sample configuration or block permitted screens.

Window focus revalidates access without interrupting the already verified editor or preview while that routine check is pending. A connection failure suspends the private subtree and closes preview output, but Retry access with the same verified authority preserves unsaved local edits. A changed principal/capability set or observed 401/403 evicts the private lifetime, including unsaved drafts and preview. Sign in required needs a valid workforce session before retry. If a feature returns 403 while discovery still reports the same flags, Studio stops automatic retries: resource-specific checks, workflow conditions or server policy may still deny it. Contact an administrator; never broaden permissions just to dismiss the message. Server-side grant revocation may fail after the session has ended; the popup/controller still close, and late grants receive best-effort cleanup. The known workforce-bearer revocation compatibility defect remains BUG-0435/CMS-034.

The new endpoint requires the current production workforce session plus organization/tenant routing headers and the complete selected scope. A 401 means the session is absent/invalid/revoked; preview grants alone are not accepted. A generic 403 means the requested configured scope is unavailable, without disclosing hidden topology. Invalid scope syntax or any query parameters return 400. A valid scope may have zero permitted screens; do not infer admin from successful authentication. Client `invalid_studio_context` means an unsupported/malformed or wrong-scope response, not permission to fall back to legacy identity data.

Omit `GRIDSTORY_STUDIO_TOPOLOGY_JSON` for current-context-only discovery. To configure choices, use the complete example in `.env.example`, unique entity IDs, correct parent IDs, bounded names, and locale records consistent with `GRIDSTORY_LOCALES_JSON` (including enabled/default/required, route prefix and fallback order). At most 256 entries per entity array and 256 active complete tuples are accepted. Inactive parents, locked environments and disabled locales are not selectable; this does not add a global write lock to existing APIs. ScopeRegistry uses globally unique IDs within each entity kind, not repeated environment IDs across different sites.

The API rejects invalid catalog configuration before opening databases. Correct the deployment-owned configuration; never paste credentials or raw topology into a bug report. No runtime topology editing or permissions are added. A clone from `withStudioScope` keeps the original client and fixed organization/tenant/workspace unchanged; validate the clone with `getStudioContext()` before use. The response is private/no-store and must not be persisted in published caches or browser storage. Identity administration uses the existing server gate; other flags reuse exact action/resource decisions and do not replace entry/workflow/step-up checks.

## Studio reports a CORS error

Add the exact Studio and application origins to `GRIDSTORY_ALLOWED_ORIGINS`. Origins include scheme, host, and port; `localhost` and `127.0.0.1` are different origins.

## A workspace package export cannot be found

Build package declarations before checking a dependent package:

```bash
pnpm build:packages
pnpm typecheck
```

The root verification commands already enforce this order.

## SQLite reports experimental warnings

Node 22 currently labels `node:sqlite` experimental. GridStory's local adapter is tested against the required Node version. Use `GRIDSTORY_DATABASE_URL` to select the verified PostgreSQL production adapter; do not treat the local SQLite database as a production deployment.

## PostgreSQL cannot connect

Set `GRIDSTORY_DATABASE_URL` to a complete PostgreSQL connection URL and confirm the database exists and accepts connections from the API host. GridStory creates its own `gridstory` schema and tables but does not create the database or credentials. Run `pnpm test:postgres` to verify the adapter in an isolated PostgreSQL 17 container; the command publishes a random local port and removes the container on completion.

## Resetting local demo content

Stop the local services, make a backup if you need the revisions, and remove only `.gridstory/gridstory.db` plus its `-shm`/`-wal` sidecars. The next API start recreates the database and idempotently publishes the welcome page.

## Browser verification cannot launch

GridStory's browser gate uses the Playwright-pinned Chromium, Firefox, and WebKit engines. Install all three for the current lockfile, then rerun the gate:

```bash
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

Linux CI also needs Playwright's documented system packages, installed with `--with-deps`. Failure traces, screenshots, and axe attachments are written under ignored `test-results/`; exact tested versions and claim boundaries are in [Accessibility and compatibility](accessibility-and-compatibility.md).
