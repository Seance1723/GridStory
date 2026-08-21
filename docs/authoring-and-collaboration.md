# Authoring and collaboration

GridStory keeps authored data portable and application rendering under developer control. Rich text,
assets, references, comments, and presence cross the control-plane boundary as explicit,
tenant-scoped contracts; none of them inject application markup or credentials into delivery.

## Authoring fields

The canonical schema supports three dedicated authoring field types:

- `rich-text` stores a versioned semantic document. Its blocks are paragraphs, headings, lists,
  quotes, code, embeds, and tables. Inline text supports bold, italic, underline, code, links, and
  actor mentions. A field may narrow its allowed block types.
- `asset` stores a typed reference with stable ID, kind, URL, title, optional MIME/dimensions, and
  alternative text. The field controls accepted asset kinds and whether image alternative text is
  required. The current Studio picker uses a code-owned demonstration library; M4-001 owns durable
  upload, rendition, and usage-tracking infrastructure.
- `relation` stores one or more `{ id, contentType }` references. Studio filters choices to the
  field's target content types and enforces its maximum selection count.

`validateContent` parses these values before revisions are saved or published. Generated content
types map them to `RichTextDocument`, `AssetReference`, and `ContentReference`, so applications
receive the same structure at build time and runtime.

Studio presents rich text as semantic blocks rather than raw JSON, with block insertion/removal,
plain-content editing, and mark controls. Asset and relation fields use searchable, governed
pickers. The preview canvas also exposes selected component props as inline controls; edits still
flow through the immutable composition command/history model and the ordinary draft save boundary.

## Causal field and block collaboration

Each entry has a private, versioned collaboration document. Field and block changes use immutable
JSON operations with a stable operation ID, actor sequence, branch, target, and causal dependency
heads. A target always names a field and may narrow to a stable component node and property. Online
clients can omit causal metadata and let the service use the current branch heads; offline or
distributed adapters can preserve their own operation identity and dependencies.

Duplicate stable operations are idempotent. Independent targets converge when histories are joined.
Concurrent changes to the same target receive a deterministic visible winner, but every different
live value remains in a conflict record until a resolution operation causally succeeds all variants.
No wall-clock timestamp silently overwrites another author's value.

Branches copy operation membership and head IDs rather than cloning draft content. A merge unions
source history into the target, applies non-overlapping changes, and remains `conflicted` until every
same-target variant is resolved. Suggestions remain outside branch state until accepted; accepting
one creates an ordinary causal operation, while rejection records the review only.

The private API adds:

- `POST /api/v1/content/:id/collaboration/operations`
- `POST /api/v1/content/:id/collaboration/branches`
- `POST /api/v1/content/:id/collaboration/suggestions`
- `PATCH /api/v1/content/:id/collaboration/suggestions/:suggestionId`
- `POST /api/v1/content/:id/collaboration/merges`
- `PATCH /api/v1/content/:id/collaboration/conflicts/:conflictId`

Studio exposes a working-branch selector, current field/block sharing, suggestion review, merge, and
variant-level conflict resolution. These operations do not save or publish a content revision;
authors retain the ordinary validated draft-save boundary when promoting collaboration results into
authoritative content.

## Comments and presence

Collaboration is private control-plane state and never enters published content, delivery responses,
or public caches. Every operation carries the complete organization, tenant, workspace, site,
environment, locale, and entry scope.

The private API exposes:

- `GET /api/v1/content/:id/collaboration`
- `POST /api/v1/content/:id/comments`
- `POST /api/v1/content/:id/comments/:threadId/replies`
- `PATCH /api/v1/content/:id/comments/:threadId`
- `PUT /api/v1/content/:id/presence`
- `DELETE /api/v1/content/:id/presence`

Viewers may read collaboration state. Authors, publishers, and administrators may create and update
threads and publish presence heartbeats. Comment targets can identify the whole entry, a schema
field, or a component node. Message bodies extract stable `@actor-id` mentions; threads support
assignees, due dates, replies, resolution, and reopening. Invalid due dates return the stable
`invalid_due_date` 400 response.

Comments and causal collaboration documents are durable in the configured SQLite or PostgreSQL
adapter. Repository writes use optimistic document versions, retry bounded races, and retain the
complete tenant scope in both indexed columns and the validated payload.

Presence is intentionally soft real-time. A heartbeat records the editor's display name and current
field/node, expires after 30 seconds, and is removed explicitly when Studio changes entry or
unmounts. Presence remains process-local and resets when the API process restarts because stale
awareness is not durable authoring history. Realtime push, browser offline queues, and
character-level rich-text CRDT encoding remain separate transport/editor integrations.

## Cache and preview boundaries

- Management responses retain `private, no-store`.
- Collaboration routes require ordinary scoped identity headers and are never available through a
  preview grant.
- Draft rich-text, asset, relation, and composition edits reach an application preview only through
  the authenticated live-patch protocol.
- Published delivery contains only the validated revision selected by the content service; comments,
  presence, preview credentials, and unsaved draft state are excluded.

## Verification

Schema tests cover semantic documents, marks, mentions, asset metadata, allowed blocks, accepted
asset kinds, and required image alt text. Core tests cover scope isolation, mentions, assignments,
replies, resolution, due-date errors, presence expiry, idempotency, arrival-order convergence,
suggestions, branch merge, conflicts, resolution, SQLite restart persistence, and optimistic writes.
API tests cover authorization, cross-tenant isolation, browser `PATCH` preflight, stable errors, and
the complete collaboration lifecycle; PostgreSQL verification reopens the API before reading the
same operation. Studio tests exercise rich-text blocks, asset/reference picking, inline props,
presence, current-value sharing, suggestions, branches, merge conflicts, comments, mentions, and
assignment through the typed client.
