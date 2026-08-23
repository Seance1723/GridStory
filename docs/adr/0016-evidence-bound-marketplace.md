# ADR 0016: Marketplace trust is evidence-bound and operator-scoped

- Status: Accepted
- Date: 2026-08-23
- Last reviewed: 2026-08-23 (M6-005)

## Context

GridStory already verifies Ed25519-signed Plugin SDK v1 manifests, exact SHA-256 artifact identity, SDK/protocol compatibility, transparent capability requests, tenant-scoped grants, durable lifecycle/revocation, and bounded messages to an external runtime. The release-evidence path also validates package inventories, consumes reviewed archives outside the workspace, produces SPDX/provenance evidence, and verifies checksums. Those controls prove identity, integrity, compatibility, and host mediation; they do not prove that a publisher controls its claimed identity, that a package passed current security/quality policy, or that its support declaration is useful.

M6-005 needs a marketplace trust model without importing or executing untrusted packages in the GridStory control plane, taking custody of marketplace signing keys, claiming that automation proves safety, or silently creating a global hosted service inside a self-hosted repository.

## Prior-art comparison

| Approach | Evidence and fit | Cost | Decision |
|---|---|---:|---|
| Reuse direct Plugin SDK installation and a static trusted-key list | Retains strong signature, digest, compatibility, grant, and runtime boundaries, but supplies no discovery, publisher enrollment, review freshness, support metadata, or approved-release record. | Low | Reuse underneath the marketplace; insufficient alone. |
| Trust publisher-submitted badges, scan summaries, or provenance flags | Easy to implement, but the party being reviewed could forge the result and provenance still would not establish package safety. | Low | Rejected. |
| Download and execute packages, install scripts, or tests inside the control plane | Can observe runtime behavior, but gives attacker-controlled code access to the highest-value process and duplicates the external isolation boundary. | Critical | Rejected. |
| Build a hosted global registry with artifact storage, identity operations, billing, rankings, and automated scanners | Matches mature public marketplaces, but requires infrastructure, legal/abuse operations, credentials, storage, moderation, and external state not present in GridStory. | Very high | Deferred until a separately approved hosted product exists. |
| Persist an operator-scoped catalog; combine DNS possession with explicit human publisher approval; bind signed metadata and exact artifact identity to deterministic host checks plus an injected trusted artifact inspector; require a separate release approval before disabled installation | Fits the self-hosted architecture, reuses existing signature/install/release seams, keeps scanners and package bytes outside the core, and makes every claim attributable and revocable. | Moderate | Selected. |
| Do nothing | Avoids new code, but leaves the explicit M6-005 roadmap/security gap and forces administrators to treat signatures as package-safety evidence. | Zero | Rejected. |

## Decision

GridStory will provide a fully tenant/environment/locale-scoped, operator-curated marketplace. A publisher has an immutable identifier, bounded HTTPS identity/support links, one active Ed25519 key, lifecycle state, and a DNS TXT challenge. DNS verification proves possession of the declared domain only. A distinct authenticated reviewer must record an evidence reference and reason before the publisher becomes verified; suspension immediately removes its marketplace trust. Pending challenge tokens, public-key bodies, opaque artifact references, and reviewer internals are omitted from catalog summaries.

Plugin SDK v1 gains optional signed marketplace metadata for categories, keywords, homepage/documentation/repository links, a GridStory compatibility range, tested runtime claims, and a support status/policy/contact boundary. A marketplace submission requires those fields and binds them through the existing canonical signature together with the exact artifact digest, size, capabilities, operations, and publisher key. One plugin version is immutable: a different digest or manifest requires a new version.

Review has two layers. Built-in deterministic checks validate scope, publisher/key state, signature, artifact identity, host/SDK/protocol compatibility, metadata completeness, permission risk, and evidence freshness. Artifact inventory, SBOM, provenance, malware, vulnerability, and license analysis come only from a trusted injected adapter; the framework-neutral core neither fetches nor parses nor executes package bytes. Adapter output must match the submitted digest and size, identify its policy/tool version and completion time, and return bounded check results. Required missing, failed, mismatched, stale, or adapter-error evidence blocks approval. Warnings remain visible and never silently become passes.

A passing review is not an approval and is not a safety guarantee. A second authenticated reviewer approves or rejects the exact reviewed release. Approved releases can enter the existing `PluginService` installation path, which re-verifies signature, digest, compatibility, and tenant grants and creates a disabled installation. Publisher suspension, release rejection/yanking, changed trust, or stale review blocks future installation; history remains retained.

## Necessity gate

1. **Traceable:** M6-005 and the M5-003 security residual explicitly require publisher enrollment, marketplace review, compatibility, and support policy.
2. **Not already solved:** signatures and provenance authenticate origin/integrity; neither establishes publisher-domain possession, package review, support, or approval state.
3. **Minimal form:** deliver a scoped catalog and review/approval boundary, not a global registry, artifact CDN, billing system, reputation engine, or sandbox executor.
4. **Dependency justified:** add no dependency; use platform crypto/DNS and injected scanner interfaces so security engines remain maintained deployment components.
5. **Rule of three:** extend the one existing Plugin SDK manifest and service rather than inventing a general package registry framework or configurable policy language.
6. **Reversible:** all state and routes are additive; no package, registry, DNS, billing, runtime, or traffic state is mutated by GridStory review, and a code revert leaves catalog records inert.

## Sources that changed the decision

- [VS Code extension publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) combines DNS TXT domain possession with marketplace-team legitimacy review and revokes verification when identity changes. GridStory adopts the two-signal/revocable shape, not VS Code's hosted operations or age/reputation rules.
- [VS Code extension manifests](https://code.visualstudio.com/api/references/extension-manifest) require an engine compatibility range and expose repository, issue, homepage, license, category, and support information. GridStory keeps a smaller signed and bounded metadata set.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) bind artifacts to build identity and instructions while explicitly warning that provenance does not guarantee safety. GridStory therefore records provenance as one review check, never as approval by itself.
- [Sigstore verification](https://docs.sigstore.dev/cosign/verifying/verify/) supports signed bundles and offline-verifiable transparency evidence. GridStory accepts only adapter-verified provenance summaries in this slice rather than implementing Sigstore verification in core.
- [SPDX 3.0.1](https://spdx.github.io/spdx-spec/v3.0.1/scope/) standardizes software composition, provenance, integrity, licensing, lifecycle, and vulnerability metadata. Marketplace review records an SPDX evidence digest/summary rather than inventing an SBOM.
- [OSV API](https://google.github.io/osv.dev/api/) supports version-aware vulnerability queries. Vulnerability analysis remains an injected scanner responsibility so network policy, caching, ecosystem rules, and advisory freshness stay deployment-owned.

## Consequences and revisit triggers

- Catalog consumers can distinguish publisher identity evidence, cryptographic package identity, automated findings, human release approval, support declarations, requested permissions, and runtime isolation instead of collapsing them into one misleading badge.
- Self-hosted operators own reviewer identity, evidence retention, artifact/scanner infrastructure, acceptable licenses, vulnerability thresholds, domain policy, and incident response.
- A successful repository test proves contract and fail-closed behavior against injected evidence; it does not certify a real scanner, publisher, artifact, runtime sandbox, or global marketplace operation.
- Revisit hosted distribution, artifact custody, global publisher identity, transparency logs, reputation, monetization, licensing, or scanner implementations only with named infrastructure/operations owners and a separate T2/T3 plan.
