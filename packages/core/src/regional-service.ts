import { createHash, randomUUID } from 'node:crypto';
import {
  regionalFailoverReadinessSchema,
  regionalFailoverResultSchema,
  regionalPolicyInputSchema,
  regionalReadEvidenceSchema,
  resourceLimits,
  type ContentEntry,
  type ContentScope,
  type RegionalConsistencyIndicator,
  type RegionalDocument,
  type RegionalExpectedVersionInput,
  type RegionalFailoverApprovalInput,
  type RegionalFailoverPlan,
  type RegionalFailoverPreflightInput,
  type RegionalFailoverReadiness,
  type RegionalFailoverResult,
  type RegionalPolicyInput,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';
import { emptyRegionalDocument, type RegionalRepository } from './regional-repository.js';
import {
  assertSameContentScope,
  assertValidContentScope,
  contentScopeFields,
  sameContentScope,
} from './tenant-scope.js';
import type { Awaitable, PublishedContentReader } from './types.js';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function regionalCachePartitionDigest(input: {
  scope: ContentScope;
  servedRegion: string;
  topologyVersion: number;
  contentRevision: string;
}): string {
  return sha256(
    canonicalJson({
      schemaVersion: 1,
      scope: input.scope,
      servedRegion: input.servedRegion,
      consistency: 'bounded-staleness',
      topologyVersion: input.topologyVersion,
      contentRevision: input.contentRevision,
    }),
  );
}

function invalidState(message: string, code = 'invalid_regional_state'): never {
  throw new GridStoryError(message, code, 409);
}

function assertTimestampWithin(
  value: string,
  now: Date,
  maximumAgeMs: number,
  message: string,
): void {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    timestamp > now.getTime() + resourceLimits.regional.maximumFutureSkewMs ||
    now.getTime() - timestamp > maximumAgeMs
  ) {
    throw new GridStoryError(message, 'regional_evidence_invalid', 503);
  }
}

function sameBaseScope(left: ContentScope, right: ContentScope): boolean {
  return contentScopeFields
    .filter((field) => field !== 'locale')
    .every((field) => left[field] === right[field]);
}

function assertPublishedEntry(
  scope: ContentScope,
  entry: ContentEntry,
  boundary: string,
  allowOtherLocale = false,
): void {
  assertValidContentScope(entry);
  if (allowOtherLocale ? !sameBaseScope(scope, entry) : !sameContentScope(scope, entry)) {
    throw new GridStoryError(
      'A regional reader returned content outside the requested tenant scope.',
      'tenant_scope_violation',
      500,
      { boundary },
    );
  }
  if (
    !entry.id ||
    entry.id.length > 128 ||
    !entry.contentType ||
    entry.contentType.length > 128 ||
    entry.status === 'draft' ||
    !entry.publishedRevisionId ||
    entry.publishedRevisionId.length > 256 ||
    !entry.data ||
    typeof entry.data !== 'object' ||
    Array.isArray(entry.data)
  ) {
    throw new GridStoryError(
      'A regional reader returned an invalid published content record.',
      'regional_result_invalid',
      503,
    );
  }
}

function assertUniqueEntries(entries: ContentEntry[]): void {
  if (entries.length > resourceLimits.regional.maximumEntriesPerRead) {
    throw new GridStoryError(
      'A regional reader returned too many content records.',
      'regional_result_invalid',
      503,
    );
  }
  if (new Set(entries.map((entry) => `${entry.locale}\u0000${entry.id}`)).size !== entries.length) {
    throw new GridStoryError(
      'A regional reader returned duplicate content records.',
      'regional_result_invalid',
      503,
    );
  }
}

export interface RegionalReadAdapter {
  name: string;
  open(input: {
    scope: ContentScope;
    region: string;
    topologyVersion: number;
    maximumLagMs: number;
  }): Awaitable<{ reader: PublishedContentReader; evidence: unknown }>;
}

