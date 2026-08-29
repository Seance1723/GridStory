import { describe, expect, it } from 'vitest';
import { configurationInventorySchema } from '../src/configuration-inventory.js';

const readOnly = { ownership: 'operator' as const, mutable: false as const };
const scope = {
  organizationId: 'org',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  siteId: 'site',
  environmentId: 'development',
  locale: 'en',
};
const site = { ...readOnly, id: 'site', label: 'Website' };
const environment = {
  ...readOnly,
  id: 'development',
  label: 'Development',
  kind: 'development' as const,
};
const locale = {
  ...readOnly,
  code: 'en',
  label: 'English',
  default: true,
  required: true,
  routePrefix: '',
  fallbackLocales: [],
};

function inventory() {
  return {
    version: 1 as const,
    scope,
    sections: {
      localesAndEnvironments: {
        availability: 'available' as const,
        ...readOnly,
        coverage: 'configured' as const,
        current: { site, environment, locale },
        environments: [environment],
        locales: [locale],
      },
      modelsAndRoutes: {
        availability: 'available' as const,
        ownership: 'code' as const,
        mutable: false as const,
        models: [
          {
            ownership: 'code' as const,
            mutable: false as const,
            id: 'page',
            name: 'Page',
            version: 1,
            collection: 'pages',
            route: { pattern: '/:slug', slugField: 'slug' },
            localizedFields: ['title'],
          },
        ],
      },
      mediaPolicyAndProviders: {
        availability: 'available' as const,
        ownership: 'code' as const,
        mutable: false as const,
        policy: {
          ownership: 'code' as const,
          mutable: false as const,
          supportedKinds: ['image', 'video', 'file'] as const,
          maximumUploadBytes: 100_000_000,
          uploadPartBytes: 5_242_880,
          maximumDimensionPixels: 16_384,
          maximumParts: 1_000,
          deliveryRequiresVerified: true as const,
          renditionsRequireVerified: true as const,
        },
        providers: [
          { ...readOnly, kind: 'storage' as const, mode: 'built-in-local' as const },
          { ...readOnly, kind: 'content-inspection' as const, mode: 'built-in' as const },
          { ...readOnly, kind: 'rendition' as const, mode: 'unavailable' as const },
          { ...readOnly, kind: 'malware-scanning' as const, mode: 'unavailable' as const },
        ],
      },
    },
  };
}

describe('configuration inventory contract', () => {
  it('accepts the fixed bounded read-only inventory', () => {
    expect(configurationInventorySchema.parse(inventory())).toEqual(inventory());
  });

  it('accepts independently unavailable sections with a fixed reason', () => {
    const value = inventory();
    value.sections.localesAndEnvironments = {
      availability: 'unavailable',
      reason: 'not-authorized',
    } as never;
    expect(configurationInventorySchema.parse(value).sections.localesAndEnvironments).toEqual({
      availability: 'unavailable',
      reason: 'not-authorized',
    });
  });

  it('rejects mutation flags, arbitrary values and provider details', () => {
    const value = inventory();
    const mutable = {
      ...value,
      sections: {
        ...value.sections,
        modelsAndRoutes: {
          ...value.sections.modelsAndRoutes,
          models: value.sections.modelsAndRoutes.models.map((model) => ({
            ...model,
            mutable: true,
          })),
        },
      },
    };
    expect(configurationInventorySchema.safeParse(mutable).success).toBe(false);

    const generic = {
      ...value,
      sections: {
        ...value.sections,
        localesAndEnvironments: {
          ...value.sections.localesAndEnvironments,
          values: { databaseUrl: 'private' },
        },
      },
    };
    expect(configurationInventorySchema.safeParse(generic).success).toBe(false);

    const provider = {
      ...value,
      sections: {
        ...value.sections,
        mediaPolicyAndProviders: {
          ...value.sections.mediaPolicyAndProviders,
          providers: value.sections.mediaPolicyAndProviders.providers.map((item, index) =>
            index === 0 ? { ...item, endpoint: 'https://private.example' } : item,
          ),
        },
      },
    };
    expect(configurationInventorySchema.safeParse(provider).success).toBe(false);
  });

  it('rejects duplicate provider kinds and provider-specific invalid modes', () => {
    const value = inventory();
    const duplicate = {
      ...value,
      sections: {
        ...value.sections,
        mediaPolicyAndProviders: {
          ...value.sections.mediaPolicyAndProviders,
          providers: value.sections.mediaPolicyAndProviders.providers.map((item, index) =>
            index === 1 ? { ...item, kind: 'storage', mode: 'built-in-local' } : item,
          ),
        },
      },
    };
    expect(configurationInventorySchema.safeParse(duplicate).success).toBe(false);

    const invalidMode = {
      ...value,
      sections: {
        ...value.sections,
        mediaPolicyAndProviders: {
          ...value.sections.mediaPolicyAndProviders,
          providers: value.sections.mediaPolicyAndProviders.providers.map((item, index) =>
            index === 0 ? { ...item, mode: 'unavailable' } : item,
          ),
        },
      },
    };
    expect(configurationInventorySchema.safeParse(invalidMode).success).toBe(false);
  });
});
