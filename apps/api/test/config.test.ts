import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('API configuration', () => {
  it('prefers a trimmed PostgreSQL URL when configured', () => {
    expect(
      loadConfig({
        GRIDSTORY_DATABASE_URL: '  postgresql://gridstory:secret@database/gridstory  ',
      }),
    ).toMatchObject({
      databasePath: '.gridstory/gridstory.db',
      databaseUrl: 'postgresql://gridstory:secret@database/gridstory',
    });
  });

  it('loads distinct preview signing and exact-origin configuration', () => {
    expect(
      loadConfig({
        GRIDSTORY_PREVIEW_SIGNING_SECRET: 'preview-secret-with-at-least-32-characters',
        GRIDSTORY_ASSET_DELIVERY_SIGNING_SECRET:
          'asset-delivery-secret-with-at-least-32-characters',
        GRIDSTORY_PREVIEW_ALLOWED_ORIGINS: ' https://preview.example.test , http://localhost:5174 ',
      }),
    ).toMatchObject({
      previewSigningSecret: 'preview-secret-with-at-least-32-characters',
      assetDeliverySigningSecret: 'asset-delivery-secret-with-at-least-32-characters',
      allowedPreviewOrigins: ['https://preview.example.test', 'http://localhost:5174'],
    });
    expect(() => loadConfig({ GRIDSTORY_PREVIEW_ALLOWED_ORIGINS: '  ' })).toThrow(
      /GRIDSTORY_PREVIEW_ALLOWED_ORIGINS/,
    );
  });

  it('parses locale configuration and rejects malformed environment JSON', () => {
    expect(
      loadConfig({
        GRIDSTORY_LOCALES_JSON: JSON.stringify([
          {
            code: 'fr',
            siteId: 'site',
            label: 'French',
            default: true,
            enabled: true,
          },
        ]),
      }).locales,
    ).toEqual([
      {
        code: 'fr',
        siteId: 'site',
        label: 'French',
        default: true,
        enabled: true,
      },
    ]);
    expect(() => loadConfig({ GRIDSTORY_LOCALES_JSON: '{}' })).toThrow(/GRIDSTORY_LOCALES_JSON/);
  });

  it('validates the durable worker polling interval', () => {
    expect(loadConfig({ GRIDSTORY_WORKER_INTERVAL_MS: '250' }).workerIntervalMs).toBe(250);
    expect(() => loadConfig({ GRIDSTORY_WORKER_INTERVAL_MS: '99' })).toThrow(
      /GRIDSTORY_WORKER_INTERVAL_MS/,
    );
    expect(() => loadConfig({ GRIDSTORY_WORKER_INTERVAL_MS: 'not-a-number' })).toThrow(
      /GRIDSTORY_WORKER_INTERVAL_MS/,
    );
  });

  it('bounds graceful shutdown inside the deployment termination window', () => {
    expect(loadConfig({}).shutdownTimeoutMs).toBe(25_000);
    expect(loadConfig({ GRIDSTORY_SHUTDOWN_TIMEOUT_MS: '45000' }).shutdownTimeoutMs).toBe(45_000);
    expect(() => loadConfig({ GRIDSTORY_SHUTDOWN_TIMEOUT_MS: '999' })).toThrow(
      /GRIDSTORY_SHUTDOWN_TIMEOUT_MS/,
    );
  });

  it('keeps OpenTelemetry disabled by default and validates its bounded configuration', () => {
    expect(loadConfig({}).observability).toEqual({
      enabled: false,
      serviceName: 'gridstory-api',
      healthTimeoutMs: 2_000,
      metricExportIntervalMs: 60_000,
    });
    expect(
      loadConfig({
        GRIDSTORY_OTEL_ENABLED: 'true',
        OTEL_SERVICE_NAME: 'gridstory-worker',
        GRIDSTORY_SERVICE_VERSION: '1.2.3',
        GRIDSTORY_OTEL_HEALTHCHECK_URL: 'http://collector:13133/',
        GRIDSTORY_OTEL_HEALTH_TIMEOUT_MS: '500',
        OTEL_METRIC_EXPORT_INTERVAL: '5000',
      }).observability,
    ).toEqual({
      enabled: true,
      serviceName: 'gridstory-worker',
      serviceVersion: '1.2.3',
      healthCheckUrl: 'http://collector:13133/',
      healthTimeoutMs: 500,
      metricExportIntervalMs: 5_000,
    });
    expect(() => loadConfig({ GRIDSTORY_OTEL_ENABLED: 'yes' })).toThrow(/GRIDSTORY_OTEL_ENABLED/);
    expect(() =>
      loadConfig({ GRIDSTORY_OTEL_HEALTHCHECK_URL: 'https://user:secret@collector/health' }),
    ).toThrow(/without credentials/);
    expect(() => loadConfig({ OTEL_METRIC_EXPORT_INTERVAL: '999' })).toThrow(
      /OTEL_METRIC_EXPORT_INTERVAL/,
    );
    expect(() => loadConfig({ OTEL_SERVICE_NAME: 'service name with spaces' })).toThrow(
      /OTEL_SERVICE_NAME/,
    );
  });
});
