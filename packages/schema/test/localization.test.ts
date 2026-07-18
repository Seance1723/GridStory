import { describe, expect, it } from 'vitest';
import { contentSchemaDefinitionSchema, createSchemaIr, diffSchemaIr } from '../src/index.js';

const source = {
  id: 'page',
  version: 1,
  name: 'Page',
  collection: 'pages',
  titleField: 'title',
  fields: [
    { id: 'page.title', name: 'title', label: 'Title', type: 'text' as const, required: true },
    { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug' as const, required: true },
  ],
};

describe('localized schema contracts', () => {
  it('rejects unknown localized fields and normalizes declared localized values', () => {
    expect(
      contentSchemaDefinitionSchema.safeParse({
        ...source,
        localization: { localizedFields: ['missing'] },
      }).success,
    ).toBe(false);
    expect(
      contentSchemaDefinitionSchema.parse({
        ...source,
        localization: { localizedFields: ['title', 'slug'] },
      }).localization,
    ).toEqual({ localizedFields: ['title', 'slug'] });
  });

  it('classifies localization changes as versioned backfill work with delivery impact', () => {
    const before = createSchemaIr({ schemas: [source], components: [] });
    const after = createSchemaIr({
      schemas: [
        {
          ...source,
          version: 2,
          localization: { localizedFields: ['title', 'slug'] },
        },
      ],
      components: [],
    });
    const diff = diffSchemaIr(before, after);
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'schema-localization-changed',
          risk: 'backfill',
          impact: expect.objectContaining({ entries: true, workflows: true }),
        }),
      ]),
    );
  });
});
