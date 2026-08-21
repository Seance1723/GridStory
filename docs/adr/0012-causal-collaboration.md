# ADR 0012: Causal JSON collaboration and explicit conflicts

- Status: Accepted
- Date: 2026-08-21
- Task: M6-001

## Context

GridStory already supports tenant-scoped comment threads, expiring presence, optimistic content-revision saves, and structured field/component data. Comments were process-local, and revision conflicts protect whole draft saves rather than let independent field or block changes converge. M6-001 needs suggestions, branches, merge, and a conflict UI without moving application rendering into the control plane or allowing collaboration metadata into published delivery.

“CRDT-compatible” means an offline or distributed adapter can submit stable operation IDs, per-actor sequence numbers, and causal dependency heads; duplicate delivery is idempotent; independent histories can be combined in any arrival order; and concurrent same-target values are retained until explicitly resolved. It does not mean GridStory embeds a particular binary CRDT engine or promises a realtime transport.

## Prior-art comparison

| Approach | Evidence and fit | Decision |
|---|---|---|
| Keep whole-revision optimistic writes only | Preserves data safety but forces users to reload or manually reconstruct any stale draft, and cannot express suggestions or branch ancestry. | Rejected. |
| Embed Yjs documents and binary updates | Provides commutative, associative, idempotent updates and state vectors, but introduces binary state, editor/provider lifecycle, and a library-specific persistence contract across all GridStory fields and blocks. | Deferred for character-level realtime editors. |
| Embed Automerge documents | Provides JSON-like CRDT documents, operation history, deterministic winners, and inspectable conflicts, but makes an external engine and its storage/sync lifecycle the authoritative collaboration representation. | Rejected for the framework-neutral core. |
| Use ProseMirror collaboration steps | Its central version authority and rebasing are proven for rich text, but the model is editor-specific and stale steps can become inapplicable after deletion. | Rejected as the generic field/block contract. |
| Add a bounded JSON operation DAG with multi-value registers | Keeps stable causal identity, dependency heads, deterministic replay, and preserved conflicts in portable contracts while allowing a future Yjs/Automerge/editor adapter to translate at the boundary. | Selected. |
| Model branches as copied drafts with last-writer-wins merge | Easy to implement, but duplicates content, hides concurrent values, and can silently discard author intent. | Rejected. |
| Model branch heads as operation-ID sets and merge their histories | Reuses immutable operations, preserves a common ancestor, merges non-overlapping targets, and exposes concurrent values for explicit resolution. | Selected. |

## Necessity gate

1. **Traceable:** M6-001 explicitly requires CRDT-compatible field/block collaboration, suggestions, branches, merge, and conflict UI.
2. **Not already solved:** comments and presence carry discussion/awareness only; draft revision conflicts reject stale whole-document saves and do not converge or retain competing field values.
3. **Minimal form:** add one JSON collaboration document per fully scoped entry, immutable operations, branch membership/head sets, suggestions, merge/conflict records, and one Studio workbench. Do not add sockets, peer discovery, browser offline storage, or character-level encodings.
4. **Dependency justified:** no dependency is added. Stable IDs, causal graph traversal, deterministic actor ordering, JSON validation, and optimistic repository versions are small and auditable within existing Node/Zod/PostgreSQL/SQLite boundaries.
5. **Rule of three:** use the one collaboration repository contract already needed by memory, SQLite, and PostgreSQL; do not introduce a generic event-sourcing or synchronization framework.
6. **Reversible:** the collaboration tables and APIs are additive, content revisions are unchanged, and published delivery never reads collaboration documents. One task revert removes the feature without content migration.

## Decision

Each entry has one versioned, fully tenant-scoped collaboration document. An operation identifies its actor, actor sequence, branch, field/block/property target, kind, JSON value, and causal dependencies. Online clients may omit ID, sequence, dependencies, branch, and kind; the service generates stable defaults from the current branch. Distributed clients may supply them. Reusing an operation ID for the same actor and entry returns the existing operation without advancing the document version; reusing an actor sequence or foreign ID fails closed.

Branch state is a deterministic multi-value register per target. An operation causally dominates its dependencies. Concurrent live operations are ordered by actor sequence, actor ID, and operation ID for a stable visible value, but values that differ are retained as conflict variants. A later operation depending on all variants resolves the conflict. Branches copy operation membership and heads rather than content. Merge unions the source history into the target, records concurrent target variants, and completes only when every merge conflict is resolved.

Suggestions hold a proposed operation outside branch state until accepted; rejection records the review without changing state. Acceptance creates an ordinary causal operation, so suggestions do not bypass convergence rules.

The collaboration repository uses optimistic document versions to prevent lost updates and retries bounded conflicts. SQLite and PostgreSQL persist the same validated payload under the complete scope key. Comments move into that durable document. Presence retains a 30-second process-local TTL because it is awareness, not authoring history.

All collaboration routes use existing collaboration read/write authorization and private/no-store responses. They verify that the scoped content entry exists. Published REST/GraphQL delivery, public caches, preview credentials, and application rendering do not read the collaboration document.

## Sources

- <https://docs.yjs.dev/api/document-updates>
- <https://automerge.org/docs/reference/documents/conflicts/>
- <https://automerge.org/docs/reference/under-the-hood/merge-rules/>
- <https://prosemirror.net/docs/guide/#collab>
- <https://git-scm.com/docs/git-merge>

## Consequences

- Field and stable-node block changes have a portable causal contract and deterministic replay without coupling GridStory to a specific editor or CRDT library.
- Concurrent values remain inspectable and resolvable instead of being overwritten by timestamps or request arrival order.
- Whole collaboration documents make the reference adapter simple and auditable, but the 10,000-operation bound requires a future reviewed compaction/snapshot policy for very long-lived entries.
- Optimistic versions prevent silent cross-process overwrite; callers can safely retry stable operation IDs after a 409.
- Realtime push, offline queues, text-character CRDTs, and applying collaboration values to a content revision remain explicit later integrations rather than implicit claims of this task.
