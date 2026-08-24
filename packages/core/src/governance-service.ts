import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  type ContentScope,
  type CustomerManagedKeyReference,
  type DataSubject,
  type DataSubjectRequest,
  type GovernanceBackupEvidence,
  type GovernanceEvent,
  type GovernanceEventAction,
  type GovernanceExportEnvelope,
  type GovernanceExportPackage,
  type GovernancePlan,
  type GovernancePlanCandidate,
  type GovernancePolicyInput,
  type GovernanceResourceTarget,
  type GovernanceResourceType,
  type GovernanceSnapshot,
  type GovernanceTarget,
  governancePolicyInputSchema,
  type LegalHold,
  legalHoldInputSchema,
  type PlacementAttestation,
  type ResidencyPolicy,
  type ResidencyStatus,
  resourceLimits,
  type SubjectResourceLink,
  subjectResourceLinkInputSchema,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';
import {
  emptyGovernanceDocument,
  type GovernanceDocument,
  type GovernanceRepository,
  InMemoryGovernanceRepository,
} from './governance-repository.js';
import { canonicalJson, logicalChecksum } from './portability-service.js';
import {
  assertSameContentScope,
  emitTenantTelemetry,
  type TenantTelemetrySink,
} from './tenant-scope.js';
import type { Awaitable } from './types.js';

const WRITE_RETRIES = 4;

export interface GovernanceResourceInspection {
  exists: boolean;
  version?: string;
  updatedAt?: string;
  effect: string;
}

export interface GovernedResourceProcessor {
  readonly type: GovernanceResourceType;
  readonly name: string;
  inspect(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
  }): Awaitable<GovernanceResourceInspection>;
  export(input: { scope: ContentScope; resource: GovernanceResourceTarget }): Awaitable<unknown>;
  erase(input: {
    scope: ContentScope;
    resource: GovernanceResourceTarget;
    action: 'delete' | 'anonymize';
    actorId: string;
  }): Awaitable<{ effect: string; externalReceipt?: string }>;
}

export interface CustomerManagedKeyDescription {
  adapter: CustomerManagedKeyReference['adapter'];
  keyId: string;
  keyVersion?: string;
  region: string;
  state: 'active' | 'disabled' | 'pending-deletion' | 'unavailable';
}

export interface CustomerManagedKeyAdapter {
  readonly name: CustomerManagedKeyReference['adapter'];
  describe(input: {
    scope: ContentScope;
    reference: CustomerManagedKeyReference;
  }): Awaitable<CustomerManagedKeyDescription>;
  wrap(input: {
    scope: ContentScope;
    reference: CustomerManagedKeyReference;
    plaintextKey: Uint8Array;
    context: Record<string, string>;
  }): Awaitable<Uint8Array>;
  unwrap(input: {
    scope: ContentScope;
    reference: CustomerManagedKeyReference;
    wrappedKey: Uint8Array;
    context: Record<string, string>;
  }): Awaitable<Uint8Array>;
}

export interface DataPlacementAdapter {
  readonly name: string;
  inspect(input: {
    scope: ContentScope;
    resourceType: GovernanceResourceType;
    purpose: PlacementAttestation['purpose'];
  }): Awaitable<PlacementAttestation>;
}

export class ConfiguredPlacementAdapter implements DataPlacementAdapter {
  readonly name = 'configured-placement';
  readonly #regions: Record<GovernanceResourceType, string[]>;
  readonly #now: () => Date;

  constructor(
    regions: Partial<Record<GovernanceResourceType, string[]>> = {},
    now: () => Date = () => new Date(),
  ) {
    this.#regions = {
      content: regions.content ?? ['local'],
      asset: regions.asset ?? ['local'],
      identity: regions.identity ?? ['local'],
      plugin: regions.plugin ?? ['local'],
    };
    this.#now = now;
  }

  inspect(input: {
    resourceType: GovernanceResourceType;
    purpose: PlacementAttestation['purpose'];
  }): PlacementAttestation {
    return {
      adapter: this.name,
      resourceType: input.resourceType,
      purpose: input.purpose,
      regions: [...this.#regions[input.resourceType]],
      checkedAt: this.#now().toISOString(),
      evidenceReference: 'deployment-config',
    };
  }
}

export class InMemoryCustomerManagedKeyAdapter implements CustomerManagedKeyAdapter {
  readonly name = 'custom' as const;
  readonly #key: Buffer;
  readonly #region: string;

  constructor(key: Uint8Array, region = 'local') {
    if (key.byteLength !== 32) throw new Error('The in-memory wrapping key must be 32 bytes.');
    this.#key = Buffer.from(key);
    this.#region = region;
  }

  describe(input: { reference: CustomerManagedKeyReference }): CustomerManagedKeyDescription {
    return {
      adapter: this.name,
      keyId: input.reference.keyId,
      ...(input.reference.keyVersion ? { keyVersion: input.reference.keyVersion } : {}),
      region: this.#region,
      state: 'active',
    };
  }

  wrap(input: { plaintextKey: Uint8Array; context: Record<string, string> }): Uint8Array {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(canonicalJson(input.context)));
    const ciphertext = Buffer.concat([cipher.update(input.plaintextKey), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  unwrap(input: { wrappedKey: Uint8Array; context: Record<string, string> }): Uint8Array {
    const wrapped = Buffer.from(input.wrappedKey);
    if (wrapped.byteLength < 29) throw new Error('The wrapped data key is invalid.');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, wrapped.subarray(0, 12));
    decipher.setAAD(Buffer.from(canonicalJson(input.context)));
    decipher.setAuthTag(wrapped.subarray(12, 28));
    return Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]);
  }
}

export interface GovernanceServiceOptions {
  repository?: GovernanceRepository;
  processors?: GovernedResourceProcessor[];
  keyAdapter?: CustomerManagedKeyAdapter;
  placementAdapter?: DataPlacementAdapter;
  telemetry?: TenantTelemetrySink;
  now?: () => Date;
  createId?: () => string;
}

