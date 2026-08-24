import { describe, expect, it } from 'vitest';
import {
  analyticsDocumentSchema,
  normalizedAnalyticsEventSchema,
  publicAnalyticsEventInputSchema,
  releaseAnalyticsAnnotationSchema,
} from '../src/index.js';

const content = { id: 'home', contentType: 'page', revisionId: 'revision-1' };
const component = { id: 'hero', version: 2, nodeId: 'hero-primary' };
const occurredAt = '2026-08-24T08:00:00.000Z';

describe('analytics contracts', () => {
  it('accepts only bounded anonymous public content and component events', () => {
    const event = publicAnalyticsEventInputSchema.parse({
      id: '018daf23-89b3-7cf8-a4f1-94064c96df90',
      name: 'component.interacted',
      occurredAt,
      content,
      component,
      interaction: 'primary_cta.activate',
      consent: { purposeId: 'analytics', granted: true },
    });

    expect(event.consent.globalPrivacyControl).toBe(false);
    expect(() =>
      publicAnalyticsEventInputSchema.parse({
        ...event,
        url: 'https://example.test/private?email=person@example.test',
      }),
    ).toThrow();
    expect(() =>
      publicAnalyticsEventInputSchema.parse({ ...event, interaction: 'Clicked the red button!' }),
    ).toThrow();
  });

  it('keeps browser/server normalized variants and release annotations explicit', () => {
    expect(
      normalizedAnalyticsEventSchema.parse({
        organizationId: 'org',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        siteId: 'site',
        environmentId: 'production',
        locale: 'en',
        id: '018daf23-89b3-7cf8-a4f1-94064c96df91',
        name: 'content.published',
        source: 'server',
        occurredAt,
        content,
      }).name,
    ).toBe('content.published');
    expect(
      releaseAnalyticsAnnotationSchema.parse({
        organizationId: 'org',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        siteId: 'site',
        environmentId: 'production',
        locale: 'en',
        id: '018daf23-89b3-7cf8-a4f1-94064c96df92',
        name: 'release.published',
        releaseId: 'release-1',
        releaseName: 'Homepage launch',
        entryCount: 2,
        occurredAt,
      }).entryCount,
    ).toBe(2);
  });

  it('bounds aggregate dimensions and receipt history', () => {
    expect(() =>
      analyticsDocumentSchema.parse({
        organizationId: 'org',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        siteId: 'site',
        environmentId: 'production',
        locale: 'en',
        version: 1,
        eventCounts: {
          'content.created': 0,
          'content.draft.updated': 0,
          'content.published': 0,
          'content.viewed': 0,
          'component.viewed': 0,
          'component.interacted': 0,
        },
        contents: [],
        components: [],
        releaseAnnotations: [],
        receipts: [],
        truncated: {
          contents: false,
          components: false,
          releaseAnnotations: false,
          receipts: false,
        },
        updatedAt: occurredAt,
        rawEvents: [],
      }),
    ).toThrow();
  });
});
