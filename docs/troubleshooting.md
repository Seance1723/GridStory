# GridStory troubleshooting

## A local port is already in use

The default services use ports 4000, 5173, and 5174. Change `GRIDSTORY_PORT` for the API and the Vite port in the relevant app config, then update `VITE_GRIDSTORY_API_URL` and `GRIDSTORY_ALLOWED_ORIGINS` together. Browser verification uses isolated high ports and does not reuse development services.

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

Local Playwright uses installed Microsoft Edge. Confirm Edge is installed, or set `CI=1`, install Playwright Chromium, and rerun the test. Failure traces and screenshots are written under ignored `test-results/`.
