// @vitest-environment jsdom

import {
  type AiAuthoringDocument,
  type AiGatewayDocument,
  type AssetRecord,
  type AssetUploadSession,
  type ContentEntry,
  type ContentFederationDocument,
  type ConfigurationInventory,
  createGridStoryClient,
  type EditorialOverview,
  type ExperimentDesign,
  type ExperimentMetricSnapshotInput,
  type ExperimentOverview,
  type FleetDocument,
  type KnowledgeDocument,
  type MarketplaceOverviewRecord,
  type MigrationCutoverReport,
  type MigrationPlanSummary,
  type MigrationProjectSummary,
  type MigrationRecipe,
  type MigrationRun,
  type MigrationSourceDescriptor,
  type PersonalizationSnapshot,
  type RegionalDocument,
  type Release,
} from '@gridstory/client';
import * as previewClient from '@gridstory/client/preview';
import { exampleDesignSystem } from '@gridstory/example-kit/design-system';
import { componentManifests } from '@gridstory/example-kit/manifests';
import {
  type ContentFilter,
  type ContentQuery,
  type ContentSchemaDefinition,
  type StudioContext,
  type StudioOperation,
  studioOperations,
  studioDestinations as studioScreens,
} from '@gridstory/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

const schema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  collection: 'pages',
  titleField: 'headline',
  fields: [
    {
      id: 'page.headline',
      name: 'headline',
      label: 'Headline',
      type: 'text',
      required: true,
    },
    {
      id: 'page.path',
      name: 'path',
      label: 'Path',
      type: 'slug',
      required: true,
    },
    {
      id: 'page.sections',
      name: 'sections',
      label: 'Sections',
      type: 'component-tree',
      required: true,
      minimum: 1,
    },
  ],
};

const now = '2026-07-17T00:00:00.000Z';
const initialWindowWidth = window.innerWidth;

function entry(id: string, headline: string, path: string): ContentEntry {
  return {
    id,
    tenantId: 'default',
    contentType: 'page',
    status: 'draft',
    draftRevisionId: `${id}-revision-1`,
    createdAt: now,
    updatedAt: now,
    data: {
      headline,
      path,
      sections: [
        {
          id: `${id}-hero-a`,
          component: 'gridstory.hero',
          version: 1,
          props: { eyebrow: 'One', heading: 'First hero', body: 'Body', tone: 'indigo' },
        },
        {
          id: `${id}-hero-b`,
          component: 'gridstory.hero',
          version: 1,
          props: { eyebrow: 'Two', heading: 'Second hero', body: 'Body', tone: 'forest' },
        },
      ],
    },
  };
}

const entries = [entry('one', 'First page', 'first'), entry('two', 'Second page', 'second')];

function managedAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    id: 'managed-hero',
    kind: 'image',
    currentRevisionId: 'managed-hero-v1',
    revisions: [
      {
        id: 'managed-hero-v1',
        version: 1,
        original: {
          objectKey: 'assets/managed-hero.jpg',
          url: 'https://cdn.example.test/managed-hero.jpg',
          filename: 'managed-hero.jpg',
          mediaType: 'image/jpeg',
          size: 4096,
          checksum: 'managed-checksum',
          width: 1200,
          height: 800,
        },
        metadata: {
          title: 'Managed hero',
          alt: 'Managed alt',
          tags: ['homepage'],
          collections: [],
          custom: {},
        },
        focalPoint: { x: 0.25, y: 0.75 },
        createdAt: now,
        security: {
          status: 'verified',
          declaredMediaType: 'image/jpeg',
          detectedMediaType: 'image/jpeg',
          sanitized: false,
          inspectedAt: now,
          malware: { status: 'clean', provider: 'test-scanner', checkedAt: now },
          findings: [],
        },
        actorId: 'asset-author',
      },
    ],
    renditions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const articleSchema: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  collection: 'articles',
  titleField: 'headline',
  fields: [
    {
      id: 'article.headline',
      name: 'headline',
      label: 'Article headline',
      type: 'text',
      required: true,
    },
    { id: 'article.slug', name: 'slug', label: 'Article slug', type: 'slug', required: true },
    { id: 'article.body', name: 'body', label: 'Article body', type: 'rich-text', required: true },
    {
      id: 'article.related-pages',
      name: 'relatedPages',
      label: 'Related pages',
      type: 'relation',
      targets: ['page'],
      multiple: true,
      maximum: 3,
    },
  ],
};
const articleEntry: ContentEntry = {
  ...entry('article-one', 'Ignored page label', 'ignored'),
  contentType: 'article',
  data: {
    headline: 'First article',
    slug: 'first-article',
    body: { version: 1, blocks: [] },
    relatedPages: [],
  },
};
const componentTreeField = schema.fields.find((field) => field.type === 'component-tree');
if (!componentTreeField) throw new Error('Test schema must include a component tree.');

const authoringSchema: ContentSchemaDefinition = {
  ...schema,
  fields: [
    ...schema.fields.slice(0, 2),
    {
      id: 'page.story',
      name: 'story',
      label: 'Editorial story',
      type: 'rich-text',
      allowedBlocks: ['paragraph', 'heading', 'list', 'quote', 'code', 'table'],
    },
    {
      id: 'page.social-image',
      name: 'socialImage',
      label: 'Social image',
      type: 'asset',
      accepts: ['image'],
      requiredAlt: true,
    },
    {
      id: 'page.related-pages',
      name: 'relatedPages',
      label: 'Related pages',
      type: 'relation',
      targets: ['page'],
      multiple: true,
      maximum: 2,
    },
    componentTreeField,
  ],
};

