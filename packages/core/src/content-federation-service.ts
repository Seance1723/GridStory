import { createPublicKey, randomUUID, verify } from 'node:crypto';
import {
  assertValidContent,
  type ContentFederationDocument,
  type ContentScope,
  contentSchemaDefinitionSchema,
  type FederatedContentRecord,
  type FederationAgreement,
  type FederationAgreementInspectionInput,
  type FederationAgreementStateInput,
  type FederationEnvelopePayload,
  type FederationMirrorRecord,
  type FederationOffer,
  type FederationOfferContract,
  type FederationOfferInput,
  type FederationPublicKey,
  type FederationSnapshotEnvelopePayload,
  type FederationSyncEffect,
  type FederationSyncPlan,
  type FederationSyncPlanExecutionInput,
  type FederationSyncReceipt,
  type FederationTypeDescriptor,
  federatedContentRecordSchema,
  federationAgreementInspectionInputSchema,
  federationAgreementStateInputSchema,
  federationOfferContractSchema,
  federationOfferInputSchema,
  federationPublicKeySchema,
  federationSnapshotEnvelopePayloadSchema,
  federationSyncPlanExecutionInputSchema,
  federationTypeDescriptorSchema,
  GRIDSTORY_CONTENT_FEDERATION_PROTOCOL,
  resourceLimits,
  type SignedFederationEnvelope,
  signedFederationEnvelopeSchema,
} from '@gridstory/schema';
import {
  type ContentFederationRepository,
  emptyContentFederationDocument,
} from './content-federation-repository.js';
import type { ContentService } from './content-service.js';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import { canonicalJson, logicalChecksum } from './portability-service.js';
import { assertValidContentScope, sameContentScope } from './tenant-scope.js';
import type { Awaitable, ContentRepository } from './types.js';

export interface ContentFederationSigner {
  readonly publicKey: FederationPublicKey;
  sign(payload: string): Awaitable<string>;
}

export interface ContentFederationSourceAdapter {
  readonly name: string;
  readOffer(input: {
    sourceScope: ContentScope;
    offerId: string;
    requestId: string;
  }): Awaitable<unknown>;
  readRecord(input: {
    sourceScope: ContentScope;
    offerId: string;
    namespace: string;
    sourceEntryId: string;
    requestId: string;
  }): Awaitable<unknown>;
  readSnapshot(input: {
    sourceScope: ContentScope;
    offerId: string;
    requestId: string;
    maximumRecords: number;
  }): Awaitable<unknown>;
}

export interface ContentFederationServiceOptions {
  repository: ContentFederationRepository;
  contentRepository: ContentRepository;
  contentService: ContentService;
  signer?: ContentFederationSigner;
  sources?: ContentFederationSourceAdapter[];
  now?: () => Date;
  createId?: () => string;
}

function invalidState(message: string, code = 'invalid_content_federation_state'): never {
  throw new GridStoryError(message, code, 409);
}

function samePublicKey(left: FederationPublicKey, right: FederationPublicKey): boolean {
  return (
    left.keyId === right.keyId &&
    left.algorithm === right.algorithm &&
    left.publicKey === right.publicKey
  );
}

function offerContract(offer: FederationOffer): FederationOfferContract {
  const {
    organizationId: _organizationId,
    tenantId: _tenantId,
    workspaceId: _workspaceId,
    siteId: _siteId,
    environmentId: _environmentId,
    locale: _locale,
    createdBy: _createdBy,
    createdAt: _createdAt,
    updatedBy: _updatedBy,
    updatedAt: _updatedAt,
    ...contract
  } = offer;
  return federationOfferContractSchema.parse(contract);
}

export function contentFederationOfferDigest(input: {
  sourceScope: ContentScope;
  offer: Omit<FederationOfferContract, 'digest'>;
}): string {
  return logicalChecksum({
    protocol: GRIDSTORY_CONTENT_FEDERATION_PROTOCOL,
    sourceScope: input.sourceScope,
    offer: input.offer,
  });
}

export function contentFederationRecordChecksum(
  record: Omit<FederatedContentRecord, 'checksum'>,
): string {
  return logicalChecksum(record);
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw new GridStoryError(
      'Content federation response is invalid.',
      'content_federation_source_invalid',
      502,
    );
  }
}

