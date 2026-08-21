# Release evidence, tested limits, and support

This document is the public boundary for M5-007. The machine-readable source is `resourceLimits` in `@gridstory/schema`; the release workflow writes that exact JSON to `resource-limits.json`. Code uses the same object for API bodies, asset/archive shapes, GraphQL, query/search, workflow, and plugin defaults. Values that remain deployment-owned are labeled rather than presented as GridStory guarantees.

## Enforced application limits

| Resource | Enforced limit | Behavior and scope |
|---|---:|---|
| Ordinary API/GraphQL request body | 1 MiB | Fastify rejects larger bodies with 413. |
| Asset part body | 5 MiB | Route override matches the built-in negotiated part size; larger parts receive 413. |
| Declared asset object | 100,000,000 bytes | Start/upload contracts reject a larger object. |
| Asset dimension | 16,384 pixels per axis | Original and rendition descriptors reject larger declared dimensions; production processors must also enforce decoded-pixel/decompression limits. |
| Parts per asset session | 1,000 | Part numbers and completion arrays are bounded; total bytes and exact recorded descriptors still apply. |
| Portability import body | 16 MiB | JSON and NDJSON import routes reject larger bodies with 413. |
| Logical archive | 1,000 entries | Export/import reject a larger archive rather than creating unsupported evidence. |
| Entry history in an archive | 100 revisions and 1,000 audit events | Validated before repository mutation. |
| GraphQL document | Depth 12, 50 aliases, 500 field selections | Batching and subscriptions are disabled; shared query page/filter/sort/projection bounds still apply. |
| Content query | Page 100; filter depth 8; group 25; predicates 50; set values 100; sorts 5; projection 50; paths 200 characters | Applies to REST and GraphQL through the shared engine. |
| Search | Text 500 characters; content types 50; request 100; returned 50; index traversal depth 12; 5,000 scalar strings and 100,000 indexed characters per entry | Built-in repository scan is for small installations; production adapters retain exact tenant/perspective checks. |
| Operational APIs/worker | List 1,000; drain 100; outbox dead after 10 attempts; configured jobs at most 20 attempts | Backoff caps at one hour; durable queue capacity and retention are deployment sizing decisions. |
| Plugin host defaults | 100,000,000-byte artifact; 60 calls/minute/plugin/exact scope; 5-second timeout; 64 KiB input; 256 KiB output | Limiter is process-local; production runtime CPU/memory/process/network limits are operator controls. |

These are admission and execution guards, not per-tenant storage quotas. Deployments must add edge request/identity/tenant rates, global concurrency, database connection/query timeouts, object-store quotas, asset processing time/pixel/decompression limits, worker capacity, and disk alerts based on their own results. Never raise one bound without reviewing memory copies, persistence, timeout, tenant fairness, monitoring, tests, and this profile.

## Benchmark profiles and budgets

The repository runner builds the real API and calls Fastify through `inject`, exercising authorization, validation, services, SQLite/PostgreSQL repositories, serialization, workflows, and GraphQL without listening on a socket. It seeds 250 entries in one exact tenant scope, uses concurrency 8 for reads/queries, performs serial optimistic writes, and records 120 read/query plus 30 write samples.

```powershell
pnpm benchmark:sqlite -- --output .gridstory/benchmark-sqlite.json

$env:GRIDSTORY_BENCHMARK_POSTGRES_URL = 'postgresql://gridstory:gridstory@127.0.0.1:5432/gridstory'
pnpm benchmark:postgres -- --output .gridstory/benchmark-postgres.json
```

Every report is validated by `benchmarkReportSchema` and contains Node/OS/architecture/parallelism/memory metadata, profile, unique tenant, dataset, transport, samples, p50/p95/p99, throughput, peak resident memory, budgets, and pass/fail. The reviewed budgets are:

| Profile | Read p95 | Query p95 | Serial write p95 | Minimum read throughput | Peak RSS |
|---|---:|---:|---:|---:|---:|
| SQLite | <=100 ms | <=250 ms | <=250 ms | >=25 operations/s | <=512 MiB |
| PostgreSQL 17 | <=150 ms | <=350 ms | <=350 ms | >=20 operations/s | <=512 MiB |

