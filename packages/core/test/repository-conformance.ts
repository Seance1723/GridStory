import {
  createSchemaIr,
  generatedTypesFingerprint,
  schemaIrFingerprint,
  type ContentScope,
} from '@gridstory/schema';
import { generateTypeScriptContracts } from '@gridstory/schema/typegen';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  type ContentRepository,
  type PortableContentRecord,
  verifyAuditEvents,
} from '../src/index.js';

export interface RepositoryFixture {
  repository: ContentRepository;
  cleanup?: () => Promise<void>;
}

export type RepositoryFixtureFactory = () => RepositoryFixture | Promise<RepositoryFixture>;

const actor = { id: 'conformance-user' };

function scope(overrides: Partial<ContentScope> = {}): ContentScope {
  return {
    organizationId: 'organization-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    siteId: 'site-a',
    environmentId: 'development',
    locale: 'en',
    ...overrides,
  };
}

function page(title: string, slug = title.toLowerCase().replaceAll(' ', '-')) {
  return { title, slug, blocks: [] };
}

export function repositoryConformance(name: string, createFixture: RepositoryFixtureFactory): void {
  describe(`${name} repository conformance`, () => {
    let fixture: RepositoryFixture;

    beforeEach(async () => {
      fixture = await createFixture();
    });

    afterEach(async () => {
      await fixture.repository.close();
      await fixture.cleanup?.();
    });

    it('preserves immutable revisions, perspectives, slugs, and audit history', async () => {
      const created = await fixture.repository.create({
        scope: scope(),
        contentType: 'page',
        data: page('First'),
        actor,
      });
      expect(created.status).toBe('draft');
      expect(
        await fixture.repository.getBySlug({
          scope: scope(),
          contentType: 'page',
          slug: 'first',
          perspective: 'published',
        }),
      ).toBeNull();

      const updated = await fixture.repository.updateDraft({
        scope: scope(),
        id: created.id,
        expectedRevisionId: created.draftRevisionId,
        data: page('Published'),
        actor,
      });
      const published = await fixture.repository.publish({
        scope: scope(),
        id: created.id,
        expectedRevisionId: updated.draftRevisionId,
        actor,
      });
      const changed = await fixture.repository.updateDraft({
        scope: scope(),
        id: created.id,
        expectedRevisionId: published.draftRevisionId,
        data: page('Future'),
        actor,
      });

      expect(changed.status).toBe('changed');
      expect(
        await fixture.repository.getBySlug({
          scope: scope(),
          contentType: 'page',
          slug: 'published',
          perspective: 'published',
        }),
      ).toMatchObject({ id: created.id, data: page('Published') });
      expect(
        await fixture.repository.getById({ scope: scope(), id: created.id, perspective: 'draft' }),
      ).toMatchObject({ data: page('Future') });

      const revisions = await fixture.repository.listRevisions({ scope: scope(), id: created.id });
      expect(revisions.map((revision) => revision.sequence)).toEqual([3, 2, 1]);
      expect(revisions.map((revision) => revision.data.title)).toEqual([
        'Future',
        'Published',
        'First',
      ]);

      const audit = await fixture.repository.listAuditEvents({ scope: scope(), id: created.id });
      expect(audit).toHaveLength(4);
      expect(verifyAuditEvents(audit)).toMatchObject({ valid: true, eventCount: 4, entryCount: 1 });
      expect(audit.every((event) => /^[a-f0-9]{64}$/u.test(event.eventHash))).toBe(true);
      expect(await fixture.repository.listScopeAuditEvents({ scope: scope() })).toHaveLength(4);
      expect(
        await fixture.repository.listScopeAuditEvents({ scope: scope({ siteId: 'site-b' }) }),
      ).toEqual([]);
      expect(audit.map((event) => event.action).sort()).toEqual([
        'content.created',
        'content.draft.updated',
        'content.draft.updated',
        'content.published',
      ]);
    });

    it('rejects stale writes without creating another revision', async () => {
      const created = await fixture.repository.create({
        scope: scope(),
        contentType: 'page',
        data: page('First'),
        actor,
      });
      await fixture.repository.updateDraft({
        scope: scope(),
        id: created.id,
        expectedRevisionId: created.draftRevisionId,
        data: page('Second'),
        actor,
      });

      await expect(async () => {
        await fixture.repository.updateDraft({
          scope: scope(),
          id: created.id,
          expectedRevisionId: created.draftRevisionId,
          data: page('Stale'),
          actor,
        });
      }).rejects.toThrow(ConflictError);
      expect(
        await fixture.repository.listRevisions({ scope: scope(), id: created.id }),
      ).toHaveLength(2);
    });

    it('isolates every scope dimension and filters by content type', async () => {
      const created = await fixture.repository.create({
        scope: scope(),
        contentType: 'page',
        data: page('Private'),
        actor,
      });
      await fixture.repository.create({
        scope: scope(),
        contentType: 'article',
        data: page('Article'),
        actor,
      });

      expect(
        await fixture.repository.list({
          scope: scope(),
          contentType: 'page',
          perspective: 'draft',
        }),
      ).toHaveLength(1);

      const foreignScopes = [
        scope({ organizationId: 'organization-b' }),
        scope({ tenantId: 'tenant-b' }),
        scope({ workspaceId: 'workspace-b' }),
        scope({ siteId: 'site-b' }),
        scope({ environmentId: 'production' }),
        scope({ locale: 'fr' }),
      ];
      for (const foreignScope of foreignScopes) {
        expect(
          await fixture.repository.list({ scope: foreignScope, perspective: 'draft' }),
        ).toEqual([]);
        expect(
          await fixture.repository.getById({
            scope: foreignScope,
            id: created.id,
            perspective: 'draft',
          }),
        ).toBeNull();
      }
    });

    it('links locale variants to one translation group without weakening scope isolation', async () => {
      const english = await fixture.repository.create({
        scope: scope(),
        contentType: 'page',
        data: page('English'),
        actor,
      });
      const translationGroupId = await fixture.repository.getTranslationGroup({
        scope: scope(),
        id: english.id,
      });
      expect(translationGroupId).toBe(english.id);

      const french = await fixture.repository.create({
        scope: scope({ locale: 'fr' }),
        contentType: 'page',
        data: page('French', 'francais'),
        actor,
        translationGroupId: translationGroupId ?? undefined,
      });
      const variants = await fixture.repository.listTranslationVariants({
        scope: scope(),
        translationGroupId: translationGroupId ?? '',
        perspective: 'draft',
      });
      expect(variants.map((variant) => [variant.locale, variant.id])).toEqual([
        ['en', english.id],
        ['fr', french.id],
      ]);
      expect(
        await fixture.repository.listTranslationVariants({
          scope: scope({ siteId: 'site-b' }),
          translationGroupId: translationGroupId ?? '',
          perspective: 'draft',
        }),
      ).toEqual([]);
    });

    it('persists atomic outbox events, exclusive leases, idempotent jobs, and scoped webhooks', async () => {
      const created = await fixture.repository.create({
        scope: scope(),
        contentType: 'page',
        data: page('Events'),
        actor,
      });
      const events = await fixture.repository.listOutboxEvents({ scope: scope() });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'content.created',
        aggregateId: created.id,
        revisionId: created.draftRevisionId,
        state: 'pending',
        attempts: 0,
      });
      expect(events[0]?.cacheTags).toEqual(
        expect.arrayContaining([expect.stringContaining(`:entry:${created.id}`)]),
      );
      expect(await fixture.repository.listOperationalScopes()).toContainEqual(scope());

      const claimed = await fixture.repository.claimOutboxEvents({
        scope: scope(),
        workerId: 'worker-a',
        limit: 10,
        now: '9999-01-01T00:00:00.000Z',
        leaseExpiresAt: '9999-01-01T00:01:00.000Z',
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        state: 'processing',
        attempts: 1,
        leaseOwner: 'worker-a',
      });
      expect(
        await fixture.repository.claimOutboxEvents({
          scope: scope(),
          workerId: 'worker-b',
          limit: 10,
          now: '9999-01-01T00:00:30.000Z',
          leaseExpiresAt: '9999-01-01T00:02:00.000Z',
        }),
      ).toEqual([]);
      await fixture.repository.completeOutboxEvent({
        scope: scope(),
        id: claimed[0]?.id ?? '',
        workerId: 'worker-a',
        completedAt: '9999-01-01T00:00:10.000Z',
      });
      expect(await fixture.repository.listOutboxEvents({ scope: scope() })).toEqual([
        expect.objectContaining({ state: 'succeeded', processedAt: '9999-01-01T00:00:10.000Z' }),
      ]);

      const firstJob = await fixture.repository.enqueueJob({
        scope: scope(),
        type: 'cache.invalidate',
        idempotencyKey: 'event:cache',
        payload: { tags: ['one'] },
        runAt: '2000-01-01T00:00:00.000Z',
        maxAttempts: 3,
      });
      const duplicateJob = await fixture.repository.enqueueJob({
        scope: scope(),
        type: 'cache.invalidate',
        idempotencyKey: 'event:cache',
        payload: { tags: ['different'] },
        runAt: '2000-01-01T00:00:00.000Z',
        maxAttempts: 3,
      });
      expect(duplicateJob.id).toBe(firstJob.id);
      expect(duplicateJob.payload).toEqual({ tags: ['one'] });
      const jobs = await fixture.repository.claimJobs({
        scope: scope(),
        workerId: 'job-worker',
        limit: 10,
        now: '9999-01-01T00:00:00.000Z',
        leaseExpiresAt: '9999-01-01T00:01:00.000Z',
      });
      expect(jobs).toEqual([
        expect.objectContaining({ id: firstJob.id, state: 'processing', attempts: 1 }),
      ]);
      await fixture.repository.failJob({
        scope: scope(),
        id: firstJob.id,
        workerId: 'job-worker',
        runAt: '9999-01-01T00:02:00.000Z',
        error: 'temporary',
        dead: false,
      });
      expect(await fixture.repository.getJob({ scope: scope(), id: firstJob.id })).toMatchObject({
        state: 'pending',
        lastError: 'temporary',
      });

      const webhook = await fixture.repository.saveWebhookSubscription({
        scope: scope(),
        url: 'https://hooks.example.test/gridstory',
        eventTypes: ['content.published'],
      });
      expect(await fixture.repository.listWebhookSubscriptions({ scope: scope() })).toEqual([
        webhook,
      ]);
      expect(
        await fixture.repository.listWebhookSubscriptions({ scope: scope({ siteId: 'site-b' }) }),
      ).toEqual([]);
      expect(
        await fixture.repository.deleteWebhookSubscription({ scope: scope(), id: webhook.id }),
      ).toBe(true);
    });

    it('dry-runs and atomically imports stable logical content records', async () => {
      const targetScope = scope({ siteId: 'portable-target' });
      const record: PortableContentRecord = {
        entryId: 'portable-entry',
        contentType: 'page',
        currentDraftRevisionId: 'portable-revision',
        publishedRevisionId: 'portable-revision',
        translationGroupId: 'portable-group',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        revisions: [
          {
            id: 'portable-revision',
            sequence: 1,
            actorId: actor.id,
            data: page('Portable'),
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        auditEvents: [
          {
            id: 'portable-audit',
            sequence: 1,
            actorId: actor.id,
            action: 'content.created',
            revisionId: 'portable-revision',
            occurredAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
      expect(
        await fixture.repository.importPortableContent({
          scope: targetScope,
          records: [record],
          conflictPolicy: 'reject',
          dryRun: true,
        }),
      ).toMatchObject({ imported: 1, dryRun: true, conflicts: [] });
      expect(
        await fixture.repository.getById({
          scope: targetScope,
          id: record.entryId,
          perspective: 'draft',
        }),
      ).toBeNull();

      expect(
        await fixture.repository.importPortableContent({
          scope: targetScope,
          records: [record],
          conflictPolicy: 'reject',
          dryRun: false,
        }),
      ).toMatchObject({ imported: 1, dryRun: false });
      expect(
        await fixture.repository.getById({
          scope: targetScope,
          id: record.entryId,
          perspective: 'published',
        }),
      ).toMatchObject({ id: record.entryId, data: page('Portable') });
      await expect(async () =>
        fixture.repository.importPortableContent({
          scope: targetScope,
          records: [record],
          conflictPolicy: 'reject',
          dryRun: false,
        }),
      ).rejects.toBeInstanceOf(ConflictError);

      const rollbackScope = scope({ siteId: 'portable-rollback' });
      const rollbackRecords: PortableContentRecord[] = [
        {
          ...record,
          entryId: 'portable-rollback-a',
          translationGroupId: 'portable-rollback-group-a',
          currentDraftRevisionId: 'portable-colliding-revision',
          publishedRevisionId: 'portable-colliding-revision',
          revisions: [{ ...record.revisions[0], id: 'portable-colliding-revision' }],
          auditEvents: [],
        },
        {
          ...record,
          entryId: 'portable-rollback-b',
          translationGroupId: 'portable-rollback-group-b',
          currentDraftRevisionId: 'portable-colliding-revision',
          publishedRevisionId: 'portable-colliding-revision',
          revisions: [{ ...record.revisions[0], id: 'portable-colliding-revision' }],
          auditEvents: [],
        },
      ];
      await expect(async () =>
        fixture.repository.importPortableContent({
          scope: rollbackScope,
          records: rollbackRecords,
          conflictPolicy: 'reject',
          dryRun: false,
        }),
      ).rejects.toThrow();
      expect(
        await fixture.repository.getById({
          scope: rollbackScope,
          id: 'portable-rollback-a',
          perspective: 'draft',
        }),
      ).toBeNull();
    });

    it('persists, replaces, and isolates canonical schema deployments', async () => {
      const firstDocument = createSchemaIr({
        schemas: [
          {
            id: 'page',
            version: 1,
            name: 'Page',
            collection: 'pages',
            titleField: 'title',
            fields: [
              {
                id: 'page.title',
                name: 'title',
                label: 'Title',
                type: 'text',
                required: true,
              },
            ],
          },
        ],
        components: [],
      });
      const firstTypes = generateTypeScriptContracts(
        firstDocument.schemas,
        firstDocument.components,
      );
      const saved = await fixture.repository.saveSchemaDeployment({
        scope: scope(),
        document: firstDocument,
        fingerprint: schemaIrFingerprint(firstDocument),
        generatedTypes: firstTypes,
        generatedTypesFingerprint: generatedTypesFingerprint(firstDocument),
        actor,
      });
      expect(saved).toMatchObject({ actorId: actor.id, document: firstDocument });
      expect(
        await fixture.repository.getSchemaDeployment({ scope: scope({ siteId: 'site-b' }) }),
      ).toBeNull();

      const secondDocument = createSchemaIr({
        schemas: [{ ...firstDocument.schemas[0], version: 2, name: 'Managed page' }],
        components: [],
      });
      const secondTypes = generateTypeScriptContracts(
        secondDocument.schemas,
        secondDocument.components,
      );
      await fixture.repository.saveSchemaDeployment({
        scope: scope(),
        document: secondDocument,
        fingerprint: schemaIrFingerprint(secondDocument),
        generatedTypes: secondTypes,
        generatedTypesFingerprint: generatedTypesFingerprint(secondDocument),
        migrationPlanId: 'migration_test',
        actor: { id: 'schema-deployer' },
      });
      expect(await fixture.repository.getSchemaDeployment({ scope: scope() })).toMatchObject({
        actorId: 'schema-deployer',
        migrationPlanId: 'migration_test',
        document: secondDocument,
      });
    });
  });
}
