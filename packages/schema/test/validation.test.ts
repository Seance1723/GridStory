import { describe, expect, it } from 'vitest';
import type { ComponentManifest, ContentSchemaDefinition } from '../src/index.js';
import { validateContent } from '../src/index.js';

const schema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  description: 'A test page',
  collection: 'pages',
  titleField: 'title',
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
    {
      id: 'page.blocks',
      name: 'blocks',
      label: 'Blocks',
      type: 'component-tree',
      required: true,
      minimum: 1,
      accepts: ['hero'],
    },
  ],
};

const manifest: ComponentManifest = {
  id: 'hero',
  version: 1,
  name: 'Hero',
  description: '',
  category: 'Marketing',
  strictProps: true,
  slots: [],
  props: [
    {
      id: 'hero.heading',
      name: 'heading',
      label: 'Heading',
      type: 'text',
      required: true,
      maxLength: 80,
    },
  ],
};

describe('validateContent', () => {
  it('accepts content that matches the schema and component manifest', () => {
    const result = validateContent(
      schema,
      {
        title: 'Welcome',
        slug: 'welcome',
        blocks: [{ id: 'block-1', component: 'hero', version: 1, props: { heading: 'Hello' } }],
      },
      [manifest],
    );

    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('reports field, component, and prop problems with paths', () => {
    const result = validateContent(
      schema,
      {
        title: '',
        slug: 'Not Valid',
        blocks: [
          { id: 'block-1', component: 'hero', version: 2, props: { heading: '', surprise: true } },
        ],
      },
      [manifest],
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['required', 'invalid_format', 'component_version', 'unknown_prop']),
    );
  });
});
