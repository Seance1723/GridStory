import { describe, expect, it } from 'vitest';
import type { ContentSchemaDefinition, ContentScope, StudioScopeChoice } from '@gridstory/schema';
import { ConfigurationInventoryService } from '../src/configuration-inventory-service.js';

const scope: ContentScope = {
  organizationId: 'org',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'development',
  locale: 'en',
};
const choices: StudioScopeChoice[] = [
  {
    scope,
    labels: { site: 'Website', environment: 'Development', locale: 'English' },
  },
  {
    scope: { ...scope, environmentId: 'production', locale: 'fr' },
    labels: { site: 'Website', environment: 'Production', locale: 'French' },
  },
  {
    scope: { ...scope, siteId: 'other', environmentId: 'private', locale: 'de' },
    labels: { site: 'Private', environment: 'Private', locale: 'German' },
  },
];
const schemas: ContentSchemaDefinition[] = [
  {
    id: 'page',
    version: 2,
    name: 'Page',
    collection: 'pages',
    titleField: 'title',
    fields: [
      { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
      { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
    ],
    localization: { localizedFields: ['slug', 'title'] },
    route: { pattern: '/:slug', slugField: 'slug' },
  },
];

function service() {
  return new ConfigurationInventoryService({
    schemas,
    environments: [
      {
        id: 'production',
        siteId: 'site',
        name: 'Production',
        kind: 'production',
        status: 'active',
      },
      {
        id: 'development',
        siteId: 'site',
        name: 'Development',
        kind: 'development',
        status: 'active',
      },
      { id: 'private', siteId: 'other', name: 'Private', kind: 'preview', status: 'active' },
    ],
    locales: [
      {
        code: 'fr',
        siteId: 'site',
        label: 'French',
        default: false,
        enabled: true,
        fallbackLocale: 'en',
      },
      {
        code: 'en',
        siteId: 'site',
        label: 'English',
        default: true,
        enabled: true,
        required: true,
      },
      { code: 'de', siteId: 'other', label: 'German', default: true, enabled: true },
    ],
    mediaPolicy: {
      maximumUploadBytes: 100_000_000,
      uploadPartBytes: 5_242_880,
      maximumDimensionPixels: 16_384,
      maximumParts: 1_000,
    },
    providers: {
      storage: 'configured',
      contentInspection: 'built-in',
      rendition: 'unavailable',
      malwareScanning: 'configured',
    },
  });
}

describe('ConfigurationInventoryService', () => {
  it('projects deterministic authorized facts and fixed provider modes', () => {
    const inventory = service().read({
      scope,
      selection: { mode: 'configured', choices },
      visibility: {
        localesAndEnvironments: true,
        modelsAndRoutes: true,
        mediaPolicyAndProviders: true,
      },
    });
    expect(inventory.sections.localesAndEnvironments).toMatchObject({
      availability: 'available',
      coverage: 'configured',
      current: {
        site: { id: 'site', label: 'Website', ownership: 'operator', mutable: false },
        environment: { id: 'development', kind: 'development' },
        locale: { code: 'en', default: true, required: true },
      },
      environments: [{ id: 'development' }, { id: 'production' }],
      locales: [{ code: 'en' }, { code: 'fr', fallbackLocales: ['en'] }],
    });
    expect(JSON.stringify(inventory)).not.toContain('Private');
    expect(inventory.sections.modelsAndRoutes).toMatchObject({
      availability: 'available',
      models: [{ id: 'page', localizedFields: ['slug', 'title'] }],
    });
    expect(inventory.sections.mediaPolicyAndProviders).toMatchObject({
      availability: 'available',
      providers: [
        { kind: 'storage', mode: 'configured' },
        { kind: 'content-inspection', mode: 'built-in' },
        { kind: 'rendition', mode: 'unavailable' },
        { kind: 'malware-scanning', mode: 'configured' },
      ],
    });
  });

  it('returns only the current tuple when topology is not declared', () => {
    const inventory = service().read({
      scope,
      selection: { mode: 'current-only', choices: [choices[0] as StudioScopeChoice] },
      visibility: {
        localesAndEnvironments: true,
        modelsAndRoutes: false,
        mediaPolicyAndProviders: false,
      },
    });
    expect(inventory.sections.localesAndEnvironments).toMatchObject({
      availability: 'available',
      coverage: 'current-only',
      environments: [{ id: 'development', kind: 'not-declared' }],
      locales: [{ code: 'en' }],
    });
    expect(inventory.sections.modelsAndRoutes).toEqual({
      availability: 'unavailable',
      reason: 'not-authorized',
    });
  });

  it('fails closed for missing current scope, mismatched configured metadata and excess choices', () => {
    const input = {
      scope,
      visibility: {
        localesAndEnvironments: true,
        modelsAndRoutes: false,
        mediaPolicyAndProviders: false,
      },
    };
    expect(() =>
      service().read({
        ...input,
        selection: { mode: 'configured', choices: choices.slice(1) },
      }),
    ).toThrow('configuration inventory is unavailable');
    expect(() =>
      service().read({
        ...input,
        selection: {
          mode: 'configured',
          choices: [
            choices[0] as StudioScopeChoice,
            {
              scope: { ...scope, environmentId: 'undeclared' },
              labels: { site: 'Website', environment: 'Undeclared', locale: 'English' },
            },
          ],
        },
      }),
    ).toThrow('configuration inventory is unavailable');
    expect(() =>
      service().read({
        ...input,
        selection: {
          mode: 'configured',
          choices: Array.from({ length: 257 }, (_, index) => ({
            scope: { ...scope, environmentId: `environment-${index}` },
            labels: { site: 'Website', environment: `Environment ${index}`, locale: 'English' },
          })),
        },
      }),
    ).toThrow('configuration inventory is unavailable');
  });

  it('does not project denied source sections', () => {
    const inventory = service().read({
      scope,
      selection: { mode: 'current-only', choices: [] },
      visibility: {
        localesAndEnvironments: false,
        modelsAndRoutes: true,
        mediaPolicyAndProviders: false,
      },
    });
    expect(inventory.sections.localesAndEnvironments.availability).toBe('unavailable');
    expect(inventory.sections.modelsAndRoutes.availability).toBe('available');
    expect(inventory.sections.mediaPolicyAndProviders.availability).toBe('unavailable');
  });
});
