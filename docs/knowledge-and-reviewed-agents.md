# Knowledge graph and reviewed agents

GridStory derives a private knowledge view from the content it already owns. It does not add a graph database or make graph state authoritative: relation fields and taxonomy membership remain the source of truth, and each request rebuilds only a bounded, authorization-filtered view.

## What is implemented

- `POST /api/v1/knowledge/graph` performs a cycle-safe breadth-first traversal over authorized draft or published entries. Callers choose seeds, direction, relation/taxonomy edges, content types, depth, node count, and edge count only within fixed server limits.
- `POST /api/v1/knowledge/recommendations` ranks authorized neighboring entries deterministically. Every score is the exact sum of visible direct relation, inverse relation, shared taxonomy, same-type, and bounded-path contributions.
- `GET /api/v1/knowledge/agent` and the policy/plan/review/execute routes manage a complete-scope, optimistic, private document in memory, SQLite, or PostgreSQL.
- Studio's neutral Knowledge panel exposes graph counts, explanations, policy, exact field changes and rationale, metadata-only tool traces, human review, and explicit execution.

All responses are private and `no-store`. Graph construction reauthorizes each content entry; unauthorized nodes and their edges never enter the result.

## Agent boundary

Agents are disabled by default. Enabling a policy requires an injected runtime whose ID/model matches an enabled model and immutable active prompt in the governed AI gateway. A policy positively declares content types, top-level text/slug fields, mediated tools, maximum tool calls, timeout, and plan lifetime.

The runtime receives a redacted goal, one exact saved draft target, prompt identity, and only the configured functions:

- `content.get` returns declared string fields from one authorized draft.
- `graph.explore` returns a bounded authorized draft graph.
- `recommendation.list` returns bounded explained draft recommendations.

The runtime receives no repository, database, HTTP client, network, plugin, shell, filesystem, credentials, tenant routing, publication API, or content write capability. Raw tool results are not retained; plans keep only call/tool identity, input/output digests, result count, and completion time.

Runtime output must match `gridstory.agent-draft-plan.v1`, target exactly one current draft revision, change unique policy-allowed top-level text/slug fields, and pass complete ordinary content validation. A plan contains the visible goal, summary, proposed values, rationale, immutable policy/prompt/model/target evidence, tool metadata, result checksum, digest, and expiry.

## Review and execution

`agent.review` and `agent.execute` require a human user principal; service accounts and anonymous principals fail even if granted an action string. Review is one-time and digest-bound. Approval changes no content.

Execution additionally requires ordinary `content.draft.update` authorization for the exact target. It rechecks plan expiry/digest, unchanged policy and gateway configuration, current target revision, candidate checksum, schema, and references. It persists a pending idempotent operation before using the ordinary content service. A retry returns the same receipt or reconciles a checksum-identical partially completed draft update. Publication, workflow transitions, releases, bulk edits, rich text, relations, taxonomies, components, and assets are outside this operation.

## Operations and recovery

The authoritative knowledge-agent document is included in SQLite snapshots and PostgreSQL logical backup/restore checks. Derived graphs and recommendations require no backup and are regenerated from content. Operators should monitor stable error codes and counts without logging goals, tool payloads, proposed values, draft content, credentials, or adapter diagnostics.

Production operators still own runtime isolation, provider credentials, TLS/egress, rate and cost controls, prompt/model evaluation, retention/deletion policy, protected diagnostics, abuse monitoring, and incident response. The fixed boundary makes a proposal inspectable; it does not certify correctness, safety, legality, factuality, or editorial quality.

## Explicit non-goals

This feature is not RDF, SPARQL, a public graph API, a vector/semantic recommender, behavioral personalization, a conversation system, autonomous memory, multi-agent orchestration, a workflow engine, or autonomous publication. It ships no external runtime or model provider. Graph/recommendation output is request-local derived evidence, and agent output remains untrusted until a human approves and explicitly executes the exact saved-draft patch.
