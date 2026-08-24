import { generateKeyPairSync, sign } from 'node:crypto';
import type { ContentFederationSigner, ContentFederationSourceAdapter } from '@gridstory/core';
import type { ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpContentFederationSource } from '../src/content-federation-adapter.js';
import { buildServer } from '../src/server.js';
import { approveForPublication } from './workflow-helpers.js';

const federationPageSchema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Federated page',
  description: 'Published text-only federation fixture.',
  collection: 'pages',
  titleField: 'title',
  route: { pattern: '/:slug', slugField: 'slug' },
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
  ],
};

const sourceScope: ContentScope = {
  organizationId: 'source-organization',
  tenantId: 'source-tenant',
  workspaceId: 'source-workspace',
  siteId: 'source-site',
  environmentId: 'production',
  locale: 'en',
};
const consumerScope: ContentScope = {
  organizationId: 'consumer-organization',
  tenantId: 'consumer-tenant',
  workspaceId: 'consumer-workspace',
  siteId: 'consumer-site',
  environmentId: 'production',
  locale: 'en',
};

function scopedHeaders(scope: ContentScope, actor?: string, roles?: string) {
  return {
    'content-type': 'application/json',
    'x-gridstory-organization': scope.organizationId,
    'x-gridstory-tenant': scope.tenantId,
    'x-gridstory-workspace': scope.workspaceId,
    'x-gridstory-site': scope.siteId,
    'x-gridstory-environment': scope.environmentId,
    'x-gridstory-locale': scope.locale,
    ...(actor ? { 'x-gridstory-actor': actor } : {}),
    ...(roles ? { 'x-gridstory-roles': roles } : {}),
  };
}

function signingFixture(): ContentFederationSigner {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: {
      keyId: 'source-key-1',
      algorithm: 'ed25519',
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
    sign(payload) {
      return sign(null, Buffer.from(payload, 'utf8'), pair.privateKey).toString('base64');
    },
  };
}

class FastifySource implements ContentFederationSourceAdapter {
  readonly name = 'source-api';

  constructor(private readonly server: FastifyInstance) {}

  async #read(url: string, scope: ContentScope): Promise<unknown> {
    const response = await this.server.inject({
      method: 'GET',
      url,
      headers: scopedHeaders(scope, 'consumer-service', 'admin'),
    });
    if (response.statusCode !== 200) throw new Error('Source route failed.');
    return response.json();
  }

  readOffer(input: Parameters<ContentFederationSourceAdapter['readOffer']>[0]) {
    return this.#read(
      `/api/v1/federation/source/offers/${encodeURIComponent(input.offerId)}?requestId=${encodeURIComponent(input.requestId)}`,
      input.sourceScope,
    );
  }

  readRecord(input: Parameters<ContentFederationSourceAdapter['readRecord']>[0]) {
    return this.#read(
      `/api/v1/federation/source/offers/${encodeURIComponent(input.offerId)}/records/${encodeURIComponent(input.namespace)}/${encodeURIComponent(input.sourceEntryId)}?requestId=${encodeURIComponent(input.requestId)}`,
      input.sourceScope,
    );
  }

  readSnapshot(input: Parameters<ContentFederationSourceAdapter['readSnapshot']>[0]) {
    return this.#read(
      `/api/v1/federation/source/offers/${encodeURIComponent(input.offerId)}/snapshot?requestId=${encodeURIComponent(input.requestId)}&maximumRecords=${input.maximumRecords}`,
      input.sourceScope,
    );
  }
}

