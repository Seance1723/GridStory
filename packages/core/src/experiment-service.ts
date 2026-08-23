import { createHash } from 'node:crypto';
import {
  type ContentScope,
  type Experiment,
  type ExperimentAllocationRequest,
  type ExperimentAllocationResult,
  type ExperimentDesign,
  type ExperimentGuardrailEvaluation,
  type ExperimentMetricContract,
  type ExperimentMetricSnapshot,
  type ExperimentMetricSnapshotInput,
  type ExperimentOverview,
  type ExperimentTransitionRequest,
  type PersonalizationConfiguration,
  type PersonalizationConsent,
  type PersonalizationSnapshot,
  experimentAllocationRequestSchema,
  experimentAllocationResultSchema,
  experimentDesignSchema,
  experimentMetricSnapshotInputSchema,
  experimentOverviewSchema,
  experimentPromotionRequestSchema,
  experimentSchema,
  experimentTransitionRequestSchema,
  resourceLimits,
} from '@gridstory/schema';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import {
  emptyPersonalizationDocument,
  type PersonalizationRepository,
} from './personalization-repository.js';
import { evaluatePersonalizationDecision } from './personalization-service.js';
import { contentScopeKey } from './tenant-scope.js';

interface ExperimentServiceOptions {
  repository: PersonalizationRepository;
  now?: () => string;
}

function experimentError(message: string, code: string, statusCode = 409): GridStoryError {
  return new GridStoryError(message, code, statusCode);
}

function overview(document: PersonalizationSnapshot): ExperimentOverview {
  return experimentOverviewSchema.parse({
    organizationId: document.organizationId,
    tenantId: document.tenantId,
    workspaceId: document.workspaceId,
    siteId: document.siteId,
    environmentId: document.environmentId,
    locale: document.locale,
    version: document.version,
    targetingDraftRevision: document.draft.revision,
    ...(document.published ? { targetingPublishedRevision: document.published.revision } : {}),
    experiments: document.experiments,
  });
}

function targetVariant(
  configuration: PersonalizationConfiguration,
  design: ExperimentDesign,
): string | undefined {
  const decision = configuration.decisions.find(
    ({ resourceKey }) => resourceKey === design.target.resourceKey,
  );
  if (!decision) return undefined;
  if (!design.target.audienceId) return decision.fallbackVariant;
  return decision.rules.find(({ audienceId }) => audienceId === design.target.audienceId)?.variant;
}

function assertDesignReferences(
  design: ExperimentDesign,
  configuration: PersonalizationConfiguration,
): void {
  const purpose = configuration.purposes.find(({ id }) => id === design.purposeId);
  if (!purpose) {
    throw experimentError(
      'The experiment purpose is not declared by targeting.',
      'experiment_purpose_invalid',
      400,
    );
  }
  const decision = configuration.decisions.find(
    ({ resourceKey }) => resourceKey === design.target.resourceKey,
  );
  if (!decision) {
    throw experimentError(
      'The experiment targeting resource does not exist.',
      'experiment_target_invalid',
      400,
    );
  }
  if (targetVariant(configuration, design) !== design.controlVariant) {
    throw experimentError(
      'The experiment target must currently serve its declared control variant.',
      'experiment_control_mismatch',
      409,
    );
  }
  const declaredVariants = new Set(decision.variants);
  if (design.allocations.some(({ variant }) => !declaredVariants.has(variant))) {
    throw experimentError(
      'Every experiment variant must be declared by the targeting decision.',
      'experiment_variant_invalid',
      400,
    );
  }
}

function purposeAllows(
  purposeId: string,
  consent: PersonalizationConsent,
  configuration: PersonalizationConfiguration,
): boolean {
  const purpose = configuration.purposes.find(({ id }) => id === purposeId);
  if (!purpose) return false;
  return (
    consent.grantedPurposes.includes(purposeId) &&
    !consent.deniedPurposes.includes(purposeId) &&
    !(consent.globalPrivacyControl && purpose.honorGlobalPrivacyControl)
  );
}

