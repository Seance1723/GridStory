# Support policy

GridStory is currently a pre-v1, self-hosted project. There is no hosted service, commercial support entitlement, or guaranteed response time. Non-security defects and reproducible compatibility questions may use GitHub issues; security reports must follow [SECURITY.md](SECURITY.md).

## Supported line

Until a reviewed prerelease exists, the current `main` branch is the only maintained line. After prereleases begin, only the latest reviewed prerelease and current `main` receive fixes; users must reproduce issues on that line. Private `0.0.0` archives created by the release-evidence workflow are verification artifacts, not public registry releases.

## Tested platform matrix

| Surface | Tested support |
|---|---|
| Node.js | 22.14.0 in CI; package floor `>=22.12.0` |
| pnpm | 10.17.1 in CI; package floor `>=10.0.0` |
| Storage | SQLite on Node 22 for local/single-process use; PostgreSQL 17 for durable/multi-worker repository conformance |
| React | 18.3.1 and 19.2.7 |
| Bundler | Vite 8.1.5 |
| Browser engines | Playwright 1.61.1 pinned Chromium, Firefox, and WebKit builds |

The exact browser/accessibility claim and exclusions are in [Accessibility and compatibility](docs/accessibility-and-compatibility.md). The capacity envelope and storage/topology boundaries are in [Release evidence, tested limits, and support](docs/release-and-support.md).

## Support boundary

Repository support covers reproducible GridStory source, contract, API, and package defects inside the documented matrix. Operators remain responsible for identity and trusted proxy integration, TLS/DNS, database/object-store policy and capacity, backups/PITR, malware scanning, distributed rate/concurrency limits, telemetry backends, secret custody/rotation, plugin OS/container isolation, CDN/cache rules, and application-owned React components and headers.

Before requesting help, run `pnpm check`, the relevant SQLite/PostgreSQL or browser gate, and include sanitized logs, the commit, runtime versions, storage profile, exact command, expected result, and smallest reproduction. Never include secrets, tokens, private asset URLs, draft/customer content, or tenant data.
