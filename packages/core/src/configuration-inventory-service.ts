import {
  configurationInventorySchema,
  type ConfigurationInventory,
  type ContentSchemaDefinition,
  type ContentScope,
  type Environment,
  type LocaleConfiguration,
  type StudioScopeChoice,
  studioScopeChoiceSchema,
} from '@gridstory/schema';
import { GridStoryError } from './errors.js';
import { contentScopeKey } from './tenant-scope.js';

const readOnlyOperator = { ownership: 'operator' as const, mutable: false as const };
const readOnlyCode = { ownership: 'code' as const, mutable: false as const };
const unavailable = { availability: 'unavailable' as const, reason: 'not-authorized' as const };

export interface ConfigurationInventoryMediaPolicy {
  maximumUploadBytes: number;
  uploadPartBytes: number;
  maximumDimensionPixels: number;
  maximumParts: number;
}

export interface ConfigurationInventoryProviderModes {
  storage: 'built-in-local' | 'configured';
  contentInspection: 'built-in' | 'configured';
  rendition: 'configured' | 'unavailable';
  malwareScanning: 'configured' | 'unavailable';
}

export interface ConfigurationInventoryServiceOptions {
  schemas: ContentSchemaDefinition[];
  environments: Environment[];
  locales: LocaleConfiguration[];
  mediaPolicy: ConfigurationInventoryMediaPolicy;
  providers: ConfigurationInventoryProviderModes;
}

export interface ConfigurationInventoryVisibility {
  localesAndEnvironments: boolean;
  modelsAndRoutes: boolean;
  mediaPolicyAndProviders: boolean;
}

export interface ConfigurationInventoryReadInput {
  scope: ContentScope;
  selection: { mode: 'configured' | 'current-only'; choices: StudioScopeChoice[] };
  visibility: ConfigurationInventoryVisibility;
}

function configurationUnavailable(): GridStoryError {
  return new GridStoryError(
    'The configuration inventory is unavailable.',
    'configuration_inventory_unavailable',
    503,
  );
}