function targetingMatches(experiment: Experiment, audienceId: string | undefined): boolean {
  return experiment.target.audienceId
    ? experiment.target.audienceId === audienceId
    : audienceId === undefined;
}

function assignmentBucket(
  scope: ContentScope,
  experiment: Experiment,
  assignmentToken: string,
): number {
  const digest = createHash('sha256')
    .update(`${contentScopeKey(scope)}:${experiment.id}:r${experiment.revision}:${assignmentToken}`)
    .digest('hex');
  return Number(BigInt(`0x${digest.slice(0, 16)}`) % 10_000n);
}

function allocatedVariant(experiment: Experiment, bucket: number): string {
  let ceiling = 0;
  for (const allocation of experiment.allocations) {
    ceiling += allocation.weightBasisPoints;
    if (bucket < ceiling) return allocation.variant;
  }
  throw experimentError(
    'Experiment allocation is incomplete.',
    'experiment_allocation_invalid',
    500,
  );
}

function observation(snapshot: ExperimentMetricSnapshot, variant: string, metricKey: string) {
  return snapshot.variantResults
    .find((result) => result.variant === variant)
    ?.observations.find((candidate) => candidate.metricKey === metricKey);
}

function guardrailEvaluation(
  experiment: Experiment,
  snapshot: ExperimentMetricSnapshot,
  evaluatedAt: string,
): ExperimentGuardrailEvaluation {
  const failures: string[] = [];
  const insufficient: string[] = [];
  const totalExposures = snapshot.variantResults.reduce(
    (total, result) => total + result.exposures,
    0,
  );
  if (totalExposures === 0) {
    insufficient.push('Allocation integrity requires at least one exposure.');
  } else {
    for (const allocation of experiment.allocations) {
      const result = snapshot.variantResults.find(({ variant }) => variant === allocation.variant);
      const observedBasisPoints = Math.round(((result?.exposures ?? 0) * 10_000) / totalExposures);
      if (
        Math.abs(observedBasisPoints - allocation.weightBasisPoints) >
        experiment.maximumAllocationDeviationBasisPoints
      ) {
        failures.push(`Variant ${allocation.variant} exceeds the allocation deviation guardrail.`);
      }
    }
  }

  for (const metric of experiment.metrics) {
    for (const allocation of experiment.allocations) {
      const observed = observation(snapshot, allocation.variant, metric.key);
      if (!observed || observed.sampleSize < metric.minimumSampleSize) {
        insufficient.push(
          `Metric ${metric.key} for ${allocation.variant} is below its minimum sample size.`,
        );
        continue;
      }
      if (metric.role === 'guardrail' && metric.guardrail) {
        const passed =
          metric.guardrail.operator === 'gte'
            ? observed.value >= metric.guardrail.threshold
            : observed.value <= metric.guardrail.threshold;
        if (!passed) {
          failures.push(`Metric ${metric.key} for ${allocation.variant} failed its guardrail.`);
        }
      }
    }
  }

  const status: ExperimentGuardrailEvaluation['status'] = failures.length
    ? 'failed'
    : insufficient.length
      ? 'insufficient-data'
      : 'passed';
  const reasons = [...failures, ...insufficient].slice(
    0,
    resourceLimits.personalization.maximumExperimentGuardrailReasons,
  );
  return {
    snapshotId: snapshot.id,
    status,
    reasons: reasons.length ? reasons : ['All declared experiment guardrails passed.'],
    evaluatedAt,
  };
}

function primaryMetric(experiment: Experiment): ExperimentMetricContract {
  const metric = experiment.metrics.find(({ role }) => role === 'primary');
  if (!metric) {
    throw experimentError(
      'Experiment primary metric is missing.',
      'experiment_metric_invalid',
      500,
    );
  }
  return metric;
}

function assertExpectedVersion(document: PersonalizationSnapshot, expectedVersion: number): void {
  if (document.version !== expectedVersion) {
    throw new ConflictError('Experiment state changed before the operation could complete.');
  }
}