const authoringEntries = entries.map((candidate) => ({
  ...candidate,
  data: {
    ...candidate.data,
    story: { version: 1, blocks: [] },
    relatedPages: [],
  },
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createTestClient(
  options: {
    context?: StudioContext;
    schema?: ContentSchemaDefinition;
    schemas?: ContentSchemaDefinition[];
    entries?: ContentEntry[];
    assets?: AssetRecord[];
    queryFailsAfter?: number;
    overview?: EditorialOverview;
    inventory?: ConfigurationInventory;
  } = {},
) {
  const testSchema = options.schema ?? schema;
  const testSchemas = options.schemas ?? [testSchema];
  const testEntries = options.entries ?? entries;
  const testAssets = options.assets ?? [];
  let contentQueryCount = 0;
  const threads: Array<Record<string, unknown>> = [];
  const presence = [{ actorId: 'local-admin', displayName: 'Studio editor', lastSeenAt: now }];
  const operations: Array<Record<string, unknown>> = [];
  const branches: Array<Record<string, unknown>> = [
    {
      id: 'main',
      entryId: testEntries[0]?.id ?? 'entry-1',
      name: 'Main',
      status: 'open',
      baseOperationIds: [],
      operationIds: [],
      headOperationIds: [],
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    },
  ];
  const suggestions: Array<Record<string, unknown>> = [];
  const merges: Array<Record<string, unknown>> = [];
  const conflicts: Array<Record<string, unknown>> = [];
  let collaborationVersion = 0;
  const governanceSubjects: Array<Record<string, unknown>> = [];
  const governanceHolds: Array<Record<string, unknown>> = [];
  const governancePlans: Array<Record<string, unknown>> = [];
  let governanceVersion = 0;
  const governanceSnapshot = () => ({
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    version: governanceVersion,
    retentionRules: [],
    subjects: governanceSubjects,
    links: [],
    holds: governanceHolds,
    restrictions: [],
    requests: [],
    plans: governancePlans,
    residencyPolicy: {
      homeRegion: 'local',
      requireAttestation: true,
      rules: [
        { resourceType: 'content', allowedRegions: ['local'] },
        { resourceType: 'asset', allowedRegions: ['local'] },
        { resourceType: 'identity', allowedRegions: ['local'] },
        { resourceType: 'plugin', allowedRegions: ['local'] },
      ],
      updatedBy: 'system',
      updatedAt: now,
    },
    events: [],
    createdAt: now,
    updatedAt: now,
  });
  const collaborationSnapshot = (entryId: string) => ({
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    entryId,
    version: collaborationVersion,
    threads,
    presence,
    operations,
    branches,
    branchStates: branches.map((candidate) => ({
      branchId: candidate.id,
      version: (candidate.operationIds as string[]).length,
      headOperationIds: candidate.headOperationIds,
      values: [],
    })),
    suggestions,
    merges,
    conflicts,
  });
  let workflowDefinition = {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    id: 'page-editorial',
    name: 'Editorial review',
    contentType: 'page',
    version: 1,
    initialStateId: 'draft',
    states: [
      { id: 'draft', label: 'Draft', kind: 'draft', terminal: false },
      { id: 'in-review', label: 'In review', kind: 'review', terminal: false },
      { id: 'approved', label: 'Approved', kind: 'approved', terminal: false },
      { id: 'published', label: 'Published', kind: 'published', terminal: false },
    ],
    transitions: [
      {
        id: 'submit-review',
        label: 'Submit for review',
        from: 'draft',
        to: 'in-review',
        allowedRoles: ['admin'],
        actions: [],
      },
      {
        id: 'approve',
        label: 'Request approval',
        from: 'in-review',
        to: 'approved',
        allowedRoles: ['admin'],
        actions: [],
        approval: {
          minimumApprovals: 1,
          allowedRoles: ['admin'],
          separationOfDuties: true,
          escalateToRoles: ['admin'],
          fields: [],
          locales: [],
        },
      },
      {
        id: 'publish',
        label: 'Publish',
        from: 'approved',
        to: 'published',
        allowedRoles: ['admin'],
        actions: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const releaseRecords: Release[] = [];
  const editorialOverview = (): EditorialOverview =>
    options.overview ?? {
      version: 1,
      scope: options.context?.scope ?? {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
      },
      generatedAt: now,
      widgets: {
        content: {
          availability: 'available',
          coverage: 'all-registered',
          exact: true,
          bounds: {
            totalCount: testEntries.length,
            displayedCount: Math.min(testEntries.length, 5),
            limit: 5,
            hasMore: testEntries.length > 5,
          },
          states: {
            draft: testEntries.filter(({ status }) => status === 'draft').length,
            changed: testEntries.filter(({ status }) => status === 'changed').length,
            published: testEntries.filter(({ status }) => status === 'published').length,
          },
          recent: testEntries.slice(0, 5).map((candidate) => ({
            id: candidate.id,
            contentType: candidate.contentType,
            title:
              typeof candidate.data.headline === 'string' ? candidate.data.headline : candidate.id,
            status: candidate.status,
            updatedAt: candidate.updatedAt,
            destination: candidate.contentType === 'page' ? 'pages' : 'collections',
          })),
        },
        reviews: {
          availability: 'available',
          coverage: 'all-registered',
          exact: true,
          bounds: { totalCount: 0, displayedCount: 0, limit: 5, hasMore: false },
          items: [],
        },
        releases: {
          availability: 'available',
          exact: true,
          bounds: {
            totalCount: releaseRecords.length,
            displayedCount: Math.min(releaseRecords.length, 5),
            limit: 5,
            hasMore: releaseRecords.length > 5,
          },
          items: releaseRecords.slice(0, 5).map((release) => ({
            id: release.id,
            name: release.name,
            state: release.state,
            updatedAt: release.updatedAt,
            ...(release.schedule ? { runAt: release.schedule.runAt } : {}),
            destination: 'releases',
          })),
        },
        operations: { availability: 'unavailable' },
      },
    };
  const configurationInventory = (): ConfigurationInventory =>
    options.inventory ?? {
      version: 1,
      scope: options.context?.scope ?? {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
      },
      sections: {
        localesAndEnvironments: { availability: 'unavailable', reason: 'not-authorized' },
        modelsAndRoutes: {
          availability: 'available',
          ownership: 'code',
          mutable: false,
          models: testSchemas.map((candidate) => ({
            ownership: 'code',
            mutable: false,
            id: candidate.id,
            name: candidate.name,
            version: candidate.version,
            collection: candidate.collection,
            ...(candidate.route ? { route: candidate.route } : {}),
            localizedFields: candidate.localization?.localizedFields ?? [],
          })),
        },
        mediaPolicyAndProviders: { availability: 'unavailable', reason: 'not-authorized' },
      },
    };
  const workflowActionRecords: Array<Record<string, unknown>> = [];
  const migrationSources: MigrationSourceDescriptor[] = [
    {
      id: 'contentful-source',
      provider: 'contentful',
      name: 'Contentful production',
      supportsDelta: true,
      reportsDeletions: true,
      includesAssets: true,
    },
  ];
  const migrationRecipes: MigrationRecipe[] = [];
  const migrationProjects: MigrationProjectSummary[] = [];
  const migrationPlans: MigrationPlanSummary[] = [];
  const migrationRuns: MigrationRun[] = [];
  const migrationCutoverReports: MigrationCutoverReport[] = [];
  const marketplaceOverview: MarketplaceOverviewRecord = {
    publishers: [
      {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        id: 'example',
        displayName: 'Example publisher',
        domain: 'example.com',
        websiteUrl: 'https://example.com',
        supportUrl: 'https://support.example.com',
        key: {
          keyId: 'release-1',
          algorithm: 'ed25519',
          fingerprint: 'a'.repeat(64),
        },
        state: 'verified',
        domainVerifiedAt: now,
        verifiedAt: now,
        verifiedBy: 'publisher-reviewer',
        verificationEvidenceReference: 'publisher-review:123',
        verificationReason: 'Domain and accountable owner reviewed.',
        createdAt: now,
        createdBy: 'publisher-owner',
        updatedAt: now,
      },
    ],
    releases: [
      {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        id: 'com.example.marketplace@1.0.0',
        pluginId: 'com.example.marketplace',
        publisherId: 'example',
        version: '1.0.0',
        manifest: {
          format: 'gridstory.plugin',
          manifestVersion: 1,
          id: 'com.example.marketplace',
          name: 'Marketplace plugin',
          description: 'Reviewed marketplace fixture.',
          version: '1.0.0',
          publisher: { id: 'example', name: 'Example publisher' },
          sdk: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
          package: { sha256: 'b'.repeat(64), sizeBytes: 2_048 },
          runtimes: { server: { isolation: 'external', protocolVersion: 1 } },
          requestedCapabilities: [{ capability: 'content.read' }],
          operations: ['summarize'],
          marketplace: {
            categories: ['authoring'],
            keywords: ['editorial'],
            homepageUrl: 'https://example.com/plugin',
            documentationUrl: 'https://docs.example.com/plugin',
            repositoryUrl: 'https://code.example.com/plugin',
            compatibility: {
              gridstory: { minVersion: '0.0.0', maxVersionExclusive: '1.0.0' },
              testedRuntimes: [
                {
                  runtime: 'node',
                  version: '22.14.0',
                  testedAt: now,
                  evidenceUrl: 'https://ci.example.com/runs/123',
                },
              ],
            },
            support: {
              status: 'maintained',
              policyUrl: 'https://example.com/support-policy',
              contactUrl: 'https://example.com/support',
            },
          },
          signature: { algorithm: 'ed25519', keyId: 'release-1', value: 'A'.repeat(88) },
        },
        state: 'approved',
        submittedAt: now,
        submittedBy: 'publisher-owner',
        updatedAt: now,
        reviews: [
          {
            id: 'review-1',
            policyVersion: 1,
            status: 'passed',
            manifestDigest: 'c'.repeat(64),
            inspector: { id: 'trusted-scanner', version: '1.0.0' },
            evidenceReference: 'scan:123',
            completedAt: now,
            reviewedBy: 'package-reviewer',
            checks: [
              {
                id: 'signature',
                category: 'signature',
                status: 'passed',
                summary: 'Signature matches the verified publisher key.',
              },
              {
                id: 'permissions',
                category: 'permissions',
                status: 'warning',
                summary: 'Review requested capabilities before enabling.',
              },
            ],
          },
        ],
        approvedAt: now,
        approvedBy: 'release-approver',
        approvalReason: 'Evidence and compatibility reviewed.',
      },
    ],
  };
  let personalizationSnapshot: PersonalizationSnapshot = {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    schemaVersion: 1,
    version: 1,
    draft: {
      revision: 2,
      configuration: {
        purposes: [
          {
            id: 'experience-optimization',
            name: 'Experience optimization',
            description: 'Consent for bounded content experimentation.',
            honorGlobalPrivacyControl: true,
          },
        ],
        attributes: [
          {
            key: 'market',
            name: 'Market',
            source: 'market',
            valueType: 'enum',
            allowedValues: ['uk', 'us'],
            classification: 'public',
            requiredPurposes: [],
            cacheability: 'shared',
          },
          {
            key: 'device',
            name: 'Device class',
            source: 'device-class',
            valueType: 'enum',
            allowedValues: ['mobile', 'desktop'],
            classification: 'public',
            requiredPurposes: [],
            cacheability: 'shared',
          },
        ],
        audiences: [
          {
            id: 'uk-visitors',
            name: 'UK visitors',
            description: 'Visitors in the UK market.',
            priority: 10,
            conditions: [{ attributeKey: 'market', operator: 'equals', value: 'uk' }],
          },
        ],
        decisions: [
          {
            resourceKey: 'homepage-hero',
            name: 'Homepage hero',
            variants: ['default', 'uk'],
            rules: [{ audienceId: 'uk-visitors', variant: 'uk' }],
            fallbackVariant: 'default',
          },
        ],
      },
      updatedAt: now,
      updatedBy: 'targeting-author',
    },
    published: {
      revision: 2,
      configuration: {
        purposes: [
          {
            id: 'experience-optimization',
            name: 'Experience optimization',
            description: 'Consent for bounded content experimentation.',
            honorGlobalPrivacyControl: true,
          },
        ],
        attributes: [
          {
            key: 'market',
            name: 'Market',
            source: 'market',
            valueType: 'enum',
            allowedValues: ['uk', 'us'],
            classification: 'public',
            requiredPurposes: [],
            cacheability: 'shared',
          },
          {
            key: 'device',
            name: 'Device class',
            source: 'device-class',
            valueType: 'enum',
            allowedValues: ['mobile', 'desktop'],
            classification: 'public',
            requiredPurposes: [],
            cacheability: 'shared',
          },
        ],
        audiences: [
          {
            id: 'uk-visitors',
            name: 'UK visitors',
            description: 'Visitors in the UK market.',
            priority: 10,
            conditions: [{ attributeKey: 'market', operator: 'equals', value: 'uk' }],
          },
        ],
        decisions: [
          {
            resourceKey: 'homepage-hero',
            name: 'Homepage hero',
            variants: ['default', 'uk'],
            rules: [{ audienceId: 'uk-visitors', variant: 'default' }],
            fallbackVariant: 'default',
          },
        ],
      },
      updatedAt: now,
      updatedBy: 'targeting-author',
      publishedAt: now,
      publishedBy: 'targeting-publisher',
    },
    experiments: [],
    createdAt: now,
    updatedAt: now,
  };
  let experimentOverview: ExperimentOverview = {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    version: personalizationSnapshot.version,
    targetingDraftRevision: personalizationSnapshot.draft.revision,
    targetingPublishedRevision: 2,
    experiments: [],
  };
  let aiGateway: AiGatewayDocument = {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    schemaVersion: 1,
    version: 0,
    state: 'disabled',
    models: [],
    budgets: {
      dailyRequests: 100,
      dailyInputTokens: 200_000,
      dailyOutputTokens: 50_000,
      dailyCostMicros: 10_000_000,
    },
    promptVersions: [],
    activePrompts: [],
    dailyUsage: [],
    receipts: [],
    stateEvents: [],
    updatedAt: now,
  };
  let aiAuthoring: AiAuthoringDocument = {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    schemaVersion: 1,
    version: 0,
    state: 'disabled',
    actions: [],
    semantic: { enabled: false },
    proposals: [],
    updatedAt: now,
  };
  const workflowInstances = new Map(
    testEntries.map((candidate) => [
      candidate.id,
      {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        entryId: candidate.id,
        contentType: candidate.contentType,
        workflowId: `${candidate.contentType}-editorial`,
        workflowVersion: 1,
        stateId: 'draft',
        revisionId: candidate.draftRevisionId,
        schedules: [],
        notifications: [],
        history: [],
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/studio/context') {
      const requestedHeaders = new Headers(init?.headers);
      const requestedChoice = options.context?.selection.choices.find(
        ({ scope }) =>
          scope.siteId === requestedHeaders.get('x-gridstory-site') &&
          scope.environmentId === requestedHeaders.get('x-gridstory-environment') &&
          scope.locale === requestedHeaders.get('x-gridstory-locale'),
      );
      return json(
        options.context
          ? { ...options.context, ...(requestedChoice ? { scope: requestedChoice.scope } : {}) }
          : {
              version: 1,
              scope: {
                organizationId: 'local',
                tenantId: 'default',
                workspaceId: 'default',
                siteId: 'default',
                environmentId: 'development',
                locale: 'en',
              },
              principalId: 'local-admin',
              capabilities: {
                screens: Object.fromEntries(
                  studioScreens.map((screen) => [screen, screen !== 'home']),
                ),
                operations: Object.fromEntries(
                  studioOperations.map((operation) => [operation, operation !== 'home.read']),
                ),
              },
              selection: { mode: 'current-only', choices: [] },
            },
      );
    }
    if (url.pathname === '/api/v1/editorial/overview') return json(editorialOverview());
    if (url.pathname === '/api/v1/configuration/inventory') return json(configurationInventory());
    const schemaSource = {
      format: 'gridstory.schema-ir',
      irVersion: 1,
      schemas: testSchemas,
      components: componentManifests,
    };
    if (url.pathname === '/api/v1/schema-lifecycle/drift') {
      return json({
        inSync: true,
        sourceFingerprint: 'a'.repeat(64),
        expectedGeneratedTypesFingerprint: 'b'.repeat(64),
        states: [
          {
            source: 'source',
            expectedFingerprint: 'a'.repeat(64),
            actualFingerprint: 'a'.repeat(64),
            status: 'match',
          },
          {
            source: 'deployed',
            expectedFingerprint: 'a'.repeat(64),
            actualFingerprint: 'a'.repeat(64),
            status: 'match',
          },
          {
            source: 'database',
            expectedFingerprint: 'a'.repeat(64),
            actualFingerprint: 'a'.repeat(64),
            status: 'match',
          },
          {
            source: 'generated-types',
            expectedFingerprint: 'b'.repeat(64),
            actualFingerprint: 'b'.repeat(64),
            status: 'match',
          },
        ],
      });
    }
    if (url.pathname === '/api/v1/schema-lifecycle/plan' && init?.method === 'POST') {
      return json({
        plan: {
          id: 'migration-current-source',
          fromFingerprint: 'a'.repeat(64),
          toFingerprint: 'a'.repeat(64),
          approval: { required: false, reasons: [] },
          estimate: { lock: 'none', dataScanRequired: false },
          rollback: { mode: 'automatic', reason: 'No changes.' },
          summary: { safe: 0, backfill: 0, destructive: 0 },
          steps: [],
        },
        impact: {
          scannedEntries: testEntries.length,
          affectedEntries: 0,
          byContentType: {},
          invalidEntries: [],
        },
      });
    }
    if (url.pathname === '/api/v1/schema-lifecycle') {
      return json({
        source: schemaSource,
        visualModel: { format: 'gridstory.visual-model', modelVersion: 1, ir: schemaSource },
        fingerprint: 'a'.repeat(64),
        generatedTypes: 'export interface Page {}',
        generatedTypesFingerprint: 'b'.repeat(64),
        deployment: {
          document: schemaSource,
          fingerprint: 'a'.repeat(64),
          generatedTypes: 'export interface Page {}',
          generatedTypesFingerprint: 'b'.repeat(64),
          deployedAt: now,
          actorId: 'operator',
        },
      });
    }
    if (url.pathname === '/api/v1/schemas') return json(testSchemas);
    if (url.pathname === '/api/v1/components') return json(componentManifests);
    if (url.pathname === '/api/v1/design-system') return json(exampleDesignSystem);
    if (url.pathname === '/api/v1/workflows')
      return json([
        workflowDefinition,
        ...(testSchemas.some((candidate) => candidate.id === 'article')
          ? [
              {
                ...workflowDefinition,
                id: 'article-editorial',
                name: 'Article editorial review',
                contentType: 'article',
              },
            ]
          : []),
      ]);
    if (url.pathname === '/api/v1/workflows/page-editorial' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      workflowDefinition = { ...workflowDefinition, ...body, id: 'page-editorial', updatedAt: now };
      return json(workflowDefinition);
    }
    if (url.pathname === '/api/v1/workflow-actions' && init?.method !== 'POST') {
      return json(workflowActionRecords);
    }
    if (url.pathname === '/api/v1/workflow-actions/drain' && init?.method === 'POST') {
      return json({
        reconciliation: { discovered: 0, reconciled: 0 },
        delivery: {
          claimedOutbox: 0,
          completedOutbox: 0,
          enqueuedJobs: 0,
          claimedJobs: 0,
          completedJobs: 0,
          retriedJobs: 0,
          deadJobs: 0,
        },
      });
    }
    if (url.pathname === '/api/v1/releases' && init?.method !== 'POST') {
      return json(releaseRecords);
    }
    if (url.pathname === '/api/v1/releases' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        name: string;
        entries: Array<{ entryId: string; revisionId: string }>;
        rollbackPolicy: { mode: 'manual' };
      };
      const release: Release = {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        id: `release-${releaseRecords.length + 1}`,
        name: body.name,
        state: 'draft',
        entries: body.entries.map((entry) => ({
          ...entry,
          contentType: 'page',
          previousPublishedRevisionId: null,
        })),
        rollbackPolicy: body.rollbackPolicy,
        createdBy: 'local-admin',
        createdAt: now,
        updatedAt: now,
      };
      releaseRecords.unshift(release);
      return json(release, 201);
    }
    const releaseActionMatch = url.pathname.match(
      /^\/api\/v1\/releases\/([^/]+)\/(validate|preview|schedule|execute|rollback)$/,
    );
    if (releaseActionMatch) {
      const release = releaseRecords.find((candidate) => candidate.id === releaseActionMatch[1]);
      if (!release) return json({ error: { message: 'Not found.' } }, 404);
      const action = releaseActionMatch[2];
      if (action === 'preview') {
        return json({
          releaseId: release.id,
          generatedAt: now,
          validation: release.validation,
          entries: release.entries.map((member) => ({
            ...member,
            data: testEntries.find((entry) => entry.id === member.entryId)?.data ?? {},
            route: `/${String(testEntries.find((entry) => entry.id === member.entryId)?.data.path ?? member.entryId)}`,
          })),
        });
      }
      if (action === 'validate') {
        Object.assign(release, {
          state: 'validated',
          validation: { valid: true, checkedAt: now, issues: [] },
          updatedAt: now,
        });
      }
      if (action === 'execute') Object.assign(release, { state: 'published', executedAt: now });
      if (action === 'rollback')
        Object.assign(release, { state: 'rolled-back', rolledBackAt: now });
      if (action === 'schedule') {
        const body = JSON.parse(String(init?.body)) as { runAt: string; timeZone: string };
        Object.assign(release, {
          state: 'scheduled',
          schedule: {
            ...body,
            requestedBy: 'local-admin',
            requestedByRoles: ['admin'],
            state: 'pending',
            createdAt: now,
          },
        });
      }
      return json(release);
    }
    const workflowMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/workflow$/);
    if (workflowMatch) return json(workflowInstances.get(workflowMatch[1] ?? '') ?? {});
    const workflowTransitionMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/workflow\/transitions\/([^/]+)$/,
    );
    if (workflowTransitionMatch) {
      const instance = workflowInstances.get(workflowTransitionMatch[1] ?? '');
      if (!instance) return json({ error: { message: 'Not found.' } }, 404);
      const transitionId = workflowTransitionMatch[2];
      if (transitionId === 'submit-review') instance.stateId = 'in-review';
      if (transitionId === 'approve') {
        Object.assign(instance, {
          pendingApproval: {
            id: 'approval-1',
            transitionId: 'approve',
            revisionId: instance.revisionId,
            requestedBy: 'local-admin',
            requestedByRoles: ['admin'],
            requestedAt: now,
            changedFields: ['headline'],
            decisions: [],
          },
        });
      }
      return json(instance);
    }
    const workflowApprovalMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/workflow\/approvals\/([^/]+)$/,
    );
    if (workflowApprovalMatch) {
      const instance = workflowInstances.get(workflowApprovalMatch[1] ?? '');
      if (!instance) return json({ error: { message: 'Not found.' } }, 404);
      instance.stateId = 'approved';
      delete (instance as typeof instance & { pendingApproval?: unknown }).pendingApproval;
      return json(instance);
    }
    const assetUsageMatch = url.pathname.match(/^\/api\/v1\/assets\/([^/]+)\/usage$/);
    if (assetUsageMatch) {
      return json({
        assetId: assetUsageMatch[1],
        totalReferences: 2,
        entries: 1,
        byPerspective: { draft: 1, published: 1 },
        locations: [],
      });
    }
    if (url.pathname === '/api/v1/assets') return json(testAssets);
    const componentMigrationMatch = url.pathname.match(
      /^\/api\/v1\/components\/([^/]+)\/migration$/,
    );
    if (componentMigrationMatch) {
      const componentId = decodeURIComponent(componentMigrationMatch[1] ?? '');
      const component = componentManifests.find((candidate) => candidate.id === componentId);
      if (!component) return json({ error: { message: 'Component not found.' } }, 404);
      const isHero = componentId === 'gridstory.hero';
      return json({
        id: 'component_migration_test',
        component,
        usage: {
          componentId,
          currentVersion: component.version,
          totalInstances: isHero ? 4 : 0,
          entries: isHero ? 2 : 0,
          byPerspective: { draft: isHero ? 4 : 0, published: 0 },
          byVersion: isHero ? { '1': 4 } : {},
          locations: [],
        },
        outdatedInstances: 0,
        unmigratableVersions: [],
        ready: true,
      });
    }
    const componentVisualMatch = url.pathname.match(
      /^\/api\/v1\/components\/([^/]+)\/visual-regression$/,
    );
    if (componentVisualMatch) {
      const componentId = decodeURIComponent(componentVisualMatch[1] ?? '');
      const component = componentManifests.find((candidate) => candidate.id === componentId);
      if (!component) return json({ error: { message: 'Component not found.' } }, 404);
      return json({
        id: 'visual_regression_test',
        componentId,
        version: component.version,
        scenarios: component.visualRegression.scenarios,
        usageHooks: [],
        selector: `[data-gridstory-component="${componentId}"][data-gridstory-version="${component.version}"]`,
      });
    }
    if (url.pathname.startsWith('/api/v1/preview/sessions')) {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json(
        {
          token: 'gsp_test-token',
          sessionId: 'preview-session-1',
          previewUrl: 'http://localhost:5174/',
          origin: 'http://localhost:5174',
          protocolVersion: 1,
          expiresAt: '2026-07-23T12:00:00.000Z',
        },
        201,
      );
    }
    if (url.pathname === '/api/v1/search' && init?.method === 'POST') {
      return json({
        hits: [{ entry: testEntries[1], score: 4, highlights: ['second'], taxonomies: {} }],
        facets: [],
        total: 1,
      });
    }
    if (url.pathname === '/api/v1/taxonomies') {
      return json([
        {
          id: 'topics',
          name: 'Topics',
          hierarchical: true,
          terms: [{ id: 'product', slug: 'product', label: 'Product' }],
        },
        {
          id: 'article-topics',
          name: 'Article topics',
          hierarchical: false,
          terms: [{ id: 'product-news', slug: 'product-news', label: 'Product news' }],
        },
      ]);
    }
    if (url.pathname === '/api/v1/search/index/status') {
      return json({
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        adapter: 'repository-scan',
        state: 'ready',
        draftDocuments: 2,
        publishedDocuments: 0,
        pendingJobs: 0,
        deadJobs: 0,
      });
    }
    if (url.pathname === '/api/v1/search/index/rebuild' && init?.method === 'POST') {
      return json({ id: 'rebuild-1', type: 'search.rebuild', state: 'pending' }, 202);
    }
    if (url.pathname === '/api/v1/operations/drain' && init?.method === 'POST') {
      return json({
        claimedOutbox: 0,
        completedOutbox: 0,
        enqueuedJobs: 0,
        claimedJobs: 1,
        completedJobs: 1,
        retriedJobs: 0,
        deadJobs: 0,
      });
    }
    if (/^\/api\/v1\/content\/[^/]+\/backlinks$/.test(url.pathname)) return json([]);
    if (/^\/api\/v1\/content\/[^/]+\/related$/.test(url.pathname)) {
      return json([{ entry: testEntries[1], score: 1, reasons: ['same content type'] }]);
    }
    if (url.pathname === '/api/v1/content/query' && init?.method === 'POST') {
      contentQueryCount += 1;
      if (options.queryFailsAfter !== undefined && contentQueryCount > options.queryFailsAfter)
        return json({ error: { message: 'Content list unavailable.' } }, 503);
      const query = JSON.parse(String(init.body)) as ContentQuery;
      const valueAt = (candidate: ContentEntry, path: string): unknown =>
        path
          .split('.')
          .reduce<unknown>(
            (value, segment) =>
              value && typeof value === 'object'
                ? (value as Record<string, unknown>)[segment]
                : undefined,
            candidate,
          );
      const matches = (candidate: ContentEntry, filter: ContentFilter): boolean => {
        if ('and' in filter) return filter.and.every((nested) => matches(candidate, nested));
        if ('or' in filter) return filter.or.some((nested) => matches(candidate, nested));
        if ('not' in filter) return !matches(candidate, filter.not);
        const value = valueAt(candidate, filter.path);
        if (filter.operator === 'eq') return value === filter.value;
        if (filter.operator === 'contains')
          return String(value ?? '')
            .toLocaleLowerCase()
            .includes(String(filter.value ?? '').toLocaleLowerCase());
        return true;
      };
      const sort = query.sort?.[0];
      const filtered = testEntries
        .filter((candidate) => !query.contentType || candidate.contentType === query.contentType)
        .filter((candidate) => !query.filter || matches(candidate, query.filter))
        .sort((left, right) => {
          if (!sort) return 0;
          const comparison = String(valueAt(left, sort.path) ?? '').localeCompare(
            String(valueAt(right, sort.path) ?? ''),
          );
          return sort.direction === 'desc' ? -comparison : comparison;
        });
      const offset = Number(query.after ?? 0);
      const page = filtered.slice(offset, offset + (query.first ?? 20));
      const edges = page.map((node, index) => ({ cursor: String(offset + index + 1), node }));
      return json({
        edges,
        nodes: page,
        pageInfo: {
          startCursor: edges[0]?.cursor ?? null,
          endCursor: edges.at(-1)?.cursor ?? null,
          hasNextPage: offset + page.length < filtered.length,
          hasPreviousPage: offset > 0,
        },
        totalCount: filtered.length,
      });
    }
    if (url.pathname === '/api/v1/content') {
      const contentType = url.searchParams.get('contentType');
      return json(
        contentType
          ? testEntries.filter((candidate) => candidate.contentType === contentType)
          : testEntries,
      );
    }
    if (url.pathname === '/api/v1/operations/summary') {
      return json({
        generatedAt: now,
        content: { total: 2, draft: 2, changed: 0, published: 0 },
        outbox: {
          total: 1,
          pending: 1,
          processing: 0,
          succeeded: 0,
          dead: 0,
          truncated: false,
        },
        jobs: {
          total: 1,
          pending: 0,
          processing: 0,
          succeeded: 0,
          dead: 1,
          truncated: false,
        },
        webhooks: { total: 1, active: 1 },
        audit: { valid: true, eventCount: 4, entryCount: 2, failures: [] },
        recentAudit: [],
      });
    }
    if (url.pathname === '/api/v1/analytics/report') {
      return json({
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        version: 3,
        eventCounts: {
          'content.created': 2,
          'content.draft.updated': 1,
          'content.published': 2,
          'content.viewed': 14,
          'component.viewed': 9,
          'component.interacted': 4,
        },
        contents: [],
        components: [],
        releaseAnnotations: [
          {
            organizationId: 'local',
            tenantId: 'default',
            workspaceId: 'default',
            siteId: 'default',
            environmentId: 'development',
            locale: 'en',
            id: '018daf23-89b3-7cf8-a4f1-94064c96df90',
            name: 'release.published',
            releaseId: 'release-1',
            releaseName: 'Homepage launch',
            entryCount: 2,
            occurredAt: now,
          },
        ],
        truncated: {
          contents: false,
          components: false,
          releaseAnnotations: false,
          receipts: false,
        },
        updatedAt: now,
        generatedAt: now,
        adapterDeliveries: [
          {
            adapterId: 'warehouse',
            pending: 0,
            processing: 0,
            succeeded: 3,
            dead: 1,
          },
        ],
        deliveriesTruncated: false,
      });
    }
    if (url.pathname === '/api/v1/ai' && init?.method === undefined) {
      return json(aiGateway);
    }
    if (url.pathname === '/api/v1/ai/policy' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Pick<AiGatewayDocument, 'models' | 'budgets'>;
      aiGateway = {
        ...aiGateway,
        version: aiGateway.version + 1,
        models: body.models,
        budgets: body.budgets,
        updatedAt: now,
      };
      return json(aiGateway);
    }
    if (url.pathname === '/api/v1/ai/prompts' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as AiGatewayDocument['promptVersions'][number];
      aiGateway = {
        ...aiGateway,
        version: aiGateway.version + 1,
        promptVersions: [
          ...aiGateway.promptVersions,
          { ...body, createdBy: 'studio-local-admin', createdAt: now },
        ],
        updatedAt: now,
      };
      return json(aiGateway, 201);
    }
    const aiActivationMatch = url.pathname.match(
      /^\/api\/v1\/ai\/prompts\/([^/]+)\/versions\/(\d+)\/activate$/,
    );
    if (aiActivationMatch && init?.method === 'POST') {
      aiGateway = {
        ...aiGateway,
        version: aiGateway.version + 1,
        activePrompts: [
          {
            promptId: decodeURIComponent(aiActivationMatch[1] ?? ''),
            version: Number(aiActivationMatch[2]),
          },
        ],
        updatedAt: now,
      };
      return json(aiGateway);
    }
    if (url.pathname === '/api/v1/ai/kill-switch' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        state: 'enabled' | 'disabled';
        reason: string;
      };
      aiGateway = {
        ...aiGateway,
        version: aiGateway.version + 1,
        state: body.state,
        stateEvents: [
          ...aiGateway.stateEvents,
          {
            state: body.state,
            actorId: 'studio-local-admin',
            reason: body.reason,
            occurredAt: now,
          },
        ],
        updatedAt: now,
      };
      return json(aiGateway);
    }
    if (url.pathname === '/api/v1/ai/generate' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        requestId: string;
        promptId: string;
        providerId: string;
        modelId: string;
      };
      aiGateway = {
        ...aiGateway,
        version: aiGateway.version + 1,
        dailyUsage: [
          { day: '2026-07-17', requests: 1, inputTokens: 14, outputTokens: 8, costMicros: 80 },
        ],
        updatedAt: now,
      };
      return json({
        ...body,
        promptVersion: 1,
        output: 'A bounded editorial summary.',
        trust: 'untrusted',
        sources: [],
        usage: { requests: 1, inputTokens: 14, outputTokens: 8, costMicros: 80 },
        redactions: { credentials: 0, emails: 0, phones: 0, ips: 0 },
        finishReason: 'stop',
      });
    }
    if (url.pathname === '/api/v1/ai/authoring' && init?.method === undefined) {
      return json(aiAuthoring);
    }
    if (url.pathname === '/api/v1/ai/authoring/policy' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Pick<
        AiAuthoringDocument,
        'state' | 'actions' | 'semantic'
      >;
      aiAuthoring = {
        ...aiAuthoring,
        version: aiAuthoring.version + 1,
        state: body.state,
        actions: body.actions,
        semantic: body.semantic,
        updatedAt: now,
      };
      return json(aiAuthoring);
    }
    if (url.pathname === '/api/v1/ai/authoring/proposals' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        actionId: string;
        targetEntryId: string;
        expectedDraftRevisionId: string;
        request: { requestId: string; providerId: string; modelId: string };
      };
      aiAuthoring = {
        ...aiAuthoring,
        version: aiAuthoring.version + 1,
        proposals: [
          ...aiAuthoring.proposals,
          {
            id: '018daf23-89b3-7cf8-a4f1-94064c96df99',
            status: 'pending-review',
            action: {
              id: body.actionId,
              name: 'Improve title',
              enabled: true,
              promptId: 'content-summary',
              contentType: 'page',
              targetFields: ['headline'],
              maximumChanges: 1,
              evaluationRules: [],
              documentVersion: aiAuthoring.version,
            },
            target: {
              entryId: body.targetEntryId,
              contentType: 'page',
              revisionId: body.expectedDraftRevisionId,
            },
            changes: [
              {
                fieldPath: 'headline',
                value: 'AI reviewed headline',
                rationale: 'Clearer.',
              },
            ],
            evaluation: {
              outcome: 'passed',
              results: [
                {
                  ruleId: 'gridstory:content-schema',
                  fieldPath: 'document',
                  kind: 'content-schema',
                  outcome: 'passed',
                  message: 'The complete candidate passed the content schema.',
                },
              ],
            },
            provenance: {
              requestId: body.request.requestId,
              outputContract: 'gridstory.authoring-suggestions.v1',
              promptId: 'content-summary',
              promptVersion: 1,
              providerId: body.request.providerId,
              modelId: body.request.modelId,
              sources: [],
              usage: { requests: 1, inputTokens: 12, outputTokens: 8, costMicros: 80 },
              redactions: { credentials: 0, emails: 0, phones: 0, ips: 0 },
              finishReason: 'stop',
              actorId: 'studio-local-admin',
              createdAt: now,
            },
            reviews: [],
          },
        ],
        updatedAt: now,
      };
      return json(aiAuthoring, 201);
    }
    const aiReviewMatch = url.pathname.match(
      /^\/api\/v1\/ai\/authoring\/proposals\/([^/]+)\/review$/,
    );
    if (aiReviewMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        decision: 'approved' | 'rejected';
        reason?: string;
      };
      aiAuthoring = {
        ...aiAuthoring,
        version: aiAuthoring.version + 1,
        proposals: aiAuthoring.proposals.map((proposal) =>
          proposal.id === aiReviewMatch[1]
            ? {
                ...proposal,
                status: body.decision,
                reviews: [
                  {
                    decision: body.decision,
                    actorId: 'studio-local-admin',
                    occurredAt: now,
                    ...(body.reason ? { reason: body.reason } : {}),
                  },
                ],
              }
            : proposal,
        ),
        updatedAt: now,
      };
      return json(aiAuthoring);
    }
    if (url.pathname === '/api/v1/ai/semantic/search' && init?.method === 'POST') {
      return json({
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        perspective: 'draft',
        adapterId: 'semantic-test',
        modelId: 'embedding-small',
        indexVersion: 'index-1',
        hits: [],
      });
    }
    if (url.pathname === '/api/v1/governance' && init?.method !== 'POST') {
      return json(governanceSnapshot());
    }
    if (url.pathname === '/api/v1/governance/subjects' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { reference: string };
      const subject = {
        id: `subject-${governanceSubjects.length + 1}`,
        reference: body.reference,
        status: 'active',
        createdBy: 'studio-local-admin',
        createdAt: now,
        updatedAt: now,
      };
      governanceSubjects.push(subject);
      governanceVersion += 1;
      return json(subject, 201);
    }
    if (url.pathname === '/api/v1/governance/holds' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const hold = {
        id: `hold-${governanceHolds.length + 1}`,
        ...body,
        status: 'active',
        createdBy: 'studio-local-admin',
        createdAt: now,
      };
      governanceHolds.push(hold);
      governanceVersion += 1;
      return json(hold, 201);
    }
    if (url.pathname === '/api/v1/governance/retention/plans' && init?.method === 'POST') {
      const plan = {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        id: `plan-${governancePlans.length + 1}`,
        kind: 'retention',
        state: 'preview',
        documentVersion: governanceVersion + 1,
        candidates: [
          {
            id: 'candidate-1',
            resource: { type: 'content', id: 'one', external: false },
            action: 'delete',
            state: 'eligible',
            blockers: [],
            expectedVersion: 'one-revision-1',
          },
        ],
        digest: 'a'.repeat(64),
        createdBy: 'studio-local-admin',
        createdAt: now,
      };
      governancePlans.push(plan);
      governanceVersion += 1;
      return json(plan, 201);
    }
    if (url.pathname === '/api/v1/migrations' && init?.method !== 'POST') {
      return json({
        sources: migrationSources,
        recipes: migrationRecipes,
        projects: migrationProjects,
        plans: migrationPlans,
        runs: migrationRuns,
        cutoverReports: migrationCutoverReports,
      });
    }
    if (url.pathname === '/api/v1/marketplace' && init?.method !== 'POST') {
      return json(marketplaceOverview);
    }
    if (url.pathname === '/api/v1/experiments' && init?.method !== 'POST') {
      return json(experimentOverview);
    }
    const experimentDraftMatch = url.pathname.match(/^\/api\/v1\/experiments\/([^/]+)$/);
    if (experimentDraftMatch && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as {
        expectedVersion: number;
        design: ExperimentDesign;
      };
      const experimentId = decodeURIComponent(experimentDraftMatch[1] ?? '');
      const existing = experimentOverview.experiments.find(({ id }) => id === experimentId);
      const experiment: ExperimentOverview['experiments'][number] = {
        ...body.design,
        state: 'draft',
        revision: (existing?.revision ?? 0) + 1,
        metricSnapshots: existing?.metricSnapshots ?? [],
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? 'studio-local-admin',
        updatedAt: now,
        updatedBy: 'studio-local-admin',
      };
      experimentOverview = {
        ...experimentOverview,
        version: experimentOverview.version + 1,
        experiments: [
          ...experimentOverview.experiments.filter(({ id }) => id !== experimentId),
          experiment,
        ],
      };
      return json(experimentOverview);
    }
    const experimentTransitionMatch = url.pathname.match(
      /^\/api\/v1\/experiments\/([^/]+)\/transition$/,
    );
    if (experimentTransitionMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        action: 'start' | 'pause' | 'resume' | 'complete' | 'cancel';
        reason: string;
      };
      const experimentId = decodeURIComponent(experimentTransitionMatch[1] ?? '');
      const current = experimentOverview.experiments.find(({ id }) => id === experimentId);
      if (!current) return json({ error: 'not_found' }, 404);
      const state =
        body.action === 'start' || body.action === 'resume'
          ? 'running'
          : body.action === 'pause'
            ? 'paused'
            : body.action === 'complete'
              ? 'completed'
              : 'cancelled';
      const experiment: ExperimentOverview['experiments'][number] = {
        ...current,
        state,
        revision: current.revision + 1,
        ...(body.action === 'start'
          ? {
              targetingRevision: 2,
              startedAt: now,
              startedBy: 'studio-local-admin',
            }
          : {}),
        ...(body.action === 'pause'
          ? { pausedAt: now, pausedBy: 'studio-local-admin', pauseReason: body.reason }
          : {}),
        ...(body.action === 'complete'
          ? {
              completedAt: now,
              completedBy: 'studio-local-admin',
              completionReason: body.reason,
            }
          : {}),
        ...(body.action === 'cancel'
          ? {
              cancelledAt: now,
              cancelledBy: 'studio-local-admin',
              cancellationReason: body.reason,
            }
          : {}),
        updatedAt: now,
        updatedBy: 'studio-local-admin',
      };
      experimentOverview = {
        ...experimentOverview,
        version: experimentOverview.version + 1,
        experiments: experimentOverview.experiments.map((candidate) =>
          candidate.id === experimentId ? experiment : candidate,
        ),
      };
      return json(experimentOverview);
    }
    const experimentMetricsMatch = url.pathname.match(/^\/api\/v1\/experiments\/([^/]+)\/metrics$/);
    if (experimentMetricsMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { snapshot: ExperimentMetricSnapshotInput };
      const experimentId = decodeURIComponent(experimentMetricsMatch[1] ?? '');
      const current = experimentOverview.experiments.find(({ id }) => id === experimentId);
      if (!current) return json({ error: 'not_found' }, 404);
      const experiment: ExperimentOverview['experiments'][number] = {
        ...current,
        revision: current.revision + 1,
        metricSnapshots: [
          ...current.metricSnapshots,
          { ...body.snapshot, recordedAt: now, recordedBy: 'studio-local-admin' },
        ],
        lastGuardrailEvaluation: {
          snapshotId: body.snapshot.id,
          status: 'passed',
          reasons: [],
          evaluatedAt: now,
        },
        updatedAt: now,
        updatedBy: 'studio-local-admin',
      };
      experimentOverview = {
        ...experimentOverview,
        version: experimentOverview.version + 1,
        experiments: experimentOverview.experiments.map((candidate) =>
          candidate.id === experimentId ? experiment : candidate,
        ),
      };
      return json(experimentOverview);
    }
    const experimentPromotionMatch = url.pathname.match(
      /^\/api\/v1\/experiments\/([^/]+)\/promote$/,
    );
    if (experimentPromotionMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        snapshotId: string;
        winnerVariant: string;
        reason: string;
      };
      const experimentId = decodeURIComponent(experimentPromotionMatch[1] ?? '');
      const current = experimentOverview.experiments.find(({ id }) => id === experimentId);
      if (!current) return json({ error: 'not_found' }, 404);
      const snapshot = current.metricSnapshots.find(({ id }) => id === body.snapshotId);
      const experiment: ExperimentOverview['experiments'][number] = {
        ...current,
        state: 'promoted',
        revision: current.revision + 1,
        promotion: {
          winnerVariant: body.winnerVariant,
          snapshotId: body.snapshotId,
          evidenceDigest: snapshot?.evidenceDigest ?? '0'.repeat(64),
          reason: body.reason,
          promotedAt: now,
          promotedBy: 'studio-local-admin',
          targetingDraftRevision: experimentOverview.targetingDraftRevision + 1,
        },
        updatedAt: now,
        updatedBy: 'studio-local-admin',
      };
      experimentOverview = {
        ...experimentOverview,
        version: experimentOverview.version + 1,
        targetingDraftRevision: experimentOverview.targetingDraftRevision + 1,
        experiments: experimentOverview.experiments.map((candidate) =>
          candidate.id === experimentId ? experiment : candidate,
        ),
      };
      return json(experimentOverview);
    }
    if (url.pathname === '/api/v1/personalization' && init?.method !== 'POST') {
      return json(personalizationSnapshot);
    }
    if (url.pathname === '/api/v1/personalization/draft' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as {
        configuration: PersonalizationSnapshot['draft']['configuration'];
      };
      personalizationSnapshot = {
        ...personalizationSnapshot,
        version: personalizationSnapshot.version + 1,
        draft: {
          revision: personalizationSnapshot.draft.revision + 1,
          configuration: body.configuration,
          updatedAt: now,
          updatedBy: 'targeting-author',
        },
        updatedAt: now,
      };
      return json(personalizationSnapshot);
    }
    if (url.pathname === '/api/v1/personalization/publish' && init?.method === 'POST') {
      personalizationSnapshot = {
        ...personalizationSnapshot,
        version: personalizationSnapshot.version + 1,
        published: {
          ...personalizationSnapshot.draft,
          publishedAt: now,
          publishedBy: 'targeting-publisher',
        },
        updatedAt: now,
      };
      return json(personalizationSnapshot);
    }
    if (url.pathname === '/api/v1/personalization/preview' && init?.method === 'POST') {
      return json({
        resourceKey: 'homepage-hero',
        variant: 'uk',
        audienceId: 'uk-visitors',
        reason: 'matched',
        draftRevision: personalizationSnapshot.draft.revision,
        cache: {
          mode: 'no-store',
          tag: 'personalization:local:default:r2',
          inputs: ['market'],
          reason: 'Draft preview decisions must never enter a cache.',
        },
        trace: [
          {
            audienceId: 'uk-visitors',
            matched: true,
            conditions: [{ attributeKey: 'market', matched: true, reason: 'matched' }],
          },
        ],
      });
    }
    if (
      url.pathname === '/api/v1/marketplace/releases/com.example.marketplace%401.0.0/install' &&
      init?.method === 'POST'
    ) {
      return json({ id: 'installation-1', state: 'disabled' }, 201);
    }
    const migrationRecipeMatch = url.pathname.match(/^\/api\/v1\/migrations\/recipes\/([^/]+)$/);
    if (migrationRecipeMatch && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Omit<MigrationRecipe, 'id'>;
      const previous = migrationRecipes.find(
        (candidate) => candidate.id === migrationRecipeMatch[1],
      );
      const recipe: MigrationRecipe = {
        ...body,
        id: migrationRecipeMatch[1] ?? 'recipe',
        version: (previous?.version ?? 0) + 1,
        createdBy: previous?.createdBy ?? 'local-admin',
        createdAt: previous?.createdAt ?? now,
        updatedBy: 'local-admin',
        updatedAt: now,
      };
      if (previous) migrationRecipes.splice(migrationRecipes.indexOf(previous), 1, recipe);
      else migrationRecipes.push(recipe);
      return json(recipe);
    }
    if (url.pathname === '/api/v1/migrations/projects' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        id: string;
        name: string;
        sourceId: string;
        recipeIds: string[];
        mode: 'one-time' | 'dual-run';
      };
      const project: MigrationProjectSummary = {
        ...body,
        provider: 'contentful',
        state: 'active',
        version: 1,
        recipeVersions: Object.fromEntries(body.recipeIds.map((id) => [id, 1])),
        createdBy: 'local-admin',
        createdAt: now,
        updatedBy: 'local-admin',
        updatedAt: now,
      };
      migrationProjects.push(project);
      return json(project, 201);
    }
    const migrationProjectStateMatch = url.pathname.match(
      /^\/api\/v1\/migrations\/projects\/([^/]+)\/state$/,
    );
    if (migrationProjectStateMatch && init?.method === 'POST') {
      const project = migrationProjects.find(
        (candidate) => candidate.id === migrationProjectStateMatch[1],
      );
      if (!project) return json({ error: { message: 'Not found.' } }, 404);
      const body = JSON.parse(String(init.body)) as { state: 'active' | 'paused' };
      project.state = body.state;
      project.version += 1;
      project.updatedAt = now;
      return json(project);
    }
    const migrationProjectPlanMatch = url.pathname.match(
      /^\/api\/v1\/migrations\/projects\/([^/]+)\/plans$/,
    );
    if (migrationProjectPlanMatch && init?.method === 'POST') {
      const project = migrationProjects.find(
        (candidate) => candidate.id === migrationProjectPlanMatch[1],
      );
      if (!project) return json({ error: { message: 'Not found.' } }, 404);
      const plan: MigrationPlanSummary = {
        id: `migration-plan-${migrationPlans.length + 1}`,
        projectId: project.id,
        projectVersion: project.version,
        state: 'preview',
        snapshotKind: 'full',
        effects: [
          {
            externalId: 'contentful-page-1',
            sourceType: 'contentful.Entry.page',
            sourceStatus: 'published',
            sourceChecksum: 'b'.repeat(64),
            action: 'create',
            publish: false,
            recipeId: project.recipeIds[0],
            recipeVersion: 1,
            targetEntryId: 'migration-entry-1',
            dataChecksum: 'c'.repeat(64),
            blockers: [],
          },
        ],
        counts: { create: 1, update: 0, publish: 0, noop: 0, sourceDeleted: 0, blocked: 0 },
        digest: 'd'.repeat(64),
        createdBy: 'local-admin',
        createdAt: now,
        expiresAt: '2026-07-17T01:00:00.000Z',
      };
      migrationPlans.push(plan);
      return json(plan, 201);
    }
    const migrationPlanExecutionMatch = url.pathname.match(
      /^\/api\/v1\/migrations\/plans\/([^/]+)\/execute$/,
    );
    if (migrationPlanExecutionMatch && init?.method === 'POST') {
      const plan = migrationPlans.find(
        (candidate) => candidate.id === migrationPlanExecutionMatch[1],
      );
      if (!plan) return json({ error: { message: 'Not found.' } }, 404);
      plan.state = 'completed';
      plan.startedAt = now;
      plan.completedAt = now;
      const run: MigrationRun = {
        id: `migration-run-${migrationRuns.length + 1}`,
        projectId: plan.projectId,
        planId: plan.id,
        state: 'succeeded',
        counts: plan.counts,
        actorId: 'local-admin',
        startedAt: now,
        completedAt: now,
      };
      migrationRuns.push(run);
      return json(run);
    }
    const migrationCutoverMatch = url.pathname.match(
      /^\/api\/v1\/migrations\/projects\/([^/]+)\/cutover-reports$/,
    );
    if (migrationCutoverMatch && init?.method === 'POST') {
      const report: MigrationCutoverReport = {
        id: `migration-cutover-${migrationCutoverReports.length + 1}`,
        projectId: migrationCutoverMatch[1] ?? 'project',
        ready: true,
        digest: 'e'.repeat(64),
        sourceDigest: 'f'.repeat(64),
        sourceCount: 1,
        linkedCount: 1,
        currentCount: 1,
        publishedCount: 1,
        blockers: [],
        validatedBy: 'local-admin',
        validatedAt: now,
      };
      migrationCutoverReports.push(report);
      return json(report, 201);
    }
    if (url.pathname === '/api/v1/identity' && init?.method !== 'POST') {
      return json({
        organizationId: 'local',
        tenantId: 'default',
        version: 3,
        providers: [
          {
            organizationId: 'local',
            tenantId: 'default',
            id: 'workforce',
            protocol: 'oidc',
            issuer: 'https://identity.example.test',
            displayName: 'Workforce identity',
            enabled: true,
            allowJitProvisioning: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        users: [],
        groups: [],
        mappings: [],
        sessions: [],
        credentials: [],
        breakGlassAccounts: [],
        policy: {
          idleTtlSeconds: 1_800,
          absoluteTtlSeconds: 28_800,
          reauthenticationSeconds: 1_800,
          maximumConcurrentSessions: 5,
          privilegedStepUpRequired: true,
          breakGlassTtlSeconds: 900,
          maximumFailedBreakGlassAttempts: 5,
        },
        securityEvents: [
          {
            organizationId: 'local',
            tenantId: 'default',
            id: 'identity-event-1',
            sequence: 1,
            action: 'identity.federation.succeeded',
            outcome: 'success',
            actorId: 'admin',
            occurredAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
    }
    if (url.pathname === '/api/v1/identity/directory-credentials' && init?.method === 'POST') {
      return json(
        {
          id: 'directory-credential-1',
          token: 'gsc_directory-credential-1.one-time-secret',
          expiresAt: '2027-07-24T00:00:00.000Z',
        },
        201,
      );
    }
    const collaborationOperationMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/collaboration\/operations$/,
    );
    if (collaborationOperationMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        id?: string;
        branchId?: string;
        target: { field: string; nodeId?: string };
        kind?: string;
        value?: unknown;
      };
      const selectedBranch = branches.find(
        (candidate) => candidate.id === (body.branchId ?? 'main'),
      );
      const id = body.id ?? `operation-${operations.length + 1}`;
      const operation = {
        id,
        entryId: collaborationOperationMatch[1],
        branchId: body.branchId ?? 'main',
        actorId: 'local-admin',
        actorSequence: operations.length + 1,
        dependencies: selectedBranch?.headOperationIds ?? [],
        target: { entryId: collaborationOperationMatch[1], ...body.target },
        kind: body.kind ?? 'set',
        ...(body.value !== undefined ? { value: body.value } : {}),
        createdAt: now,
      };
      operations.push(operation);
      if (selectedBranch) {
        selectedBranch.operationIds = [...(selectedBranch.operationIds as string[]), operation.id];
        selectedBranch.headOperationIds = [operation.id];
        selectedBranch.updatedAt = now;
      }
      collaborationVersion += 1;
      return json(operation, 201);
    }
    const collaborationBranchMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/collaboration\/branches$/,
    );
    if (collaborationBranchMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string; parentBranchId?: string };
      const parent = branches.find((candidate) => candidate.id === (body.parentBranchId ?? 'main'));
      const created = {
        id: `branch-${branches.length}`,
        entryId: collaborationBranchMatch[1],
        name: body.name,
        status: 'open',
        parentBranchId: parent?.id ?? 'main',
        baseOperationIds: [...((parent?.operationIds as string[]) ?? [])],
        operationIds: [...((parent?.operationIds as string[]) ?? [])],
        headOperationIds: [...((parent?.headOperationIds as string[]) ?? [])],
        createdBy: 'local-admin',
        createdAt: now,
        updatedAt: now,
      };
      branches.push(created);
      collaborationVersion += 1;
      return json(created, 201);
    }
    const collaborationSuggestionMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/collaboration\/suggestions$/,
    );
    if (collaborationSuggestionMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        branchId?: string;
        target: { field: string; nodeId?: string };
        value?: unknown;
      };
      const suggestion = {
        id: `suggestion-${suggestions.length + 1}`,
        entryId: collaborationSuggestionMatch[1],
        branchId: body.branchId ?? 'main',
        target: { entryId: collaborationSuggestionMatch[1], ...body.target },
        kind: 'set',
        value: body.value,
        status: 'open',
        createdBy: 'local-admin',
        createdAt: now,
        updatedAt: now,
      };
      suggestions.push(suggestion);
      collaborationVersion += 1;
      return json(suggestion, 201);
    }
    const collaborationSuggestionReviewMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/collaboration\/suggestions\/([^/]+)$/,
    );
    if (collaborationSuggestionReviewMatch && init?.method === 'PATCH') {
      const suggestion = suggestions.find(
        (candidate) => candidate.id === collaborationSuggestionReviewMatch[2],
      );
      const body = JSON.parse(String(init.body)) as { decision: 'accept' | 'reject' };
      if (!suggestion) return json({ error: { message: 'Not found.' } }, 404);
      suggestion.status = body.decision === 'accept' ? 'accepted' : 'rejected';
      suggestion.reviewedBy = 'local-admin';
      suggestion.reviewedAt = now;
      suggestion.updatedAt = now;
      if (body.decision === 'accept') {
        const selectedBranch = branches.find((candidate) => candidate.id === suggestion.branchId);
        const operation = {
          id: `operation-${operations.length + 1}`,
          entryId: collaborationSuggestionReviewMatch[1],
          branchId: suggestion.branchId,
          actorId: 'local-admin',
          actorSequence: operations.length + 1,
          dependencies: selectedBranch?.headOperationIds ?? [],
          target: suggestion.target,
          kind: 'set',
          value: suggestion.value,
          createdAt: now,
        };
        operations.push(operation);
        suggestion.operationId = operation.id;
        if (selectedBranch) {
          selectedBranch.operationIds = [
            ...(selectedBranch.operationIds as string[]),
            operation.id,
          ];
          selectedBranch.headOperationIds = [operation.id];
        }
      }
      collaborationVersion += 1;
      return json(suggestion);
    }
    const collaborationMergeMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/collaboration\/merges$/,
    );
    if (collaborationMergeMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        sourceBranchId: string;
        targetBranchId: string;
      };
      const source = branches.find((candidate) => candidate.id === body.sourceBranchId);
      const target = branches.find((candidate) => candidate.id === body.targetBranchId);
      const sourceOperation = [...operations]
        .reverse()
        .find((candidate) => candidate.branchId === source?.id);
      const targetOperation = [...operations]
        .reverse()
        .find(
          (candidate) =>
            candidate.branchId === target?.id &&
            (candidate.target as { field?: string }).field ===
              (sourceOperation?.target as { field?: string } | undefined)?.field,
        );
      const conflict =
        sourceOperation && targetOperation && sourceOperation.value !== targetOperation.value
          ? {
              id: `conflict-${conflicts.length + 1}`,
              entryId: collaborationMergeMatch[1],
              branchId: body.targetBranchId,
              target: sourceOperation.target,
              variants: [sourceOperation, targetOperation].map((operation) => ({
                operationId: operation.id,
                actorId: operation.actorId,
                branchId: operation.branchId,
                kind: operation.kind,
                value: operation.value,
              })),
              status: 'open',
              createdAt: now,
              updatedAt: now,
            }
          : null;
      if (conflict) conflicts.push(conflict);
      const merge = {
        id: `merge-${merges.length + 1}`,
        entryId: collaborationMergeMatch[1],
        sourceBranchId: body.sourceBranchId,
        targetBranchId: body.targetBranchId,
        status: conflict ? 'conflicted' : 'merged',
        conflictIds: conflict ? [conflict.id] : [],
        createdBy: 'local-admin',
        createdAt: now,
        updatedAt: now,
      };
      merges.push(merge);
      collaborationVersion += 1;
      return json(merge, 201);
    }
    const collaborationConflictMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/collaboration\/conflicts\/([^/]+)$/,
    );
    if (collaborationConflictMatch && init?.method === 'PATCH') {
      const conflict = conflicts.find(
        (candidate) => candidate.id === collaborationConflictMatch[2],
      );
      if (!conflict) return json({ error: { message: 'Not found.' } }, 404);
      conflict.status = 'resolved';
      conflict.updatedAt = now;
      for (const merge of merges.filter((candidate) =>
        (candidate.conflictIds as string[]).includes(String(conflict.id)),
      )) {
        merge.status = 'merged';
      }
      collaborationVersion += 1;
      return json(conflict);
    }
    const collaborationMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/collaboration$/);
    if (collaborationMatch) return json(collaborationSnapshot(collaborationMatch[1] ?? 'entry-1'));
    const presenceMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/presence$/);
    if (presenceMatch) {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json(presence);
    }
    const commentMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/comments$/);
    if (commentMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        target?: { field?: string; nodeId?: string };
        body: string;
        assigneeId?: string;
        dueAt?: string;
      };
      const thread = {
        id: `thread-${threads.length + 1}`,
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        target: { entryId: commentMatch[1], ...body.target },
        messages: [
          {
            id: 'message-1',
            actorId: 'local-admin',
            body: body.body,
            mentions: [...body.body.matchAll(/@([a-z0-9_-]+)/gi)].map((match) => match[1]),
            createdAt: now,
          },
        ],
        ...(body.assigneeId ? { assigneeId: body.assigneeId } : {}),
        ...(body.dueAt ? { dueAt: body.dueAt } : {}),
        createdAt: now,
        updatedAt: now,
      };
      threads.push(thread);
      return json(thread, 201);
    }
    const commentActionMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/comments\/([^/]+)(?:\/replies)?$/,
    );
    if (commentActionMatch) {
      const thread = threads.find((candidate) => candidate.id === commentActionMatch[2]);
      return thread ? json(thread) : json({ error: { message: 'Not found.' } }, 404);
    }
    const qualityMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/quality$/);
    if (qualityMatch) {
      return json({
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        entryId: qualityMatch[1],
        revisionId: `${qualityMatch[1]}-revision-1`,
        contentType: 'page',
        channel: 'web',
        policyId: 'page-web-quality-v1',
        score: 84,
        passed: false,
        bypassed: false,
        summary: { info: 0, warning: 1, error: 1 },
        findings: [
          {
            id: 'finding-alt',
            category: 'accessibility',
            code: 'image_alt_missing',
            severity: 'error',
            path: ['socialImage', 'alt'],
            message: 'Image alternative text is missing.',
            remediation: 'Describe the image purpose.',
            deduction: 15,
          },
        ],
      });
    }
    const revisionMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/revisions$/);
    if (revisionMatch) return json([]);
    const contentMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)$/);
    if (contentMatch) {
      const selected = testEntries.find((candidate) => candidate.id === contentMatch[1]);
      if (url.searchParams.get('perspective') === 'published') {
        return json({ error: { code: 'not_found', message: 'Not published.' } }, 404);
      }
      return selected ? json(selected) : json({ error: { message: 'Not found.' } }, 404);
    }
    return json({ error: { message: `Unhandled test request: ${url.pathname}` } }, 500);
  });

  return createGridStoryClient({
    baseUrl: 'http://gridstory.test',
    tenantId: 'default',
    fetch: fetchMock as unknown as typeof fetch,
  });
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWindowWidth });
  vi.restoreAllMocks();
});

