# Reviewed AI authoring and private semantic search

GridStory turns the governed gateway's untrusted text into bounded field proposals that must pass deterministic checks and explicit human review. Approval is evidence only: it does not update a draft, advance a workflow, satisfy a workflow approval, or publish content. Studio can copy an approved proposal into its visible local editor, marks the editor dirty, and leaves the ordinary **Save draft** path in control.

Semantic search is a separate private management capability. GridStory sends only positively allowlisted, redacted, saved `text` and `slug` fields to an injected tenant-aware adapter. Embeddings and indexes are derived adapter state; they are not GridStory records, backup truth, retrieval context for generation, or public delivery data.

## Default and composition boundary

Both capabilities are disabled by default. GridStory ships no model provider, embedding provider, vector database, SDK, or credentials. Trusted server composition supplies:

- the M7-004 `AiProviderAdapter` used for generation;
- an `AiSemanticAdapter` with stable `id` and `modelId` when semantic indexing is enabled;
- secrets, TLS, egress, provider retention/training/region policy, rate control, monitoring, and incident response outside persisted GridStory policy.

The authoring repository uses the same complete organization, tenant, workspace, site, environment, and locale key as content and the gateway. Memory, SQLite, and PostgreSQL enforce the same optimistic document contract. The document retains bounded action policy, semantic policy, redacted evaluated proposals, and one-time review evidence.

## Authoring policy

An action binds one known prompt to one content type and a unique set of top-level `text` or `slug` field names. The first contract deliberately excludes rich text, components, arrays, objects, relations, taxonomies, assets, and multi-entry operations.

```json
{
  "expectedVersion": 0,
  "state": "enabled",
  "actions": [
    {
      "id": "improve-title",
      "name": "Improve title",
      "enabled": true,
      "promptId": "editorial-title",
      "contentType": "page",
      "targetFields": ["title", "slug"],
      "maximumChanges": 2,
      "evaluationRules": [
        {
          "id": "title-length",
          "fieldPath": "title",
          "kind": "maximum-length",
          "maximum": 80
        },
        {
          "id": "no-placeholder",
          "fieldPath": "title",
          "kind": "forbidden-term",
          "term": "lorem ipsum"
        }
      ]
    }
  ],
  "semantic": { "enabled": false }
}
```

Supported deterministic rule kinds are `minimum-length`, `maximum-length`, `required-term`, and `forbidden-term`. They prove only the declared condition. GridStory makes no automatic factuality, bias, brand, safety, legal, or publication-readiness claim.

## Fixed provider output

Authoring calls add `outputContract: "gridstory.authoring-suggestions.v1"` to the internal provider request. Adapters may use a provider-native structured-output feature, but they must return ordinary text containing this exact JSON shape:

```json
{
  "contract": "gridstory.authoring-suggestions.v1",
  "suggestions": [
    {
      "fieldPath": "title",
      "value": "A concise title",
      "rationale": "Explains the page more directly."
    }
  ]
}
```

GridStory independently parses the strict contract after gateway output redaction. A complete `stop` result is required. Duplicate fields, unknown keys, undeclared fields, too many changes, oversized values, incomplete/refused output, and malformed JSON fail closed. Allowed changes are copied onto the exact current saved draft, then the complete ordinary content-schema and reference validator runs before configured evaluation rules.

## Provenance and review lifecycle

An evaluated proposal records:

- proposal/action identity and the authoring-document version that supplied the action;
- exact target entry, content type, and draft revision;
- gateway request, immutable prompt version, provider/model, and exact source revisions;
- bounded usage, redaction counts, finish reason, generating actor, and time;
- redacted field values/rationales, complete-schema outcome, every configured rule outcome, status, and at most one review record.

It never records raw provider JSON, rendered prompt text, source values, credentials, hidden reasoning, thrown provider diagnostics, semantic queries, embeddings, or vectors.