export interface RegionalFailoverAdapter {
  name: string;
  preflight(input: {
    scope: ContentScope;
    requestId: string;
    sourceRegion: string;
    targetRegion: string;
    mode: 'planned' | 'emergency';
    topologyVersion: number;
  }): Awaitable<unknown>;
  execute(input: {
    scope: ContentScope;
    requestId: string;
    idempotencyKey: string;
    planDigest: string;
    sourceRegion: string;
    targetRegion: string;
    mode: 'planned' | 'emergency';
    topologyVersion: number;
  }): Awaitable<unknown>;
  reconcile(input: {
    scope: ContentScope;
    requestId: string;
    idempotencyKey: string;
    planDigest: string;
    sourceRegion: string;
    targetRegion: string;
    mode: 'planned' | 'emergency';
    topologyVersion: number;
  }): Awaitable<unknown>;
}

export interface RegionalResidencyGate {
  assertRegion(
    scope: ContentScope,
    resourceType: 'content',
    region: string,
    evidenceReference?: string,
  ): Awaitable<void>;
}

export interface RegionalReadSession {
  reader: PublishedContentReader;
  managed: boolean;
  indicator(entries: ContentEntry[]): RegionalConsistencyIndicator;
}

export interface RegionalServiceOptions {
  repository: RegionalRepository;
  primary: PublishedContentReader;
  localRegion?: string;
  readAdapters?: RegionalReadAdapter[];
  failoverAdapters?: RegionalFailoverAdapter[];
  residency: RegionalResidencyGate;
  now?: () => Date;
}

export class RegionalService {
  readonly #repository: RegionalRepository;
  readonly #primary: PublishedContentReader;
  readonly #localRegion: string;
  readonly #readAdapters: ReadonlyMap<string, RegionalReadAdapter>;
  readonly #failoverAdapters: ReadonlyMap<string, RegionalFailoverAdapter>;
  readonly #residency: RegionalResidencyGate;
  readonly #now: () => Date;