describe('GridStory Studio', () => {
  function restrictedContext(
    operations: StudioOperation[],
    screens: Array<keyof StudioContext['capabilities']['screens']>,
  ): StudioContext {
    return {
      version: 1,
      scope: {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
      },
      principalId: 'restricted-editor',
      capabilities: {
        screens: Object.fromEntries(
          studioScreens.map((screen) => [screen, screens.includes(screen)]),
        ) as StudioContext['capabilities']['screens'],
        operations: Object.fromEntries(
          studioOperations.map((operation) => [operation, operations.includes(operation)]),
        ) as StudioContext['capabilities']['operations'],
      },
      selection: { mode: 'current-only', choices: [] },
    };
  }

  function selectableContext(): StudioContext {
    const value = restrictedContext([...studioOperations], [...studioScreens]);
    value.capabilities.screens.home = false;
    value.capabilities.operations['home.read'] = false;
    value.principalId = 'context-editor';
    value.selection = {
      mode: 'configured',
      choices: [
        {
          scope: value.scope,
          labels: { site: 'Default site', environment: 'Development', locale: 'English' },
        },
        {
          scope: {
            ...value.scope,
            siteId: 'campaign',
            environmentId: 'preview',
            locale: 'fr',
          },
          labels: { site: 'Campaign site', environment: 'Preview', locale: 'French' },
        },
      ],
    };
    return value;
  }

  it('uses Home as the root destination and loads only its minimized private overview', async () => {
    window.history.replaceState(null, '', '/');
    const context = restrictedContext([...studioOperations], [...studioScreens]);
    const client = createTestClient({ context });
    const overviewRead = vi.spyOn(client, 'getEditorialOverview');
    const fullReads = [
      vi.spyOn(client, 'queryContent'),
      vi.spyOn(client, 'listAssets'),
      vi.spyOn(client, 'listReleases'),
      vi.spyOn(client, 'getOperationsDashboard'),
      vi.spyOn(client, 'listWorkflows'),
      vi.spyOn(client, 'getDesignSystem'),
    ];

    render(<App client={client} />);
    const home = await screen.findByRole('region', { name: 'Editorial Home' });
    expect(window.location.hash).toBe('#/home');
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(await within(home).findByText('Showing 2 of 2 exact scoped items.')).toBeTruthy();
    expect(overviewRead).toHaveBeenCalledOnce();
    for (const read of fullReads) expect(read).not.toHaveBeenCalled();

    await userEvent.setup().click(within(home).getByRole('button', { name: /First page/ }));
    await screen.findByLabelText('Headline');
    expect(window.location.hash).toBe('#/pages?entry=one&type=page');
    expect(screen.getByRole('button', { name: 'Pages' }).getAttribute('aria-current')).toBe('page');
  });

  it('loads the scoped asset list when Library is opened from minimized Home', async () => {
    window.history.replaceState(null, '', '/');
    const client = createTestClient({
      context: restrictedContext([...studioOperations], [...studioScreens]),
      assets: [managedAsset()],
    });
    const listAssets = vi.spyOn(client, 'listAssets');

    render(<App client={client} />);
    await screen.findByRole('region', { name: 'Editorial Home' });
    expect(listAssets).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Library' }));
    expect(await screen.findByRole('heading', { name: 'Managed hero details' })).toBeTruthy();
    expect(listAssets).toHaveBeenCalledOnce();
  });

  it('loads Settings configuration lazily and keeps exactly one destination page visible', async () => {
    window.history.replaceState(null, '', '/');
    const client = createTestClient({
      context: restrictedContext([...studioOperations], [...studioScreens]),
    });
    const read = vi.spyOn(client, 'getConfigurationInventory');

    render(<App client={client} />);
    await screen.findByRole('region', { name: 'Editorial Home' });
    expect(read).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Configuration' }));
    const inventory = await screen.findByRole('region', { name: 'Configuration inventory' });
    expect(
      within(inventory).getByRole('heading', { name: 'Effective configuration' }),
    ).toBeTruthy();
    expect(read).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/settings');
    expect(screen.queryByRole('region', { name: 'Editorial Home' })).toBeNull();
    expect(screen.getAllByRole('button', { current: 'page' })).toHaveLength(1);

    await userEvent
      .setup()
      .click(within(inventory).getByRole('button', { name: 'Inspect schemas & taxonomies' }));
    expect(await screen.findByRole('region', { name: 'Schema and taxonomy catalog' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Configuration inventory' })).toBeNull();
  });

  it('loads a direct Settings route from only the minimized inventory boundary', async () => {
    window.history.replaceState(null, '', '/#/settings');
    const context = restrictedContext(
      ['settings.read', 'locales.read', 'schema.read'],
      ['settings'],
    );
    const client = createTestClient({ context });
    const read = vi.spyOn(client, 'getConfigurationInventory');
    const schemas = vi.spyOn(client, 'getSchemas');

    render(<App client={client} />);
    expect(await screen.findByRole('region', { name: 'Configuration inventory' })).toBeTruthy();
    expect(read).toHaveBeenCalledOnce();
    expect(schemas).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/settings');
  });

  it('delegates Home quick create to the canonical registered-schema authoring path', async () => {
    window.history.replaceState(null, '', '/');
    const client = createTestClient({
      context: restrictedContext([...studioOperations], [...studioScreens]),
    });
    const created = entry('created', 'New page', 'new-page');
    const workflow = await client.getContentWorkflow('one');
    const create = vi.spyOn(client, 'createContent').mockResolvedValueOnce(created);
    vi.spyOn(client, 'queryContent').mockResolvedValueOnce({
      edges: [...entries, created].map((node, index) => ({ cursor: String(index + 1), node })),
      nodes: [...entries, created],
      pageInfo: {
        startCursor: '1',
        endCursor: '3',
        hasNextPage: false,
        hasPreviousPage: false,
      },
      totalCount: 3,
    });
    vi.spyOn(client, 'getContent').mockResolvedValueOnce(created);
    vi.spyOn(client, 'getContentWorkflow').mockResolvedValueOnce({
      ...workflow,
      entryId: created.id,
      revisionId: created.draftRevisionId,
    });
    render(<App client={client} />);
    const home = await screen.findByRole('region', { name: 'Editorial Home' });
    await userEvent.setup().click(await within(home).findByRole('button', { name: 'Create Page' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    await screen.findByLabelText('Headline');
    expect(window.location.hash).toBe('#/pages?entry=created&type=page');
  });

  it('cancels or commits a complete scope switch with dirty-state, preview, and history guards', async () => {
    const user = userEvent.setup();
    const client = createTestClient({ context: selectableContext() });
    const revoke = vi.spyOn(client, 'revokePreviewSession');
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={client} />);
    const headline = await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Open live preview in new window' }));
    await screen.findByRole('button', { name: 'Close live preview window' });
    fireEvent.change(headline, { target: { value: 'Old-scope private draft' } });
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'campaign' } });
    expect(screen.getByLabelText('Environment')).toHaveProperty('value', 'preview');
    expect(screen.getByLabelText('Locale')).toHaveProperty('value', 'fr');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(headline).toHaveProperty('value', 'Old-scope private draft');
    expect(popup.close).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(screen.getByTitle('Committed Studio context').textContent).toContain('Default site');

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByTitle('Committed Studio context').textContent).toContain('Campaign site'),
    );
    expect(popup.close).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('preview-session-1');
    expect(document.body.textContent).not.toContain('Old-scope private draft');
    expect(window.location.hash).toBe('#/pages');
    expect(JSON.stringify(window.history.state)).not.toMatch(/campaign|preview-session|gsp_/i);
  });

  it('prompts for a representative management draft and keeps the old context on cancel', async () => {
    const user = userEvent.setup();
    const client = createTestClient({ context: selectableContext() });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Targeting' }));
    const panel = await screen.findByRole('region', {
      name: 'Personalization targeting workbench',
    });
    fireEvent.change(within(panel).getByLabelText('Targeting configuration JSON'), {
      target: { value: '{"changed":true}' },
    });
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'campaign' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByTitle('Committed Studio context').textContent).toContain('Default site');
    expect(within(panel).getByLabelText('Targeting configuration JSON')).toHaveProperty(
      'value',
      '{"changed":true}',
    );
  });

  it('keeps the old context when preview cleanup fails and succeeds only after cleanup retry', async () => {
    const user = userEvent.setup();
    const client = createTestClient({ context: selectableContext() });
    const revoke = vi
      .spyOn(client, 'revokePreviewSession')
      .mockRejectedValueOnce(new Error('Revocation service unavailable'));
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Open live preview in new window' }));
    await screen.findByRole('button', { name: 'Close live preview window' });
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'campaign' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Studio context was not changed.*Revocation service unavailable/);
    expect(screen.getByTitle('Committed Studio context').textContent).toContain('Default site');
    expect(window.location.hash).toContain('entry=one');
    expect(popup.close).toHaveBeenCalled();

    revoke.mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByTitle('Committed Studio context').textContent).toContain('Campaign site'),
    );
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe('#/pages');
  });

  it('disables context switching for the full lifetime of an active management write', async () => {
    const user = userEvent.setup();
    const client = createTestClient({ context: selectableContext() });
    const snapshot = await client.getPersonalization();
    const update = Promise.withResolvers<PersonalizationSnapshot>();
    vi.spyOn(client, 'replacePersonalizationDraft').mockReturnValueOnce(update.promise);
    const clone = vi.spyOn(client, 'withStudioScope');
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Targeting' }));
    const panel = await screen.findByRole('region', {
      name: 'Personalization targeting workbench',
    });
    await user.click(within(panel).getByRole('button', { name: 'Save targeting draft' }));
    await waitFor(() => expect(screen.getByLabelText('Site')).toHaveProperty('disabled', true));
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
    expect(clone).not.toHaveBeenCalled();
    update.resolve(snapshot);
    await waitFor(() => expect(screen.getByLabelText('Site')).toHaveProperty('disabled', false));
  });

  it('waits for and revokes a late preview grant before committing the new scope', async () => {
    const user = userEvent.setup();
    const client = createTestClient({ context: selectableContext() });
    const grant = await client.createPreviewSession({
      previewUrl: 'http://localhost:5174/',
      mode: 'standalone',
      entryId: 'one',
    });
    const pendingGrant = Promise.withResolvers<typeof grant>();
    vi.spyOn(client, 'createPreviewSession').mockReturnValueOnce(pendingGrant.promise);
    const revoke = vi.spyOn(client, 'revokePreviewSession');
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Open live preview in new window' }));
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'campaign' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTitle('Committed Studio context').textContent).toContain('Default site');
    expect(screen.getByRole('button', { name: 'Switching…' })).toHaveProperty('disabled', true);
    pendingGrant.resolve(grant);
    await waitFor(() =>
      expect(screen.getByTitle('Committed Studio context').textContent).toContain('Campaign site'),
    );
    expect(revoke).toHaveBeenCalledWith(grant.sessionId);
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(popup.postMessage).not.toHaveBeenCalled();
  });

  it('loads context first and supports an operations-only account without content or authoring calls', async () => {
    const client = createTestClient({
      context: restrictedContext(['operations.read'], ['operations']),
    });
    const pending = Promise.withResolvers<StudioContext>();
    vi.spyOn(client, 'getStudioContext').mockReturnValueOnce(pending.promise);
    const reads = [
      'listContent',
      'getContent',
      'getSchemas',
      'getComponentManifests',
      'getDesignSystem',
      'listAssets',
      'listWorkflows',
      'listReleases',
      'getCollaboration',
    ] as const;
    const spies = reads.map((name) => vi.spyOn(client, name));
    render(<App client={client} />);
    expect(screen.queryByRole('navigation')).toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(restrictedContext(['operations.read'], ['operations']));
    });
    await screen.findByRole('region', { name: 'Administrator operations' });
    expect(window.location.hash).toBe('#/operations');
    expect(screen.queryByRole('button', { name: 'Pages', exact: true })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Search Studio' })).toBeNull();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('renders no-access and denied-deep-link states without denied feature requests', async () => {
    const client = createTestClient({ context: restrictedContext([], []) });
    const list = vi.spyOn(client, 'listContent');
    render(<App client={client} />);
    await screen.findByRole('heading', { name: 'No Studio access' });
    expect(document.querySelectorAll('[data-destination]')).toHaveLength(0);
    expect(list).not.toHaveBeenCalled();
    cleanup();
    window.history.replaceState(null, '', '/#/identity');
    const operations = createTestClient({
      context: restrictedContext(['operations.read'], ['operations']),
    });
    const identity = vi.spyOn(operations, 'getIdentity');
    render(<App client={operations} />);
    await screen.findByRole('heading', { name: 'Access unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Operations' }));
    await screen.findByRole('region', { name: 'Administrator operations' });
    expect(identity).not.toHaveBeenCalled();
  });

  it('keeps page-type list grants separate from untyped details and metadata', async () => {
    const client = createTestClient({
      context: restrictedContext(['pages.list', 'pages.create'], ['pages']),
    });
    const detail = vi.spyOn(client, 'getContent');
    const schemas = vi.spyOn(client, 'getSchemas');
    render(<App client={client} />);
    await screen.findByText(/Listing permission does not grant access/);
    const list = within(screen.getByRole('complementary', { name: 'Content entries' }));
    await list.findByText('one', { exact: true });
    expect(list.getByText('two', { exact: true })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Headline' })).toBeNull();
    expect(detail).not.toHaveBeenCalled();
    expect(schemas).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create page' })).toHaveProperty('disabled', true);
  });

  it('shows read-only fields and skips optional history, workflow, collaboration and asset reads', async () => {
    const client = createTestClient({
      context: restrictedContext(
        ['pages.list', 'content.read', 'schema.read', 'component.read'],
        ['pages', 'components'],
      ),
    });
    const optional = [
      'listRevisions',
      'getContentWorkflow',
      'listWorkflows',
      'getCollaboration',
      'heartbeatPresence',
      'listAssets',
      'listReleases',
    ] as const;
    const spies = optional.map((name) => vi.spyOn(client, name));
    const save = vi.spyOn(client, 'saveDraft');
    const preview = vi.spyOn(client, 'createPreviewSession');
    render(<App client={client} />);
    const headline = await screen.findByRole('textbox', { name: 'Headline' });
    expect(headline.matches(':disabled')).toBe(true);
    expect(screen.getByText(/Read-only page/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Editorial workflow' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Collaboration workspace' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Immutable revisions' })).toBeNull();
    for (const name of [
      'Save draft',
      'Publish',
      'Create page',
      'Open live preview in new window',
    ]) {
      const button = screen.getByRole('button', { name, exact: true });
      expect(button).toHaveProperty('disabled', true);
      fireEvent.click(button);
    }
    expect(save).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('allows knowledge-only access without inventing agent configuration', async () => {
    const client = createTestClient({
      context: restrictedContext(['knowledge.read'], ['knowledge']),
    });
    const agent = vi.spyOn(client, 'getKnowledgeAgent');
    render(<App client={client} />);
    await screen.findByText(/Agent configuration is not available/);
    expect(screen.queryByRole('group', { name: 'Disabled-by-default agent policy' })).toBeNull();
    expect(agent).not.toHaveBeenCalled();
  });

  it.each(['navigation', 'search'] as const)(
    'respects the %s focus owner when deferred Pages navigation completes (BUG-0441)',
    async (owner) => {
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      const user = userEvent.setup();
      render(<App client={createTestClient()} />);
      await screen.findByLabelText('Headline');
      await user.click(screen.getByRole('button', { name: 'Library', exact: true }));
      const pages = screen.getByRole('button', { name: 'Pages', exact: true });
      pages.focus();
      await user.keyboard('{Enter}');
      await screen.findByLabelText('Headline');
      const search = screen.getByLabelText('Search Studio');
      if (owner === 'search') await user.click(search);
      expect(frames.length).toBeGreaterThan(0);
      act(() => {
        for (const frame of frames.splice(0)) frame(performance.now());
      });
      expect(document.activeElement).toBe(
        owner === 'search' ? search : document.getElementById('studio-editor'),
      );
    },
  );

  it('cancels deferred editor focus on superseding navigation and unmount (BUG-0441)', async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const user = userEvent.setup();
    const view = render(<App client={createTestClient()} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: /Second page/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/pages?entry=two&type=page'));
    expect(frames.size).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Library', exact: true }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Pages', exact: true }));
    expect(frames.size).toBe(1);
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
  });

  it('keeps an editor field focused when delayed navigation focus runs before typing (BUG-0441)', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={createTestClient()} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: /Second page/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/pages?entry=two&type=page'));
    const headline = screen.getByLabelText('Headline') as HTMLInputElement;
    await user.click(headline);
    headline.select();
    expect(frames.length).toBeGreaterThan(0);
    act(() => {
      for (const frame of frames.splice(0)) frame(performance.now());
    });
    expect(document.activeElement).toBe(headline);
    await user.keyboard('Unsaved second navigation draft');
    expect(headline.value).toBe('Unsaved second navigation draft');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    window.history.back();
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(window.location.hash).toBe('#/pages?entry=two&type=page'));
    expect(headline.value).toBe('Unsaved second navigation draft');
  });

  it('confirms before a component migration can replace a different dirty entry', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const migration = await client.getComponentMigration('gridstory.hero');
    vi.spyOn(client, 'getComponentMigration').mockResolvedValue({
      ...migration,
      component: { ...migration.component, version: 2 },
      usage: {
        ...migration.usage,
        locations: [
          {
            entryId: 'two',
            revisionId: 'two-revision-1',
            perspective: 'draft',
            version: 1,
            field: 'sections',
            nodeId: 'two-hero-a',
          },
        ],
      },
    });
    const migrate = vi
      .spyOn(client, 'migrateEntryComponent')
      .mockResolvedValue({ entry: entries[1] as ContentEntry, migratedInstances: 1 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={client} />);
    fireEvent.change(await screen.findByLabelText('Headline'), {
      target: { value: 'Keep this draft' },
    });
    await user.click(screen.getByRole('button', { name: 'Components' }));
    await user.click(await screen.findByRole('button', { name: 'Migrate two from v1' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(migrate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Keep this draft');
  });

  it('blocks entry replacement while a collaboration mutation is in flight', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const branch = await client.createCollaborationBranch('one', {
      name: 'Pending branch',
      parentBranchId: 'main',
    });
    let resolve!: (value: typeof branch) => void;
    vi.spyOn(client, 'createCollaborationBranch').mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.type(screen.getByLabelText('New branch from current'), 'Pending branch');
    await user.click(screen.getByRole('button', { name: 'Create branch' }));
    await user.click(screen.getByRole('button', { name: 'Workflows' }));
    await screen.findByRole('region', { name: 'Workflow action designer' });
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    await user.click(screen.getByRole('button', { name: /Second page/ }));
    await screen.findByText(/Wait for the current operation/);
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('First page');
    expect(window.location.hash).toBe('#/pages?entry=one&type=page');
    resolve(branch);
    await screen.findByText('Pending branch branch created.');
  });

  it('adds a location only after successful page creation, without pushing failed writes', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    const length = window.history.length;
    const create = vi
      .spyOn(client, 'createContent')
      .mockRejectedValueOnce(new Error('Creation rejected'));
    await user.click(screen.getByRole('button', { name: 'Create page' }));
    await screen.findByText('Creation rejected');
    expect(window.history.length).toBe(length);
    expect(window.location.hash).toBe('#/pages?entry=one&type=page');
    const created = entry('created', 'New page', 'new-page');
    create.mockResolvedValueOnce(created);
    vi.spyOn(client, 'getContent').mockResolvedValueOnce(created);
    const workflow = await client.getContentWorkflow('one');
    vi.spyOn(client, 'getContentWorkflow').mockResolvedValueOnce({
      ...workflow,
      entryId: created.id,
    });
    vi.spyOn(client, 'listContent').mockResolvedValueOnce([...entries, created]);
    await user.click(screen.getByRole('button', { name: 'Create page' }));
    await screen.findByText('Draft page created.');
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('New page');
    expect(window.location.hash).toBe('#/pages?entry=created&type=page');
    expect(window.history.length).toBe(length + 1);
  });

  it('authors an explicitly selected non-component collection with declared page relations', async () => {
    const user = userEvent.setup();
    const client = createTestClient({
      schemas: [schema, articleSchema],
      entries: [...entries, articleEntry],
    });
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Collections', exact: true }));
    await screen.findByRole('heading', { name: 'Articles', exact: true });
    expect((screen.getByLabelText('Content type') as HTMLSelectElement).value).toBe('article');
    expect((screen.getByLabelText('Article headline') as HTMLInputElement).value).toBe(
      'First article',
    );
    expect(screen.queryByText('Composition')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open live preview in new window' })).toBeNull();
    const relation = await screen.findByRole('region', { name: 'Related pages' });
    expect(within(relation).getByRole('button', { name: /Second page/ })).toBeTruthy();
    expect(window.location.hash).toBe('#/collections?entry=article-one&type=article');

    const created: ContentEntry = {
      ...articleEntry,
      id: 'article-created',
      draftRevisionId: 'article-created-revision-1',
      data: {
        headline: 'Untitled Article',
        slug: 'untitled-test',
        body: { version: 1, blocks: [] },
      },
    };
    const create = vi.spyOn(client, 'createContent').mockResolvedValueOnce(created);
    vi.spyOn(client, 'listContent').mockResolvedValueOnce([articleEntry, created]);
    vi.spyOn(client, 'getContent').mockResolvedValueOnce(created);
    const workflow = await client.getContentWorkflow(articleEntry.id);
    vi.spyOn(client, 'getContentWorkflow').mockResolvedValueOnce({
      ...workflow,
      entryId: created.id,
      revisionId: created.draftRevisionId,
    });
    await user.click(screen.getByRole('button', { name: 'Create article' }));
    await screen.findByText('Draft article created.');
    expect(screen.getByLabelText('Article headline').closest('[inert]')).toBeNull();
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toBe('article');
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      headline: 'Untitled Article',
      body: { version: 1, blocks: [] },
    });
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty('blocks');
    expect(window.location.hash).toBe('#/collections?entry=article-created&type=article');
  });

  it('registers the document-exit warning only while dirty and cleans it up on unmount', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<App client={createTestClient()} />);
    await screen.findByLabelText('Headline');
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Unsaved' } });
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    view.unmount();
    expect(remove.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
  });

  it('restores a direct authorized entry outside the loaded list and its destination in StrictMode', async () => {
    window.history.replaceState(
      { host: 'keep' },
      '',
      '/studio/?host=1#/quality?entry=two&type=page',
    );
    const client = createTestClient();
    vi.spyOn(client, 'listContent').mockResolvedValue([entries[0] as ContentEntry]);
    const read = vi.spyOn(client, 'getContent');
    render(
      <StrictMode>
        <App client={client} />
      </StrictMode>,
    );
    await screen.findByRole('region', { name: 'Content quality report' });
    expect(read).toHaveBeenCalledWith('two', expect.objectContaining({ perspective: 'draft' }));
    expect(window.location.hash).toBe('#/quality?entry=two&type=page');
    expect(window.history.state.host).toBe('keep');
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Skip to content editor' }));
    expect(document.activeElement?.id).toBe('studio-content');
    expect(window.location.hash).toBe('#/quality?entry=two&type=page');
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    expect(((await screen.findByLabelText('Headline')) as HTMLInputElement).value).toBe(
      'Second page',
    );
    await user.click(screen.getByRole('link', { name: 'Skip to content editor' }));
    expect(document.activeElement?.id).toBe('studio-editor');
    expect(window.location.hash).toBe('#/pages?entry=two&type=page');
  });

  it.each(['missing', 'forbidden', 'wrong-type'])(
    'does not substitute the first entry for a %s direct target',
    async (failure) => {
      window.history.replaceState(null, '', '/#/pages?entry=two&type=page');
      const client = createTestClient();
      const read = vi.spyOn(client, 'getContent');
      if (failure === 'wrong-type')
        read.mockResolvedValue({ ...(entries[1] as ContentEntry), contentType: 'article' });
      else read.mockRejectedValue(new Error(failure));
      render(<App client={client} />);
      await screen.findByText(/The requested page is unavailable/);
      expect(screen.queryByLabelText('Headline')).toBeNull();
      expect(window.location.hash).toBe('#/pages?entry=two&type=page');
      expect(
        (screen.getByRole('button', { name: 'Publish', exact: true }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(
        (
          screen.getByRole('button', {
            name: 'Open live preview in new window',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    },
  );

  it('normalizes malformed addresses without rendering input and handles an empty page list', async () => {
    window.history.replaceState(null, '', '/#/unknown?token=do-not-reflect');
    render(<App client={createTestClient({ entries: [] })} />);
    await screen.findByText('No pages yet. Create the first one.');
    expect(window.location.hash).toBe('#/pages');
    expect(document.body.textContent).not.toContain('do-not-reflect');
    expect(screen.getByText(/That Studio address was not recognized/)).toBeTruthy();
  });

  it('restores cancelled owned history, then accepts Back and Forward without losing stack entries', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={createTestClient()} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: /Second page/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/pages?entry=two&type=page'));
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Unsaved second' } });
    window.history.back();
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(window.location.hash).toBe('#/pages?entry=two&type=page'));
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Unsaved second');
    confirm.mockReturnValue(true);
    window.history.back();
    await waitFor(() =>
      expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('First page'),
    );
    window.history.forward();
    await waitFor(() =>
      expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Second page'),
    );
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('unlocks the accepted editor when a pending entry read is superseded by reselection', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    let resolve!: (entry: ContentEntry) => void;
    vi.spyOn(client, 'getContent').mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await user.click(screen.getByRole('button', { name: /Second page/ }));
    expect(screen.getByLabelText('Headline').closest('[inert]')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /First page/ }));
    fireEvent.change(screen.getByLabelText('Headline'), {
      target: { value: 'Keep editing first' },
    });
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe(
      'Keep editing first',
    );
    resolve(entries[1] as ContentEntry);
    await waitFor(() => expect(window.location.hash).toBe('#/pages?entry=one&type=page'));
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe(
      'Keep editing first',
    );
  });

  it('settles a successful entry read before exposing its controlled fields for editing', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);
    await screen.findByLabelText('Headline');

    await user.click(screen.getByRole('button', { name: /Second page/ }));
    const headline = await screen.findByLabelText('Headline');
    expect((headline as HTMLInputElement).value).toBe('Second page');
    expect(headline.closest('[inert]')).toBeNull();
    fireEvent.change(headline, { target: { value: 'Immediate accepted-entry edit' } });
    expect((headline as HTMLInputElement).value).toBe('Immediate accepted-entry edit');
    expect(screen.getByText('Unsaved changes', { exact: true })).toBeTruthy();
  });

  it('ignores an out-of-order entry response and preserves new edits, notice and busy state', async () => {
    const user = userEvent.setup();
    const third = entry('three', 'Third page', 'third');
    const client = createTestClient({ entries: [...entries, third] });
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    let resolve!: (entry: ContentEntry) => void;
    const read = vi.spyOn(client, 'getContent').mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await user.click(screen.getByRole('button', { name: /Second page/ }));
    const signal = read.mock.calls[0]?.[1]?.signal;
    await user.click(screen.getByRole('button', { name: /Third page/ }));
    await waitFor(() =>
      expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Third page'),
    );
    expect(signal?.aborted).toBe(true);
    fireEvent.change(screen.getByLabelText('Headline'), {
      target: { value: 'Newest unsaved edit' },
    });
    resolve(entries[1] as ContentEntry);
    await waitFor(() => expect(window.location.hash).toBe('#/pages?entry=three&type=page'));
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe(
      'Newest unsaved edit',
    );
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('rejects entry changes during a save and does not add history for its result', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    let resolve!: (entry: ContentEntry) => void;
    vi.spyOn(client, 'saveDraft').mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Saving first' } });
    const length = window.history.length;
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await user.click(screen.getByRole('button', { name: /Second page/ }));
    await screen.findByText(/Wait for the current operation/);
    expect(window.location.hash).toBe('#/pages?entry=one&type=page');
    resolve(entry('one', 'Saving first', 'first'));
    await screen.findByText('Draft saved as a new immutable revision.');
    expect(window.history.length).toBe(length);
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Saving first');
  });

  it('discloses navigation groups without selecting, loading or losing dirty editor state', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const listWorkflows = vi.spyOn(client, 'listWorkflows');
    const saveDraft = vi.spyOn(client, 'saveDraft');
    render(<App client={client} />);
    const headline = await screen.findByLabelText('Headline');
    await user.clear(headline);
    await user.type(headline, 'Keep this draft');
    const loadCount = listWorkflows.mock.calls.length;
    const navigation = screen.getByRole('navigation', { name: 'Studio sections' });
    const content = within(navigation).getByRole('button', { name: 'Content', exact: true });
    expect(content.getAttribute('aria-controls')).toBe('studio-navigation-content');
    expect(content.getAttribute('aria-current')).toBeNull();
    expect(within(navigation).getAllByRole('list')).toHaveLength(11);
    await user.click(content);
    expect(content.getAttribute('aria-expanded')).toBe('false');
    expect(within(navigation).queryByRole('button', { name: 'Pages', exact: true })).toBeNull();
    expect(document.querySelectorAll('.studio-navigation__item[aria-current="page"]')).toHaveLength(
      1,
    );
    expect(document.querySelectorAll('.studio-workspace')).toHaveLength(1);
    expect((headline as HTMLInputElement).value).toBe('Keep this draft');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await user.keyboard(' ');
    expect(content.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(navigation)
        .getByRole('button', { name: 'Pages', exact: true })
        .getAttribute('aria-current'),
    ).toBe('page');
    await user.keyboard('{Enter}');
    expect(content.getAttribute('aria-expanded')).toBe('false');
    expect(listWorkflows).toHaveBeenCalledTimes(loadCount);
    expect(saveDraft).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Search Studio' }), 'draft{Enter}');
    await screen.findByRole('region', { name: 'Search and discovery' });
    expect(content.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(navigation)
        .getByRole('button', { name: 'Search', exact: true })
        .getAttribute('aria-current'),
    ).toBe('page');
    await user.click(within(navigation).getByRole('button', { name: 'Pages', exact: true }));
    expect(((await screen.findByLabelText('Headline')) as HTMLInputElement).value).toBe(
      'Keep this draft',
    );
  });

  it('keeps all named destinations reachable in compact mode and restores disclosure preferences', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);
    await screen.findByLabelText('Headline');
    const navigation = screen.getByRole('navigation', { name: 'Studio sections' });
    await user.click(within(navigation).getByRole('button', { name: 'Advanced', exact: true }));
    expect(
      within(navigation).queryByRole('button', { name: 'Identity providers', exact: true }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    expect(within(navigation).getAllByRole('button')).toHaveLength(23);
    expect(
      within(navigation)
        .getByRole('button', { name: 'Identity providers', exact: true })
        .getAttribute('title'),
    ).toBe('Identity providers');
    await user.click(within(navigation).getByRole('button', { name: 'Library', exact: true }));
    await screen.findByRole('region', { name: 'Asset library' });
    expect(document.querySelectorAll('.studio-page > section')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    expect(
      within(navigation)
        .getByRole('button', { name: 'Advanced', exact: true })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    expect(
      within(navigation).queryByRole('button', { name: 'Identity providers', exact: true }),
    ).toBeNull();
    expect(
      within(navigation)
        .getByRole('button', { name: 'Library', exact: true })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(document.querySelectorAll('.preview-panel')).toHaveLength(0);
  });

  it('provides the responsive Studio navigation and persistent light and dark themes', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const user = userEvent.setup();

    render(<App client={createTestClient()} />);

    const navigation = await screen.findByRole('complementary', {
      name: 'Primary Studio navigation',
    });
    const shell = document.querySelector('.studio-shell');
    expect(shell?.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Pages' }).getAttribute('aria-current')).toBe('page');

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(shell?.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('gridstory-studio-theme')).toBe('dark');

    const navigationToggle = screen.getByRole('button', { name: 'Toggle navigation' });
    expect(navigationToggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(navigationToggle);
    expect(navigation.classList.contains('studio-navigation--open')).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Close navigation' })).toHaveLength(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(navigation.classList.contains('studio-navigation--open')).toBe(false);
  });

  it('keeps exactly one navigation destination and one page surface active', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const listWorkflows = vi.spyOn(client, 'listWorkflows');
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    const navigation = screen.getByRole('navigation', { name: 'Studio sections' });
    const currentNavigationItems = () =>
      within(navigation)
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-current') === 'page');

    expect(currentNavigationItems()).toHaveLength(1);
    expect(currentNavigationItems()[0]?.textContent).toContain('Pages');
    expect(document.querySelector('.studio-workspace')).toBeTruthy();
    expect(document.querySelectorAll('.studio-page > section')).toHaveLength(0);

    await user.click(within(navigation).getByRole('button', { name: 'Workflows' }));
    await screen.findByRole('region', {
      name: 'Workflow action designer',
    });
    const workflowLoadCount = listWorkflows.mock.calls.length;
    expect(currentNavigationItems()).toHaveLength(1);
    expect(currentNavigationItems()[0]?.textContent).toContain('Workflows');
    expect(document.querySelector('.studio-workspace')).toBeNull();
    expect(document.querySelectorAll('.studio-page > section')).toHaveLength(1);

    await user.click(within(navigation).getByRole('button', { name: 'Releases' }));
    await screen.findByRole('region', { name: 'Release manager' });
    expect(currentNavigationItems()).toHaveLength(1);
    expect(currentNavigationItems()[0]?.textContent).toContain('Releases');
    expect(screen.queryByRole('region', { name: 'Workflow action designer' })).toBeNull();
    expect(document.querySelector('.studio-workspace')).toBeNull();
    expect(document.querySelectorAll('.studio-page > section')).toHaveLength(1);

    await user.click(within(navigation).getByRole('button', { name: 'Workflows' }));
    await screen.findByRole('region', { name: 'Workflow action designer' });
    expect(listWorkflows).toHaveBeenCalledTimes(workflowLoadCount);
    expect(screen.queryByRole('region', { name: 'Release manager' })).toBeNull();

    await user.click(within(navigation).getByRole('button', { name: 'Pages' }));
    await waitFor(() => expect(document.querySelector('.studio-workspace')).toBeTruthy());
    expect(currentNavigationItems()).toHaveLength(1);
    expect(currentNavigationItems()[0]?.textContent).toContain('Pages');
    expect(document.querySelectorAll('.studio-page > section')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Workflow action designer' })).toBeNull();
  });

  it('derives content controls and composition storage from the active schema', async () => {
    render(<App client={createTestClient()} />);

    expect(
      (await screen.findByRole('link', { name: 'Skip to content editor' })).getAttribute('href'),
    ).toBe('#studio-editor');
    expect(document.querySelector('main')?.id).toBe('studio-editor');
    expect(((await screen.findByLabelText('Headline')) as HTMLInputElement).value).toBe(
      'First page',
    );
    expect((screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement).value).toBe('first');
    expect(screen.getByRole('heading', { name: 'Sections' })).toBeTruthy();

    const headings = screen.getAllByLabelText('Heading');
    expect(headings).toHaveLength(2);
    expect(headings[0]?.id).not.toBe(headings[1]?.id);
  });

  it('keeps dirty edits when entry navigation is cancelled', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={createTestClient()} />);

    const headline = await screen.findByLabelText('Headline');
    await user.clear(headline);
    await user.type(headline, 'Edited first page');
    await user.click(screen.getByRole('button', { name: /Second page/ }));

    expect(confirm).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Edited first page');
  });

  it('guards search-result entry changes and opens Pages only after acceptance (BUG-0421)', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={createTestClient()} />);
    fireEvent.change(await screen.findByLabelText('Headline'), {
      target: { value: 'Unsaved first page' },
    });
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const panel = await screen.findByRole('region', { name: 'Search and discovery' });
    const result = await within(panel).findByRole('button', { name: 'Second page' });
    const address = window.location.href;
    await user.click(result);
    expect(confirm).toHaveBeenCalledOnce();
    expect(window.location.href).toBe(address);
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe(
      'Unsaved first page',
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));
    confirm.mockReturnValue(true);
    await user.click(await screen.findByRole('button', { name: 'Second page', exact: true }));
    await waitFor(() =>
      expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Second page'),
    );
    expect(screen.getByRole('button', { name: 'Pages' }).getAttribute('aria-current')).toBe('page');
  });

  it('runs candidate quality checks and links findings to responsible fields', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Page checks' }));

    const panel = await screen.findByRole('region', { name: 'Content quality report' });
    expect(panel.textContent).toContain('84');
    expect(panel.textContent).toContain('Gate blocked');
    expect(panel.textContent).toContain('Image alternative text is missing.');
    expect(panel.textContent).toContain('socialImage.alt');
    expect(screen.getByRole('button', { name: 'Re-run checks' })).toBeTruthy();
  });
  it('shows the scoped administrator integrity and operations summary on demand', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Operations' }));

    const panel = await screen.findByRole('region', { name: 'Administrator operations' });
    expect(panel.textContent).toContain('Audit chain verified');
    expect(panel.textContent).toContain('Pending events');
    expect(panel.textContent).toContain('Dead jobs');
    expect(panel.textContent).toContain('Content views');
    expect(panel.textContent).toContain('14');
    expect(panel.textContent).toContain('Component views');
    expect(panel.textContent).toContain('Interactions');
    expect(panel.textContent).toContain('Release markers');
    expect(panel.textContent).toContain('Dead deliveries');
  });

  it('shows bounded regional policy, evidence, independent approval, and execution controls', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const scope = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
    };
    const preview: RegionalDocument = {
      ...scope,
      schemaVersion: 1,
      version: 2,
      state: 'enabled',
      activeControlRegion: 'us-east-1',
      activeControlEvidenceReference: 'placement://us-east-1',
      topologyVersion: 2,
      readPolicy: {
        mode: 'bounded-staleness',
        maximumLagMs: 5_000,
        failureMode: 'unavailable',
      },
      readRegions: [
        {
          region: 'eu-west-1',
          adapter: 'reader-a',
          enabled: true,
          residencyEvidenceReference: 'placement://eu-west-1',
        },
      ],
      failoverAdapter: 'failover-a',
      operations: [
        {
          ...scope,
          id: '018daf23-89b3-7cf8-a4f1-94064c96df91',
          requestId: '018daf23-89b3-7cf8-a4f1-94064c96df90',
          state: 'preview',
          documentVersion: 2,
          topologyVersion: 2,
          sourceRegion: 'us-east-1',
          targetRegion: 'eu-west-1',
          mode: 'planned',
          reason: 'Planned maintenance.',
          expectedRpoSeconds: 0,
          expectedRtoSeconds: 300,
          backup: {
            reference: 'backup://regional/studio',
            sha256: 'a'.repeat(64),
            verifiedAt: now,
          },
          readiness: {
            ...scope,
            adapter: 'failover-a',
            requestId: '018daf23-89b3-7cf8-a4f1-94064c96df90',
            sourceRegion: 'us-east-1',
            targetRegion: 'eu-west-1',
            topologyVersion: 2,
            checkedAt: now,
            ready: true,
            caughtUp: true,
            replicationLagMs: 0,
            estimatedDataLossMs: 0,
            evidenceDigest: 'b'.repeat(64),
          },
          digest: 'c'.repeat(64),
          createdBy: 'operator-a',
          createdAt: now,
          expiresAt: '2026-08-24T09:00:00.000Z',
        },
      ],
      updatedBy: 'operator-a',
      updatedAt: now,
    };
    vi.spyOn(client, 'getRegionalTopology').mockResolvedValue(preview);
    const approved: RegionalDocument = {
      ...preview,
      version: 3,
      operations: [
        {
          ...preview.operations[0],
          state: 'approved',
          documentVersion: 3,
          approval: {
            digest: 'c'.repeat(64),
            approvedBy: 'operator-b',
            approvedAt: now,
            reauthenticatedAt: now,
            reason: 'Reviewed.',
            acceptDataLoss: false,
          },
        } as RegionalDocument['operations'][number],
      ],
    };
    vi.spyOn(client, 'approveRegionalFailover').mockResolvedValue(approved);
    vi.spyOn(client, 'executeRegionalFailover').mockResolvedValue({
      ...approved,
      version: 5,
      topologyVersion: 3,
      activeControlRegion: 'eu-west-1',
      readPolicy: { ...approved.readPolicy, mode: 'primary-only', maximumLagMs: 0 },
      operations: [
        {
          ...approved.operations[0],
          state: 'succeeded',
          documentVersion: 5,
          completedAt: now,
        } as RegionalDocument['operations'][number],
      ],
    });
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Regions' }));
    const panel = await screen.findByRole('region', {
      name: 'Regional delivery and failover controls',
    });
    expect(panel.textContent).toContain('GridStory validates provider evidence');
    expect(panel.textContent).toContain('Readiness ready');
    expect(within(panel).getByRole('button', { name: 'Save topology policy' })).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Approve as second human' }));
    await screen.findByText('Failover plan independently approved.');
    await user.click(within(panel).getByRole('button', { name: 'Execute approved transition' }));
    await screen.findByText(/regional reads were reset to primary-only/i);
    expect(panel.textContent).toContain('active control eu-west-1');
  });

  it('shows neutral contract-bound federation controls and saves an exact producer offer', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const document: ContentFederationDocument = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      schemaVersion: 1,
      version: 0,
      offers: [],
      agreements: [],
      mirrors: [],
      plans: [],
      receipts: [],
      updatedBy: 'system',
      updatedAt: now,
    };
    vi.spyOn(client, 'getContentFederation').mockResolvedValue(document);
    const save = vi.spyOn(client, 'upsertFederationOffer').mockResolvedValue(undefined as never);
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Federation' }));
    const panel = await screen.findByRole('region', {
      name: 'Content federation and syndication',
    });
    expect(panel.textContent).toContain('Only exact published schemas may cross this boundary');
    expect(panel.textContent).toContain('No source offer has been inspected and pinned.');
    expect(within(panel).getByRole('textbox', { name: 'Offer JSON' })).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Save exact offer version' }));
    await screen.findByText('Published-only federation offer saved.');
    expect(save).toHaveBeenCalledWith(
      'published-pages',
      expect.objectContaining({ expectedVersion: 0, state: 'disabled' }),
    );
  });

  it('shows an empty private fleet and registers only a preconfigured adapter identity', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const document: FleetDocument = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      schemaVersion: 1,
      version: 0,
      members: [],
      observations: [],
      events: [],
      updatedAt: now,
      updatedBy: 'system',
    };
    vi.spyOn(client, 'getFleet').mockResolvedValue(document);
    const register = vi.spyOn(client, 'upsertFleetMember').mockResolvedValue({
      ...document,
      version: 1,
      members: [
        {
          id: 'remote-primary',
          generation: 1,
          label: 'Remote primary',
          adapterId: 'remote-primary',
          expectedInstanceId: 'remote-instance',
          state: 'active',
          createdAt: now,
          createdBy: 'local-admin',
          updatedAt: now,
          updatedBy: 'local-admin',
        },
      ],
      updatedBy: 'local-admin',
    });

    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Fleet' }));
    const panel = await screen.findByRole('region', { name: 'Self-hosted fleet observations' });
    expect(panel.textContent).toContain('No self-hosted instance is configured in this scope.');
    expect(panel.textContent).toContain('Browser input never supplies a target URL or credential');
    expect(within(panel).queryByRole('textbox', { name: /URL/u })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Register fleet member' }));
    await screen.findByText('Fleet member registered for pull-only observation.');
    expect(register).toHaveBeenCalledWith('remote-primary', {
      expectedVersion: 0,
      label: 'Remote primary',
      adapterId: 'remote-primary',
      expectedInstanceId: 'remote-instance',
    });
    expect(panel.textContent).toContain('generation 1');
  });

  it('explores bounded knowledge and requires explicit plan review before draft execution', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const plan: KnowledgeDocument['plans'][number] = {
      id: 'agent-plan-a',
      status: 'pending-review',
      policyVersion: 1,
      policyDigest: 'a'.repeat(64),
      adapterId: 'runtime-a',
      modelId: 'small',
      promptId: 'knowledge-plan',
      promptVersion: 1,
      goal: 'Improve the headline.',
      goalDigest: 'b'.repeat(64),
      target: { entryId: 'one', contentType: 'page', draftRevisionId: 'one-revision-1' },
      summary: 'Use a clearer headline.',
      changes: [{ fieldPath: 'headline', value: 'Reviewed headline', rationale: 'Clearer.' }],
      toolTrace: [
        {
          callId: 'tool-a',
          tool: 'content.get',
          inputDigest: 'c'.repeat(64),
          outputDigest: 'd'.repeat(64),
          resultCount: 1,
          completedAt: now,
        },
      ],
      resultChecksum: 'e'.repeat(64),
      digest: 'f'.repeat(64),
      createdBy: 'author-a',
      createdAt: now,
      expiresAt: '2026-08-25T00:00:00.000Z',
    };
    const document: KnowledgeDocument = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      schemaVersion: 1,
      version: 2,
      policy: {
        enabled: true,
        adapterId: 'runtime-a',
        modelId: 'small',
        promptId: 'knowledge-plan',
        promptVersion: 1,
        fieldRules: [{ contentType: 'page', fieldPaths: ['headline'] }],
        tools: ['content.get'],
        maximumToolCalls: 2,
        timeoutMs: 1_000,
        planLifetimeSeconds: 300,
      },
      plans: [plan],
      receipts: [],
      updatedAt: now,
      updatedBy: 'author-a',
    };
    vi.spyOn(client, 'getKnowledgeAgent').mockResolvedValue(document);
    const explore = vi.spyOn(client, 'exploreKnowledgeGraph').mockResolvedValue({
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      perspective: 'draft',
      seedEntryIds: ['one'],
      nodes: [
        {
          kind: 'content',
          id: 'one',
          contentType: 'page',
          revisionId: 'one-revision-1',
          status: 'draft',
        },
      ],
      edges: [],
      paths: [],
      sourceEntries: 1,
      truncated: false,
    });
    vi.spyOn(client, 'listKnowledgeRecommendations').mockResolvedValue({
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      perspective: 'draft',
      source: {
        kind: 'content',
        id: 'one',
        contentType: 'page',
        revisionId: 'one-revision-1',
        status: 'draft',
      },
      recommendations: [],
      truncated: false,
    });
    const approved: KnowledgeDocument = {
      ...document,
      version: 3,
      plans: [
        {
          ...plan,
          status: 'approved',
          review: { decision: 'approved', actorId: 'publisher-a', decidedAt: now },
        },
      ],
    };
    const review = vi.spyOn(client, 'reviewKnowledgeAgentPlan').mockResolvedValue(approved);
    const execute = vi.spyOn(client, 'executeKnowledgeAgentPlan').mockResolvedValue({
      id: 'receipt-a',
      planId: plan.id,
      digest: plan.digest,
      idempotencyKey: 'execution-a',
      actorId: 'publisher-a',
      targetEntryId: 'one',
      fromRevisionId: 'one-revision-1',
      toRevisionId: 'one-revision-2',
      resultChecksum: plan.resultChecksum,
      completedAt: now,
    });
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Knowledge' }));
    const panel = await screen.findByRole('region', {
      name: 'Knowledge graph and reviewed agents',
    });
    expect(panel.textContent).toContain('never publish it');
    expect(panel.textContent).toContain('Use a clearer headline.');
    expect(panel.textContent).toContain('headline: Reviewed headline — Clearer.');
    await user.click(within(panel).getByRole('button', { name: 'Explore graph' }));
    expect(await within(panel).findByText('1 nodes · 0 edges · 0 paths')).toBeTruthy();
    expect(explore).toHaveBeenCalledWith(expect.objectContaining({ seedEntryIds: ['one'] }));
    await user.click(within(panel).getByRole('button', { name: 'Approve exact plan' }));
    expect(review).toHaveBeenCalledWith(
      plan.id,
      expect.objectContaining({ expectedVersion: 2, digest: plan.digest, decision: 'approved' }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Execute approved draft patch' }));
    expect(execute).toHaveBeenCalledWith(
      plan.id,
      expect.objectContaining({ expectedVersion: 3, digest: plan.digest }),
    );
  });

  it('shows enterprise identity policy, providers, security events, and one-time credentials', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Identity providers' }));

    const panel = await screen.findByRole('region', {
      name: 'Enterprise identity administration',
    });
    expect(panel.textContent).toContain('Workforce identity');
    expect(panel.textContent).toContain('Session policy');
    expect(panel.textContent).toContain('identity.federation.succeeded');
    await user.click(within(panel).getByRole('button', { name: 'Issue SCIM credential' }));
    expect((await within(panel).findByRole('status')).textContent).toContain(
      'gsc_directory-credential-1.one-time-secret',
    );
    expect(within(panel).getByText(/will not be shown again/i)).toBeTruthy();
  });

  it('previews guarded retention effects and collects independent approval evidence', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Data governance' }));

    const panel = await screen.findByRole('region', { name: 'Data governance administration' });
    expect(panel.textContent).toContain('code rollback cannot restore erased records');
    await user.type(
      within(panel).getByRole('textbox', { name: 'Customer reference' }),
      'customer-123',
    );
    await user.click(within(panel).getByRole('button', { name: 'Register subject' }));
    expect(await within(panel).findByText(/customer-123 · active/)).toBeTruthy();

    await user.click(within(panel).getByRole('button', { name: 'Preview retention plan' }));
    expect(await within(panel).findByText(/delete content:one · eligible/)).toBeTruthy();
    expect(within(panel).getByText('a'.repeat(64))).toBeTruthy();
    expect(
      within(panel).getByRole('textbox', { name: 'Independent approval reason' }),
    ).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Approve irreversible plan' })).toBeTruthy();
  });

  it('previews, confirms, executes, and validates a guarded CMS migration', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Migrations' }));

    const panel = await screen.findByRole('region', { name: 'CMS migration workbench' });
    expect(panel.textContent).toContain('Source adapters are read-only');
    expect(panel.textContent).toContain('Contentful production');

    await user.type(within(panel).getByLabelText('Recipe ID'), 'contentful-page');
    await user.type(within(panel).getByLabelText('Recipe name'), 'Contentful pages');
    await user.type(within(panel).getByLabelText('Source type'), 'contentful.Entry.page');
    await user.click(within(panel).getByRole('button', { name: 'Save next recipe version' }));
    await screen.findByText('Versioned migration recipe saved.');

    await user.type(within(panel).getByLabelText('Project ID'), 'contentful-cutover');
    await user.type(within(panel).getByLabelText('Project name'), 'Website cutover');
    await user.click(within(panel).getByRole('button', { name: 'Create dual-run project' }));
    await screen.findByText('Dual-run migration project created.');

    await user.click(within(panel).getByRole('button', { name: 'Preview next sync' }));
    expect(await within(panel).findByText('d'.repeat(64))).toBeTruthy();
    expect(panel.textContent).toContain('1 create');
    expect(panel.textContent).toContain('contentful-page-1 · create');

    await user.click(
      within(panel).getByRole('checkbox', {
        name: 'I reviewed this exact digest, every effect, and all blockers.',
      }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Execute reviewed plan' }));
    await screen.findByText('Migration plan completed with a durable receipt.');
    expect(panel.textContent).toContain('full · completed');

    await user.click(within(panel).getByRole('button', { name: 'Validate cutover' }));
    expect(await within(panel).findByText('Content checks ready')).toBeTruthy();
    expect(panel.textContent).toContain('1/1 current · 1 published');
  }, 15_000);

  it('explains marketplace evidence boundaries and installs an approved release without grants', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Marketplace' }));

    const panel = await screen.findByRole('region', { name: 'Plugin marketplace workbench' });
    expect(panel.textContent).toContain('A verified badge means domain possession');
    expect(panel.textContent).toContain('neither proves package safety');
    expect(panel.textContent).toContain('Example publisher');
    expect(panel.textContent).toContain('maintained');
    expect(panel.textContent).toContain('content.read');
    expect(panel.textContent).toContain('Signature matches the verified publisher key.');

    await user.click(within(panel).getByRole('button', { name: 'Install disabled · no grants' }));
    expect(await screen.findByText(/installed disabled with no grants/i)).toBeTruthy();
  });

  it('edits, previews, and publishes a consent-aware targeting draft without user impersonation', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Targeting' }));

    const panel = await screen.findByRole('region', {
      name: 'Personalization targeting workbench',
    });
    expect(panel.textContent).toContain('Do not paste names, email addresses, account IDs');
    expect(panel.textContent).toContain('Draft r2');
    const configurationEditor = within(panel).getByLabelText('Targeting configuration JSON');
    expect(configurationEditor).toBeTruthy();
    await user.type(configurationEditor, ' ');
    expect(
      (within(panel).getByRole('button', { name: 'Publish exact draft' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(within(panel).getByRole('button', { name: 'Save targeting draft' }));
    expect(await screen.findByText(/published edge decisions are unchanged/i)).toBeTruthy();

    await user.click(within(panel).getByRole('button', { name: 'Preview draft decision' }));
    const explanation = await within(panel).findByRole('region', {
      name: 'Personalization decision explanation',
    });
    expect(explanation.textContent).toContain('uk · matched');
    expect(explanation.textContent).toContain('Cache: no-store');
    expect(explanation.textContent).toContain('market: matched');

    await user.click(within(panel).getByRole('button', { name: 'Publish exact draft' }));
    expect(await screen.findByText(/Published targeting revision 3/)).toBeTruthy();
  });

  it('runs a governed experiment lifecycle with aggregate evidence and draft-only promotion', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Experiments' }));

    const panel = await screen.findByRole('region', { name: 'Content experiments workbench' });
    expect(panel.textContent).toContain('Do not paste assignment tokens, user rows, cookies');
    expect(panel.textContent).toContain('promotion changes the targeting draft only');
    await user.click(within(panel).getByRole('button', { name: 'Save experiment draft' }));
    expect(
      await screen.findByText(/Published targeting and live allocation are unchanged/i),
    ).toBeTruthy();
    expect(panel.textContent).toContain('Homepage hero copy · draft');

    const reason = within(panel).getByLabelText('Lifecycle or promotion reason');
    await user.type(reason, 'Start the reviewed allocation.');
    await user.click(within(panel).getByRole('button', { name: 'Start experiment' }));
    expect(await screen.findByText('Experiment started.')).toBeTruthy();
    expect(
      (within(panel).getByLabelText('Experiment design JSON') as HTMLTextAreaElement).disabled,
    ).toBe(true);

    await user.type(reason, 'Pause for an operator review.');
    await user.click(within(panel).getByRole('button', { name: 'Pause experiment' }));
    expect(await screen.findByText('Experiment paused.')).toBeTruthy();
    await user.type(reason, 'Resume after the operator review.');
    await user.click(within(panel).getByRole('button', { name: 'Resume experiment' }));
    expect(await screen.findByText('Experiment resumed.')).toBeTruthy();

    await user.click(within(panel).getByRole('button', { name: 'Record aggregate snapshot' }));
    expect(await screen.findByText(/guardrails evaluated/i)).toBeTruthy();
    expect(panel.textContent).toContain('Guardrails: passed');

    await user.type(reason, 'Minimum duration and evidence reviewed.');
    await user.click(within(panel).getByRole('button', { name: 'Complete experiment' }));
    expect(await screen.findByText('Experiment completed.')).toBeTruthy();

    await user.type(reason, 'Promote the supported treatment for publisher review.');
    await user.click(within(panel).getByRole('button', { name: 'Promote winner to draft' }));
    expect(
      await screen.findByText(/Supported winner promoted to targeting draft only/i),
    ).toBeTruthy();
    expect(panel.textContent).toContain('Homepage hero copy · promoted');
    expect(panel.textContent).toContain('Draft promotion: uk');
  }, 15_000);

  it('operates governed generation, reviewed proposals, unsaved handoff, and semantic search', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'AI gateway' }));
    const panel = await screen.findByRole('region', { name: 'Governed AI gateway workbench' });
    expect(panel.textContent).toContain('Retrieved fields and AI output are untrusted');
    expect(panel.textContent).toContain('Gateway disabled');

    await user.click(within(panel).getByRole('button', { name: 'Save AI policy' }));
    expect(await screen.findByText('AI model and daily budget policy saved.')).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Create prompt version' }));
    expect(await screen.findByText('Immutable AI prompt version created.')).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Activate exact prompt' }));
    expect(await screen.findByText('Exact AI prompt version activated.')).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Enable AI gateway' }));
    expect(await screen.findByText(/AI gateway enabled.*In-flight responses/i)).toBeTruthy();

    const authoringPolicy = within(panel).getByLabelText('Authoring policy JSON');
    const configuredAuthoring = JSON.parse((authoringPolicy as HTMLTextAreaElement).value);
    fireEvent.change(authoringPolicy, {
      target: {
        value: JSON.stringify({
          ...configuredAuthoring,
          state: 'enabled',
          semantic: {
            enabled: true,
            adapterId: 'semantic-test',
            modelId: 'embedding-small',
            perspectives: ['draft'],
            maximumResults: 10,
            minimumScore: 0,
            rules: [{ contentType: 'page', fieldPaths: ['headline', 'path'] }],
          },
        }),
      },
    });
    await user.click(within(panel).getByRole('button', { name: 'Save authoring policy' }));
    expect(await screen.findByText('AI authoring and semantic policy saved.')).toBeTruthy();

    await user.click(within(panel).getByRole('button', { name: 'Generate evaluated proposal' }));
    expect(await within(panel).findByText(/pending-review · improve-title/i)).toBeTruthy();
    expect(await screen.findByText(/content is unchanged/i)).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Approve proposal' }));
    expect(await within(panel).findByText(/approved · improve-title/i)).toBeTruthy();

    await user.type(within(panel).getByLabelText('Bounded semantic query'), 'related homepage');
    await user.click(within(panel).getByRole('button', { name: 'Search private semantic index' }));
    const semantic = await within(panel).findByRole('region', { name: 'Semantic search results' });
    expect(semantic.textContent).toContain('semantic-test/embedding-small');
    expect(semantic.textContent).toContain('No authorized matches.');

    await user.click(within(panel).getByRole('button', { name: 'Generate untrusted output' }));
    const result = await within(panel).findByRole('region', { name: 'Untrusted AI result' });
    expect(result.textContent).toContain('Untrusted output · review required');
    expect(result.textContent).toContain('A bounded editorial summary.');
    expect(await screen.findByText(/no content was changed/i)).toBeTruthy();

    await user.click(within(panel).getByRole('button', { name: 'Use as unsaved editor changes' }));
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    expect(((await screen.findByLabelText('Headline')) as HTMLInputElement).value).toBe(
      'AI reviewed headline',
    );
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('keeps preview out of the workspace and places its only launcher in the Studio header', async () => {
    const client = createTestClient();
    const pendingEntry = Promise.withResolvers<ContentEntry>();
    vi.spyOn(client, 'getContent').mockReturnValueOnce(pendingEntry.promise);
    render(<App client={client} />);

    const popout = (await screen.findByRole('button', {
      name: 'Open live preview in new window',
    })) as HTMLButtonElement;
    expect(popout.disabled).toBe(true);
    expect(popout.closest('.studio-header')).toBeTruthy();
    expect(document.querySelector('.preview-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'App iframe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Standalone' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Preview perspective' })).toBeNull();
    await act(async () => {
      pendingEntry.resolve(entries[0] as ContentEntry);
    });
    await screen.findByLabelText('Headline');
    expect(popout.disabled).toBe(false);
  });

  it('opens and revokes a preview-only window from the Studio header', async () => {
    const user = userEvent.setup();
    const replace = vi.fn();
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace },
      postMessage: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const client = createTestClient();
    const revokePreviewSession = vi.spyOn(client, 'revokePreviewSession');
    const pendingEntry = Promise.withResolvers<ContentEntry>();
    vi.spyOn(client, 'getContent').mockReturnValueOnce(pendingEntry.promise);
    render(<App client={client} />);

    const popout = (await screen.findByRole('button', {
      name: 'Open live preview in new window',
    })) as HTMLButtonElement;
    expect(popout.disabled).toBe(true);
    await act(async () => {
      pendingEntry.resolve(entries[0] as ContentEntry);
    });
    await screen.findByLabelText('Headline');
    expect(popout.disabled).toBe(false);
    expect(popout.querySelector('svg')).toBeTruthy();
    await user.click(popout);
    expect(open).toHaveBeenCalledWith(
      'about:blank',
      'gridstory-standalone-preview',
      'popup,width=1280,height=900',
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('http://localhost:5174/'));
    const closePreview = screen.getByRole('button', { name: 'Close live preview window' });
    expect(closePreview.getAttribute('aria-pressed')).toBe('true');
    expect(closePreview.closest('.studio-header')).toBeTruthy();
    await user.click(closePreview);
    await waitFor(() => expect(popup.close).toHaveBeenCalled());
    await waitFor(() => expect(revokePreviewSession).toHaveBeenCalledWith('preview-session-1'));
    expect(
      screen
        .getByRole('button', { name: 'Open live preview in new window' })
        .getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('never connects a late preview grant after entry replacement and reports failed revocation', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const grant = await client.createPreviewSession({
      previewUrl: 'http://localhost:5174/',
      mode: 'standalone',
      entryId: 'one',
    });
    let resolve!: (value: typeof grant) => void;
    vi.spyOn(client, 'createPreviewSession').mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const revoke = vi
      .spyOn(client, 'revokePreviewSession')
      .mockRejectedValue(new Error('Revocation unavailable'));
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Open live preview in new window' }));
    await user.click(screen.getByRole('button', { name: /Second page/ }));
    await waitFor(() =>
      expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Second page'),
    );
    expect(popup.close).toHaveBeenCalled();
    resolve(grant);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(grant.sessionId));
    await screen.findByText(/unused preview session could not be revoked/);
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(popup.postMessage).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain(grant.sessionId);
    expect(JSON.stringify(window.history.state)).not.toContain(grant.token);
  });

  it('preserves same-entry preview and disposes before another entry can be patched', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(previewClient.GridStoryPreviewController.prototype, 'patch');
    const dispose = vi.spyOn(previewClient.GridStoryPreviewController.prototype, 'dispose');
    const client = createTestClient();
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const revoke = vi.spyOn(client, 'revokePreviewSession');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={client} />);
    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Open live preview in new window' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Headline'), {
      target: { value: 'Secret unsaved headline' },
    });
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const panel = await screen.findByRole('region', { name: 'Search and discovery' });
    await user.click(await within(panel).findByRole('button', { name: 'Second page' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(popup.close).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/search?entry=one&type=page');
    expect(JSON.stringify(window.history.state)).not.toContain('Secret unsaved headline');
    confirm.mockReturnValue(true);
    await user.click(within(panel).getByRole('button', { name: 'Second page' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Second page'),
    );
    expect(dispose).toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('preview-session-1');
    expect(patch.mock.calls.every(([payload]) => payload.entryId === 'one')).toBe(true);
  });

  it('queries supported list controls while keeping an open editor selection stable', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    const headline = await screen.findByLabelText('Headline');
    expect(headline).toHaveProperty('value', 'First page');
    const results = screen.getByRole('region', { name: 'Content results' });
    expect(within(results).getByRole('button', { name: /First page/ })).toBeTruthy();
    await user.type(screen.getByLabelText('Search title or slug'), 'Second');
    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    await user.selectOptions(screen.getByLabelText('Sort'), 'title-desc');
    await user.click(screen.getByRole('button', { name: 'Apply list view' }));

    await waitFor(() =>
      expect(within(results).queryByRole('button', { name: /First page/ })).toBeNull(),
    );
    expect(within(results).getByRole('button', { name: /Second page/ })).toBeTruthy();
    expect(headline).toHaveProperty('value', 'First page');
    expect(screen.getByText('Showing 1 of 1')).toBeTruthy();

    await user.click(screen.getByText('Local saved views (0)'));
    await user.type(screen.getByLabelText('View name'), 'Draft seconds');
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    expect(await screen.findByRole('button', { name: 'Draft seconds' })).toBeTruthy();
    const persisted = window.localStorage.getItem('gridstory-content-list-views.v1') ?? '';
    expect(persisted).toContain('Draft seconds');
    expect(persisted).not.toContain('First hero');
    expect(persisted).not.toMatch(/gsp_|bearer|credential/i);
  });

  it('paginates exact query results without replacing a selection outside the loaded page', async () => {
    const user = userEvent.setup();
    const manyEntries = Array.from({ length: 12 }, (_, index) =>
      entry(
        `page-${String(index + 1).padStart(2, '0')}`,
        `Page ${String(index + 1).padStart(2, '0')}`,
        `page-${index + 1}`,
      ),
    );
    render(<App client={createTestClient({ entries: manyEntries })} />);

    const headline = await screen.findByLabelText('Headline');
    expect(headline).toHaveProperty('value', 'Page 01');
    expect(screen.getByText('Showing 10 of 12')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Showing 2 of 12');
    expect(headline).toHaveProperty('value', 'Page 01');
    expect(screen.getByRole('button', { name: /Page 11/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Page 01/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Showing 10 of 12');
    expect(screen.getByRole('button', { name: /Page 01/ }).getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('keeps prior list results and offers retry when a list query fails', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient({ queryFailsAfter: 1 })} />);

    await screen.findByLabelText('Headline');
    await user.type(screen.getByLabelText('Search title or slug'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Apply list view' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Content list unavailable.');
    expect(screen.getByRole('button', { name: /First page/ })).toBeTruthy();
    expect(within(alert).getByRole('button', { name: 'Retry list' })).toBeTruthy();
  });

  it('edits nested compositions through layers, slots, keyboard movement, and history', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    const secondHeroLayer = screen.getByRole('button', { name: /Hero.*one-hero-b/ });
    await user.click(secondHeroLayer);
    await user.keyboard('{ArrowUp}');
    expect(
      screen
        .getAllByLabelText('Heading')
        .slice(0, 2)
        .map((control) => (control as HTMLInputElement).value),
    ).toEqual(['Second hero', 'First hero']);

    await user.click(screen.getByRole('button', { name: 'Undo composition change' }));
    expect(
      screen
        .getAllByLabelText('Heading')
        .slice(0, 2)
        .map((control) => (control as HTMLInputElement).value),
    ).toEqual(['First hero', 'Second hero']);

    await user.click(screen.getByRole('button', { name: '+ Stack' }));
    const stackInspector = screen.getByRole('region', {
      name: 'Selected component inspector',
    });
    expect(within(stackInspector).getByRole('heading', { name: 'Stack' })).toBeTruthy();

    fireEvent.dragStart(screen.getByRole('button', { name: /Hero.*one-hero-b/ }));
    fireEvent.drop(within(stackInspector).getByText('Drop a layer into Content · keyboard help'));
    expect(screen.getByRole('button', { name: /Hero.*content.*one-hero-b/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Undo composition change' }));
    expect(screen.getByRole('button', { name: /Hero.*one-hero-b/ }).textContent).not.toContain(
      'content',
    );
    await user.click(screen.getByRole('button', { name: 'Redo composition change' }));
    expect(screen.getByRole('button', { name: /Hero.*content.*one-hero-b/ })).toBeTruthy();
  });

  it('binds variants and tokens, captures responsive values, and inserts governed reuse', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: /Hero.*one-hero-b/ }));
    let inspector = screen.getByRole('region', { name: 'Selected component inspector' });
    await user.selectOptions(within(inspector).getByLabelText('Component variant'), 'hero.sunrise');
    const toneToken = within(inspector).getByLabelText('Tone token') as HTMLSelectElement;
    expect(Array.from(toneToken.options).map((option) => option.textContent)).not.toContain(
      'Section spacing',
    );
    await user.selectOptions(toneToken, 'tone.brand');

    const breakpointPicker = within(inspector).getByLabelText('Responsive override');
    await user.selectOptions(breakpointPicker, 'mobile');
    const headingBinding = within(inspector)
      .getByLabelText('Heading token')
      .closest('.binding-row');
    expect(headingBinding).toBeTruthy();
    await user.click(
      within(headingBinding as HTMLElement).getByRole('button', { name: 'Capture for mobile' }),
    );
    const heading = within(inspector).getByLabelText('Heading');
    await user.clear(heading);
    await user.type(heading, 'Wide hero');
    expect((heading as HTMLInputElement).value).toBe('Wide hero');
    await user.click(
      within(headingBinding as HTMLElement).getByRole('button', { name: 'Clear mobile' }),
    );
    expect((heading as HTMLInputElement).value).toBe('Wide hero');
    await user.selectOptions(breakpointPicker, 'desktop');
    expect((heading as HTMLInputElement).value).toBe('Wide hero');

    await user.click(screen.getByRole('button', { name: '+ Portability callout' }));
    inspector = screen.getByRole('region', { name: 'Selected component inspector' });
    expect(inspector.textContent).toContain('Linked to Portability callout');
    expect(within(inspector).queryByLabelText('Tone')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Apply Campaign page' }));
    expect(screen.getByText('6 components')).toBeTruthy();
  }, 10_000);
  it('authors rich text, assets, references, inline props, and scoped collaboration', async () => {
    const user = userEvent.setup();
    render(
      <App client={createTestClient({ schema: authoringSchema, entries: authoringEntries })} />,
    );

    await screen.findByLabelText('Headline');
    const story = screen.getByRole('region', { name: 'Editorial story' });
    await user.click(within(story).getByRole('button', { name: '+ heading' }));
    const headingBlock = within(story).getByLabelText('Editorial story heading block 1');
    fireEvent.change(headingBlock, { target: { value: 'A semantic story' } });

    const asset = screen.getByRole('region', { name: 'Social image' });
    const assetOption = within(asset).getByRole('button', { name: /Campaign landscape/ });
    expect(assetOption.className).toBe('button button--outline button--option-card');
    expect(assetOption.getAttribute('aria-pressed')).toBe('false');
    await user.click(assetOption);
    expect(assetOption.getAttribute('aria-pressed')).toBe('true');
    expect(within(asset).getByLabelText('Alternative text')).toBeTruthy();
    expect(within(asset).getByRole('button', { name: 'Clear asset' }).className).toBe(
      'button button--secondary button--compact',
    );

    const relations = screen.getByRole('region', { name: 'Related pages' });
    const relationOption = within(relations).getByRole('button', { name: /Second page/ });
    expect(relationOption.className).toBe('button button--outline button--option-card');
    expect(relationOption.getAttribute('aria-pressed')).toBe('false');
    await user.click(relationOption);
    expect(relationOption.getAttribute('aria-pressed')).toBe('true');
    expect(relations.textContent).toContain('1 selected / 2');
    expect(document.querySelectorAll('.authoring-field button:not([class])')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Hero.*one-hero-a/ }));
    const componentInspector = screen.getByRole('region', {
      name: 'Selected component inspector',
    });
    const componentHeading = within(componentInspector).getByLabelText('Heading');
    fireEvent.change(componentHeading, { target: { value: 'Edited in the component inspector' } });
    expect((componentHeading as HTMLInputElement).value).toBe('Edited in the component inspector');
    expect(screen.queryByRole('region', { name: 'Inline component editor' })).toBeNull();

    await waitFor(() => expect(screen.getByText(/Studio editor/)).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Shared field or block'), 'headline');
    await user.click(screen.getByRole('button', { name: 'Share current value' }));
    await waitFor(() => expect(screen.getByText(/1 operations/)).toBeTruthy());
    await user.type(screen.getByLabelText('New branch from current'), 'Campaign branch');
    await user.click(screen.getByRole('button', { name: 'Create branch' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Working branch') as HTMLSelectElement).value).toBe('branch-1'),
    );
    await user.type(screen.getByLabelText('Proposed value'), 'A collaborative headline');
    await user.click(screen.getByRole('button', { name: 'Open suggestion' }));
    const suggestions = await screen.findByRole('region', { name: 'Suggestions' });
    expect(suggestions.textContent).toContain('A collaborative headline');
    const acceptSuggestion = within(suggestions).getByRole('button', { name: 'Accept' });
    const rejectSuggestion = within(suggestions).getByRole('button', { name: 'Reject' });
    expect(acceptSuggestion.className).toContain('button--primary');
    expect(rejectSuggestion.className).toContain('button--danger');
    await user.click(acceptSuggestion);
    await waitFor(() => expect(suggestions.textContent).toContain('accepted'));
    await user.click(screen.getByRole('button', { name: 'Merge into Main' }));
    const conflict = await screen.findByRole('region', { name: 'Merge conflicts' });
    expect(conflict.textContent).toContain('A collaborative headline');
    await user.click(within(conflict).getByRole('button', { name: /branch-1/ }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Merge conflicts' })).toBeNull(),
    );

    await user.selectOptions(screen.getByLabelText('Comment target'), 'story');
    fireEvent.change(screen.getByLabelText('New comment'), {
      target: { value: 'Please check this, @reviewer' },
    });
    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: 'reviewer' } });
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(screen.getByText('Mentioned: reviewer')).toBeTruthy());
    const thread = screen.getByText('Assigned to reviewer').closest('.comment-thread');
    expect(thread?.textContent).toContain('story');
    expect(thread?.textContent).not.toContain('one-hero-a');
    expect(
      within(thread as HTMLElement).getByRole('button', { name: 'Resolve' }).className,
    ).toContain('button--secondary');
    expect(
      within(thread as HTMLElement).getByRole('button', { name: 'Reply' }).className,
    ).toContain('button--secondary');
  }, 30_000);

  it('shows scoped component usage and visual regression hooks in governance', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Components' }));
    const governance = await screen.findByRole('region', { name: 'Governed design catalog' });
    expect(governance.textContent).toContain('4 scoped usages across 2 entries');
    expect(within(governance).getByText('Code scenarios').nextElementSibling?.textContent).toBe(
      '1',
    );
    expect(governance.textContent).toContain('data-gridstory-version');
  });

  it('loads the governed design manifest only when Components opens from Home (BUG-0515)', async () => {
    window.history.replaceState(null, '', '/');
    const user = userEvent.setup();
    const client = createTestClient({
      context: restrictedContext([...studioOperations], [...studioScreens]),
    });
    const getDesignSystem = vi.spyOn(client, 'getDesignSystem');
    render(<App client={client} />);

    await screen.findByRole('region', { name: 'Editorial Home' });
    expect(getDesignSystem).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Components' }));
    await screen.findByRole('region', { name: 'Governed design catalog' });
    expect(getDesignSystem).toHaveBeenCalledOnce();
  });

  it('loads canonical schema lifecycle, taxonomy, and permitted impact only when the catalog opens from Home', async () => {
    window.history.replaceState(null, '', '/');
    const user = userEvent.setup();
    const client = createTestClient({
      context: restrictedContext([...studioOperations], [...studioScreens]),
    });
    const lifecycle = vi.spyOn(client, 'getSchemaLifecycle');
    const drift = vi.spyOn(client, 'getSchemaDrift');
    const taxonomies = vi.spyOn(client, 'listTaxonomies');
    const impact = vi.spyOn(client, 'planSchema');
    render(<App client={client} />);

    await screen.findByRole('region', { name: 'Editorial Home' });
    expect(lifecycle).not.toHaveBeenCalled();
    expect(drift).not.toHaveBeenCalled();
    expect(taxonomies).not.toHaveBeenCalled();
    expect(impact).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Schemas & taxonomies' }));
    const catalog = await screen.findByRole('region', { name: 'Schema and taxonomy catalog' });
    expect(within(catalog).getByText('Code-owned · read-only')).toBeTruthy();
    expect(within(catalog).getByText('In sync')).toBeTruthy();
    expect(within(catalog).getByText('Hierarchical categories')).toBeTruthy();
    expect(
      within(catalog).getByText(
        `Plan migration-current-source · assessment only · no activation action`,
      ),
    ).toBeTruthy();
    expect(lifecycle).toHaveBeenCalledOnce();
    expect(drift).toHaveBeenCalledOnce();
    expect(taxonomies).toHaveBeenCalledOnce();
    expect(impact).toHaveBeenCalledOnce();
  });

  it('keeps taxonomy and impact requests absent when schema-only access opens the catalog', async () => {
    window.history.replaceState(null, '', '/');
    const user = userEvent.setup();
    const client = createTestClient({
      context: restrictedContext(['home.read', 'schema.read'], ['home', 'schemas']),
    });
    const taxonomies = vi.spyOn(client, 'listTaxonomies');
    const impact = vi.spyOn(client, 'planSchema');
    render(<App client={client} />);

    await screen.findByRole('region', { name: 'Editorial Home' });
    await user.click(screen.getByRole('button', { name: 'Schemas & taxonomies' }));
    const catalog = await screen.findByRole('region', { name: 'Schema and taxonomy catalog' });
    expect(within(catalog).getByText(/No taxonomy request was sent/)).toBeTruthy();
    expect(
      within(catalog).getByText(/does not request or imply deployment authority/),
    ).toBeTruthy();
    expect(taxonomies).not.toHaveBeenCalled();
    expect(impact).not.toHaveBeenCalled();
  });

  it('browses immutable design choices and inserts a pattern through the existing editor command', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Components' }));
    const catalog = await screen.findByRole('region', { name: 'Governed design catalog' });
    expect(
      within(catalog).getByRole('heading', { name: 'GridStory Example Design System' }),
    ).toBeTruthy();
    expect(within(catalog).getByRole('group', { name: 'Design ownership' }).textContent).toContain(
      'gridstory.example · version 1',
    );
    expect(catalog.textContent).toContain('Code-owned · read-only');
    expect(within(catalog).getByRole('heading', { name: 'Tokens (3)' })).toBeTruthy();
    expect(within(catalog).getByRole('heading', { name: 'Breakpoints (3)' })).toBeTruthy();
    expect(within(catalog).getByRole('heading', { name: 'Variants (3)' })).toBeTruthy();
    expect(within(catalog).getByRole('button', { name: 'Insert Campaign page' })).toBeTruthy();

    await user.selectOptions(
      within(catalog).getByLabelText('Inspect component'),
      'gridstory.callout',
    );
    await within(catalog).findByRole('article', { name: 'Callout contract' });
    expect(catalog.textContent).toContain('0 scoped usages across 0 entries');

    await user.click(within(catalog).getByRole('button', { name: 'Insert Portability callout' }));
    await user.click(screen.getByRole('button', { name: 'Pages' }));
    expect(await screen.findByText('3 components')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('shows a retryable catalog error without losing the Components destination', async () => {
    window.history.replaceState(null, '', '/');
    const user = userEvent.setup();
    const client = createTestClient({
      context: restrictedContext([...studioOperations], [...studioScreens]),
    });
    const getDesignSystem = vi
      .spyOn(client, 'getDesignSystem')
      .mockRejectedValueOnce(new Error('Design registry unavailable.'));
    render(<App client={client} />);

    await screen.findByRole('region', { name: 'Editorial Home' });
    await user.click(screen.getByRole('button', { name: 'Components' }));
    const catalog = await screen.findByRole('region', { name: 'Governed design catalog' });
    expect(within(catalog).getByRole('alert').textContent).toContain(
      'Design registry unavailable.',
    );
    expect(screen.getByRole('button', { name: 'Components' }).getAttribute('aria-current')).toBe(
      'page',
    );
    await user.click(within(catalog).getByRole('button', { name: 'Retry design catalog' }));
    await within(catalog).findByRole('heading', { name: 'Tokens (3)' });
    expect(getDesignSystem).toHaveBeenCalledTimes(2);
  });

  it('keeps approved pattern insertion disabled for component-read-only access', async () => {
    const user = userEvent.setup();
    render(
      <App
        client={createTestClient({
          context: restrictedContext(
            ['pages.list', 'content.read', 'schema.read', 'component.read'],
            ['pages', 'components'],
          ),
        })}
      />,
    );

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Components' }));
    const catalog = await screen.findByRole('region', { name: 'Governed design catalog' });
    expect(within(catalog).getByText('Unsaved target: First page')).toBeTruthy();
    expect(
      within(catalog).getByRole('button', { name: 'Insert Portability callout' }),
    ).toHaveProperty('disabled', true);
    expect(within(catalog).getByRole('button', { name: 'Insert Campaign page' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('loads managed assets into the responsive library and field picker', async () => {
    const user = userEvent.setup();
    const asset = managedAsset();
    render(
      <App
        client={createTestClient({
          schema: authoringSchema,
          entries: authoringEntries,
          assets: [asset],
        })}
      />,
    );

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.getByRole('heading', { name: 'Asset library' })).toBeTruthy();
    const details = screen.getByRole('article', { name: 'Managed hero asset details' });
    expect((within(details).getByLabelText('Horizontal (0–1)') as HTMLInputElement).value).toBe(
      '0.25',
    );
    expect(within(details).getByText('verified')).toBeTruthy();
    expect(within(details).getByText('clean')).toBeTruthy();
    await user.click(within(details).getByRole('button', { name: 'Inspect usage' }));
    expect(await within(details).findByText('2 references across 1 entries')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Pages' }));
    const picker = screen.getByRole('region', { name: 'Social image' });
    await user.click(within(picker).getByRole('button', { name: /Managed hero/ }));
    expect((within(picker).getByLabelText('Alternative text') as HTMLInputElement).value).toBe(
      'Managed alt',
    );
  });

  it('filters the loaded scope and blocks unsafe asset delivery and renditions', async () => {
    const user = userEvent.setup();
    const verified = managedAsset();
    const verifiedRevision = verified.revisions[0];
    if (!verifiedRevision?.security) throw new Error('Verified test asset is incomplete.');
    const quarantinedRevision = {
      ...verifiedRevision,
      id: 'blocked-file-v1',
      original: {
        ...verifiedRevision.original,
        objectKey: 'assets/blocked-file.pdf',
        filename: 'blocked-file.pdf',
        mediaType: 'application/pdf',
      },
      metadata: { ...verifiedRevision.metadata, title: 'Blocked contract', tags: ['legal'] },
      focalPoint: undefined,
      security: {
        ...verifiedRevision.security,
        status: 'quarantined' as const,
        declaredMediaType: 'application/pdf',
        detectedMediaType: 'application/x-msdownload',
        malware: { status: 'infected' as const, provider: 'test-scanner', checkedAt: now },
        findings: ['Declared and detected media types do not match.'],
      },
    };
    const quarantined = managedAsset({
      id: 'blocked-file',
      kind: 'file',
      currentRevisionId: quarantinedRevision.id,
      revisions: [quarantinedRevision],
    });
    render(<App client={createTestClient({ assets: [verified, quarantined] })} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.getByText('Showing 2 of 2 loaded scoped assets.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Security state'), 'quarantined');
    expect(screen.getByText('Showing 1 of 2 loaded scoped assets.')).toBeTruthy();
    const details = screen.getByRole('article', { name: 'Blocked contract asset details' });
    expect(
      within(details).getByText('Declared and detected media types do not match.'),
    ).toBeTruthy();
    expect(
      (within(details).getByRole('button', { name: 'Open private delivery' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(within(details).getByText(/Renditions require an image with a verified/)).toBeTruthy();
    await user.type(screen.getByLabelText('Search loaded assets'), 'nothing-here');
    expect(screen.getByText('Showing 0 of 2 loaded scoped assets.')).toBeTruthy();
    expect(screen.getByText('No loaded assets match these filters.')).toBeTruthy();
  });

  it('creates immutable metadata revisions and verified image renditions', async () => {
    const user = userEvent.setup();
    const asset = managedAsset();
    const revision = asset.revisions[0];
    if (!revision) throw new Error('Asset revision is required.');
    const updated: AssetRecord = {
      ...asset,
      currentRevisionId: 'managed-hero-v2',
      revisions: [
        ...asset.revisions,
        {
          ...revision,
          id: 'managed-hero-v2',
          version: 2,
          metadata: {
            ...revision.metadata,
            title: 'Updated managed hero',
            tags: ['homepage', 'new'],
          },
        },
      ],
    };
    const client = createTestClient({ assets: [asset] });
    const update = vi.spyOn(client, 'updateAsset').mockResolvedValue(updated);
    const rendition = {
      id: 'rendition-web',
      preset: {
        id: 'web',
        width: 1200,
        fit: 'cover' as const,
        format: 'webp' as const,
        quality: 80,
      },
      object: {
        ...revision.original,
        objectKey: 'renditions/managed-hero-web.webp',
        url: 'https://cdn.example.test/renditions/managed-hero-web.webp',
        filename: 'managed-hero-web.webp',
        mediaType: 'image/webp',
      },
      createdAt: now,
    };
    const createRendition = vi.spyOn(client, 'createAssetRendition').mockResolvedValue(rendition);
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Updated managed hero');
    await user.clear(screen.getByLabelText('Tags (comma separated)'));
    await user.type(screen.getByLabelText('Tags (comma separated)'), 'homepage, new, homepage');
    await user.click(screen.getByRole('button', { name: 'Save metadata' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      metadata: { title: 'Updated managed hero', tags: ['homepage', 'new'] },
      focalPoint: { x: 0.25, y: 0.75 },
    });
    expect(
      await screen.findByRole('heading', { name: 'Updated managed hero details' }),
    ).toBeTruthy();
    expect(screen.getByText('Version 2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Create rendition' }));
    await waitFor(() =>
      expect(createRendition).toHaveBeenCalledExactlyOnceWith('managed-hero', {
        id: 'web',
        width: 1200,
        fit: 'cover',
        format: 'webp',
        quality: 80,
      }),
    );
    expect(
      await screen.findByText('Rendition created from the current verified revision.'),
    ).toBeTruthy();
    expect(screen.getByText('1200 × auto · webp · 4.0 KB')).toBeTruthy();
  });

  it('opens a signed private delivery without rendering or persisting its grant URL', async () => {
    const user = userEvent.setup();
    const asset = managedAsset();
    const client = createTestClient({ assets: [asset] });
    const grantUrl = 'https://gridstory.test/api/v1/assets/managed-hero/content?token=secret';
    const delivery = vi.spyOn(client, 'createAssetDelivery').mockResolvedValue({
      assetId: asset.id,
      revisionId: asset.currentRevisionId,
      url: grantUrl,
      expiresAt: '2026-07-17T00:05:00.000Z',
    });
    const replace = vi.fn();
    const close = vi.fn();
    const popup = {
      closed: false,
      close,
      location: { replace },
      opener: window,
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    await user.click(screen.getByRole('button', { name: 'Open private delivery' }));
    await waitFor(() =>
      expect(delivery).toHaveBeenCalledExactlyOnceWith('managed-hero', {
        revisionId: 'managed-hero-v1',
        ttlSeconds: 300,
      }),
    );
    expect(replace).toHaveBeenCalledExactlyOnceWith(grantUrl);
    expect(document.body.textContent).not.toContain(grantUrl);
    expect(JSON.stringify(window.localStorage)).not.toContain(grantUrl);
    expect(close).not.toHaveBeenCalled();
  });

  it('chunks browser files by the resumable upload part size', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const uploadSession: AssetUploadSession = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      id: 'upload-1',
      storageUploadId: 'storage-upload-1',
      filename: 'ten-bytes.bin',
      mediaType: 'application/octet-stream',
      size: 10,
      kind: 'file',
      state: 'pending',
      partSize: 4,
      parts: [],
      createdAt: now,
      expiresAt: '2026-07-25T00:00:00.000Z',
    };
    vi.spyOn(client, 'startAssetUpload').mockResolvedValue(uploadSession);
    const uploadPart = vi
      .spyOn(client, 'uploadAssetPart')
      .mockImplementation(async (_uploadId, partNumber, body) => ({
        partNumber,
        etag: `etag-${partNumber}`,
        size: body.byteLength,
      }));
    const complete = vi.spyOn(client, 'completeAssetUpload').mockResolvedValue(undefined as never);
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const file = new File([bytes], 'ten-bytes.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });

    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(uploadPart).toHaveBeenCalledTimes(3);
    expect(uploadPart.mock.calls.map((call) => call[2].byteLength)).toEqual([4, 4, 2]);
    expect(complete.mock.calls[0]?.[1].map((part) => part.size)).toEqual([4, 4, 2]);
  });

  it('selects the completed upload once without depending on list order', async () => {
    const user = userEvent.setup();
    const existing = managedAsset();
    const baseRevision = existing.revisions[0];
    if (!baseRevision) throw new Error('Asset revision is required.');
    const completed = managedAsset({
      id: 'new-upload',
      kind: 'file',
      currentRevisionId: 'new-upload-v1',
      revisions: [
        {
          ...baseRevision,
          id: 'new-upload-v1',
          original: {
            ...baseRevision.original,
            objectKey: 'assets/new-upload.bin',
            filename: 'new-upload.bin',
            mediaType: 'application/octet-stream',
            size: 4,
          },
          metadata: { ...baseRevision.metadata, title: 'New upload' },
        },
      ],
    });
    const client = createTestClient({
      context: selectableContext(),
      assets: [existing, completed],
    });
    const uploadSession: AssetUploadSession = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      id: 'upload-select',
      storageUploadId: 'storage-upload-select',
      filename: 'new-upload.bin',
      mediaType: 'application/octet-stream',
      size: 4,
      kind: 'file',
      state: 'pending',
      partSize: 4,
      parts: [],
      createdAt: now,
      expiresAt: '2026-07-25T00:00:00.000Z',
    };
    vi.spyOn(client, 'startAssetUpload').mockResolvedValue(uploadSession);
    vi.spyOn(client, 'uploadAssetPart').mockResolvedValue({
      partNumber: 1,
      etag: 'etag-1',
      size: 4,
    });
    vi.spyOn(client, 'completeAssetUpload').mockResolvedValue(completed);
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.getByRole('heading', { name: 'Managed hero details' })).toBeTruthy();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], 'new-upload.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'New upload details' })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Site')).toHaveProperty('disabled', false));
    await user.click(
      within(screen.getByRole('region', { name: 'Loaded assets' })).getByRole('button', {
        name: /Managed hero/,
      }),
    );
    expect(screen.getByRole('heading', { name: 'Managed hero details' })).toBeTruthy();
  });

  it('resumes a failed upload from the server-reported completed parts', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const uploadSession: AssetUploadSession = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      id: 'upload-resume',
      storageUploadId: 'storage-upload-resume',
      filename: 'resume.bin',
      mediaType: 'application/octet-stream',
      size: 10,
      kind: 'file',
      state: 'pending',
      partSize: 4,
      parts: [],
      createdAt: now,
      expiresAt: '2026-07-25T00:00:00.000Z',
    };
    const firstPart = { partNumber: 1, etag: 'etag-1', size: 4 };
    vi.spyOn(client, 'startAssetUpload').mockResolvedValue(uploadSession);
    const getUpload = vi.spyOn(client, 'getAssetUpload').mockResolvedValue({
      ...uploadSession,
      state: 'uploading',
      parts: [firstPart],
    });
    let failedSecondPart = false;
    const uploadPart = vi
      .spyOn(client, 'uploadAssetPart')
      .mockImplementation(async (_uploadId, partNumber, body) => {
        if (partNumber === 2 && !failedSecondPart) {
          failedSecondPart = true;
          throw new Error('Temporary upload interruption.');
        }
        return { partNumber, etag: `etag-${partNumber}`, size: body.byteLength };
      });
    const complete = vi.spyOn(client, 'completeAssetUpload').mockResolvedValue(undefined as never);
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const file = new File([bytes], 'resume.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });

    expect(await screen.findByText(/Upload paused: Temporary upload interruption/)).toBeTruthy();
    expect(screen.getByText('Upload paused')).toBeTruthy();
    expect(screen.getByLabelText('Upload asset')).toHaveProperty('disabled', true);
    expect(complete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry upload' }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(getUpload).toHaveBeenCalledExactlyOnceWith('upload-resume');
    expect(uploadPart.mock.calls.map((call) => call[1])).toEqual([1, 2, 2, 3]);
    expect(complete.mock.calls[0]?.[1].map((part) => part.size)).toEqual([4, 4, 2]);
  });

  it('does not restore or complete an upload after a late part settles following abort', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const uploadSession: AssetUploadSession = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      id: 'upload-abort-race',
      storageUploadId: 'storage-upload-abort-race',
      filename: 'abort.bin',
      mediaType: 'application/octet-stream',
      size: 4,
      kind: 'file',
      state: 'pending',
      partSize: 4,
      parts: [],
      createdAt: now,
      expiresAt: '2026-07-25T00:00:00.000Z',
    };
    vi.spyOn(client, 'startAssetUpload').mockResolvedValue(uploadSession);
    const pendingPart = Promise.withResolvers<{ partNumber: number; etag: string; size: number }>();
    vi.spyOn(client, 'uploadAssetPart').mockReturnValue(pendingPart.promise);
    const abort = vi.spyOn(client, 'abortAssetUpload').mockResolvedValue(undefined);
    const complete = vi.spyOn(client, 'completeAssetUpload');
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], 'abort.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });
    await screen.findByText('0 of 1 parts · 0%');
    await user.click(screen.getByRole('button', { name: 'Abort upload' }));
    expect(abort).toHaveBeenCalledExactlyOnceWith('upload-abort-race');
    expect(screen.queryByText('0 of 1 parts · 0%')).toBeNull();

    await act(async () => {
      pendingPart.resolve({ partNumber: 1, etag: 'etag-1', size: 4 });
    });
    expect(screen.queryByText(/of 1 parts/)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('aborts a late upload-session start response after local cancellation', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const pendingStart = Promise.withResolvers<AssetUploadSession>();
    vi.spyOn(client, 'startAssetUpload').mockReturnValue(pendingStart.promise);
    const abort = vi.spyOn(client, 'abortAssetUpload').mockResolvedValue(undefined);
    const uploadPart = vi.spyOn(client, 'uploadAssetPart');
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], 'late-start.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });
    await screen.findByText('late-start.bin');
    await user.click(screen.getByRole('button', { name: 'Abort upload' }));
    expect(abort).not.toHaveBeenCalled();

    await act(async () => {
      pendingStart.resolve({
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        id: 'late-start-session',
        storageUploadId: 'storage-late-start',
        filename: 'late-start.bin',
        mediaType: 'application/octet-stream',
        size: 4,
        kind: 'file',
        state: 'pending',
        partSize: 4,
        parts: [],
        createdAt: now,
        expiresAt: '2026-07-25T00:00:00.000Z',
      });
    });
    await waitFor(() => expect(abort).toHaveBeenCalledExactlyOnceWith('late-start-session'));
    expect(uploadPart).not.toHaveBeenCalled();
    expect(screen.queryByText('late-start.bin')).toBeNull();
  });

  it('rejects a resumed session that does not identify the same local file', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const uploadSession: AssetUploadSession = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      id: 'upload-mismatch',
      storageUploadId: 'storage-upload-mismatch',
      filename: 'match.bin',
      mediaType: 'application/octet-stream',
      size: 4,
      kind: 'file',
      state: 'pending',
      partSize: 4,
      parts: [],
      createdAt: now,
      expiresAt: '2026-07-25T00:00:00.000Z',
    };
    vi.spyOn(client, 'startAssetUpload').mockResolvedValue(uploadSession);
    vi.spyOn(client, 'uploadAssetPart').mockRejectedValueOnce(new Error('Pause before retry.'));
    vi.spyOn(client, 'getAssetUpload').mockResolvedValue({
      ...uploadSession,
      filename: 'different.bin',
    });
    const complete = vi.spyOn(client, 'completeAssetUpload');
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], 'match.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });
    await screen.findByText(/Upload paused: Pause before retry/);
    await user.click(screen.getByRole('button', { name: 'Retry upload' }));
    expect(
      await screen.findByText(/Upload paused: The resumable upload session does not match/),
    ).toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });

  it('shows a local file-read error without starting a server upload', async () => {
    const client = createTestClient();
    const start = vi.spyOn(client, 'startAssetUpload');
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Library' }));
    const file = new File(['unreadable'], 'unreadable.bin', {
      type: 'application/octet-stream',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => Promise.reject(new Error('Local read denied.')),
    });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });
    expect(
      await screen.findByText('The local file could not be read: Local read denied.'),
    ).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
  });

  it('aborts a retained failed upload before committing a new Studio context', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const client = createTestClient({ context: selectableContext() });
    const uploadSession: AssetUploadSession = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      id: 'upload-before-context-switch',
      storageUploadId: 'storage-before-context-switch',
      filename: 'failed.bin',
      mediaType: 'application/octet-stream',
      size: 4,
      kind: 'file',
      state: 'pending',
      partSize: 4,
      parts: [],
      createdAt: now,
      expiresAt: '2026-07-25T00:00:00.000Z',
    };
    vi.spyOn(client, 'startAssetUpload').mockResolvedValue(uploadSession);
    vi.spyOn(client, 'uploadAssetPart').mockRejectedValue(new Error('Temporary failure.'));
    const abort = vi.spyOn(client, 'abortAssetUpload').mockResolvedValue(undefined);
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Library' }));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], 'failed.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });
    await screen.findByText(/Upload paused: Temporary failure/);

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'campaign' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByTitle('Committed Studio context').textContent).toContain('Campaign site'),
    );
    expect(abort).toHaveBeenCalledExactlyOnceWith('upload-before-context-switch');
  });

  it('designs versioned transition actions and exposes the durable delivery log', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Workflows' }));
    const designer = await screen.findByRole('region', { name: 'Workflow action designer' });
    expect(designer.textContent).toContain('Draft');
    expect(designer.textContent).toContain('In review');
    expect(designer.textContent).toContain('No workflow action deliveries yet.');

    const transitionHeading = within(designer).getByText('Submit for review');
    const transitionCard = transitionHeading.closest('article');
    if (!transitionCard) throw new Error('Submit transition card was not found.');
    await user.click(within(transitionCard).getByRole('button', { name: '+ Notification' }));
    const actionLabel = within(transitionCard).getByLabelText('Action label');
    await user.clear(actionLabel);
    await user.type(actionLabel, 'Notify launch reviewers');
    await user.click(within(designer).getByRole('button', { name: 'Save next version' }));
    await screen.findByText('Workflow version 2 saved.');
    expect((within(transitionCard).getByLabelText('Action label') as HTMLInputElement).value).toBe(
      'Notify launch reviewers',
    );

    await user.click(within(designer).getByRole('button', { name: 'Run due actions' }));
    await screen.findByText(/0 workflow delivery job\(s\) completed/);
  });

  it('shows configured workflow state and requests governed review without exposing publish early', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    const panel = await screen.findByRole('region', { name: 'Editorial workflow' });
    expect(panel.textContent).toContain('Editorial review');
    expect(panel.textContent).toContain('Draft');
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.click(within(panel).getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(panel.textContent).toContain('In review'));
    await user.click(within(panel).getByRole('button', { name: 'Request approval' }));
    await waitFor(() => expect(panel.textContent).toContain('Approval pending'));
    expect(within(panel).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it('composes, validates, and previews a scoped multi-entry release', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Releases' }));
    const panel = await screen.findByRole('region', { name: 'Release manager' });
    await user.type(within(panel).getByLabelText('Release name'), 'Studio launch');
    await user.click(within(panel).getByRole('checkbox', { name: /First page/ }));
    await user.click(within(panel).getByRole('checkbox', { name: /Second page/ }));
    await user.click(within(panel).getByRole('button', { name: 'Create release' }));

    await waitFor(() => expect(panel.textContent).toContain('Studio launch'));
    await user.click(within(panel).getByRole('button', { name: 'Validate release' }));
    await waitFor(() => expect(panel.textContent).toContain('Validation passed'));
    await user.click(within(panel).getByRole('button', { name: 'Preview future state' }));
    await waitFor(() => expect(panel.textContent).toContain('Future state'));
    expect(panel.textContent).toContain('/first');
    expect(panel.textContent).toContain('/second');
    expect(within(panel).getByRole('button', { name: 'Publish release' })).toBeTruthy();
  });
  it('searches drafts and exposes index and relationship context', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const panel = await screen.findByRole('region', { name: 'Search and discovery' });
    await waitFor(() => expect(panel.textContent).toContain('1 result(s)'));
    expect(panel.textContent).toContain('Second page');
    expect(panel.textContent).toContain('Topics · 1 terms');
    expect(panel.textContent).toContain('repository-scan');
    expect(panel.textContent).toContain('same content type');
    const searchResult = within(panel).getByRole('button', { name: 'Second page' });
    expect(searchResult.className).toContain('search-result-button');
    expect(searchResult.className).toContain('button--secondary');

    const input = within(panel).getByLabelText('Search terms');
    await user.type(input, 'second');
    await user.click(within(panel).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(panel.textContent).toContain('Score 4'));
    await user.click(within(panel).getByRole('button', { name: 'Rebuild draft index' }));
    await screen.findByText('Search rebuild completed with 1 durable job(s).');
  });
});
