import { describe, expect, it } from 'vitest';
import {
  createSchemaIr,
  deserializeSchemaIr,
  schemaIrFingerprint,
  schemaIrToVisualModel,
  serializeSchemaIr,
  sha256,
  visualModelToSchemaIr,
} from '../src/index.js';

const source = {
  schemas: [
    {
      id: 'page',
      version: 1,
      name: 'Page',
      collection: 'pages',
      titleField: 'title',
      fields: [
        { id: 'page.title', name: 'title', label: 'Title', type: 'text' as const, required: true },
        { id: 'page.slug', name: 'slug', label: 'Slug', type: 'slug' as const, required: true },
      ],
      route: { pattern: '/:slug', slugField: 'slug' },
    },
  ],
  components: [],
};

describe('canonical schema IR', () => {
  it('normalizes defaults and round-trips deterministically through JSON and the visual model', () => {
    const ir = createSchemaIr(source);
    expect(ir).toMatchObject({
      format: 'gridstory.schema-ir',
      irVersion: 1,
      schemas: [{ description: '', objects: [], taxonomies: [] }],
    });

    const serialized = serializeSchemaIr(ir);
    expect(serializeSchemaIr(deserializeSchemaIr(serialized))).toBe(serialized);
    expect(visualModelToSchemaIr(schemaIrToVisualModel(ir))).toEqual(ir);
    expect(schemaIrFingerprint(ir)).toBe(schemaIrFingerprint(deserializeSchemaIr(serialized)));
  });

  it('uses the standard SHA-256 digest', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('rejects duplicate schema, collection, and component identities', () => {
    expect(() =>
      createSchemaIr({
        schemas: [...source.schemas, { ...source.schemas[0], name: 'Duplicate page' }],
        components: [],
      }),
    ).toThrow();
  });
});