describe('content federation HTTP workflow', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('pins a signed producer offer and serves attributed published live content without mirroring', async () => {
    const signer = signingFixture();
    const producer = await buildServer({
      databasePath: ':memory:',
      seed: false,
      contentSchemas: [federationPageSchema],
      qualityPolicies: [],
      contentFederation: { signer },
    });
    servers.push(producer);
    const sourceHeaders = scopedHeaders(sourceScope, 'source-admin', 'admin');
    const createdResponse = await producer.inject({
      method: 'POST',
      url: '/api/v1/content',
      headers: sourceHeaders,
      payload: {
        id: 'page-a',
        contentType: 'page',
        data: { title: 'Federated page', slug: 'federated-page' },
      },
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = createdResponse.json();
    await approveForPublication(producer, created, sourceHeaders);
    const published = await producer.inject({
      method: 'POST',
      url: `/api/v1/content/${created.id}/publish`,
      headers: sourceHeaders,
      payload: { expectedRevisionId: created.draftRevisionId },
    });
    expect(published.statusCode, published.body).toBe(200);

    const offerResponse = await producer.inject({
      method: 'PUT',
      url: '/api/v1/federation/offers/offer-a',
      headers: sourceHeaders,
      payload: {
        expectedVersion: 0,
        id: 'offer-a',
        state: 'enabled',
        sourceInstance: 'https://source.example.test/',
        canonicalBaseUrl: 'https://source.example.test/content/',
        contentTypes: [{ id: 'page', version: 1 }],
        attribution: {
          licenseUrl: 'https://source.example.test/license',
          creditText: 'Provided by Source A',
          attributedTo: [{ name: 'Source A', url: 'https://source.example.test/' }],
        },
      },
    });
    expect(offerResponse.statusCode, offerResponse.body).toBe(200);

    const sourceDenied = await producer.inject({
      method: 'GET',
      url: '/api/v1/federation/source/offers/offer-a?requestId=00000000-0000-4000-8000-000000000001',
      headers: scopedHeaders(sourceScope, 'source-publisher', 'publisher'),
    });
    expect(sourceDenied.statusCode).toBe(403);

    const consumer = await buildServer({
      databasePath: ':memory:',
      seed: false,
      contentSchemas: [federationPageSchema],
      qualityPolicies: [],
      contentFederation: { sources: [new FastifySource(producer)] },
    });
    servers.push(consumer);
    const consumerHeaders = scopedHeaders(consumerScope, 'consumer-admin', 'admin');
    const inspected = await consumer.inject({
      method: 'POST',
      url: '/api/v1/federation/agreements/agreement-a/inspect',
      headers: consumerHeaders,
      payload: {
        expectedVersion: 0,
        adapter: 'source-api',
        sourceScope,
        sourceInstance: 'https://source.example.test/',
        canonicalBaseUrl: 'https://source.example.test/content/',
        offerId: 'offer-a',
        mode: 'live',
        trustedKey: signer.publicKey,
      },
    });
    expect(inspected.statusCode, inspected.body).toBe(201);
    expect(inspected.json()).toMatchObject({
      state: 'disabled',
      mode: 'live',
      offerId: 'offer-a',
    });
    const activated = await consumer.inject({
      method: 'POST',
      url: '/api/v1/federation/agreements/agreement-a/state',
      headers: consumerHeaders,
      payload: { expectedVersion: 1, state: 'active' },
    });
    expect(activated.statusCode, activated.body).toBe(200);

    const delivered = await consumer.inject({
      method: 'GET',
      url: `/api/v1/federation/delivery/agreement-a/offer-a%3Apage/${encodeURIComponent(created.id)}`,
      headers: scopedHeaders(consumerScope),
    });
    expect(delivered.statusCode, delivered.body).toBe(200);
    expect(delivered.headers['cache-control']).toBe('private, no-store');
    expect(delivered.json()).toMatchObject({
      namespace: 'offer-a:page',
      sourceEntryId: created.id,
      data: { title: 'Federated page' },
      attribution: {
        canonicalUrl: `https://source.example.test/content/page/${created.id}`,
        licenseUrl: 'https://source.example.test/license',
        creditText: 'Provided by Source A',
      },
    });
    const state = await consumer.inject({
      method: 'GET',
      url: '/api/v1/federation',
      headers: consumerHeaders,
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().mirrors).toEqual([]);
  });
});

describe('HttpContentFederationSource', () => {
  it('uses one configured HTTPS origin, complete scope headers, no redirects, and bounded JSON', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const source = new HttpContentFederationSource({
      name: 'source-http',
      baseUrl: 'https://source.example.test/gridstory/',
      authorizationHeader: 'Bearer configured-service-credential',
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, ...(init ? { init } : {}) });
        const response = new Response(JSON.stringify({ signed: true }), {
          headers: { 'content-type': 'application/json' },
        });
        Object.defineProperty(response, 'url', { value: url });
        return response;
      },
    });
    await expect(
      source.readOffer({
        sourceScope,
        offerId: 'offer-a',
        requestId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toEqual({ signed: true });
    expect(calls[0]?.url).toBe(
      'https://source.example.test/gridstory/api/v1/federation/source/offers/offer-a?requestId=00000000-0000-4000-8000-000000000001',
    );
    expect(calls[0]?.init?.redirect).toBe('error');
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer configured-service-credential',
      'x-gridstory-organization': sourceScope.organizationId,
      'x-gridstory-tenant': sourceScope.tenantId,
      'x-gridstory-environment': sourceScope.environmentId,
    });
  });

  it('rejects insecure configuration and normalizes transport diagnostics', async () => {
    expect(
      () => new HttpContentFederationSource({ name: 'bad', baseUrl: 'http://source.test' }),
    ).toThrow(/credential-free HTTPS/u);
    const source = new HttpContentFederationSource({
      name: 'source-http',
      baseUrl: 'https://source.example.test/',
      fetch: async () => {
        throw new Error('provider-token=must-not-escape');
      },
    });
    await expect(
      source.readOffer({
        sourceScope,
        offerId: 'offer-a',
        requestId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toMatchObject({
      code: 'content_federation_source_unavailable',
      message: 'Content federation source is unavailable.',
      statusCode: 502,
    });
  });
});
