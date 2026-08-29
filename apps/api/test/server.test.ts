import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GridStoryObservability } from '../src/observability.js';
import { buildServer } from '../src/server.js';
import { approveForPublication } from './workflow-helpers.js';

const headers = {
  'content-type': 'application/json',
  'x-gridstory-tenant': 'test-tenant',
  'x-gridstory-actor': 'api-test',
};
const validPage = {
  title: 'API page',
  slug: 'api-page',
  story: {
    version: 1,
    blocks: [
      {
        id: 'api-story',
        type: 'paragraph',
        content: [{ type: 'text', text: 'Created in a test.', marks: [] }],
      },
    ],
  },
  blocks: [
    {
      id: 'api-hero',
      component: 'gridstory.hero',
      version: 1,
      props: { eyebrow: '', heading: 'API page', body: 'Created in a test.', tone: 'indigo' },
    },
  ],
};
const validArticle = {
  headline: 'Registered article',
  slug: 'registered-article',
  summary: 'A non-component content type authored through the same content engine.',
  body: {
    version: 1,
    blocks: [
      {
        id: 'article-story',
        type: 'paragraph',
        content: [{ type: 'text', text: 'Created through registered article fields.', marks: [] }],
      },
    ],
  },
  relatedPages: [],
  topics: ['product-news'],
  featured: false,
};

