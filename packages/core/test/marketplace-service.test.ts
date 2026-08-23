import { generateKeyPairSync, sign } from 'node:crypto';
import {
  type ContentScope,
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  pluginManifestSigningPayload,
  type SignedPluginManifest,
} from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  InMemoryMarketplaceRepository,
  InMemoryPluginRepository,
  type MarketplaceArtifactInspector,
  MarketplaceService,
  PluginService,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};
const artifactDigest = 'a'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

function signedManifest(): SignedPluginManifest {
  const candidate = {
    format: PLUGIN_MANIFEST_FORMAT,
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    id: 'com.example.editorial',
    name: 'Editorial helper',
    description: 'A reviewed marketplace fixture.',
    version: '1.2.3',
    publisher: { id: 'example', name: 'Example' },
    sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
    package: { sha256: artifactDigest, sizeBytes: 1_024 },
    runtimes: { server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION } },
    requestedCapabilities: [
      { capability: 'content.read' as const, constraints: { contentTypes: ['page'] } },
      {
        capability: 'network.request' as const,
        constraints: { networkHosts: ['api.example.com'] },
      },
    ],
    operations: ['summarize'],
    marketplace: {
      categories: ['authoring' as const],
      keywords: ['editorial', 'review'],
      homepageUrl: 'https://example.com/plugin',
      documentationUrl: 'https://docs.example.com/plugin',
      repositoryUrl: 'https://code.example.com/plugin',
      compatibility: {
        gridstory: { minVersion: '0.0.0', maxVersionExclusive: '1.0.0' },
        testedRuntimes: [
          {
            runtime: 'node' as const,
            version: '22.14.0',
            testedAt: '2026-08-23T12:00:00.000Z',
            evidenceUrl: 'https://ci.example.com/runs/123',
          },
        ],
      },
      support: {
        status: 'maintained' as const,
        policyUrl: 'https://example.com/support-policy',
        contactUrl: 'https://example.com/support',
      },
    },
    signature: { algorithm: 'ed25519' as const, keyId: 'release-1', value: 'A'.repeat(88) },
  } as SignedPluginManifest;
  candidate.signature.value = sign(
    null,
    Buffer.from(pluginManifestSigningPayload(candidate), 'utf8'),
    privateKey,
  ).toString('base64');
  return candidate;
}

function inspector(
  overrides: {
    digest?: string;
    critical?: number;
    completedAt?: string;
    reportedInspector?: { id: string; version: string };
  } = {},
): MarketplaceArtifactInspector {
  return {
    descriptor: { id: 'fixture-scanner', version: '1.0.0' },
    inspect(input) {
      return {
        inspector: overrides.reportedInspector ?? { id: 'fixture-scanner', version: '1.0.0' },
        completedAt: overrides.completedAt ?? '2026-08-23T12:05:00.000Z',
        evidenceReference: 'scan:fixture:123',
        artifact: {
          sha256: overrides.digest ?? input.expectedSha256,
          sizeBytes: input.expectedSizeBytes,
        },
        inventory: {
          status: 'clean',
          files: 12,
          installScripts: 0,
          nativeBinaries: 0,
          pathTraversal: false,
        },
        sbom: { format: 'spdx-json-2.3', sha256: 'c'.repeat(64), packages: 4 },
        provenance: {
          verified: true,
          subjectSha256: input.expectedSha256,
          builderId: 'https://github.com/example/plugin/.github/workflows/release.yml',
          sourceRepository: 'https://github.com/example/plugin',
          sourceRevision: '1234567890abcdef',
        },
        malware: { status: 'clean' },
        vulnerabilities: {
          critical: overrides.critical ?? 0,
          high: 0,
          moderate: 1,
          low: 2,
          identifiers: ['OSV-1'],
        },
        licenses: { status: 'allowed', identifiers: ['Apache-2.0'] },
      };
    },
  };
}

function fixtureService(options: { inspector?: MarketplaceArtifactInspector; now?: string } = {}) {
  let sequence = 0;
  let challengeToken = '';
  const service = new MarketplaceService({
    repository: new InMemoryMarketplaceRepository(),
    artifactInspector: options.inspector ?? inspector(),
    domainVerifier: {
      hasTxtRecord({ token }) {
        return token === challengeToken;
      },
    },
    hostVersion: '0.0.0',
    now: () => options.now ?? '2026-08-23T12:05:00.000Z',
    createId: () => {
      sequence += 1;
      return `market-${sequence}`;
    },
    createToken: () => 'publisher-domain-token-1234567890',
  });
  return {
    service,
    acceptChallenge(token: string) {
      challengeToken = token;
    },
  };
}

