import type { ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContentService,
  SchemaLifecycleService,
  SqliteContentRepository,
  type ContentRepository,
} from '../src/index.js';

const scope: ContentScope = {
  organizationId: 'lifecycle-org',
  tenantId: 'lifecycle-tenant',
  workspaceId: 'lifecycle-workspace',
  siteId: 'lifecycle-site',
  environmentId: 'development',
  locale: 'en',
};
const versionOne: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  collection: 'articles',
  titleField: 'title',
  route: { pattern: '/articles/:slug', slugField: 'slug' },
  fields: [
    { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
  ],
};
const routeChanged: ContentSchemaDefinition = {
  ...versionOne,
  version: 2,
  route: { pattern: '/content/:slug', slugField: 'slug' },
};
const requiresBackfill: ContentSchemaDefinition = {
  ...routeChanged,
  version: 3,
  fields: [
    ...routeChanged.fields,
    {
      id: 'article.category',
      name: 'category',
      label: 'Category',
      type: 'text',
      required: true,
    },
  ],
};

describe('SchemaLifecycleService', () => {
  let repository: ContentRepository;

  beforeEach(() => {
    repository = new SqliteContentRepository({ filename: ':memory:' });
  });

  afterEach(async () => await repository.close());

  it('initializes safely, gates risky promotion, assesses entries, and reports drift sources', async () => {
    const firstLifecycle = new SchemaLifecycleService({
      repository,
      schemas: [versionOne],
      componentManifests: [],
    });
    const initial = await firstLifecycle.initialize(scope, { id: 'bootstrap' });
    expect(initial.actorId).toBe('bootstrap');
    expect((await firstLifecycle.drift(scope)).inSync).toBe(true);

    const content = new ContentService({
      repository,
      schemas: [versionOne],
      componentManifests: [],
    });
    await content.create({
      scope,
      contentType: 'article',
      data: { title: 'Lifecycle entry', slug: 'lifecycle-entry' },
      actor: { id: 'editor' },
    });

    const secondLifecycle = new SchemaLifecycleService({
      repository,
      schemas: [routeChanged],
      componentManifests: [],
    });
    const routeAssessment = await secondLifecycle.assess(scope);
    expect(routeAssessment.impact).toMatchObject({
      scannedEntries: 1,
      affectedEntries: 1,
      byContentType: { article: 1 },
      invalidEntries: [],
    });
    await expect(
      secondLifecycle.deploySource({ scope, actor: { id: 'deployer' } }),
    ).rejects.toMatchObject({ code: 'schema_migration_approval_required' });
    await secondLifecycle.deploySource({
      scope,
      actor: { id: 'deployer' },
      expectedPlanId: routeAssessment.plan.id,
      approved: true,
    });
    expect((await secondLifecycle.drift(scope)).inSync).toBe(true);

    const backfillLifecycle = new SchemaLifecycleService({
      repository,
      schemas: [requiresBackfill],
      componentManifests: [],
    });
    const backfillAssessment = await backfillLifecycle.assess(scope);
    expect(backfillAssessment.impact.invalidEntries).toHaveLength(1);
    await expect(
      backfillLifecycle.deploySource({
        scope,
        actor: { id: 'deployer' },
        expectedPlanId: backfillAssessment.plan.id,
        approved: true,
      }),
    ).rejects.toMatchObject({ code: 'schema_migration_data_required' });

    const deployed = await secondLifecycle.getDeployment(scope);
    expect(deployed).toBeTruthy();
    if (!deployed) throw new Error('Expected a deployed schema fixture.');
    await repository.saveSchemaDeployment({
      scope,
      document: deployed.document,
      fingerprint: 'database-drift',
      generatedTypes: `${deployed.generatedTypes}\n// drift`,
      generatedTypesFingerprint: 'generated-drift',
      actor: { id: 'tamper-test' },
    });
    const drift = await secondLifecycle.drift(scope);
    expect(Object.fromEntries(drift.states.map((state) => [state.source, state.status]))).toEqual({
      source: 'match',
      deployed: 'match',
      database: 'drift',
      'generated-types': 'drift',
    });
  });
});
