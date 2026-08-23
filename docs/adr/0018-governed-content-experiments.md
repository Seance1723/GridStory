# ADR 0018: Experiments use immutable allocation iterations and governed draft promotion

- Status: Accepted
- Date: 2026-08-23
- Task: M7-002

## Context

M7-001 provides complete-scope draft/published targeting, bounded consent-aware evaluation context, deterministic audience decisions, private preview, conservative cache guidance, optimistic memory/SQLite/PostgreSQL persistence, and a typed application boundary. It deliberately excludes random assignment, stable allocation tokens, metrics, experiment lifecycle, winner selection, and promotion.

M7-002 must add a usable experiment loop without turning GridStory into an identity store, event pipeline, analytics warehouse, or home-grown statistical authority. Assignment must remain stable without persisted subject records; a running design must not silently change; targeting and experiment drift must fail closed; guardrails must block unsafe promotion; and a winner must enter the ordinary targeting publication workflow rather than bypass it.

## Prior-art comparison

| Approach | Evidence and fit | Decision |
|---|---|---|
| Let applications randomize variants and update targeting manually | No new control-plane code, but allocation differs by application, consent and drift cannot be enforced centrally, and evidence/promotion is unauditable. | Rejected. |
| Build event ingestion plus a Bayesian/frequentist statistics engine | Can calculate winners internally, but duplicates M7-003 analytics work, creates identity/event retention risk, and would make unsupported statistical claims. | Rejected. |
| Persist every subject assignment | Strong stickiness through configuration changes, but creates a pseudonymous profile store, deletion/retention obligations, and a high-cardinality hot path. | Rejected for this slice. |
| Use an external experimentation vendor for every operation | Mature assignment and analysis, but makes the built-in self-hosted contract provider-specific and introduces credentials, egress, and availability dependencies. | Defer adapters; accept bounded aggregate evidence through a neutral contract. |
| Keep experiments inside the existing scoped personalization document; freeze the design when started; hash a random per-experiment UUID into weighted buckets; ingest only aggregate snapshots; enforce simple declared guardrails; promote into the draft | Reuses consent, targeting, variants, optimistic atomic persistence, recovery, and publication. It is small, explainable, provider-neutral, and does not store assignment tokens or raw events. | Selected. |
| Do nothing / keep M7-001 only | Avoids complexity but leaves the explicit experiment lifecycle, allocation, guardrail, metric, and promotion roadmap gap open. | Rejected. |

## Decision

Experiments are retained inside the existing complete-scope personalization document so lifecycle transitions and winner promotion share one optimistic atomic write. A design names one targeting resource and either its fallback or one audience rule, a control variant, weighted variants totaling 10,000 basis points, one required consent purpose, one primary metric, optional absolute guardrail metrics, a minimum duration, minimum sample sizes, and a maximum allowed allocation deviation. Only a draft design is editable. Starting freezes that design, pins the exact published targeting revision, and rejects another running or paused experiment on the same target.

The public allocation call evaluates the pinned published targeting first. The experiment participates only when it is running, its target is the actual matched target, its required purpose is granted and not denied or suppressed by configured GPC, the current published targeting revision still matches, and a random UUID assignment token is present. GridStory hashes complete scope, experiment ID, experiment revision, and the token into one of 10,000 deterministic buckets. It never persists, logs intentionally, returns, or sets a cookie for the token. Applications must generate an unpredictable token per experiment and must not derive it from an email, account ID, or another identity. Non-participants receive the ordinary current targeting variant and a bounded reason.

Experiment assignment responses are always private/no-store and include no audience ID, raw targeting values, assignment token, or bucket. Changing a running allocation requires cancelling/completing it and creating a new draft experiment; pause/resume retains the same frozen revision and assignment. A changed published targeting revision makes allocation non-participating rather than silently reshuffling or applying stale target assumptions.

GridStory defines metric contracts and accepts authenticated, immutable aggregate snapshots only. Each snapshot is bound to an evidence identifier and SHA-256 digest and contains complete per-variant exposure counts plus per-metric sample sizes and scalar aggregate values. It contains no subject or event rows. GridStory checks minimum samples, declared absolute guardrail thresholds, and allocation deviation from configured weights. A failed evaluable guardrail pauses a running experiment. These checks are operational gates, not statistical significance, causal inference, or proof that the upstream analytics calculation is correct.

