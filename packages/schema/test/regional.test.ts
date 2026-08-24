import { describe, expect, it } from 'vitest';
import {
  regionalDocumentSchema,
  regionalFailoverApprovalInputSchema,
  regionalPolicyInputSchema,
  regionalReadEvidenceSchema,
} from '../src/index.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'production',
  locale: 'en',
};

describe('regional contracts', () => {
  it('requires a bounded unique topology and keeps the disabled default explicit', () => {
    const document = {
      ...scope,
      schemaVersion: 1 as const,
      version: 0,
      state: 'disabled' as const,
      activeControlRegion: 'us-east-1',
      topologyVersion: 1,
      readPolicy: {
        mode: 'primary-only' as const,
        maximumLagMs: 0,
        failureMode: 'primary' as const,
      },
      readRegions: [],
      operations: [],
      updatedBy: 'system',
      updatedAt: '2026-08-24T08:00:00.000Z',
    };
    expect(regionalDocumentSchema.parse(document)).toEqual(document);
    expect(() => regionalDocumentSchema.parse({ ...document, databaseUrl: 'secret' })).toThrow();
    expect(() =>
      regionalDocumentSchema.parse({
        ...document,
        state: 'enabled',
        readPolicy: { mode: 'bounded-staleness', maximumLagMs: 1_000, failureMode: 'primary' },
      }),
    ).toThrow();
  });

  it('accepts only complete-scope replica evidence with the fixed cache partition', () => {
    const evidence = {
      ...scope,
      adapter: 'reader-a',
      servedRegion: 'eu-west-1',
      role: 'replica' as const,
      topologyVersion: 2,
      observedAt: '2026-08-24T08:00:00.000Z',
      lagMs: 250,
      watermark: 'opaque-watermark',
      residencyEvidenceReference: 'placement://read/eu-west-1',
      cachePartition: {
        digest: 'a'.repeat(64),
        dimensions: [
          'scope',
          'served-region',
          'consistency',
          'topology-version',
          'content-revision',
        ] as const,
        attestedAt: '2026-08-24T08:00:00.000Z',
      },
    };
    expect(regionalReadEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(() => regionalReadEvidenceSchema.parse({ ...evidence, tenantId: undefined })).toThrow();
    expect(() => regionalReadEvidenceSchema.parse({ ...evidence, role: 'primary' })).toThrow();
  });

  it('keeps policy and approval inputs strict and optimistic', () => {
    const policy = {
      expectedVersion: 0,
      state: 'enabled' as const,
      activeControlRegion: 'us-east-1',
      activeControlEvidenceReference: 'placement://control/us-east-1',
      readPolicy: {
        mode: 'bounded-staleness' as const,
        maximumLagMs: 5_000,
        failureMode: 'unavailable' as const,
      },
      readRegions: [
        {
          region: 'eu-west-1',
          adapter: 'reader-a',
          enabled: true,
          residencyEvidenceReference: 'placement://read/eu-west-1',
        },
      ],
      failoverAdapter: 'failover-a',
    };
    expect(regionalPolicyInputSchema.parse(policy)).toEqual(policy);
    expect(() =>
      regionalPolicyInputSchema.parse({
        ...policy,
        readRegions: [policy.readRegions[0], policy.readRegions[0]],
      }),
    ).toThrow();
    expect(() =>
      regionalFailoverApprovalInputSchema.parse({
        expectedVersion: 2,
        digest: 'b'.repeat(64),
        reason: 'Reviewed.',
        acceptDataLoss: true,
        executeAutomatically: true,
      }),
    ).toThrow();
  });
});
