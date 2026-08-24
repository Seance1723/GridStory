# ADR 0021: AI proposals are evaluated review records and semantic indexes are derived

- Status: Accepted
- Date: 2026-08-24
- Task: M7-005

## Context

M7-004 established a provider-neutral, text-only, non-mutating gateway with immutable prompts, scoped explicit-source retrieval, redaction, conservative budgets, metadata-only receipts, and kill switches. Its output is intentionally untrusted and transient. GridStory still cannot turn that output into a schema-valid authoring proposal, explain which immutable prompt/model/source/target revisions produced it, retain bounded evaluation and review evidence, or search content by semantic similarity.

The repository already has immutable content drafts and validation, human collaboration suggestions, editorial workflow approvals, scoped lexical search, durable indexing/rebuild jobs, and provider-neutral adapters. Reusing those boundaries is safer and smaller than adding an agent framework or giving a model content-write authority. M7-005 must also avoid treating schema adherence or automated checks as proof that generated content is true, safe, on-brand, lawful, or ready to publish.

## Prior-art comparison

| Approach | Who does it this way | Fit and cost | Decision / deliberately skipped |
|---|---|---|---|
| Accept provider JSON mode and trust the parsed object | Basic provider integrations | Valid JSON is not necessarily the requested shape; incomplete and refusal responses need separate handling. | Rejected. GridStory uses one fixed versioned contract, then parses, bounds, redacts, and validates the complete candidate independently. |
| Provider-native strict structured output and hosted evals | OpenAI Structured Outputs and Evals | Strong schema/test-data/criteria primitives, but directly importing one provider contract would break the gateway boundary and hosted eval state may retain content externally. | Keep the strict-contract and declared-criteria shape behind GridStory's adapter; do not import a provider SDK or hosted eval service. |
| Configured field/action invocation with AI audit enrichment | Contentful AI Actions and audit logs | Field targeting plus invocation/action/model/affected-entry evidence fits a CMS, but Contentful-specific entities and automatic actions do not map to GridStory's immutable prompt and draft contracts. | Select bounded action targets and metadata provenance; keep approval and ordinary draft saving explicit. |
| Reuse collaboration suggestions unchanged | GridStory M6-001 | Already supports accept/reject, but allows general collaboration writers, has no AI action/prompt/model/source/evaluation provenance, and cannot enforce human-only AI review. | Reuse its UI language and transition lessons, not its record or authorization path. |
| Add pgvector or a managed vector database directly to core | pgvector / managed semantic search products | Provides real ANN/hybrid indexing, but adds deployment-specific persistence, dimension/index tuning, filtered-recall behavior, and tenant partitioning that SQLite/local users cannot share. | Reject for core now. Use an injected tenant-aware semantic adapter and derived rebuildable index state. |
| Complete-scope authoring policy/history plus fixed structured generation, deterministic candidate evaluation, human review, and an injected semantic adapter fed by existing durable search jobs | GridStory gateway/content/search/repository patterns | Reuses established security, storage, validation, jobs, and Studio seams; adds no dependency; retains only reviewable proposal values and metadata. | Selected as the smallest end-to-end M7-005 boundary. |
| Full RAG/agent/evaluation platform with automatic retrieval, tools, content writes, LLM judges, hybrid ranking, and vector operations | Mature AI application frameworks | Broad capability, but substantially expands authority, retention, poisoning, evaluator reliability, and operational scope. | Rejected for M7-005; require separate measured needs and threat models. |
| Do nothing / reuse raw gateway output and lexical search | Existing M7-004/M4-006 | Zero code, but leaves the explicit roadmap item unresolved and provides neither reviewable structured authoring nor semantic retrieval. | Rejected. |

## Decision

GridStory will add a complete-scope optimistic AI authoring document, separate from the gateway budget/prompt document. It will contain bounded action definitions, semantic policy, evaluated proposals, and human review history. An action binds one active prompt to one content type, a positive list of top-level `text`/`slug` target fields, a maximum proposal count, and transparent deterministic term/length criteria. The document remains private/no-store at the HTTP boundary and is disabled by default.

The authoring service will invoke `AiGatewayService` with a fixed `gridstory.authoring-suggestions.v1` provider output contract. The returned text is still untrusted: GridStory parses a strict bounded object, permits only declared fields, copies changes onto the exact current draft, and runs the ordinary complete content-schema/reference validator. Evaluation records structural contract, complete generation, changed value, current revision, candidate schema, and configured deterministic criteria. Failed output retains only bounded failure metadata, never raw provider text or source values, and cannot become approvable.

Each valid proposal retains its action ID/version, gateway request ID, active prompt ID/version, provider/model, target entry/content type/draft revision/field paths, exact source IDs/content types/revisions, usage and redaction counts, requesting actor/time, individual evaluation results, and status. It persists only the redacted field values needed for human review, not the rendered prompt, unselected data, raw provider JSON, embeddings, semantic query, or hidden reasoning.

