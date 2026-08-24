# ADR 0020: AI execution is policy-scoped, source-allowlisted, and non-mutating

- Status: Accepted
- Date: 2026-08-24
- Task: M7-004

## Context

GridStory has a complete-scope control plane, scoped content authorization, bounded search, injected external adapters, immutable revisions, private management APIs, operational telemetry, and recovery evidence. It has no trusted boundary for sending content to a generative model. Calling a provider SDK directly from Studio or a field implementation would bypass model allow-lists, prompt versioning, content-field authorization, redaction, budgets, timeouts, and an emergency disablement path.

M7-004 must establish that boundary without pre-building M7-005's authoring suggestions, provenance/evaluation workflow, or semantic search, and without turning the CMS into an agent platform. Prompt injection cannot be made impossible by a filter, so the gateway must reduce impact structurally: no tool authority, no mutation, explicit source IDs/fields, fixed instruction/data separation, bounded output, and an untrusted-result label.

## Prior-art comparison

| Approach | Who does it this way | Fit and cost | Decision / deliberately skipped |
|---|---|---|---|
| Import vendor SDKs directly into Studio/domain services | Provider quickstarts | Fast first call, but credentials, request shapes, retention defaults, usage semantics, and safety controls leak into product logic. | Rejected as the GridStory boundary; deployments may wrap SDKs behind the injected adapter. |
| Adopt Vercel AI SDK/provider registry and model middleware | Vercel AI SDK | Strong multi-provider/tool/streaming abstraction, but M7-004 needs one bounded text generation seam and already has adapter conventions. It would add a broad dependency and capabilities explicitly out of scope. | Rejected for core now; revisit after three real provider adapters or a measured streaming/tool requirement. |
| Delegate prompts, budgets, retrieval, and policy entirely to a managed gateway | Provider gateways / prompt platforms | Reduces local code, but cannot replace GridStory's six-field scope, content authorization, draft/published perspective, immutable revisions, or tenant kill-switch truth. | External gateways may be used by adapters, but do not replace the local policy boundary. |
| Immutable prompt versions with an active pointer | Langfuse versions/labels | Preserves history and makes activation/rollback explicit without mutable in-place prompt edits. | Selected, with one active version per prompt and no composition/canary labels yet. |
| Complete-scope policy document plus injected text provider, explicit-ID field-allowlisted retrieval, deterministic redaction, conservative budget reservation, and a persisted kill switch | GridStory existing repository/adapter patterns | Reuses established optimistic persistence and authorization, adds no dependency, and constrains prompt injection impact because the result has no tools or mutation path. | Selected. |
| Full RAG/agent platform with embeddings, automatic search, tools, memory, fallback routing, evaluations, and content writes | Mature AI application platforms | Powerful but materially expands data retention, privilege, poisoning, reliability, and human-review risk. | Deferred to M7-005/M8 only through separately approved slices. |
| Do nothing / reuse search and telemetry | Existing GridStory services | Zero code, but no model execution policy, prompt registry, provider isolation, budgets, redaction, or kill switch exists. | Rejected because M7-004 is explicit and the roadmap identifies pre-governance AI as a high risk. |

## Proposed decision

GridStory will define a text-only `AiProviderAdapter` injected at the trusted Node composition root. The adapter identity is stable and credentials/provider SDKs remain outside schema/core. It receives a closed request containing one configured model ID, fixed gateway instructions, bounded redacted user input, structured redacted source excerpts, maximum output tokens, and an abort signal. It cannot receive tools, arbitrary provider options, tenant credentials, or database handles. It returns bounded text, a fixed finish reason, and input/output/cost usage; thrown details are replaced with stable generic errors.

Each complete organization, tenant, workspace, site, environment, and locale scope owns one optimistic AI document. The document retains enabled/disabled policy, bounded configured models, daily request/input/output/cost ceilings, immutable prompt versions, one active pointer per prompt, recent non-content request receipts/reservations, daily usage aggregates, and actor/reason/time policy events. It stores no rendered provider prompt, retrieved value, user input, model output, provider credential, or hidden reasoning.

Prompt source policy positively lists perspective, content types, field paths, and maximum explicit source entries. The API re-authorizes every resolved entry under the caller's current principal; the service proves returned scope/perspective/type, reads only listed paths, bounds serialized text, applies mandatory deterministic credential/email/phone/IP redaction to user/source/provider output, and structurally separates instructions from untrusted data. No automatic search, embeddings, neighboring content, URLs, binary assets, or cross-locale retrieval occurs.

