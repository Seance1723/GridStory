import { articleSchema, componentManifests, pageSchema } from '@gridstory/example-kit/manifests';
import { describe, expect, it } from 'vitest';
import { candidateIssueMessage, createContentCandidate } from '../src/content-authoring.js';

describe('registered content creation candidates', () => {
  it.each([pageSchema, articleSchema])('creates a canonical valid $id candidate', (schema) => {
    let id = 0;
    const result = createContentCandidate({
      schema,
      manifests: componentManifests,
      suffix: 'test',
      createId: () => `node-${++id}`,
    });
    expect(result).toMatchObject({ valid: true, issues: [] });
    expect(result.data[schema.titleField]).toBe(`Untitled ${schema.name}`);
    expect('blocks' in result.data).toBe(schema.id === 'page');
  });

  it('reports exact canonical paths without sending an invalid component candidate', () => {
    const result = createContentCandidate({
      schema: pageSchema,
      manifests: [],
      suffix: 'test',
      createId: () => 'unused',
    });
    expect(result.valid).toBe(false);
    expect(candidateIssueMessage(result.issues)).toContain(
      'blocks: Page blocks has too few values.',
    );
  });
});
