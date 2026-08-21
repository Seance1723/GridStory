# Security policy

## Supported versions

GridStory has not published a v1 release. Security fixes are developed on `main` and included in the next reviewed prerelease or release evidence set. Historical commits, locally modified forks, and private `0.0.0` package archives are not separate supported release lines.

| Version or line | Security updates |
|---|---|
| Current `main` before v1 | Yes |
| Latest reviewed prerelease after one exists | Yes |
| Older prereleases and commits | No; upgrade to the current reviewed line |

The exact runtime, React, and browser matrix is in [SUPPORT.md](SUPPORT.md). This policy does not turn the current private workspace archives into public packages or a production service.

## Report a vulnerability privately

Do not open a public issue, discussion, or pull request for a suspected vulnerability. Use GitHub's private vulnerability report form for this repository:

<https://github.com/Seance1723/GridStory/security/advisories/new>

Include the affected commit/version, configuration, impact, reproduction steps or proof of concept, and any suggested mitigation. Remove real credentials, customer content, personal data, and tenant data; use minimal synthetic evidence. Repository owners must keep GitHub private vulnerability reporting enabled. If the private form is unavailable, do not disclose the details publicly—contact a repository owner through an existing private channel and ask for a private advisory to be opened.

## Response and remediation targets

Targets begin when maintainers can access a complete private report. They are risk-based goals, not a paid support SLA.

| Severity | Initial acknowledgement | Triage target | Remediation or mitigation target |
|---|---:|---:|---:|
| Critical: active exploitation, cross-tenant disclosure/loss, RCE, signing or release compromise | 1 business day | 2 calendar days | 7 calendar days |
| High: material confidentiality, integrity, authorization, or availability impact | 2 business days | 5 calendar days | 30 calendar days |
| Medium: limited impact or meaningful preconditions/workaround | 5 business days | 10 calendar days | 90 calendar days |
| Low: hardening or low-impact weakness | 10 business days | 30 calendar days | Next normal release, target 180 days |

Maintainers may change severity after reproducing the issue and considering exploitability, tenant reach, required privileges, and affected deployment assumptions. An exception must record the owner, compensating controls, review date, and expiry. Critical/high fixes receive focused regression coverage, lockfile/SBOM review when components are affected, and coordinated disclosure through a GitHub security advisory when appropriate.

## Vulnerability lifecycle

1. Keep the report and reproducer private; acknowledge and assign an owner.
2. Reproduce on a supported configuration, determine affected lines/components, and assign severity.
3. Add a private regression, implement the smallest safe fix, and assess whether credentials, artifacts, tenants, or published caches require incident action.
4. Run proportionate type, test, build, benchmark, dependency, and package-evidence gates.
5. Prepare an advisory, patched commit/release evidence, upgrade/mitigation guidance, and CVE request when appropriate.
6. Publish only after a fix or documented mitigation is available, unless active exploitation requires earlier coordinated notice.

OSV-Scanner checks the pnpm lockfile on pull requests, relevant `main` changes, manual runs, and a weekly schedule. Dependabot proposes bounded pnpm and GitHub Actions updates. Automated results require human reachability, exploitability, false-positive, and breaking-change review; they do not silently rewrite the lockfile or waive the targets above.

## Supply-chain verification

The manual Release evidence workflow packs only the reviewed private workspaces, writes SHA-256 checksums, benchmarks SQLite and PostgreSQL profiles, generates an SPDX JSON SBOM with pinned Syft, and creates GitHub/Sigstore provenance and SBOM attestations. Verification commands and the exact claim boundary are documented in [Release evidence, tested limits, and support](docs/release-and-support.md).

An SBOM is an inventory, an attestation binds evidence to a workflow identity, and a checksum detects changed bytes. None proves that a component is vulnerability-free or that a deployment is secure.
