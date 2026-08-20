import {
  type ContentScope,
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  type PluginInstallation,
} from '@gridstory/schema';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresContentRepository, PostgresPluginRepository } from '../src/index.js';
import { repositoryConformance } from './repository-conformance.js';

const connectionString = process.env.GRIDSTORY_TEST_POSTGRES_URL;
let schemaSequence = 0;

if (connectionString) {
  repositoryConformance('PostgreSQL', () => {
    const schema = `gridstory_test_${process.pid}_${schemaSequence++}`;
    const pool = new Pool({ connectionString });
    return {
      repository: new PostgresContentRepository({ pool, schema }),
      cleanup: async () => {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      },
    };
  });
  describe('PostgreSQL plugin repository conformance', () => {
    it('persists lifecycle state under the complete scope key', async () => {
      const schema = `gridstory_plugin_test_${process.pid}_${schemaSequence++}`;
      const pool = new Pool({ connectionString });
      const repository = new PostgresPluginRepository({ pool, schema });
      const scope: ContentScope = {
        organizationId: 'organization-a',
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        siteId: 'site-a',
        environmentId: 'development',
        locale: 'en',
      };
      const occurredAt = '2026-08-21T00:00:00.000Z';
      const installation: PluginInstallation = {
        ...scope,
        id: 'com.example.postgres',
        manifest: {
          format: PLUGIN_MANIFEST_FORMAT,
          manifestVersion: PLUGIN_MANIFEST_VERSION,
          id: 'com.example.postgres',
          name: 'PostgreSQL plugin',
          description: '',
          version: '1.0.0',
          publisher: { id: 'example', name: 'Example' },
          sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
          package: { sha256: 'd'.repeat(64), sizeBytes: 100 },
          runtimes: {
            server: { isolation: 'external', protocolVersion: PLUGIN_PROTOCOL_VERSION },
          },
          requestedCapabilities: [{ capability: 'content.read' }],
          operations: ['read'],
          signature: { algorithm: 'ed25519', keyId: 'release-1', value: 'A'.repeat(88) },
        },
        artifactDigest: 'd'.repeat(64),
        state: 'installed',
        grantedCapabilities: [{ capability: 'content.read' }],
        installedAt: occurredAt,
        installedBy: 'postgres-test',
        updatedAt: occurredAt,
        events: [
          {
            id: 'plugin-event-1',
            action: 'installed',
            actorId: 'postgres-test',
            reason: 'Conformance test.',
            occurredAt,
          },
        ],
      };
      try {
        await expect(repository.save(installation)).resolves.toEqual(installation);
        await expect(repository.get(scope, installation.id)).resolves.toEqual(installation);
        await expect(
          repository.get({ ...scope, tenantId: 'tenant-b' }, installation.id),
        ).resolves.toBeNull();
      } finally {
        await repository.close();
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      }
    });
  });
} else {
  describe.skip('PostgreSQL repository conformance', () => {
    it('requires GRIDSTORY_TEST_POSTGRES_URL', () => undefined);
  });
  describe.skip('PostgreSQL plugin repository conformance', () => {
    it('requires GRIDSTORY_TEST_POSTGRES_URL', () => undefined);
  });
}