function targetMatches(left: GovernanceResourceTarget, right: GovernanceResourceTarget): boolean {
  return left.type === right.type && left.id === right.id;
}

function eventHash(event: Omit<GovernanceEvent, 'eventHash'>): string {
  return logicalChecksum({
    id: event.id,
    organizationId: event.organizationId,
    tenantId: event.tenantId,
    workspaceId: event.workspaceId,
    siteId: event.siteId,
    environmentId: event.environmentId,
    locale: event.locale,
    sequence: event.sequence,
    action: event.action,
    outcome: event.outcome,
    actorId: event.actorId,
    subjectId: event.subjectId ?? null,
    resource: event.resource ?? null,
    reason: event.reason ?? null,
    occurredAt: event.occurredAt,
    previousHash: event.previousHash ?? null,
  });
}

function planDigest(input: {
  scope: ContentScope;
  kind: GovernancePlan['kind'];
  requestId?: string;
  subjectId?: string;
  documentVersion: number;
  candidates: GovernancePlanCandidate[];
}): string {
  return logicalChecksum({
    scope: input.scope,
    kind: input.kind,
    requestId: input.requestId ?? null,
    subjectId: input.subjectId ?? null,
    documentVersion: input.documentVersion,
    candidates: input.candidates.map((candidate) => ({
      id: candidate.id,
      subjectId: candidate.subjectId ?? null,
      linkId: candidate.linkId ?? null,
      ruleId: candidate.ruleId ?? null,
      resource: candidate.resource,
      action: candidate.action,
      state: candidate.state,
      blockers: candidate.blockers,
      expectedVersion: candidate.expectedVersion ?? null,
    })),
  });
}

