import { generateKeyPairSync, sign } from 'node:crypto';
import {
  type ContentScope,
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  pluginManifestSigningPayload,
  type SignedPluginManifest,
} from '@gridstory/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InMemoryPluginRepository,
  PluginService,
  PluginTestHarness,
  SqlitePluginRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};
const otherScope = { ...scope, tenantId: 'tenant-b' };
const artifactDigest = 'a'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const trust = {
  publisherId: 'example',
  keyId: 'release-1',
  publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  status: 'active' as const,
};

function signedManifest(overrides: Record<string, unknown> = {}): SignedPluginManifest {
  const candidate = {
    format: PLUGIN_MANIFEST_FORMAT,
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    id: 'com.example.editorial',
    name: 'Editorial helper',
    description: 'A test plugin.',
    version: '1.2.3',
    publisher: { id: 'example', name: 'Example' },
    sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
    package: { sha256: artifactDigest, sizeBytes: 1024 },
    runtimes: { server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION } },
    requestedCapabilities: [
      { capability: 'content.read' as const, constraints: { contentTypes: ['page', 'article'] } },
      {
        capability: 'network.request' as const,
        constraints: { networkHosts: ['api.example.com'] },
      },
    ],
    operations: ['summarize'],
    ...overrides,
    signature: { algorithm: 'ed25519' as const, keyId: 'release-1', value: 'A'.repeat(88) },
  } as SignedPluginManifest;
  candidate.signature.value = sign(
    null,
    Buffer.from(pluginManifestSigningPayload(candidate), 'utf8'),
    privateKey,
  ).toString('base64');
  return candidate;
}

function installInput(manifest = signedManifest()) {
  return {
    scope,
    manifest,
    artifactDigest,
    grantedCapabilities: [
      { capability: 'content.read' as const, constraints: { contentTypes: ['page'] } },
    ],
    actorId: 'administrator',
    reason: 'Approved for editorial testing.',
  };
}

describe('PluginService', () => {
  const repositories: SqlitePluginRepository[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) repository.close();
  });

  it('verifies signatures, artifact digest, SDK compatibility, and grant subsets', async () => {
    const service = new PluginService({
      repository: new InMemoryPluginRepository(),
      trustedPublishers: [trust],
    });
    await expect(service.install(installInput())).resolves.toMatchObject({
      id: 'com.example.editorial',
      state: 'installed',
    });

    const wrongDigest = new PluginService({
      repository: new InMemoryPluginRepository(),
      trustedPublishers: [trust],
    });
    await expect(
      wrongDigest.install({ ...installInput(), artifactDigest: 'b'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'plugin_digest' });

    const tampered = signedManifest();
    tampered.name = 'Tampered';
    await expect(
      new PluginService({
        repository: new InMemoryPluginRepository(),
        trustedPublishers: [trust],
      }).install(installInput(tampered)),
    ).rejects.toMatchObject({ code: 'plugin_signature' });

    const incompatible = signedManifest({
      sdk: { minVersion: '2.0.0', maxVersionExclusive: '3.0.0' },
    });
    await expect(
      new PluginService({
        repository: new InMemoryPluginRepository(),
        trustedPublishers: [trust],
      }).install(installInput(incompatible)),
    ).rejects.toMatchObject({ code: 'plugin_incompatible' });

    const excessiveGrant = new PluginService({
      repository: new InMemoryPluginRepository(),
      trustedPublishers: [trust],
    });
    await expect(
      excessiveGrant.install({
        ...installInput(),
        grantedCapabilities: [
          { capability: 'content.read', constraints: { contentTypes: ['secret'] } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'plugin_grant_exceeds' });
  });

  it('enforces lifecycle, capability, operation, tenant scope, rate, and output bounds', async () => {
    const runtime = new PluginTestHarness().register(
      'com.example.editorial',
      'summarize',
      (input) => ({
        title: input.title,
      }),
    );
    const repository = new InMemoryPluginRepository();
    const service = new PluginService({
      repository,
      trustedPublishers: [trust],
      runtime,
      invocationLimitPerMinute: 1,
      maxOutputBytes: 100,
    });
    await service.install(installInput());
    await expect(
      service.invoke({
        scope,
        id: 'com.example.editorial',
        operation: 'summarize',
        capability: 'content.read',
        payload: { title: 'Safe' },
      }),
    ).rejects.toMatchObject({ code: 'plugin_disabled' });
    await expect(
      service.enable({ scope, id: 'com.example.editorial', actorId: 'admin', reason: 'Go' }),
    ).resolves.toMatchObject({ state: 'enabled' });
    await expect(
      service.invoke({
        scope,
        id: 'com.example.editorial',
        operation: 'summarize',
        capability: 'content.read',
        payload: { title: 'Safe' },
      }),
    ).resolves.toEqual({ output: { title: 'Safe' } });
    await expect(
      service.invoke({
        scope,
        id: 'com.example.editorial',
        operation: 'summarize',
        capability: 'content.read',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'plugin_rate_limited' });
    await expect(service.get(otherScope, 'com.example.editorial')).rejects.toMatchObject({
      code: 'not_found',
    });
    await service.disable({
      scope,
      id: 'com.example.editorial',
      actorId: 'admin',
      reason: 'Pause',
    });
    const preview = await service.uninstallPreview(scope, 'com.example.editorial');
    expect(preview.externalDataDeletionRequired).toBe(true);
    const uninstalled = await service.uninstall({
      scope,
      id: 'com.example.editorial',
      actorId: 'admin',
      reason: 'No longer needed.',
    });
    expect(uninstalled.events.map(({ action }) => action)).toEqual([
      'installed',
      'enabled',
      'disabled',
      'uninstalled',
    ]);
  });

  it('fails closed when a server runtime is absent or unhealthy', async () => {
    const repository = new InMemoryPluginRepository();
    const service = new PluginService({ repository, trustedPublishers: [trust] });
    await service.install(installInput());
    await expect(
      service.enable({ scope, id: 'com.example.editorial', actorId: 'admin', reason: 'Go' }),
    ).rejects.toMatchObject({ code: 'plugin_runtime_unavailable' });
  });

  it('persists lifecycle records in SQLite without crossing scope', async () => {
    const repository = new SqlitePluginRepository({ filename: ':memory:' });
    repositories.push(repository);
    const service = new PluginService({ repository, trustedPublishers: [trust] });
    await service.install(installInput());
    expect(repository.get(scope, 'com.example.editorial')).toMatchObject({ state: 'installed' });
    expect(repository.get(otherScope, 'com.example.editorial')).toBeNull();
  });
});
