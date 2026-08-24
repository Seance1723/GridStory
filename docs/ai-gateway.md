# Governed AI gateway

GridStory's AI boundary is an opt-in, private, provider-neutral text-generation gateway. It gives authorized editors one governed way to call an externally operated model without giving that model tools, content-write authority, tenant credentials, ambient search, or an invocation memory.

The gateway starts disabled for every complete organization, tenant, workspace, site, environment, and locale scope. A publisher or administrator must configure models and budgets, create an immutable prompt version, activate that exact version, and record a reason when enabling the switch. Authors may then execute active prompts; viewers may inspect policy; delivery and anonymous roles receive no AI access.

## Boundary and data flow

One execution performs these checks in order:

1. Validate the bounded request and derive complete scope from the authenticated request context.
2. Require `ai.execute`, the enabled gateway, an active immutable prompt, and an enabled prompt-allowed provider/model.
3. Resolve only the request's explicit source IDs at the prompt's configured `draft` or `published` perspective. Reauthorize `content.read` for each ID and resolved content type, require the exact complete scope, and select only positive allowlisted field paths.
4. Redact recognized credentials, email addresses, phone numbers, and IP addresses from fixed prompt instructions, user input, and selected source values. Redaction is deterministic risk reduction, not a complete personal-data discovery system.
5. Ask the selected server-injected adapter for a metering estimate. Atomically reserve one request, estimated input tokens, the prompt's maximum output tokens, and the greater of adapter-estimated or locally priced cost.
6. Send a strict structured text request without organization, tenant, workspace, site, environment, locale, credentials, tools, callbacks, or mutation authority.
7. Bound the timeout; validate the closed provider result; require actual usage not to exceed the reservation; redact output; and atomically recheck gateway state, active prompt, and model before releasing it.
8. Return the output as `trust: "untrusted"`. A success reconciles reserved usage downward. A timeout, provider failure, invalid result, over-reservation result, or concurrent disablement retains the conservative reservation and records only failure metadata.

Prompt injection cannot be eliminated by filtering. GridStory limits its impact structurally: instructions and data are separate fields, retrieval is explicit and allowlisted, provider responses have no tool channel, and results cannot mutate CMS content.

## Provider adapter

Provider SDKs and credentials belong in trusted server composition. The framework-neutral core depends only on this contract:

```ts
import type { AiProviderAdapter } from '@gridstory/core';

const provider: AiProviderAdapter = {
  id: 'production-provider',
  async estimate(request) {
    // Convert the structured request to the provider's tokenizer/pricing contract.
    return { inputTokens: 640, outputTokens: 300, costMicros: 420_000 };
  },
  async generate(request, signal) {
    // Preserve request.prompt, request.input, and request.sources as distinct roles/sections.
    // Bind the provider SDK call to signal and request.timeoutMs.
    return {
      output: 'Provider text',
      inputTokens: 612,
      outputTokens: 184,
      costMicros: 318_000,
      finishReason: 'stop',
    };
  },
};

await buildServer({
  databasePath: '.gridstory/gridstory.db',
  ai: { providers: [provider] },
});
```

Adapter IDs must be unique. Configuration may persist a provider/model policy while an adapter is absent, but execution fails closed with `ai_provider_unavailable`. GridStory does not automatically fall back to another provider because that could change data-processing, retention, region, price, and output behavior without a new operator decision.

Deployments must separately verify provider TLS and egress rules, secret-manager lifecycle, regional processing, retention/training terms, abuse controls, billing reconciliation, availability, logging, and incident response. Provider token and cost estimates are safety limits, not invoices.

## Policy, prompts, and retrieval

`PUT /api/v1/ai/policy` replaces the model and daily-budget policy using `expectedVersion`. Each model declares its enabled state, input/output token ceilings, and local input/output price in micro-units per million tokens. Duplicate provider/model pairs are rejected.

`POST /api/v1/ai/prompts` creates a new immutable `(promptId, version)` record. A prompt contains its documented purpose, fixed instructions, allowed provider/models, per-call output/cost/timeout ceilings, retrieval perspective, maximum explicit sources, and content-type-to-field-path allowlist. An existing version cannot be overwritten. `POST /api/v1/ai/prompts/:promptId/versions/:version/activate` moves only the active pointer under optimistic concurrency.

Field paths are positive dot paths such as `title` or `seo.description`; there are no wildcard, negative, search, graph-expansion, or relation-following rules. Missing fields are omitted. Objects and arrays are serialized as bounded JSON only after their exact path is selected. Total selected source characters and source count are capped by the published resource limits.

## Budgets and receipts

Daily counters use UTC days and cover requests, input tokens, output tokens, and cost micro-units. Reservation and duplicate-ID insertion share the same optimistic complete-scope document update, so concurrent callers cannot both consume the same request UUID or oversubscribe the observed budget without a conflict/retry.

Receipts retain request ID, prompt/model identity, status, reservation, optional successful actual usage, and timestamps. They never retain prompt text, user input, selected source values, provider output, provider credentials, or thrown provider diagnostics. Receipt, state-event, prompt, usage-day, source, and text histories are bounded by `resourceLimits.aiGateway`.

Failed calls are not refunded. This conservative rule prevents a malicious, unavailable, or under-reporting provider from bypassing quotas through repeated failures. Successful calls reconcile only downward. Operators should rotate request UUIDs for intentional retries and use provider billing evidence for financial reconciliation.

## Kill switch and operations

`POST /api/v1/ai/kill-switch` requires `ai.manage`, the current document version, the target state, and an accountable reason. Enabling requires at least one active prompt. Disabling takes effect for new requests immediately. A request already at the provider must still pass the state/prompt/model check inside successful settlement; otherwise its output is discarded and the receipt becomes failed.

Private routes are:

- `GET /api/v1/ai`
- `PUT /api/v1/ai/policy`
- `POST /api/v1/ai/prompts`
- `POST /api/v1/ai/prompts/:promptId/versions/:version/activate`
- `POST /api/v1/ai/kill-switch`
- `POST /api/v1/ai/generate`

All responses use `Cache-Control: private, no-store`. The universal client exposes corresponding typed methods, and Studio's **AI gateway** workbench manages the same policy. The Studio result panel deliberately says “Untrusted output · review required” and supplies no save/publish action.

SQLite and PostgreSQL persist the same complete-scope document. Native backup/restore includes AI policy, prompt registry, usage receipts, and state history. Recovery tests prove an earlier enabled policy is restored instead of a later disablement, and PostgreSQL conformance plus logical restore verify the qualified table.

## Explicit limitations

This milestone does not provide provider adapters, autonomous agents, tools/function calling, streaming, embeddings, semantic search, ambient retrieval, conversations or memory, provenance/evaluation workflows, automatic provider fallback, suggestions, content writes, publication, complete PII/DLP detection, provider billing truth, or human-approval workflow. M7-005 owns evaluated suggestions, provenance, semantic retrieval, and human approval; any future tool or mutation authority requires a new threat model and decision record.

The accepted architectural decision is [ADR-0020](adr/0020-governed-ai-gateway.md). `THREAT-0033` and `GS-SEC-037` define the normative security and verification boundary.
