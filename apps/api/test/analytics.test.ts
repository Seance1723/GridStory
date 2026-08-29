import type { AnalyticsEvidence } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const managementHeaders = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'default',
  'x-gridstory-environment': 'development',
  'x-gridstory-actor': 'analytics-admin',
  'x-gridstory-roles': 'admin',
};
const deliveryHeaders = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'default',
  'x-gridstory-environment': 'development',
  'x-gridstory-actor': 'anonymous',
  'x-gridstory-roles': 'anonymous',
};

describe('analytics HTTP workflow', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('ingests minimized events, honors GPC, delivers adapters, and protects aggregate reports', async () => {
    const delivered: AnalyticsEvidence[] = [];
    server = await buildServer({
      databasePath: ':memory:',
      analytics: {
        purposeId: 'analytics',
        adapters: [
          {
            id: 'test-destination',
            async deliver(evidence) {
              delivered.push(evidence);
            },
          },
        ],
      },
    });
    const published = (
      await server.inject({
        method: 'GET',
        url: '/api/v1/content?contentType=page&perspective=published',
        headers: managementHeaders,
      })
    ).json()[0];
    const event = {
      id: '018daf23-89b3-7cf8-a4f1-94064c96df90',
      name: 'component.viewed',
      occurredAt: new Date().toISOString(),
      content: {
        id: published.id,
        contentType: published.contentType,
        revisionId: published.publishedRevisionId,
      },
      component: { id: 'hero', version: 2, nodeId: 'hero-primary' },
      consent: { purposeId: 'analytics', granted: true, globalPrivacyControl: false },
    };

    const accepted = await server.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      headers: deliveryHeaders,
      payload: event,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers['cache-control']).toBe('private, no-store');
    expect(accepted.json()).toEqual({ accepted: true, eventId: event.id });

    const suppressed = await server.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      headers: { ...deliveryHeaders, 'sec-gpc': '1' },
      payload: { ...event, id: '018daf23-89b3-7cf8-a4f1-94064c96df91' },
    });
    expect(suppressed.statusCode).toBe(200);
    expect(suppressed.json()).toEqual({ accepted: false, reason: 'global-privacy-control' });

    const unsafe = await server.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      headers: deliveryHeaders,
      payload: { ...event, id: '018daf23-89b3-7cf8-a4f1-94064c96df92', url: '/private' },
    });
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json()).toMatchObject({ error: { code: 'invalid_analytics_event' } });

    const unpublished = await server.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      headers: deliveryHeaders,
      payload: {
        ...event,
        id: '018daf23-89b3-7cf8-a4f1-94064c96df93',
        content: { ...event.content, revisionId: 'draft-or-stale-revision' },
      },
    });
    expect(unpublished.statusCode).toBe(409);
    expect(unpublished.json()).toMatchObject({ error: { code: 'analytics_content_unpublished' } });

    const deniedReport = await server.inject({
      method: 'GET',
      url: '/api/v1/analytics/report',
      headers: deliveryHeaders,
    });
    expect(deniedReport.statusCode).toBe(403);

    await server.inject({
      method: 'POST',
      url: '/api/v1/operations/drain',
      headers: managementHeaders,
      payload: { limit: 25 },
    });
    expect(delivered).toEqual([]);
    await server.inject({
      method: 'POST',
      url: '/api/v1/operations/drain',
      headers: managementHeaders,
      payload: { limit: 25 },
    });
    expect(delivered).toHaveLength(4);
    expect(
      delivered.filter(
        (evidence) => evidence.kind === 'event' && evidence.event.name === 'content.created',
      ),
    ).toHaveLength(2);
    expect(
      delivered
        .filter((evidence) => evidence.kind === 'event')
        .map((evidence) => evidence.event.name),
    ).toEqual(expect.arrayContaining(['content.created', 'content.published', 'component.viewed']));
    expect(
      delivered.find((evidence) => evidence.kind === 'event' && evidence.event.id === event.id),
    ).toMatchObject({
      kind: 'event',
      event: { id: event.id, source: 'browser', component: { id: 'hero' } },
    });

    const report = await server.inject({
      method: 'GET',
      url: '/api/v1/analytics/report',
      headers: managementHeaders,
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      eventCounts: { 'component.viewed': 1 },
      components: [{ componentId: 'hero', version: 2, views: 1 }],
      adapterDeliveries: [{ adapterId: 'test-destination', succeeded: 4, dead: 0 }],
    });
    expect(report.json()).not.toHaveProperty('receipts');

    const isolated = await server.inject({
      method: 'GET',
      url: '/api/v1/analytics/report',
      headers: { ...managementHeaders, 'x-gridstory-tenant': 'other-tenant' },
    });
    expect(isolated.json()).toMatchObject({
      eventCounts: { 'component.viewed': 0 },
      components: [],
      adapterDeliveries: [{ adapterId: 'test-destination', succeeded: 0 }],
    });
  });
});
