# ADR 0025: Interoperability is generated; fleet management is pull-only observation

- Status: Accepted
- Date: 2026-08-24
- Task: M8-004

## Context

GridStory already has a versioned checksummed logical-content archive, canonical schema IR, serializable React component manifests, a preview-only node selection protocol, exact health/readiness endpoints, constrained cross-instance HTTP adapters, complete-scope optimistic state, and database recovery. Those contracts are executable inside this repository, but an independent implementer cannot consume a stable machine-readable specification, and an operator cannot retain a scoped inventory of which self-hosted instances implement the same contract versions.

The requested public surface must not accidentally make tenant schemas, component inventories, content archives, draft data, credentials, or fleet membership anonymous. Fleet management must also not silently become a deployment orchestrator: GridStory has no authority to provision hosts, run remote commands, exchange credentials, change traffic, or claim hosted availability.

## Prior-art comparison

| Approach | Representative evidence | Fit and cost | Decision / deliberately skipped |
|---|---|---|---|
| Generated JSON Schema 2020-12 documents with stable IDs | JSON Schema 2020-12 and Zod 4's installed generator | Fits the existing canonical Zod source and permits deterministic drift checks without another schema runtime. Custom refinements still need normative prose and executable fixtures. | Selected for the four data contracts, using stable `urn:gridstory:` identities and committed generated artifacts. |
| Publish a complete OpenAPI 3.1 description | OpenAPI 3.1 uses an explicit JSON Schema dialect | Useful for the whole HTTP API, but expands M8-004 from four interoperability formats into route/auth/error/client governance for every feature. | Reject for this slice; publish small discovery and schema resources only. |
| Discover metadata under a new `/.well-known/gridstory` name | RFC 8615 | Familiar discovery shape, but new well-known names require registration and a specification defining format/media type. | Do not squat on an unregistered name. Use the ordinary versioned `/api/v1/interoperability` path; revisit registration after external adoption. |
| Package archives and specs as OCI artifacts | OCI Distribution Specification | Strong media-type, digest, manifest, pull, and verification model, but requires registry namespaces, blobs, tags, upload, auth, retention, and conformance. | Reuse immutable version/digest descriptors only; add no registry client/server or OCI claim. |
| Translate GridStory components to Custom Elements Manifest | Web Components Custom Elements Manifest 2.1 | Shows the value of a versioned JSON Schema and discoverable package metadata, but models modules/classes/tags/events rather than React-owned props, slots, data migrations, and visual scenarios. | Publish the canonical GridStory component manifest; do not claim CEM compatibility or ship component code. |
| Adopt Sanity Content Source Maps and overlay encoding | Sanity Content Source Maps and Visual Editing | Demonstrates explicit output-to-document/path mappings and preview-only annotations, but depends on Sanity document/query/path and overlay conventions and is broader than GridStory's current entry/node selection evidence. | Publish a small GridStory node-source map over existing preview-only DOM markers; field/slot maps and steganography remain out of scope. |
| Install fleet agents/controllers and continuously reconcile desired state | Kubernetes probes/conditions, SIG Multicluster ClusterProfile, and Open Cluster Management | Mature inventory, observed conditions, leases, credentials, placement, work distribution, and double opt-in registration, but assumes a cluster control plane and remote mutation authority GridStory does not have. | Reuse desired identity versus observed generation/status; use operator-triggered pull through configured adapters with no agent, lease, scheduler, credential, placement, or remote work API. |
| Reuse one-off rolling-upgrade checks only | Existing `checkRollingUpgrade` | Zero persistence and already proves exact health/readiness, but cannot inventory multiple instances, compare public contract digests, preserve sanitized observations, or enforce tenant authorization. | Reuse its bounded HTTP/error shape inside the maintained observer; add a small scoped inventory. |
| Do nothing / retain TypeScript types and prose | — | No implementation cost, but formats remain repository-internal and fleet compatibility stays manual and non-auditable. | Rejected because M8-004 explicitly requires public specifications and self-hosted fleet management. |

## Necessity gate

