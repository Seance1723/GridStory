# Public interoperability and self-hosted fleet observation

GridStory publishes machine-readable shape contracts for four existing formats and provides a private, pull-only inventory for checking whether configured self-hosted instances expose the same contract digests. This is interoperability metadata and observation—not database backup, package distribution, hosted monitoring, or remote deployment control.

## Public v1 resources

These endpoints require no identity or tenant headers:

```http
GET /api/v1/interoperability
GET /api/v1/interoperability/specifications/logical-content-archive/1
GET /api/v1/interoperability/specifications/content-schema-ir/1
GET /api/v1/interoperability/specifications/component-manifest/1
GET /api/v1/interoperability/specifications/preview-source-map/1
```

Discovery returns only `gridstory.interoperability` protocol version `1`, a deployment-configured stable instance ID, the service version, fixed `/health` and `/ready` paths, and four specification descriptors. Each descriptor includes its kind, version, stable `urn:gridstory:spec:…:1` identity, `application/schema+json` media type, canonical SHA-256 digest, and local URL. It deliberately omits organization/tenant/workspace/site/environment/locale scope, deployed content schemas, component inventory, archives, drafts, credentials, adapters, fleet membership, and current health.

Discovery uses `Cache-Control: public, max-age=60`. Versioned schemas use `Cache-Control: public, max-age=31536000, immutable`. Both use digest-derived ETags and support `If-None-Match`/`304`. A deployment that cannot expose instance and software fingerprints should not expose these routes and therefore cannot use the maintained GridStory observer.

Reviewed artifacts and examples are committed under `specifications/v1`. Regenerate them after a canonical contract change:

```bash
pnpm schema:generate
pnpm schema:check
```

`schema:check` compares every expected file byte-for-byte and fails on drift. No additional schema dependency is used; installed Zod 4 generates Draft 2020-12 documents from the canonical input contracts.

## Normative semantics beyond JSON Schema

JSON Schema describes structure and local bounds. Conforming implementations must also enforce these semantic rules:

- **Logical content archive:** the public schema describes the parsed logical archive, while GridStory's streaming transport remains JSON Lines. Entry and manifest SHA-256 values are over canonical JSON; manifest counts must equal the entry collection; entry/revision/audit IDs and sequences must be unique where specified; revision and audit references must resolve inside their entry; audit sequences are contiguous from one; and cross-entry revision/audit identities are unique. Import remains authenticated, complete-scope, dry-run-first, and atomic. The public schema is not a database backup format or an anonymous archive export API.
- **Content schema IR:** schema IDs, collections, and component IDs are unique. Canonical serialization, lifecycle fingerprints, migration assessment, and deployment validation remain authoritative. The public document describes the reusable IR format, not a tenant's deployed IR.
- **Component manifest:** component IDs/versions, props, slots, migrations, deprecation, and visual scenarios follow the canonical GridStory React-owned manifest rules. The schema contains no component code, package artifact, CSS, asset, or live component inventory and does not claim Custom Elements Manifest compatibility.
- **Preview source map:** mappings are deterministic pre-order traversal of canonical component nodes. Every `nodeId` is unique and maps to the existing selector `[data-gridstory-node="…"]`, with exact component ID/version evidence. GridStory's React renderer emits these attributes only when `preview=true`; published rendering contains no source-map annotation. Field/slot paths, steganography, published overlays, and third-party source-map formats are not included.

The framework-neutral builder is `createPreviewSourceMap` from `@gridstory/schema`; React consumers may use the `createGridStoryPreviewSourceMap` alias from `@gridstory/react`.

## Private fleet state

Fleet state is empty by default and stored under the complete GridStory content scope. The REST boundary is always `private, no-store`:

| Action | Route | Permission |
|---|---|---|
| Read scoped inventory/evidence | `GET /api/v1/fleet` | `fleet.read` |
| Add or update one member | `PUT /api/v1/fleet/members/:memberId` | `fleet.manage` |
| Pause or resume one member | `POST /api/v1/fleet/members/:memberId/state` | `fleet.manage` |
| Remove one member | `DELETE /api/v1/fleet/members/:memberId` | `fleet.manage` |
| Pull one observation now | `POST /api/v1/fleet/members/:memberId/check` | `fleet.check` |

Mutations carry `expectedVersion`. A member retains only a local ID/label, configured adapter ID, expected remote instance ID, optional expected service version, active/paused state, generation, actor/time metadata, bounded observations, and sanitized events. Origin and credential configuration never enters this document. Memory, SQLite, and PostgreSQL repositories use optimistic complete-scope persistence and participate in native backup/restore checks.

An observation has exactly one `Reachable`, `Ready`, and `Compatible` condition. A valid response is reachable; exact `/ready` success is ready; compatibility additionally requires the expected instance, optional service version, protocol version, and all four local specification kind/version/URN/media-type/digest values. Evidence is bound to the member generation and has explicit check/expiry times. After expiry, read projection returns every condition as `unknown` with `ObservationExpired`; a past success is never presented as current monitoring.

Malformed, oversized, future, expired, wrong-instance, wrong-version, or wrong-digest evidence fails closed. Transport, parse, and provider failures become bounded generic conditions. Raw exception messages, response bodies, stack traces, credentials, and provider diagnostics are not persisted or returned.

## Trusted observer composition

`HttpGridStoryFleetObserver` accepts a stable adapter ID and one deployment-controlled credential-free HTTPS origin. The origin must have no user information, path, query, or fragment. The adapter performs only three exact GETs (`/api/v1/interoperability`, `/health`, `/ready`), disables redirects, checks response origin, propagates aborts, and bounds request time and response bytes.

```ts
const observer = new HttpGridStoryFleetObserver({
  id: 'production-eu',
  baseUrl: 'https://cms-eu.example.com',
});

const server = await buildServer({
  fleet: {
    instanceId: 'production-us',
    serviceVersion: '1.2.3',
    observers: [observer],
  },
});
```

The browser supplies only the configured adapter ID; it cannot submit a URL or credential. Production deployments remain responsible for DNS rebinding/private-address defenses, egress allowlists, TLS trust, target ownership, and any separately added authentication. Do not add credentials to the public discovery protocol.

## Operator runbook

1. Configure and review the observer origin in trusted server composition.
2. Register the expected instance ID and, when rollout policy needs it, exact service version.
3. Request an on-demand compatibility check and review condition reasons, member generation, check time, expiry, and all specification digests.
4. Pause a member before changing its trusted adapter configuration. Resume and check it after deployment review.
5. Remove a member to stop future checks. Retained bounded events/observations remain recovery and audit evidence until ordinary database retention removes the complete document.
6. For an incompatible result, compare the public descriptor and regenerate/check the local specifications. GridStory does not upgrade either instance.

There is no inbound enrollment, network scan, agent, heartbeat, lease, schedule, alert, placement, traffic switch, remote command, provisioning, deployment, upgrade, rollback, database action, content mutation, workflow/release transition, or publication endpoint. Use deployment tooling with its own authority and rollback plan for those operations.

## Removal and rollback

Pause or remove all members, remove observer composition, and revert the additive M8-004 change. Public specifications contain no customer state. Removing the feature does not mutate remote instances; restored databases may retain the private fleet document until a compatible application version or reviewed data-retention operation removes it.
