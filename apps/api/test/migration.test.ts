import type { MigrationSourceAdapter } from '@gridstory/core';
import type { MigrationSourceRecord, MigrationSourceSnapshot } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const headers = {
  'x-gridstory-tenant': 'migration-test',
  'x-gridstory-environment': 'migration-shadow',
  'x-gridstory-actor': 'migration-admin',
};

const page = {
  title: 'Migrated editorial launch page',
  slug: 'migrated-page',
  story: {
    version: 1,
    blocks: [
      {
        id: 'paragraph',
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'This migrated fixture contains enough meaningful editorial words to satisfy the reviewed quality policy before the operator approves publication.',
            marks: [],
          },
        ],
      },
    ],
  },
  blocks: [
    {
      id: 'hero',
      component: 'gridstory.hero',
      version: 1,
      props: {
        eyebrow: '',
        heading: 'Migrated editorial launch page',
        body: 'A complete isolated fixture for guarded migration cutover verification.',
        tone: 'indigo',
      },
    },
  ],
};

class ApiFixtureSource implements MigrationSourceAdapter {
  readonly descriptor = {
    id: 'contentful-api',
    provider: 'contentful' as const,
    name: 'Contentful API fixture',
    supportsDelta: true,
    reportsDeletions: true,
    includesAssets: false,
  };
  records: MigrationSourceRecord[] = [
    {
      externalId: 'source-page-1',
      sourceType: 'contentful.Entry.page',
      status: 'published',
      data: page,
    },
  ];
  reads = 0;

  read(input: { mode: 'full' | 'delta' }): MigrationSourceSnapshot {
    this.reads += 1;
    return {
      kind: input.mode,
      records: structuredClone(this.records),
      checkpoint: `api-checkpoint-${this.reads}`,
      complete: true,
    };
  }
}

describe('migration HTTP workflow', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('keeps migration state private, authorized, digest-bound, scoped, and cutover-verifiable', async () => {
    const source = new ApiFixtureSource();
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      migration: { sources: [source] },
    });
    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/migrations',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['cache-control']).toBe('private, no-store');

    const recipe = await server.inject({
      method: 'PUT',
      url: '/api/v1/migrations/recipes/contentful-page',
      headers,
      payload: {
        name: 'Contentful page',
        provider: 'contentful',
        sourceType: 'contentful.Entry.page',
        targetContentType: 'page',
        publicationMode: 'draft',
        fields: [
          { sourcePath: 'title', targetField: 'title', transform: 'string', required: true },
          { sourcePath: 'slug', targetField: 'slug', transform: 'slug', required: true },
          { sourcePath: 'story', targetField: 'story', transform: 'copy', required: true },
          { sourcePath: 'blocks', targetField: 'blocks', transform: 'copy', required: true },
        ],
      },
    });
    expect(recipe.statusCode).toBe(200);
    const project = await server.inject({
      method: 'POST',
      url: '/api/v1/migrations/projects',
      headers,
      payload: {
        id: 'contentful-cutover',
        name: 'Contentful cutover',
        sourceId: 'contentful-api',
        recipeIds: ['contentful-page'],
        mode: 'dual-run',
      },
    });
    expect(project.statusCode).toBe(201);
    expect(project.json()).not.toHaveProperty('checkpoint');

    const planResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/migrations/projects/contentful-cutover/plans',
      headers,
    });
    expect(planResponse.statusCode).toBe(201);
    const plan = planResponse.json();
    expect(plan).toMatchObject({ counts: { create: 1, publish: 0, blocked: 0 } });
    expect(plan.effects[0]).not.toHaveProperty('mappedData');
    expect(plan).not.toHaveProperty('nextCheckpoint');

    const altered = await server.inject({
      method: 'POST',
      url: `/api/v1/migrations/plans/${plan.id}/execute`,
      headers,
      payload: { digest: '0'.repeat(64) },
    });
    expect(altered.statusCode).toBe(409);
    const executed = await server.inject({
      method: 'POST',
      url: `/api/v1/migrations/plans/${plan.id}/execute`,
      headers,
      payload: { digest: plan.digest },
    });
    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({ state: 'succeeded' });

    const blockedReport = await server.inject({
      method: 'POST',
      url: '/api/v1/migrations/projects/contentful-cutover/cutover-reports',
      headers,
    });
    expect(blockedReport.statusCode).toBe(201);
    expect(blockedReport.json()).toMatchObject({
      ready: false,
      blockers: [expect.objectContaining({ code: 'target-unpublished' })],
    });

    const targetId = plan.effects[0].targetEntryId as string;
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/content/${targetId}/workflow/transitions/submit-review`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    const approvalRequest = (
      await server.inject({
        method: 'POST',
        url: `/api/v1/content/${targetId}/workflow/transitions/approve`,
        headers,
        payload: {},
      })
    ).json();
    expect(approvalRequest.pendingApproval.id).toBeTruthy();
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/content/${targetId}/workflow/approvals/${approvalRequest.pendingApproval.id}`,
          headers: { ...headers, 'x-gridstory-actor': 'migration-approver' },
          payload: { decision: 'approved' },
        })
      ).statusCode,
    ).toBe(200);
    const target = (
      await server.inject({ method: 'GET', url: `/api/v1/content/${targetId}`, headers })
    ).json();
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/v1/content/${targetId}/publish`,
          headers: { ...headers, 'x-gridstory-actor': 'migration-approver' },
          payload: { expectedRevisionId: target.draftRevisionId },
        })
      ).statusCode,
    ).toBe(200);
    const report = await server.inject({
      method: 'POST',
      url: '/api/v1/migrations/projects/contentful-cutover/cutover-reports',
      headers,
    });
    expect(report.statusCode).toBe(201);
    expect(report.json()).toMatchObject({ ready: true, sourceCount: 1, publishedCount: 1 });

    const overview = await server.inject({ method: 'GET', url: '/api/v1/migrations', headers });
    expect(overview.statusCode).toBe(200);
    expect(overview.headers['cache-control']).toBe('private, no-store');
    expect(overview.json().projects[0]).not.toHaveProperty('checkpoint');
    expect(overview.json().cutoverReports.at(-1)).toMatchObject({ ready: true });

    const otherTenant = await server.inject({
      method: 'GET',
      url: '/api/v1/migrations',
      headers: { ...headers, 'x-gridstory-tenant': 'migration-other' },
    });
    expect(otherTenant.statusCode).toBe(200);
    expect(otherTenant.json()).toMatchObject({ recipes: [], projects: [], plans: [] });
  });
});
