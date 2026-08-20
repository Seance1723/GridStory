import { generateKeyPairSync, sign } from 'node:crypto';
import { PluginTestHarness } from '@gridstory/core';
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

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'plugin-tenant',
  'x-gridstory-actor': 'plugin-admin',
  'x-gridstory-roles': 'admin',
};
const artifactDigest = 'b'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

function manifest(): SignedPluginManifest {
  const candidate: SignedPluginManifest = {
    format: PLUGIN_MANIFEST_FORMAT,
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    id: 'com.example.api',
    name: 'API plugin',
    description: 'Exercises the public plugin lifecycle.',
    version: '1.0.0',
    publisher: { id: 'example', name: 'Example' },
    sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
    package: { sha256: artifactDigest, sizeBytes: 2048 },
    runtimes: { server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION } },
    requestedCapabilities: [
      { capability: 'content.read', constraints: { contentTypes: ['page'] } },
    ],
    operations: ['summarize'],
    signature: { algorithm: 'ed25519', keyId: 'release-1', value: 'A'.repeat(88) },
  };
  candidate.signature.value = sign(
    null,
    Buffer.from(pluginManifestSigningPayload(candidate), 'utf8'),
    privateKey,
  ).toString('base64');
  return candidate;
}

describe('plugin API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('authorizes and scopes install, lifecycle, invocation, and uninstall preview', async () => {
    const runtime = new PluginTestHarness().register('com.example.api', 'summarize', (input) => ({
      summary: String(input.title),
    }));
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      pluginRuntime: runtime,
      trustedPluginPublishers: [
        {
          publisherId: 'example',
          keyId: 'release-1',
          publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
          status: 'active',
        },
      ],
    });

    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/plugins',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });
    expect(denied.statusCode).toBe(403);

    const installed = await server.inject({
      method: 'POST',
      url: '/api/v1/plugins/install',
      headers,
      payload: {
        manifest: manifest(),
        artifactDigest,
        grantedCapabilities: [
          { capability: 'content.read', constraints: { contentTypes: ['page'] } },
        ],
        reason: 'Tenant administrator approved the grant.',
      },
    });
    expect(installed.statusCode, installed.body).toBe(201);
    expect(installed.headers['cache-control']).toBe('private, no-store');

    const crossedTenant = await server.inject({
      method: 'GET',
      url: '/api/v1/plugins/com.example.api',
      headers: { ...headers, 'x-gridstory-tenant': 'other-tenant' },
    });
    expect(crossedTenant.statusCode).toBe(404);

    const enabled = await server.inject({
      method: 'POST',
      url: '/api/v1/plugins/com.example.api/enable',
      headers,
      payload: { reason: 'Runtime health check is green.' },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    expect(enabled.json().state).toBe('enabled');

    const invoked = await server.inject({
      method: 'POST',
      url: '/api/v1/plugins/com.example.api/invoke',
      headers,
      payload: {
        operation: 'summarize',
        capability: 'content.read',
        input: { title: 'Scoped result' },
      },
    });
    expect(invoked.statusCode, invoked.body).toBe(200);
    expect(invoked.json()).toEqual({ output: { summary: 'Scoped result' } });

    const preview = await server.inject({
      method: 'GET',
      url: '/api/v1/plugins/com.example.api/uninstall-preview',
      headers,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().warnings).toContain('Disable the plugin before uninstalling it.');

    const revoked = await server.inject({
      method: 'POST',
      url: '/api/v1/plugins/com.example.api/revoke',
      headers,
      payload: { reason: 'Emergency tenant revocation.' },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().events.at(-1)).toMatchObject({
      action: 'revoked',
      actorId: 'plugin-admin',
    });

    const blocked = await server.inject({
      method: 'POST',
      url: '/api/v1/plugins/com.example.api/invoke',
      headers,
      payload: { operation: 'summarize', capability: 'content.read', input: {} },
    });
    expect(blocked.statusCode).toBe(409);
  });
});
