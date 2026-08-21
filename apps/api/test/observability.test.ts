import { createServer } from 'node:http';
import { once } from 'node:events';
import { tenantTelemetryEvent } from '@gridstory/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  probeCollector,
  startObservability,
  tenantTelemetryAttributes,
} from '../src/observability.js';
import { buildServer } from '../src/server.js';

const scope = {
  organizationId: 'organization-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  siteId: 'site-a',
  environmentId: 'development',
  locale: 'en',
};

describe('OpenTelemetry operations boundary', () => {
  const originalEnvironment = {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    traces: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    metrics: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    logs: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries({
      OTEL_EXPORTER_OTLP_ENDPOINT: originalEnvironment.endpoint,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: originalEnvironment.traces,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: originalEnvironment.metrics,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: originalEnvironment.logs,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('keeps complete scope in protected records but excludes it from metric dimensions', () => {
    const attributes = tenantTelemetryAttributes(
      tenantTelemetryEvent({
        scope,
        name: 'search.query.completed',
        outcome: 'success',
        operationId: 'operation-a',
        subjectId: 'entry-a',
        metadata: { resultCount: 2 },
      }),
    );
    expect(attributes.record).toMatchObject({
      'gridstory.organization.id': 'organization-a',
      'gridstory.tenant.id': 'tenant-a',
      'gridstory.event.name': 'search.query.completed',
      'gridstory.event.metadata.resultCount': 2,
    });
    expect(attributes.metric).toEqual({
      'gridstory.event.name': 'search.query.completed',
      'gridstory.event.outcome': 'success',
    });
    expect(JSON.stringify(attributes.metric)).not.toContain('tenant-a');
  });

  it('reports bounded Collector health without returning its endpoint or errors', async () => {
    await expect(
      probeCollector('http://collector:13133/', 500, async () => ({ ok: true })),
    ).resolves.toMatchObject({ status: 'healthy' });
    await expect(
      probeCollector('http://collector:13133/', 500, async () => ({ ok: false })),
    ).resolves.toMatchObject({ status: 'degraded', reason: 'collector_unhealthy' });
    const unreachable = await probeCollector('http://collector:13133/', 500, async () => {
      throw new Error('token=secret at internal-host');
    });
    expect(unreachable).toMatchObject({ status: 'degraded', reason: 'collector_unreachable' });
    expect(JSON.stringify(unreachable)).not.toContain('collector:13133');
    expect(JSON.stringify(unreachable)).not.toContain('secret');
  });

  it('exports request, tenant, and worker telemetry over all three OTLP signals', async () => {
    const requests = new Map<string, Buffer[]>();
    const collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.set(request.url ?? '', chunks);
        response.statusCode = 200;
        response.end('{}');
      });
    });
    collector.listen(0, '127.0.0.1');
    await once(collector, 'listening');
    const address = collector.address();
    if (!address || typeof address === 'string')
      throw new Error('Collector test port is unavailable.');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `${baseUrl}/v1/traces`;
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = `${baseUrl}/v1/metrics`;
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = `${baseUrl}/v1/logs`;

    const observability = startObservability({
      enabled: true,
      serviceName: 'gridstory-test',
      serviceVersion: 'test',
      healthCheckUrl: `${baseUrl}/health`,
      healthTimeoutMs: 500,
      metricExportIntervalMs: 1_000,
    });
    const server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      observability,
    });
    try {
      const health = await server.inject({
        method: 'GET',
        url: '/health?token=do-not-export-this',
        headers: { authorization: 'Bearer do-not-export-this' },
      });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: 'ok', service: 'gridstory-api' });
      const forbidden = await server.inject({
        method: 'GET',
        url: '/api/v1/operations/observability',
        headers: {
          'x-gridstory-actor': 'viewer-a',
          'x-gridstory-roles': 'viewer',
          'x-gridstory-tenant': 'tenant-a',
        },
      });
      expect(forbidden.statusCode).toBe(403);
      await observability.tenantTelemetry(
        tenantTelemetryEvent({
          scope,
          name: 'operations.drain.completed',
          outcome: 'success',
          metadata: { claimedJobs: 1 },
        }),
      );
      await observability.runWorkerScope(scope, async () => 'completed');
      await expect(observability.health()).resolves.toMatchObject({
        status: 'healthy',
        collector: { status: 'healthy' },
      });
    } finally {
      await server.close();
      await observability.shutdown();
      collector.close();
      await once(collector, 'close');
    }

    for (const path of ['/v1/traces', '/v1/metrics', '/v1/logs']) {
      expect(Buffer.concat(requests.get(path) ?? []).byteLength).toBeGreaterThan(0);
    }
    const exported = [...requests.values()].flat().map((chunk) => chunk.toString());
    expect(exported.join('')).not.toContain('do-not-export-this');
    expect(Buffer.concat(requests.get('/v1/metrics') ?? []).toString()).not.toContain('tenant-a');
    expect(Buffer.concat(requests.get('/v1/logs') ?? []).toString()).toContain('forbidden');
  });
});
