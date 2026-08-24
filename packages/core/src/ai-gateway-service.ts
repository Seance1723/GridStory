import {
  aiGenerateResultSchema,
  aiProviderEstimateSchema,
  aiProviderRequestSchema,
  aiProviderResultSchema,
  resourceLimits,
  type AiGatewayDocument,
  type AiGatewayPolicyInput,
  type AiGatewayStateInput,
  type AiGenerateInput,
  type AiGenerateResult,
  type AiPromptVersion,
  type AiPromptVersionInput,
  type AiProviderEstimate,
  type AiProviderRequest,
  type AiProviderResult,
  type AiUsage,
  type ContentScope,
} from '@gridstory/schema';
import type { AiGatewayRepository } from './ai-gateway-repository.js';
import { emptyAiGatewayDocument } from './ai-gateway-repository.js';
import { GridStoryError } from './errors.js';
import { contentScopeKey } from './tenant-scope.js';
import type { Awaitable } from './types.js';

export interface AiProviderAdapter {
  readonly id: string;
  estimate(request: AiProviderRequest): Awaitable<AiProviderEstimate>;
  generate(request: AiProviderRequest, signal: AbortSignal): Awaitable<AiProviderResult>;
}

export interface AiSourceRecord extends ContentScope {
  id: string;
  contentType: string;
  revisionId: string;
  data: Record<string, unknown>;
}

export interface AiSourceReader {
  read(input: {
    scope: ContentScope;
    id: string;
    perspective: 'published' | 'draft';
  }): Awaitable<AiSourceRecord | null>;
}

export interface AiRedactionCounts {
  credentials: number;
  emails: number;
  phones: number;
  ips: number;
}

interface RedactionResult {
  value: string;
  counts: AiRedactionCounts;
}

interface ExecutionPolicy {
  prompt: AiPromptVersion;
  model: AiGatewayDocument['models'][number];
}

const credentialPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/giu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/gu,
];
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const phonePattern = /(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/gu;
const ipPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;

function replaceAndCount(value: string, pattern: RegExp, replacement: string): [string, number] {
  let count = 0;
  return [
    value.replace(pattern, () => {
      count += 1;
      return replacement;
    }),
    count,
  ];
}

export function redactAiText(value: string): RedactionResult {
  const counts: AiRedactionCounts = { credentials: 0, emails: 0, phones: 0, ips: 0 };
  let redacted = value;
  for (const pattern of credentialPatterns) {
    const [next, count] = replaceAndCount(redacted, pattern, '[REDACTED_CREDENTIAL]');
    redacted = next;
    counts.credentials += count;
  }
  [redacted, counts.emails] = replaceAndCount(redacted, emailPattern, '[REDACTED_EMAIL]');
  [redacted, counts.phones] = replaceAndCount(redacted, phonePattern, '[REDACTED_PHONE]');
  [redacted, counts.ips] = replaceAndCount(redacted, ipPattern, '[REDACTED_IP]');
  return { value: redacted, counts };
}

function addCounts(target: AiRedactionCounts, source: AiRedactionCounts): void {
  target.credentials += source.credentials;
  target.emails += source.emails;
  target.phones += source.phones;
  target.ips += source.ips;
}

function gatewayError(message: string, code: string, statusCode: number): GridStoryError {
  return new GridStoryError(message, code, statusCode);
}

function sameModel(
  left: { providerId: string; modelId: string },
  right: { providerId: string; modelId: string },
): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId;
}

