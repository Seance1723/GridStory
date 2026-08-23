import { generateKeyPairSync, sign } from 'node:crypto';
import type { MarketplaceArtifactInspector } from '@gridstory/core';
import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  pluginManifestSigningPayload,
  type SignedPluginManifest,
} from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const baseHeaders = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'marketplace-tenant',
  'x-gridstory-environment': 'marketplace-test',
  'x-gridstory-roles': 'admin',
};
const artifactDigest = 'd'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

function headers(actor: string, roles = 'admin') {
  return { ...baseHeaders, 'x-gridstory-actor': actor, 'x-gridstory-roles': roles };
}

function manifest(): SignedPluginManifest {
  const candidate: SignedPluginManifest = {
    format: PLUGIN_MANIFEST_FORMAT,
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    id: 'com.example.marketplace',
    name: 'Marketplace plugin',
    description: 'Exercises publisher and reviewed release APIs.',
    version: '1.0.0',
    publisher: { id: 'example', name: 'Example' },
    sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
    package: { sha256: artifactDigest, sizeBytes: 2_048 },
    runtimes: { server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION } },
    requestedCapabilities: [
      { capability: 'content.read', constraints: { contentTypes: ['page'] } },
    ],
    operations: ['summarize'],
    marketplace: {
      categories: ['authoring'],
      keywords: ['editorial', 'review'],
      homepageUrl: 'https://example.com/plugin',
      documentationUrl: 'https://docs.example.com/plugin',
      repositoryUrl: 'https://code.example.com/plugin',
      compatibility: {
        gridstory: { minVersion: '0.0.0', maxVersionExclusive: '1.0.0' },
        testedRuntimes: [
          {
            runtime: 'node',
            version: '22.14.0',
            testedAt: '2026-08-23T12:00:00.000Z',
            evidenceUrl: 'https://ci.example.com/runs/123',
          },
        ],
      },
      support: {
        status: 'maintained',
        policyUrl: 'https://example.com/support-policy',
        contactUrl: 'https://example.com/support',
      },
    },
    signature: { algorithm: 'ed25519', keyId: 'release-1', value: 'A'.repeat(88) },
  };
  candidate.signature.value = sign(
    null,
    Buffer.from(pluginManifestSigningPayload(candidate), 'utf8'),
    privateKey,
  ).toString('base64');
  return candidate;
}

const artifactInspector: MarketplaceArtifactInspector = {
  descriptor: { id: 'api-fixture-scanner', version: '1.0.0' },
  inspect(input) {
    return {
      inspector: { id: 'api-fixture-scanner', version: '1.0.0' },
      completedAt: new Date().toISOString(),
      evidenceReference: 'scan:api-fixture:123',
      artifact: { sha256: input.expectedSha256, sizeBytes: input.expectedSizeBytes },
      inventory: {
        status: 'clean',
        files: 10,
        installScripts: 0,
        nativeBinaries: 0,
        pathTraversal: false,
      },
      sbom: { format: 'spdx-json-2.3', sha256: 'e'.repeat(64), packages: 3 },
      provenance: {
        verified: true,
        subjectSha256: input.expectedSha256,
        builderId: 'https://github.com/example/plugin/.github/workflows/release.yml',
        sourceRepository: 'https://github.com/example/plugin',
        sourceRevision: '1234567890abcdef',
      },
      malware: { status: 'clean' },
      vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, identifiers: [] },
      licenses: { status: 'allowed', identifiers: ['Apache-2.0'] },
    };
  },
};

