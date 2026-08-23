# ADR 0017: Targeting is consent-aware, deterministic, and cache-explicit

- Status: Accepted
- Date: 2026-08-23
- Task: M7-001

## Context

GridStory already has complete hierarchical scope, authorization, immutable content revisions, published-only delivery, private draft preview sessions, explicit cache scope, optimistic memory/SQLite/PostgreSQL document repositories, and typed universal clients. It does not have reusable audiences, a bounded evaluation context, consent-purpose enforcement, deterministic content-variant decisions, a targeting preview, or a safe contract for application-owned edge caching.

M7-001 must add those capabilities without turning the CMS into a customer-profile database, interpreting privacy law, introducing experiment allocation that belongs to M7-002, accepting raw identifying request data, allowing draft policy into public decisions, or letting a cache omit an input that changes the result.

## Prior-art comparison

| Approach | Evidence and fit | Decision |
|---|---|---|
| Let each application own targeting and cache keys | Keeps GridStory small, but duplicates consent checks, provides no shared preview or governance, and cannot meet M7-001. | Rejected. |
| Store user profiles and evaluate arbitrary expressions in the CMS | Enables rich segmentation, but creates a high-risk identity/profile store, unbounded cardinality, difficult purpose limitation, and a cache-poisoning surface. | Rejected. |
| Delegate every decision to a CDP or flag vendor | Mature providers can supply segments and low-latency evaluation, but makes the built-in contract provider-specific and unavailable to self-hosted users. | Defer provider adapters; accept application-provided bounded traits through one neutral contract. |
| Pre-render and cache every audience/variant combination | Preserves fast delivery for small matrices, but the product of attributes can explode and personal inputs must never enter shared cache keys. | Expose shared-cache guidance only for bounded public inputs; applications choose precomputation later. |
| One scoped draft/published document, allowlisted typed attributes, ordered first-match audiences, a fallback variant, hypothetical preview, and stateless published decisions | Reuses current persistence and security boundaries, is deterministic on server or edge runtimes, exposes exactly why caching is safe or unsafe, and avoids persistent profiles. | Selected. |
| Do nothing | Avoids implementation work but leaves the explicit roadmap task and privacy/cache gap open. | Rejected. |

## Decision

Create one versioned personalization document per complete content scope. It contains a mutable draft revision and an optional immutable published snapshot. A revision defines bounded consent purposes, typed targeting attributes, reusable audiences, and resource decisions. Publishing copies the exact expected draft revision; public evaluation reads only that published copy. Draft mutations and preview responses remain authenticated and `private, no-store`.

Attributes are explicit metadata, not stored people. Each attribute has a stable key, source, type, bounded allowed values where applicable, classification (`public` or `personal`), and required consent purposes. Personal attributes require at least one purpose. Conditions may reference only declared attributes and declared finite values. Request context rejects unknown, mistyped, or out-of-range traits. Raw emails, account IDs, IP addresses, user-agent strings, cookies, free-form referral URLs, and other arbitrary identifiers are outside the contract. Built-in inputs are normalized low-cardinality values for locale, market, device class, referral category, campaign, authentication state, and application traits.

Each consent purpose has an explicit `honorGlobalPrivacyControl` flag. Evaluation uses the caller's granted and denied purpose identifiers and the request's GPC signal. GPC suppresses only purposes configured to honor it; GridStory does not claim that GPC controls every first-party personalization use or select a legal interpretation for a customer. Missing or denied required consent makes the affected condition unavailable and the audience cannot match.

Audiences are reusable conjunctions of bounded conditions with unique priorities. Resource decisions map audiences to variants in ascending priority and end in a required fallback variant. The first matching audience wins; duplicate priorities, dangling references, duplicate resource rules, and unknown attributes, purposes, or values are invalid configuration. There is no random assignment, percentage split, targeting key, sticky identifier, metric, winner, or experiment state in M7-001.

Authenticated preview evaluates a caller-supplied hypothetical context against the draft and may return a boolean-only condition trace. It does not fetch, search for, impersonate, or persist a protected user, and it never creates a published decision or cache entry. The public edge endpoint is stateless, returns only the selected variant and bounded reason metadata, does not expose internal audience identity or raw input values, and uses the published snapshot for the exact scope. Authenticated private preview retains the audience/condition explanation.

