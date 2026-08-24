import { generateKeyPairSync, sign } from 'node:crypto';
import type { ContentSchemaDefinition, ContentScope } from '@gridstory/schema';
import { describe, expect, it } from 'vitest';
import {
  ContentFederationService,
  type ContentFederationSigner,
  type ContentFederationSourceAdapter,
  ContentService,
  InMemoryContentFederationRepository,
  SqliteContentFederationRepository,
  SqliteContentRepository,
} from '../src/index.js';

const pageSchema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: '',
  collection: 'pages',
  titleField: 'title',
  route: { pattern: '/:slug', slugField: 'slug' },
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true },
    {
      id: 'page.slug',
      name: 'slug',
      label: 'Slug',
      type: 'slug',
      required: true,
      pattern: '^[a-z0-9-]+$',
    },
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
const now = new Date('2026-08-24T10:00:00.000Z');

function ids() {
  let counter = 0;
  return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
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

class DirectSource implements ContentFederationSourceAdapter {
  readonly name = 'source-http';
  mutate: ((value: unknown) => unknown) | undefined;

  constructor(private readonly source: ContentFederationService) {}

  async readOffer(input: Parameters<ContentFederationSourceAdapter['readOffer']>[0]) {
    const value = await this.source.offerEnvelope(
      input.sourceScope,
      input.offerId,
      input.requestId,
    );
    return this.mutate ? this.mutate(value) : value;
  }

  async readRecord(input: Parameters<ContentFederationSourceAdapter['readRecord']>[0]) {
    const value = await this.source.recordEnvelope({ scope: input.sourceScope, ...input });
    return this.mutate ? this.mutate(value) : value;
  }

  async readSnapshot(input: Parameters<ContentFederationSourceAdapter['readSnapshot']>[0]) {
    const value = await this.source.snapshotEnvelope({ scope: input.sourceScope, ...input });
    return this.mutate ? this.mutate(value) : value;
  }
}

async function fixture(mode: 'live' | 'mirror') {
  const contentRepository = new SqliteContentRepository({ filename: ':memory:' });
  const content = new ContentService({
    repository: contentRepository,
    schemas: [pageSchema],
    componentManifests: [],
  });
  const created = await content.create({
    scope: sourceScope,
    id: 'page-a',
    contentType: 'page',
    data: { title: 'Federated page', slug: 'federated-page' },
    actor: { id: 'source-author' },
  });
  await content.publish({
    scope: sourceScope,
    id: created.id,
    expectedRevisionId: created.draftRevisionId,
    actor: { id: 'source-publisher' },
  });
  const signer = signingFixture();
  const source = new ContentFederationService({
    repository: new InMemoryContentFederationRepository(),
    contentRepository,
    contentService: content,
    signer,
    now: () => new Date(now),
    createId: ids(),
  });
  await source.upsertOffer(sourceScope, 'source-admin', {
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
  });
  const adapter = new DirectSource(source);
  const consumer = new ContentFederationService({
    repository: new InMemoryContentFederationRepository(),
    contentRepository,
    contentService: content,
    sources: [adapter],
    now: () => new Date(now),
    createId: ids(),
  });
  await consumer.inspectAgreement(consumerScope, 'agreement-a', 'consumer-admin', {
    expectedVersion: 0,
    adapter: adapter.name,
    sourceScope,
    sourceInstance: 'https://source.example.test/',
    canonicalBaseUrl: 'https://source.example.test/content/',
    offerId: 'offer-a',
    mode,
    trustedKey: signer.publicKey,
  });
  await consumer.setAgreementState(consumerScope, 'agreement-a', 'consumer-admin', {
    expectedVersion: 1,
    state: 'active',
  });
  return { adapter, consumer, contentRepository, signer };
}

describe('ContentFederationService', () => {
  it('resolves a fresh signed live record without persisting a mirror', async () => {
    const { consumer, contentRepository } = await fixture('live');
    try {
      const record = await consumer.publicRecord({
        scope: consumerScope,
        agreementId: 'agreement-a',
        namespace: 'offer-a:page',
        sourceEntryId: 'page-a',
      });
      expect(record).toMatchObject({
        namespace: 'offer-a:page',
        sourceEntryId: 'page-a',
        data: { title: 'Federated page' },
        attribution: {
          creditText: 'Provided by Source A',
          licenseUrl: 'https://source.example.test/license',
          sourceRevisionSequence: 1,
        },
      });
      expect((await consumer.snapshot(consumerScope)).mirrors).toEqual([]);
    } finally {
      contentRepository.close();
    }
  });

  it('previews, applies, retries, and explicitly tombstones a mirror withdrawal', async () => {
    const { consumer, contentRepository } = await fixture('mirror');
    try {
      const plan = await consumer.planSync(consumerScope, 'agreement-a', 2, 'consumer-admin');
      expect(plan.effects).toEqual([
        expect.objectContaining({ action: 'create', sourceEntryId: 'page-a' }),
      ]);
      const receipt = await consumer.executeSync(consumerScope, plan.id, 'consumer-admin', {
        expectedVersion: 3,
        digest: plan.digest,
      });
      expect(receipt).toMatchObject({ created: 1, updated: 0, withdrawn: 0 });
      await expect(
        consumer.executeSync(consumerScope, plan.id, 'consumer-admin', {
          expectedVersion: 3,
          digest: plan.digest,
        }),
      ).resolves.toEqual(receipt);
      await expect(
        consumer.publicRecord({
          scope: consumerScope,
          agreementId: 'agreement-a',
          namespace: 'offer-a:page',
          sourceEntryId: 'page-a',
        }),
      ).resolves.toMatchObject({ sourceEntryId: 'page-a' });

      await contentRepository.deleteEntry({ scope: sourceScope, id: 'page-a' });
      const afterCreate = await consumer.snapshot(consumerScope);
      const withdrawal = await consumer.planSync(
        consumerScope,
        'agreement-a',
        afterCreate.version,
        'consumer-admin',
      );
      expect(withdrawal.effects).toEqual([
        expect.objectContaining({ action: 'withdraw', sourceEntryId: 'page-a' }),
      ]);
      const afterPlan = await consumer.snapshot(consumerScope);
      await consumer.executeSync(consumerScope, withdrawal.id, 'consumer-admin', {
        expectedVersion: afterPlan.version,
        digest: withdrawal.digest,
      });
      await expect(
        consumer.publicRecord({
          scope: consumerScope,
          agreementId: 'agreement-a',
          namespace: 'offer-a:page',
          sourceEntryId: 'page-a',
        }),
      ).resolves.toBeNull();
      expect((await consumer.snapshot(consumerScope)).mirrors[0]).toMatchObject({
        state: 'withdrawn',
        attribution: { creditText: 'Provided by Source A' },
      });
    } finally {
      contentRepository.close();
    }
  });

  it('fails closed on tampered signatures and cross-scope source evidence', async () => {
    const { adapter, consumer, contentRepository } = await fixture('live');
    try {
      adapter.mutate = (value) => {
        const envelope = structuredClone(value) as {
          payload: { sourceScope: ContentScope };
          signature: { value: string };
        };
        envelope.payload.sourceScope.tenantId = 'other-tenant';
        return envelope;
      };
      await expect(
        consumer.publicRecord({
          scope: consumerScope,
          agreementId: 'agreement-a',
          namespace: 'offer-a:page',
          sourceEntryId: 'page-a',
        }),
      ).rejects.toMatchObject({ code: 'content_federation_source_invalid', statusCode: 502 });
    } finally {
      contentRepository.close();
    }
  });

  it('round-trips a complete-scope document through SQLite optimistic persistence', () => {
    const repository = new SqliteContentFederationRepository({ filename: ':memory:' });
    try {
      const document = {
        ...consumerScope,
        schemaVersion: 1 as const,
        version: 1,
        offers: [],
        agreements: [],
        mirrors: [],
        plans: [],
        receipts: [],
        updatedBy: 'admin-a',
        updatedAt: now.toISOString(),
      };
      repository.save(document, null);
      expect(repository.get(consumerScope)).toEqual(document);
      expect(() => repository.save({ ...document, version: 2 }, 0)).toThrowError(/state changed/u);
    } finally {
      repository.close();
    }
  });
});
