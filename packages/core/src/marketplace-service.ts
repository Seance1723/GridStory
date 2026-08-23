import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import {
  canonicalStringify,
  type ContentScope,
  GRIDSTORY_PLUGIN_SDK_VERSION,
  type MarketplaceArtifactInspection,
  type MarketplaceDomainChallenge,
  type MarketplaceOverview,
  type MarketplacePublisher,
  type MarketplacePublisherInput,
  type MarketplacePublisherSummary,
  type MarketplaceRelease,
  type MarketplaceReleaseSubmission,
  type MarketplaceReleaseSummary,
  type MarketplaceReviewCheck,
  type MarketplaceReviewRun,
  marketplaceArtifactInspectionSchema,
  marketplacePublisherInputSchema,
  marketplacePublisherSchema,
  marketplaceReleaseSchema,
  marketplaceReleaseSubmissionSchema,
  pluginManifestSigningPayload,
  resourceLimits,
  type SignedPluginManifest,
} from '@gridstory/schema';
import { ConflictError, GridStoryError, NotFoundError } from './errors.js';
import {
  emptyMarketplaceDocument,
  type MarketplaceDocument,
  type MarketplaceRepository,
} from './marketplace-repository.js';
import type { TrustedPluginPublisher } from './plugin-service.js';
import type { Awaitable } from './types.js';

export interface MarketplaceDomainVerifier {
  hasTxtRecord(input: { recordName: string; token: string }): Awaitable<boolean>;
}

export interface MarketplaceArtifactInspector {
  readonly descriptor: { id: string; version: string };
  inspect(input: {
    scope: ContentScope;
    publisherId: string;
    pluginId: string;
    version: string;
    artifactReference: string;
    expectedSha256: string;
    expectedSizeBytes: number;
  }): Awaitable<MarketplaceArtifactInspection>;
}

