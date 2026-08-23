import { describe, expect, it } from 'vitest';
import {
  governanceExportEnvelopeSchema,
  governancePolicyInputSchema,
  governanceSnapshotSchema,
  legalHoldInputSchema,
} from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};
const now = '2026-08-23T00:00:00.000Z';

describe('governance contracts', () => {
  it('accepts bounded policy and fully scoped snapshots', () => {
    const policy = governancePolicyInputSchema.parse({
      retentionRules: [
        {
          id: 'personal-content',
          name: 'Personal content',
          resourceType: 'content',
          classification: 'personal',
          retainForDays: 30,
          action: 'delete',
          enabled: true,
        },
      ],
      residencyPolicy: {
        homeRegion: 'eu-west-1',
        requireAttestation: true,
        rules: [
          { resourceType: 'content', allowedRegions: ['eu-west-1'] },
          { resourceType: 'asset', allowedRegions: ['eu-west-1'] },
          { resourceType: 'identity', allowedRegions: ['eu-west-1'] },
          { resourceType: 'plugin', allowedRegions: ['eu-west-1'] },
        ],
      },
    });
    expect(policy.retentionRules[0]?.retainForDays).toBe(30);
    expect(
      governanceSnapshotSchema.parse({
        ...scope,
        version: 0,
        retentionRules: [],
        subjects: [],
        links: [],
        holds: [],
        restrictions: [],
        requests: [],
        plans: [],
        residencyPolicy: {
          ...policy.residencyPolicy,
          updatedBy: 'admin',
          updatedAt: now,
        },
        events: [],
        createdAt: now,
        updatedAt: now,
      }),
    ).toMatchObject(scope);
  });

  it('rejects malformed hold targets and plaintext-looking envelopes', () => {
    expect(() =>
      legalHoldInputSchema.parse({ matter: 'Matter', reason: 'Preserve.', target: { kind: 'x' } }),
    ).toThrow();
    expect(() =>
      governanceExportEnvelopeSchema.parse({
        format: 'gridstory.governance.export.envelope',
        version: 1,
        requestId: 'request-1',
        algorithm: 'A256GCM',
        key: {
          adapter: 'custom',
          keyId: 'key-1',
          expectedRegion: 'local',
        },
        iv: 'short',
        authenticationTag: 'short',
        wrappedDataKey: '',
        ciphertext: '',
        plaintextSha256: 'not-a-digest',
      }),
    ).toThrow();
  });
});
