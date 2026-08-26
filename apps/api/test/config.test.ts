import { describe, expect, it } from 'vitest';
import { createLocalTopology } from '@gridstory/core';
import { loadConfig } from '../src/config.js';

describe('API configuration', () => {
  it('keeps Studio discovery opt-in and validates topology without echoing raw JSON', () => {
    expect(loadConfig({}).studioTopology).toBeUndefined();
    const topology = createLocalTopology();
    topology.locales = loadConfig({}).locales;
    expect(
      loadConfig({ GRIDSTORY_STUDIO_TOPOLOGY_JSON: JSON.stringify(topology) }).studioTopology,
    ).toEqual(topology);
    for (const value of [
      '',
      'private-invalid-json',
      '{}',
      JSON.stringify({ ...topology, credentials: 'do-not-echo' }),
    ]) {
      expect(() => loadConfig({ GRIDSTORY_STUDIO_TOPOLOGY_JSON: value })).toThrow(
        /GRIDSTORY_STUDIO_TOPOLOGY_JSON/,
      );
      try {
        loadConfig({ GRIDSTORY_STUDIO_TOPOLOGY_JSON: value });
      } catch (error) {
        expect(String(error)).not.toMatch(/private-invalid-json|do-not-echo/);
      }
    }
  });
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

  it('loads bounded data-placement attestation regions', () => {
    expect(loadConfig({}).dataRegions).toEqual(['local']);
    expect(
      loadConfig({ GRIDSTORY_DATA_REGIONS: 'eu-west-1, europe-west1,eu-west-1' }).dataRegions,
    ).toEqual(['eu-west-1', 'europe-west1']);
    expect(() => loadConfig({ GRIDSTORY_DATA_REGIONS: '../outside' })).toThrow(
      /GRIDSTORY_DATA_REGIONS/,
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

  it('loads explicit production identity and validates trusted federation adapters', () => {
    const provider = {
      id: 'workforce',
      protocol: 'oidc',
      issuer: 'https://identity.example.test',
      clientId: 'gridstory',
      clientSecret: 'from-secret-manager',
      redirectUri: 'https://cms.example.test/api/v1/identity/federation/workforce/callback',
      groupClaim: 'roles',
    };
    expect(
      loadConfig({
        GRIDSTORY_IDENTITY_MODE: 'production',
        GRIDSTORY_FEDERATION_PROVIDERS_JSON: JSON.stringify([provider]),
        GRIDSTORY_WEBAUTHN_RP_ID: 'cms.example.test',
        GRIDSTORY_WEBAUTHN_ORIGINS: 'https://cms.example.test',
      }).identity,
    ).toEqual({
      mode: 'production',
      federationProviders: [provider],
      webAuthn: {
        rpName: 'GridStory',
        rpId: 'cms.example.test',
        origins: ['https://cms.example.test'],
      },
      cookieName: 'gridstory_session',
      secureCookies: true,
    });
    expect(() =>
      loadConfig({
        GRIDSTORY_FEDERATION_PROVIDERS_JSON: JSON.stringify([
          { id: 'broken', protocol: 'oidc', issuer: 'https://identity.example.test' },
        ]),
      }),
    ).toThrow(/clientId/);
    expect(() => loadConfig({ GRIDSTORY_IDENTITY_MODE: 'production' })).toThrow(
      /requires at least one federation provider/,
    );
    expect(() =>
      loadConfig({
        GRIDSTORY_IDENTITY_MODE: 'production',
        GRIDSTORY_FEDERATION_PROVIDERS_JSON: JSON.stringify([provider]),
        GRIDSTORY_WEBAUTHN_RP_ID: 'cms.example.test',
        GRIDSTORY_WEBAUTHN_ORIGINS: 'https://cms.example.test',
        GRIDSTORY_IDENTITY_SECURE_COOKIES: 'false',
      }),
    ).toThrow(/requires secure identity cookies/);
  });
});
