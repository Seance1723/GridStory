# Regional published delivery and reviewed failover

GridStory provides a provider-neutral control boundary for regional **published** reads and reviewed single-writer failover. It validates tenant scope, residency, freshness, cache, readiness, approval, and result evidence. It does not provision replicas, databases, load balancers, DNS records, or backups, and it cannot independently prove a provider's replication or RPO/RTO.

The feature is disabled by default. With no regional policy, delivery continues through the ordinary strong primary path and emits no regional headers. Draft, preview, management, workflow, publication, identity, job, and repository writes always remain on the primary path.

## Architecture

```text
public published request
        |
        v
trusted API composition -- local deployment region (never caller selected)
        |
        +-- primary-only ----------> ordinary published repository reader
        |
        `-- bounded-staleness -----> injected least-authority read adapter
                                         |
                                         `-- validated scope/topology/lag/residency evidence

authorized operator
        |
        v
preflight -> expiring digest -> different recent human approval -> execute
                                                               |
                                                               `-> injected idempotent failover adapter
                                                                     |
                                                                     `-> validate single writer or reconcile ambiguity
```

The durable regional document uses complete organization, tenant, workspace, site, environment, and locale scope. Memory, SQLite, and PostgreSQL implementations use optimistic versions. Policy changes are rejected while a live preview, approval, execution, or ambiguous operation exists.

## Trusted composition

Custom server composition supplies a deployment-controlled `localRegion` and injected adapters through `buildServer`:

```ts
const server = await buildServer({
  regional: {
    localRegion: 'eu-west-1',
    readAdapters: [regionalPublishedReader],
    failoverAdapters: [regionalFailoverController],
  },
  governance: {
    placementAdapter: deploymentPlacementAttestation,
  },
});
```

`localRegion` must come from trusted deployment configuration. A public request header, query, cookie, or body must never choose the serving region.

A `RegionalReadAdapter` receives only complete scope, configured region, current topology version, and the maximum accepted lag. It returns a `PublishedContentReader` plus evidence. That reader exposes only published list, slug, translation-group, and translation-variant reads. It has no write, draft, preview, identity, workflow, asset, job, or arbitrary repository capability.

A `RegionalFailoverAdapter` exposes `preflight`, `execute`, and `reconcile`. The execute/reconcile input includes the same request UUID as `idempotencyKey`, the exact plan digest, source, target, mode, and topology version. The adapter owns provider fencing, database promotion, traffic changes, retry behavior, credentials, and protected diagnostics. It must return only the strict readiness/result contract.

Adapter names are unique. Unknown configured adapters fail closed. Provider SDKs and credentials remain outside schema, core, persisted regional documents, browsers, public responses, and logs.

## Read policy and evidence

The policy supports:

- `primary-only`: always use the ordinary strong primary reader.
- `bounded-staleness`: an enabled read location matching the trusted local region may serve published delivery when all evidence validates.
- `failureMode: primary`: explicitly fall back to the strong primary if the selected regional reader cannot open or attest.
- `failureMode: unavailable`: return a generic service-unavailable response instead of silently changing consistency.

Replica evidence must match the exact complete scope, configured adapter, local served region, `replica` role, current topology version, current observation window, finite lag no greater than policy, opaque bounded watermark, and required residency evidence. Every returned entry is separately checked for allowed tenant/base scope, published revision, requested content type/slug, uniqueness, and count bounds. Localized variants may vary only by locale within the same organization/tenant/workspace/site/environment.

Malformed, future, stale, disallowed, cross-scope, contradictory, oversized, duplicate, or hostile evidence fails closed or follows the explicit primary fallback policy. Raw watermarks are SHA-256 digested before exposure. Adapter payloads and provider diagnostics are never copied into public output or durable operation history.

## Consistency headers and caching

When a regional policy is enabled, the published delivery endpoints expose bounded indicators:

| Header | Meaning |
|---|---|
| `x-gridstory-served-region` | Validated serving region. |
| `x-gridstory-region-role` | `primary` or `replica`. |
| `x-gridstory-consistency` | `strong` or `bounded-staleness`. |
| `x-gridstory-observed-at` | Validated evidence observation time. |
| `x-gridstory-replication-lag-ms` | Finite validated lag. |
| `x-gridstory-topology-version` | Current regional topology generation. |
| `x-gridstory-content-revision` | Digest over the exact delivered published revision set. |
| `x-gridstory-cache-mode` | `shared` or `private`. |
| `x-gridstory-fallback-used` | Whether explicit primary fallback was used. |
| `x-gridstory-watermark-digest` | Optional SHA-256 digest; never the provider position. |

These headers are exposed by CORS. They appear on direct, localized, localized-route, query, and route published delivery where an enabled regional policy is active. Management remains `private, no-store`.

Regional delivery is also `private, no-store` unless the read adapter attests the exact ordered partition dimensions `scope`, `served-region`, `consistency`, `topology-version`, and `content-revision` with a bounded current attestation. Its digest must exactly match `regionalCachePartitionDigest({ scope, servedRegion, topologyVersion, contentRevision })` for the delivered response; a well-shaped but unrelated digest remains private. GridStory validates the attestation but does not configure or purge a CDN. A deployment must prove its actual cache key, purge, privacy, and failover behavior before enabling shared caching.