Completion freezes the experiment but permits later aggregate snapshots. Promotion requires a completed experiment, the exact selected snapshot, sufficient samples, acceptable allocation, passing guardrails, unchanged pinned targeting, and an operator-selected winner. A treatment winner must improve the declared primary aggregate in its configured direction relative to control. Promotion changes the matching rule or fallback only in the targeting draft and records the evidence and actor in experiment history within the same document save. It never publishes targeting; existing preview/review/publication remains mandatory.

## Necessity gate

1. **Traceable:** M7-002 explicitly requires experiment lifecycle, allocation, guardrails, metrics contracts, and winner promotion.
2. **Not already solved:** M7-001 can select variants deterministically by audience but has no randomization unit, weight allocation, experiment state/evidence, guardrail evaluation, or governed promotion.
3. **Minimal form:** one embedded experiment list, one service, one anonymous allocation route, aggregate evidence, and draft-only promotion are the smallest complete loop. Event ingestion, statistical analysis, layers, holdouts, automatic decisions, and vendor adapters are excluded.
4. **Dependencies justified:** no dependency is added. Node SHA-256, Zod, and the existing repository are sufficient.
5. **Rule of three:** no provider/plugin abstraction or generic statistics framework is introduced. The service implements only this concrete content-experiment workflow.
6. **Reversible:** routes, schemas, UI, and embedded records are additive. Applications can stop allocation calls and use ordinary targeting before reverting the commit; retained experiment fields remain inert.

## Sources that changed the decision

- [Unleash activation strategies](https://docs.getunleash.io/concepts/activation-strategies) uses normalized hashing to provide stable gradual rollout, and its [A/B testing guide](https://docs.getunleash.io/guides/a-b-testing) describes weighted variants and stickiness. GridStory adopts deterministic weighted assignment but requires a random per-experiment token and stores no assignment document.
- [GrowthBook sticky bucketing](https://github.com/growthbook/growthbook-python#sticky-bucketing) explains that deterministic hashing is sufficient while a design is stable and persistent assignment is needed mainly across design changes. GridStory freezes a running design and therefore avoids persistent subject assignments.
- [LaunchDarkly experiment allocation](https://launchdarkly.com/docs/home/experimentation/allocation) treats allocation changes as new iterations and warns that audience changes can invalidate results; its [health checks](https://launchdarkly.com/docs/home/experimentation/health-checks) make allocation mismatch and targeting drift visible. GridStory makes running design immutable and blocks allocation/promotion on revision drift.
- [LaunchDarkly experiment results](https://launchdarkly.com/docs/home/experimentation/results-data) distinguishes samples, primary results, health, and the shipped variation. GridStory records the same evidence categories but deliberately does not reproduce LaunchDarkly's statistical engine.
- [Statsig metric configuration](https://docs.statsig.com/statsig-warehouse-native/features/configure-an-experiment) distinguishes primary metrics from secondary/guardrail metrics, while [Statsig metrics](https://docs.statsig.com/metrics/how-metrics-work) supports precomputed inputs. GridStory accepts only bounded precomputed aggregate snapshots and enforces declared guardrail thresholds.
- [OpenFeature tracking](https://openfeature.dev/specification/sections/tracking/) separates evaluation from optional provider tracking. GridStory keeps raw tracking/event-provider integration deferred to M7-003 rather than coupling it to allocation.

## Consequences and revisit triggers

- Applications get reproducible assignments without a GridStory subject store, but they own consent collection, random per-experiment token generation/storage, and exposure/outcome instrumentation.
- Promotion is conservative and auditable but is not a claim of statistical significance. Operators must attach evidence from a reviewed analysis system and remain responsible for experiment design and interpretation.
- Running designs cannot be edited. Revisit explicit multi-iteration history only when a concrete ramp/reallocation workflow exists.
- Revisit event ingestion, provider adapters, and normalized exposure/outcome events in M7-003; revisit layers, holdouts, mutual exclusion beyond the same target, and persistent sticky assignment only with measured demand and a privacy/retention design.
