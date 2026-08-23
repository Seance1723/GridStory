import { createHash } from 'node:crypto';
import {
  type AudienceCondition,
  type ContentScope,
  type PersonalizationCacheGuidance,
  type PersonalizationConfiguration,
  type PersonalizationConsent,
  type PersonalizationContext,
  type PersonalizationDecision,
  type PersonalizationDecisionRequest,
  type PersonalizationDecisionResult,
  type PersonalizationPreviewRequest,
  type PersonalizationPreviewResult,
  type PersonalizationSnapshot,
  type TargetingAttribute,
  personalizationConfigurationSchema,
  personalizationDecisionRequestSchema,
  personalizationDecisionResultSchema,
  personalizationPreviewRequestSchema,
  personalizationPreviewResultSchema,
} from '@gridstory/schema';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import {
  emptyPersonalizationDocument,
  type PersonalizationRepository,
} from './personalization-repository.js';

interface PersonalizationServiceOptions {
  repository: PersonalizationRepository;
  now?: () => string;
}

type ConditionReason =
  PersonalizationPreviewResult['trace'][number]['conditions'][number]['reason'];

export interface EvaluatedCondition {
  attributeKey: string;
  matched: boolean;
  reason: ConditionReason;
}

export interface EvaluatedAudience {
  audienceId: string;
  matched: boolean;
  conditions: EvaluatedCondition[];
}

export interface EvaluatedDecision extends PersonalizationDecisionResult {
  audienceId?: string;
}

