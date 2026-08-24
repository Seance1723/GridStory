import {
  canonicalStringify,
  type ContentScope,
  type FleetAdapterObservation,
  fleetAdapterObservationSchema,
  type FleetCondition,
  type FleetDocument,
  fleetDocumentSchema,
  type FleetMemberInput,
  fleetMemberInputSchema,
  type FleetMemberStateInput,
  fleetMemberStateInputSchema,
  type InteroperabilityDiscovery,
  resourceLimits,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';
import { emptyFleetDocument, type FleetRepository } from './fleet-repository.js';
import type { Awaitable } from './types.js';

export interface FleetObservationAdapter {
  id: string;
  observe(input: { signal: AbortSignal }): Awaitable<unknown>;
}

export interface FleetServiceOptions {
  repository: FleetRepository;
  adapters?: FleetObservationAdapter[];
  localDiscovery: InteroperabilityDiscovery;
  now?: () => Date;
  createId?: () => string;
  timeoutMs?: number;
}

function fleetError(message: string, code: string, statusCode: number): GridStoryError {
  return new GridStoryError(message, code, statusCode);
}

function condition(
  type: FleetCondition['type'],
  status: FleetCondition['status'],
  reason: string,
  message: string,
  observedAt: string,
): FleetCondition {
  return { type, status, reason, message, observedAt };
}

function specificationsMatch(
  local: InteroperabilityDiscovery,
  remote: InteroperabilityDiscovery,
): boolean {
  if (local.protocolVersion !== remote.protocolVersion) return false;
  return local.specifications.every((expected) => {
    const observed = remote.specifications.find((candidate) => candidate.kind === expected.kind);
    return (
      observed?.version === expected.version &&
      observed.id === expected.id &&
      observed.mediaType === expected.mediaType &&
      observed.digest === expected.digest
    );
  });
}

export class FleetService {
  readonly #repository: FleetRepository;
  readonly #adapters: ReadonlyMap<string, FleetObservationAdapter>;
  readonly #localDiscovery: InteroperabilityDiscovery;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #timeoutMs: number;

  constructor(options: FleetServiceOptions) {
    this.#repository = options.repository;
    this.#adapters = new Map((options.adapters ?? []).map((adapter) => [adapter.id, adapter]));
    if (this.#adapters.size !== (options.adapters ?? []).length) {
      throw new Error('Fleet observation adapter IDs must be unique.');
    }
    this.#localDiscovery = options.localDiscovery;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (
      this.#timeoutMs < resourceLimits.fleet.minimumObservationTimeoutMs ||
      this.#timeoutMs > resourceLimits.fleet.maximumObservationTimeoutMs
    ) {
      throw new Error('Fleet observation timeout is outside the reviewed resource limits.');
    }
  }

  async snapshot(scope: ContentScope): Promise<FleetDocument> {
    const document =
      (await this.#repository.get(scope)) ?? emptyFleetDocument(scope, this.#now().toISOString());
    const now = this.#now().getTime();
    return {
      ...document,
      observations: document.observations.map((observation) =>
        Date.parse(observation.expiresAt) > now
          ? observation
          : {
              ...observation,
              conditions: observation.conditions.map((candidate) => ({
                ...candidate,
                status: 'unknown' as const,
                reason: 'ObservationExpired',
                message: `${candidate.type} evidence expired and must be checked again.`,
              })),
            },
      ),
    };
  }

  async #replace(
    scope: ContentScope,
    expectedVersion: number,
    actorId: string,
    transform: (document: FleetDocument) => FleetDocument,
  ): Promise<FleetDocument> {
    const persisted = await this.#repository.get(scope);
    const current = persisted ?? emptyFleetDocument(scope, this.#now().toISOString());
    if (current.version !== expectedVersion) {
      throw fleetError('Fleet state changed during this operation.', 'fleet_write_conflict', 409);
    }
    const updated = transform(structuredClone(current));
    const result = fleetDocumentSchema.parse({
      ...updated,
      ...scope,
      schemaVersion: 1,
      version: current.version + 1,
      updatedAt: this.#now().toISOString(),
      updatedBy: actorId,
    });
    await this.#repository.save(result, persisted ? current.version : null);
    return structuredClone(result);
  }

  async upsertMember(input: {
    scope: ContentScope;
    memberId: string;
    member: FleetMemberInput;
    actorId: string;
  }): Promise<FleetDocument> {
    const memberInput = fleetMemberInputSchema.parse(input.member);
    if (!this.#adapters.has(memberInput.adapterId)) {
      throw fleetError(
        'The configured fleet observation adapter is unavailable.',
        'fleet_adapter_unavailable',
        422,
      );
    }
    return this.#replace(input.scope, memberInput.expectedVersion, input.actorId, (document) => {
      const timestamp = this.#now().toISOString();
      const existing = document.members.find((member) => member.id === input.memberId);
      if (!existing && document.members.length >= resourceLimits.fleet.maximumMembers) {
        throw fleetError('The fleet member limit has been reached.', 'fleet_member_limit', 409);
      }
      const member = {
        id: input.memberId,
        generation: (existing?.generation ?? 0) + 1,
        label: memberInput.label,
        adapterId: memberInput.adapterId,
        expectedInstanceId: memberInput.expectedInstanceId,
        ...(memberInput.expectedServiceVersion
          ? { expectedServiceVersion: memberInput.expectedServiceVersion }
          : {}),
        state: existing?.state ?? ('active' as const),
        createdAt: existing?.createdAt ?? timestamp,
        createdBy: existing?.createdBy ?? input.actorId,
        updatedAt: timestamp,
        updatedBy: input.actorId,
      };
      const members = existing
        ? document.members.map((candidate) => (candidate.id === member.id ? member : candidate))
        : [...document.members, member];
      return {
        ...document,
        members,
        events: [
          ...document.events,
          {
            id: `fleet_event_${this.#createId()}`,
            type: existing ? ('member.updated' as const) : ('member.added' as const),
            memberId: member.id,
            memberGeneration: member.generation,
            actorId: input.actorId,
            occurredAt: timestamp,
          },
        ].slice(-resourceLimits.fleet.maximumEvents),
      };
    });
  }

  async setMemberState(input: {
    scope: ContentScope;
    memberId: string;
    state: FleetMemberStateInput;
    actorId: string;
  }): Promise<FleetDocument> {
    const state = fleetMemberStateInputSchema.parse(input.state);
    return this.#replace(input.scope, state.expectedVersion, input.actorId, (document) => {
      const member = document.members.find((candidate) => candidate.id === input.memberId);
      if (!member) throw new NotFoundError('Fleet member was not found.');
      const timestamp = this.#now().toISOString();
      const generation = member.generation + 1;
      return {
        ...document,
        members: document.members.map((candidate) =>
          candidate.id === member.id
            ? {
                ...candidate,
                state: state.state,
                generation,
                updatedAt: timestamp,
                updatedBy: input.actorId,
              }
            : candidate,
        ),
        events: [
          ...document.events,
          {
            id: `fleet_event_${this.#createId()}`,
            type:
              state.state === 'paused' ? ('member.paused' as const) : ('member.updated' as const),
            memberId: member.id,
            memberGeneration: generation,
            actorId: input.actorId,
            occurredAt: timestamp,
          },
        ].slice(-resourceLimits.fleet.maximumEvents),
      };
    });
  }

  async removeMember(input: {
    scope: ContentScope;
    memberId: string;
    expectedVersion: number;
    actorId: string;
  }): Promise<FleetDocument> {
    return this.#replace(input.scope, input.expectedVersion, input.actorId, (document) => {
      const member = document.members.find((candidate) => candidate.id === input.memberId);
      if (!member) throw new NotFoundError('Fleet member was not found.');
      return {
        ...document,
        members: document.members.filter((candidate) => candidate.id !== member.id),
        events: [
          ...document.events,
          {
            id: `fleet_event_${this.#createId()}`,
            type: 'member.removed' as const,
            memberId: member.id,
            memberGeneration: member.generation,
            actorId: input.actorId,
            occurredAt: this.#now().toISOString(),
          },
        ].slice(-resourceLimits.fleet.maximumEvents),
      };
    });
  }

  async #observe(adapter: FleetObservationAdapter): Promise<FleetAdapterObservation> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        adapter.observe({ signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('fleet observation timeout'));
          }, this.#timeoutMs);
        }),
      ]);
      if (
        new TextEncoder().encode(canonicalStringify(raw)).byteLength >
        resourceLimits.fleet.maximumObservationBytes
      ) {
        throw new Error('fleet observation too large');
      }
      const parsed = fleetAdapterObservationSchema.parse(raw);
      const observedAt = Date.parse(parsed.observedAt);
      const expiresAt = Date.parse(parsed.expiresAt);
      const now = this.#now().getTime();
      if (
        observedAt > now + resourceLimits.fleet.maximumFutureSkewMs ||
        expiresAt <= observedAt ||
        expiresAt <= now ||
        expiresAt - observedAt > resourceLimits.fleet.maximumObservationLifetimeSeconds * 1_000
      ) {
        throw new Error('fleet observation freshness invalid');
      }
      return parsed;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async checkMember(input: {
    scope: ContentScope;
    memberId: string;
    expectedVersion: number;
    actorId: string;
  }): Promise<FleetDocument> {
    const initial = await this.snapshot(input.scope);
    if (initial.version !== input.expectedVersion) {
      throw fleetError('Fleet state changed during this operation.', 'fleet_write_conflict', 409);
    }
    const member = initial.members.find((candidate) => candidate.id === input.memberId);
    if (!member) throw new NotFoundError('Fleet member was not found.');
    if (member.state !== 'active') {
      throw fleetError('Paused fleet members cannot be checked.', 'fleet_member_paused', 409);
    }
    const checkedAt = this.#now().toISOString();
    const adapter = this.#adapters.get(member.adapterId);
    let observation: FleetDocument['observations'][number];
    try {
      if (!adapter) throw new Error('adapter unavailable');
      const observed = await this.#observe(adapter);
      const compatible =
        observed.discovery.instanceId === member.expectedInstanceId &&
        (!member.expectedServiceVersion ||
          observed.discovery.serviceVersion === member.expectedServiceVersion) &&
        specificationsMatch(this.#localDiscovery, observed.discovery);
      observation = {
        id: `fleet_observation_${this.#createId()}`,
        memberId: member.id,
        memberGeneration: member.generation,
        checkedAt,
        expiresAt: observed.expiresAt,
        instance: {
          instanceId: observed.discovery.instanceId,
          serviceVersion: observed.discovery.serviceVersion,
          protocolVersion: observed.discovery.protocolVersion,
          specifications: observed.discovery.specifications,
        },
        conditions: [
          condition(
            'Reachable',
            'true',
            'ObservationSucceeded',
            'The instance responded with valid bounded evidence.',
            checkedAt,
          ),
          condition(
            'Ready',
            'true',
            'ReadinessSucceeded',
            'The instance reported ready.',
            checkedAt,
          ),
          condition(
            'Compatible',
            compatible ? 'true' : 'false',
            compatible ? 'ContractsMatch' : 'ContractsDiffer',
            compatible
              ? 'The instance identity and public specification digests match.'
              : 'The instance identity, version, or public specification digests differ.',
            checkedAt,
          ),
        ],
      };
    } catch {
      observation = {
        id: `fleet_observation_${this.#createId()}`,
        memberId: member.id,
        memberGeneration: member.generation,
        checkedAt,
        expiresAt: new Date(this.#now().getTime() + 60_000).toISOString(),
        conditions: [
          condition(
            'Reachable',
            'false',
            'ObservationUnavailable',
            'The instance did not provide valid bounded evidence.',
            checkedAt,
          ),
          condition(
            'Ready',
            'unknown',
            'ObservationUnavailable',
            'Readiness could not be verified.',
            checkedAt,
          ),
          condition(
            'Compatible',
            'unknown',
            'ObservationUnavailable',
            'Compatibility could not be verified.',
            checkedAt,
          ),
        ],
      };
    }
    return this.#replace(input.scope, input.expectedVersion, input.actorId, (document) => ({
      ...document,
      observations: [...document.observations, observation].slice(
        -resourceLimits.fleet.maximumObservations,
      ),
      events: [
        ...document.events,
        {
          id: `fleet_event_${this.#createId()}`,
          type: 'member.checked' as const,
          memberId: member.id,
          memberGeneration: member.generation,
          actorId: input.actorId,
          occurredAt: checkedAt,
        },
      ].slice(-resourceLimits.fleet.maximumEvents),
    }));
  }
}
