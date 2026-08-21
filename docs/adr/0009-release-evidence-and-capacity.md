# ADR 0009: Evidence-bounded capacity and release artifacts

- Status: Accepted
- Date: 2026-08-21
- Task: M5-007

## Context

GridStory has runnable SQLite and PostgreSQL paths, private workspace packages, explicit security contracts, and a release roadmap. It does not yet publish npm packages or deployment images. Existing configuration values and unit tests do not establish a tested capacity envelope, a support lifecycle, a component inventory, or cryptographically verifiable release provenance.

Release evidence must remain honest about that maturity boundary. An in-process Fastify benchmark can measure GridStory's application pipeline repeatably, but it cannot predict a customer's proxy, TLS, network, storage, database, cache, or multi-node behavior. Likewise, an attestation can prove which workflow produced an artifact; it cannot prove the artifact is vulnerability-free or appropriate for a deployment.

## Prior-art comparison

| Approach | Evidence and fit | Decision |
|---|---|---|
| Do nothing; retain implicit framework defaults and ad hoc package builds | Lowest effort, but release gates remain untestable and consumers cannot distinguish a configured value from a supported limit. | Rejected. |
| Add a general load-test service and long-lived signing keys | Can model distributed traffic and portable signatures, but adds infrastructure, key custody, rotation, and a supply-chain dependency before GridStory has a deployment artifact or release operator. | Deferred until a deployment/distribution channel exists. |
| Publish directly to npm with trusted publishing and npm provenance | Strong fit for public registry packages, but every current workspace is private and versioned `0.0.0`; publishing would create external state and force product/version decisions outside M5-007. | Deferred to an approved public-package release. |
| Repository-native Fastify injection profiles plus explicit boundary tests | Reuses the real application pipeline and both storage adapters, is cheap enough for CI, and can disclose its network/proxy limitations. | Selected for the tested application envelope. |
| Pack the distributable workspaces, hash them, generate an SPDX SBOM with Syft, and attest artifacts in GitHub Actions | Produces consumable archives and standards-based component/provenance evidence without publishing them or storing a signing key. | Selected for release evidence. |
| OSV lockfile scanning, automated dependency update proposals, and private GitHub vulnerability reporting | Matches the pnpm repository and gives reporters a non-public path while keeping triage/response ownership explicit. | Selected for vulnerability operations. |

## Necessity gate

1. **Traceable:** M5-007 and the GA gates require tested limits, benchmark profiles, a support policy, SBOMs, signatures, and a vulnerability process; the threat model assigns component lifecycle and resource-exhaustion evidence here.
2. **Not already solved:** configuration schemas constrain individual inputs, tests prove behavior, and observability reports runtime signals, but none publishes a coherent supported envelope or a reproducible signed release evidence set.
3. **Minimal form:** profile the real API in-process against SQLite and PostgreSQL; pack only the five distributable library/example workspaces; produce checksums, one SPDX document, and GitHub-hosted attestations. Do not publish, containerize, or claim deployment throughput.
4. **Dependency justified:** Syft and OSV maintain ecosystem parsers, vulnerability databases, and standard serializers far beyond a safe local implementation. The benchmark, manifest, and validation logic remain repository-native and small.
5. **Rule of three:** use explicit scenario/profile records and direct limit constants; introduce no generic benchmark framework, release plugin system, or abstract policy engine.
6. **Reversible:** scripts, workflows, policies, and request guards are additive and removable in one revert; there is no schema migration, released package, stored key, or external deployment state.

## Decision

Publish one machine-readable release profile as the source for enforced resource limits, documented support boundaries, and benchmark budgets. Boundary tests must prove rejection behavior. A repository-native runner exercises built Fastify routes through injection, records environment and dataset metadata, reports p50/p95/p99 latency, throughput, and peak resident memory, and distinguishes SQLite from disposable PostgreSQL. The result is application-pipeline evidence only; production operators must repeat sizing with their network, proxy, storage, cache, database, tenant mix, and failure modes.

Release preparation packs `@gridstory/schema`, `@gridstory/client`, `@gridstory/core`, `@gridstory/react`, and `@gridstory/example-kit` without publishing them, verifies their expected inventory, and writes SHA-256 checksums. GitHub Actions generates an SPDX JSON SBOM with a pinned Syft release and uses GitHub artifact attestations (Sigstore-backed) for package provenance and the SBOM claim. Attestations are created only by the release-evidence workflow; routine source/test outputs are not signed.

OSV-Scanner checks the pnpm lockfile on relevant changes and a schedule; Dependabot proposes bounded pnpm and Actions updates. `SECURITY.md` directs reporters to GitHub private vulnerability reporting and publishes supported-version and response targets. Findings remain private until a coordinated fix/advisory decision.

## Sources

- <https://github.com/anchore/sbom-action>
- <https://github.com/anchore/syft>
- <https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations>
- <https://github.com/actions/attest>
- <https://google.github.io/osv-scanner/supported-languages-and-lockfiles/>
- <https://github.com/google/osv-scanner-action>
- <https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository>
- <https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository>
- <https://docs.npmjs.com/generating-provenance-statements/>

## Consequences

- Limits and benchmark budgets become reviewable contracts instead of scattered configuration values.
- CI can fail when application performance materially regresses, while the published wording prevents that result from becoming a production sizing promise.
- Consumers can verify archive digests and, after a workflow run, GitHub/Sigstore provenance and SBOM attestations without GridStory storing private signing keys.
- Release evidence depends on GitHub's attestation service, while local checksums and SBOM artifacts remain usable independently.
- Vulnerability automation reduces detection latency but does not replace human triage, coordinated remediation, or deployment-specific scanning.
- M5-008 still owns running the staged release reviews, verifying hosted attestations, and accepting deployment/provider evidence.