function policyRule(policy: ResidencyPolicy, type: GovernanceResourceType) {
  return policy.rules.find((rule) => rule.resourceType === type);
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

export class GovernanceService {
  readonly #repository: GovernanceRepository;
  readonly #processors = new Map<GovernanceResourceType, GovernedResourceProcessor>();
  readonly #keyAdapter: CustomerManagedKeyAdapter | undefined;
  readonly #placement: DataPlacementAdapter;
  readonly #telemetry: TenantTelemetrySink | undefined;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor({
    repository = new InMemoryGovernanceRepository(),
    processors = [],
    keyAdapter,
    placementAdapter = new ConfiguredPlacementAdapter(),
    telemetry,
    now = () => new Date(),
    createId = randomUUID,
  }: GovernanceServiceOptions = {}) {
    this.#repository = repository;
    this.#keyAdapter = keyAdapter;
    this.#placement = placementAdapter;
    this.#telemetry = telemetry;
    this.#now = now;
    this.#createId = createId;
    processors.forEach((processor) => {
      this.registerProcessor(processor);
    });
  }

  registerProcessor(processor: GovernedResourceProcessor): void {
    if (this.#processors.has(processor.type)) {
      throw new Error(`A governance processor is already registered for ${processor.type}.`);
    }
    this.#processors.set(processor.type, processor);
  }

  async #document(scope: ContentScope): Promise<GovernanceDocument> {
    const document = (await this.#repository.get(scope)) ?? emptyGovernanceDocument(scope);
    assertSameContentScope(scope, document, 'governance repository get');
    return document;
  }

  async #mutate<T>(
    scope: ContentScope,
    operation: (document: GovernanceDocument, now: Date) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const existing = await this.#repository.get(scope);
      const document = existing ?? emptyGovernanceDocument(scope);
      const expectedVersion = existing?.version ?? null;
      const now = this.#now();
      const result = operation(document, now);
      document.version += 1;
      document.updatedAt = now.toISOString();
      if (document.createdAt === '1970-01-01T00:00:00.000Z') {
        document.createdAt = document.updatedAt;
      }
      try {
        await this.#repository.save(document, expectedVersion);
        return structuredClone(result);
      } catch (error) {
        if (!(error instanceof GridStoryError) || error.code !== 'governance_write_conflict') {
          throw error;
        }
      }
    }
    throw new GridStoryError(
      'Governance state changed too frequently. Retry the operation.',
      'governance_write_conflict',
      409,
    );
  }

  #event(
    document: GovernanceDocument,
    now: Date,
    input: {
      action: GovernanceEventAction;
      outcome: GovernanceEvent['outcome'];
      actorId: string;
      subjectId?: string;
      resource?: GovernanceResourceTarget;
      reason?: string;
    },
  ): void {
    const previous = document.events.at(-1);
    const eventWithoutHash: Omit<GovernanceEvent, 'eventHash'> = {
      organizationId: document.organizationId,
      tenantId: document.tenantId,
      workspaceId: document.workspaceId,
      siteId: document.siteId,
      environmentId: document.environmentId,
      locale: document.locale,
      id: this.#createId(),
      sequence: (previous?.sequence ?? 0) + 1,
      action: input.action,
      outcome: input.outcome,
      actorId: input.actorId,
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      ...(input.resource ? { resource: input.resource } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      occurredAt: now.toISOString(),
      ...(previous ? { previousHash: previous.eventHash } : {}),
    };
    document.events.push({ ...eventWithoutHash, eventHash: eventHash(eventWithoutHash) });
  }

  async snapshot(scope: ContentScope): Promise<GovernanceSnapshot> {
    return structuredClone(await this.#document(scope));
  }

  async listScopes(): Promise<ContentScope[]> {
    return await this.#repository.listScopes();
  }

  async savePolicy(
    scope: ContentScope,
    actorId: string,
    value: GovernancePolicyInput,
  ): Promise<GovernanceSnapshot> {
    const input = governancePolicyInputSchema.parse(value);
    for (const rule of input.residencyPolicy.rules) {
      await this.#assertPolicyPlacement(scope, input.residencyPolicy, rule.resourceType, 'write');
    }
    if (input.keyReference) {
      await this.#assertKey(scope, {
        ...input.keyReference,
        updatedBy: actorId,
        updatedAt: this.#now().toISOString(),
      });
    }
    return this.#mutate(scope, (document, now) => {
      const existing = new Map(document.retentionRules.map((rule) => [rule.id, rule]));
      document.retentionRules = input.retentionRules.map((rule) => ({
        ...rule,
        createdBy: existing.get(rule.id)?.createdBy ?? actorId,
        createdAt: existing.get(rule.id)?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      }));
      document.residencyPolicy = {
        ...input.residencyPolicy,
        updatedBy: actorId,
        updatedAt: now.toISOString(),
      };
      if (input.keyReference === null) delete document.keyReference;
      else if (input.keyReference) {
        document.keyReference = {
          ...input.keyReference,
          updatedBy: actorId,
          updatedAt: now.toISOString(),
        };
      }
      this.#event(document, now, {
        action: 'governance.policy.updated',
        outcome: 'success',
        actorId,
        reason: 'retention_residency_key_policy',
      });
      return document;
    });
  }

  async createSubject(
    scope: ContentScope,
    actorId: string,
    reference: string,
  ): Promise<DataSubject> {
    return this.#mutate(scope, (document, now) => {
      if (document.subjects.some((subject) => subject.reference === reference.trim())) {
        throw new GridStoryError(
          'Data subject reference already exists.',
          'governance_conflict',
          409,
        );
      }
      const subject: DataSubject = {
        id: this.#createId(),
        reference: reference.trim(),
        status: 'active',
        createdBy: actorId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      document.subjects.push(subject);
      this.#event(document, now, {
        action: 'governance.subject.created',
        outcome: 'success',
        actorId,
        subjectId: subject.id,
      });
      return subject;
    });
  }

  async linkSubjectResource(
    scope: ContentScope,
    actorId: string,
    subjectId: string,
    value: Omit<SubjectResourceLink, 'id' | 'subjectId' | 'createdBy' | 'createdAt'>,
  ): Promise<SubjectResourceLink> {
    const input = subjectResourceLinkInputSchema.parse(value);
    return this.#mutate(scope, (document, now) => {
      if (!document.subjects.some((subject) => subject.id === subjectId)) {
        throw new NotFoundError('Data subject was not found.');
      }
      if (
        document.links.some(
          (link) => link.subjectId === subjectId && targetMatches(link.resource, input.resource),
        )
      ) {
        throw new GridStoryError(
          'Subject resource link already exists.',
          'governance_conflict',
          409,
        );
      }
      const link: SubjectResourceLink = {
        id: this.#createId(),
        subjectId,
        ...input,
        createdBy: actorId,
        createdAt: now.toISOString(),
      };
      document.links.push(link);
      this.#event(document, now, {
        action: 'governance.subject.linked',
        outcome: 'success',
        actorId,
        subjectId,
        resource: link.resource,
      });
      return link;
    });
  }

  async createHold(
    scope: ContentScope,
    actorId: string,
    value: Omit<LegalHold, 'id' | 'status' | 'createdBy' | 'createdAt'>,
  ): Promise<LegalHold> {
    const input = legalHoldInputSchema.parse(value);
    return this.#mutate(scope, (document, now) => {
      this.#assertTargetExists(document, input.target);
      const hold: LegalHold = {
        id: this.#createId(),
        ...input,
        status: 'active',
        createdBy: actorId,
        createdAt: now.toISOString(),
      };
      document.holds.push(hold);
      this.#event(document, now, {
        action: 'governance.hold.created',
        outcome: 'success',
        actorId,
        ...(hold.target.kind === 'subject' ? { subjectId: hold.target.subjectId } : {}),
        ...(hold.target.kind === 'resource' ? { resource: hold.target.resource } : {}),
        reason: hold.matter,
      });
      return hold;
    });
  }

  async releaseHold(
    scope: ContentScope,
    actorId: string,
    holdId: string,
    reason: string,
  ): Promise<LegalHold> {
    return this.#mutate(scope, (document, now) => {
      const hold = document.holds.find((candidate) => candidate.id === holdId);
      if (!hold) throw new NotFoundError('Legal hold was not found.');
      if (hold.status === 'released') return hold;
      hold.status = 'released';
      hold.releasedBy = actorId;
      hold.releasedAt = now.toISOString();
      hold.releaseReason = reason.trim();
      this.#event(document, now, {
        action: 'governance.hold.released',
        outcome: 'success',
        actorId,
        reason: hold.releaseReason,
      });
      return hold;
    });
  }

  async createRequest(
    scope: ContentScope,
    actorId: string,
    input: { subjectId: string; type: DataSubjectRequest['type']; reason: string },
  ): Promise<DataSubjectRequest> {
    return this.#mutate(scope, (document, now) => {
      if (!document.subjects.some((subject) => subject.id === input.subjectId)) {
        throw new NotFoundError('Data subject was not found.');
      }
      const request: DataSubjectRequest = {
        id: this.#createId(),
        subjectId: input.subjectId,
        type: input.type,
        state: 'requested',
        reason: input.reason.trim(),
        requestedBy: actorId,
        requestedAt: now.toISOString(),
      };
      document.requests.push(request);
      this.#event(document, now, {
        action: 'governance.request.created',
        outcome: 'success',
        actorId,
        subjectId: request.subjectId,
        reason: request.type,
      });
      return request;
    });
  }

  async verifyRequest(
    scope: ContentScope,
    actorId: string,
    requestId: string,
    input: {
      method: NonNullable<DataSubjectRequest['verification']>['method'];
      evidenceReference: string;
    },
  ): Promise<DataSubjectRequest> {
    return this.#mutate(scope, (document, now) => {
      const request = document.requests.find((candidate) => candidate.id === requestId);
      if (!request) throw new NotFoundError('Data-subject request was not found.');
      if (request.state !== 'requested') {
        throw new GridStoryError(
          'Request is not awaiting verification.',
          'invalid_governance_state',
          409,
        );
      }
      request.verification = {
        method: input.method,
        evidenceReference: input.evidenceReference.trim(),
        verifiedBy: actorId,
        verifiedAt: now.toISOString(),
      };
      request.state = 'identity-verified';
      this.#event(document, now, {
        action: 'governance.request.verified',
        outcome: 'success',
        actorId,
        subjectId: request.subjectId,
        reason: request.type,
      });
      return request;
    });
  }

  async reviewRequest(
    scope: ContentScope,
    actorId: string,
    requestId: string,
    input: { decision: 'approve' | 'reject'; reason: string },
  ): Promise<DataSubjectRequest> {
    return this.#mutate(scope, (document, now) => {
      const request = document.requests.find((candidate) => candidate.id === requestId);
      if (!request) throw new NotFoundError('Data-subject request was not found.');
      if (request.state !== 'identity-verified' || !request.verification) {
        throw new GridStoryError(
          'Request must have verified identity before review.',
          'invalid_governance_state',
          409,
        );
      }
      request.reviewedBy = actorId;
      request.reviewedAt = now.toISOString();
      request.reviewReason = input.reason.trim();
      if (input.decision === 'reject') {
        request.state = 'rejected';
        this.#event(document, now, {
          action: 'governance.request.rejected',
          outcome: 'success',
          actorId,
          subjectId: request.subjectId,
          reason: request.reviewReason,
        });
        return request;
      }
      request.state = request.type === 'restriction' ? 'completed' : 'approved';
      if (request.type === 'restriction') {
        document.restrictions.push({
          id: this.#createId(),
          subjectId: request.subjectId,
          reason: request.reason,
          status: 'active',
          createdBy: actorId,
          createdAt: now.toISOString(),
        });
        const subject = document.subjects.find((candidate) => candidate.id === request.subjectId);
        if (subject) {
          subject.status = 'restricted';
          subject.updatedAt = now.toISOString();
        }
        request.completedAt = now.toISOString();
        this.#event(document, now, {
          action: 'governance.restriction.created',
          outcome: 'success',
          actorId,
          subjectId: request.subjectId,
          reason: request.reason,
        });
      }
      this.#event(document, now, {
        action: 'governance.request.approved',
        outcome: 'success',
        actorId,
        subjectId: request.subjectId,
        reason: request.type,
      });
      return request;
    });
  }

  async createRetentionPlan(scope: ContentScope, actorId: string): Promise<GovernancePlan> {
    const source = await this.#document(scope);
    const now = this.#now();
    const candidates: GovernancePlanCandidate[] = [];
    for (const link of source.links) {
      const rule = source.retentionRules.find(
        (candidate) =>
          candidate.enabled &&
          candidate.resourceType === link.resource.type &&
          candidate.classification === link.classification,
      );
      if (!rule) continue;
      const expiresAt = Date.parse(link.retentionBasisAt) + rule.retainForDays * 86_400_000;
      if (expiresAt > now.getTime()) continue;
      candidates.push(
        await this.#candidate(source, link, rule.action, {
          ruleId: rule.id,
          subjectId: link.subjectId,
        }),
      );
    }
    return this.#storePlan(scope, actorId, source.version, {
      kind: 'retention',
      candidates,
    });
  }

  async createErasurePlan(
    scope: ContentScope,
    actorId: string,
    requestId: string,
  ): Promise<GovernancePlan> {
    const source = await this.#document(scope);
    const request = source.requests.find((candidate) => candidate.id === requestId);
    if (!request) throw new NotFoundError('Data-subject request was not found.');
    if (request.type !== 'erasure' || request.state !== 'approved') {
      throw new GridStoryError(
        'Only an approved erasure request can create an erasure plan.',
        'invalid_governance_state',
        409,
      );
    }
    const candidates: GovernancePlanCandidate[] = [];
    for (const link of source.links.filter(
      (candidate) => candidate.subjectId === request.subjectId,
    )) {
      candidates.push(
        await this.#candidate(
          source,
          link,
          link.resource.type === 'identity' ? 'anonymize' : 'delete',
          {
            subjectId: request.subjectId,
          },
        ),
      );
    }
    return this.#storePlan(scope, actorId, source.version, {
      kind: 'subject-erasure',
      requestId,
      subjectId: request.subjectId,
      candidates,
    });
  }

  async #candidate(
    document: GovernanceDocument,
    link: SubjectResourceLink,
    action: 'delete' | 'anonymize',
    metadata: { subjectId?: string; ruleId?: string },
  ): Promise<GovernancePlanCandidate> {
    const blockers = this.#blockers(document, link.subjectId, link.resource);
    const processor = this.#processors.get(link.resource.type);
    let inspection: GovernanceResourceInspection | undefined;
    if (link.resource.external) blockers.push('external_resource_requires_operator_receipt');
    if (!processor) blockers.push('resource_processor_unavailable');
    else {
      try {
        inspection = await processor.inspect({ scope: document, resource: link.resource });
        if (!inspection.exists) blockers.push('resource_not_found');
      } catch (error) {
        blockers.push(`resource_inspection_failed:${errorText(error)}`);
      }
    }
    return {
      id: this.#createId(),
      ...(metadata.subjectId ? { subjectId: metadata.subjectId } : {}),
      linkId: link.id,
      ...(metadata.ruleId ? { ruleId: metadata.ruleId } : {}),
      resource: structuredClone(link.resource),
      action,
      state: blockers.length > 0 ? 'blocked' : 'eligible',
      blockers,
      ...(inspection?.version ? { expectedVersion: inspection.version } : {}),
    };
  }

  async #storePlan(
    scope: ContentScope,
    actorId: string,
    sourceVersion: number,
    input: {
      kind: GovernancePlan['kind'];
      requestId?: string;
      subjectId?: string;
      candidates: GovernancePlanCandidate[];
    },
  ): Promise<GovernancePlan> {
    return this.#mutate(scope, (document, now) => {
      if (document.version !== sourceVersion) {
        throw new GridStoryError(
          'Governance state changed while the plan was inspected.',
          'governance_plan_stale',
          409,
        );
      }
      const documentVersion = document.version + 1;
      const base = {
        scope,
        kind: input.kind,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        documentVersion,
        candidates: input.candidates,
      };
      const plan: GovernancePlan = {
        ...scope,
        id: this.#createId(),
        kind: input.kind,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        state: 'preview',
        documentVersion,
        candidates: input.candidates,
        digest: planDigest(base),
        createdBy: actorId,
        createdAt: now.toISOString(),
      };
      document.plans.push(plan);
      if (input.requestId) {
        const request = document.requests.find((candidate) => candidate.id === input.requestId);
        if (request) request.planId = plan.id;
      }
      this.#event(document, now, {
        action: 'governance.plan.created',
        outcome: 'success',
        actorId,
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        reason: input.kind,
      });
      return plan;
    });
  }

  async approvePlan(
    scope: ContentScope,
    actorId: string,
    planId: string,
    input: {
      digest: string;
      reason: string;
      reauthenticatedAt: string;
      backup: GovernanceBackupEvidence;
    },
  ): Promise<GovernancePlan> {
    const now = this.#now();
    const reauthenticatedAt = Date.parse(input.reauthenticatedAt);
    const backupVerifiedAt = Date.parse(input.backup.verifiedAt);
    if (
      !Number.isFinite(reauthenticatedAt) ||
      now.getTime() - reauthenticatedAt >
        resourceLimits.governance.maximumReauthenticationAgeSeconds * 1_000 ||
      reauthenticatedAt > now.getTime() + 60_000
    ) {
      throw new GridStoryError(
        'A fresh enterprise reauthentication is required.',
        'governance_reauthentication_required',
        403,
      );
    }
    if (
      !Number.isFinite(backupVerifiedAt) ||
      now.getTime() - backupVerifiedAt >
        resourceLimits.governance.maximumBackupEvidenceAgeSeconds * 1_000 ||
      backupVerifiedAt > now.getTime() + 60_000
    ) {
      throw new GridStoryError(
        'Recent verified backup evidence is required.',
        'governance_backup_required',
        409,
      );
    }
    const current = await this.#document(scope);
    if (current.keyReference) await this.#assertKey(scope, current.keyReference);
    await this.residencyStatus(scope, 'erase');
    return this.#mutate(scope, (document, approvalTime) => {
      const plan = document.plans.find((candidate) => candidate.id === planId);
      if (!plan) throw new NotFoundError('Governance plan was not found.');
      if (plan.state !== 'preview') {
        throw new GridStoryError('Plan is not awaiting approval.', 'invalid_governance_state', 409);
      }
      if (plan.createdBy === actorId) {
        throw new GridStoryError(
          'Plan approval requires a different authorized administrator.',
          'governance_separation_required',
          409,
        );
      }
      if (document.version !== plan.documentVersion || input.digest !== plan.digest) {
        throw new GridStoryError(
          'Plan digest or governance version changed after preview.',
          'governance_plan_stale',
          409,
        );
      }
      if (
        plan.candidates.length === 0 ||
        plan.candidates.some((candidate) => candidate.state !== 'eligible')
      ) {
        throw new GridStoryError(
          'Every plan candidate must be eligible before approval.',
          'governance_plan_blocked',
          409,
        );
      }
      plan.state = 'approved';
      plan.documentVersion = document.version + 1;
      plan.approval = {
        digest: input.digest,
        approvedBy: actorId,
        approvedAt: approvalTime.toISOString(),
        reauthenticatedAt: input.reauthenticatedAt,
        reason: input.reason.trim(),
        backup: structuredClone(input.backup),
      };
      this.#event(document, approvalTime, {
        action: 'governance.plan.approved',
        outcome: 'success',
        actorId,
        ...(plan.subjectId ? { subjectId: plan.subjectId } : {}),
        reason: input.reason.trim(),
      });
      return plan;
    });
  }

  async processApprovedPlans(
    scope: ContentScope,
    workerId: string,
    limit = resourceLimits.governance.maximumExecutionBatch,
  ): Promise<{ claimed: number; completed: number; blocked: number; failed: number }> {
    const snapshot = await this.#document(scope);
    const plans = snapshot.plans
      .filter((plan) => plan.state === 'approved')
      .slice(0, Math.min(limit, resourceLimits.governance.maximumExecutionBatch));
    const result = { claimed: plans.length, completed: 0, blocked: 0, failed: 0 };
    for (const selected of plans) {
      const started = await this.#mutate(scope, (document, now) => {
        const plan = document.plans.find((candidate) => candidate.id === selected.id);
        if (plan?.state !== 'approved') return false;
        if (document.version !== plan.documentVersion || plan.approval?.digest !== plan.digest) {
          plan.state = 'blocked';
          plan.documentVersion = document.version + 1;
          this.#event(document, now, {
            action: 'governance.plan.blocked',
            outcome: 'denied',
            actorId: workerId,
            ...(plan.subjectId ? { subjectId: plan.subjectId } : {}),
            reason: 'governance_plan_stale',
          });
          return false;
        }
        plan.state = 'executing';
        plan.workerId = workerId;
        plan.startedAt = now.toISOString();
        plan.documentVersion = document.version + 1;
        const request = plan.requestId
          ? document.requests.find((candidate) => candidate.id === plan.requestId)
          : undefined;
        if (request) request.state = 'executing';
        return true;
      });
      if (!started) {
        result.blocked += 1;
        continue;
      }
      let planFailed = false;
      for (const candidateId of selected.candidates.map((candidate) => candidate.id)) {
        const current = await this.#document(scope);
        const plan = current.plans.find((candidate) => candidate.id === selected.id);
        const candidate = plan?.candidates.find((item) => item.id === candidateId);
        if (!plan || !candidate || plan.state !== 'executing') {
          planFailed = true;
          break;
        }
        const blockers = [
          ...(current.version === plan.documentVersion ? [] : ['governance_plan_stale']),
          ...this.#blockers(current, candidate.subjectId, candidate.resource),
        ];
        try {
          await this.#assertPolicyPlacement(
            scope,
            current.residencyPolicy,
            candidate.resource.type,
            'erase',
          );
        } catch (error) {
          blockers.push(`residency_blocked:${errorText(error)}`);
        }
        const processor = this.#processors.get(candidate.resource.type);
        if (!processor) blockers.push('resource_processor_unavailable');
        let inspection: GovernanceResourceInspection | undefined;
        if (processor && blockers.length === 0) {
          try {
            inspection = await processor.inspect({ scope, resource: candidate.resource });
            if (!inspection.exists) blockers.push('resource_not_found');
            if (
              candidate.expectedVersion &&
              inspection.version &&
              candidate.expectedVersion !== inspection.version
            ) {
              blockers.push('resource_version_changed');
            }
          } catch (error) {
            blockers.push(`resource_inspection_failed:${errorText(error)}`);
          }
        }
        if (blockers.length > 0 || !processor) {
          await this.#blockCandidate(scope, selected.id, candidateId, workerId, blockers);
          planFailed = true;
          break;
        }
        try {
          const receipt = await processor.erase({
            scope,
            resource: candidate.resource,
            action: candidate.action,
            actorId: plan.approval?.approvedBy ?? workerId,
          });
          await this.#completeCandidate(scope, selected.id, candidateId, workerId, {
            processor: processor.name,
            effect: receipt.effect,
            ...(receipt.externalReceipt ? { externalReceipt: receipt.externalReceipt } : {}),
          });
        } catch (error) {
          await this.#failCandidate(scope, selected.id, candidateId, workerId, errorText(error));
          result.failed += 1;
          planFailed = true;
          break;
        }
      }
      if (planFailed) {
        result.blocked += 1;
        continue;
      }
      await this.#mutate(scope, (document, now) => {
        const plan = document.plans.find((candidate) => candidate.id === selected.id);
        if (plan?.state !== 'executing') return;
        plan.state = 'completed';
        plan.completedAt = now.toISOString();
        plan.documentVersion = document.version + 1;
        if (plan.requestId) {
          const request = document.requests.find((candidate) => candidate.id === plan.requestId);
          if (request) {
            request.state = 'completed';
            request.completedAt = now.toISOString();
          }
        }
        if (plan.subjectId) {
          const subject = document.subjects.find((candidate) => candidate.id === plan.subjectId);
          if (subject) {
            subject.status = 'erased';
            subject.reference = `erased:${createHash('sha256').update(subject.id).digest('hex').slice(0, 24)}`;
            subject.updatedAt = now.toISOString();
          }
        }
        this.#event(document, now, {
          action: 'governance.plan.completed',
          outcome: 'success',
          actorId: workerId,
          ...(plan.subjectId ? { subjectId: plan.subjectId } : {}),
          reason: plan.kind,
        });
      });
      result.completed += 1;
    }
    await emitTenantTelemetry(this.#telemetry, {
      scope,
      name: 'governance.plan.processed',
      outcome: result.failed > 0 ? 'error' : result.blocked > 0 ? 'denied' : 'success',
      metadata: result,
    });
    return result;
  }

  async #blockCandidate(
    scope: ContentScope,
    planId: string,
    candidateId: string,
    workerId: string,
    blockers: string[],
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      const plan = document.plans.find((candidate) => candidate.id === planId);
      const candidate = plan?.candidates.find((item) => item.id === candidateId);
      if (!plan || !candidate) return;
      candidate.state = 'blocked';
      candidate.blockers = [...new Set(blockers)].slice(0, 20);
      plan.state = 'blocked';
      plan.completedAt = now.toISOString();
      plan.documentVersion = document.version + 1;
      this.#event(document, now, {
        action: 'governance.plan.blocked',
        outcome: 'denied',
        actorId: workerId,
        ...(candidate.subjectId ? { subjectId: candidate.subjectId } : {}),
        resource: candidate.resource,
        reason: candidate.blockers[0] ?? 'blocked',
      });
    });
  }

  async #completeCandidate(
    scope: ContentScope,
    planId: string,
    candidateId: string,
    workerId: string,
    receipt: { processor: string; effect: string; externalReceipt?: string },
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      const plan = document.plans.find((candidate) => candidate.id === planId);
      const candidate = plan?.candidates.find((item) => item.id === candidateId);
      if (!plan || !candidate || candidate.state === 'completed') return;
      candidate.state = 'completed';
      candidate.receipt = { ...receipt, completedAt: now.toISOString() };
      plan.documentVersion = document.version + 1;
      this.#event(document, now, {
        action: 'governance.plan.completed',
        outcome: 'success',
        actorId: workerId,
        ...(candidate.subjectId ? { subjectId: candidate.subjectId } : {}),
        resource: candidate.resource,
        reason: receipt.effect,
      });
    });
  }

  async #failCandidate(
    scope: ContentScope,
    planId: string,
    candidateId: string,
    workerId: string,
    error: string,
  ): Promise<void> {
    await this.#mutate(scope, (document, now) => {
      const plan = document.plans.find((candidate) => candidate.id === planId);
      const candidate = plan?.candidates.find((item) => item.id === candidateId);
      if (!plan || !candidate) return;
      candidate.state = 'failed';
      candidate.error = error;
      plan.state = 'blocked';
      plan.completedAt = now.toISOString();
      plan.documentVersion = document.version + 1;
      this.#event(document, now, {
        action: 'governance.plan.blocked',
        outcome: 'error',
        actorId: workerId,
        ...(candidate.subjectId ? { subjectId: candidate.subjectId } : {}),
        resource: candidate.resource,
        reason: error.slice(0, 500),
      });
    });
  }

  async exportRequest(
    scope: ContentScope,
    actorId: string,
    requestId: string,
    encrypt = true,
  ): Promise<{ package?: GovernanceExportPackage; envelope?: GovernanceExportEnvelope }> {
    await this.assertPlacement(scope, 'content', 'export');
    const document = await this.#document(scope);
    const request = document.requests.find((candidate) => candidate.id === requestId);
    if (!request) throw new NotFoundError('Data-subject request was not found.');
    if (!['access', 'export'].includes(request.type) || request.state !== 'approved') {
      throw new GridStoryError(
        'Only an approved access or export request can be exported.',
        'invalid_governance_state',
        409,
      );
    }
    const subject = document.subjects.find((candidate) => candidate.id === request.subjectId);
    if (!subject) throw new NotFoundError('Data subject was not found.');
    const resources: GovernanceExportPackage['resources'] = [];
    const unsupported: GovernanceResourceTarget[] = [];
    for (const link of document.links.filter((candidate) => candidate.subjectId === subject.id)) {
      const processor = this.#processors.get(link.resource.type);
      if (!processor || link.resource.external) {
        unsupported.push(structuredClone(link.resource));
        continue;
      }
      resources.push({
        linkId: link.id,
        resource: structuredClone(link.resource),
        classification: link.classification,
        data: await processor.export({ scope, resource: link.resource }),
      });
    }
    const generatedAt = this.#now().toISOString();
    const base = {
      format: 'gridstory.governance.subject-export' as const,
      version: 1 as const,
      scope,
      requestId,
      subject: structuredClone(subject),
      generatedAt,
      resources,
      unsupported,
    };
    const packageValue: GovernanceExportPackage = { ...base, checksum: logicalChecksum(base) };
    const result =
      encrypt && document.keyReference
        ? { envelope: await this.#encryptPackage(scope, document.keyReference, packageValue) }
        : { package: packageValue };
    await this.#mutate(scope, (latest, now) => {
      const stored = latest.requests.find((candidate) => candidate.id === requestId);
      if (stored?.state !== 'approved') {
        throw new GridStoryError('Request changed during export.', 'governance_plan_stale', 409);
      }
      stored.state = 'completed';
      stored.completedAt = now.toISOString();
      this.#event(latest, now, {
        action: 'governance.request.exported',
        outcome: 'success',
        actorId,
        subjectId: stored.subjectId,
        reason: document.keyReference && encrypt ? 'encrypted' : 'plaintext_response',
      });
    });
    return result;
  }

  async #encryptPackage(
    scope: ContentScope,
    reference: CustomerManagedKeyReference,
    value: GovernanceExportPackage,
  ): Promise<GovernanceExportEnvelope> {
    const adapter = this.#keyAdapter;
    if (!adapter || adapter.name !== reference.adapter) {
      throw new GridStoryError(
        'Configured customer-managed key adapter is unavailable.',
        'governance_key_unavailable',
        503,
      );
    }
    await this.#assertKey(scope, reference);
    const plaintext = Buffer.from(canonicalJson(value));
    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const context = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      requestId: value.requestId,
      purpose: 'governance-subject-export',
    };
    try {
      const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
      cipher.setAAD(Buffer.from(canonicalJson(context)));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const wrappedDataKey = await adapter.wrap({
        scope,
        reference,
        plaintextKey: dataKey,
        context,
      });
      return {
        format: 'gridstory.governance.export.envelope',
        version: 1,
        requestId: value.requestId,
        algorithm: 'A256GCM',
        key: {
          adapter: reference.adapter,
          keyId: reference.keyId,
          ...(reference.keyVersion ? { keyVersion: reference.keyVersion } : {}),
          expectedRegion: reference.expectedRegion,
        },
        iv: iv.toString('base64url'),
        authenticationTag: cipher.getAuthTag().toString('base64url'),
        wrappedDataKey: Buffer.from(wrappedDataKey).toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        plaintextSha256: createHash('sha256').update(plaintext).digest('hex'),
      };
    } finally {
      dataKey.fill(0);
      plaintext.fill(0);
    }
  }

  async decryptEnvelopeForVerification(
    scope: ContentScope,
    reference: CustomerManagedKeyReference,
    envelope: GovernanceExportEnvelope,
  ): Promise<GovernanceExportPackage> {
    const adapter = this.#keyAdapter;
    if (!adapter || adapter.name !== reference.adapter) {
      throw new GridStoryError(
        'Customer-managed key adapter is unavailable.',
        'governance_key_unavailable',
        503,
      );
    }
    const context = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      requestId: envelope.requestId,
      purpose: 'governance-subject-export',
    };
    const dataKey = Buffer.from(
      await adapter.unwrap({
        scope,
        reference,
        wrappedKey: Buffer.from(envelope.wrappedDataKey, 'base64url'),
        context,
      }),
    );
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        dataKey,
        Buffer.from(envelope.iv, 'base64url'),
      );
      decipher.setAAD(Buffer.from(canonicalJson(context)));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]);
      if (createHash('sha256').update(plaintext).digest('hex') !== envelope.plaintextSha256) {
        throw new GridStoryError(
          'Governance export checksum failed.',
          'governance_export_invalid',
          422,
        );
      }
      return JSON.parse(plaintext.toString('utf8')) as GovernanceExportPackage;
    } finally {
      dataKey.fill(0);
    }
  }

  async assertPlacement(
    scope: ContentScope,
    resourceType: GovernanceResourceType,
    purpose: PlacementAttestation['purpose'],
  ): Promise<PlacementAttestation> {
    const document = await this.#document(scope);
    return this.#assertPolicyPlacement(scope, document.residencyPolicy, resourceType, purpose);
  }

  async assertRegion(
    scope: ContentScope,
    resourceType: GovernanceResourceType,
    region: string,
    evidenceReference?: string,
  ): Promise<void> {
    const document = await this.#document(scope);
    const rule = policyRule(document.residencyPolicy, resourceType);
    if (!rule?.allowedRegions.includes(region)) {
      throw new GridStoryError(
        `Region ${region} is outside the declared ${resourceType} residency policy.`,
        'governance_residency_blocked',
        409,
        { allowedRegions: rule?.allowedRegions ?? [], actualRegions: [region] },
      );
    }
    if (document.residencyPolicy.requireAttestation && !evidenceReference) {
      throw new GridStoryError(
        `Region ${region} requires placement evidence.`,
        'governance_residency_blocked',
        409,
      );
    }
  }

  async #assertPolicyPlacement(
    scope: ContentScope,
    policy: Pick<ResidencyPolicy, 'requireAttestation' | 'rules'>,
    resourceType: GovernanceResourceType,
    purpose: PlacementAttestation['purpose'],
  ): Promise<PlacementAttestation> {
    const rule = policyRule(policy as ResidencyPolicy, resourceType);
    if (!rule) {
      throw new GridStoryError(
        `Residency policy has no ${resourceType} rule.`,
        'governance_residency_blocked',
        409,
      );
    }
    let attestation: PlacementAttestation;
    try {
      attestation = await this.#placement.inspect({ scope, resourceType, purpose });
    } catch (error) {
      throw new GridStoryError(
        `Placement attestation failed: ${errorText(error)}`,
        'governance_residency_blocked',
        409,
      );
    }
    if (
      attestation.resourceType !== resourceType ||
      attestation.purpose !== purpose ||
      attestation.regions.length === 0 ||
      attestation.regions.some((region) => !rule.allowedRegions.includes(region)) ||
      (policy.requireAttestation && !attestation.evidenceReference)
    ) {
      throw new GridStoryError(
        `Placement for ${resourceType} is outside the declared residency policy.`,
        'governance_residency_blocked',
        409,
        { allowedRegions: rule.allowedRegions, actualRegions: attestation.regions },
      );
    }
    return attestation;
  }

  async residencyStatus(
    scope: ContentScope,
    purpose: PlacementAttestation['purpose'] = 'write',
  ): Promise<ResidencyStatus> {
    const document = await this.#document(scope);
    const attestations: PlacementAttestation[] = [];
    const violations: string[] = [];
    for (const rule of document.residencyPolicy.rules) {
      try {
        attestations.push(
          await this.#assertPolicyPlacement(
            scope,
            document.residencyPolicy,
            rule.resourceType,
            purpose,
          ),
        );
      } catch (error) {
        violations.push(errorText(error));
      }
    }
    if (document.keyReference) {
      try {
        await this.#assertKey(scope, document.keyReference);
      } catch (error) {
        violations.push(errorText(error));
      }
    }
    return {
      scope,
      checkedAt: this.#now().toISOString(),
      compliant: violations.length === 0,
      attestations,
      violations,
    };
  }

  async assertWrite(
    scope: ContentScope,
    resourceType: GovernanceResourceType,
    resourceId?: string,
  ): Promise<void> {
    await this.assertPlacement(scope, resourceType, 'write');
    if (!resourceId) return;
    const document = await this.#document(scope);
    const subjects = document.links
      .filter((link) =>
        targetMatches(link.resource, { type: resourceType, id: resourceId, external: false }),
      )
      .map((link) => link.subjectId);
    if (
      document.restrictions.some(
        (restriction) =>
          restriction.status === 'active' && subjects.includes(restriction.subjectId),
      )
    ) {
      throw new GridStoryError(
        'A data-subject processing restriction blocks this write.',
        'governance_processing_restricted',
        423,
      );
    }
  }

  async #assertKey(scope: ContentScope, reference: CustomerManagedKeyReference): Promise<void> {
    const adapter = this.#keyAdapter;
    if (!adapter || adapter.name !== reference.adapter) {
      throw new GridStoryError(
        'Configured customer-managed key adapter is unavailable.',
        'governance_key_unavailable',
        503,
      );
    }
    const description = await adapter.describe({ scope, reference });
    if (
      description.adapter !== reference.adapter ||
      description.keyId !== reference.keyId ||
      description.region !== reference.expectedRegion ||
      description.state !== 'active' ||
      (reference.keyVersion && description.keyVersion !== reference.keyVersion)
    ) {
      throw new GridStoryError(
        'Customer-managed key does not match the active configured key and region.',
        'governance_key_unavailable',
        409,
      );
    }
  }

  #assertTargetExists(document: GovernanceDocument, target: GovernanceTarget): void {
    if (
      target.kind === 'subject' &&
      !document.subjects.some((subject) => subject.id === target.subjectId)
    ) {
      throw new NotFoundError('Data subject was not found.');
    }
    if (
      target.kind === 'resource' &&
      !document.links.some((link) => targetMatches(link.resource, target.resource))
    ) {
      throw new NotFoundError('Governed resource link was not found.');
    }
  }

  #blockers(
    document: GovernanceDocument,
    subjectId: string | undefined,
    resource: GovernanceResourceTarget,
  ): string[] {
    const blockers: string[] = [];
    for (const hold of document.holds.filter((candidate) => candidate.status === 'active')) {
      if (
        hold.target.kind === 'scope' ||
        (hold.target.kind === 'subject' && hold.target.subjectId === subjectId) ||
        (hold.target.kind === 'resource' && targetMatches(hold.target.resource, resource))
      ) {
        blockers.push(`legal_hold:${hold.id}`);
      }
    }
    for (const restriction of document.restrictions.filter(
      (candidate) => candidate.status === 'active' && candidate.subjectId === subjectId,
    )) {
      blockers.push(`processing_restriction:${restriction.id}`);
    }
    return blockers;
  }
}
