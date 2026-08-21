import type { LocaleConfiguration } from '@gridstory/schema';

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
  observability: ObservabilityConfig;
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
  };
}