  constructor(options: RegionalServiceOptions) {
    this.#repository = options.repository;
    this.#primary = options.primary;
    this.#localRegion = options.localRegion ?? 'local';
    this.#residency = options.residency;
    this.#now = options.now ?? (() => new Date());
    this.#readAdapters = new Map((options.readAdapters ?? []).map((item) => [item.name, item]));
    this.#failoverAdapters = new Map(
      (options.failoverAdapters ?? []).map((item) => [item.name, item]),
    );
    if (this.#readAdapters.size !== (options.readAdapters ?? []).length) {
      throw new Error('Regional read adapter names must be unique.');
    }
    if (this.#failoverAdapters.size !== (options.failoverAdapters ?? []).length) {
      throw new Error('Regional failover adapter names must be unique.');
    }
  }

  async #document(scope: ContentScope): Promise<RegionalDocument> {
    assertValidContentScope(scope);
    return (
      (await this.#repository.get(scope)) ??
      emptyRegionalDocument(scope, undefined, this.#localRegion)
    );
  }

  async snapshot(scope: ContentScope): Promise<RegionalDocument> {
    return structuredClone(await this.#document(scope));
  }

  async #save(current: RegionalDocument, next: RegionalDocument): Promise<RegionalDocument> {
    await this.#repository.save(next, current.version === 0 ? null : current.version);
    return structuredClone(next);
  }

  async updatePolicy(
    scope: ContentScope,
    input: RegionalPolicyInput,
    actorId: string,
  ): Promise<RegionalDocument> {
    const parsed = regionalPolicyInputSchema.parse(input);
    const current = await this.#document(scope);
    if (parsed.expectedVersion !== current.version) {
      throw new GridStoryError(
        'Regional topology changed before this update.',
        'regional_write_conflict',
        409,
      );
    }
    const now = this.#now();
    const blocksChange = current.operations.some(
      (operation) =>
        operation.state === 'executing' ||
        operation.state === 'ambiguous' ||
        ((operation.state === 'preview' || operation.state === 'approved') &&
          Date.parse(operation.expiresAt) > now.getTime()),
    );
    if (blocksChange) {
      invalidState('Regional topology cannot change while a failover plan is active.');
    }
    if (parsed.state === 'enabled') {
      await this.#residency.assertRegion(
        scope,
        'content',
        parsed.activeControlRegion,
        parsed.activeControlEvidenceReference,
      );
      for (const region of parsed.readRegions.filter((item) => item.enabled)) {
        if (!this.#readAdapters.has(region.adapter)) {
          throw new GridStoryError(
            `Regional read adapter ${region.adapter} is unavailable.`,
            'regional_adapter_unavailable',
            503,
          );
        }
        await this.#residency.assertRegion(
          scope,
          'content',
          region.region,
          region.residencyEvidenceReference,
        );
      }
      if (parsed.failoverAdapter && !this.#failoverAdapters.has(parsed.failoverAdapter)) {
        throw new GridStoryError(
          `Regional failover adapter ${parsed.failoverAdapter} is unavailable.`,
          'regional_adapter_unavailable',
          503,
        );
      }
    }
    const next: RegionalDocument = {
      ...current,
      state: parsed.state,
      activeControlRegion: parsed.activeControlRegion,
      ...(parsed.activeControlEvidenceReference
        ? { activeControlEvidenceReference: parsed.activeControlEvidenceReference }
        : { activeControlEvidenceReference: undefined }),
      topologyVersion: current.topologyVersion + 1,
      readPolicy: parsed.readPolicy,
      readRegions: parsed.readRegions,
      ...(parsed.failoverAdapter
        ? { failoverAdapter: parsed.failoverAdapter }
        : { failoverAdapter: undefined }),
      version: current.version + 1,
      updatedBy: actorId,
      updatedAt: now.toISOString(),
    };
    return this.#save(current, next);
  }

  #validatedReader(scope: ContentScope, reader: PublishedContentReader): PublishedContentReader {
    const assertInputScope = (actual: ContentScope) => {
      assertValidContentScope(actual);
      if (!sameBaseScope(scope, actual)) {
        throw new GridStoryError(
          'A regional read attempted to cross its tenant scope.',
          'tenant_scope_violation',
          500,
          { boundary: 'regional-reader-input' },
        );
      }
    };
    return {
      async list(input) {
        assertInputScope(input.scope);
        const entries = await reader.list({ ...input, perspective: 'published' });
        assertUniqueEntries(entries);
        entries.forEach((entry) => {
          assertPublishedEntry(input.scope, entry, 'regional-reader-list');
          if (input.contentType && entry.contentType !== input.contentType) {
            throw new GridStoryError(
              'A regional reader returned an unexpected content type.',
              'regional_result_invalid',
              503,
            );
          }
        });
        return entries;
      },
      async getBySlug(input) {
        assertInputScope(input.scope);
        const entry = await reader.getBySlug({ ...input, perspective: 'published' });
        if (!entry) return null;
        assertPublishedEntry(input.scope, entry, 'regional-reader-slug');
        if (entry.contentType !== input.contentType || entry.data.slug !== input.slug) {
          throw new GridStoryError(
            'A regional reader returned content that does not match the requested slug.',
            'regional_result_invalid',
            503,
          );
        }
        return entry;
      },
      async getTranslationGroup(input) {
        assertInputScope(input.scope);
        const value = await reader.getTranslationGroup(input);
        if (value !== null && (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) || !value)) {
          throw new GridStoryError(
            'A regional reader returned an invalid translation group.',
            'regional_result_invalid',
            503,
          );
        }
        return value;
      },
      async listTranslationVariants(input) {
        assertInputScope(input.scope);
        const entries = await reader.listTranslationVariants({
          ...input,
          perspective: 'published',
        });
        assertUniqueEntries(entries);
        entries.forEach((entry) => {
          assertPublishedEntry(input.scope, entry, 'regional-reader-translations', true);
        });
        return entries;
      },
    };
  }

  #primarySession(
    document: RegionalDocument,
    managed: boolean,
    fallbackUsed: boolean,
  ): RegionalReadSession {
    const observedAt = this.#now().toISOString();
    return {
      reader: this.#validatedReader(document, this.#primary),
      managed,
      indicator: (entries) => ({
        servedRegion: managed ? document.activeControlRegion : this.#localRegion,
        role: 'primary',
        consistency: 'strong',
        observedAt,
        lagMs: 0,
        topologyVersion: document.topologyVersion,
        contentRevision: this.#revisionIndicator(entries),
        cacheMode: 'shared',
        fallbackUsed,
      }),
    };
  }

  #revisionIndicator(entries: ContentEntry[]): string {
    const revisions = entries
      .map((entry) => entry.publishedRevisionId as string)
      .sort((left, right) => left.localeCompare(right));
    return revisions.length === 1 ? (revisions[0] as string) : sha256(revisions.join('\n'));
  }

  async openRead(scope: ContentScope): Promise<RegionalReadSession> {
    const document = await this.#document(scope);
    if (document.state === 'disabled') return this.#primarySession(document, false, false);
    if (document.readPolicy.mode === 'primary-only') {
      await this.#residency.assertRegion(
        scope,
        'content',
        document.activeControlRegion,
        document.activeControlEvidenceReference,
      );
      return this.#primarySession(document, true, false);
    }
    try {
      const configured = document.readRegions.find(
        (item) => item.enabled && item.region === this.#localRegion,
      );
      if (!configured) {
        throw new GridStoryError(
          'No regional reader is configured for this deployment region.',
          'regional_adapter_unavailable',
          503,
        );
      }
      const adapter = this.#readAdapters.get(configured.adapter);
      if (!adapter) {
        throw new GridStoryError(
          'The configured regional reader is unavailable.',
          'regional_adapter_unavailable',
          503,
        );
      }
      const opened = await adapter.open({
        scope,
        region: configured.region,
        topologyVersion: document.topologyVersion,
        maximumLagMs: document.readPolicy.maximumLagMs,
      });
      const evidence = regionalReadEvidenceSchema.parse(opened.evidence);
      assertSameContentScope(scope, evidence, 'regional-read-evidence');
      if (
        evidence.adapter !== adapter.name ||
        evidence.servedRegion !== configured.region ||
        evidence.topologyVersion !== document.topologyVersion ||
        evidence.lagMs > document.readPolicy.maximumLagMs ||
        (configured.residencyEvidenceReference &&
          evidence.residencyEvidenceReference !== configured.residencyEvidenceReference)
      ) {
        throw new GridStoryError(
          'Regional read evidence does not match the active topology.',
          'regional_evidence_invalid',
          503,
        );
      }
      const now = this.#now();
      assertTimestampWithin(
        evidence.observedAt,
        now,
        document.readPolicy.maximumLagMs + resourceLimits.regional.maximumFutureSkewMs,
        'Regional read freshness evidence is outside the configured bound.',
      );
      await this.#residency.assertRegion(
        scope,
        'content',
        configured.region,
        evidence.residencyEvidenceReference,
      );
      if (evidence.cachePartition) {
        assertTimestampWithin(
          evidence.cachePartition.attestedAt,
          now,
          document.readPolicy.maximumLagMs + resourceLimits.regional.maximumFutureSkewMs,
          'Regional cache partition evidence is stale.',
        );
      }
      return {
        reader: this.#validatedReader(scope, opened.reader),
        managed: true,
        indicator: (entries) => {
          const contentRevision = this.#revisionIndicator(entries);
          const cacheDigest = regionalCachePartitionDigest({
            scope,
            servedRegion: evidence.servedRegion,
            topologyVersion: evidence.topologyVersion,
            contentRevision,
          });
          return {
            servedRegion: evidence.servedRegion,
            role: evidence.role,
            consistency: 'bounded-staleness',
            observedAt: evidence.observedAt,
            lagMs: evidence.lagMs,
            topologyVersion: evidence.topologyVersion,
            contentRevision,
            watermarkDigest: sha256(evidence.watermark),
            cacheMode: evidence.cachePartition?.digest === cacheDigest ? 'shared' : 'private',
            fallbackUsed: false,
          };
        },
      };
    } catch {
      if (document.readPolicy.failureMode !== 'primary') {
        throw new GridStoryError(
          'Regional published content is temporarily unavailable.',
          'regional_read_unavailable',
          503,
        );
      }
      await this.#residency.assertRegion(
        scope,
        'content',
        document.activeControlRegion,
        document.activeControlEvidenceReference,
      );
      return this.#primarySession(document, true, true);
    }
  }

  async preflight(
    scope: ContentScope,
    input: RegionalFailoverPreflightInput,
    actorId: string,
  ): Promise<RegionalDocument> {
    const current = await this.#document(scope);
    if (input.expectedVersion !== current.version) {
      throw new GridStoryError(
        'Regional topology changed before preflight.',
        'regional_write_conflict',
        409,
      );
    }
    if (current.state !== 'enabled') invalidState('Regional topology is disabled.');
    const adapter = current.failoverAdapter
      ? this.#failoverAdapters.get(current.failoverAdapter)
      : undefined;
    if (!adapter) {
      throw new GridStoryError(
        'The configured regional failover adapter is unavailable.',
        'regional_adapter_unavailable',
        503,
      );
    }
    if (input.targetRegion === current.activeControlRegion) {
      invalidState('Failover target must differ from the active control region.');
    }
    const target = current.readRegions.find(
      (item) => item.enabled && item.region === input.targetRegion,
    );
    if (!target) invalidState('Failover target must be an enabled regional read location.');
    if (current.operations.some((operation) => operation.requestId === input.requestId)) {
      throw new GridStoryError(
        'Failover request ID already exists.',
        'regional_duplicate_request',
        409,
      );
    }
    const now = this.#now();
    assertTimestampWithin(
      input.backup.verifiedAt,
      now,
      resourceLimits.regional.maximumBackupEvidenceAgeSeconds * 1_000,
      'Failover backup evidence is missing, stale, or future-dated.',
    );
    await this.#residency.assertRegion(
      scope,
      'content',
      current.activeControlRegion,
      current.activeControlEvidenceReference,
    );
    await this.#residency.assertRegion(
      scope,
      'content',
      input.targetRegion,
      target.residencyEvidenceReference,
    );
    let raw: unknown;
    try {
      raw = await adapter.preflight({
        scope,
        requestId: input.requestId,
        sourceRegion: current.activeControlRegion,
        targetRegion: input.targetRegion,
        mode: input.mode,
        topologyVersion: current.topologyVersion,
      });
    } catch {
      throw new GridStoryError(
        'Regional failover preflight could not be completed.',
        'regional_preflight_unavailable',
        503,
      );
    }
    const parsedReadiness = regionalFailoverReadinessSchema.safeParse(raw);
    if (!parsedReadiness.success) {
      throw new GridStoryError(
        'Regional failover readiness evidence is unavailable or invalid.',
        'regional_readiness_invalid',
        503,
      );
    }
    const readiness = parsedReadiness.data;
    this.#assertReadiness(current, input, readiness, adapter.name, now);
    const expiresAt = new Date(
      now.getTime() + resourceLimits.regional.planLifetimeSeconds * 1_000,
    ).toISOString();
    const digest = sha256(
      canonicalJson({
        schemaVersion: 1,
        scope,
        requestId: input.requestId,
        sourceRegion: current.activeControlRegion,
        targetRegion: input.targetRegion,
        mode: input.mode,
        reason: input.reason,
        expectedRpoSeconds: input.expectedRpoSeconds,
        expectedRtoSeconds: input.expectedRtoSeconds,
        backup: input.backup,
        readiness,
        expiresAt,
      }),
    );
    const plan: RegionalFailoverPlan = {
      ...scope,
      id: randomUUID(),
      requestId: input.requestId,
      state: 'preview',
      documentVersion: current.version + 1,
      topologyVersion: current.topologyVersion,
      sourceRegion: current.activeControlRegion,
      targetRegion: input.targetRegion,
      mode: input.mode,
      reason: input.reason,
      expectedRpoSeconds: input.expectedRpoSeconds,
      expectedRtoSeconds: input.expectedRtoSeconds,
      backup: input.backup,
      readiness,
      digest,
      createdBy: actorId,
      createdAt: now.toISOString(),
      expiresAt,
    };
    const next: RegionalDocument = {
      ...current,
      version: current.version + 1,
      operations: [...current.operations, plan].slice(-resourceLimits.regional.maximumOperations),
      updatedBy: actorId,
      updatedAt: now.toISOString(),
    };
    return this.#save(current, next);
  }

  #assertReadiness(
    document: RegionalDocument,
    input: RegionalFailoverPreflightInput,
    readiness: RegionalFailoverReadiness,
    adapterName: string,
    now: Date,
  ): void {
    assertSameContentScope(document, readiness, 'regional-failover-readiness');
    if (
      readiness.adapter !== adapterName ||
      readiness.requestId !== input.requestId ||
      readiness.sourceRegion !== document.activeControlRegion ||
      readiness.targetRegion !== input.targetRegion ||
      readiness.topologyVersion !== document.topologyVersion ||
      !readiness.ready
    ) {
      throw new GridStoryError(
        'Failover readiness evidence does not match the active topology.',
        'regional_readiness_invalid',
        409,
      );
    }
    assertTimestampWithin(
      readiness.checkedAt,
      now,
      resourceLimits.regional.planLifetimeSeconds * 1_000,
      'Failover readiness evidence is stale or future-dated.',
    );
    if (input.mode === 'planned') {
      if (
        input.expectedRpoSeconds !== 0 ||
        !readiness.caughtUp ||
        readiness.replicationLagMs !== 0 ||
        readiness.estimatedDataLossMs !== 0
      ) {
        invalidState('Planned switchover requires caught-up, zero-loss readiness evidence.');
      }
      return;
    }
    if (
      readiness.estimatedDataLossMs < 1 ||
      input.expectedRpoSeconds * 1_000 < readiness.estimatedDataLossMs
    ) {
      invalidState('Emergency failover requires an explicit nonzero RPO covering observed loss.');
    }
  }

  async approve(
    scope: ContentScope,
    planId: string,
    input: RegionalFailoverApprovalInput,
    actor: { id: string; type: string; reauthenticatedAt: string },
  ): Promise<RegionalDocument> {
    const current = await this.#document(scope);
    if (input.expectedVersion !== current.version) {
      throw new GridStoryError(
        'Regional topology changed before approval.',
        'regional_write_conflict',
        409,
      );
    }
    const plan = current.operations.find((item) => item.id === planId);
    if (!plan) throw new NotFoundError('Regional failover plan was not found.');
    if (plan.state !== 'preview' || plan.documentVersion !== current.version) {
      invalidState('Only the current preview plan can be approved.');
    }
    const now = this.#now();
    if (Date.parse(plan.expiresAt) <= now.getTime())
      invalidState('Regional failover plan expired.');
    if (plan.createdBy === actor.id || actor.type !== 'user') {
      throw new GridStoryError(
        'Failover approval requires a different authenticated human.',
        'regional_independent_approval_required',
        403,
      );
    }
    if (input.digest !== plan.digest) invalidState('Failover plan digest does not match.');
    const reauthenticatedAt = Date.parse(actor.reauthenticatedAt);
    if (
      !Number.isFinite(reauthenticatedAt) ||
      reauthenticatedAt > now.getTime() + resourceLimits.regional.maximumFutureSkewMs ||
      now.getTime() - reauthenticatedAt >
        resourceLimits.regional.maximumReauthenticationAgeSeconds * 1_000
    ) {
      throw new GridStoryError(
        'A recent reauthentication is required for failover approval.',
        'regional_reauthentication_required',
        403,
      );
    }
    if (plan.mode === 'emergency' ? !input.acceptDataLoss : input.acceptDataLoss) {
      invalidState(
        plan.mode === 'emergency'
          ? 'Emergency failover requires explicit data-loss acceptance.'
          : 'Planned switchover cannot accept a nonzero data-loss claim.',
      );
    }
    const next = structuredClone(current);
    const stored = next.operations.find((item) => item.id === planId) as RegionalFailoverPlan;
    stored.state = 'approved';
    stored.approval = {
      digest: input.digest,
      approvedBy: actor.id,
      approvedAt: now.toISOString(),
      reauthenticatedAt: actor.reauthenticatedAt,
      reason: input.reason,
      acceptDataLoss: input.acceptDataLoss,
    };
    next.version += 1;
    stored.documentVersion = next.version;
    next.updatedBy = actor.id;
    next.updatedAt = now.toISOString();
    return this.#save(current, next);
  }

  async execute(
    scope: ContentScope,
    planId: string,
    input: RegionalExpectedVersionInput,
    actorId: string,
  ): Promise<RegionalDocument> {
    const current = await this.#document(scope);
    if (input.expectedVersion !== current.version) {
      throw new GridStoryError(
        'Regional topology changed before execution.',
        'regional_write_conflict',
        409,
      );
    }
    const plan = current.operations.find((item) => item.id === planId);
    if (!plan) throw new NotFoundError('Regional failover plan was not found.');
    if (plan.state !== 'approved' || !plan.approval || plan.documentVersion !== current.version) {
      invalidState('Only the current approved failover plan can execute.');
    }
    if (Date.parse(plan.expiresAt) <= this.#now().getTime())
      invalidState('Regional failover plan expired.');
    const adapter = current.failoverAdapter
      ? this.#failoverAdapters.get(current.failoverAdapter)
      : undefined;
    if (!adapter || adapter.name !== plan.readiness.adapter) {
      throw new GridStoryError(
        'The approved failover adapter is unavailable.',
        'regional_adapter_unavailable',
        503,
      );
    }
    const pending = structuredClone(current);
    const stored = pending.operations.find((item) => item.id === planId) as RegionalFailoverPlan;
    stored.state = 'executing';
    stored.startedAt = this.#now().toISOString();
    pending.version += 1;
    stored.documentVersion = pending.version;
    pending.updatedBy = actorId;
    pending.updatedAt = this.#now().toISOString();
    await this.#save(current, pending);
    let raw: unknown;
    try {
      raw = await adapter.execute(this.#adapterOperation(plan));
    } catch {
      await this.#markAmbiguous(scope, planId, actorId);
      throw new GridStoryError(
        'Failover outcome is ambiguous and must be reconciled before another transition.',
        'regional_failover_ambiguous',
        503,
      );
    }
    return this.#applyResult(scope, planId, raw, actorId);
  }

  async reconcile(
    scope: ContentScope,
    planId: string,
    input: RegionalExpectedVersionInput,
    actorId: string,
  ): Promise<RegionalDocument> {
    const current = await this.#document(scope);
    if (input.expectedVersion !== current.version) {
      throw new GridStoryError(
        'Regional topology changed before reconciliation.',
        'regional_write_conflict',
        409,
      );
    }
    const plan = current.operations.find((item) => item.id === planId);
    if (!plan) throw new NotFoundError('Regional failover plan was not found.');
    if (plan.state !== 'executing' && plan.state !== 'ambiguous') {
      invalidState('Only an executing or ambiguous failover can be reconciled.');
    }
    const adapter = current.failoverAdapter
      ? this.#failoverAdapters.get(current.failoverAdapter)
      : undefined;
    if (!adapter || adapter.name !== plan.readiness.adapter) {
      throw new GridStoryError(
        'The failover adapter required for reconciliation is unavailable.',
        'regional_adapter_unavailable',
        503,
      );
    }
    let raw: unknown;
    try {
      raw = await adapter.reconcile(this.#adapterOperation(plan));
    } catch {
      await this.#markAmbiguous(scope, planId, actorId);
      throw new GridStoryError(
        'Failover remains ambiguous and requires operator reconciliation.',
        'regional_failover_ambiguous',
        503,
      );
    }
    return this.#applyResult(scope, planId, raw, actorId);
  }

  #adapterOperation(plan: RegionalFailoverPlan) {
    const scope = Object.fromEntries(
      contentScopeFields.map((field) => [field, plan[field]]),
    ) as unknown as ContentScope;
    return {
      scope,
      requestId: plan.requestId,
      idempotencyKey: plan.requestId,
      planDigest: plan.digest,
      sourceRegion: plan.sourceRegion,
      targetRegion: plan.targetRegion,
      mode: plan.mode,
      topologyVersion: plan.topologyVersion,
    };
  }

  async #markAmbiguous(scope: ContentScope, planId: string, actorId: string): Promise<void> {
    try {
      const current = await this.#document(scope);
      const plan = current.operations.find((item) => item.id === planId);
      if (!plan || (plan.state !== 'executing' && plan.state !== 'ambiguous')) return;
      const next = structuredClone(current);
      const stored = next.operations.find((item) => item.id === planId) as RegionalFailoverPlan;
      stored.state = 'ambiguous';
      next.version += 1;
      stored.documentVersion = next.version;
      next.updatedBy = actorId;
      next.updatedAt = this.#now().toISOString();
      await this.#save(current, next);
    } catch {
      // The persisted executing state and stable request ID remain reconcilable.
    }
  }

  async #applyResult(
    scope: ContentScope,
    planId: string,
    raw: unknown,
    actorId: string,
  ): Promise<RegionalDocument> {
    const current = await this.#document(scope);
    const plan = current.operations.find((item) => item.id === planId);
    if (!plan || (plan.state !== 'executing' && plan.state !== 'ambiguous')) {
      invalidState('Failover result no longer belongs to an active operation.');
    }
    const parsedResult = regionalFailoverResultSchema.safeParse(raw);
    if (!parsedResult.success) {
      await this.#markAmbiguous(scope, planId, actorId);
      throw new GridStoryError(
        'Regional failover result is unavailable or invalid and must be reconciled.',
        'regional_result_invalid',
        503,
      );
    }
    const result = parsedResult.data;
    this.#assertResult(scope, plan, result);
    const next = structuredClone(current);
    const stored = next.operations.find((item) => item.id === planId) as RegionalFailoverPlan;
    stored.result = result;
    if (result.outcome === 'succeeded') {
      stored.state = 'succeeded';
      stored.completedAt = result.completedAt;
      next.activeControlRegion = plan.targetRegion;
      const target = next.readRegions.find((item) => item.region === plan.targetRegion);
      if (target?.residencyEvidenceReference) {
        next.activeControlEvidenceReference = target.residencyEvidenceReference;
      } else {
        delete next.activeControlEvidenceReference;
      }
      next.topologyVersion += 1;
      next.readPolicy = { ...next.readPolicy, mode: 'primary-only', maximumLagMs: 0 };
    } else if (result.outcome === 'failed') {
      stored.state = 'failed';
      stored.completedAt = result.completedAt ?? this.#now().toISOString();
    } else {
      stored.state = 'ambiguous';
    }
    next.version += 1;
    stored.documentVersion = next.version;
    next.updatedBy = actorId;
    next.updatedAt = this.#now().toISOString();
    return this.#save(current, next);
  }

  #assertResult(
    scope: ContentScope,
    plan: RegionalFailoverPlan,
    result: RegionalFailoverResult,
  ): void {
    assertSameContentScope(scope, result, 'regional-failover-result');
    if (
      result.adapter !== plan.readiness.adapter ||
      result.requestId !== plan.requestId ||
      result.sourceRegion !== plan.sourceRegion ||
      result.targetRegion !== plan.targetRegion ||
      result.topologyVersion !== plan.topologyVersion
    ) {
      throw new GridStoryError(
        'Failover result does not match the approved operation.',
        'regional_result_invalid',
        503,
      );
    }
    if (
      result.outcome === 'succeeded' &&
      (result.activeRegion !== plan.targetRegion ||
        result.sourceWritable ||
        !result.targetWritable ||
        !result.completedAt)
    ) {
      throw new GridStoryError(
        'Failover success evidence does not prove a single writable target.',
        'regional_result_invalid',
        503,
      );
    }
  }
}