Execution requires an active immutable prompt, enabled scope/provider/model, an allowlisted model, and a new UUID request ID. Before generation, a provider-local estimate reserves the request plus maximum input/output/cost exposure through an optimistic write. Concurrent requests therefore cannot pass the same remaining budget. Failure/timeout keeps the conservative reservation because external cost may have occurred; a valid result may reconcile usage only downward. Provider-reported usage is operational evidence rather than invoice proof.

The persisted kill switch is checked before retrieval, before provider invocation, and after provider completion. Disabling a scope stops new calls and discards an in-flight result observed after disablement; it cannot guarantee cancellation of an external request already accepted by a provider. Provider/model/prompt enablement adds narrower switches. Responses remain private/no-store and explicitly untrusted/non-mutating. M7-005 must validate structured suggestions and require normal human/editorial controls before any draft change.

## Necessity gate

1. **Traceable:** M7-004 explicitly requires a provider-neutral gateway, scoped retrieval, prompt registry, budgets, redaction, and kill switches; the roadmap calls ungoverned early AI a known risk.
2. **Not already solved:** search retrieves content, adapters call external systems, and telemetry observes operations, but none authorizes/model-routes/redacts/meters/disables a generative request.
3. **Minimal form:** one text interface, one document/repository/service, immutable prompt versions with an active pointer, explicit-ID retrieval, deterministic redaction, conservative daily budgets, private routes/client/Studio, and no content mutation is the smallest operable loop.
4. **Dependencies justified:** no package is added. Existing Zod, AbortController/runtime primitives, authorization, content service, and memory/SQLite/PostgreSQL patterns suffice.
5. **Rule of three:** this does not introduce generic model middleware, tools, prompt composition, routing/fallback, or an agent framework. The adapter expresses only the one real text-generation repetition.
6. **Reversible:** disable every scope/provider first, remove trusted adapter composition, then revert the additive task commit. No content or external credential migration is required; already accepted provider calls remain subject to provider retention and billing.

## Sources that changed the decision

- [OWASP LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) says direct and indirect injection cannot be solved by one filter and recommends structured instruction/data separation, least privilege, output validation, monitoring, human controls, and kill switches. This is why M7-004 has no tools or mutation path.
- [Vercel AI SDK provider foundations](https://ai-sdk.dev/docs/foundations/providers-and-models) and [middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware) demonstrate a provider standard and cross-provider guardrail seam. GridStory retains those shapes but does not import the broader tool/streaming SDK before it is needed.
- [Langfuse prompt version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control) uses immutable versions and deployment labels with rollback. GridStory selects immutable versions plus one active pointer and defers arbitrary labels/canaries.
- [Amazon Bedrock quotas](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html) treats token usage and request rate as model-governed capacity, while [Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-how.html) evaluates both input and output and warns controls evolve. GridStory therefore meters both directions and describes redaction as bounded defense, not certification.
- [OpenAI usage/cost APIs](https://platform.openai.com/docs/api-reference/usage/audio_transcriptions_object) distinguish operational usage from reconciled invoice cost, and [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint) show provider retention/residency depends on endpoint and account configuration. GridStory does not claim adapter usage is billing truth or that local redaction controls provider retention.
- [OpenTelemetry GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/) warn input/output messages are likely to contain sensitive data. GridStory records bounded metadata and counters, never prompt/source/output bodies, in its persistent operational state or default telemetry.
- [NIST AI RMF Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) emphasizes governance, pre-deployment testing, provenance, incident disclosure, and appropriate human oversight. M7-004 supplies the gateway controls; M7-005 owns evaluated suggestions/provenance/human approval.

## Consequences and revisit triggers

- The first provider integration is deliberately injected and tested with synthetic adapters; production credentials, SDK selection, egress, retention/residency, moderation, and invoice reconciliation remain deployment evidence.
- Explicit source IDs and field paths trade convenience for a reviewable data boundary. Revisit automatic/semantic retrieval only in M7-005 with poisoning, permission, citation, and immutable-revision evidence.
- Conservative failure reservations may underuse a daily budget but cannot silently assume a timed-out provider incurred no cost. Revisit reservation expiry only with provider idempotency and usage-reconciliation evidence.
- Deterministic redaction catches declared patterns but is not complete DLP or a legal classification. `never send externally` data should be excluded by allowlist before redaction, and deployments still need provider policy review.
- Revisit streaming, fallback, tools, and conversations only after a concrete product need and a separate threat/retention/authorization design.