interface MarketplaceServiceOptions {
  repository: MarketplaceRepository;
  domainVerifier?: MarketplaceDomainVerifier;
  artifactInspector?: MarketplaceArtifactInspector;
  hostVersion?: string;
  sdkVersion?: string;
  now?: () => string;
  createId?: () => string;
  createToken?: () => string;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function semverTuple(value: string): [number, number, number] {
  const [major, minor, patch] = value.split('-', 1)[0]?.split('.').map(Number) ?? [];
  if (![major, minor, patch].every(Number.isInteger)) {
    throw new GridStoryError('Marketplace version is invalid.', 'marketplace_version_invalid', 500);
  }
  return [major as number, minor as number, patch as number];
}

function compareSemver(left: string, right: string): number {
  const a = semverTuple(left);
  const b = semverTuple(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function publisherSummary(publisher: MarketplacePublisher): MarketplacePublisherSummary {
  const { challenge: _challenge, key, ...summary } = publisher;
  const { publicKey: _publicKey, ...publicKey } = key;
  return { ...summary, key: publicKey };
}

function releaseSummary(release: MarketplaceRelease): MarketplaceReleaseSummary {
  const { artifactReference: _artifactReference, ...summary } = release;
  return summary;
}

function reviewCheck(
  id: string,
  category: MarketplaceReviewCheck['category'],
  status: MarketplaceReviewCheck['status'],
  summary: string,
): MarketplaceReviewCheck {
  return { id, category, status, summary };
}

function verifiedKey(manifest: SignedPluginManifest, publisher: MarketplacePublisher): boolean {
  if (
    publisher.state !== 'verified' ||
    manifest.publisher.id !== publisher.id ||
    manifest.publisher.name !== publisher.displayName ||
    manifest.signature.keyId !== publisher.key.keyId
  ) {
    return false;
  }
  try {
    return verify(
      null,
      Buffer.from(pluginManifestSigningPayload(manifest), 'utf8'),
      createPublicKey(publisher.key.publicKey),
      Buffer.from(manifest.signature.value, 'base64'),
    );
  } catch {
    return false;
  }
}

export class MarketplaceService {
  readonly #repository: MarketplaceRepository;
  readonly #domainVerifier: MarketplaceDomainVerifier | undefined;
  readonly #artifactInspector: MarketplaceArtifactInspector | undefined;
  readonly #hostVersion: string;
  readonly #sdkVersion: string;
  readonly #now: () => string;
  readonly #createId: () => string;
  readonly #createToken: () => string;

  constructor(options: MarketplaceServiceOptions) {
    this.#repository = options.repository;
    this.#domainVerifier = options.domainVerifier;
    this.#artifactInspector = options.artifactInspector;
    this.#hostVersion = options.hostVersion ?? '0.0.0';
    this.#sdkVersion = options.sdkVersion ?? GRIDSTORY_PLUGIN_SDK_VERSION;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
    this.#createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'));
  }

  async #document(scope: ContentScope): Promise<MarketplaceDocument> {
    return (await this.#repository.get(scope)) ?? emptyMarketplaceDocument(scope, this.#now());
  }

  async #mutate<T>(
    scope: ContentScope,
    mutate: (document: MarketplaceDocument) => Awaitable<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.#repository.get(scope);
      const document = current
        ? structuredClone(current)
        : emptyMarketplaceDocument(scope, this.#now());
      const expectedVersion = current?.version ?? null;
      const result = await mutate(document);
      document.version += 1;
      document.updatedAt = this.#now();
      try {
        await this.#repository.save(document, expectedVersion);
        return result;
      } catch (error) {
        if (
          error instanceof GridStoryError &&
          error.code === 'marketplace_write_conflict' &&
          attempt < 4
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictError('Marketplace state could not be updated after retries.');
  }

  async overview(scope: ContentScope): Promise<MarketplaceOverview> {
    const document = await this.#document(scope);
    return {
      publishers: document.publishers.map(publisherSummary),
      releases: document.releases.map(releaseSummary),
    };
  }

  async getPublisher(scope: ContentScope, id: string): Promise<MarketplacePublisherSummary> {
    const publisher = (await this.#document(scope)).publishers.find(
      (candidate) => candidate.id === id,
    );
    if (!publisher) throw new NotFoundError('Marketplace publisher was not found.');
    return publisherSummary(publisher);
  }

  async registerPublisher(
    scope: ContentScope,
    actorId: string,
    input: MarketplacePublisherInput,
  ): Promise<MarketplacePublisherSummary> {
    const candidate = marketplacePublisherInputSchema.parse(input);
    const key = (() => {
      try {
        return createPublicKey(candidate.key.publicKey);
      } catch {
        throw new GridStoryError(
          'Publisher public key is invalid.',
          'marketplace_publisher_key_invalid',
          422,
        );
      }
    })();
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new GridStoryError(
        'Publisher public key must use Ed25519.',
        'marketplace_publisher_key_invalid',
        422,
      );
    }
    const domain = candidate.domain.toLowerCase();
    for (const url of [candidate.websiteUrl, candidate.supportUrl]) {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname !== domain && !hostname.endsWith(`.${domain}`)) {
        throw new GridStoryError(
          'Publisher links must remain on the declared domain.',
          'marketplace_publisher_domain_mismatch',
          422,
        );
      }
    }
    const fingerprint = sha256(key.export({ format: 'der', type: 'spki' }) as Buffer);
    return await this.#mutate(scope, (document) => {
      if (document.publishers.some(({ id }) => id === candidate.id)) {
        throw new GridStoryError(
          'Marketplace publisher already exists in this scope.',
          'marketplace_publisher_exists',
          409,
        );
      }
      const now = this.#now();
      const publisher = marketplacePublisherSchema.parse({
        ...scope,
        ...candidate,
        domain,
        key: { ...candidate.key, fingerprint },
        state: 'pending',
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
      });
      document.publishers.push(publisher);
      return publisherSummary(publisher);
    });
  }

  async issueDomainChallenge(
    scope: ContentScope,
    publisherId: string,
  ): Promise<MarketplaceDomainChallenge> {
    return await this.#mutate(scope, (document) => {
      const publisher = document.publishers.find(({ id }) => id === publisherId);
      if (!publisher) throw new NotFoundError('Marketplace publisher was not found.');
      if (publisher.state !== 'pending') {
        throw new GridStoryError(
          'Only a pending publisher can receive a domain challenge.',
          'marketplace_publisher_state',
          409,
        );
      }
      const issuedAt = this.#now();
      const expiresAt = new Date(
        Date.parse(issuedAt) + resourceLimits.marketplace.publisherChallengeLifetimeSeconds * 1_000,
      ).toISOString();
      const challenge: MarketplaceDomainChallenge = {
        recordName: `_gridstory-verification.${publisher.domain}`,
        token: `gridstory-verification=${this.#createToken()}`,
        issuedAt,
        expiresAt,
      };
      publisher.challenge = challenge;
      delete publisher.domainVerifiedAt;
      publisher.updatedAt = issuedAt;
      return structuredClone(challenge);
    });
  }

  async verifyPublisherDomain(
    scope: ContentScope,
    publisherId: string,
  ): Promise<MarketplacePublisherSummary> {
    const document = await this.#document(scope);
    const publisher = document.publishers.find(({ id }) => id === publisherId);
    if (!publisher) throw new NotFoundError('Marketplace publisher was not found.');
    if (publisher.state !== 'pending' || !publisher.challenge) {
      throw new GridStoryError(
        'Publisher has no pending domain challenge.',
        'marketplace_domain_challenge_missing',
        409,
      );
    }
    if (Date.parse(publisher.challenge.expiresAt) <= Date.parse(this.#now())) {
      throw new GridStoryError(
        'Publisher domain challenge expired.',
        'marketplace_domain_challenge_expired',
        409,
      );
    }
    if (!this.#domainVerifier) {
      throw new GridStoryError(
        'No publisher domain verifier is configured.',
        'marketplace_domain_verifier_unavailable',
        503,
      );
    }
    const verified = await this.#domainVerifier.hasTxtRecord({
      recordName: publisher.challenge.recordName,
      token: publisher.challenge.token,
    });
    if (!verified) {
      throw new GridStoryError(
        'Publisher domain challenge was not found.',
        'marketplace_domain_unverified',
        422,
      );
    }
    return await this.#mutate(scope, (latest) => {
      const current = latest.publishers.find(({ id }) => id === publisherId);
      if (
        !current?.challenge ||
        current.challenge.token !== publisher.challenge?.token ||
        current.state !== 'pending'
      ) {
        throw new ConflictError('Publisher challenge changed during verification.');
      }
      current.domainVerifiedAt = this.#now();
      current.updatedAt = current.domainVerifiedAt;
      return publisherSummary(current);
    });
  }

  async approvePublisher(input: {
    scope: ContentScope;
    publisherId: string;
    actorId: string;
    evidenceReference: string;
    reason: string;
  }): Promise<MarketplacePublisherSummary> {
    return await this.#mutate(input.scope, (document) => {
      const publisher = document.publishers.find(({ id }) => id === input.publisherId);
      if (!publisher) throw new NotFoundError('Marketplace publisher was not found.');
      if (publisher.state !== 'pending' || !publisher.domainVerifiedAt) {
        throw new GridStoryError(
          'Publisher requires current domain verification before approval.',
          'marketplace_publisher_unverified',
          409,
        );
      }
      if (publisher.createdBy === input.actorId) {
        throw new GridStoryError(
          'Publisher approval requires a different reviewer.',
          'marketplace_separation_required',
          403,
        );
      }
      const now = this.#now();
      publisher.state = 'verified';
      publisher.verifiedAt = now;
      publisher.verifiedBy = input.actorId;
      publisher.verificationEvidenceReference = input.evidenceReference;
      publisher.verificationReason = input.reason;
      publisher.updatedAt = now;
      delete publisher.challenge;
      return publisherSummary(publisher);
    });
  }

  async suspendPublisher(input: {
    scope: ContentScope;
    publisherId: string;
    actorId: string;
    reason: string;
  }): Promise<MarketplacePublisherSummary> {
    return await this.#mutate(input.scope, (document) => {
      const publisher = document.publishers.find(({ id }) => id === input.publisherId);
      if (!publisher) throw new NotFoundError('Marketplace publisher was not found.');
      if (publisher.state === 'suspended') {
        throw new GridStoryError(
          'Marketplace publisher is already suspended.',
          'marketplace_publisher_state',
          409,
        );
      }
      const now = this.#now();
      publisher.state = 'suspended';
      publisher.suspendedAt = now;
      publisher.suspendedBy = input.actorId;
      publisher.suspensionReason = input.reason;
      publisher.updatedAt = now;
      delete publisher.challenge;
      return publisherSummary(publisher);
    });
  }

  async trustedPublisher(
    scope: ContentScope,
    publisherId: string,
    keyId: string,
  ): Promise<TrustedPluginPublisher | undefined> {
    const publisher = (await this.#document(scope)).publishers.find(
      (candidate) => candidate.id === publisherId && candidate.key.keyId === keyId,
    );
    if (!publisher) return undefined;
    return {
      publisherId,
      keyId,
      publicKey: publisher.key.publicKey,
      status: publisher.state === 'verified' ? 'active' : 'revoked',
    };
  }

  async submitRelease(input: {
    scope: ContentScope;
    actorId: string;
    submission: MarketplaceReleaseSubmission;
  }): Promise<MarketplaceReleaseSummary> {
    const submission = marketplaceReleaseSubmissionSchema.parse(input.submission);
    return await this.#mutate(input.scope, (document) => {
      const publisher = document.publishers.find(
        ({ id }) => id === submission.manifest.publisher.id,
      );
      if (!publisher || !verifiedKey(submission.manifest, publisher)) {
        throw new GridStoryError(
          'Release requires a verified publisher and valid current signature.',
          'marketplace_release_untrusted',
          403,
        );
      }
      if (
        document.releases.some(
          ({ pluginId, version }) =>
            pluginId === submission.manifest.id && version === submission.manifest.version,
        )
      ) {
        throw new GridStoryError(
          'Marketplace release version already exists and is immutable.',
          'marketplace_release_exists',
          409,
        );
      }
      const now = this.#now();
      const release = marketplaceReleaseSchema.parse({
        ...input.scope,
        id: this.#createId(),
        pluginId: submission.manifest.id,
        publisherId: publisher.id,
        version: submission.manifest.version,
        manifest: submission.manifest,
        artifactReference: submission.artifactReference,
        state: 'submitted',
        submittedAt: now,
        submittedBy: input.actorId,
        updatedAt: now,
        reviews: [],
      });
      document.releases.push(release);
      return releaseSummary(release);
    });
  }

  #compatibilityChecks(release: MarketplaceRelease): MarketplaceReviewCheck[] {
    const checks: MarketplaceReviewCheck[] = [];
    const marketplace = release.manifest.marketplace;
    if (!marketplace) {
      return [
        reviewCheck(
          'metadata.marketplace',
          'compatibility',
          'failed',
          'Signed marketplace metadata is missing.',
        ),
      ];
    }
    const gridstory = marketplace.compatibility.gridstory;
    const hostCompatible =
      compareSemver(this.#hostVersion, gridstory.minVersion) >= 0 &&
      compareSemver(this.#hostVersion, gridstory.maxVersionExclusive) < 0;
    checks.push(
      reviewCheck(
        'compatibility.gridstory',
        'compatibility',
        hostCompatible ? 'passed' : 'failed',
        hostCompatible
          ? `GridStory ${this.#hostVersion} is inside the signed compatibility range.`
          : `GridStory ${this.#hostVersion} is outside the signed compatibility range.`,
      ),
    );
    const sdkCompatible =
      compareSemver(this.#sdkVersion, release.manifest.sdk.minVersion) >= 0 &&
      compareSemver(this.#sdkVersion, release.manifest.sdk.maxVersionExclusive) < 0;
    checks.push(
      reviewCheck(
        'compatibility.sdk',
        'compatibility',
        sdkCompatible ? 'passed' : 'failed',
        sdkCompatible
          ? `Plugin SDK ${this.#sdkVersion} is compatible.`
          : `Plugin SDK ${this.#sdkVersion} is outside the signed range.`,
      ),
    );
    return checks;
  }

  #inspectionChecks(
    release: MarketplaceRelease,
    inspection: MarketplaceArtifactInspection,
  ): MarketplaceReviewCheck[] {
    const checks: MarketplaceReviewCheck[] = [];
    const artifactMatches =
      inspection.artifact.sha256 === release.manifest.package.sha256 &&
      inspection.artifact.sizeBytes === release.manifest.package.sizeBytes;
    checks.push(
      reviewCheck(
        'inventory.artifact',
        'inventory',
        artifactMatches ? 'passed' : 'failed',
        artifactMatches
          ? 'Inspector evidence matches the signed artifact digest and size.'
          : 'Inspector evidence does not match the signed artifact identity.',
      ),
    );
    const inventoryClean =
      inspection.inventory.status === 'clean' &&
      !inspection.inventory.pathTraversal &&
      inspection.inventory.installScripts === 0 &&
      inspection.inventory.nativeBinaries === 0;
    checks.push(
      reviewCheck(
        'inventory.contents',
        'inventory',
        inventoryClean ? 'passed' : 'failed',
        inventoryClean
          ? `Reviewed ${inspection.inventory.files} files without traversal, install scripts, or native binaries.`
          : 'Artifact inventory is blocked by traversal, install scripts, native binaries, or scanner policy.',
      ),
    );
    checks.push(
      reviewCheck(
        'sbom.spdx',
        'sbom',
        'passed',
        `Verified ${inspection.sbom.format} evidence describes ${inspection.sbom.packages} packages.`,
      ),
    );
    const provenanceValid =
      inspection.provenance.verified &&
      inspection.provenance.subjectSha256 === release.manifest.package.sha256;
    checks.push(
      reviewCheck(
        'provenance.subject',
        'provenance',
        provenanceValid ? 'passed' : 'failed',
        provenanceValid
          ? 'Verified provenance binds the signed artifact digest to source/build identity.'
          : 'Provenance is unverified or names a different artifact digest.',
      ),
    );
    checks.push(
      reviewCheck(
        'malware.scan',
        'malware',
        inspection.malware.status === 'clean' ? 'passed' : 'failed',
        inspection.malware.status === 'clean'
          ? 'Configured malware inspection reported clean.'
          : `Configured malware inspection reported ${inspection.malware.status}.`,
      ),
    );
    const vulnerabilities = inspection.vulnerabilities;
    const severe = vulnerabilities.critical + vulnerabilities.high;
    checks.push(
      reviewCheck(
        'vulnerabilities.severity',
        'vulnerabilities',
        severe > 0 ? 'failed' : vulnerabilities.moderate > 0 ? 'warning' : 'passed',
        `${vulnerabilities.critical} critical, ${vulnerabilities.high} high, ${vulnerabilities.moderate} moderate, and ${vulnerabilities.low} low known vulnerabilities were reported.`,
      ),
    );
    checks.push(
      reviewCheck(
        'licenses.policy',
        'licenses',
        inspection.licenses.status === 'allowed' ? 'passed' : 'failed',
        inspection.licenses.status === 'allowed'
          ? `Configured license policy allowed ${inspection.licenses.identifiers.length} identifiers.`
          : `Configured license policy reported ${inspection.licenses.status}.`,
      ),
    );
    const age = Date.parse(this.#now()) - Date.parse(inspection.completedAt);
    const fresh =
      age >= -300_000 && age <= resourceLimits.marketplace.maximumReviewEvidenceAgeSeconds * 1_000;
    checks.push(
      reviewCheck(
        'inventory.freshness',
        'inventory',
        fresh ? 'passed' : 'failed',
        fresh
          ? 'Artifact inspection evidence is current.'
          : 'Artifact inspection evidence is stale or future-dated.',
      ),
    );
    return checks;
  }

  async reviewRelease(input: {
    scope: ContentScope;
    releaseId: string;
    actorId: string;
  }): Promise<MarketplaceReleaseSummary> {
    const snapshot = await this.#document(input.scope);
    const release = snapshot.releases.find(({ id }) => id === input.releaseId);
    if (!release) throw new NotFoundError('Marketplace release was not found.');
    if (release.state !== 'submitted' && release.state !== 'reviewed') {
      throw new GridStoryError(
        'Marketplace release cannot be reviewed from its current state.',
        'marketplace_release_state',
        409,
      );
    }
    const descriptor = this.#artifactInspector?.descriptor ?? {
      id: 'inspector-unavailable',
      version: '0',
    };
    let inspection: MarketplaceArtifactInspection | undefined;
    let inspectionFailed = false;
    if (this.#artifactInspector) {
      try {
        const candidate = marketplaceArtifactInspectionSchema.parse(
          await this.#artifactInspector.inspect({
            scope: input.scope,
            publisherId: release.publisherId,
            pluginId: release.pluginId,
            version: release.version,
            artifactReference: release.artifactReference,
            expectedSha256: release.manifest.package.sha256,
            expectedSizeBytes: release.manifest.package.sizeBytes,
          }),
        );
        if (
          candidate.inspector.id !== descriptor.id ||
          candidate.inspector.version !== descriptor.version
        ) {
          throw new Error('Marketplace inspector identity mismatch.');
        }
        inspection = candidate;
      } catch {
        inspectionFailed = true;
      }
    } else {
      inspectionFailed = true;
    }
    return await this.#mutate(input.scope, (document) => {
      const current = document.releases.find(({ id }) => id === input.releaseId);
      if (
        !current ||
        canonicalStringify(current.manifest) !== canonicalStringify(release.manifest)
      ) {
        throw new ConflictError('Marketplace release changed during review.');
      }
      const publisher = document.publishers.find(({ id }) => id === current.publisherId);
      const checks: MarketplaceReviewCheck[] = [
        reviewCheck(
          'publisher.verified',
          'publisher',
          publisher?.state === 'verified' ? 'passed' : 'failed',
          publisher?.state === 'verified'
            ? 'Publisher identity is verified in this scoped catalog.'
            : 'Publisher is missing, pending, or suspended.',
        ),
        reviewCheck(
          'signature.ed25519',
          'signature',
          publisher && verifiedKey(current.manifest, publisher) ? 'passed' : 'failed',
          publisher && verifiedKey(current.manifest, publisher)
            ? 'Ed25519 signature binds the exact signed manifest and artifact identity.'
            : 'Manifest signature does not match the current verified publisher key.',
        ),
        ...this.#compatibilityChecks(current),
      ];
      const riskyCapabilities = current.manifest.requestedCapabilities.filter(({ capability }) =>
        [
          'content.draft.write',
          'asset.write',
          'workflow.transition',
          'jobs.enqueue',
          'network.request',
          'secrets.read',
          'studio.embed',
        ].includes(capability),
      );
      checks.push(
        reviewCheck(
          'permissions.requested',
          'permissions',
          riskyCapabilities.length > 0 ? 'warning' : 'passed',
          riskyCapabilities.length > 0
            ? `Review ${riskyCapabilities.length} elevated capability requests before granting access.`
            : 'No elevated capability request was detected.',
        ),
      );
      if (inspection) checks.push(...this.#inspectionChecks(current, inspection));
      if (inspectionFailed) {
        checks.push(
          reviewCheck(
            'inventory.inspector',
            'inventory',
            'failed',
            'Trusted artifact inspection is unavailable or returned invalid evidence.',
          ),
        );
      }
      const blocked = checks.some(({ status }) => status === 'failed');
      const completedAt = this.#now();
      const review: MarketplaceReviewRun = {
        id: this.#createId(),
        policyVersion: 1,
        status: inspectionFailed ? 'error' : blocked ? 'blocked' : 'passed',
        manifestDigest: sha256(canonicalStringify(current.manifest)),
        inspector: inspection?.inspector ?? descriptor,
        evidenceReference: inspection?.evidenceReference ?? `inspection-error:${current.id}`,
        completedAt,
        reviewedBy: input.actorId,
        checks,
      };
      current.reviews = [...current.reviews, review].slice(
        -resourceLimits.marketplace.maximumReviewRunsPerRelease,
      );
      current.state = review.status === 'passed' ? 'reviewed' : 'submitted';
      current.updatedAt = completedAt;
      return releaseSummary(current);
    });
  }

  async approveRelease(input: {
    scope: ContentScope;
    releaseId: string;
    actorId: string;
    reason: string;
  }): Promise<MarketplaceReleaseSummary> {
    return await this.#mutate(input.scope, (document) => {
      const release = document.releases.find(({ id }) => id === input.releaseId);
      if (!release) throw new NotFoundError('Marketplace release was not found.');
      const review = release.reviews.at(-1);
      if (release.state !== 'reviewed' || review?.status !== 'passed') {
        throw new GridStoryError(
          'Release requires a current passing review before approval.',
          'marketplace_review_required',
          409,
        );
      }
      if (release.submittedBy === input.actorId || review.reviewedBy === input.actorId) {
        throw new GridStoryError(
          'Release approval requires a different reviewer.',
          'marketplace_separation_required',
          403,
        );
      }
      const publisher = document.publishers.find(({ id }) => id === release.publisherId);
      if (!publisher || !verifiedKey(release.manifest, publisher)) {
        throw new GridStoryError(
          'Release publisher trust changed before approval.',
          'marketplace_release_untrusted',
          409,
        );
      }
      const age = Date.parse(this.#now()) - Date.parse(review.completedAt);
      if (age < 0 || age > resourceLimits.marketplace.maximumReviewEvidenceAgeSeconds * 1_000) {
        throw new GridStoryError(
          'Release review evidence is stale.',
          'marketplace_review_stale',
          409,
        );
      }
      const now = this.#now();
      release.state = 'approved';
      release.approvedAt = now;
      release.approvedBy = input.actorId;
      release.approvalReason = input.reason;
      release.updatedAt = now;
      return releaseSummary(release);
    });
  }

  async rejectRelease(input: {
    scope: ContentScope;
    releaseId: string;
    actorId: string;
    reason: string;
  }): Promise<MarketplaceReleaseSummary> {
    return await this.#mutate(input.scope, (document) => {
      const release = document.releases.find(({ id }) => id === input.releaseId);
      if (!release) throw new NotFoundError('Marketplace release was not found.');
      if (release.state !== 'submitted' && release.state !== 'reviewed') {
        throw new GridStoryError(
          'Marketplace release cannot be rejected from its current state.',
          'marketplace_release_state',
          409,
        );
      }
      const now = this.#now();
      release.state = 'rejected';
      release.rejectedAt = now;
      release.rejectedBy = input.actorId;
      release.rejectionReason = input.reason;
      release.updatedAt = now;
      return releaseSummary(release);
    });
  }

  async yankRelease(input: {
    scope: ContentScope;
    releaseId: string;
    actorId: string;
    reason: string;
  }): Promise<MarketplaceReleaseSummary> {
    return await this.#mutate(input.scope, (document) => {
      const release = document.releases.find(({ id }) => id === input.releaseId);
      if (!release) throw new NotFoundError('Marketplace release was not found.');
      if (release.state !== 'approved') {
        throw new GridStoryError(
          'Only an approved marketplace release can be yanked.',
          'marketplace_release_state',
          409,
        );
      }
      const now = this.#now();
      release.state = 'yanked';
      release.yankedAt = now;
      release.yankedBy = input.actorId;
      release.yankReason = input.reason;
      release.updatedAt = now;
      return releaseSummary(release);
    });
  }

  async getApprovedRelease(
    scope: ContentScope,
    releaseId: string,
  ): Promise<MarketplaceReleaseSummary> {
    const document = await this.#document(scope);
    const release = document.releases.find(({ id }) => id === releaseId);
    if (!release) throw new NotFoundError('Marketplace release was not found.');
    const publisher = document.publishers.find(({ id }) => id === release.publisherId);
    const review = release.reviews.at(-1);
    const age = review
      ? Date.parse(this.#now()) - Date.parse(review.completedAt)
      : Number.POSITIVE_INFINITY;
    if (
      release.state !== 'approved' ||
      !publisher ||
      !verifiedKey(release.manifest, publisher) ||
      review?.status !== 'passed' ||
      age < 0 ||
      age > resourceLimits.marketplace.maximumReviewEvidenceAgeSeconds * 1_000
    ) {
      throw new GridStoryError(
        'Marketplace release is not currently eligible for installation.',
        'marketplace_release_unavailable',
        409,
      );
    }
    return releaseSummary(release);
  }
}