function encoded(value: string | boolean): string {
  return encodeURIComponent(typeof value === 'boolean' ? String(value) : value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function scopeSegment(scope: ContentScope): string {
  return [
    scope.organizationId,
    scope.tenantId,
    scope.workspaceId,
    scope.siteId,
    scope.environmentId,
    scope.locale,
  ]
    .map(encoded)
    .join(':');
}

function attributeValueIsValid(attribute: TargetingAttribute, value: string | boolean): boolean {
  return attribute.valueType === 'boolean'
    ? typeof value === 'boolean'
    : typeof value === 'string' && attribute.allowedValues.includes(value);
}

function consentAllows(
  attribute: TargetingAttribute,
  consent: PersonalizationConsent,
  configuration: PersonalizationConfiguration,
): boolean {
  const granted = new Set(consent.grantedPurposes);
  const denied = new Set(consent.deniedPurposes);
  const purposes = new Map(configuration.purposes.map((purpose) => [purpose.id, purpose]));
  return attribute.requiredPurposes.every((purposeId) => {
    const purpose = purposes.get(purposeId);
    return (
      purpose !== undefined &&
      granted.has(purposeId) &&
      !denied.has(purposeId) &&
      !(consent.globalPrivacyControl && purpose.honorGlobalPrivacyControl)
    );
  });
}

function evaluateCondition(
  condition: AudienceCondition,
  attribute: TargetingAttribute,
  attributes: PersonalizationContext,
  consent: PersonalizationConsent,
  configuration: PersonalizationConfiguration,
): EvaluatedCondition {
  if (!consentAllows(attribute, consent, configuration)) {
    return { attributeKey: attribute.key, matched: false, reason: 'consent-required' };
  }
  const actual = attributes[attribute.key];
  if (actual === undefined) {
    return { attributeKey: attribute.key, matched: false, reason: 'missing-attribute' };
  }
  const equals = actual === condition.value;
  const matched = condition.operator === 'equals' ? equals : !equals;
  return {
    attributeKey: attribute.key,
    matched,
    reason: matched ? 'matched' : 'value-mismatch',
  };
}

function decisionInputs(
  decision: PersonalizationDecision,
  configuration: PersonalizationConfiguration,
): TargetingAttribute[] {
  const audienceIds = new Set(decision.rules.map(({ audienceId }) => audienceId));
  const keys = new Set(
    configuration.audiences
      .filter(({ id }) => audienceIds.has(id))
      .flatMap(({ conditions }) => conditions.map(({ attributeKey }) => attributeKey)),
  );
  return [...keys]
    .map((key) => configuration.attributes.find((attribute) => attribute.key === key))
    .filter((attribute): attribute is TargetingAttribute => attribute !== undefined)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function sharedCacheGuidance(input: {
  scope: ContentScope;
  revision: number;
  decision: PersonalizationDecision;
  configuration: PersonalizationConfiguration;
  attributes: PersonalizationContext;
}): PersonalizationCacheGuidance {
  const inputs = decisionInputs(input.decision, input.configuration);
  const scopeDigest = sha256(scopeSegment(input.scope));
  const tag = `personalization:${scopeDigest}:r${input.revision}`;
  const privateInput = inputs.find(
    (attribute) =>
      attribute.classification === 'personal' ||
      attribute.cacheability !== 'shared' ||
      attribute.source === 'authentication-state' ||
      attribute.requiredPurposes.length > 0,
  );
  if (privateInput) {
    return {
      mode: 'private',
      tag,
      inputs: inputs.map(({ key }) => key),
      reason: `Attribute ${privateInput.key} is personal, consent-dependent, or private-cache only.`,
    };
  }
  const values = inputs.map(({ key }) => [key, input.attributes[key] ?? null]);
  const inputDigest = sha256(JSON.stringify(values));
  return {
    mode: 'shared',
    key: [
      'gridstory-personalization-v1',
      scopeDigest,
      `r${input.revision}`,
      encoded(input.decision.resourceKey),
      inputDigest,
    ].join(':'),
    tag,
    inputs: inputs.map(({ key }) => key),
    reason: 'All decision inputs are bounded public attributes approved for shared caching.',
  };
}

function validateRuntimeInput(
  request: PersonalizationDecisionRequest,
  configuration: PersonalizationConfiguration,
): void {
  const declaredAttributes = new Map(
    configuration.attributes.map((attribute) => [attribute.key, attribute]),
  );
  for (const [key, value] of Object.entries(request.attributes)) {
    const attribute = declaredAttributes.get(key);
    if (!attribute) {
      throw new GridStoryError(
        `Targeting context attribute ${key} is not declared.`,
        'personalization_attribute_unknown',
        400,
      );
    }
    if (!attributeValueIsValid(attribute, value)) {
      throw new GridStoryError(
        `Targeting context attribute ${key} has an invalid value.`,
        'personalization_attribute_invalid',
        400,
      );
    }
  }
  const purposeIds = new Set(configuration.purposes.map(({ id }) => id));
  for (const purposeId of [...request.consent.grantedPurposes, ...request.consent.deniedPurposes]) {
    if (!purposeIds.has(purposeId)) {
      throw new GridStoryError(
        `Consent purpose ${purposeId} is not declared.`,
        'personalization_purpose_unknown',
        400,
      );
    }
  }
}

export function evaluatePersonalizationDecision(input: {
  scope: ContentScope;
  revision: number;
  configuration: PersonalizationConfiguration;
  request: PersonalizationDecisionRequest;
  override?: PersonalizationPreviewRequest['override'];
}): {
  result: EvaluatedDecision;
  trace: EvaluatedAudience[];
} {
  validateRuntimeInput(input.request, input.configuration);
  const decision = input.configuration.decisions.find(
    ({ resourceKey }) => resourceKey === input.request.resourceKey,
  );
  if (!decision) throw new NotFoundError('Personalization decision was not found.');
  const attributes = new Map(
    input.configuration.attributes.map((attribute) => [attribute.key, attribute]),
  );
  const audiences = new Map(
    input.configuration.audiences.map((audience) => [audience.id, audience]),
  );
  const orderedRules = [...decision.rules].sort(
    (left, right) =>
      (audiences.get(left.audienceId)?.priority ?? Number.MAX_SAFE_INTEGER) -
      (audiences.get(right.audienceId)?.priority ?? Number.MAX_SAFE_INTEGER),
  );
  const trace = orderedRules.map((rule): EvaluatedAudience => {
    const audience = audiences.get(rule.audienceId);
    if (!audience) throw new GridStoryError('Targeting audience is missing.', 'invalid_state', 500);
    const conditions = audience.conditions.map((condition) => {
      const attribute = attributes.get(condition.attributeKey);
      if (!attribute) {
        throw new GridStoryError('Targeting attribute is missing.', 'invalid_state', 500);
      }
      return evaluateCondition(
        condition,
        attribute,
        input.request.attributes,
        input.request.consent,
        input.configuration,
      );
    });
    return {
      audienceId: audience.id,
      matched: conditions.every(({ matched }) => matched),
      conditions,
    };
  });

  let variant = decision.fallbackVariant;
  let audienceId: string | undefined;
  let reason: PersonalizationDecisionResult['reason'] = 'fallback';
  const matched = trace.find(({ matched }) => matched);
  if (matched) {
    audienceId = matched.audienceId;
    variant =
      orderedRules.find(({ audienceId: id }) => id === matched.audienceId)?.variant ?? variant;
    reason = 'matched';
  }

  if (input.override?.audienceId) {
    const rule = decision.rules.find(({ audienceId: id }) => id === input.override?.audienceId);
    if (!rule) {
      throw new GridStoryError(
        'Preview audience is not part of this decision.',
        'personalization_preview_override_invalid',
        400,
      );
    }
    audienceId = rule.audienceId;
    variant = rule.variant;
    reason = 'override';
  }
  if (input.override?.variant) {
    if (!decision.variants.includes(input.override.variant)) {
      throw new GridStoryError(
        'Preview variant is not part of this decision.',
        'personalization_preview_override_invalid',
        400,
      );
    }
    if (input.override.audienceId) {
      const rule = decision.rules.find(({ audienceId: id }) => id === input.override?.audienceId);
      if (rule?.variant !== input.override.variant) {
        throw new GridStoryError(
          'Preview audience and variant overrides disagree.',
          'personalization_preview_override_invalid',
          400,
        );
      }
    }
    variant = input.override.variant;
    reason = 'override';
  }

  const cache = sharedCacheGuidance({
    scope: input.scope,
    revision: input.revision,
    decision,
    configuration: input.configuration,
    attributes: input.request.attributes,
  });
  const result: EvaluatedDecision = {
    resourceKey: decision.resourceKey,
    variant,
    ...(audienceId ? { audienceId } : {}),
    reason,
    publishedRevision: input.revision,
    cache,
  };
  return { result, trace };
}

export class PersonalizationService {
  readonly #repository: PersonalizationRepository;
  readonly #now: () => string;

  constructor(options: PersonalizationServiceOptions) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async overview(scope: ContentScope, actorId = 'system'): Promise<PersonalizationSnapshot> {
    return (
      (await this.#repository.get(scope)) ??
      emptyPersonalizationDocument(scope, actorId, this.#now())
    );
  }

  async replaceDraft(input: {
    scope: ContentScope;
    actorId: string;
    expectedVersion: number;
    configuration: PersonalizationConfiguration;
  }): Promise<PersonalizationSnapshot> {
    const configuration = personalizationConfigurationSchema.parse(input.configuration);
    const current = await this.#repository.get(input.scope);
    const document = current
      ? structuredClone(current)
      : emptyPersonalizationDocument(input.scope, input.actorId, this.#now());
    if (document.version !== input.expectedVersion) {
      throw new ConflictError('Personalization draft changed before it could be saved.');
    }
    const now = this.#now();
    document.draft = {
      revision: document.draft.revision + 1,
      configuration,
      updatedAt: now,
      updatedBy: input.actorId,
    };
    document.version += 1;
    document.updatedAt = now;
    await this.#repository.save(document, current?.version ?? null);
    return document;
  }

  async publish(input: {
    scope: ContentScope;
    actorId: string;
    expectedVersion: number;
    expectedDraftRevision: number;
  }): Promise<PersonalizationSnapshot> {
    const current = await this.#repository.get(input.scope);
    if (!current) throw new NotFoundError('Personalization draft was not found.');
    if (
      current.version !== input.expectedVersion ||
      current.draft.revision !== input.expectedDraftRevision
    ) {
      throw new ConflictError('Personalization draft changed before it could be published.');
    }
    const document = structuredClone(current);
    const now = this.#now();
    document.published = {
      ...structuredClone(document.draft),
      publishedAt: now,
      publishedBy: input.actorId,
    };
    document.version += 1;
    document.updatedAt = now;
    await this.#repository.save(document, current.version);
    return document;
  }

  async preview(
    scope: ContentScope,
    request: PersonalizationPreviewRequest,
  ): Promise<PersonalizationPreviewResult> {
    const parsed = personalizationPreviewRequestSchema.parse(request);
    const document = await this.overview(scope);
    const { result, trace } = evaluatePersonalizationDecision({
      scope,
      revision: document.draft.revision,
      configuration: document.draft.configuration,
      request: parsed,
      ...(parsed.override ? { override: parsed.override } : {}),
    });
    return personalizationPreviewResultSchema.parse({
      resourceKey: result.resourceKey,
      variant: result.variant,
      ...(result.audienceId ? { audienceId: result.audienceId } : {}),
      reason: result.reason,
      draftRevision: document.draft.revision,
      cache: {
        mode: 'no-store',
        tag: result.cache.tag,
        inputs: result.cache.inputs,
        reason: 'Draft preview decisions must never enter a cache.',
      },
      trace,
    });
  }

  async decidePublished(
    scope: ContentScope,
    request: PersonalizationDecisionRequest,
  ): Promise<PersonalizationDecisionResult> {
    const parsed = personalizationDecisionRequestSchema.parse(request);
    const document = await this.#repository.get(scope);
    if (!document?.published) {
      throw new NotFoundError('Published personalization configuration was not found.');
    }
    const { audienceId: _audienceId, ...result } = evaluatePersonalizationDecision({
      scope,
      revision: document.published.revision,
      configuration: document.published.configuration,
      request: parsed,
    }).result;
    return personalizationDecisionResultSchema.parse(result);
  }
}
