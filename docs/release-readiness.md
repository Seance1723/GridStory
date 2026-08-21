# Staged release readiness

This is GridStory's M5-008 release-governance guide and the human-readable summary of the dated review in `release/readiness/review-2026-08-21-b31193a.json`. The reviewed product candidate is commit `b31193a783bf594e41afd510683445a044a30f6e`; the M5-008 governance change does not alter that candidate's runtime behavior.

## Current decision

| Stage | Decision | Meaning |
|---|---|---|
| Private technical alpha | **Go** | Controlled evaluation may use synthetic or explicitly approved non-customer data inside the documented local/pre-v1 support boundary. |
| Design-partner beta | **No-go** | No approved partner cohort, production-shaped environment, outcome/feedback record, or live disabled-author/assistive-technology evidence was supplied. |
| Release candidate | **No-go** | Beta is no-go; versioned distribution, promised framework adapters, hosted SBOM/attestations, independent assessments, and production-shaped rehearsals are absent. |
| v1 GA | **No-go** | RC is no-go; no partner outcome history, production operating acceptance, complete versioned v1 surface, or published supported release exists. |

This completes the four requested readiness reviews; it does not complete the stages themselves. A no-go is not a failed validator or an application defect. It is the required result whenever evidence needed for a release claim is absent.

## Observed repository execution

The application/runtime source is unchanged from `b31193a`; the working changes used during these commands add only readiness governance and documentation. On 2026-08-21 the review observed:

| Command/evidence | Result |
|---|---|
| `pnpm readiness:check` | Current review valid; nine malformed/overclaim variants rejected. |
| `pnpm check` | Lint, format, boundaries, ledgers, security, tenant scope, readiness, generated schema, types, 200 tests with four intentional PostgreSQL-only skips, and all production builds passed. |
| `pnpm test:e2e` | 12/12 accessibility and vertical-slice checks passed across Chromium, Firefox, and WebKit. |
| `pnpm test:compatibility` | Five React 19 tests, React 18.3.1 Vite/SSR certification, and the React 19 Vite build passed. |
| `pnpm test:recovery` | 10/10 backup, restore, shutdown, worker-drain, and rollout checks passed. |
| `pnpm test:postgres` | Eight core plus two API PostgreSQL 17 tests passed; native dump/delete/isolated restore recovered one published entry. |
| SQLite benchmark | 250 entries; read/query/GraphQL/write p95 2.234/26.117/27.208/7.859 ms; 6,219.518 published reads/s; 151 MiB peak RSS; passed published budgets. |
| PostgreSQL benchmark | 250 entries; read/query/GraphQL/write p95 17.904/46.476/35.952/44.438 ms; 1,920.824 published reads/s; 141 MiB peak RSS; passed published budgets. |
| Local release evidence | At review time, five private archives packed and the six-artifact SHA-256 manifest verified; `BUG-0243` recorded the then-missing package README/SPDX metadata. |

No hosted workflow, attestation verification, production deployment, partner session, independent assessment, or public publication was run. Those are decision inputs that require external authority and state, and remain no-go criteria.

Post-review update: M5-009 resolved `BUG-0243` through `BUG-0247` for a future candidate by requiring package README/SPDX/canonical-license metadata and proving the exact tarballs install, execute, and type-check in an isolated offline consumer. This does not rewrite the `b31193a` review or clear the remaining `RC-003` adapter/version/distribution requirements.

Post-review update: M6-002 adds the future candidate's repository-owned OIDC/SAML/WebAuthn/SCIM boundary, durable sessions and role mappings, break-glass controls, and focused security evidence. This does not rewrite the immutable `b31193a` review or mark `BETA-003` met: live IdP interoperability, trusted-proxy/TLS/header stripping, secure-cookie deployment, secret-manager rotation, provider controls, and named operational acceptance remain external/deployment evidence.

## Decision rules

Stages are always reviewed in the order `alpha` → `beta` → `rc` → `ga`. Every criterion has a stable stage ID, an accountable role, an action, and evidence. Required criteria can be only `met` or `unmet`; they cannot be waived as not applicable. A stage is `go` only when every required criterion is met and its predecessor is also `go`. Later stages are still assessed after an earlier no-go so their additional blockers are visible, but they cannot advance.

Evidence is deliberately classified:

