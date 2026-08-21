# OWASP ASVS 5.0 profile

GridStory uses OWASP Application Security Verification Standard 5.0.0 as a stable requirements vocabulary. References are version-qualified as `v5.0.0-<chapter>.<section>.<requirement>`. The target is **Level 2-oriented** because GridStory is a multi-tenant authoring and delivery system with authenticated privileged operations, private drafts/assets, integrations, and publication workflows.

This profile is deliberately honest about evidence. It is a selected, project-specific control and applicability record—not an ASVS certification, not a complete copy of all ASVS requirements, and not proof for an arbitrary deployment. The canonical data is [`security/asvs-v5.0.0-profile.json`](../../security/asvs-v5.0.0-profile.json); normative GridStory requirements are in [Security requirements](security-requirements.md); risks and boundaries are in [Threat model](threat-model.md).

## Status meanings

| Status | Meaning |
|---|---|
| Verified | Current implementation plus automated or inspectable repository evidence supports the GridStory requirement. |
| Partial | A real control exists, but named code, deployment, operational, or independent evidence is incomplete. |
| Planned | Required before v1 GA and linked to a delivery milestone. |
| Conditional | Required when the named optional feature/topology is deployed; the current repository foundation alone is not proof. |

A `verified` project requirement can cover only the selected ASVS reference and stated GridStory scope. It does not imply every requirement in that ASVS chapter or level is verified.

## Chapter applicability

| Chapter | Applicability | GridStory treatment |
|---|---|---|
| V1 Encoding and Sanitization | Applicable | Parameterized persistence, structured rendering rules, SVG sanitization, and outbound URL/SSRF policy. |
| V2 Validation and Business Logic | Applicable | Trusted-layer schemas, revision/order checks, atomic publication/import, and pre-GA anti-automation. |
| V3 Web Frontend Security | Applicable | Exact CORS/postMessage origins, private asset headers, a three-engine browser review, and application-header guidance exist; deployed HTML CSP/header conformance remains. |
| V4 API and Web Service | Applicable | REST/GraphQL boundaries, trusted intermediary requirements, bounded queries, and introspection policy. |
| V5 File Handling | Applicable | Multipart integrity, byte/type inspection, private keys, quarantine, safe delivery; deployment quotas/scanner remain. |
| V6 Authentication | Conditional | Production-selectable OIDC/SAML relying-party, SCIM service, WebAuthn step-up, and break-glass pathways exist; live IdP/proxy/abuse-control conformance remains deployment evidence. |
| V7 Session Management | Conditional | SQLite/PostgreSQL opaque sessions enforce idle/absolute/reauthentication/concurrency and lifecycle revocation; secure-cookie/TLS/proxy deployment remains conditional. |
| V8 Authorization | Applicable | Deny-by-default RBAC/ABAC, tenant-bound role assignments, and fail-closed complete-scope boundary tests are verified. |
| V9 Self-contained Tokens | Applicable | Preview, cursor, and asset grants use purpose/scope/time-bound HMAC verification. |
| V10 OAuth and OIDC | Conditional | The maintained OIDC relying-party adapter binds code flow with state, nonce, and S256 PKCE; no OAuth authorization server is in scope and live issuer interoperability remains deployment evidence. |
| V11 Cryptography | Applicable | Platform crypto and approved hashes/CSPRNG exist; formal inventory/lifecycle remains. |
| V12 Secure Communication | Applicable | HTTPS is required for risky outbound/preview paths; deployment TLS evidence remains. |
| V13 Configuration | Applicable | Explicit origins/hosts/secrets/adapters exist; production fail-safe validation and vault evidence remain. |
| V14 Data Protection | Applicable | Draft/private/public cache separation plus telemetry classification, minimization, access, and retention targets exist; product-wide deletion/legal-hold policy remains. |
| V15 Secure Coding and Architecture | Applicable | Explicit boundaries, locked dependencies, vulnerability/support policy, resource profile, package inventory/checksums, SPDX generation, and provenance/SBOM attestation workflow exist; hosted run and deployment evidence remain. |
| V16 Security Logging and Error Handling | Applicable | Hash-chain audit, generic API errors, bounded OTLP signals, live leakage regressions, event inventory, redaction, health, dashboards, alerts, retention, and response runbooks exist. |
| V17 WebRTC | Not applicable | GridStory has no peer connection, signaling, media negotiation, or WebRTC data channel. Reassess if added. |

Every ASVS chapter is explicitly represented so an omitted area cannot be mistaken for a security decision.

## Evidence summary

The machine profile contains 30 stable `GS-SEC-###` requirements:

