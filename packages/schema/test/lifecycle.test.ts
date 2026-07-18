import { describe, expect, it } from 'vitest';
import {
  createSchemaIr,
  createSchemaMigrationPlan,
  detectSchemaDrift,
  diffSchemaIr,
  schemaIrFingerprint,
} from '../src/index.js';
import { generateTypeScriptContracts } from '../src/typegen.js';

const before = createSchemaIr({
  schemas: [
    {
      id: 'article',
      version: 1,
      name: 'Article',
      collection: 'articles',
      titleField: 'title',
      route: { pattern: '/articles/:slug', slugField: 'slug' },
      fields: [
        { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
        { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
        { id: 'article.legacy', name: 'legacy', label: 'Legacy', type: 'text' },
      ],
    },
  ],
  components: [
    {
      id: 'hero',
      version: 1,
      name: 'Hero',
      props: [],
      slots: [],
    },
  ],
});

const after = createSchemaIr({
  schemas: [
    {
      id: 'article',
      version: 2,
      name: 'Article',
      collection: 'articles',
      titleField: 'headline',
      route: { pattern: '/content/:slug', slugField: 'slug' },
      fields: [
        {
          id: 'article.title',
          name: 'headline',
          label: 'Headline',
          type: 'text',
          required: true,
        },
        { id: 'article.slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
        { id: 'article.summary', name: 'summary', label: 'Summary', type: 'text' },
        {
          id: 'article.category',
          name: 'category',
          label: 'Category',
          type: 'enum',
          required: true,
          values: ['news', 'guide'],
        },
      ],
    },
  ],
  components: [],
});

describe('schema lifecycle', () => {
  it('diffs by stable IDs and classifies compatibility and affected surfaces', () => {
    const diff = diffSchemaIr(before, after);
    expect(diff.changes.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        'field-renamed',
        'field-removed',
        'field-added',
        'schema-route-changed',
        'component-removed',
      ]),
    );
    expect(diff.summary).toEqual({ safe: 3, backfill: 3, destructive: 2 });
    expect(diff.compatible).toBe(false);
    expect(diff.changes.find((item) => item.kind === 'field-renamed')?.impact).toMatchObject({
      entries: true,
      api: true,
      queries: true,
      workflows: true,
      searchIndexes: true,
    });
  });

  it('creates a deterministic, approval-gated migration plan with rollback policy', () => {
    const plan = createSchemaMigrationPlan(before, after);
    expect(createSchemaMigrationPlan(before, after)).toEqual(plan);
    expect(plan.id).toMatch(/^migration_[a-f0-9]{20}$/);
    expect(plan.approval.required).toBe(true);
    expect(plan.estimate).toEqual({ lock: 'long', dataScanRequired: true });
    expect(plan.rollback.mode).toBe('unavailable');
    expect(plan.steps.some((step) => step.backfillHook?.includes('field_renamed'))).toBe(true);
    expect(plan.steps.find((step) => step.operation === 'field-removed')).toMatchObject({
      reversible: false,
      risk: 'destructive',
    });
  });

  it('reports source, deployed, database, and generated-type drift independently', () => {
    const generatedTypes = generateTypeScriptContracts(before.schemas, before.components);
    const synchronized = detectSchemaDrift({
      source: before,
      deployed: before,
      databaseFingerprint: schemaIrFingerprint(before),
      generatedTypes,
    });
    expect(synchronized.inSync).toBe(true);
    expect(synchronized.states.every((state) => state.status === 'match')).toBe(true);

    const drifted = detectSchemaDrift({
      source: after,
      deployed: before,
      databaseFingerprint: schemaIrFingerprint(before),
      generatedTypes,
    });
    expect(drifted.inSync).toBe(false);
    expect(Object.fromEntries(drifted.states.map((state) => [state.source, state.status]))).toEqual(
      {
        source: 'match',
        deployed: 'drift',
        database: 'drift',
        'generated-types': 'drift',
      },
    );
  });
});