## Management API and client

All operations derive complete scope and actor identity from the authenticated request context:

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /api/v1/regional` | `regional.read` | Read the private scoped topology and bounded history. |
| `PUT /api/v1/regional/policy` | `regional.manage` | Replace policy using `expectedVersion`. |
| `POST /api/v1/regional/failover/preflight` | `regional.failover` | Validate residency/backup/readiness and create an expiring digest-bound preview. |
| `POST /api/v1/regional/failover/:planId/approve` | `regional.failover` | Record a different recently reauthenticated human's review. |
| `POST /api/v1/regional/failover/:planId/execute` | `regional.failover` | Persist executing state, then invoke the adapter idempotently. |
| `POST /api/v1/regional/failover/:planId/reconcile` | `regional.failover` | Resolve an executing or ambiguous provider outcome. |

The universal client exposes `getRegionalTopology`, `updateRegionalPolicy`, `preflightRegionalFailover`, `approveRegionalFailover`, `executeRegionalFailover`, and `reconcileRegionalFailover` with the shared strict types.

Viewer and author roles can inspect regional status; publisher can inspect/manage policy; administrator has runtime failover by default. Custom service-account authority must be explicitly scoped. Anonymous delivery never receives management authority.

Studio's neutral **Regions** panel edits the JSON policy, previews readiness, requires an explicit independent-approval acknowledgement, and shows bounded operation history. It is an operator interface to the same API, not a provider console. The panel deliberately preserves the established Studio page/content color palette.

## Planned switchover runbook

Before a planned operation:

1. Prove both the active and target content regions are admitted by the governance placement policy and reference current evidence.
2. Produce and independently verify a current coordinated backup. The regional record contains only the bounded reference, SHA-256 digest, and verification time; backup bytes remain in protected storage.
3. Confirm the provider adapter is configured, the target is an enabled read location, and no regional operation is active.
4. Create a preflight with a new UUID, target, reason, `mode: planned`, expected RPO `0`, expected RTO, and backup evidence.
5. Require readiness to report caught up, zero replication lag, zero estimated loss, exact scope/adapter/source/target/topology, and a current evidence digest.
6. Have a different authenticated human review the exact expiring digest and reauthenticate within the configured window. Planned approval must not accept a data-loss claim.
7. Execute once. GridStory persists `executing` before calling the provider with the request UUID as its idempotency key.
8. Accept success only if the exact result proves the source non-writable, target writable, and target active. GridStory advances the active control region/topology and resets reads to `primary-only` for explicit post-change validation.
9. Validate application health, strong reads, placement, caches, traffic, and provider fencing before separately enabling bounded replica reads.

## Emergency failover and ambiguity

Emergency mode is not an automatic health-check path. Preflight must report a nonzero estimated loss and the requested nonzero RPO must cover that observation. A different recent human must explicitly set `acceptDataLoss: true` for the exact digest. This is evidence of reviewed risk, not a guarantee of the provider's true loss window.

If execute throws, times out, returns malformed evidence, or its outcome cannot be proven, GridStory retains the operation as `ambiguous`. Do not start another transition or edit topology. Use the same plan/request ID to query the provider through `reconcile` until the adapter returns a strict exact result. Provider retries must fence by the idempotency key and must never promote both sides.

A `failed` result leaves the current topology unchanged. A `pending` result remains ambiguous. Result scope, adapter, request, source, target, topology, writable flags, active region, and evidence digest must all agree before success is accepted.

## Failback, recovery, and drills

Failback is a new reviewed operation after the recovered region is again an enabled eligible target with current residency, replication, and backup evidence. Never edit the active region directly to represent an external provider change.

SQLite backups and isolated restore checks include `gridstory_regional_documents`. PostgreSQL qualification includes repository restart/conformance and logical dump/restore verification for the regional table. These checks prove GridStory state portability; they do not prove cloud physical PITR, replica recovery, DNS recovery, object storage, KMS, or provider control-plane restoration.

For production readiness, run a provider-specific exercise that records:

- single-writer fencing before and after promotion;
- observed replication lag/data loss and measured RTO;
- database, traffic, DNS/load-balancer, cache, secret, key, and object dependencies;
- backup integrity, isolated restore, and rollback/failback;
- adapter authentication, least privilege, timeouts, rate limits, idempotency, and protected logs;
- region/residency and legal review;
- application and monitoring acceptance in every served region.

## Removal and rollback

Before reverting code, set every scope to `primary-only`, reconcile all executing/ambiguous operations, confirm the external provider has one known writable primary, move traffic to that primary, and verify cache behavior. Then disable policies and remove adapter composition. A code revert cannot reverse an already completed database promotion, DNS update, data loss, or external side effect.

The architecture decision and considered alternatives are in [ADR 0022](adr/0022-regional-delivery-and-failover.md). Security ownership is recorded by `THREAT-0035` and `GS-SEC-039`.

## Deliberate limitations

GridStory does not provide multi-writer conflict resolution, read-your-writes/session tokens, automatic failover/failback, replica or database provisioning, traffic/DNS control, provider SDKs, physical replication proof, guaranteed RPO/RTO, compliance certification, global CDN configuration, residency migration, or regional routing for drafts, preview, management, identities, assets, plugins, search indexes, AI providers, telemetry, keys, backups, or object storage.