- Verified controls cover trusted-layer validation, parameterized persistence, SVG sanitization, atomic operations, exact origin messaging, tenant-bound deny-by-default authorization, credential/cache containment, signed token validation, approved platform cryptography, capability-isolated plugin execution, and fail-closed generic errors.
- Partial controls cover structured rendering, SSRF/egress, browser headers, GraphQL cost/introspection, upload limits/scanning, external adapter configuration, sensitive-data policy, and minimal API fields.
- Planned controls cover trusted production intermediary/identity configuration, cryptographic inventory/secret lifecycle, and production fail-safe configuration. Anti-automation, vulnerability/component lifecycle, GraphQL/upload bounds, and the resource-demand inventory are partial because distributed/deployment or hosted-release evidence remains.
- Conditional controls cover deployed trusted-proxy/TLS/service communication and customer-specific IdP/secret-manager conformance; the repository-owned OIDC binding and persistent-session lifecycle are verified.

Evidence paths point to repository code, tests, or documentation. Operational verification names are intentional future evidence and are linked to tasks. `pnpm security:check` rejects verified requirements without local evidence, malformed or duplicate IDs, unknown threat references, missing chapter coverage, invalid ASVS references, and unresolved partial/planned/conditional controls without stable task ownership.

## M5-002 evidence update

The profile treats `GS-SEC-024` credential/cache containment as verified and extends `GS-SEC-015` evidence with tenant-bound OIDC role assignments, tenant-bound service grants, canonical scope serialization, hostile-adapter checks, and cross-scope queue/repository tests. Production identity/session and trusted-proxy requirements remain conditional or planned under M6-002 and are an explicit M5-008 beta blocker.

## M5-003 evidence update

`GS-SEC-030` and `THREAT-0023` now cover publisher-bound Ed25519 manifest verification, exact SHA-256 artifact binding, SDK/protocol compatibility, tenant-scoped constrained grants, explicit lifecycle authorization/revocation, durable SQLite/PostgreSQL state, and bounded invocation through an injected external-runtime adapter. `GS-SEC-015` and `GS-SEC-019` include the plugin authorization and platform-crypto evidence. Arbitrary packages are never imported into the control-plane process, and the in-process harness is test-only.

This repository evidence does not certify the operator-provided OS/container sandbox or establish marketplace package safety. M5-007 supplies the repository dependency/SBOM/provenance process; the M5-008 review records hosted execution and runtime hardening as absent release/deployment evidence, while publisher/marketplace review remains M6-005.

## M5-004 evidence update

`GS-SEC-028` is now verified for current capabilities through an explicit event/signal inventory, official optional OTLP log/metric/trace exporters, reviewed low-cardinality attributes, live three-signal and negative-leakage tests, minimal public health, authorized bounded Collector health, a fail-closed Collector redaction template, dashboards, alerts, retention targets, and incident procedures. The immutable database audit remains the source of truth and is not replaced or shortened by telemetry.

M6-002 now contributes authentication, credential lifecycle, session, WebAuthn, and break-glass event types to the protected inventory without credential or assertion payloads. Backend access/deletion enforcement, append-only database policy, event export, TLS/network policy, secret-manager lifecycle, and deployed Collector conformance remain operator/GA evidence.

## M6-002 evidence update

`GS-SEC-013`, `GS-SEC-014`, and `GS-SEC-017` are verified for the repository-owned production boundary: maintained OIDC/SAML/WebAuthn adapters, durable one-time protocol state, tenant-scoped SQLite/PostgreSQL identity documents, hashed opaque sessions/credentials, lifecycle revocation, SCIM ETags/isolation, explicit role mappings, WebAuthn counter updates, and audited one-time break-glass controls. Focused core/API/client/Studio tests include replay, dev-header spoofing, cross-tenant SCIM denial, stale ETags, restart reconstruction, deprovisioning, and keyboard-operable administration.

This does not clear `GS-SEC-010` or `BETA-003`: a target deployment must still prove trusted proxy/header stripping, TLS and secure cookies, actual IdP issuer/certificate/client configuration, customer interoperability, secret-manager rotation, external abuse monitoring, and operational approval/revocation procedures.

## M5-005 evidence update

`THREAT-0024`, `GS-SEC-021`, and `GS-SEC-023` now cover whole-database backup classification, credential-safe native tooling, minimal checksummed manifests, fail-closed format/integrity/table verification, isolated absent/empty restore targets, live SQLite restore, disposable PostgreSQL logical restore, bounded API/worker shutdown, and exact two-generation readiness preflight. The recovery and rollout runbook separates logical dumps from PostgreSQL base-backup plus continuous-WAL PITR and requires stated, measured deployment RPO/RTO.

Repository evidence does not certify backup storage encryption/retention/access logging, secret rotation, a managed database's physical PITR chain, object-store recovery, or an orchestrator's traffic/termination/rollback behavior. Those remain deployment and GA evidence.

## M5-006 evidence update

