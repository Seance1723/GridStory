import { describe, expect, it } from 'vitest';
import {
  migrationPlanSummarySchema,
  migrationRecipeInputSchema,
  migrationSourceSnapshotSchema,
} from '../src/index.js';

describe('migration contracts', () => {
  it('accepts a bounded deterministic mapping recipe and source snapshot', () => {
    expect(
      migrationRecipeInputSchema.parse({
        id: 'contentful-page',
        name: 'Contentful pages',
        provider: 'contentful',
        sourceType: 'contentful.Entry.page',
        targetContentType: 'page',
        publicationMode: 'mirror-source',
        fields: [
          { sourcePath: 'fields.title.en-US', targetField: 'title', transform: 'string' },
          { sourcePath: 'fields.slug.en-US', targetField: 'slug', transform: 'slug' },
        ],
      }),
    ).toMatchObject({ publicationMode: 'mirror-source' });
    expect(
      migrationSourceSnapshotSchema.parse({
        kind: 'full',
        complete: true,
        checkpoint: 'opaque-checkpoint',
        records: [
          {
            externalId: 'entry-1',
            sourceType: 'contentful.Entry.page',
            status: 'published',
            data: { fields: { title: { 'en-US': 'Hello' } } },
          },
        ],
      }).records,
    ).toHaveLength(1);
  });

  it('rejects duplicate targets, prototype paths, and private plan payloads in summaries', () => {
    expect(() =>
      migrationRecipeInputSchema.parse({
        id: 'unsafe',
        name: 'Unsafe',
        provider: 'sanity',
        sourceType: 'post',
        targetContentType: 'page',
        fields: [
          { sourcePath: '__proto__.title', targetField: 'title' },
          { sourcePath: 'slug.current', targetField: 'title' },
        ],
      }),
    ).toThrow();
    const summary = migrationPlanSummarySchema.parse({
      id: 'plan-1',
      projectId: 'project-1',
      projectVersion: 1,
      state: 'preview',
      snapshotKind: 'full',
      effects: [
        {
          externalId: 'source-1',
          sourceType: 'post',
          sourceStatus: 'draft',
          sourceChecksum: 'a'.repeat(64),
          action: 'create',
          publish: false,
          mappedData: { secret: 'must-not-cross-summary' },
          blockers: [],
        },
      ],
      counts: { create: 1, update: 0, publish: 0, noop: 0, sourceDeleted: 0, blocked: 0 },
      digest: 'b'.repeat(64),
      createdBy: 'actor-1',
      createdAt: '2026-08-23T00:00:00.000Z',
      expiresAt: '2026-08-23T01:00:00.000Z',
    });
    expect(summary.effects[0]).not.toHaveProperty('mappedData');
  });
});
