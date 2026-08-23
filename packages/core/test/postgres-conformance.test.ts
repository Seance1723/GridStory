import {
  type ContentScope,
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  type PluginInstallation,
} from '@gridstory/schema';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CollaborationService,
  emptyMarketplaceDocument,
  EnterpriseIdentityService,
  emptyMigrationDocument,
  GovernanceService,
  PostgresCollaborationRepository,
  PostgresContentRepository,
  PostgresGovernanceRepository,
  PostgresIdentityRepository,
  PostgresMigrationRepository,
  PostgresMarketplaceRepository,
  PostgresPluginRepository,
} from '../src/index.js';
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
  describe('PostgreSQL collaboration repository conformance', () => {
    it('persists a causal document across repository instances', async () => {
      const scope: ContentScope = {
        organizationId: 'organization-a',
        tenantId: `collaboration-${process.pid}`,
        workspaceId: 'workspace-a',
        siteId: 'site-a',
        environmentId: 'development',
        locale: 'en',
      };
      const first = new CollaborationService({
        repository: new PostgresCollaborationRepository({ connectionString }),
      });
      await first.submitOperation({
        scope,
        entryId: 'entry-1',
        actorId: 'author',
        operation: { id: 'operation-1', target: { field: 'title' }, value: 'Persisted' },
      });
      await first.close();

      const second = new CollaborationService({
        repository: new PostgresCollaborationRepository({ connectionString }),
      });
      try {
        await expect(second.snapshot(scope, 'entry-1')).resolves.toMatchObject({
          version: 1,
          operations: [{ id: 'operation-1', value: 'Persisted' }],
        });
      } finally {
        await second.close();
      }
    });
  });
  describe('PostgreSQL identity repository conformance', () => {
    it('persists tenant sessions, mappings, and immediate deprovisioning across instances', async () => {
      const schema = `gridstory_identity_test_${process.pid}_${schemaSequence++}`;
      const pool = new Pool({ connectionString });
      const scope = { organizationId: 'organization-a', tenantId: 'identity-tenant-a' };
      const firstRepository = new PostgresIdentityRepository({ pool, schema });
      const first = new EnterpriseIdentityService({ repository: firstRepository });
      try {
        await first.configureProvider(scope, 'bootstrap', {
          id: 'postgres-oidc',
          protocol: 'oidc',
          issuer: 'https://identity.example.test',
          displayName: 'PostgreSQL OIDC',
          enabled: true,
          allowJitProvisioning: true,
        });
        await first.upsertGroupRoleMapping(scope, 'bootstrap', {
          id: 'postgres-admin-map',
          externalGroup: 'postgres-admins',
          roleId: 'admin',
          createdBy: 'bootstrap',
        });
        const issued = await first.completeFederation(scope, {
          identity: {
            providerId: 'postgres-oidc',
            protocol: 'oidc',
            issuer: 'https://identity.example.test',
            subject: 'postgres-user',
            groups: ['postgres-admins'],
            authenticatedAt: new Date().toISOString(),
            strength: 'multi-factor',
          },
        });
        await firstRepository.close();

        const secondRepository = new PostgresIdentityRepository({ pool, schema });
        const second = new EnterpriseIdentityService({ repository: secondRepository });
        await expect(second.authenticateSession(scope, issued.token)).resolves.toMatchObject({
          principal: { roles: ['admin'] },
        });
        const userId = issued.session.userId;
        if (!userId) throw new Error('Expected a user-backed PostgreSQL session.');
        await second.deprovisionUser(scope, 'scim-client', userId);
        await expect(second.authenticateSession(scope, issued.token)).rejects.toMatchObject({
          code: 'invalid_session',
        });
        await secondRepository.close();
      } finally {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      }
    });
  });
  describe('PostgreSQL governance repository conformance', () => {
    it('persists an optimistic, fully scoped governance document across instances', async () => {
      const schema = `gridstory_governance_test_${process.pid}_${schemaSequence++}`;
      const pool = new Pool({ connectionString });
      const scope: ContentScope = {
        organizationId: 'organization-a',
        tenantId: 'governance-tenant-a',
        workspaceId: 'workspace-a',
        siteId: 'site-a',
        environmentId: 'production',
        locale: 'en',
      };
      const firstRepository = new PostgresGovernanceRepository({ pool, schema });
      const first = new GovernanceService({ repository: firstRepository });
      try {
        await first.createSubject(scope, 'privacy-admin', 'postgres-subject');
        await firstRepository.close();

        const secondRepository = new PostgresGovernanceRepository({ pool, schema });
        const second = new GovernanceService({ repository: secondRepository });
        await expect(second.snapshot(scope)).resolves.toMatchObject({
          version: 1,
          subjects: [{ reference: 'postgres-subject', status: 'active' }],
        });
        await expect(
          second.snapshot({ ...scope, tenantId: 'other-tenant' }),
        ).resolves.toMatchObject({
          version: 0,
          subjects: [],
        });
        await secondRepository.close();
      } finally {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      }
    });
  });
  describe('PostgreSQL migration repository conformance', () => {
    it('persists an optimistic migration document under the complete scope key', async () => {
      const schema = `gridstory_migration_test_${process.pid}_${schemaSequence++}`;
      const pool = new Pool({ connectionString });
      const scope: ContentScope = {
        organizationId: 'organization-a',
        tenantId: 'migration-tenant-a',
        workspaceId: 'workspace-a',
        siteId: 'site-a',
        environmentId: 'migration-shadow',
        locale: 'en',
      };
      const first = new PostgresMigrationRepository({ pool, schema });
      try {
        const initial = emptyMigrationDocument(scope, '2026-08-23T00:00:00.000Z');
        await first.save(initial, null);
        await first.close();

        const second = new PostgresMigrationRepository({ pool, schema });
        await expect(second.get(scope)).resolves.toEqual(initial);
        await expect(second.get({ ...scope, tenantId: 'other-tenant' })).resolves.toBeNull();
        await expect(second.listScopes()).resolves.toContainEqual(scope);

        const next = {
          ...initial,
          version: 1,
          updatedAt: '2026-08-23T00:01:00.000Z',
        };
        await second.save(next, 0);
        await expect(second.save(next, 0)).rejects.toMatchObject({
          code: 'migration_write_conflict',
        });
        await second.close();
      } finally {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await pool.end();
      }
    });
  });
  describe('PostgreSQL marketplace repository conformance', () => {
    it('persists an optimistic marketplace document under the complete scope key', async () => {
      const schema = `gridstory_marketplace_test_${process.pid}_${schemaSequence++}`;
      const pool = new Pool({ connectionString });
      const scope: ContentScope = {
        organizationId: 'organization-a',
        tenantId: 'marketplace-tenant-a',
        workspaceId: 'workspace-a',
        siteId: 'site-a',
        environmentId: 'marketplace-review',
        locale: 'en',
      };
      const first = new PostgresMarketplaceRepository({ pool, schema });
      try {
        const initial = emptyMarketplaceDocument(scope, '2026-08-23T00:00:00.000Z');
        await first.save(initial, null);
        await first.close();

        const second = new PostgresMarketplaceRepository({ pool, schema });
        await expect(second.get(scope)).resolves.toEqual(initial);
        await expect(second.get({ ...scope, tenantId: 'other-tenant' })).resolves.toBeNull();
        await expect(second.listScopes()).resolves.toContainEqual(scope);

        const next = {
          ...initial,
          version: 1,
          updatedAt: '2026-08-23T00:01:00.000Z',
        };
        await second.save(next, 0);
        await expect(second.save(next, 0)).rejects.toMatchObject({
          code: 'marketplace_write_conflict',
        });
        await second.close();
      } finally {
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
  describe.skip('PostgreSQL collaboration repository conformance', () => {
    it('requires GRIDSTORY_TEST_POSTGRES_URL', () => undefined);
  });
  describe.skip('PostgreSQL identity repository conformance', () => {
    it('requires GRIDSTORY_TEST_POSTGRES_URL', () => undefined);
  });
  describe.skip('PostgreSQL governance repository conformance', () => {
    it('requires GRIDSTORY_TEST_POSTGRES_URL', () => undefined);
  });
  describe.skip('PostgreSQL migration repository conformance', () => {
    it('requires GRIDSTORY_TEST_POSTGRES_URL', () => undefined);
  });
  describe.skip('PostgreSQL marketplace repository conformance', () => {
    it('requires GRIDSTORY_TEST_POSTGRES_URL', () => undefined);
  });
}