function valueAtPath(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function sourceValue(value: unknown): string | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function estimatedCost(
  inputTokens: number,
  outputTokens: number,
  model: AiGatewayDocument['models'][number],
): number {
  const input =
    (BigInt(inputTokens) * BigInt(model.inputCostMicrosPerMillion) + 999_999n) / 1_000_000n;
  const output =
    (BigInt(outputTokens) * BigInt(model.outputCostMicrosPerMillion) + 999_999n) / 1_000_000n;
  const total = input + output;
  return total > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(total);
}

function sumWithinSafeInteger(left: number, right: number): number {
  if (!Number.isSafeInteger(left + right)) {
    throw gatewayError('AI usage counters reached their safe limit.', 'ai_budget_exceeded', 429);
  }
  return left + right;
}

function usageFits(
  current: AiUsage,
  addition: AiUsage,
  budget: AiGatewayDocument['budgets'],
): void {
  if (
    sumWithinSafeInteger(current.requests, addition.requests) > budget.dailyRequests ||
    sumWithinSafeInteger(current.inputTokens, addition.inputTokens) > budget.dailyInputTokens ||
    sumWithinSafeInteger(current.outputTokens, addition.outputTokens) > budget.dailyOutputTokens ||
    sumWithinSafeInteger(current.costMicros, addition.costMicros) > budget.dailyCostMicros
  ) {
    throw gatewayError('The AI gateway daily budget is exhausted.', 'ai_budget_exceeded', 429);
  }
}

function assertUniqueModels(models: AiGatewayDocument['models']): void {
  const keys = models.map((model) => `${model.providerId}\u0000${model.modelId}`);
  if (new Set(keys).size !== keys.length) {
    throw gatewayError('AI model policies must be unique.', 'invalid_ai_policy', 400);
  }
}

export class AiGatewayService {
  readonly #repository: AiGatewayRepository;
  readonly #providers: ReadonlyMap<string, AiProviderAdapter>;
  readonly #clock: () => Date;

  constructor(options: {
    repository: AiGatewayRepository;
    providers?: AiProviderAdapter[];
    clock?: () => Date;
  }) {
    this.#repository = options.repository;
    const providers = options.providers ?? [];
    if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
      throw new Error('AI provider adapter IDs must be unique.');
    }
    this.#providers = new Map(providers.map((provider) => [provider.id, provider]));
    this.#clock = options.clock ?? (() => new Date());
  }

  async snapshot(scope: ContentScope): Promise<AiGatewayDocument> {
    return (await this.#repository.get(scope)) ?? emptyAiGatewayDocument(scope);
  }

  async #replace(
    scope: ContentScope,
    expectedVersion: number,
    change: (document: AiGatewayDocument) => AiGatewayDocument,
  ): Promise<AiGatewayDocument> {
    const stored = await this.#repository.get(scope);
    const current = stored ?? emptyAiGatewayDocument(scope);
    if (current.version !== expectedVersion) {
      throw gatewayError(
        'AI gateway policy changed during this operation.',
        'ai_gateway_write_conflict',
        409,
      );
    }
    const timestamp = this.#clock().toISOString();
    const next = change({ ...current, updatedAt: timestamp });
    const versioned = { ...next, version: current.version + 1, updatedAt: timestamp };
    await this.#repository.save(versioned, stored ? current.version : null);
    return versioned;
  }

  async #mutate(
    scope: ContentScope,
    change: (document: AiGatewayDocument) => AiGatewayDocument,
  ): Promise<AiGatewayDocument> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.snapshot(scope);
      try {
        return await this.#replace(scope, current.version, change);
      } catch (error) {
        if (!(error instanceof GridStoryError) || error.code !== 'ai_gateway_write_conflict') {
          throw error;
        }
      }
    }
    throw gatewayError(
      'AI gateway policy remained busy during this operation.',
      'ai_gateway_write_conflict',
      409,
    );
  }

  async updatePolicy(scope: ContentScope, input: AiGatewayPolicyInput): Promise<AiGatewayDocument> {
    assertUniqueModels(input.models);
    return this.#replace(scope, input.expectedVersion, (document) => ({
      ...document,
      models: structuredClone(input.models),
      budgets: structuredClone(input.budgets),
    }));
  }

  async createPromptVersion(
    scope: ContentScope,
    input: AiPromptVersionInput,
    actorId: string,
  ): Promise<AiGatewayDocument> {
    return this.#replace(scope, input.expectedVersion, (document) => {
      if (
        document.promptVersions.some(
          (prompt) => prompt.promptId === input.promptId && prompt.version === input.version,
        )
      ) {
        throw gatewayError('That prompt version already exists.', 'ai_prompt_version_exists', 409);
      }
      if (document.promptVersions.length >= resourceLimits.aiGateway.maximumPromptVersions) {
        throw gatewayError('The AI prompt registry is full.', 'ai_prompt_registry_full', 409);
      }
      for (const allowed of input.allowedModels) {
        const model = document.models.find((candidate) => sameModel(candidate, allowed));
        if (!model) {
          throw gatewayError('A prompt references an unknown model.', 'invalid_ai_prompt', 400);
        }
        if (input.maximumOutputTokens > model.maximumOutputTokens) {
          throw gatewayError(
            'A prompt output limit exceeds its model policy.',
            'invalid_ai_prompt',
            400,
          );
        }
      }
      const { expectedVersion: _expectedVersion, ...version } = input;
      return {
        ...document,
        promptVersions: [
          ...document.promptVersions,
          { ...version, createdBy: actorId, createdAt: this.#clock().toISOString() },
        ],
      };
    });
  }

  async activatePrompt(
    scope: ContentScope,
    promptId: string,
    version: number,
    expectedVersion: number,
  ): Promise<AiGatewayDocument> {
    return this.#replace(scope, expectedVersion, (document) => {
      if (
        !document.promptVersions.some(
          (candidate) => candidate.promptId === promptId && candidate.version === version,
        )
      ) {
        throw gatewayError('The prompt version was not found.', 'ai_prompt_not_found', 404);
      }
      if (
        !document.activePrompts.some((active) => active.promptId === promptId) &&
        document.activePrompts.length >= resourceLimits.aiGateway.maximumActivePrompts
      ) {
        throw gatewayError(
          'The active AI prompt registry is full.',
          'ai_prompt_registry_full',
          409,
        );
      }
      return {
        ...document,
        activePrompts: [
          ...document.activePrompts.filter((active) => active.promptId !== promptId),
          { promptId, version },
        ],
      };
    });
  }

  async setState(
    scope: ContentScope,
    input: AiGatewayStateInput,
    actorId: string,
  ): Promise<AiGatewayDocument> {
    return this.#replace(scope, input.expectedVersion, (document) => {
      if (input.state === 'enabled' && document.activePrompts.length === 0) {
        throw gatewayError(
          'Activate at least one prompt before enabling the AI gateway.',
          'invalid_ai_gateway_state',
          400,
        );
      }
      const stateEvents = [
        ...document.stateEvents,
        {
          state: input.state,
          actorId,
          reason: input.reason,
          occurredAt: this.#clock().toISOString(),
        },
      ].slice(-resourceLimits.aiGateway.maximumStateEvents);
      return { ...document, state: input.state, stateEvents };
    });
  }

  #executionPolicy(
    document: AiGatewayDocument,
    input: AiGenerateInput,
    expected?: { promptVersion: number },
  ): ExecutionPolicy {
    if (document.state !== 'enabled') {
      throw gatewayError('The AI gateway is disabled.', 'ai_gateway_disabled', 503);
    }
    const active = document.activePrompts.find((item) => item.promptId === input.promptId);
    if (!active || (expected && active.version !== expected.promptVersion)) {
      throw gatewayError('The requested prompt is not active.', 'ai_prompt_not_active', 409);
    }
    const prompt = document.promptVersions.find(
      (candidate) => candidate.promptId === active.promptId && candidate.version === active.version,
    );
    if (!prompt) {
      throw gatewayError('The active prompt is unavailable.', 'ai_prompt_not_active', 409);
    }
    const model = document.models.find(
      (candidate) =>
        candidate.providerId === input.providerId && candidate.modelId === input.modelId,
    );
    if (!model?.enabled || !prompt.allowedModels.some((candidate) => sameModel(candidate, input))) {
      throw gatewayError('The requested AI model is not allowed.', 'ai_model_not_allowed', 403);
    }
    if (prompt.maximumOutputTokens > model.maximumOutputTokens) {
      throw gatewayError('The requested AI model is not allowed.', 'ai_model_not_allowed', 403);
    }
    return { prompt, model };
  }

  async #sources(
    scope: ContentScope,
    input: AiGenerateInput,
    prompt: AiPromptVersion,
    reader: AiSourceReader,
    redactions: AiRedactionCounts,
  ): Promise<AiProviderRequest['sources']> {
    if (input.sourceIds.length > prompt.retrieval.maximumSources) {
      throw gatewayError(
        'Too many AI retrieval sources were requested.',
        'ai_sources_exceeded',
        400,
      );
    }
    let characters = 0;
    const sources: AiProviderRequest['sources'] = [];
    for (const id of input.sourceIds) {
      const source = await reader.read({ scope, id, perspective: prompt.retrieval.perspective });
      if (!source) {
        throw gatewayError('An AI retrieval source was not found.', 'ai_source_not_found', 404);
      }
      if (contentScopeKey(source) !== contentScopeKey(scope)) {
        throw gatewayError(
          'An AI retrieval source crossed its scope.',
          'ai_source_scope_denied',
          403,
        );
      }
      const rule = prompt.retrieval.rules.find(
        (candidate) => candidate.contentType === source.contentType,
      );
      if (!rule) {
        throw gatewayError(
          'An AI retrieval source type is not allowed.',
          'ai_source_type_denied',
          403,
        );
      }
      const fields: Record<string, string> = {};
      for (const path of rule.fieldPaths) {
        const selected = sourceValue(valueAtPath(source.data, path));
        if (selected === undefined) continue;
        const redacted = redactAiText(selected);
        addCounts(redactions, redacted.counts);
        characters += redacted.value.length;
        if (characters > resourceLimits.aiGateway.maximumSourceCharacters) {
          throw gatewayError('AI retrieval content is too large.', 'ai_sources_exceeded', 400);
        }
        fields[path] = redacted.value;
      }
      sources.push({
        id: source.id,
        contentType: source.contentType,
        revisionId: source.revisionId,
        fields,
      });
    }
    return sources;
  }

  async #reserve(
    scope: ContentScope,
    input: AiGenerateInput,
    promptVersion: number,
    reservation: AiUsage,
  ): Promise<void> {
    const now = this.#clock();
    const day = now.toISOString().slice(0, 10);
    await this.#mutate(scope, (document) => {
      this.#executionPolicy(document, input, { promptVersion });
      if (document.receipts.some((receipt) => receipt.requestId === input.requestId)) {
        throw gatewayError('That AI request ID was already used.', 'ai_request_duplicate', 409);
      }
      const current = document.dailyUsage.find((usage) => usage.day === day) ?? {
        day,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
      };
      usageFits(current, reservation, document.budgets);
      const nextUsage = {
        day,
        requests: current.requests + reservation.requests,
        inputTokens: current.inputTokens + reservation.inputTokens,
        outputTokens: current.outputTokens + reservation.outputTokens,
        costMicros: current.costMicros + reservation.costMicros,
      };
      return {
        ...document,
        dailyUsage: [...document.dailyUsage.filter((usage) => usage.day !== day), nextUsage].slice(
          -resourceLimits.aiGateway.maximumDailyUsageRecords,
        ),
        receipts: [
          ...document.receipts,
          {
            requestId: input.requestId,
            promptId: input.promptId,
            promptVersion,
            providerId: input.providerId,
            modelId: input.modelId,
            status: 'reserved' as const,
            usageDay: day,
            reservedUsage: reservation,
            createdAt: now.toISOString(),
          },
        ].slice(-resourceLimits.aiGateway.maximumRequestReceipts),
      };
    });
  }

  async #fail(scope: ContentScope, requestId: string): Promise<void> {
    await this.#mutate(scope, (document) => ({
      ...document,
      receipts: document.receipts.map((receipt) =>
        receipt.requestId === requestId && receipt.status === 'reserved'
          ? { ...receipt, status: 'failed' as const, completedAt: this.#clock().toISOString() }
          : receipt,
      ),
    }));
  }

  async #succeed(
    scope: ContentScope,
    input: AiGenerateInput,
    promptVersion: number,
    actual: AiUsage,
  ): Promise<void> {
    await this.#mutate(scope, (document) => {
      this.#executionPolicy(document, input, { promptVersion });
      const receipt = document.receipts.find(
        (candidate) => candidate.requestId === input.requestId,
      );
      if (receipt?.status !== 'reserved') {
        throw gatewayError('The AI usage reservation is unavailable.', 'ai_request_invalid', 409);
      }
      const reserved = receipt.reservedUsage;
      const day = receipt.usageDay;
      if (
        actual.requests > reserved.requests ||
        actual.inputTokens > reserved.inputTokens ||
        actual.outputTokens > reserved.outputTokens ||
        actual.costMicros > reserved.costMicros
      ) {
        throw gatewayError('The AI provider exceeded its reservation.', 'ai_provider_invalid', 502);
      }
      const current = document.dailyUsage.find((usage) => usage.day === day);
      if (!current) {
        throw gatewayError('The AI usage reservation is unavailable.', 'ai_request_invalid', 409);
      }
      const nextUsage = {
        day,
        requests: current.requests - (reserved.requests - actual.requests),
        inputTokens: current.inputTokens - (reserved.inputTokens - actual.inputTokens),
        outputTokens: current.outputTokens - (reserved.outputTokens - actual.outputTokens),
        costMicros: current.costMicros - (reserved.costMicros - actual.costMicros),
      };
      return {
        ...document,
        dailyUsage: document.dailyUsage.map((usage) => (usage.day === day ? nextUsage : usage)),
        receipts: document.receipts.map((candidate) =>
          candidate.requestId === input.requestId
            ? {
                ...candidate,
                status: 'succeeded' as const,
                actualUsage: actual,
                completedAt: this.#clock().toISOString(),
              }
            : candidate,
        ),
      };
    });
  }

  async execute(input: {
    scope: ContentScope;
    request: AiGenerateInput;
    sourceReader: AiSourceReader;
    outputContract?: 'gridstory.authoring-suggestions.v1';
  }): Promise<AiGenerateResult> {
    const initial = await this.snapshot(input.scope);
    if (initial.receipts.some((receipt) => receipt.requestId === input.request.requestId)) {
      throw gatewayError('That AI request ID was already used.', 'ai_request_duplicate', 409);
    }
    const { prompt, model } = this.#executionPolicy(initial, input.request);
    const provider = this.#providers.get(input.request.providerId);
    if (!provider) {
      throw gatewayError('The AI provider is unavailable.', 'ai_provider_unavailable', 503);
    }
    const redactions: AiRedactionCounts = { credentials: 0, emails: 0, phones: 0, ips: 0 };
    const redactedInput = redactAiText(input.request.input);
    addCounts(redactions, redactedInput.counts);
    const redactedInstructions = redactAiText(prompt.instructions);
    addCounts(redactions, redactedInstructions.counts);
    const sources = await this.#sources(
      input.scope,
      input.request,
      prompt,
      input.sourceReader,
      redactions,
    );
    const providerRequest = aiProviderRequestSchema.parse({
      requestId: input.request.requestId,
      providerId: input.request.providerId,
      modelId: input.request.modelId,
      prompt: {
        id: prompt.promptId,
        version: prompt.version,
        instructions: redactedInstructions.value,
      },
      input: redactedInput.value,
      sources,
      maximumOutputTokens: prompt.maximumOutputTokens,
      timeoutMs: prompt.timeoutMs,
      ...(input.outputContract ? { outputContract: input.outputContract } : {}),
    });
    let estimate: AiProviderEstimate;
    try {
      estimate = aiProviderEstimateSchema.parse(await provider.estimate(providerRequest));
    } catch {
      throw gatewayError(
        'The AI provider could not estimate this request.',
        'ai_provider_unavailable',
        503,
      );
    }
    if (estimate.inputTokens > model.maximumInputTokens) {
      throw gatewayError(
        'The AI request exceeds the model input limit.',
        'ai_input_tokens_exceeded',
        400,
      );
    }
    const cost = Math.max(
      estimate.costMicros,
      estimatedCost(estimate.inputTokens, prompt.maximumOutputTokens, model),
    );
    if (cost > prompt.maximumCostMicros) {
      throw gatewayError('The AI request exceeds the prompt cost limit.', 'ai_cost_exceeded', 400);
    }
    const reservation: AiUsage = {
      requests: 1,
      inputTokens: estimate.inputTokens,
      outputTokens: prompt.maximumOutputTokens,
      costMicros: cost,
    };
    await this.#reserve(input.scope, input.request, prompt.version, reservation);

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(gatewayError('The AI provider timed out.', 'ai_provider_timeout', 504));
        }, prompt.timeoutMs);
      });
      const generated = await Promise.race([
        provider.generate(providerRequest, controller.signal),
        timeout,
      ]);
      const result = aiProviderResultSchema.parse(generated);
      const actual: AiUsage = {
        requests: 1,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicros: result.costMicros,
      };
      const redactedOutput = redactAiText(result.output);
      addCounts(redactions, redactedOutput.counts);
      await this.#succeed(input.scope, input.request, prompt.version, actual);
      return aiGenerateResultSchema.parse({
        requestId: input.request.requestId,
        promptId: prompt.promptId,
        promptVersion: prompt.version,
        providerId: input.request.providerId,
        modelId: input.request.modelId,
        output: redactedOutput.value.slice(0, resourceLimits.aiGateway.maximumOutputCharacters),
        trust: 'untrusted',
        sources: sources.map(({ id, contentType, revisionId }) => ({
          id,
          contentType,
          revisionId,
        })),
        usage: actual,
        redactions,
        finishReason: result.finishReason,
      });
    } catch (error) {
      controller.abort();
      await this.#fail(input.scope, input.request.requestId);
      if (error instanceof GridStoryError) {
        if (
          error.code === 'ai_gateway_disabled' ||
          error.code === 'ai_prompt_not_active' ||
          error.code === 'ai_model_not_allowed'
        ) {
          throw gatewayError(
            'The AI gateway was disabled while the request was running.',
            'ai_gateway_disabled_during_request',
            503,
          );
        }
        if (
          error.code === 'ai_provider_timeout' ||
          error.code === 'ai_provider_invalid' ||
          error.code === 'ai_request_invalid'
        ) {
          throw error;
        }
      }
      throw gatewayError('The AI provider request failed.', 'ai_provider_failed', 502);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