`GS-SEC-003` now links the structured renderer to isolated React 18.3 and current React 19 SPA/SSR/static/hydration evidence, unsuppressed rendered WCAG checks, and a documented boundary that leaves arbitrary component encoding, semantics, styles, and CSP with the consuming application. Chromium, Firefox, and WebKit execute the complete origin-bound iframe/standalone preview plus edit/review/publish/delivery journey.

`GS-SEC-009` remains partial by design. The repository verifies exact origins and private asset headers and publishes intentional Studio-versus-preview `frame-ancestors`, CSP, nosniff, referrer, permissions, TLS, and cache guidance. GridStory does not serve a consumer's production HTML, so the target deployment must prove its actual headers and Apple/branded-browser behavior before clearing `BETA-003`/`RC-006`.

## M5-007 evidence update

`GS-SEC-007`, `GS-SEC-011`, `GS-SEC-012`, `GS-SEC-025`, and `GS-SEC-026` now link one machine-readable resource profile to explicit API/asset/archive/GraphQL guards, boundary tests, schema-validated SQLite/PostgreSQL benchmark reports, private vulnerability reporting and remediation targets, scheduled/PR OSV scanning, bounded dependency updates, reviewed private package inventories, SHA-256 verification, pinned SPDX generation, and GitHub/Sigstore provenance/SBOM attestation workflows.

Those requirements remain partial by design: Fastify injection is not a network/deployment saturation test, the plugin limiter is process-local, production asset scanners/quotas and GraphQL introspection/edge controls are operator evidence, content/audit retention awaits M6-003, and workflow configuration does not prove that a hosted attestation exists. M5-008 records those absences as release-blocking no-go criteria instead of treating configured workflows or documentation as executed proof.

## M5-008 evidence update

The dated machine-validated review of candidate `b31193a` derives `alpha=go`, `beta=no-go`, `rc=no-go`, and `ga=no-go`. Private technical alpha is supported only inside the published local/pre-v1 boundary. The review does not downgrade any residual requirement to not applicable and does not treat repository automation as partner, deployment, hosted-artifact, independent-assessor, or production-operations evidence.

Stable criteria now expose the unresolved security acceptance directly: production identity/proxy/provider controls are `BETA-003`; disabled-author and assistive-technology evidence is `BETA-005`; hosted SBOM/provenance is `RC-004`; independent security/accessibility acceptance is `RC-005`; production-shaped capacity/recovery/rollout is `RC-006`; and operating/security/privacy ownership is `GA-003`. `pnpm readiness:check` rejects external-only proof marked met, missing evidence paths, required not-applicable decisions, and any beta/RC/GA prerequisite bypass.

## Highest-priority gaps

| Gap | ASVS areas | Owner task |
|---|---|---|
| Production database/object-store tenant-policy conformance | V8, V14, V15 | `BETA-003`, `RC-006` |
| Live IdP, secret-manager, secure-cookie/TLS, and trusted-proxy conformance | V4, V6, V7, V10, V13 | Repository boundary delivered by M6-002; deployment acceptance under `BETA-003` |
| Plugin runtime OS/container hardening, package review, and publisher enrollment | V8, V11, V13, V15 | M6-005; deployment evidence |
| Telemetry backend access/deletion, Collector deployment conformance, and production identity/credential event sources | V11, V13, V14, V16 | `BETA-003`, `GA-003`; event sources M6-002 |
| Backup storage/physical PITR, secret rotation, and orchestrator rollout proof | V13, V14, V15, V16 | `RC-006`, `GA-003`; identity lifecycle M6-002 |
| Deployed HTML CSP/header conformance, arbitrary application rendering, and branded-browser/assistive-technology acceptance | V1, V3, V14 | `BETA-003`, `BETA-005`, `RC-005` |
| Hosted release attestation/SBOM verification plus deployment rate, concurrency, saturation, quota, and retention evidence | V2, V4, V5, V15 | `RC-004`, `RC-006`; retention M6-003 |
| Independent readiness/risk acceptance | All applicable chapters | `RC-005`, `GA-001` |

## How to update the profile

1. Use the exact stable ASVS release named in the profile. Do not silently switch references to the moving `master` branch.
2. Add the relevant version-qualified ASVS IDs to the chapter and GridStory requirement.
3. Link the requirement to modeled threats and concrete evidence. `verified` requires repository evidence that exists now.
4. For partial, planned, or conditional requirements, state the verification that remains and link a stable task.
5. If a chapter is not applicable, record a concrete architectural reason and a trigger for reconsideration.
6. Run `pnpm security:check`, proportionate tests, and a human evidence review.

The ASVS source release is `https://github.com/OWASP/ASVS/tree/v5.0.0/5.0`. Reviewers should compare requirement wording there; this repository records GridStory obligations and traceability rather than reproducing the standard.