function assertUniqueTypes(types: FederationTypeDescriptor[]): void {
  const identities = types.map(
    (type) => `${type.namespace}\u0000${type.contentType}\u0000${type.version}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new GridStoryError(
      'Federation offer contains duplicate type identities.',
      'content_federation_offer_invalid',
      409,
    );
  }
}

function assertTimestampEnvelope(payload: FederationEnvelopePayload, now: Date): void {
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  const maximumLifetime = resourceLimits.contentFederation.envelopeLifetimeSeconds * 1_000;
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now.getTime() + resourceLimits.contentFederation.maximumFutureSkewMs ||
    expiresAt <= now.getTime() ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maximumLifetime
  ) {
    throw new GridStoryError(
      'Content federation evidence is expired or future-dated.',
      'content_federation_evidence_invalid',
      502,
    );
  }
}

function signatureKey(key: FederationPublicKey) {
  try {
    const parsed = createPublicKey(key.publicKey);
    if (parsed.asymmetricKeyType !== 'ed25519') throw new Error('Unexpected key type.');
    return parsed;
  } catch {
    throw new GridStoryError(
      'Content federation trust key is invalid.',
      'content_federation_key_invalid',
      409,
    );
  }
}

function compareAttribution(
  agreement: FederationAgreement,
  record: FederatedContentRecord,
): boolean {
  const canonicalUrl = new URL(record.attribution.canonicalUrl);
  const canonicalBase = new URL(agreement.canonicalBaseUrl);
  const basePath = canonicalBase.pathname.endsWith('/')
    ? canonicalBase.pathname
    : `${canonicalBase.pathname}/`;
  return (
    record.attribution.sourceInstance === agreement.sourceInstance &&
    record.attribution.sourceEntryId === record.sourceEntryId &&
    record.attribution.sourceRevisionId === record.sourceRevisionId &&
    record.attribution.sourceRevisionSequence === record.sourceRevisionSequence &&
    record.attribution.offerId === agreement.offerId &&
    record.attribution.offerVersion === agreement.offerVersion &&
    record.attribution.offerDigest === agreement.offerDigest &&
    record.attribution.typeFingerprint === record.typeFingerprint &&
    record.attribution.licenseUrl === agreement.attribution.licenseUrl &&
    record.attribution.creditText === agreement.attribution.creditText &&
    canonicalJson(record.attribution.attributedTo) ===
      canonicalJson(agreement.attribution.attributedTo) &&
    canonicalUrl.origin === canonicalBase.origin &&
    canonicalUrl.pathname.startsWith(basePath)
  );
}

function federationFailure(message: string): GridStoryError {
  return new GridStoryError(message, 'content_federation_source_invalid', 502);
}

export class ContentFederationService {
  readonly #repository: ContentFederationRepository;
  readonly #contentRepository: ContentRepository;
  readonly #contentService: ContentService;
  readonly #signer: ContentFederationSigner | undefined;
  readonly #sources: ReadonlyMap<string, ContentFederationSourceAdapter>;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: ContentFederationServiceOptions) {
    this.#repository = options.repository;
    this.#contentRepository = options.contentRepository;
    this.#contentService = options.contentService;
    this.#signer = options.signer;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
    const sources = options.sources ?? [];
    this.#sources = new Map(sources.map((source) => [source.name, source]));
    if (this.#sources.size !== sources.length) {
      throw new Error('Content federation source adapter names must be unique.');
    }
    if (this.#signer) federationPublicKeySchema.parse(this.#signer.publicKey);
  }

  async #document(scope: ContentScope): Promise<ContentFederationDocument> {
    assertValidContentScope(scope);
    return (
      (await this.#repository.get(scope)) ??
      emptyContentFederationDocument(scope, this.#now().toISOString())
    );
  }

  async snapshot(scope: ContentScope): Promise<ContentFederationDocument> {
    return structuredClone(await this.#document(scope));
  }

  async #replace<T>(input: {
    scope: ContentScope;
    expectedVersion: number;
    actorId: string;
    update(document: ContentFederationDocument): T;
  }): Promise<T> {
    const current = await this.#document(input.scope);
    if (current.version !== input.expectedVersion) {
      throw new GridStoryError(
        'Content federation state changed before this operation.',
        'content_federation_write_conflict',
        409,
      );
    }
    const next = structuredClone(current);
    const result = input.update(next);
    next.version += 1;
    next.updatedBy = input.actorId;
    next.updatedAt = this.#now().toISOString();
    await this.#repository.save(next, current.version === 0 ? null : current.version);
    return structuredClone(result);
  }

  #schemaDescriptor(
    offerId: string,
    contentType: string,
    version: number,
  ): FederationTypeDescriptor {
    const configured = this.#contentService
      .getSchemas()
      .find((candidate) => candidate.id === contentType && candidate.version === version);
    if (!configured) {
      throw new NotFoundError(`Content schema ${contentType} version ${version} is not deployed.`);
    }
    const schema = contentSchemaDefinitionSchema.parse(configured);
    return federationTypeDescriptorSchema.parse({
      namespace: `${offerId}:${contentType}`,
      contentType,
      version,
      fingerprint: logicalChecksum(schema),
      schema,
    });
  }

  async upsertOffer(
    scope: ContentScope,
    actorId: string,
    input: FederationOfferInput,
  ): Promise<FederationOffer> {
    const parsed = federationOfferInputSchema.parse(input);
    const signer = this.#signer;
    if (!signer) {
      throw new GridStoryError(
        'Content federation signing is not configured.',
        'content_federation_signer_unavailable',
        503,
      );
    }
    const types = parsed.contentTypes.map((type) =>
      this.#schemaDescriptor(parsed.id, type.id, type.version),
    );
    assertUniqueTypes(types);
    return await this.#replace({
      scope,
      expectedVersion: parsed.expectedVersion,
      actorId,
      update: (document) => {
        const existing = document.offers.find((offer) => offer.id === parsed.id);
        const timestamp = this.#now().toISOString();
        const version = (existing?.version ?? 0) + 1;
        const contractWithoutDigest = {
          id: parsed.id,
          version,
          state: parsed.state,
          sourceInstance: parsed.sourceInstance,
          canonicalBaseUrl: parsed.canonicalBaseUrl,
          publicKey: signer.publicKey,
          types,
          attribution: parsed.attribution,
        };
        const offer: FederationOffer = {
          ...scope,
          ...contractWithoutDigest,
          digest: contentFederationOfferDigest({
            sourceScope: scope,
            offer: contractWithoutDigest,
          }),
          createdBy: existing?.createdBy ?? actorId,
          createdAt: existing?.createdAt ?? timestamp,
          updatedBy: actorId,
          updatedAt: timestamp,
        };
        document.offers = [
          ...document.offers.filter((candidate) => candidate.id !== offer.id),
          offer,
        ].sort((left, right) => left.id.localeCompare(right.id));
        return offer;
      },
    });
  }

  #activeOffer(document: ContentFederationDocument, offerId: string): FederationOffer {
    const offer = document.offers.find((candidate) => candidate.id === offerId);
    if (!offer) throw new NotFoundError('Content federation offer was not found.');
    if (offer.state !== 'enabled') invalidState('Content federation offer is disabled.');
    if (!this.#signer || !samePublicKey(offer.publicKey, this.#signer.publicKey)) {
      throw new GridStoryError(
        'Content federation offer signing key is unavailable.',
        'content_federation_signer_unavailable',
        503,
      );
    }
    return offer;
  }

  async #signed(payload: FederationEnvelopePayload): Promise<SignedFederationEnvelope> {
    const signer = this.#signer;
    if (!signer) {
      throw new GridStoryError(
        'Content federation signing is not configured.',
        'content_federation_signer_unavailable',
        503,
      );
    }
    let value: string;
    try {
      value = await signer.sign(canonicalJson(payload));
    } catch {
      throw new GridStoryError(
        'Content federation response could not be signed.',
        'content_federation_signing_failed',
        503,
      );
    }
    return signedFederationEnvelopeSchema.parse({
      payload,
      signature: { keyId: signer.publicKey.keyId, algorithm: 'ed25519', value },
    });
  }

  #envelopeBase(scope: ContentScope, offer: FederationOffer, requestId: string) {
    const issuedAt = this.#now();
    return {
      protocol: GRIDSTORY_CONTENT_FEDERATION_PROTOCOL,
      sourceScope: scope,
      sourceInstance: offer.sourceInstance,
      requestId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(
        issuedAt.getTime() + resourceLimits.contentFederation.envelopeLifetimeSeconds * 1_000,
      ).toISOString(),
    } as const;
  }

  async offerEnvelope(
    scope: ContentScope,
    offerId: string,
    requestId: string,
  ): Promise<SignedFederationEnvelope> {
    const document = await this.#document(scope);
    const offer = this.#activeOffer(document, offerId);
    return await this.#signed({
      ...this.#envelopeBase(scope, offer, requestId),
      kind: 'offer',
      offer: offerContract(offer),
    });
  }

  async #record(
    scope: ContentScope,
    offer: FederationOffer,
    type: FederationTypeDescriptor,
    sourceEntryId: string,
  ): Promise<FederatedContentRecord | null> {
    const entry = await this.#contentRepository.getById({
      scope,
      id: sourceEntryId,
      perspective: 'published',
    });
    if (!entry || entry.contentType !== type.contentType || !entry.publishedRevisionId) return null;
    const revision = await this.#contentRepository.getRevision({
      scope,
      id: entry.id,
      revisionId: entry.publishedRevisionId,
    });
    if (!revision) throw federationFailure('Published federation revision is unavailable.');
    assertValidContent(type.schema, entry.data, []);
    const baseUrl = offer.canonicalBaseUrl.endsWith('/')
      ? offer.canonicalBaseUrl
      : `${offer.canonicalBaseUrl}/`;
    const attribution = {
      ...offer.attribution,
      canonicalUrl: new URL(
        `${encodeURIComponent(type.contentType)}/${encodeURIComponent(entry.id)}`,
        baseUrl,
      ).toString(),
      sourceInstance: offer.sourceInstance,
      sourceEntryId: entry.id,
      sourceRevisionId: revision.id,
      sourceRevisionSequence: revision.sequence,
      offerId: offer.id,
      offerVersion: offer.version,
      offerDigest: offer.digest,
      typeFingerprint: type.fingerprint,
    };
    const recordWithoutChecksum = {
      namespace: type.namespace,
      contentType: type.contentType,
      typeVersion: type.version,
      typeFingerprint: type.fingerprint,
      sourceEntryId: entry.id,
      sourceRevisionId: revision.id,
      sourceRevisionSequence: revision.sequence,
      publishedAt: revision.createdAt,
      data: entry.data,
      attribution,
    };
    return federatedContentRecordSchema.parse({
      ...recordWithoutChecksum,
      checksum: contentFederationRecordChecksum(recordWithoutChecksum),
    });
  }

  async recordEnvelope(input: {
    scope: ContentScope;
    offerId: string;
    namespace: string;
    sourceEntryId: string;
    requestId: string;
  }): Promise<SignedFederationEnvelope> {
    const document = await this.#document(input.scope);
    const offer = this.#activeOffer(document, input.offerId);
    const type = offer.types.find((candidate) => candidate.namespace === input.namespace);
    if (!type) throw new NotFoundError('Federated content type was not found in this offer.');
    const record = await this.#record(input.scope, offer, type, input.sourceEntryId);
    return await this.#signed({
      ...this.#envelopeBase(input.scope, offer, input.requestId),
      kind: 'record',
      offerId: offer.id,
      offerVersion: offer.version,
      offerDigest: offer.digest,
      record,
    });
  }

  async snapshotEnvelope(input: {
    scope: ContentScope;
    offerId: string;
    requestId: string;
    maximumRecords: number;
  }): Promise<SignedFederationEnvelope> {
    const document = await this.#document(input.scope);
    const offer = this.#activeOffer(document, input.offerId);
    const maximumRecords = Math.min(
      Math.max(1, input.maximumRecords),
      resourceLimits.contentFederation.maximumRecordsPerSnapshot,
    );
    const records: FederatedContentRecord[] = [];
    for (const type of offer.types) {
      const entries = await this.#contentRepository.list({
        scope: input.scope,
        contentType: type.contentType,
        perspective: 'published',
      });
      for (const entry of entries) {
        const record = await this.#record(input.scope, offer, type, entry.id);
        if (record) records.push(record);
        if (records.length > maximumRecords) {
          throw new GridStoryError(
            'Content federation snapshot exceeds the requested record limit.',
            'content_federation_snapshot_too_large',
            409,
          );
        }
      }
    }
    records.sort((left, right) =>
      `${left.namespace}\u0000${left.sourceEntryId}`.localeCompare(
        `${right.namespace}\u0000${right.sourceEntryId}`,
      ),
    );
    return await this.#signed({
      ...this.#envelopeBase(input.scope, offer, input.requestId),
      kind: 'snapshot',
      offerId: offer.id,
      offerVersion: offer.version,
      offerDigest: offer.digest,
      complete: true,
      checkpoint: logicalChecksum(records.map((record) => record.checksum)),
      records,
    });
  }

  #verifyEnvelope(input: {
    raw: unknown;
    key: FederationPublicKey;
    sourceScope: ContentScope;
    sourceInstance: string;
    requestId: string;
    kind: FederationEnvelopePayload['kind'];
  }): SignedFederationEnvelope {
    if (serializedBytes(input.raw) > resourceLimits.contentFederation.maximumEnvelopeBytes) {
      throw federationFailure('Content federation response exceeds the configured byte limit.');
    }
    const parsed = signedFederationEnvelopeSchema.safeParse(input.raw);
    if (!parsed.success) throw federationFailure('Content federation response is malformed.');
    const envelope = parsed.data;
    if (
      envelope.payload.kind !== input.kind ||
      envelope.payload.requestId !== input.requestId ||
      envelope.payload.sourceInstance !== input.sourceInstance ||
      !sameContentScope(envelope.payload.sourceScope, input.sourceScope) ||
      envelope.signature.keyId !== input.key.keyId ||
      envelope.signature.algorithm !== input.key.algorithm
    ) {
      throw federationFailure('Content federation evidence does not match the request.');
    }
    assertTimestampEnvelope(envelope.payload, this.#now());
    const signature = Buffer.from(envelope.signature.value, 'base64');
    if (
      signature.byteLength !== 64 ||
      !verify(
        null,
        Buffer.from(canonicalJson(envelope.payload), 'utf8'),
        signatureKey(input.key),
        signature,
      )
    ) {
      throw federationFailure('Content federation signature is invalid.');
    }
    return envelope;
  }

  async #sourceCall<T>(call: () => Awaitable<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof GridStoryError && error.code.startsWith('content_federation_')) {
        throw error;
      }
      throw new GridStoryError(
        'Content federation source is unavailable.',
        'content_federation_source_unavailable',
        502,
      );
    }
  }

  async inspectAgreement(
    scope: ContentScope,
    agreementId: string,
    actorId: string,
    input: FederationAgreementInspectionInput,
  ): Promise<FederationAgreement> {
    const parsed = federationAgreementInspectionInputSchema.parse(input);
    const current = await this.#document(scope);
    if (current.version !== parsed.expectedVersion) {
      throw new GridStoryError(
        'Content federation state changed before inspection.',
        'content_federation_write_conflict',
        409,
      );
    }
    const source = this.#sources.get(parsed.adapter);
    if (!source) {
      throw new GridStoryError(
        'Configured content federation source is unavailable.',
        'content_federation_source_unavailable',
        503,
      );
    }
    const requestId = this.#createId();
    const raw = await this.#sourceCall(() =>
      source.readOffer({
        sourceScope: parsed.sourceScope,
        offerId: parsed.offerId,
        requestId,
      }),
    );
    const envelope = this.#verifyEnvelope({
      raw,
      key: parsed.trustedKey,
      sourceScope: parsed.sourceScope,
      sourceInstance: parsed.sourceInstance,
      requestId,
      kind: 'offer',
    });
    if (envelope.payload.kind !== 'offer') throw federationFailure('Offer evidence is invalid.');
    const offer = envelope.payload.offer;
    const { digest: _digest, ...offerWithoutDigest } = offer;
    if (
      offer.id !== parsed.offerId ||
      offer.state !== 'enabled' ||
      offer.sourceInstance !== parsed.sourceInstance ||
      offer.canonicalBaseUrl !== parsed.canonicalBaseUrl ||
      !samePublicKey(offer.publicKey, parsed.trustedKey) ||
      offer.digest !==
        contentFederationOfferDigest({
          sourceScope: parsed.sourceScope,
          offer: offerWithoutDigest,
        })
    ) {
      throw federationFailure('Federation offer does not match the pinned trust contract.');
    }
    assertUniqueTypes(offer.types);
    for (const type of offer.types) {
      if (logicalChecksum(type.schema) !== type.fingerprint) {
        throw federationFailure('Federation type fingerprint is invalid.');
      }
    }
    return await this.#replace({
      scope,
      expectedVersion: parsed.expectedVersion,
      actorId,
      update: (document) => {
        const existing = document.agreements.find((item) => item.id === agreementId);
        const timestamp = this.#now().toISOString();
        const agreement: FederationAgreement = {
          ...scope,
          id: agreementId,
          version: (existing?.version ?? 0) + 1,
          state: 'disabled',
          adapter: parsed.adapter,
          mode: parsed.mode,
          sourceScope: parsed.sourceScope,
          sourceInstance: parsed.sourceInstance,
          canonicalBaseUrl: offer.canonicalBaseUrl,
          offerId: offer.id,
          offerVersion: offer.version,
          offerDigest: offer.digest,
          trustedKey: parsed.trustedKey,
          types: offer.types,
          attribution: offer.attribution,
          createdBy: existing?.createdBy ?? actorId,
          createdAt: existing?.createdAt ?? timestamp,
          updatedBy: actorId,
          updatedAt: timestamp,
        };
        document.agreements = [
          ...document.agreements.filter((candidate) => candidate.id !== agreement.id),
          agreement,
        ].sort((left, right) => left.id.localeCompare(right.id));
        return agreement;
      },
    });
  }

  async setAgreementState(
    scope: ContentScope,
    agreementId: string,
    actorId: string,
    input: FederationAgreementStateInput,
  ): Promise<FederationAgreement> {
    const parsed = federationAgreementStateInputSchema.parse(input);
    return await this.#replace({
      scope,
      expectedVersion: parsed.expectedVersion,
      actorId,
      update: (document) => {
        const agreement = document.agreements.find((candidate) => candidate.id === agreementId);
        if (!agreement) throw new NotFoundError('Content federation agreement was not found.');
        if (parsed.state === 'active' && !this.#sources.has(agreement.adapter)) {
          throw new GridStoryError(
            'Configured content federation source is unavailable.',
            'content_federation_source_unavailable',
            503,
          );
        }
        agreement.state = parsed.state;
        agreement.version += 1;
        agreement.updatedBy = actorId;
        agreement.updatedAt = this.#now().toISOString();
        return agreement;
      },
    });
  }

  #activeAgreement(
    document: ContentFederationDocument,
    agreementId: string,
    mode?: 'live' | 'mirror',
  ): FederationAgreement {
    const agreement = document.agreements.find((candidate) => candidate.id === agreementId);
    if (!agreement) throw new NotFoundError('Content federation agreement was not found.');
    if (agreement.state !== 'active') invalidState('Content federation agreement is disabled.');
    if (mode && agreement.mode !== mode) {
      invalidState(`Content federation agreement is not configured for ${mode} mode.`);
    }
    return agreement;
  }

  #validateRecord(
    agreement: FederationAgreement,
    record: FederatedContentRecord,
  ): FederatedContentRecord {
    const parsed = federatedContentRecordSchema.parse(record);
    const { checksum, ...recordWithoutChecksum } = parsed;
    const type = agreement.types.find((candidate) => candidate.namespace === parsed.namespace);
    if (
      !type ||
      parsed.contentType !== type.contentType ||
      parsed.typeVersion !== type.version ||
      parsed.typeFingerprint !== type.fingerprint ||
      logicalChecksum(type.schema) !== type.fingerprint ||
      checksum !== contentFederationRecordChecksum(recordWithoutChecksum) ||
      !compareAttribution(agreement, parsed)
    ) {
      throw federationFailure('Federated content record does not match its agreement.');
    }
    try {
      assertValidContent(type.schema, parsed.data, []);
    } catch {
      throw federationFailure('Federated content record does not satisfy its pinned schema.');
    }
    return parsed;
  }

  #validateAgreementEnvelope(
    agreement: FederationAgreement,
    raw: unknown,
    requestId: string,
    kind: 'record' | 'snapshot',
  ): SignedFederationEnvelope {
    const envelope = this.#verifyEnvelope({
      raw,
      key: agreement.trustedKey,
      sourceScope: agreement.sourceScope,
      sourceInstance: agreement.sourceInstance,
      requestId,
      kind,
    });
    if (
      (envelope.payload.kind !== 'record' && envelope.payload.kind !== 'snapshot') ||
      envelope.payload.offerId !== agreement.offerId ||
      envelope.payload.offerVersion !== agreement.offerVersion ||
      envelope.payload.offerDigest !== agreement.offerDigest
    ) {
      throw federationFailure('Content federation envelope does not match the active agreement.');
    }
    return envelope;
  }

  async publicRecord(input: {
    scope: ContentScope;
    agreementId: string;
    namespace: string;
    sourceEntryId: string;
  }): Promise<FederatedContentRecord | null> {
    const document = await this.#document(input.scope);
    const agreement = this.#activeAgreement(document, input.agreementId);
    if (!agreement.types.some((type) => type.namespace === input.namespace)) {
      throw new NotFoundError('Federated content type was not found.');
    }
    if (agreement.mode === 'mirror') {
      const mirror = document.mirrors.find(
        (candidate) =>
          candidate.agreementId === agreement.id &&
          candidate.namespace === input.namespace &&
          candidate.sourceEntryId === input.sourceEntryId,
      );
      if (mirror?.state !== 'active') return null;
      const {
        agreementId: _agreementId,
        state: _state,
        receivedAt: _receivedAt,
        withdrawnAt: _withdrawnAt,
        ...record
      } = mirror;
      return this.#validateRecord(agreement, record);
    }
    const source = this.#sources.get(agreement.adapter);
    if (!source) {
      throw new GridStoryError(
        'Content federation source is unavailable.',
        'content_federation_source_unavailable',
        502,
      );
    }
    const requestId = this.#createId();
    const raw = await this.#sourceCall(() =>
      source.readRecord({
        sourceScope: agreement.sourceScope,
        offerId: agreement.offerId,
        namespace: input.namespace,
        sourceEntryId: input.sourceEntryId,
        requestId,
      }),
    );
    const envelope = this.#validateAgreementEnvelope(agreement, raw, requestId, 'record');
    if (envelope.payload.kind !== 'record') throw federationFailure('Record evidence is invalid.');
    if (!envelope.payload.record) return null;
    if (
      envelope.payload.record.namespace !== input.namespace ||
      envelope.payload.record.sourceEntryId !== input.sourceEntryId
    ) {
      throw federationFailure('Federated content record does not match the requested identity.');
    }
    return this.#validateRecord(agreement, envelope.payload.record);
  }

  #syncEffects(
    agreement: FederationAgreement,
    document: ContentFederationDocument,
    snapshot: FederationSnapshotEnvelopePayload,
  ): FederationSyncEffect[] {
    const seen = new Set<string>();
    const effects: FederationSyncEffect[] = [];
    for (const rawRecord of snapshot.records) {
      const record = this.#validateRecord(agreement, rawRecord);
      const key = `${record.namespace}\u0000${record.sourceEntryId}`;
      if (seen.has(key)) throw federationFailure('Federation snapshot contains duplicate records.');
      seen.add(key);
      const current = document.mirrors.find(
        (candidate) =>
          candidate.agreementId === agreement.id &&
          candidate.namespace === record.namespace &&
          candidate.sourceEntryId === record.sourceEntryId,
      );
      let action: FederationSyncEffect['action'];
      let message: string | undefined;
      if (
        current &&
        (record.sourceRevisionSequence < current.sourceRevisionSequence ||
          (record.sourceRevisionSequence === current.sourceRevisionSequence &&
            record.checksum !== current.checksum))
      ) {
        action = 'blocked';
        message = 'Source revision sequence regressed or changed without advancing.';
      } else if (!current) action = 'create';
      else if (current.state !== 'active' || current.checksum !== record.checksum)
        action = 'update';
      else action = 'noop';
      effects.push({
        namespace: record.namespace,
        sourceEntryId: record.sourceEntryId,
        action,
        sourceRevisionId: record.sourceRevisionId,
        sourceRevisionSequence: record.sourceRevisionSequence,
        checksum: record.checksum,
        record,
        ...(message ? { message } : {}),
      });
    }
    for (const current of document.mirrors.filter(
      (candidate) => candidate.agreementId === agreement.id && candidate.state === 'active',
    )) {
      const key = `${current.namespace}\u0000${current.sourceEntryId}`;
      if (!seen.has(key)) {
        effects.push({
          namespace: current.namespace,
          sourceEntryId: current.sourceEntryId,
          action: 'withdraw',
          sourceRevisionId: current.sourceRevisionId,
          sourceRevisionSequence: current.sourceRevisionSequence,
          checksum: current.checksum,
          message: 'Source record is absent from the complete signed snapshot.',
        });
      }
    }
    return effects.sort((left, right) =>
      `${left.namespace}\u0000${left.sourceEntryId}`.localeCompare(
        `${right.namespace}\u0000${right.sourceEntryId}`,
      ),
    );
  }

  async #readSnapshot(
    agreement: FederationAgreement,
  ): Promise<{ requestId: string; payload: FederationSnapshotEnvelopePayload }> {
    const source = this.#sources.get(agreement.adapter);
    if (!source) {
      throw new GridStoryError(
        'Content federation source is unavailable.',
        'content_federation_source_unavailable',
        502,
      );
    }
    const requestId = this.#createId();
    const raw = await this.#sourceCall(() =>
      source.readSnapshot({
        sourceScope: agreement.sourceScope,
        offerId: agreement.offerId,
        requestId,
        maximumRecords: resourceLimits.contentFederation.maximumRecordsPerSnapshot,
      }),
    );
    const envelope = this.#validateAgreementEnvelope(agreement, raw, requestId, 'snapshot');
    if (envelope.payload.kind !== 'snapshot') {
      throw federationFailure('Snapshot evidence is invalid.');
    }
    const payload = federationSnapshotEnvelopePayloadSchema.parse(envelope.payload);
    if (payload.checkpoint !== logicalChecksum(payload.records.map((record) => record.checksum))) {
      throw federationFailure('Federation snapshot checkpoint is invalid.');
    }
    return { requestId, payload };
  }

  async planSync(
    scope: ContentScope,
    agreementId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<FederationSyncPlan> {
    const current = await this.#document(scope);
    if (current.version !== expectedVersion) {
      throw new GridStoryError(
        'Content federation state changed before synchronization planning.',
        'content_federation_write_conflict',
        409,
      );
    }
    const agreement = this.#activeAgreement(current, agreementId, 'mirror');
    const snapshot = await this.#readSnapshot(agreement);
    const effects = this.#syncEffects(agreement, current, snapshot.payload);
    const now = this.#now();
    const planBase = {
      agreementId,
      agreementVersion: agreement.version,
      requestId: snapshot.requestId,
      offerVersion: agreement.offerVersion,
      offerDigest: agreement.offerDigest,
      sourceCheckpoint: snapshot.payload.checkpoint,
      effects,
    };
    const plan: FederationSyncPlan = {
      ...scope,
      id: this.#createId(),
      ...planBase,
      state: 'preview',
      digest: logicalChecksum(planBase),
      createdBy: actorId,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + resourceLimits.contentFederation.planLifetimeSeconds * 1_000,
      ).toISOString(),
    };
    return await this.#replace({
      scope,
      expectedVersion,
      actorId,
      update: (document) => {
        const latest = document.agreements.find((candidate) => candidate.id === agreement.id);
        if (!latest || latest.version !== agreement.version || latest.state !== 'active') {
          throw new ConflictError('Content federation agreement changed during planning.');
        }
        document.plans = [...document.plans, plan].slice(
          -resourceLimits.contentFederation.maximumPlans,
        );
        return plan;
      },
    });
  }

  async #markPlanFailed(
    scope: ContentScope,
    planId: string,
    actorId: string,
    message: string,
  ): Promise<void> {
    try {
      const current = await this.#document(scope);
      const plan = current.plans.find((candidate) => candidate.id === planId);
      if (!plan || plan.state === 'completed') return;
      await this.#replace({
        scope,
        expectedVersion: current.version,
        actorId,
        update: (document) => {
          const stored = document.plans.find((candidate) => candidate.id === planId);
          if (stored && stored.state !== 'completed') {
            stored.state = 'failed';
            stored.error = message.slice(0, 1_000);
            stored.completedAt = this.#now().toISOString();
          }
        },
      });
    } catch {
      // The persisted executing state and exact plan digest remain safely retryable.
    }
  }

  async executeSync(
    scope: ContentScope,
    planId: string,
    actorId: string,
    input: FederationSyncPlanExecutionInput,
  ): Promise<FederationSyncReceipt> {
    const parsed = federationSyncPlanExecutionInputSchema.parse(input);
    let current = await this.#document(scope);
    let plan = current.plans.find((candidate) => candidate.id === planId);
    if (!plan) throw new NotFoundError('Content federation synchronization plan was not found.');
    if (plan.digest !== parsed.digest) invalidState('Synchronization plan digest does not match.');
    if (plan.state === 'completed') {
      const receipt = current.receipts.find((candidate) => candidate.planId === planId);
      if (!receipt) invalidState('Completed synchronization plan has no receipt.');
      return structuredClone(receipt);
    }
    if (current.version !== parsed.expectedVersion) {
      throw new GridStoryError(
        'Content federation state changed before synchronization execution.',
        'content_federation_write_conflict',
        409,
      );
    }
    if (plan.state !== 'preview' && plan.state !== 'executing') {
      invalidState('Synchronization plan is not executable.');
    }
    if (Date.parse(plan.expiresAt) <= this.#now().getTime()) {
      invalidState('Synchronization plan expired and must be recreated.');
    }
    if (plan.effects.some((effect) => effect.action === 'blocked')) {
      invalidState('Synchronization plan contains blocked effects.');
    }
    const agreement = this.#activeAgreement(current, plan.agreementId, 'mirror');
    if (
      agreement.version !== plan.agreementVersion ||
      agreement.offerVersion !== plan.offerVersion ||
      agreement.offerDigest !== plan.offerDigest
    ) {
      invalidState('Content federation agreement changed after planning.');
    }
    if (plan.state === 'preview') {
      await this.#replace({
        scope,
        expectedVersion: current.version,
        actorId,
        update: (document) => {
          const stored = document.plans.find((candidate) => candidate.id === planId);
          if (stored?.state !== 'preview' || stored.digest !== parsed.digest) {
            throw new ConflictError('Synchronization plan changed before execution.');
          }
          stored.state = 'executing';
          stored.startedAt = this.#now().toISOString();
        },
      });
      current = await this.#document(scope);
      plan = current.plans.find((candidate) => candidate.id === planId) as FederationSyncPlan;
    }
    try {
      const fresh = await this.#readSnapshot(agreement);
      const effects = this.#syncEffects(agreement, current, fresh.payload);
      if (
        fresh.payload.checkpoint !== plan.sourceCheckpoint ||
        logicalChecksum({
          agreementId: plan.agreementId,
          agreementVersion: plan.agreementVersion,
          requestId: plan.requestId,
          offerVersion: plan.offerVersion,
          offerDigest: plan.offerDigest,
          sourceCheckpoint: fresh.payload.checkpoint,
          effects,
        }) !== plan.digest
      ) {
        throw new ConflictError('Federation source changed after the reviewed preview.');
      }
      const completedAt = this.#now().toISOString();
      const receipt: FederationSyncReceipt = {
        id: this.#createId(),
        planId,
        agreementId: agreement.id,
        digest: plan.digest,
        checkpoint: plan.sourceCheckpoint,
        created: effects.filter((effect) => effect.action === 'create').length,
        updated: effects.filter((effect) => effect.action === 'update').length,
        unchanged: effects.filter((effect) => effect.action === 'noop').length,
        withdrawn: effects.filter((effect) => effect.action === 'withdraw').length,
        actorId,
        completedAt,
      };
      const latest = await this.#document(scope);
      return await this.#replace({
        scope,
        expectedVersion: latest.version,
        actorId,
        update: (document) => {
          const storedPlan = document.plans.find((candidate) => candidate.id === planId);
          const storedAgreement = document.agreements.find(
            (candidate) => candidate.id === agreement.id,
          );
          if (
            storedPlan?.state !== 'executing' ||
            storedPlan.digest !== plan.digest ||
            !storedAgreement ||
            storedAgreement.version !== agreement.version
          ) {
            throw new ConflictError('Content federation state changed during synchronization.');
          }
          for (const effect of effects) {
            const index = document.mirrors.findIndex(
              (candidate) =>
                candidate.agreementId === agreement.id &&
                candidate.namespace === effect.namespace &&
                candidate.sourceEntryId === effect.sourceEntryId,
            );
            if (effect.action === 'withdraw') {
              if (index >= 0) {
                const mirror = document.mirrors[index] as FederationMirrorRecord;
                mirror.state = 'withdrawn';
                mirror.withdrawnAt = completedAt;
              }
              continue;
            }
            if (effect.action === 'noop') continue;
            if (!effect.record || effect.action === 'blocked') {
              throw new Error('Executable federation effect is incomplete.');
            }
            const mirror: FederationMirrorRecord = {
              ...effect.record,
              agreementId: agreement.id,
              state: 'active',
              receivedAt: completedAt,
            };
            if (index >= 0) document.mirrors[index] = mirror;
            else document.mirrors.push(mirror);
          }
          storedPlan.state = 'completed';
          storedPlan.completedAt = completedAt;
          delete storedPlan.error;
          document.receipts = [...document.receipts, receipt].slice(
            -resourceLimits.contentFederation.maximumReceipts,
          );
          return receipt;
        },
      });
    } catch (error) {
      await this.#markPlanFailed(
        scope,
        planId,
        actorId,
        error instanceof Error ? error.message : 'Content federation synchronization failed.',
      );
      throw error;
    }
  }
}
