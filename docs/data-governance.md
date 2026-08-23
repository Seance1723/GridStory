# Data governance and guarded erasure

GridStory provides a tenant-scoped control plane for retention rules, explicit data-subject links, legal holds, processing restrictions, rights requests, encrypted exports, customer-managed key references, residency attestations, and reviewed erasure plans. It is an enforcement and evidence mechanism, not legal advice, automatic personal-data discovery, regional data routing, or a substitute for an operator's privacy program.

## Scope and discovery boundary

Every governance document uses the complete organization, tenant, workspace, site, environment, and locale scope. Management REST responses are `private, no-store`; governance state never enters published delivery caches. A subject export or erasure plan includes only resources explicitly linked to that subject. GridStory does not infer completeness from an email search, content field, or identity provider.

Built-in processors support:

- content aggregate export/deletion, cache invalidation, and published-search rebuild;
- asset metadata and exact revision/rendition object removal through the configured storage adapter;
- identity export, session/credential revocation, direct-identifier removal, and pseudonymous security-event retention.

Plugins, application databases, SaaS systems, telemetry backends, and other external resources require a deployment-specific processor and receipt. Without one, a plan records `resource_processor_unavailable` or `external_resource_requires_operator_receipt` and cannot be approved.

## Safe workflow

1. Configure classifications, retention rules, allowed placement regions, and optionally an opaque CMK reference.
2. Register a pseudonymous subject reference and link only verified resources with a retention-basis timestamp.
3. Intake a rights request. Record identity-verification method/reference and an independent review; never store identity-document or assertion bodies in the evidence reference.
4. Create a dry-run retention or approved-subject-erasure plan. Review every exact resource, version, intended effect, blocker, and SHA-256 plan digest. Creating a plan does not erase data.
5. Clear active legal holds or restrictions only through their reviewed release workflow. Recreate the plan afterward; an old plan never resumes automatically.
6. Create and verify a coordinated database plus external object/plugin/provider backup. Record its stable reference, SHA-256, and current verification time.
7. A different administrator with a fresh enterprise session approves the exact digest, reason, and backup evidence. The plan creator cannot approve it.
8. Keep the worker running. It rechecks plan/document versions, resource versions, holds, restrictions, key state, and placement before each effect, then records a processor receipt. Repeated processing does not repeat completed effects.

Any stale version, changed policy, active hold/restriction, missing processor, absent resource, unavailable or wrong-region key, disallowed/unknown placement, old reauthentication, or old/malformed backup evidence fails closed. The administrative process endpoint uses the same execute permission and revalidation for controlled diagnostics; normal deployments use the worker.

Erasure is irreversible. `git revert` can remove faulty code, but it cannot restore deleted rows, objects, identifiers, or third-party data.

## REST and client operations

The private management API is rooted at `/api/v1/governance`:

| Operation | Route |
|---|---|
| Snapshot and residency status | `GET /`, `GET /residency` |
| Policy | `PUT /policy` |
| Subjects and resource links | `POST /subjects`, `POST /subjects/:id/links` |
| Holds | `POST /holds`, `POST /holds/:id/release` |
| Rights requests | `POST /requests`, `POST /requests/:id/verify`, `POST /requests/:id/review` |
| Export/erasure plan | `POST /requests/:id/export`, `POST /requests/:id/plan` |
| Retention plan | `POST /retention/plans` |
| Approval/execution | `POST /plans/:id/approve`, `POST /plans/process` |

The universal client exposes the corresponding typed governance methods. Studio's **Data governance** panel shows scope counts, the irreversible-effect warning, subject/hold inputs, dry-run effects/blockers, digest, and backup evidence fields. Approval still relies on server-side authorization, separation of duties, and session freshness; UI state is never the security boundary.

## Customer-managed keys

Core stores only an adapter name, provider key identifier/version, expected region, updater, and timestamp. Export encryption creates a fresh 256-bit DEK, encrypts the deterministic package with AES-256-GCM, asks the configured KMS adapter to wrap the DEK with tenant/request context, and zeroes plaintext/key buffers after use. The envelope carries ciphertext, IV, authentication tag, wrapped key, key reference, and plaintext checksum. Plaintext DEKs and customer master keys are never persisted.

The Node API supplies AWS KMS and Google Cloud KMS wrappers around injected maintained provider clients. Provider SDK construction, credentials, endpoints, timeouts, retry policy, and network egress stay deployment-owned. GridStory can describe/wrap/unwrap; it cannot create, rotate, disable, schedule deletion of, destroy, escrow, or recover a customer key. Mock adapters are used in tests; no live KMS endpoint is called.

## Residency attestation

`GRIDSTORY_DATA_REGIONS` is a comma-separated inventory used by the configured placement adapter (default `local`). A policy lists allowed regions per content, asset, identity, or plugin resource. Writes, export, erasure, and key use compare the adapter attestation with that list and fail closed when required evidence is absent or disallowed.

This proves only what the configured adapter reports. It does not move data, select a database/object-store region, replicate keys, route users, constrain telemetry/backups automatically, or provide multi-region failover. The deployment must inventory every database, replica, object store, backup, log/trace sink, plugin, IdP, key, and support-access location and test provider policy independently.

## Backup, recovery, and rollback

Before production approval, run and verify the native database backup described in [Database recovery, graceful shutdown, and rolling upgrades](recovery-and-rollouts.md), plus coordinated object-store/plugin/provider backups. A database snapshot includes governance policy, subjects, links, holds, restrictions, requests, plans, receipts, and governance events, but not external object bytes or provider-managed state.

Restore only to an absent/empty isolated target, then verify readiness, audit/governance hash chains, active holds, plan states, representative governed resources, object bytes, and key access before cutover. Keep the original source and provider recovery points until acceptance. Database recovery can restore a whole earlier point; it cannot selectively undo one erasure without a separately designed reconciliation/import procedure.

Architecture and safety reasoning are recorded in [ADR 0014](adr/0014-guarded-data-governance.md).