async function verifiedPublisher(fixture: ReturnType<typeof fixtureService>) {
  await fixture.service.registerPublisher(scope, 'publisher-owner', {
    id: 'example',
    displayName: 'Example',
    domain: 'example.com',
    websiteUrl: 'https://example.com',
    supportUrl: 'https://support.example.com',
    key: { keyId: 'release-1', algorithm: 'ed25519', publicKey: publicKeyPem },
  });
  const challenge = await fixture.service.issueDomainChallenge(scope, 'example');
  fixture.acceptChallenge(challenge.token);
  await fixture.service.verifyPublisherDomain(scope, 'example');
  return await fixture.service.approvePublisher({
    scope,
    publisherId: 'example',
    actorId: 'identity-reviewer',
    evidenceReference: 'publisher-review:123',
    reason: 'Domain and operator evidence reviewed.',
  });
}

describe('MarketplaceService', () => {
  it('requires exact domain proof, separation of duties, and scope before trusting a publisher', async () => {
    const fixture = fixtureService();
    await fixture.service.registerPublisher(scope, 'publisher-owner', {
      id: 'example',
      displayName: 'Example',
      domain: 'example.com',
      websiteUrl: 'https://example.com',
      supportUrl: 'https://support.example.com',
      key: { keyId: 'release-1', algorithm: 'ed25519', publicKey: publicKeyPem },
    });
    const challenge = await fixture.service.issueDomainChallenge(scope, 'example');
    await expect(fixture.service.verifyPublisherDomain(scope, 'example')).rejects.toMatchObject({
      code: 'marketplace_domain_unverified',
    });
    fixture.acceptChallenge(challenge.token);
    await fixture.service.verifyPublisherDomain(scope, 'example');
    await expect(
      fixture.service.approvePublisher({
        scope,
        publisherId: 'example',
        actorId: 'publisher-owner',
        evidenceReference: 'publisher-review:123',
        reason: 'Self approval attempt.',
      }),
    ).rejects.toMatchObject({ code: 'marketplace_separation_required' });
    const publisher = await fixture.service.approvePublisher({
      scope,
      publisherId: 'example',
      actorId: 'identity-reviewer',
      evidenceReference: 'publisher-review:123',
      reason: 'Domain and operator evidence reviewed.',
    });
    expect(publisher).toMatchObject({ state: 'verified', domainVerifiedAt: expect.any(String) });
    expect(publisher).not.toHaveProperty('challenge');
    expect(publisher.key).not.toHaveProperty('publicKey');
    await expect(
      fixture.service.getPublisher({ ...scope, tenantId: 'tenant-b' }, 'example'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      fixture.service.trustedPublisher(scope, 'example', 'release-1'),
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('reviews exact evidence, separates approval, and installs only through current marketplace trust', async () => {
    const fixture = fixtureService();
    await verifiedPublisher(fixture);
    const release = await fixture.service.submitRelease({
      scope,
      actorId: 'publisher-owner',
      submission: {
        manifest: signedManifest(),
        artifactReference: 'scanner://fixture/editorial-1.2.3',
      },
    });
    const reviewed = await fixture.service.reviewRelease({
      scope,
      releaseId: release.id,
      actorId: 'security-reviewer',
    });
    expect(reviewed).toMatchObject({ state: 'reviewed' });
    expect(reviewed.reviews[0]?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'signature.ed25519', status: 'passed' }),
        expect.objectContaining({ id: 'permissions.requested', status: 'warning' }),
        expect.objectContaining({ id: 'vulnerabilities.severity', status: 'warning' }),
      ]),
    );
    await expect(
      fixture.service.approveRelease({
        scope,
        releaseId: release.id,
        actorId: 'security-reviewer',
        reason: 'Self approval attempt.',
      }),
    ).rejects.toMatchObject({ code: 'marketplace_separation_required' });
    await fixture.service.approveRelease({
      scope,
      releaseId: release.id,
      actorId: 'release-approver',
      reason: 'Automated evidence and permissions reviewed.',
    });

    const pluginService = new PluginService({
      repository: new InMemoryPluginRepository(),
      trustedPublishers: [],
      trustedPublisherResolver: ({ scope: candidateScope, publisherId, keyId }) =>
        fixture.service.trustedPublisher(candidateScope, publisherId, keyId),
    });
    const approved = await fixture.service.getApprovedRelease(scope, release.id);
    await expect(
      pluginService.install({
        scope,
        manifest: approved.manifest,
        artifactDigest: approved.manifest.package.sha256,
        grantedCapabilities: [
          { capability: 'content.read', constraints: { contentTypes: ['page'] } },
        ],
        actorId: 'tenant-admin',
        reason: 'Approved marketplace release selected.',
      }),
    ).resolves.toMatchObject({ state: 'installed' });

    await fixture.service.suspendPublisher({
      scope,
      publisherId: 'example',
      actorId: 'security-reviewer',
      reason: 'Publisher trust incident.',
    });
    await expect(fixture.service.getApprovedRelease(scope, release.id)).rejects.toMatchObject({
      code: 'marketplace_release_unavailable',
    });
    await expect(
      fixture.service.trustedPublisher(scope, 'example', 'release-1'),
    ).resolves.toMatchObject({ status: 'revoked' });
  });

  it('blocks mismatched, vulnerable, unavailable, and duplicate package evidence', async () => {
    const fixture = fixtureService({
      inspector: inspector({ digest: 'b'.repeat(64), critical: 1 }),
    });
    await verifiedPublisher(fixture);
    const submission = {
      manifest: signedManifest(),
      artifactReference: 'scanner://fixture/editorial-1.2.3',
    };
    const release = await fixture.service.submitRelease({
      scope,
      actorId: 'publisher-owner',
      submission,
    });
    await expect(
      fixture.service.submitRelease({ scope, actorId: 'publisher-owner', submission }),
    ).rejects.toMatchObject({ code: 'marketplace_release_exists' });
    const reviewed = await fixture.service.reviewRelease({
      scope,
      releaseId: release.id,
      actorId: 'security-reviewer',
    });
    expect(reviewed).toMatchObject({ state: 'submitted' });
    expect(reviewed.reviews[0]).toMatchObject({ status: 'blocked' });
    await expect(
      fixture.service.approveRelease({
        scope,
        releaseId: release.id,
        actorId: 'release-approver',
        reason: 'Must not pass.',
      }),
    ).rejects.toMatchObject({ code: 'marketplace_review_required' });

    const unavailable = fixtureService({
      inspector: {
        descriptor: { id: 'broken-scanner', version: '1' },
        inspect() {
          throw new Error('private scanner failure');
        },
      },
    });
    await verifiedPublisher(unavailable);
    const failedRelease = await unavailable.service.submitRelease({
      scope,
      actorId: 'publisher-owner',
      submission,
    });
    const failedReview = await unavailable.service.reviewRelease({
      scope,
      releaseId: failedRelease.id,
      actorId: 'security-reviewer',
    });
    expect(failedReview.reviews[0]).toMatchObject({ status: 'error' });
    expect(JSON.stringify(failedReview)).not.toContain('private scanner failure');
  });

  it('rejects evidence attributed to a scanner other than the configured trusted adapter', async () => {
    const fixture = fixtureService({
      inspector: inspector({
        reportedInspector: { id: 'substituted-scanner', version: '9.9.9' },
      }),
    });
    await verifiedPublisher(fixture);
    const release = await fixture.service.submitRelease({
      scope,
      actorId: 'publisher-owner',
      submission: {
        manifest: signedManifest(),
        artifactReference: 'scanner://fixture/editorial-1.2.3',
      },
    });

    const reviewed = await fixture.service.reviewRelease({
      scope,
      releaseId: release.id,
      actorId: 'security-reviewer',
    });

    expect(reviewed).toMatchObject({ state: 'submitted' });
    expect(reviewed.reviews[0]).toMatchObject({
      status: 'error',
      inspector: { id: 'fixture-scanner', version: '1.0.0' },
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'inventory.inspector', status: 'failed' }),
      ]),
    });
    expect(JSON.stringify(reviewed)).not.toContain('substituted-scanner');
  });
});