These deliberately generous budgets are regression gates for the tested dataset, not advertised production throughput. Fastify injection excludes network, TLS, reverse proxies, CDNs, multi-node coordination, provider storage, noisy neighbors, backups, failures, and real tenant/content distributions. A production owner must repeat HTTP/load/soak/failure tests with the exact deployment, set a lower supported concurrency/rate than measured saturation, and record CPU, memory, database, cache, queue, and tail-latency headroom.

SQLite support is limited to local development, evaluation, and small single-process installations with one active worker/scheduler. PostgreSQL is the supported durable/concurrent repository profile, but the adapter-neutral content query currently loads the complete scoped perspective before filtering. Collections materially beyond the 250-entry reference dataset require deployment testing and, for sustained large collections, database predicate/cursor pushdown before support can be claimed.

## Retention and capacity ownership

GridStory does not automatically delete content revisions, audit chains, assets, job/dead-letter history, or logical archives. This preserves immutability but means growth is unbounded until an operator supplies a reviewed retention/legal-hold/deletion policy. M6-003 owns product retention/legal-hold workflows. Until then, monitor database/object-store/queue growth, export or back up before approved deletion, preserve audit/legal obligations, and never apply ad hoc SQL pruning to a supported database.

Telemetry retention targets and queue sizing are in [Observability](observability.md); database backup/PITR retention is in [Recovery and rollouts](recovery-and-rollouts.md). Release workflow artifacts are retained for 30 days by the reference workflow. GitHub attestations follow the repository/platform retention contract.

## Release evidence workflow

The manual `Release evidence` workflow is intentionally separate from ordinary quality CI. It:

1. installs the frozen pnpm lockfile and runs `pnpm check`;
2. packs exactly `@gridstory/schema`, `client`, `core`, `react`, and `example-kit` at their current private `0.0.0` identity;
3. rejects unexpected archive paths or identities and publishes the machine limits;
4. runs SQLite and PostgreSQL benchmark profiles;
5. generates an SPDX JSON SBOM with `anchore/sbom-action@v0.24.0` and Syft `v1.51.0`;
6. writes and re-verifies a sorted SHA-256 manifest;
7. creates GitHub/Sigstore SLSA provenance for the packages/evidence and an SBOM attestation for the packages;
8. uploads the complete evidence set for 30 days.

Local package/checksum verification (no publication or signing) is:

```powershell
pnpm release:prepare -- --output release-artifacts
pnpm release:manifest -- --output release-artifacts
pnpm release:verify -- --output release-artifacts
```

The prepare command requires an empty child directory, uses pnpm's reviewed `files` inventories, and fails if a tarball contains anything outside `dist`, package metadata/license/readme, or the example kit stylesheet. The manifest covers every regular evidence file except itself and fails on missing, extra, resized, or rehashed bytes.

The current private `0.0.0` archives do not include per-package README or license metadata. `BUG-0243` and M5-009 own making those artifacts publication-ready and making the validator require that metadata. Until then, successful packing/checksum verification is local integrity evidence only and cannot satisfy readiness criterion `RC-003`.

After an authorized hosted workflow run for a future accepted release candidate, download the artifact and verify each package against this repository identity:

```powershell
gh attestation verify release-artifacts/gridstory-schema-0.0.0.tgz --repo Seance1723/GridStory
gh attestation verify release-artifacts/gridstory-core-0.0.0.tgz --repo Seance1723/GridStory
```

Repeat for every archive and compare `release-manifest.json`. Hosted attestations do not exist merely because the workflow file is present. The [M5-008 staged-readiness review](release-readiness.md) therefore records RC criterion `RC-004` as unmet and RC/GA as no-go; no hosted artifact or deployment evidence was inferred. Npm trusted publishing and container/registry signing remain deferred until GridStory approves a public package or image channel.

## Vulnerabilities and support

[SECURITY.md](../SECURITY.md) defines private reporting, severity, remediation targets, coordinated disclosure, OSV lockfile scans, and Dependabot review. [SUPPORT.md](../SUPPORT.md) defines the maintained pre-v1 line, exact platform matrix, issue boundary, and deployment ownership.

The staged go/no-go rules, evidence classes, current decisions, and non-sensitive blocker ownership are in [Staged release readiness](release-readiness.md).
