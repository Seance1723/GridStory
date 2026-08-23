import { describe, expect, it } from 'vitest';
import {
  marketplaceArtifactInspectionSchema,
  marketplacePublisherSchema,
  marketplacePublisherSummarySchema,
  marketplaceReleaseSubmissionSchema,
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  pluginManifestSigningPayload,
  signedPluginManifestSchema,
} from '../src/index.js';

const now = '2026-08-23T12:00:00.000Z';

function manifest() {
  return {
    format: PLUGIN_MANIFEST_FORMAT,
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    id: 'com.example.editorial',
    name: 'Editorial helper',
    description: 'A reviewed marketplace fixture.',
    version: '1.2.3',
    publisher: { id: 'example', name: 'Example' },
    sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
    package: { sha256: 'a'.repeat(64), sizeBytes: 1_024 },
    runtimes: { server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION } },
    requestedCapabilities: [{ capability: 'content.read' as const }],
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
            testedAt: now,
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
  };
}

describe('marketplace contracts', () => {
  it('binds bounded compatibility and support metadata into the signed payload', () => {
    const parsed = signedPluginManifestSchema.parse(manifest());
    const payload = pluginManifestSigningPayload(parsed);
    expect(payload).toContain('support-policy');
    expect(payload).toContain('maxVersionExclusive');
    expect(payload).not.toContain('signature');

    expect(
      signedPluginManifestSchema.safeParse({
        ...manifest(),
        marketplace: {
          ...manifest().marketplace,
          compatibility: {
            ...manifest().marketplace.compatibility,
            gridstory: { minVersion: '2.0.0', maxVersionExclusive: '1.0.0' },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      signedPluginManifestSchema.safeParse({
        ...manifest(),
        marketplace: {
          ...manifest().marketplace,
          support: { ...manifest().marketplace.support, policyUrl: 'http://example.com' },
        },
      }).success,
    ).toBe(false);
  });

  it('requires marketplace metadata for release submission and strips private publisher state', () => {
    expect(
      marketplaceReleaseSubmissionSchema.safeParse({
        manifest: { ...manifest(), marketplace: undefined },
        artifactReference: 'scanner://fixture/editorial-1.2.3',
      }).success,
    ).toBe(false);

    const publisher = marketplacePublisherSchema.parse({
      organizationId: 'organization-a',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      siteId: 'site-a',
      environmentId: 'development',
      locale: 'en',
      id: 'example',
      displayName: 'Example',
      domain: 'example.com',
      websiteUrl: 'https://example.com',
      supportUrl: 'https://example.com/support',
      key: {
        keyId: 'release-1',
        algorithm: 'ed25519',
        publicKey: `-----BEGIN PUBLIC KEY-----\n${'A'.repeat(100)}\n-----END PUBLIC KEY-----`,
        fingerprint: 'b'.repeat(64),
      },
      state: 'pending',
      challenge: {
        recordName: '_gridstory-verification.example.com',
        token: 'challenge-token-that-remains-private-1234567890',
        issuedAt: now,
        expiresAt: '2026-08-23T12:15:00.000Z',
      },
      createdAt: now,
      createdBy: 'publisher-admin',
      updatedAt: now,
    });
    const summary = marketplacePublisherSummarySchema.parse(publisher);
    expect(summary).not.toHaveProperty('challenge');
    expect(summary.key).not.toHaveProperty('publicKey');
    expect(summary.key.fingerprint).toBe('b'.repeat(64));
  });

  it('requires exact bounded inspection evidence rather than a self-asserted pass flag', () => {
    const inspection = marketplaceArtifactInspectionSchema.parse({
      inspector: { id: 'fixture-scanner', version: '1.0.0' },
      completedAt: now,
      evidenceReference: 'scan:fixture:123',
      artifact: { sha256: 'a'.repeat(64), sizeBytes: 1_024 },
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
        subjectSha256: 'a'.repeat(64),
        builderId: 'https://github.com/example/plugin/.github/workflows/release.yml',
        sourceRepository: 'https://github.com/example/plugin',
        sourceRevision: '1234567890abcdef',
      },
      malware: { status: 'clean' },
      vulnerabilities: { critical: 0, high: 0, moderate: 1, low: 2, identifiers: ['OSV-1'] },
      licenses: { status: 'allowed', identifiers: ['Apache-2.0'] },
    });
    expect(inspection.provenance.subjectSha256).toBe(inspection.artifact.sha256);
    expect(
      marketplaceArtifactInspectionSchema.safeParse({ ...inspection, unexpectedPass: true })
        .success,
    ).toBe(false);
  });
});
