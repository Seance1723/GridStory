# Governed content experiments

GridStory M7-002 adds consent-aware weighted experiments above the published targeting contract. It manages design, lifecycle, aggregate evidence, guardrails, and an explicit draft promotion. It is not an analytics warehouse or a statistical-significance engine.

## Boundary and lifecycle

Experiments live in the same optimistic, complete-scope document as targeting. This makes a lifecycle change or winner promotion atomic with its targeting preconditions across organization, tenant, workspace, site, environment, and locale.

The lifecycle is:

1. `draft`: an authorized publisher creates or edits the design.
2. `running`: start validates the published target, pins its targeting revision, and makes the design immutable.
3. `paused`: an operator pauses it, or a failed aggregate guardrail pauses it automatically. No participant allocation occurs while paused.
4. `completed`: allocation stops and retained evidence can be reviewed for promotion.
5. `cancelled`: allocation stops permanently and history remains.
6. `promoted`: an operator-selected treatment has been written to a new targeting draft revision. It is still not published.

Only a draft design can change. Start rejects another running or paused experiment on the same resource plus audience placement. Resume rejects published-target drift and a latest failed guardrail. Every mutation uses the current document `expectedVersion`.

## Design contract

Each design declares:

- one target resource and an optional audience placement;
- a control variant already served at that placement;
- two to ten declared targeting variants whose positive weights total exactly 10,000 basis points;
- one previously declared consent purpose;
- exactly one primary metric and optional absolute guardrail metrics;
- a minimum sample size per metric and variant;
- a minimum duration before promotion; and
- a maximum observed-allocation deviation in basis points.

Starting also requires a current published targeting revision. Every experiment variant must exist in that published decision, and its target must still serve the declared control. These checks prevent an experiment definition from silently changing ordinary delivery semantics.

## Application allocation

The application first performs its normal consent collection and then creates a random UUID specifically for this experiment. Do not derive it from an account ID, email, device fingerprint, or another stable identifier. GridStory does not create, persist, echo, or set a cookie for it.

```ts
const assignmentToken = crypto.randomUUID();

const allocation = await client.allocateExperiment('homepage-hero-copy', {
  attributes: { market: 'uk', device: 'mobile' },
  consent: {
    grantedPurposes: ['experience-optimization'],
    deniedPurposes: [],
    globalPrivacyControl: false,
  },
  assignmentToken,
});

const component = variants[allocation.variant] ?? variants.default;
```

Reuse the same random token only for the same experiment when sticky allocation is required and the application's reviewed consent/storage policy permits it. If the application does not retain it, a new token may receive a different variant. GridStory hashes the complete scope, experiment ID and revision, and token with SHA-256 and maps the result into the declared 10,000-basis-point ranges.

`Sec-GPC: 1` forces the request's GPC signal to true. A visitor participates only when the experiment is running, its pinned targeting revision is still published, the ordinary published targeting decision reaches its placement, and the declared purpose is granted and not suppressed by GPC. Otherwise the response returns the ordinary published targeting variant with `participating: false` and a reason such as `inactive`, `consent-required`, `not-eligible`, or `targeting-drift`.

Every allocation response is `Cache-Control: private, no-store` and also contains `cache.mode: "no-store"`. Do not place assignments or experiment-rendered responses in a shared cache. The response contains no assignment token, bucket, audience identity, or raw evaluated value.

## Aggregate metric evidence

GridStory accepts authenticated aggregate snapshots only. It has no raw exposure, conversion, user, session, or event ingestion route in M7-002. An external analytics system computes the aggregate and retains its supporting evidence.

A snapshot supplies:

- an immutable snapshot ID;
- an external evidence ID and the evidence artifact's SHA-256 digest;
- the observation time;
- every declared variant exactly once with aggregate exposure count; and
- every declared metric exactly once per variant with sample size and aggregate value.

The control plane records the authenticated actor/time, recomputes guardrails, and keeps the snapshot with the experiment. Snapshot IDs cannot be overwritten or reused.

GridStory checks observed allocation against each configured weight, minimum samples for every metric and variant, and every absolute `gte` or `lte` guardrail. A failure automatically pauses a running experiment. Missing samples produce `insufficient-data`; they do not imply success and cannot support promotion. A passing later snapshot is required before resuming a guardrail-paused experiment.

GridStory does not compute confidence intervals, p-values, Bayesian probabilities, multiple-testing corrections, novelty effects, or an automatic winner. The external analyst remains responsible for metric definitions, exposure attribution, bot/internal-traffic policy, late data, statistical validity, and evidence integrity.

## Winner promotion

Promotion is an explicit authenticated operation. It requires:

- a completed experiment;
- a non-control treatment declared by the design;
- a retained selected snapshot with sufficient samples, acceptable allocation, and passing guardrails;
- elapsed minimum duration;
- unchanged published targeting and an unchanged control in both published and draft targeting; and
- an operator-selected treatment whose primary aggregate improves in the declared direction.

On success, one optimistic write changes the matching audience rule or fallback in a new targeting draft revision and records the actor, reason, selected snapshot, evidence digest, winner, time, and draft revision. It never publishes. Use the ordinary targeting preview and exact-draft publication workflow before application delivery changes.

Retaining the control requires no promotion. GridStory intentionally refuses to label or choose a statistically significant winner.

## API and authorization

Management operations are authenticated and return `private, no-store`:

- `GET /api/v1/experiments`
- `PUT /api/v1/experiments/:experimentId`
- `POST /api/v1/experiments/:experimentId/transition`
- `POST /api/v1/experiments/:experimentId/metrics`
- `POST /api/v1/experiments/:experimentId/promote`

The allocation route is application-facing and published-only:

- `POST /api/v1/experiments/:experimentId/allocate`

Experiment read, manage, metric, and promotion permissions are distinct. The reference publisher role receives them; administrators retain the wildcard. Delivery callers cannot read designs or evidence. Complete scope is derived through the same API identity/scope boundary as targeting and is enforced again by persistence.

## Operations, recovery, and rollback

SQLite and PostgreSQL persist experiments with the targeting document. Native backups and restores include design, lifecycle evidence, snapshots, guardrail state, and promotion history. Recovery tests restore a running experiment and PostgreSQL restart tests verify allocation from the retained pinned revision.

Before enabling application calls, validate consent/GPC mapping, assignment-token generation and retention, representative targeting eligibility, no-store behavior, external aggregate computation, and the pause/incident path. Monitor allocation deviation and metric freshness outside GridStory; M7-002 has no scheduler or warehouse adapter.

To stop an experiment, pause or cancel it and have the application render the returned ordinary targeting baseline. To undo an un-published promotion, restore the prior target into a newer draft. If it was published, create and publish a new rollback draft; never rewrite experiment or targeting history. A code rollback must first stop allocation calls and does not purge application/CDN state.

External analytics/warehouse adapters and normalized events belong to M7-003. Cookies/profiles, raw event ingestion, automatic winners/publication, statistical claims, progressive rollouts, cross-experiment layers/holdouts, CDP credentials, and third-party analytics certification remain out of scope.
