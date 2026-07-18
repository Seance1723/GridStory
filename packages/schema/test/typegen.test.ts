import { describe, expect, it } from 'vitest';
import type { ComponentManifest, ContentSchemaDefinition } from '../src/contracts.js';
import { generateTypeScriptContracts } from '../src/typegen.js';

const schema: ContentSchemaDefinition = {
  id: 'article',
  version: 1,
  name: 'Article',
  collection: 'articles',
  titleField: 'title',
  fields: [
    { id: 'article.title', name: 'title', label: 'Title', type: 'text', required: true },
    { id: 'article.blocks', name: 'blocks', label: 'Blocks', type: 'component-tree' },
  ],
};

const manifest: ComponentManifest = {
  id: 'acme.hero',
  version: 1,
  name: 'Hero',
  props: [
    { id: 'hero.heading', name: 'heading', label: 'Heading', type: 'text', required: true },
    {
      id: 'hero.tone',
      name: 'tone',
      label: 'Tone',
      type: 'enum',
      values: ['light', 'dark'],
    },
  ],
  slots: [],
};

describe('TypeScript contract generation', () => {
  it('emits deterministic content, prop, slot, and lookup types', () => {
    const output = generateTypeScriptContracts([schema], [manifest]);

    expect(output).toContain('export interface ArticleContent');
    expect(output).toContain('title: string;');
    expect(output).toContain('blocks?: ComponentNode[];');
    expect(output).toContain('export interface AcmeHeroProps');
    expect(output).toContain("tone?: 'light' | 'dark';");
    expect(output).toContain('export interface ComponentPropsById');
  });
});
