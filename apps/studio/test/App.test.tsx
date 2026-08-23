// @vitest-environment jsdom

import {
  type AssetRecord,
  type AssetUploadSession,
  type ContentEntry,
  createGridStoryClient,
  type MigrationCutoverReport,
  type MarketplaceOverviewRecord,
  type MigrationPlanSummary,
  type MigrationProjectSummary,
  type MigrationRecipe,
  type MigrationRun,
  type MigrationSourceDescriptor,
  type Release,
} from '@gridstory/client';
import { exampleDesignSystem } from '@gridstory/example-kit/design-system';
import { componentManifests } from '@gridstory/example-kit/manifests';
import type { ContentSchemaDefinition } from '@gridstory/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    schema?: ContentSchemaDefinition;
    entries?: ContentEntry[];
    assets?: AssetRecord[];
  } = {},
) {
  const testSchema = options.schema ?? schema;
  const testEntries = options.entries ?? entries;
  const testAssets = options.assets ?? [];
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
        contentType: 'page',
        workflowId: 'page-editorial',
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
    if (url.pathname === '/api/v1/schemas') return json([testSchema]);
    if (url.pathname === '/api/v1/components') return json(componentManifests);
    if (url.pathname === '/api/v1/design-system') return json(exampleDesignSystem);
    if (url.pathname === '/api/v1/workflows') return json([workflowDefinition]);
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
    if (url.pathname === '/api/v1/components/gridstory.hero/migration') {
      return json({
        id: 'component_migration_test',
        component: componentManifests[0],
        usage: {
          componentId: 'gridstory.hero',
          currentVersion: 1,
          totalInstances: 4,
          entries: 2,
          byPerspective: { draft: 4, published: 0 },
          byVersion: { '1': 4 },
          locations: [],
        },
        outdatedInstances: 0,
        unmigratableVersions: [],
        ready: true,
      });
    }
    if (url.pathname === '/api/v1/components/gridstory.hero/visual-regression') {
      return json({
        id: 'visual_regression_test',
        componentId: 'gridstory.hero',
        version: 1,
        scenarios: componentManifests[0]?.visualRegression.scenarios ?? [],
        usageHooks: [],
        selector: '[data-gridstory-component="gridstory.hero"][data-gridstory-version="1"]',
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
    if (url.pathname === '/api/v1/content') return json(testEntries);
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
  vi.restoreAllMocks();
});

describe('GridStory Studio', () => {
  it('derives content controls and composition storage from the active schema', async () => {
    render(<App client={createTestClient()} />);

    expect(screen.getByRole('link', { name: 'Skip to page editor' }).getAttribute('href')).toBe(
      '#studio-editor',
    );
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

  it('runs candidate quality checks and links findings to responsible fields', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Quality' }));

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
  });

  it('shows enterprise identity policy, providers, security events, and one-time credentials', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Identity' }));

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
  });

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

  it('starts and revokes a secure application iframe preview', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'App iframe' }));
    const frame = await screen.findByTitle('Application draft preview');
    expect(frame.getAttribute('src')).toBe('http://localhost:5174/');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(screen.getByText(/iframe .*connecting/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close app preview' }));
    expect(screen.queryByTitle('Application draft preview')).toBeNull();
  });

  it('opens standalone preview before awaiting the scoped session grant', async () => {
    const user = userEvent.setup();
    const replace = vi.fn();
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace },
      postMessage: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Standalone' }));
    expect(open).toHaveBeenCalledWith(
      'about:blank',
      'gridstory-standalone-preview',
      'popup,width=1280,height=900',
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('http://localhost:5174/'));
    expect(screen.getByText(/standalone .*connecting/)).toBeTruthy();
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

  it('binds variants and tokens, previews responsive values, and inserts governed reuse', async () => {
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

    const breakpointPicker = screen.getByRole('group', { name: 'Preview breakpoint' });
    await user.click(within(breakpointPicker).getByRole('button', { name: 'Mobile' }));
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
    expect(screen.getByRole('heading', { name: 'Second hero' })).toBeTruthy();
    await user.click(
      within(headingBinding as HTMLElement).getByRole('button', { name: 'Clear mobile' }),
    );
    expect(screen.getByRole('heading', { name: 'Wide hero' })).toBeTruthy();
    await user.click(within(breakpointPicker).getByRole('button', { name: 'Desktop' }));
    expect(screen.getByRole('heading', { name: 'Wide hero' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '+ Portability callout' }));
    inspector = screen.getByRole('region', { name: 'Selected component inspector' });
    expect(inspector.textContent).toContain('Linked to Portability callout');
    expect(within(inspector).queryByLabelText('Tone')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Apply Campaign page' }));
    expect(screen.getByText('6 components')).toBeTruthy();
  });
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
    await user.click(within(asset).getByRole('button', { name: /Campaign landscape/ }));
    expect(within(asset).getByLabelText('Alternative text')).toBeTruthy();

    const relations = screen.getByRole('region', { name: 'Related pages' });
    await user.click(within(relations).getByRole('button', { name: /Second page/ }));
    expect(relations.textContent).toContain('1 selected / 2');

    await user.click(screen.getByRole('button', { name: /Hero.*one-hero-a/ }));
    const inlineEditor = screen.getByRole('region', { name: 'Inline component editor' });
    const inlineHeading = within(inlineEditor).getByLabelText('Heading');
    fireEvent.change(inlineHeading, { target: { value: 'Edited directly in preview' } });
    expect(screen.getByRole('heading', { name: 'Edited directly in preview' })).toBeTruthy();

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
    await user.click(within(suggestions).getByRole('button', { name: 'Accept' }));
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
  }, 15_000);

  it('shows scoped component usage and visual regression hooks in governance', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Components' }));
    const governance = await screen.findByRole('region', { name: 'Component governance' });
    expect(governance.textContent).toContain('4 scoped usages across 2 entries');
    expect(governance.textContent).toContain('1 code-owned scenarios');
    expect(governance.textContent).toContain('data-gridstory-version');
  });

  it('loads managed assets into the responsive library and field picker', async () => {
    const user = userEvent.setup();
    const managedAsset: AssetRecord = {
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
    };
    render(
      <App
        client={createTestClient({
          schema: authoringSchema,
          entries: authoringEntries,
          assets: [managedAsset],
        })}
      />,
    );

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Assets' }));
    expect(screen.getByRole('heading', { name: 'Asset library' })).toBeTruthy();
    expect(screen.getByText('Focal point 0.25, 0.75')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText(/malware clean/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Inspect usage' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      '2 references across 1 entries',
    );

    const picker = screen.getByRole('region', { name: 'Social image' });
    await user.click(within(picker).getByRole('button', { name: /Managed hero/ }));
    expect((within(picker).getByLabelText('Alternative text') as HTMLInputElement).value).toBe(
      'Managed alt',
    );
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
    await user.click(screen.getByRole('button', { name: 'Assets' }));
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const file = new File([bytes], 'ten-bytes.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });

    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(uploadPart).toHaveBeenCalledTimes(3);
    expect(uploadPart.mock.calls.map((call) => call[2].byteLength)).toEqual([4, 4, 2]);
    expect(complete.mock.calls[0]?.[1].map((part) => part.size)).toEqual([4, 4, 2]);
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

    const input = within(panel).getByLabelText('Search terms');
    await user.type(input, 'second');
    await user.click(within(panel).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(panel.textContent).toContain('Score 4'));
    await user.click(within(panel).getByRole('button', { name: 'Rebuild draft index' }));
    await screen.findByText('Search rebuild completed with 1 durable job(s).');
  });
});
