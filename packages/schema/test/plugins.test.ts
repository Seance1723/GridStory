import { describe, expect, it } from 'vitest';
import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  pluginManifestSigningPayload,
  signedPluginManifestSchema,
} from '../src/index.js';

const manifest = () => ({
  format: PLUGIN_MANIFEST_FORMAT,
  manifestVersion: PLUGIN_MANIFEST_VERSION,
  id: 'com.example.editorial',
  name: 'Editorial helper',
  description: 'A test plugin.',
  version: '1.2.3',
  publisher: { id: 'example', name: 'Example' },
  sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
  package: { sha256: 'a'.repeat(64), sizeBytes: 1024 },
  runtimes: { server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION } },
  requestedCapabilities: [
    { capability: 'content.read' as const, constraints: { contentTypes: ['page'] } },
    { capability: 'network.request' as const, constraints: { networkHosts: ['api.example.com'] } },
  ],
  operations: ['summarize'],
  signature: { algorithm: 'ed25519', keyId: 'release-1', value: 'A'.repeat(88) },
});

describe('plugin SDK contracts', () => {
  it('parses a bounded external-runtime manifest and signs only canonical unsigned metadata', () => {
    const parsed = signedPluginManifestSchema.parse(manifest());
    expect(pluginManifestSigningPayload(parsed)).not.toContain('signature');
    expect(pluginManifestSigningPayload(parsed)).toContain(`"sha256":"${'a'.repeat(64)}"`);
  });

  it('requires allow-list constraints for ambient-risk capabilities', () => {
    const candidate = manifest();
    candidate.requestedCapabilities[1] = {
      capability: 'network.request',
      constraints: { networkHosts: [] },
    };
    expect(signedPluginManifestSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects duplicate capabilities and a manifest without an isolated runtime', () => {
    const duplicate = manifest();
    duplicate.requestedCapabilities.push({
      capability: 'content.read',
      constraints: { contentTypes: ['page'] },
    });
    expect(signedPluginManifestSchema.safeParse(duplicate).success).toBe(false);
    expect(signedPluginManifestSchema.safeParse({ ...manifest(), runtimes: {} }).success).toBe(
      false,
    );
  });
});