describe('GridStory API', () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('runs the draft-to-published vertical slice', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      redirects: [{ from: '/legacy-api-page', to: '/api-page', status: 308 }],
    });
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: validPage },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();

    const otherSiteResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/content',
      headers: { ...headers, 'x-gridstory-site': 'other-site' },
    });
    expect(otherSiteResponse.statusCode).toBe(200);
    expect(otherSiteResponse.json()).toEqual([]);

    await approveForPublication(server, created, headers);
    const publishResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers,
      payload: { expectedRevisionId: created.draftRevisionId },
    });
    expect(publishResponse.statusCode).toBe(200);

    const deliveryResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/api-page',
      headers,
    });
    expect(deliveryResponse.statusCode).toBe(200);
    expect(deliveryResponse.headers['cache-control']).toContain('s-maxage=60');
    expect(deliveryResponse.headers.vary).toContain('x-gridstory-tenant');
    expect(deliveryResponse.headers.vary).toContain('x-gridstory-locale');
    expect(deliveryResponse.json().data.title).toBe('API page');

    const routeResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/routes/api-page',
      headers,
    });
    expect(routeResponse.statusCode).toBe(200);
    expect(routeResponse.json().id).toBe(created.id);

    const redirectResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/routes/legacy-api-page',
      headers,
    });
    expect(redirectResponse.statusCode).toBe(308);
    expect(redirectResponse.headers.location).toBe('/api-page');
  });

  it('lists, creates, revises, and publishes the registered article collection independently', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'article', data: validArticle },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();

    const list = await server.inject({
      method: 'GET',
      url: '/api/v1/content?contentType=article',
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((entry: { id: string }) => entry.id)).toEqual([created.id]);

    const revisedData = { ...validArticle, headline: 'Revised registered article' };
    const revise = await server.inject({
      method: 'PUT',
      url: `/api/v1/content/${created.id}/draft`,
      headers,
      payload: { expectedRevisionId: created.draftRevisionId, data: revisedData },
    });
    expect(revise.statusCode).toBe(200);
    const revised = revise.json();
    const revisions = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${created.id}/revisions`,
      headers,
    });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json()).toHaveLength(2);

    await approveForPublication(server, revised, headers);
    const publish = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers,
      payload: { expectedRevisionId: revised.draftRevisionId },
    });
    expect(publish.statusCode).toBe(200);

    const delivery = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/article/registered-article',
      headers,
    });
    expect(delivery.statusCode).toBe(200);
    expect(delivery.json().data.headline).toBe('Revised registered article');
    const route = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/routes/articles/registered-article',
      headers,
    });
    expect(route.statusCode).toBe(200);
    expect(route.json().id).toBe(created.id);
  });

  it('assesses saved and candidate drafts privately and enforces configurable publish gates', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      qualityPolicies: [
        {
          id: 'strict-page-web',
          contentType: 'page',
          bypassRoles: ['quality-admin'],
          content: { minWords: 100 },
          gate: { blockedSeverities: ['warning', 'error'], minimumScore: 90 },
        },
      ],
    });
    const created = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/content',
        headers,
        payload: { contentType: 'page', data: validPage },
      })
    ).json();

    const saved = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${created.id}/quality?channel=web`,
      headers,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers['cache-control']).toBe('private, no-store');
    expect(saved.json()).toMatchObject({
      entryId: created.id,
      policyId: 'strict-page-web',
      passed: false,
      summary: { error: 0 },
    });
    expect(saved.json().findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'content_too_short' })]),
    );

    const candidate = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/quality`,
      headers,
      payload: { data: { ...validPage, title: 'A much better candidate title' } },
    });
    expect(candidate.statusCode).toBe(200);
    expect(candidate.json()).toMatchObject({
      entryId: created.id,
      revisionId: created.draftRevisionId,
    });

    await approveForPublication(server, created, headers);
    const blocked = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers,
      payload: { expectedRevisionId: created.draftRevisionId },
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error).toMatchObject({
      code: 'publish_quality_gate_failed',
      details: { report: { passed: false, policyId: 'strict-page-web' } },
    });
    const absent = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${created.id}?perspective=published`,
      headers,
    });
    expect(absent.statusCode).toBe(404);

    const bypassed = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers: { ...headers, 'x-gridstory-roles': 'admin,quality-admin' },
      payload: { expectedRevisionId: created.draftRevisionId },
    });
    expect(bypassed.statusCode).toBe(200);
  });
  it('returns structured validation errors and private cache policy', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: { title: '', slug: 'INVALID', blocks: [] } },
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json().error.code).toBe('validation_failed');
    expect(response.json().error.requestId).toBeTruthy();

    const emptyJson = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
    });
    expect(emptyJson.statusCode).toBe(400);
    expect(emptyJson.json().error).toMatchObject({ code: 'invalid_request' });
  });

  it('issues scoped preview grants, serves drafts privately, accepts messages, and supports management revocation', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      previewSigningSecret: 'preview-test-secret-with-at-least-32-characters',
      allowedPreviewOrigins: ['http://localhost:5174'],
    });
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: validPage },
    });
    const created = create.json();
    const session = await server.inject({
      method: 'POST',
      url: '/api/v1/preview/sessions',
      headers,
      payload: {
        previewUrl: 'http://localhost:5174/',
        route: '/api-page',
        mode: 'iframe',
        entryId: created.id,
      },
    });
    expect(session.statusCode).toBe(201);
    expect(session.headers['cache-control']).toBe('private, no-store');
    const grant = session.json();
    expect(grant.previewUrl).not.toContain(grant.token);

    const previewPreflight = await server.inject({
      method: 'OPTIONS',
      url: `/api/v1/preview/sessions/${grant.sessionId}/messages`,
      headers: {
        origin: 'http://localhost:5174',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(previewPreflight.statusCode).toBe(204);
    expect(previewPreflight.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect(previewPreflight.headers['access-control-allow-headers']).toContain('authorization');

    const previewHeaders = {
      authorization: `Bearer ${grant.token}`,
      origin: 'http://localhost:5174',
    };
    const draft = await server.inject({
      method: 'GET',
      url: `/api/v1/preview/content/${created.id}`,
      headers: previewHeaders,
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.headers['cache-control']).toBe('private, no-store');
    expect(draft.json()).toMatchObject({ id: created.id, data: validPage });

    const accepted = await server.inject({
      method: 'POST',
      url: `/api/v1/preview/sessions/${grant.sessionId}/messages`,
      headers: { ...previewHeaders, 'content-type': 'application/json' },
      payload: {
        type: 'gridstory.preview.handshake',
        protocolVersion: 1,
        sessionId: grant.sessionId,
        sequence: 0,
        nonce: 'nonce-0000000000',
        payload: { origin: 'http://localhost:5173' },
      },
    });
    expect(accepted.json()).toEqual({ accepted: true, sequence: 0 });

    const revoked = await server.inject({
      method: 'DELETE',
      url: `/api/v1/preview/sessions/${grant.sessionId}`,
      headers: {
        'x-gridstory-tenant': headers['x-gridstory-tenant'],
        'x-gridstory-actor': headers['x-gridstory-actor'],
      },
    });
    expect(revoked.statusCode).toBe(204);
    const expired = await server.inject({
      method: 'GET',
      url: `/api/v1/preview/content/${created.id}`,
      headers: previewHeaders,
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('preview_expired');
  });
  it('delivers the authorized design-system manifest with private management caching', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/design-system',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toMatchObject({
      id: 'gridstory.example',
      version: 1,
      breakpoints: [{ id: 'mobile' }, { id: 'tablet' }, { id: 'desktop' }],
    });
    expect(response.json().symbols[0].allowedPropOverrides).toEqual(['heading', 'body']);
  });

  it('resolves explicit hierarchy context and denies viewer mutations', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const scopedHeaders = {
      ...headers,
      'x-gridstory-organization': 'acme',
      'x-gridstory-workspace': 'marketing',
      'x-gridstory-site': 'website',
      'x-gridstory-environment': 'preview',
      'x-gridstory-locale': 'fr',
      'x-gridstory-roles': 'viewer',
    };
    const contextResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/context',
      headers: scopedHeaders,
    });
    expect(contextResponse.statusCode).toBe(200);
    expect(contextResponse.json()).toMatchObject({
      organizationId: 'acme',
      tenantId: 'test-tenant',
      workspaceId: 'marketing',
      siteId: 'website',
      environmentId: 'preview',
      locale: 'fr',
      principal: { id: 'api-test', roles: ['viewer'] },
    });

    const denied = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: scopedHeaders,
      payload: { contentType: 'page', data: validPage },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('forbidden');
  });

  it('plans, deploys, inspects, and readiness-checks the scoped schema lifecycle', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const notReady = await server.inject({ method: 'GET', url: '/ready' });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({ status: 'not_ready', reason: 'schema_drift' });

    const lifecycleHeaders = {
      'content-type': 'application/json',
      'x-gridstory-actor': 'schema-admin',
    };
    const inspection = await server.inject({
      method: 'GET',
      url: '/api/v1/schema-lifecycle',
      headers: lifecycleHeaders,
    });
    expect(inspection.statusCode).toBe(200);
    expect(inspection.json()).toMatchObject({
      source: { format: 'gridstory.schema-ir', irVersion: 1 },
      visualModel: { format: 'gridstory.visual-model', modelVersion: 1 },
      deployment: null,
    });
    expect(inspection.json().generatedTypes).toContain('export interface PageContent');

    const denied = await server.inject({
      method: 'POST',
      url: '/api/v1/schema-lifecycle/plan',
      headers: { ...lifecycleHeaders, 'x-gridstory-roles': 'viewer' },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);

    const plan = await server.inject({
      method: 'POST',
      url: '/api/v1/schema-lifecycle/plan',
      headers: lifecycleHeaders,
      payload: { candidate: inspection.json().visualModel },
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.json()).toMatchObject({
      plan: { approval: { required: false } },
      impact: { scannedEntries: 0, affectedEntries: 0 },
    });

    const deploy = await server.inject({
      method: 'POST',
      url: '/api/v1/schema-lifecycle/deploy',
      headers: lifecycleHeaders,
      payload: {},
    });
    expect(deploy.statusCode).toBe(200);
    expect(deploy.json()).toMatchObject({ actorId: 'schema-admin' });

    const drift = await server.inject({
      method: 'GET',
      url: '/api/v1/schema-lifecycle/drift',
      headers: lifecycleHeaders,
    });
    expect(drift.statusCode).toBe(200);
    expect(drift.json().inSync).toBe(true);
    expect((await server.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('provides bounded REST queries with signed cursors, projection, and published separation', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    for (const [title, slug] of [
      ['Alpha page', 'alpha-page'],
      ['Beta page', 'beta-page'],
      ['Unrelated', 'unrelated'],
    ]) {
      const created = await server.inject({
        method: 'POST',
        url: '/api/v1/content',
        headers,
        payload: { contentType: 'page', data: { ...validPage, title, slug } },
      });
      expect(created.statusCode).toBe(201);
    }

    const query = {
      contentType: 'page',
      filter: { path: 'data.title', operator: 'contains', value: 'page' },
      sort: [{ path: 'data.title', direction: 'asc' }],
      projection: ['data.title'],
      first: 1,
    };
    const first = await server.inject({
      method: 'POST',
      url: '/api/v1/content/query',
      headers,
      payload: query,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      totalCount: 2,
      nodes: [{ data: { title: 'Alpha page' } }],
      pageInfo: { hasNextPage: true, hasPreviousPage: false },
    });

    const second = await server.inject({
      method: 'POST',
      url: '/api/v1/content/query',
      headers,
      payload: { ...query, after: first.json().pageInfo.endCursor },
    });
    expect(second.json()).toMatchObject({
      nodes: [{ data: { title: 'Beta page' } }],
      pageInfo: { hasNextPage: false, hasPreviousPage: true },
    });

    const tampered = await server.inject({
      method: 'POST',
      url: '/api/v1/content/query',
      headers,
      payload: { ...query, after: `${first.json().pageInfo.endCursor}x` },
    });
    expect(tampered.statusCode).toBe(400);
    expect(tampered.json().error.code).toBe('invalid_query');

    const draft = first.json().nodes[0];
    await approveForPublication(server, draft, headers);
    const publish = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${draft.id}/publish`,
      headers,
      payload: { expectedRevisionId: draft.draftRevisionId },
    });
    expect(publish.statusCode).toBe(200);
    const delivered = await server.inject({
      method: 'POST',
      url: '/api/v1/delivery/query',
      headers,
      payload: { contentType: 'page', first: 100 },
    });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.headers['cache-control']).toContain('s-maxage=60');
    expect(delivered.json().totalCount).toBe(1);
  });

  it('exposes authorized GraphQL management and published-delivery operations', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const create = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers,
      payload: {
        query: `mutation Create($data: JSON!) {
          createContent(contentType: "page", data: $data) {
            id
            draftRevisionId
            data
          }
        }`,
        variables: { data: { ...validPage, title: 'GraphQL page', slug: 'graphql-page' } },
      },
    });
    expect(create.statusCode).toBe(200);
    expect(create.headers['cache-control']).toBe('private, no-store');
    expect(create.json().data.createContent.data.title).toBe('GraphQL page');
    const created = create.json().data.createContent;

    const management = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers,
      payload: {
        query: `query {
          contents(query: {
            contentType: "page"
            filter: { path: "data.title", operator: contains, value: "graphql" }
            projection: ["data.title"]
          }) {
            totalCount
            nodes { id data }
          }
        }`,
      },
    });
    expect(management.json()).toMatchObject({
      data: {
        contents: { totalCount: 1, nodes: [{ id: created.id, data: { title: 'GraphQL page' } }] },
      },
    });

    await approveForPublication(server, created, headers);
    const publish = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers,
      payload: {
        query: `mutation Publish($id: ID!, $revision: ID!) {
          publishContent(id: $id, expectedRevisionId: $revision) { id status }
        }`,
        variables: { id: created.id, revision: created.draftRevisionId },
      },
    });
    expect(publish.json()).toMatchObject({
      data: { publishContent: { id: created.id, status: 'published' } },
    });

    const delivery = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'x-gridstory-tenant': 'test-tenant', 'x-gridstory-roles': 'anonymous' },
      payload: {
        query: `query {
          publishedContents(query: { contentType: "page" }) {
            totalCount
            nodes { id }
          }
        }`,
      },
    });
    expect(delivery.json()).toMatchObject({
      data: { publishedContents: { totalCount: 1, nodes: [{ id: created.id }] } },
    });

    const denied = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
      payload: {
        query: `mutation { createContent(contentType: "page", data: {}) { id } }`,
      },
    });
    expect(denied.json().errors[0].message).toContain('not authorized');
  });

  it('creates locale variants and resolves completeness, fallback, localized routes, and GraphQL delivery', async () => {
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      locales: [
        {
          code: 'en',
          siteId: 'default',
          label: 'English',
          default: true,
          enabled: true,
          required: true,
          routePrefix: '',
        },
        {
          code: 'fr',
          siteId: 'default',
          label: 'French',
          default: false,
          enabled: true,
          required: true,
          fallbackLocales: ['en'],
          routePrefix: '/fr',
        },
        {
          code: 'fr-CA',
          siteId: 'default',
          label: 'French (Canada)',
          default: false,
          enabled: true,
          required: false,
          fallbackLocales: ['fr', 'en'],
          routePrefix: '/fr-ca',
        },
      ],
    });
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: { ...validPage, title: 'Hello', slug: 'hello' } },
    });
    const english = create.json();
    await approveForPublication(server, english, headers);
    await server.inject({
      method: 'POST',
      url: `/api/v1/content/${english.id}/publish`,
      headers,
      payload: { expectedRevisionId: english.draftRevisionId },
    });

    const initial = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${english.id}/translations`,
      headers,
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ percentage: 50, publicationComplete: false });
    const translationGroupId = initial.json().translationGroupId;

    const fallback = await server.inject({
      method: 'GET',
      url: `/api/v1/delivery/localized/${translationGroupId}`,
      headers: { ...headers, 'x-gridstory-locale': 'fr' },
    });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json()).toMatchObject({
      requestedLocale: 'fr',
      resolvedLocale: 'en',
      usedFallback: true,
      entry: { id: english.id },
    });

    const translated = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers,
      payload: {
        query: `mutation Translate($source: ID!, $data: JSON!) {
          createTranslation(sourceId: $source, locale: "fr", data: $data) {
            id
            draftRevisionId
            locale
            data
          }
        }`,
        variables: {
          source: english.id,
          data: { ...validPage, title: 'Bonjour', slug: 'bonjour' },
        },
      },
    });
    expect(translated.statusCode).toBe(200);
    expect(translated.json().data.createTranslation).toMatchObject({
      locale: 'fr',
      data: { title: 'Bonjour', slug: 'bonjour' },
    });
    const french = translated.json().data.createTranslation;
    const frenchHeaders = { ...headers, 'x-gridstory-locale': 'fr' };
    await approveForPublication(server, french, frenchHeaders);
    const publishFrench = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${french.id}/publish`,
      headers: frenchHeaders,
      payload: { expectedRevisionId: french.draftRevisionId },
    });
    expect(publishFrench.statusCode).toBe(200);

    const route = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/localized-routes/fr/bonjour',
      headers: { ...headers, 'x-gridstory-locale': 'fr' },
    });
    expect(route.statusCode).toBe(200);
    expect(route.headers.vary).toContain('x-gridstory-locale');
    expect(route.json()).toMatchObject({ resolvedLocale: 'fr', entry: { id: french.id } });

    const graphqlFallback = await server.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'x-gridstory-tenant': 'test-tenant', 'x-gridstory-roles': 'anonymous' },
      payload: {
        query: `query Localized($group: ID!) {
          localizedContent(translationGroupId: $group, locale: "fr-CA")
        }`,
        variables: { group: translationGroupId },
      },
    });
    expect(graphqlFallback.json()).toMatchObject({
      data: {
        localizedContent: {
          requestedLocale: 'fr-CA',
          resolvedLocale: 'fr',
          usedFallback: true,
        },
      },
    });

    const complete = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${english.id}/translations`,
      headers,
    });
    expect(complete.json()).toMatchObject({ percentage: 100, publicationComplete: true });
  });

  it('operates transactional outbox, cache tags, signed webhooks, durable logs, and replay', async () => {
    const deliveries: Array<{ body: string; headers: Record<string, string> }> = [];
    const invalidations: string[][] = [];
    server = await buildServer({
      databasePath: ':memory:',
      seed: false,
      webhookSigningSecret: 'api-test-webhook-secret-with-at-least-32-characters',
      webhookTransport: async ({ body, headers: deliveryHeaders }) => {
        deliveries.push({ body, headers: deliveryHeaders });
        return { status: 202 };
      },
      cacheInvalidator: async ({ tags }) => {
        invalidations.push(tags);
      },
    });
    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/operations/jobs',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });
    expect(denied.statusCode).toBe(403);

    const invalidWebhook = await server.inject({
      method: 'POST',
      url: '/api/v1/operations/webhooks',
      headers,
      payload: {
        url: 'http://127.0.0.1/internal',
        eventTypes: ['content.created'],
      },
    });
    expect(invalidWebhook.statusCode).toBe(400);

    const webhook = await server.inject({
      method: 'POST',
      url: '/api/v1/operations/webhooks',
      headers,
      payload: {
        url: 'https://hooks.example.test/gridstory',
        eventTypes: ['content.created'],
      },
    });
    expect(webhook.statusCode).toBe(201);

    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: {
        contentType: 'page',
        data: { ...validPage, title: 'Operational page', slug: 'operational-page' },
      },
    });
    const created = create.json();
    await approveForPublication(server, created, headers);
    await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers,
      payload: { expectedRevisionId: created.draftRevisionId },
    });
    const outbox = await server.inject({
      method: 'GET',
      url: '/api/v1/operations/outbox',
      headers,
    });
    expect(outbox.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'content.created', state: 'pending' }),
        expect.objectContaining({ type: 'content.published', state: 'pending' }),
      ]),
    );

    const drained = await server.inject({
      method: 'POST',
      url: '/api/v1/operations/drain',
      headers,
      payload: { limit: 25 },
    });
    expect(drained.statusCode).toBe(200);
    expect(drained.json()).toMatchObject({
      completedOutbox: 2,
      enqueuedJobs: 7,
      completedJobs: 7,
    });
    expect(invalidations).toHaveLength(2);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.headers['x-gridstory-signature']).toMatch(/^v1=[a-f0-9]{64}$/);

    const jobs = await server.inject({
      method: 'GET',
      url: '/api/v1/operations/jobs',
      headers,
    });
    const webhookJob = jobs.json().find((job: { type: string }) => job.type === 'webhook.deliver');
    expect(webhookJob).toMatchObject({ state: 'succeeded', result: { httpStatus: 202 } });
    const replay = await server.inject({
      method: 'POST',
      url: `/api/v1/operations/jobs/${webhookJob.id}/replay`,
      headers,
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ state: 'pending', attempts: 0 });
    await server.inject({
      method: 'POST',
      url: '/api/v1/operations/drain',
      headers,
      payload: { limit: 25 },
    });
    expect(deliveries).toHaveLength(2);

    const delivery = await server.inject({
      method: 'GET',
      url: '/api/v1/delivery/page/operational-page',
      headers,
    });
    expect(delivery.headers['cache-tag']).toContain(`:entry:${created.id}`);
    expect(delivery.headers['cache-tag']).toContain(':type:page');

    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/v1/operations/webhooks/${webhook.json().id}`,
      headers: {
        'x-gridstory-tenant': headers['x-gridstory-tenant'],
        'x-gridstory-actor': headers['x-gridstory-actor'],
      },
    });
    expect(removed.statusCode).toBe(204);
  });

  it('exports and atomically imports authorized checksummed logical archives', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/portability/export',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });
    expect(denied.statusCode).toBe(403);

    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: validPage },
    });
    const created = create.json();
    await approveForPublication(server, created, headers);
    await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers,
      payload: { expectedRevisionId: created.draftRevisionId },
    });
    const exported = await server.inject({
      method: 'GET',
      url: '/api/v1/portability/export',
      headers,
    });
    expect(exported.statusCode).toBe(200);
    const archive = exported.json();
    expect(archive).toMatchObject({
      manifest: { format: 'gridstory.logical-content', version: 1, entryCount: 1 },
    });
    const streamed = await server.inject({
      method: 'GET',
      url: '/api/v1/portability/export?format=ndjson',
      headers,
    });
    expect(streamed.headers['content-type']).toContain('application/x-ndjson');
    expect(streamed.body.trim().split('\n')).toHaveLength(2);

    await server.close();
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const lineDryRun = await server.inject({
      method: 'POST',
      url: '/api/v1/portability/import',
      headers: { ...headers, 'content-type': 'application/x-ndjson' },
      payload: streamed.body,
    });
    expect(lineDryRun.statusCode).toBe(200);
    expect(lineDryRun.json()).toMatchObject({ imported: 1, dryRun: true });
    const dryRun = await server.inject({
      method: 'POST',
      url: '/api/v1/portability/import',
      headers,
      payload: archive,
    });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json()).toMatchObject({ imported: 1, dryRun: true });
    const imported = await server.inject({
      method: 'POST',
      url: '/api/v1/portability/import?dryRun=false',
      headers,
      payload: archive,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ imported: 1, dryRun: false });
    const restored = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${created.id}?perspective=published`,
      headers,
    });
    expect(restored.json()).toMatchObject({ id: created.id, data: validPage });

    const corrupted = structuredClone(archive);
    corrupted.entries[0].record.revisions[0].data.title = 'Tampered';
    const rejected = await server.inject({
      method: 'POST',
      url: '/api/v1/portability/import?dryRun=false&conflictPolicy=replace',
      headers,
      payload: corrupted,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('invalid_archive');
  });

  it('verifies and exports audit chains with a scoped administrator operations view', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/audit/verify',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });
    expect(denied.statusCode).toBe(403);

    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: validPage },
    });
    const created = create.json();
    await approveForPublication(server, created, headers);
    await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers,
      payload: { expectedRevisionId: created.draftRevisionId },
    });

    const verification = await server.inject({
      method: 'GET',
      url: '/api/v1/audit/verify',
      headers,
    });
    expect(verification.statusCode).toBe(200);
    expect(verification.json()).toMatchObject({ valid: true, eventCount: 2, entryCount: 1 });
    const auditExport = await server.inject({
      method: 'GET',
      url: '/api/v1/audit/export',
      headers,
    });
    expect(auditExport.json()).toMatchObject({
      manifest: { kind: 'gridstory.audit.manifest', eventCount: 2, valid: true },
    });
    expect(auditExport.json().events[1]).toMatchObject({
      action: 'content.published',
      previousHash: auditExport.json().events[0].eventHash,
    });
    const streamed = await server.inject({
      method: 'GET',
      url: '/api/v1/audit/export?format=ndjson',
      headers,
    });
    expect(streamed.headers['content-type']).toContain('application/x-ndjson');
    expect(streamed.body.trim().split('\n')).toHaveLength(3);

    const summary = await server.inject({
      method: 'GET',
      url: '/api/v1/operations/summary',
      headers,
    });
    expect(summary.json()).toMatchObject({
      content: { total: 1, published: 1 },
      outbox: { total: 2, pending: 2, truncated: false },
      jobs: { total: 0, truncated: false },
      webhooks: { total: 0, active: 0 },
      audit: { valid: true, eventCount: 2 },
    });
    expect(summary.json().recentAudit[0]).toMatchObject({ action: 'content.published' });
  });

  it('keeps observability health private, bounded, and out of readiness', async () => {
    const observability: GridStoryObservability = {
      tenantTelemetry: () => {},
      registerFastify: () => {},
      health: async () => ({
        enabled: true,
        status: 'degraded',
        signals: { logs: 'healthy', metrics: 'healthy', traces: 'healthy' },
        collector: {
          status: 'degraded',
          checkedAt: '2026-08-21T00:00:00.000Z',
          reason: 'collector_unreachable',
        },
        logSdk: 'development',
      }),
      runWorkerScope: async (_scope, operation) => operation(),
      shutdown: async () => {},
    };
    server = await buildServer({
      databasePath: ':memory:',
      seed: true,
      observability,
    });
    const denied = await server.inject({
      method: 'GET',
      url: '/api/v1/operations/observability',
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });
    expect(denied.statusCode).toBe(403);

    const health = await server.inject({
      method: 'GET',
      url: '/api/v1/operations/observability',
      headers,
    });
    expect(health.statusCode).toBe(200);
    expect(health.headers['cache-control']).toBe('private, no-store');
    expect(health.json()).toEqual({
      enabled: true,
      status: 'degraded',
      signals: { logs: 'healthy', metrics: 'healthy', traces: 'healthy' },
      collector: {
        status: 'degraded',
        checkedAt: '2026-08-21T00:00:00.000Z',
        reason: 'collector_unreachable',
      },
      logSdk: 'development',
    });
    expect(await server.inject({ method: 'GET', url: '/health' })).toMatchObject({
      statusCode: 200,
    });
    expect(await server.inject({ method: 'GET', url: '/ready' })).toMatchObject({
      statusCode: 200,
    });
  });

  it('supports scoped collaboration, browser PATCH preflight, and stable due-date validation', async () => {
    server = await buildServer({ databasePath: ':memory:', seed: false });
    const create = await server.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers,
      payload: { contentType: 'page', data: validPage },
    });
    const created = create.json();

    const preflight = await server.inject({
      method: 'OPTIONS',
      url: `/api/v1/content/${created.id}/comments/thread-1`,
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'content-type,x-gridstory-tenant,x-gridstory-actor',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('PATCH');

    const comment = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/comments`,
      headers,
      payload: {
        target: { field: 'story', nodeId: 'paragraph-1' },
        body: 'Please review, @reviewer.',
        assigneeId: 'reviewer',
        dueAt: '2026-08-01T12:00:00Z',
      },
    });
    expect(comment.statusCode).toBe(201);
    expect(comment.json()).toMatchObject({
      target: { entryId: created.id, field: 'story', nodeId: 'paragraph-1' },
      assigneeId: 'reviewer',
      messages: [{ mentions: ['reviewer'] }],
    });

    const threadId = comment.json().id;
    const reply = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/comments/${threadId}/replies`,
      headers,
      payload: { body: 'Reviewed.' },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().messages).toHaveLength(2);

    const resolved = await server.inject({
      method: 'PATCH',
      url: `/api/v1/content/${created.id}/comments/${threadId}`,
      headers,
      payload: { resolved: true },
    });
    expect(resolved.json()).toMatchObject({ resolvedBy: 'api-test' });

    const presence = await server.inject({
      method: 'PUT',
      url: `/api/v1/content/${created.id}/presence`,
      headers,
      payload: { displayName: 'API author', field: 'story' },
    });
    expect(presence.json()).toEqual([
      expect.objectContaining({ actorId: 'api-test', displayName: 'API author', field: 'story' }),
    ]);

    const baseOperation = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/collaboration/operations`,
      headers,
      payload: { id: 'base-title', target: { field: 'title' }, value: 'Base title' },
    });
    expect(baseOperation).toMatchObject({ statusCode: 201 });
    const featureBranch = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/collaboration/branches`,
      headers,
      payload: { id: 'feature', name: 'Feature' },
    });
    expect(featureBranch.json()).toMatchObject({ id: 'feature', parentBranchId: 'main' });
    expect(
      await server.inject({
        method: 'POST',
        url: `/api/v1/content/${created.id}/collaboration/operations`,
        headers,
        payload: {
          id: 'feature-title',
          branchId: 'feature',
          target: { field: 'title' },
          value: 'Feature title',
        },
      }),
    ).toMatchObject({ statusCode: 201 });
    expect(
      await server.inject({
        method: 'POST',
        url: `/api/v1/content/${created.id}/collaboration/operations`,
        headers,
        payload: { id: 'main-title', target: { field: 'title' }, value: 'Main title' },
      }),
    ).toMatchObject({ statusCode: 201 });
    const suggestion = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/collaboration/suggestions`,
      headers,
      payload: { target: { field: 'summary' }, value: 'A suggested summary' },
    });
    expect(suggestion).toMatchObject({ statusCode: 201 });
    expect(
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/content/${created.id}/collaboration/suggestions/${suggestion.json().id}`,
        headers,
        payload: { decision: 'accept' },
      }),
    ).toMatchObject({ statusCode: 200 });
    const merge = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/collaboration/merges`,
      headers,
      payload: { sourceBranchId: 'feature' },
    });
    expect(merge.json()).toMatchObject({ status: 'conflicted' });
    const conflictId = merge.json().conflictIds[0];
    expect(
      await server.inject({
        method: 'PATCH',
        url: `/api/v1/content/${created.id}/collaboration/conflicts/${conflictId}`,
        headers,
        payload: { operationId: 'feature-title' },
      }),
    ).toMatchObject({ statusCode: 200 });

    const visible = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${created.id}/collaboration`,
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json()).toMatchObject({
      threads: [{ id: threadId }],
      presence: [{ field: 'story' }],
      operations: expect.arrayContaining([
        expect.objectContaining({ id: 'feature-title' }),
        expect.objectContaining({ id: 'main-title' }),
      ]),
      suggestions: [expect.objectContaining({ status: 'accepted' })],
      merges: [expect.objectContaining({ status: 'merged' })],
      conflicts: [expect.objectContaining({ status: 'resolved' })],
    });

    const denied = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/comments`,
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
      payload: { body: 'Not allowed.' },
    });
    expect(denied.statusCode).toBe(403);

    const deniedOperation = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/collaboration/operations`,
      headers: { ...headers, 'x-gridstory-roles': 'viewer' },
      payload: { target: { field: 'title' }, value: 'Not allowed' },
    });
    expect(deniedOperation.statusCode).toBe(403);

    const isolated = await server.inject({
      method: 'GET',
      url: `/api/v1/content/${created.id}/collaboration`,
      headers: { ...headers, 'x-gridstory-tenant': 'other-tenant' },
    });
    expect(isolated.statusCode).toBe(404);

    const invalidDue = await server.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/comments`,
      headers,
      payload: { body: 'Schedule.', dueAt: 'not-a-date' },
    });
    expect(invalidDue.statusCode).toBe(400);
    expect(invalidDue.json().error.code).toBe('invalid_due_date');
  });
});