describe('marketplace HTTP workflow', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('keeps catalog state private/scoped and requires evidence plus separate approvals before install', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      marketplace: {
        artifactInspector,
        domainVerifier: { hasTxtRecord: () => true },
      },
    });
    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/marketplace',
      headers: headers('delivery-reader', 'delivery'),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['cache-control']).toBe('private, no-store');

    const registered = await server.inject({
      method: 'POST',
      url: '/api/v1/marketplace/publishers',
      headers: headers('publisher-owner'),
      payload: {
        id: 'example',
        displayName: 'Example',
        domain: 'example.com',
        websiteUrl: 'https://example.com',
        supportUrl: 'https://support.example.com',
        key: {
          keyId: 'release-1',
          algorithm: 'ed25519',
          publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        },
      },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    expect(registered.json().key).not.toHaveProperty('publicKey');

    const challenge = await server.inject({
      method: 'POST',
      url: '/api/v1/marketplace/publishers/example/challenge',
      headers: headers('publisher-owner'),
      payload: {},
    });
    expect(challenge.statusCode).toBe(201);
    expect(challenge.json().token).toMatch(/^gridstory-verification=/u);
    const verifiedDomain = await server.inject({
      method: 'POST',
      url: '/api/v1/marketplace/publishers/example/verify-domain',
      headers: headers('publisher-owner'),
      payload: {},
    });
    expect(verifiedDomain.statusCode, verifiedDomain.body).toBe(200);

    const selfApproval = await server.inject({
      method: 'POST',
      url: '/api/v1/marketplace/publishers/example/approve',
      headers: headers('publisher-owner'),
      payload: { evidenceReference: 'publisher-review:api', reason: 'Self approval attempt.' },
    });
    expect(selfApproval.statusCode).toBe(403);
    const approvedPublisher = await server.inject({
      method: 'POST',
      url: '/api/v1/marketplace/publishers/example/approve',
      headers: headers('identity-reviewer'),
      payload: {
        evidenceReference: 'publisher-review:api',
        reason: 'Domain and operator evidence reviewed.',
      },
    });
    expect(approvedPublisher.statusCode, approvedPublisher.body).toBe(200);

    const submitted = await server.inject({
      method: 'POST',
      url: '/api/v1/marketplace/releases',
      headers: headers('publisher-owner'),
      payload: {
        manifest: manifest(),
        artifactReference: 'scanner://api-fixture/marketplace-1.0.0',
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    expect(submitted.json()).not.toHaveProperty('artifactReference');
    const releaseId = submitted.json().id as string;

    const reviewed = await server.inject({
      method: 'POST',
      url: `/api/v1/marketplace/releases/${releaseId}/review`,
      headers: headers('security-reviewer'),
      payload: {},
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json()).toMatchObject({ state: 'reviewed' });
    const selfReleaseApproval = await server.inject({
      method: 'POST',
      url: `/api/v1/marketplace/releases/${releaseId}/approve`,
      headers: headers('security-reviewer'),
      payload: { reason: 'Self approval attempt.' },
    });
    expect(selfReleaseApproval.statusCode).toBe(403);
    const approvedRelease = await server.inject({
      method: 'POST',
      url: `/api/v1/marketplace/releases/${releaseId}/approve`,
      headers: headers('release-approver'),
      payload: { reason: 'Automated evidence and permissions reviewed.' },
    });
    expect(approvedRelease.statusCode, approvedRelease.body).toBe(200);

    const viewerOverview = await server.inject({
      method: 'GET',
      url: '/api/v1/marketplace',
      headers: headers('catalog-viewer', 'viewer'),
    });
    expect(viewerOverview.statusCode).toBe(200);
    expect(viewerOverview.headers['cache-control']).toBe('private, no-store');
    expect(viewerOverview.body).not.toContain('gridstory-verification=');
    expect(viewerOverview.body).not.toContain('scanner://');
    expect(viewerOverview.body).not.toContain('BEGIN PUBLIC KEY');

    const installed = await server.inject({
      method: 'POST',
      url: `/api/v1/marketplace/releases/${releaseId}/install`,
      headers: headers('tenant-admin'),
      payload: {
        grantedCapabilities: [
          { capability: 'content.read', constraints: { contentTypes: ['page'] } },
        ],
        reason: 'Approved marketplace release selected.',
      },
    });
    expect(installed.statusCode, installed.body).toBe(201);
    expect(installed.json()).toMatchObject({ state: 'installed' });

    const crossedScope = await server.inject({
      method: 'GET',
      url: '/api/v1/marketplace/publishers/example',
      headers: { ...headers('tenant-admin'), 'x-gridstory-tenant': 'other-tenant' },
    });
    expect(crossedScope.statusCode).toBe(404);

    const yanked = await server.inject({
      method: 'POST',
      url: `/api/v1/marketplace/releases/${releaseId}/yank`,
      headers: headers('security-reviewer'),
      payload: { reason: 'New security evidence requires withdrawal.' },
    });
    expect(yanked.statusCode).toBe(200);
    const blockedInstall = await server.inject({
      method: 'POST',
      url: `/api/v1/marketplace/releases/${releaseId}/install`,
      headers: headers('tenant-admin'),
      payload: { grantedCapabilities: [], reason: 'Must not install a yanked release.' },
    });
    expect(blockedInstall.statusCode).toBe(409);
  });
});