- **Repository:** a committed source, test, policy, runbook, or immutable review artifact. The validator requires the path to exist and stay inside the repository.
- **Executed:** a sanitized command/result observed for the exact candidate. Logs, credentials, connection strings, customer data, and private findings do not belong in the artifact.
- **External:** partner consent/research, deployment acceptance, assessor reports, hosted artifacts/attestations, legal decisions, or human sign-off held in an approved external system. A missing external record is never inferred from repository quality.

The current review is a repository self-review. It is not independent security, accessibility, privacy, legal, operations, or customer acceptance.

## Stage intent

### Private technical alpha

Alpha proves that the smallest product direction is runnable and that its riskiest repository assumptions have executable coverage. Access remains controlled; participants receive the pre-v1 support boundary; no public package, production SLA, or customer-data promise is implied.

### Design-partner beta

Beta needs representative partners, agreed tasks and success measures, consent-safe feedback handling, a production-shaped private deployment, named response owners, and user evidence. Repository automation is an input, not a substitute for partner outcomes or live assistive-technology sessions.

### Release candidate

An RC is an immutable, versioned distribution candidate. It needs beta go, the promised framework matrix, independent security/accessibility review, hosted SBOM and provenance/SBOM attestations for exact digests, and production-shaped upgrade, rollback, restore, saturation, and incident rehearsals. A workflow file is not an issued attestation.

### v1 GA

GA promotes the exact accepted RC only after representative outcome evidence, complete supported scope, production operating ownership, security/accessibility risk acceptance, public versioned artifacts, consumer installation/upgrade proof, and a v1 support lifecycle exist. A passing source repository alone cannot establish those facts.

## Current blockers and owners

The JSON review is authoritative for complete wording. The release-critical groups are:

| Criteria | Missing evidence | Accountable roles / existing roadmap ownership |
|---|---|---|
| `BETA-002`, `BETA-004`, `GA-002` | Design-partner recruitment, consent-safe research, success measures, outcomes, and feedback closure | Product and user-research owners |
| `BETA-003`, `RC-006`, `GA-003` | Live IdP/proxy/TLS/secret-manager identity conformance, provider storage/scanning/telemetry, capacity, recovery, rollout, incident, and operating acceptance | Deployment/reliability/security owners; M6-002 supplies the application identity boundary and M6-003 owns retention |
| `BETA-005`, `RC-005` | Live disabled-author/assistive-technology sessions and independent security/accessibility assessment | Accessibility, security, research, and release owners |
| `RC-003`, `GA-004`, `GA-005` | Next.js/React Router certification, approved version/distribution, complete v1 scope, install/upgrade proof, and v1 support line | Framework integration, product, release, and support owners |
| `RC-004` | Hosted SPDX artifact and independently verified provenance/SBOM attestations for exact RC digests | Release engineering owner |

No partner names, contact details, customer content, telemetry extracts, credentials, private vulnerability details, or assessor findings should be committed. Store them in a separately approved system and put only a non-sensitive reference and decision in a future review.

`M5-009` completed the first repository follow-up: the five archives now have publication-ready README/license metadata plus isolated consumer-install verification. The other `RC-003` adapter/version/distribution requirements remain no-go inputs.

## Validation and future reviews

```bash
pnpm readiness:check
```

The command validates the current artifact and runs negative self-tests for missing/reordered stages, invalid candidate identities, duplicate criteria, repository path traversal, external-only proof marked met, beta/RC prerequisite bypass, and required criteria marked not applicable. It is part of the root lint/check path.

A materially changed candidate receives a new dated JSON artifact; do not rewrite this review. Copy the shape, update the full candidate commit, rerun every applicable gate, replace only evidence actually observed, and obtain named external sign-off outside the repository before changing an external criterion to `met`.

## Sources

- [Google SRE: Reliable Product Launches at Scale](https://sre.google/sre-book/reliable-product-launches/)
- [Google SRE: Creating a Production Launch Plan](https://sre.google/resources/practices-and-processes/production-launch-planning/)
- [GOV.UK: How the alpha phase works](https://www.gov.uk/service-manual/agile-delivery/how-the-alpha-phase-works)
- [GOV.UK: Measuring service benefits through beta and live](https://www.gov.uk/service-manual/measuring-success/measuring-service-benefits)
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [W3C WCAG 2.2 conformance guidance](https://www.w3.org/WAI/WCAG22/Understanding/conformance.html)