export class ExperimentService {
  readonly #repository: PersonalizationRepository;
  readonly #now: () => string;

  constructor(options: ExperimentServiceOptions) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async overview(scope: ContentScope, actorId = 'system'): Promise<ExperimentOverview> {
    const document =
      (await this.#repository.get(scope)) ??
      emptyPersonalizationDocument(scope, actorId, this.#now());
    return overview(document);
  }

  async saveDraft(input: {
    scope: ContentScope;
    actorId: string;
    expectedVersion: number;
    design: ExperimentDesign;
  }): Promise<ExperimentOverview> {
    const design = experimentDesignSchema.parse(input.design);
    const current = await this.#repository.get(input.scope);
    const document = current
      ? structuredClone(current)
      : emptyPersonalizationDocument(input.scope, input.actorId, this.#now());
    assertExpectedVersion(document, input.expectedVersion);
    assertDesignReferences(design, document.draft.configuration);
    const existingIndex = document.experiments.findIndex(({ id }) => id === design.id);
    const existing = existingIndex >= 0 ? document.experiments[existingIndex] : undefined;
    if (existing && existing.state !== 'draft') {
      throw experimentError(
        'Only a draft experiment design can be edited.',
        'experiment_design_immutable',
      );
    }
    const now = this.#now();
    const experiment = experimentSchema.parse({
      ...design,
      state: 'draft',
      revision: (existing?.revision ?? 0) + 1,
      metricSnapshots: [],
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? input.actorId,
      updatedAt: now,
      updatedBy: input.actorId,
    });
    if (existingIndex >= 0) document.experiments[existingIndex] = experiment;
    else document.experiments.push(experiment);
    document.version += 1;
    document.updatedAt = now;
    await this.#repository.save(document, current?.version ?? null);
    return overview(document);
  }

  async transition(input: {
    scope: ContentScope;
    actorId: string;
    experimentId: string;
    expectedVersion: number;
    action: ExperimentTransitionRequest['action'];
    reason: string;
  }): Promise<ExperimentOverview> {
    const transition = experimentTransitionRequestSchema.parse({
      expectedVersion: input.expectedVersion,
      action: input.action,
      reason: input.reason,
    });
    const current = await this.#repository.get(input.scope);
    if (!current) throw new NotFoundError('Experiment was not found.');
    const document = structuredClone(current);
    assertExpectedVersion(document, transition.expectedVersion);
    const experimentIndex = document.experiments.findIndex(({ id }) => id === input.experimentId);
    const experiment = document.experiments[experimentIndex];
    if (!experiment) throw new NotFoundError('Experiment was not found.');
    const now = this.#now();
    let updated: Experiment;

    if (transition.action === 'start') {
      if (experiment.state !== 'draft') {
        throw experimentError(
          'Only a draft experiment can start.',
          'experiment_transition_invalid',
        );
      }
      if (!document.published) {
        throw experimentError(
          'Published targeting is required before an experiment can start.',
          'experiment_targeting_unpublished',
        );
      }
      assertDesignReferences(experiment, document.published.configuration);
      const overlap = document.experiments.some(
        (candidate) =>
          candidate.id !== experiment.id &&
          ['running', 'paused'].includes(candidate.state) &&
          candidate.target.resourceKey === experiment.target.resourceKey &&
          candidate.target.audienceId === experiment.target.audienceId,
      );
      if (overlap) {
        throw experimentError(
          'Another active experiment already owns this targeting placement.',
          'experiment_target_overlap',
        );
      }
      updated = experimentSchema.parse({
        ...experiment,
        state: 'running',
        targetingRevision: document.published.revision,
        startedAt: now,
        startedBy: input.actorId,
        updatedAt: now,
        updatedBy: input.actorId,
      });
    } else if (transition.action === 'pause') {
      if (experiment.state !== 'running') {
        throw experimentError(
          'Only a running experiment can pause.',
          'experiment_transition_invalid',
        );
      }
      updated = experimentSchema.parse({
        ...experiment,
        state: 'paused',
        pausedAt: now,
        pausedBy: input.actorId,
        pauseReason: transition.reason,
        updatedAt: now,
        updatedBy: input.actorId,
      });
    } else if (transition.action === 'resume') {
      if (experiment.state !== 'paused') {
        throw experimentError(
          'Only a paused experiment can resume.',
          'experiment_transition_invalid',
        );
      }
      if (document.published?.revision !== experiment.targetingRevision) {
        throw experimentError(
          'Published targeting changed while the experiment was paused.',
          'experiment_targeting_drift',
        );
      }
      if (experiment.lastGuardrailEvaluation?.status === 'failed') {
        throw experimentError(
          'A passing metric snapshot is required before a guardrail-paused experiment can resume.',
          'experiment_guardrail_blocked',
          422,
        );
      }
      updated = experimentSchema.parse({
        ...experiment,
        state: 'running',
        updatedAt: now,
        updatedBy: input.actorId,
      });
    } else if (transition.action === 'complete') {
      if (!['running', 'paused'].includes(experiment.state)) {
        throw experimentError(
          'Only a running or paused experiment can complete.',
          'experiment_transition_invalid',
        );
      }
      updated = experimentSchema.parse({
        ...experiment,
        state: 'completed',
        completedAt: now,
        completedBy: input.actorId,
        completionReason: transition.reason,
        updatedAt: now,
        updatedBy: input.actorId,
      });
    } else {
      if (!['draft', 'running', 'paused'].includes(experiment.state)) {
        throw experimentError(
          'This experiment can no longer be cancelled.',
          'experiment_transition_invalid',
        );
      }
      updated = experimentSchema.parse({
        ...experiment,
        state: 'cancelled',
        cancelledAt: now,
        cancelledBy: input.actorId,
        cancellationReason: transition.reason,
        updatedAt: now,
        updatedBy: input.actorId,
      });
    }

    document.experiments[experimentIndex] = updated;
    document.version += 1;
    document.updatedAt = now;
    await this.#repository.save(document, current.version);
    return overview(document);
  }

  async recordMetrics(input: {
    scope: ContentScope;
    actorId: string;
    experimentId: string;
    expectedVersion: number;
    snapshot: ExperimentMetricSnapshotInput;
  }): Promise<ExperimentOverview> {
    const snapshotInput = experimentMetricSnapshotInputSchema.parse(input.snapshot);
    const current = await this.#repository.get(input.scope);
    if (!current) throw new NotFoundError('Experiment was not found.');
    const document = structuredClone(current);
    assertExpectedVersion(document, input.expectedVersion);
    const experimentIndex = document.experiments.findIndex(({ id }) => id === input.experimentId);
    const experiment = document.experiments[experimentIndex];
    if (!experiment) throw new NotFoundError('Experiment was not found.');
    if (!['running', 'paused', 'completed'].includes(experiment.state)) {
      throw experimentError(
        'Metrics can be recorded only for a started, non-cancelled experiment.',
        'experiment_metrics_invalid_state',
      );
    }
    if (experiment.metricSnapshots.some(({ id }) => id === snapshotInput.id)) {
      throw experimentError(
        'Experiment metric snapshot IDs are immutable and unique.',
        'experiment_metric_snapshot_conflict',
      );
    }
    const now = this.#now();
    if (
      Date.parse(snapshotInput.observedAt) > Date.parse(now) ||
      (experiment.startedAt &&
        Date.parse(snapshotInput.observedAt) < Date.parse(experiment.startedAt))
    ) {
      throw experimentError(
        'Experiment metric observation time must fall between start and recording.',
        'experiment_metric_time_invalid',
        400,
      );
    }
    const snapshot: ExperimentMetricSnapshot = {
      ...snapshotInput,
      recordedAt: now,
      recordedBy: input.actorId,
    };
    let updated = experimentSchema.parse({
      ...experiment,
      metricSnapshots: [...experiment.metricSnapshots, snapshot],
      updatedAt: now,
      updatedBy: input.actorId,
    });
    const evaluation = guardrailEvaluation(updated, snapshot, now);
    updated = experimentSchema.parse({
      ...updated,
      lastGuardrailEvaluation: evaluation,
      ...(updated.state === 'running' && evaluation.status === 'failed'
        ? {
            state: 'paused',
            pausedAt: now,
            pausedBy: input.actorId,
            pauseReason: 'A recorded metric snapshot failed an experiment guardrail.',
          }
        : {}),
    });
    document.experiments[experimentIndex] = updated;
    document.version += 1;
    document.updatedAt = now;
    await this.#repository.save(document, current.version);
    return overview(document);
  }

  async allocate(
    scope: ContentScope,
    experimentId: string,
    request: ExperimentAllocationRequest,
  ): Promise<ExperimentAllocationResult> {
    const parsed = experimentAllocationRequestSchema.parse(request);
    const document = await this.#repository.get(scope);
    if (!document?.published) {
      throw new NotFoundError('Published targeting is required for experiment allocation.');
    }
    const experiment = document.experiments.find(({ id }) => id === experimentId);
    if (!experiment) throw new NotFoundError('Experiment was not found.');
    const evaluation = evaluatePersonalizationDecision({
      scope,
      revision: document.published.revision,
      configuration: document.published.configuration,
      request: {
        resourceKey: experiment.target.resourceKey,
        attributes: parsed.attributes,
        consent: parsed.consent,
      },
    }).result;
    const result = (
      participating: boolean,
      reason: ExperimentAllocationResult['reason'],
      variant: string,
    ) =>
      experimentAllocationResultSchema.parse({
        experimentId: experiment.id,
        resourceKey: experiment.target.resourceKey,
        variant,
        participating,
        reason,
        personalizationRevision: document.published?.revision,
        experimentRevision: experiment.revision,
        cache: {
          mode: 'no-store',
          tag: `experiment:${createHash('sha256').update(contentScopeKey(scope)).digest('hex')}:${experiment.id}:r${experiment.revision}`,
          reason: 'Experiment assignments contain a consent-gated pseudonymous allocation.',
        },
      });

    if (experiment.state !== 'running') return result(false, 'inactive', evaluation.variant);
    if (document.published.revision !== experiment.targetingRevision) {
      return result(false, 'targeting-drift', evaluation.variant);
    }
    if (!purposeAllows(experiment.purposeId, parsed.consent, document.published.configuration)) {
      return result(false, 'consent-required', evaluation.variant);
    }
    if (!targetingMatches(experiment, evaluation.audienceId)) {
      return result(false, 'not-eligible', evaluation.variant);
    }
    if (!parsed.assignmentToken) {
      throw experimentError(
        'A random per-experiment assignment token is required for participation.',
        'experiment_assignment_token_required',
        400,
      );
    }
    const variant = allocatedVariant(
      experiment,
      assignmentBucket(scope, experiment, parsed.assignmentToken),
    );
    return result(true, 'allocated', variant);
  }

  async promote(input: {
    scope: ContentScope;
    actorId: string;
    experimentId: string;
    expectedVersion: number;
    snapshotId: string;
    winnerVariant: string;
    reason: string;
  }): Promise<ExperimentOverview> {
    const promotion = experimentPromotionRequestSchema.parse({
      expectedVersion: input.expectedVersion,
      snapshotId: input.snapshotId,
      winnerVariant: input.winnerVariant,
      reason: input.reason,
    });
    const current = await this.#repository.get(input.scope);
    if (!current) throw new NotFoundError('Experiment was not found.');
    const document = structuredClone(current);
    assertExpectedVersion(document, promotion.expectedVersion);
    const experimentIndex = document.experiments.findIndex(({ id }) => id === input.experimentId);
    const experiment = document.experiments[experimentIndex];
    if (!experiment) throw new NotFoundError('Experiment was not found.');
    if (experiment.state !== 'completed') {
      throw experimentError(
        'Only a completed experiment can promote a winner.',
        'experiment_promotion_invalid_state',
      );
    }
    if (promotion.winnerVariant === experiment.controlVariant) {
      throw experimentError(
        'Retaining the control requires no targeting-draft promotion.',
        'experiment_winner_is_control',
      );
    }
    if (!experiment.allocations.some(({ variant }) => variant === promotion.winnerVariant)) {
      throw experimentError(
        'The selected winner is not an experiment variant.',
        'experiment_winner_invalid',
        400,
      );
    }
    const snapshot = experiment.metricSnapshots.find(({ id }) => id === promotion.snapshotId);
    if (!snapshot) throw new NotFoundError('Experiment metric snapshot was not found.');
    const now = this.#now();
    const evaluation = guardrailEvaluation(experiment, snapshot, now);
    if (evaluation.status !== 'passed') {
      throw experimentError(
        'Experiment guardrails and sample requirements must pass before promotion.',
        'experiment_guardrail_blocked',
        422,
      );
    }
    if (
      !experiment.startedAt ||
      Date.parse(now) - Date.parse(experiment.startedAt) <
        experiment.minimumDurationHours * 3_600_000
    ) {
      throw experimentError(
        'The experiment minimum duration has not elapsed.',
        'experiment_duration_blocked',
        422,
      );
    }
    if (!document.published || document.published.revision !== experiment.targetingRevision) {
      throw experimentError(
        'Published targeting changed after the experiment started.',
        'experiment_targeting_drift',
      );
    }
    assertDesignReferences(experiment, document.published.configuration);
    assertDesignReferences(experiment, document.draft.configuration);
    const primary = primaryMetric(experiment);
    const control = observation(snapshot, experiment.controlVariant, primary.key);
    const winner = observation(snapshot, promotion.winnerVariant, primary.key);
    if (!control || !winner) {
      throw experimentError(
        'The selected snapshot does not contain the primary comparison.',
        'experiment_metric_snapshot_invalid',
        422,
      );
    }
    const improved =
      primary.direction === 'increase'
        ? winner.value > control.value
        : winner.value < control.value;
    if (!improved) {
      throw experimentError(
        'The selected winner does not improve the primary metric over control.',
        'experiment_winner_not_supported',
        422,
      );
    }

    const configuration = structuredClone(document.draft.configuration);
    const decision = configuration.decisions.find(
      ({ resourceKey }) => resourceKey === experiment.target.resourceKey,
    );
    if (!decision) {
      throw experimentError('Experiment target is missing.', 'experiment_targeting_drift');
    }
    if (experiment.target.audienceId) {
      const rule = decision.rules.find(
        ({ audienceId }) => audienceId === experiment.target.audienceId,
      );
      if (!rule)
        throw experimentError('Experiment audience is missing.', 'experiment_targeting_drift');
      rule.variant = promotion.winnerVariant;
    } else {
      decision.fallbackVariant = promotion.winnerVariant;
    }
    const targetingDraftRevision = document.draft.revision + 1;
    document.draft = {
      revision: targetingDraftRevision,
      configuration,
      updatedAt: now,
      updatedBy: input.actorId,
    };
    document.experiments[experimentIndex] = experimentSchema.parse({
      ...experiment,
      state: 'promoted',
      lastGuardrailEvaluation: evaluation,
      promotion: {
        winnerVariant: promotion.winnerVariant,
        snapshotId: snapshot.id,
        evidenceDigest: snapshot.evidenceDigest,
        reason: promotion.reason,
        promotedAt: now,
        promotedBy: input.actorId,
        targetingDraftRevision,
      },
      updatedAt: now,
      updatedBy: input.actorId,
    });
    document.version += 1;
    document.updatedAt = now;
    await this.#repository.save(document, current.version);
    return overview(document);
  }
}
