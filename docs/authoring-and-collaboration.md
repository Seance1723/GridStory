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

Presence is intentionally soft real-time. A heartbeat records the editor's display name and current
field/node, expires after 30 seconds, and is removed explicitly when Studio changes entry or
unmounts. The current reference collaboration adapter is process-local, so comment threads and
presence are reset when the API process restarts. A durable/distributed adapter can implement the
same framework-neutral service boundary without changing Studio or client contracts.

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
replies, resolution, due-date errors, and presence expiry. API tests cover authorization, cross-
tenant isolation, browser `PATCH` preflight, stable errors, and the collaboration lifecycle. Studio
tests exercise rich-text blocks, asset/reference picking, inline props, presence, comments,
mentions, and assignment through the typed client.
