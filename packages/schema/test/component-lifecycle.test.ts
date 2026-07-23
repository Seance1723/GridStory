import { describe, expect, it } from 'vitest';
import { componentManifestSchema } from '../src/index.js';

const base = {
  id: 'hero',
  version: 2,
  name: 'Hero',
  props: [],
  slots: [],
};

describe('component lifecycle contracts', () => {
  it('normalizes declarative migrations, deprecation, and visual regression scenarios', () => {
    const manifest = componentManifestSchema.parse({
      ...base,
      status: 'deprecated',
      deprecation: { reason: 'Use Banner.', replacementId: 'banner' },
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          operations: [{ kind: 'rename-prop', from: 'heading', to: 'headline' }],
        },
      ],
      visualRegression: {
        scenarios: [
          {
            id: 'desktop',
            name: 'Desktop',
            props: { headline: 'Hello' },
            viewport: { width: 1440, height: 900 },
          },
        ],
      },
    });

    expect(manifest.status).toBe('deprecated');
    expect(manifest.migrations[0]?.toVersion).toBe(2);
    expect(manifest.visualRegression.scenarios[0]?.id).toBe('desktop');
  });

  it('rejects unexplained deprecation, ambiguous migrations, and duplicate scenarios', () => {
    const result = componentManifestSchema.safeParse({
      ...base,
      status: 'deprecated',
      migrations: [
        { fromVersion: 1, toVersion: 2, operations: [{ kind: 'remove-prop', name: 'old' }] },
        {
          fromVersion: 1,
          toVersion: 2,
          operations: [{ kind: 'set-default', name: 'tone', value: 'calm' }],
        },
      ],
      visualRegression: {
        scenarios: [
          { id: 'same', name: 'One' },
          { id: 'same', name: 'Two' },
        ],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'Deprecated components must explain their deprecation.',
          'Component version 1 has more than one migration.',
          'Visual regression scenario same is duplicated.',
        ]),
      );
    }
  });
});