Generation requires `ai.execute`. Review requires a new `ai.review` permission and a non-anonymous, non-service-account principal; authors do not receive that permission by default, while publishers and administrators do. Review is one-time, accountable, and fails when evaluation did not pass or the target draft revision is stale. Approval itself does not write content. Studio may explicitly copy approved values into its visible local draft, marking normal unsaved changes; the established immutable save, workflow, quality, and publication gates remain the only content-write path.

Semantic search will use an injected adapter selected by a complete-scope disabled-by-default policy. Existing durable `search.index` and `search.rebuild` jobs will also call the semantic service. It extracts only positively allowlisted top-level text/slug fields for the configured perspective, applies deterministic redaction before adapter egress, and sends no field text in the durable job payload. Adapter vectors/indexes are derived non-authoritative state that may be discarded and rebuilt rather than included in GridStory logical backup.

Private semantic queries require existing search authorization, are bounded and redacted before adapter egress, and are never persisted. The adapter returns only candidate IDs, scores, source revisions, field paths, and model/index metadata. Core requires finite bounded scores, uniqueness, exact scope/perspective, configured adapter/model, current revision, and per-result content authorization before returning entries plus provenance. A missing/disabled adapter or hostile/cross-scope/stale result fails closed; no public cache or automatic generation retrieval is introduced.

## Necessity gate

1. **Traceable:** M7-005 explicitly requires structured authoring suggestions, provenance, evaluation, human approval, and semantic search; ADR 0020 explicitly defers them here.
2. **Not already solved:** M7-004 returns transient untrusted text, collaboration lacks AI evidence/reviewer rules, workflow approves content state rather than AI proposals, and lexical search has no vector query/index contract.
3. **Minimal form:** one bounded authoring document/service, one fixed output contract, deterministic candidate checks, one review transition, local unsaved-editor handoff, and one injected semantic adapter on existing jobs form the smallest coherent vertical slice.
4. **Dependencies justified:** no package is added. Existing Zod, content validation, authorization, durable jobs, and memory/SQLite/PostgreSQL document patterns are sufficient; production vector/provider SDKs remain adapter composition.
5. **Rule of three:** no generic JSON Schema registry, evaluator plugin framework, vector database abstraction hierarchy, prompt pipeline, RAG orchestrator, or agent/tool runtime is introduced.
6. **Reversible:** disable authoring and semantic policies, drain/stop adapters, discard derived indexes, and revert the additive task commit. Existing content revisions and the M7-004 gateway remain valid; bounded review records can be exported before removal if policy requires retention.

## Sources that changed the decision

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) distinguishes schema adherence from JSON mode and documents separate incomplete/refusal outcomes. GridStory therefore uses a fixed adapter contract but independently validates every result and never treats parsing as approval.
- [OpenAI Evals](https://developers.openai.com/api/docs/guides/evals) binds representative test data to declared criteria and human ground truth. GridStory begins with transparent deterministic per-proposal criteria and human review, not a hidden model-as-judge score or hosted content corpus.
- [Contentful AI Actions](https://www.contentful.com/developers/docs/references/content-management-api/ai-actions/) scopes configured actions to environment-aware content inputs, while [Contentful AI audit enrichment](https://www.contentful.com/developers/docs/tutorials/general/audit-logs/) records invocation, actor, action version, affected entry/field, provider, and model. GridStory retains equivalent immutable metadata while omitting provider-specific configuration.
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) calls for defined human-AI roles, documented output oversight, representative evaluation, and repeatable TEVV evidence. GridStory separates generation from human review and describes deterministic evaluation limits explicitly.
- [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings) describes cosine-ranked semantic retrieval and external vector storage. GridStory keeps query/index mechanics behind an adapter rather than coupling core to one embedding model or store.
- [pgvector](https://github.com/pgvector/pgvector) documents exact versus approximate tradeoffs, filtered-index recall loss, hybrid search, and separate tables/partitioning for tenant isolation. GridStory requires complete scope at the adapter boundary and defers ANN/hybrid tuning until a real deployment need exists.

## Consequences and revisit triggers

- Editors receive reviewable field proposals, not autonomous content creation. Copying an approved value into Studio still requires an explicit ordinary draft save and loses automatic final-revision lineage beyond the retained proposal and human content audit; revisit an atomic suggestion-to-revision link only with a repository transaction design.
- Deterministic criteria are explainable but narrow. They do not establish truth, safety, brand fit, accessibility, copyright status, or legal compliance. Revisit managed evaluation datasets or expert/independent assessment only for a concrete action and approved retention policy.
- Semantic quality, latency, index freshness, model retention, tenant partitioning, and cost are adapter/deployment evidence. Revisit a bundled pgvector adapter after a measured dataset/query envelope and production PostgreSQL-extension support requirement.
- Revisit rich text, component trees, translation, bulk actions, hybrid ranking, and automatic retrieval only as separately bounded tasks with exact validation and review semantics.
