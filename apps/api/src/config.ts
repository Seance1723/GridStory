import type { LocaleConfiguration } from '@gridstory/schema';

export interface ApiConfig {
  host: string;
  port: number;
  databasePath: string;
  databaseUrl?: string;
  allowedOrigins: string[];
  cursorSecret: string;
  previewSigningSecret: string;
  allowedPreviewOrigins: string[];
  locales: LocaleConfiguration[];
  webhookSigningSecret: string;
  allowedWebhookHosts?: string[];
  workerIntervalMs: number;
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
  };
}