Generation requires `ai.execute` and ordinary `content.read` for the target and every explicit source. Approval/rejection requires the distinct `ai.review` permission, which default publisher/admin users have. Author and viewer roles do not. A service-account or anonymous principal is rejected even if it otherwise receives the permission. Only `pending-review` proposals with passed evaluation may transition once. Approval re-resolves the exact current draft; a changed revision becomes `stale` instead.

Studio's **Use as unsaved editor changes** control is available only for an approved proposal matching the selected saved revision. It copies values locally, shows **Unsaved changes**, and does not call the content update endpoint. Editors must review and save through the normal immutable draft, workflow, quality, release, and publish controls.

## Semantic policy and adapter

An enabled semantic policy names one injected adapter/model, allowed perspectives, maximum returned results, minimum score, and one positive field list per content type:

```json
{
  "enabled": true,
  "adapterId": "customer-vector-service",
  "modelId": "embedding-v1",
  "perspectives": ["draft", "published"],
  "maximumResults": 20,
  "minimumScore": 0.35,
  "rules": [
    { "contentType": "page", "fieldPaths": ["title", "slug"] }
  ]
}
```

Existing durable `search.index` and `search.rebuild` jobs feed both lexical and semantic processors. Their payloads contain only scope-bound entry/event identifiers or the requested perspective—never field text, a query, an embedding, or a vector. The semantic service re-resolves authoritative content, selects only configured top-level strings, applies the same credential/email/phone/IP redaction as generation, bounds total characters, and calls `upsert` or `rebuild`.

The adapter must return its exact configured identity/model, complete scope, perspective, stable index version, and bounded counts. Errors retained by the durable job boundary are generic. Production adapters must isolate tenant indexes and document their delete/rebuild, model migration, filtered-recall, timeout, capacity, and incident behavior.

Private query input is trimmed, bounded, redacted, and never persisted. The adapter returns only candidates. GridStory fails the complete request closed unless the result and every hit have:

- the exact configured adapter/model, complete request scope, and perspective;
- a stable index version and a unique non-empty entry ID;
- a finite score between `-1` and `1`;
- the configured content type and positive allowlisted field provenance;
- an exact revision that still equals the current saved draft/published pointer;
- a successful scoped content re-resolution and ordinary `content.read` decision.

There is no public semantic endpoint, cache, automatic retrieval-augmented generation, hybrid ranking, recommendation API, or fallback to lexical search.

## Private routes

- `GET /api/v1/ai/authoring` — `ai.read`
- `PUT /api/v1/ai/authoring/policy` — `ai.manage`
- `POST /api/v1/ai/authoring/proposals` — `ai.execute` plus target/source reads
- `POST /api/v1/ai/authoring/proposals/:proposalId/review` — `ai.review`, human user, and target read
- `POST /api/v1/ai/semantic/search` — `ai.read` plus per-hit content reads

All API responses are `Cache-Control: private, no-store`. The universal client exposes typed equivalents, and the Studio workbench exposes policy, proposal/evaluation/provenance, review, dirty-editor handoff, and semantic result provenance.

## Recovery, removal, and limitations

Native SQLite and PostgreSQL backups include the authoring policy and bounded proposal/review history. PostgreSQL conformance and the logical restore drill verify the authoring table. Semantic adapter indexes are excluded from GridStory backup claims; restore the authoritative database, configure the same reviewed policy/adapter, and request perspective rebuilds.

To disable, first set the authoring document state to `disabled` and semantic policy to `{ "enabled": false }`, then remove provider/vector adapters and reconcile any provider-side retained data under the deployment agreement. The additive application code and table can then be reverted; retained bounded proposal/review records should be handled under the customer's content/audit retention policy.

This milestone does not add agents, tools, conversations, memory, streaming, media generation, automatic fallback, arbitrary JSON Schema or executable evaluators, learned judges, rich-content suggestions, translation, bulk actions, automatic saves/transitions/approvals/publication, factuality/safety certification, public semantic delivery, recommendations, pgvector, ANN/hybrid tuning, or provider/vector credentials.

The accepted decision is [ADR-0021](adr/0021-reviewed-ai-authoring-and-semantic-search.md). `THREAT-0034` and `GS-SEC-038` define the normative security boundary.