1. **Traceable:** M8-004 explicitly requests self-hosted fleet management and public specifications for four existing GridStory formats; ADR 0023 also defers public interoperability here.
2. **Not already solved:** portability validates archives, lifecycle serves authenticated schemas, components are code-owned manifests, preview messages select nodes, and rollout checks inspect two URLs once; none provides immutable generated schemas plus retained multi-instance compatibility conditions.
3. **Minimal form:** four generated schemas/examples, one discovery descriptor, one deterministic preview node-source map, one empty-by-default fleet document, one pull-only adapter, on-demand checks, and private operator controls. Full API description, third-party mappings, continuous reconciliation, and remote operations are excluded.
4. **Dependencies justified:** no dependency is added. Installed Zod 4 can generate Draft 2020-12 documents; existing canonical JSON/SHA-256, Fastify, authorization, persistence, and adapter seams cover the rest.
5. **Rule of three:** the four named formats are real repetitions that justify one explicit specification catalog, while fleet observation remains one concrete service/adapter rather than a generic control-plane or plugin framework.
6. **Reversible:** public schemas contain no customer data, fleet state defaults empty, member adapters can be paused/removed, and no remote mutation occurs. Remove adapters/member records and revert the additive commit.

## Decision

GridStory will expose one versioned public discovery document and four immutable Draft 2020-12 JSON Schema documents for the existing logical-content archive, canonical schema IR, component manifest, and a minimal preview node-source map. Stable `urn:gridstory:` identifiers distinguish schema identity from network location. A generator uses the canonical Zod definitions, writes reviewed artifacts/examples under `specifications/v1`, and fails `schema:check` on byte drift. Normative prose and executable fixtures cover semantic checksum, reference, uniqueness, ordering, and preview-only rules that JSON Schema cannot express.

The discovery document contains only a deployment-configured stable instance ID, service version, interoperability protocol version, fixed health/readiness paths, and specification kind/version/URN/media-type/digest/URL descriptors. It contains no scope, content, deployed schema/component inventory, credentials, adapters, fleet records, or current health result. Versioned specifications are publicly cacheable and immutable; discovery is publicly cacheable for a short bounded interval. Responses use digest-derived ETags.

Fleet state is one complete-scope optimistic document backed by memory, SQLite, and PostgreSQL. A member stores a local ID/label, configured adapter ID, expected remote instance ID, optional expected service version, state, generation, bounded last observation, and sanitized events. Origins and credentials stay in trusted server composition. Separate `fleet.read`, `fleet.manage`, and `fleet.check` actions protect private/no-store routes.

The core receives a narrow observation adapter. The maintained GridStory HTTP implementation accepts only a preconfigured credential-free HTTPS origin, disables redirects, rejects changed origins, bounds time/body bytes, fetches the public discovery plus exact health/readiness documents, and converts transport/provider details to generic reason codes. The service independently parses all evidence, binds it to the expected instance/member generation, checks observation time and expiry, compares every required local spec version/digest, and records finite Reachable/Ready/Compatible conditions. An observation never triggers a remote write, deployment, upgrade, rollback, traffic change, publication, or content mutation. No scheduler is included; operators explicitly request each check.

## Sources that changed the decision

- <https://json-schema.org/draft/2020-12/json-schema-core> defines stable schema-resource identity and bundling behavior.
- <https://spec.openapis.org/oas/v3.1.0> shows explicit JSON Schema dialect use but also the larger API-description commitment being deferred.
- <https://www.rfc-editor.org/info/rfc8615/> requires registration and a real specification before minting a well-known URI.
- <https://github.com/opencontainers/distribution-spec/blob/main/spec.md> demonstrates media-type and digest-bound content discovery without making OCI necessary here.
- <https://github.com/webcomponents/custom-elements-manifest> demonstrates a versioned generated component-description schema for a different component model.
- <https://www.sanity.io/docs/visual-editing/content-source-maps> demonstrates explicit result-to-source mappings and preview tooling.
- <https://kubernetes.io/docs/concepts/workloads/pods/probes/> separates liveness from readiness and warns that probe behavior has operational consequences.
- <https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md> defines observed-generation conditions and stable reason/time fields.
- <https://multicluster.sigs.k8s.io/concepts/cluster-profile-api/> separates cluster inventory identity/properties/status from the mechanisms that manage clusters.
- <https://open-cluster-management.io/docs/concepts/cluster-inventory/managedcluster/> shows the substantially larger agent, lease, credential, approval, placement, and removal lifecycle intentionally excluded.

## Consequences and revisit triggers

- JSON Schema consumers receive stable shape contracts, while semantic invariants remain explicit executable requirements rather than falsely encoded claims.
- Public discovery makes instance/software/spec versions intentionally visible. Deployments that cannot accept that fingerprinting surface can disable the public route, in which case they cannot participate in the maintained fleet observer.
- Pull-only observations can be stale and cannot prove deployment health between checks. The UI and API must show observation/expiry times and `Unknown` after expiry rather than imply monitoring.
- Revisit IANA well-known/media-type registration, OpenAPI, OCI distribution, third-party schema/component/source-map mappings, continuous heartbeats, alerts, and upgrade execution only after independent implementers or self-host operators produce concrete requirements and security ownership.