function compareIdentity<T extends { id?: string; code?: string }>(left: T, right: T): number {
  return (left.id ?? left.code ?? '').localeCompare(right.id ?? right.code ?? '');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export class ConfigurationInventoryService {
  readonly #schemas: ContentSchemaDefinition[];
  readonly #environments: Environment[];
  readonly #locales: LocaleConfiguration[];
  readonly #mediaPolicy: ConfigurationInventoryMediaPolicy;
  readonly #providers: ConfigurationInventoryProviderModes;

  constructor(options: ConfigurationInventoryServiceOptions) {
    this.#schemas = structuredClone(options.schemas);
    this.#environments = structuredClone(options.environments);
    this.#locales = structuredClone(options.locales);
    this.#mediaPolicy = structuredClone(options.mediaPolicy);
    this.#providers = structuredClone(options.providers);
  }

  #contextSection(scope: ContentScope, selection: ConfigurationInventoryReadInput['selection']) {
    const parsedChoices = studioScopeChoiceSchema.array().max(256).safeParse(selection.choices);
    if (!parsedChoices.success) throw configurationUnavailable();
    const choices = parsedChoices.data.filter(
      ({ scope: choice }) =>
        choice.organizationId === scope.organizationId &&
        choice.tenantId === scope.tenantId &&
        choice.workspaceId === scope.workspaceId &&
        choice.siteId === scope.siteId,
    );
    const current = choices.find(
      ({ scope: choice }) => contentScopeKey(choice) === contentScopeKey(scope),
    );
    if (!current) throw configurationUnavailable();
    if (
      selection.mode === 'current-only' &&
      (choices.length !== 1 ||
        contentScopeKey(choices[0]?.scope ?? scope) !== contentScopeKey(scope))
    )
      throw configurationUnavailable();

    const environmentIds = uniqueSorted(choices.map(({ scope: choice }) => choice.environmentId));
    const localeCodes = uniqueSorted(choices.map(({ scope: choice }) => choice.locale));
    const permittedLocales = new Set(localeCodes);
    const environments = environmentIds.map((id) => {
      const choice = choices.find(({ scope: value }) => value.environmentId === id);
      const metadata =
        selection.mode === 'configured'
          ? this.#environments.find(
              (environment) => environment.siteId === scope.siteId && environment.id === id,
            )
          : undefined;
      if (!choice || (selection.mode === 'configured' && !metadata))
        throw configurationUnavailable();
      return {
        ...readOnlyOperator,
        id,
        label: choice.labels.environment,
        kind: metadata?.kind ?? ('not-declared' as const),
      };
    });
    const locales = localeCodes.map((code) => {
      const choice = choices.find(({ scope: value }) => value.locale === code);
      const metadata = this.#locales.find(
        (locale) => locale.siteId === scope.siteId && locale.code === code && locale.enabled,
      );
      if (!choice || !metadata) throw configurationUnavailable();
      return {
        ...readOnlyOperator,
        code,
        label: choice.labels.locale,
        default: metadata.default,
        required: metadata.required ?? false,
        routePrefix: metadata.routePrefix === '/' ? '' : (metadata.routePrefix ?? ''),
        fallbackLocales: uniqueSorted(
          [
            ...(metadata.fallbackLocales ?? []),
            ...(metadata.fallbackLocale ? [metadata.fallbackLocale] : []),
          ].filter((fallback) => permittedLocales.has(fallback)),
        ),
      };
    });
    const currentEnvironment = environments.find(({ id }) => id === scope.environmentId);
    const currentLocale = locales.find(({ code }) => code === scope.locale);
    if (!currentEnvironment || !currentLocale) throw configurationUnavailable();
    return {
      availability: 'available' as const,
      ...readOnlyOperator,
      coverage: selection.mode,
      current: {
        site: { ...readOnlyOperator, id: scope.siteId, label: current.labels.site },
        environment: currentEnvironment,
        locale: currentLocale,
      },
      environments: environments.sort(compareIdentity),
      locales: locales.sort(compareIdentity),
    };
  }

  #modelsSection() {
    const models = this.#schemas
      .map((schema) => ({
        ...readOnlyCode,
        id: schema.id,
        name: schema.name,
        version: schema.version,
        collection: schema.collection,
        ...(schema.route
          ? { route: { pattern: schema.route.pattern, slugField: schema.route.slugField } }
          : {}),
        localizedFields: uniqueSorted(schema.localization?.localizedFields ?? []),
      }))
      .sort(compareIdentity);
    return {
      availability: 'available' as const,
      ...readOnlyCode,
      models,
    };
  }

  #mediaSection() {
    return {
      availability: 'available' as const,
      ...readOnlyCode,
      policy: {
        ...readOnlyCode,
        supportedKinds: ['image', 'video', 'file'] as const,
        ...this.#mediaPolicy,
        deliveryRequiresVerified: true as const,
        renditionsRequireVerified: true as const,
      },
      providers: [
        { ...readOnlyOperator, kind: 'storage' as const, mode: this.#providers.storage },
        {
          ...readOnlyOperator,
          kind: 'content-inspection' as const,
          mode: this.#providers.contentInspection,
        },
        { ...readOnlyOperator, kind: 'rendition' as const, mode: this.#providers.rendition },
        {
          ...readOnlyOperator,
          kind: 'malware-scanning' as const,
          mode: this.#providers.malwareScanning,
        },
      ],
    };
  }

  read({ scope, selection, visibility }: ConfigurationInventoryReadInput): ConfigurationInventory {
    try {
      return configurationInventorySchema.parse({
        version: 1,
        scope,
        sections: {
          localesAndEnvironments: visibility.localesAndEnvironments
            ? this.#contextSection(scope, selection)
            : unavailable,
          modelsAndRoutes: visibility.modelsAndRoutes ? this.#modelsSection() : unavailable,
          mediaPolicyAndProviders: visibility.mediaPolicyAndProviders
            ? this.#mediaSection()
            : unavailable,
        },
      });
    } catch (error) {
      if (error instanceof GridStoryError) throw error;
      throw configurationUnavailable();
    }
  }
}
