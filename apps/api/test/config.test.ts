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
        GRIDSTORY_PREVIEW_ALLOWED_ORIGINS: ' https://preview.example.test , http://localhost:5174 ',
      }),
    ).toMatchObject({
      previewSigningSecret: 'preview-secret-with-at-least-32-characters',
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
});
