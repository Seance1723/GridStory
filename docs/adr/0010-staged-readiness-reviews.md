# ADR 0010: Evidence-linked staged readiness reviews

- Status: Accepted
- Date: 2026-08-21
- Task: M5-008

## Context

GridStory has extensive repository evidence for its current framework-neutral CMS foundation, including unit and integration tests, three-engine browser checks, two React majors, SQLite/PostgreSQL conformance, backup/restore drills, application-pipeline benchmarks, reviewed package archives, and configured SBOM/provenance workflows. That evidence does not prove that design partners have succeeded with the product, that an operator deployment is safe, that hosted attestations exist, or that an independent assessor has accepted security and accessibility risk.

M5-008 asks for alpha, design-partner beta, release-candidate, and GA readiness reviews. The review process therefore has to preserve two truths at once: repository gates are real evidence, and missing human, hosted, or deployment evidence must produce a no-go instead of being silently treated as not applicable. A completed no-go review is useful delivery evidence; a fabricated go decision is not.

## Prior-art comparison

| Approach | Evidence and fit | Decision |
|---|---|---|
| Do nothing; infer readiness from completed roadmap checkboxes | Zero implementation cost, but conflates implementation completion with user, deployment, and release acceptance and provides no durable decision record. | Rejected. |
| Keep a free-form Markdown launch checklist | Easy to edit and review, but cannot reliably detect missing stages, contradictory outcomes, dead evidence paths, or prerequisite bypass. | Rejected as the only gate; retained for the human guide. |
| Adopt a hosted release/project-governance platform | Can collect approvals and workflow state, but adds external state, permissions, vendor coupling, and partner-data handling before a release organization or deployment exists. | Deferred until a real release team selects its system of record. |
| Treat every missing external check as not applicable and pass from repository tests | Produces a convenient result but contradicts the security, accessibility, capacity, identity, and supply-chain claim boundaries already published. | Rejected. |
| Check in one evidence-linked JSON review plus a small repository-native validator and human guide | Reuses existing artifacts, stays reviewable with the source, can fail closed on overclaims, and records no personal or customer data. | Selected. |

## Necessity gate

1. **Traceable:** M5-008 explicitly requires four readiness reviews, while M5-006/M5-007 and the security profile assign independent, hosted, and deployment acceptance to this stage.
2. **Not already solved:** `TASKS.md` records implementation evidence and the release workflow can create artifacts, but neither represents stage prerequisites, human/deployment evidence, go/no-go decisions, or the reason a stage cannot advance.
3. **Minimal form:** one dated JSON review, one direct validator, and one concise guide. Do not add a release database, approval service, dashboard, partner CRM, or publication automation.
4. **Dependency justified:** no dependency is added; structural and path checks use Node built-ins, and existing test/release commands remain the evidence producers.
5. **Rule of three:** model only the four named stages and their concrete criteria; introduce no generic governance engine or configurable policy language.
6. **Reversible:** the artifacts, script, documentation, and check hook are additive and removable in one revert, with no package publication, deployment, migration, credential, or user-data effect.

## Decision

Readiness is assessed in the fixed order `alpha`, `beta`, `rc`, `ga`. Each stage records required criteria as `met` or `unmet`, evidence type and location, an accountable owner, and a next action. A stage may be `go` only when every required criterion is met and the preceding stage is also `go`. Any unmet required criterion deterministically makes the stage `no-go`; later stages may still be reviewed to expose their additional blockers, but they cannot advance.

Repository evidence points to committed files. Executed evidence records a sanitized command/result without embedding logs or credentials. External evidence is never inferred: absent partner sessions, independent assessments, deployment conformance, or hosted attestations remain `unmet`. The review artifact contains no names, contact details, customer content, tokens, environment values, or private findings.

The M5-008 review covers the last completed product candidate, commit `b31193a783bf594e41afd510683445a044a30f6e`. The review-governance commit itself does not change that candidate's product behavior. A future candidate receives a new dated review instead of rewriting this result.

## Sources

- <https://sre.google/sre-book/reliable-product-launches/>
- <https://sre.google/resources/practices-and-processes/production-launch-planning/>
- <https://www.gov.uk/service-manual/agile-delivery/how-the-alpha-phase-works>
- <https://www.gov.uk/service-manual/measuring-success/measuring-service-benefits>
- <https://csrc.nist.gov/pubs/sp/800/218/final>
- <https://docs.github.com/en/actions/concepts/security/artifact-attestations>
- <https://www.w3.org/WAI/WCAG22/Understanding/conformance.html>

## Consequences

- A repository can finish M5-008 by publishing a truthful no-go review without pretending that a release occurred.
- Review decisions become diffable and machine-checked, while actual sign-off and sensitive partner/security records remain in an approved external system when one exists.
- Repository evidence can support private technical alpha readiness, but beta, RC, and GA remain blocked until their human, deployment, independent, distribution, and hosted-artifact criteria are supplied.
- The validator prevents accidental overclaiming; it cannot judge whether an external report is high quality, so named human owners remain responsible for accepting that evidence.
