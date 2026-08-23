import type { LocaleConfiguration } from '@gridstory/schema';
import type { FederationAdapterConfig } from './identity-adapters.js';

export interface ApiConfig {
  host: string;
  port: number;
  databasePath: string;
  databaseUrl?: string;
  allowedOrigins: string[];
  cursorSecret: string;
  previewSigningSecret: string;
  assetDeliverySigningSecret: string;
  allowedPreviewOrigins: string[];
  locales: LocaleConfiguration[];
  webhookSigningSecret: string;
  allowedWebhookHosts?: string[];
  workerIntervalMs: number;
  shutdownTimeoutMs: number;
  dataRegions: string[];
  observability: ObservabilityConfig;
  identity: {
    mode: 'development' | 'production';
    federationProviders: FederationAdapterConfig[];
    webAuthn: { rpName: string; rpId: string; origins: string[] };
    cookieName: string;
    secureCookies: boolean;
  };
}

export interface ObservabilityConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion?: string;
  healthCheckUrl?: string;
  healthTimeoutMs: number;
  metricExportIntervalMs: number;
}

function parseLocales(value: string | undefined): LocaleConfiguration[] {
  if (!value) {
    return [
      {
        code: 'en',
        siteId: 'default',
        label: 'English',
        default: true,
        enabled: true,
        required: true,
        routePrefix: '',
      },
    ];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as LocaleConfiguration[];
  } catch {
    throw new Error('GRIDSTORY_LOCALES_JSON must be a JSON array of locale configurations.');
  }
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '4000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('GRIDSTORY_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function parseWorkerInterval(value: string | undefined): number {
  const interval = Number(value ?? '1000');
  if (!Number.isInteger(interval) || interval < 100 || interval > 60_000) {
    throw new Error('GRIDSTORY_WORKER_INTERVAL_MS must be an integer between 100 and 60000.');
  }
  return interval;
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function parseIdentityMode(value: string | undefined): 'development' | 'production' {
  if (value === undefined || value === '' || value === 'development') return 'development';
  if (value === 'production') return 'production';
  throw new Error('GRIDSTORY_IDENTITY_MODE must be development or production.');
}

function requiredConfigurationString(
  value: Record<string, unknown>,
  name: string,
  index: number,
): string {
  const candidate = value[name];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error(`GRIDSTORY_FEDERATION_PROVIDERS_JSON item ${index} requires ${name}.`);
  }
  return candidate;
}

function parseFederationProviders(value: string | undefined): FederationAdapterConfig[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('GRIDSTORY_FEDERATION_PROVIDERS_JSON must be valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('GRIDSTORY_FEDERATION_PROVIDERS_JSON must be a JSON array.');
  }
  const providers = parsed.map((candidate, index): FederationAdapterConfig => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new Error(`GRIDSTORY_FEDERATION_PROVIDERS_JSON item ${index} must be an object.`);
    }
    const record = candidate as Record<string, unknown>;
    const id = requiredConfigurationString(record, 'id', index);
    const issuer = requiredConfigurationString(record, 'issuer', index);
    if (record.protocol === 'oidc') {
      const scopes = record.scopes;
      if (
        scopes !== undefined &&
        (!Array.isArray(scopes) || scopes.some((item) => typeof item !== 'string'))
      ) {
        throw new Error(`OIDC provider ${id} scopes must be a string array.`);
      }
      return {
        id,
        protocol: 'oidc',
        issuer,
        clientId: requiredConfigurationString(record, 'clientId', index),
        redirectUri: requiredConfigurationString(record, 'redirectUri', index),
        ...(typeof record.clientSecret === 'string' ? { clientSecret: record.clientSecret } : {}),
        ...(scopes ? { scopes: scopes as string[] } : {}),
        ...(typeof record.groupClaim === 'string' ? { groupClaim: record.groupClaim } : {}),
      };
    }
    if (record.protocol === 'saml') {
      return {
        id,
        protocol: 'saml',
        issuer,
        entryPoint: requiredConfigurationString(record, 'entryPoint', index),
        idpCertificate: requiredConfigurationString(record, 'idpCertificate', index),
        serviceProviderIssuer: requiredConfigurationString(record, 'serviceProviderIssuer', index),
        callbackUrl: requiredConfigurationString(record, 'callbackUrl', index),
        ...(typeof record.groupAttribute === 'string'
          ? { groupAttribute: record.groupAttribute }
          : {}),
      };
    }
    throw new Error(`Federation provider ${id} protocol must be oidc or saml.`);
  });
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) {
    throw new Error('Federation provider IDs must be unique.');
  }
  return providers;
}

function parseBoundedInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseHealthCheckUrl(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('GRIDSTORY_OTEL_HEALTHCHECK_URL must be an absolute HTTP(S) URL.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'GRIDSTORY_OTEL_HEALTHCHECK_URL must be an HTTP(S) URL without credentials, query, or fragment.',
    );
  }
  return parsed.href;
}

function parseResourceValue(
  value: string | undefined,
  name: string,
  fallback?: string,
): string | undefined {
  const candidate = value?.trim() || fallback;
  if (candidate === undefined) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(candidate)) {
    throw new Error(`${name} must be a bounded OpenTelemetry resource token.`);
  }
  return candidate;
}

function parseDataRegions(value: string | undefined): string[] {
  const regions = (value ?? 'local')
    .split(',')
    .map((region) => region.trim())
    .filter(Boolean);
  if (
    regions.length === 0 ||
    regions.length > 20 ||
    regions.some((region) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(region))
  ) {
    throw new Error('GRIDSTORY_DATA_REGIONS must contain 1-20 bounded region identifiers.');
  }
  return [...new Set(regions)];
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const allowedOrigins = (
    environment.GRIDSTORY_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0) {
    throw new Error('GRIDSTORY_ALLOWED_ORIGINS must contain at least one origin.');
  }
  const allowedPreviewOrigins = (
    environment.GRIDSTORY_PREVIEW_ALLOWED_ORIGINS ?? 'http://localhost:5174'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedPreviewOrigins.length === 0) {
    throw new Error('GRIDSTORY_PREVIEW_ALLOWED_ORIGINS must contain at least one origin.');
  }
  const databaseUrl = environment.GRIDSTORY_DATABASE_URL?.trim();
  const healthCheckUrl = parseHealthCheckUrl(environment.GRIDSTORY_OTEL_HEALTHCHECK_URL);
  const serviceName = parseResourceValue(
    environment.OTEL_SERVICE_NAME,
    'OTEL_SERVICE_NAME',
    'gridstory-api',
  );
  const serviceVersion = parseResourceValue(
    environment.GRIDSTORY_SERVICE_VERSION,
    'GRIDSTORY_SERVICE_VERSION',
  );
  const identityMode = parseIdentityMode(environment.GRIDSTORY_IDENTITY_MODE);
  const cookieName = environment.GRIDSTORY_IDENTITY_COOKIE_NAME?.trim() || 'gridstory_session';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cookieName)) {
    throw new Error('GRIDSTORY_IDENTITY_COOKIE_NAME must be a bounded cookie token.');
  }
  const webAuthnOrigins = (environment.GRIDSTORY_WEBAUTHN_ORIGINS ?? allowedOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (webAuthnOrigins.length === 0) {
    throw new Error('GRIDSTORY_WEBAUTHN_ORIGINS must contain at least one origin.');
  }
  const federationProviders = parseFederationProviders(
    environment.GRIDSTORY_FEDERATION_PROVIDERS_JSON,
  );
  const webAuthnRpId = environment.GRIDSTORY_WEBAUTHN_RP_ID?.trim() || 'localhost';
  const secureIdentityCookies =
    environment.GRIDSTORY_IDENTITY_SECURE_COOKIES === undefined
      ? identityMode === 'production'
      : parseBoolean(
          environment.GRIDSTORY_IDENTITY_SECURE_COOKIES,
          'GRIDSTORY_IDENTITY_SECURE_COOKIES',
        );
  if (identityMode === 'production') {
    if (federationProviders.length === 0) {
      throw new Error('Production identity mode requires at least one federation provider.');
    }
    if (!secureIdentityCookies) {
      throw new Error('Production identity mode requires secure identity cookies.');
    }
    if (
      webAuthnRpId === 'localhost' ||
      webAuthnOrigins.some((origin) => !origin.startsWith('https://'))
    ) {
      throw new Error(
        'Production identity mode requires a non-local WebAuthn RP ID and HTTPS origins.',
      );
    }
  }
  return {
    host: environment.GRIDSTORY_HOST ?? '127.0.0.1',
    port: parsePort(environment.GRIDSTORY_PORT),
    databasePath: environment.GRIDSTORY_DATABASE_PATH ?? '.gridstory/gridstory.db',
    ...(databaseUrl ? { databaseUrl } : {}),
    allowedOrigins,
    cursorSecret: environment.GRIDSTORY_CURSOR_SECRET ?? 'gridstory-local-cursor-secret-change-me',
    previewSigningSecret:
      environment.GRIDSTORY_PREVIEW_SIGNING_SECRET ??
      'gridstory-local-preview-signing-secret-change-me',
    allowedPreviewOrigins,
    assetDeliverySigningSecret:
      environment.GRIDSTORY_ASSET_DELIVERY_SIGNING_SECRET ??
      'gridstory-local-asset-delivery-secret-change-me',
    locales: parseLocales(environment.GRIDSTORY_LOCALES_JSON),
    webhookSigningSecret:
      environment.GRIDSTORY_WEBHOOK_SIGNING_SECRET ??
      'gridstory-local-webhook-signing-secret-change-me',
    ...(environment.GRIDSTORY_WEBHOOK_ALLOWED_HOSTS?.trim()
      ? {
          allowedWebhookHosts: environment.GRIDSTORY_WEBHOOK_ALLOWED_HOSTS.split(',')
            .map((host) => host.trim())
            .filter(Boolean),
        }
      : {}),
    workerIntervalMs: parseWorkerInterval(environment.GRIDSTORY_WORKER_INTERVAL_MS),
    shutdownTimeoutMs: parseBoundedInteger(
      environment.GRIDSTORY_SHUTDOWN_TIMEOUT_MS,
      'GRIDSTORY_SHUTDOWN_TIMEOUT_MS',
      25_000,
      1_000,
      300_000,
    ),
    dataRegions: parseDataRegions(environment.GRIDSTORY_DATA_REGIONS),
    observability: {
      enabled: parseBoolean(environment.GRIDSTORY_OTEL_ENABLED, 'GRIDSTORY_OTEL_ENABLED'),
      serviceName: serviceName ?? 'gridstory-api',
      ...(serviceVersion ? { serviceVersion } : {}),
      ...(healthCheckUrl ? { healthCheckUrl } : {}),
      healthTimeoutMs: parseBoundedInteger(
        environment.GRIDSTORY_OTEL_HEALTH_TIMEOUT_MS,
        'GRIDSTORY_OTEL_HEALTH_TIMEOUT_MS',
        2_000,
        100,
        10_000,
      ),
      metricExportIntervalMs: parseBoundedInteger(
        environment.OTEL_METRIC_EXPORT_INTERVAL,
        'OTEL_METRIC_EXPORT_INTERVAL',
        60_000,
        1_000,
        300_000,
      ),
    },
    identity: {
      mode: identityMode,
      federationProviders,
      webAuthn: {
        rpName: environment.GRIDSTORY_WEBAUTHN_RP_NAME?.trim() || 'GridStory',
        rpId: webAuthnRpId,
        origins: webAuthnOrigins,
      },
      cookieName,
      secureCookies: secureIdentityCookies,
    },
  };
}
