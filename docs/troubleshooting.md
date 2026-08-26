# GridStory troubleshooting

## A local port is already in use

The default services use ports 4000, 5173, and 5174. Change `GRIDSTORY_PORT` for the API and the Vite port in the relevant app config, then update `VITE_GRIDSTORY_API_URL` and `GRIDSTORY_ALLOWED_ORIGINS` together. Browser verification uses isolated high ports and does not reuse development services.

## Studio links, Back/Forward and unsaved changes

Studio owns only `#/<destination>` and the paired `entry`/`type=page` parameters inside that fragment. Keep the host pathname and outer query unchanged when sharing links. Unknown destinations, malformed encoding, duplicate/unknown parameters and unsupported types normalize to Pages without reflecting the supplied input. The skip link focuses the current content without changing the address.

An explicit unavailable page is not replaced with the first page. Check that the entry exists and that your current authenticated scope permits it, or choose a different page from the list. A failed in-app target keeps the accepted draft. A denied destination shows its load error rather than a fabricated empty success. URLs cannot grant permissions or select another tenant.

Unsaved entry changes are guarded for entry-list, Search and browser-history navigation. Same-entry screen changes do not discard them. Wait for an in-flight save or content operation to finish before opening another entry. A pending read may be superseded; its late response must not overwrite the newer selection. Preview windows close on accepted entry replacement; a reported revocation failure means the window/transport stopped but backend revocation was not confirmed.

Known Back/Forward cancellation returns to the accepted stack entry. Manually typed fragments or restored history without trusted metadata cannot provide an exact stack distance: cancellation replaces that current unknown slot, which may leave a duplicate address. Reload restores saved content only; the browser's dirty warning is best effort, especially on mobile. No drafts are persisted automatically. Reverting CMS-002 requires no data migration, but its fragment bookmarks cease restoring selections on older Studio versions.

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