Every edge result includes cache guidance. A shared cache key is emitted only when every evaluated input that can affect the result is a public, bounded attribute approved for shared caching; fixed-length SHA-256 digests bind the complete tenant scope and canonical decision-input set alongside published revision and resource. Any personal, authentication, consent-dependent, or non-shared attribute yields `private`; invalid, missing, or unpublished decisions use `no-store`. The decision API response itself remains `private, no-store`; an application-owned edge may use the returned shared key only when guidance says `shared`. Publishing changes the revision and cache tag so prior decisions cannot collide. Preview credentials, draft configuration, raw traits, and personal values never enter published caches.

## Necessity gate

1. **Traceable:** M7-001 and roadmap section 5.12 explicitly require audiences, consent-aware attributes, rule variants, safe preview, edge decisions, and cache-key guidance.
2. **Not already solved:** content queries select entries, preview sessions transport draft content, authorization selects allowed actions, and application code can branch locally; none defines audience reuse, consent gating, or a complete decision cache key.
3. **Minimal form:** one document, one deterministic evaluator, one private preview, one public published-only decision route, and one Studio workbench are the smallest usable vertical slice. Profiles, CDP network adapters, behavioral collection, experiments, recommendations, and layout-flash integration are excluded.
4. **Dependencies justified:** no dependency is added. Zod contracts, existing repositories, and platform-neutral string normalization are sufficient.
5. **Rule of three:** one audience model immediately supports locale, market, device, referral category, campaign, authentication, and application traits; one decision contract serves server, browser-safe core consumers, and application edge runtimes.
6. **Reversible:** schemas, repository tables, routes, UI, and documentation are additive. Reverting the commit disables targeting without rewriting content or external traffic state; applications must stop consuming the endpoint before rollback.

## Sources that changed the decision

- [W3C Privacy Principles](https://www.w3.org/TR/privacy-principles/) requires data minimization and purpose limitation for personal data. The contract therefore accepts only declared bounded attributes, requires purposes on personal inputs, and persists configuration rather than subject profiles.
- [W3C Global Privacy Control](https://www.w3.org/TR/gpc/) defines a signal for sale/sharing and cross-context targeted advertising while warning that it is not every privacy right or every first-party use. The model carries GPC explicitly and makes its effect purpose-specific instead of globally disabling all personalization.
- [Vercel Flags configuration](https://vercel.com/docs/flags/vercel-flags/dashboard/feature-flag) evaluates targeting rules top-to-bottom with a fallthrough value. GridStory adopts the deterministic first-match/fallback shape but excludes percentage allocation until M7-002.
- [Vercel Flags Explorer](https://vercel.com/docs/flags/flags-explorer) keeps overrides local to the authenticated operator's session by default. GridStory preview likewise evaluates hypothetical inputs without mutating published targeting or impersonating a real user.
- [Unleash activation strategies](https://docs.getunleash.io/concepts/activation-strategies) and [OpenFeature evaluation context](https://openfeature.dev/specification/sections/evaluation-context/) show reusable constraints over explicit evaluation context. GridStory narrows the shape further by rejecting a targeting/user key and requiring privacy metadata for every attribute.
- [Cloudflare Workers cache documentation](https://developers.cloudflare.com/workers/runtime-apis/cache/) and [cache-key guidance](https://developers.cloudflare.com/cache/how-to/cache-keys/) show that cache behavior and every varying input must be explicit, and that cookie-bearing responses are unsafe by default. GridStory therefore returns conservative application guidance and never makes the POST decision response itself publicly cacheable.

## Consequences and revisit triggers

- Applications gain one explainable targeting contract without sending or storing identities, but they must normalize source data and obtain/record consent outside GridStory.
- Strict finite attribute values reduce accidental data collection and cache-cardinality growth; revisit richer numeric/date comparisons only with concrete use cases and privacy/cache tests.
- The first-match model is predictable but authors must choose unique priorities and review shadowed audiences in preview.
- External CDP adapters may later map provider segments into the same bounded trait input; they must not inject provider credentials or raw profiles into published caches.
- Revisit stable identifiers, allocation, exposure metrics, guardrails, and winner promotion only in M7-002.
