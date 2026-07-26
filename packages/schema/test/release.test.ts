import { describe, expect, it } from 'vitest';
import { releaseInputSchema } from '../src/index.js';

describe('release contract', () => {
  it('normalizes a manual rollback policy for a unique multi-entry release', () => {
    expect(
      releaseInputSchema.parse({
        name: 'Homepage launch',
        entries: [
          { entryId: 'page-a', revisionId: 'revision-a' },
          { entryId: 'page-b', revisionId: 'revision-b' },
        ],
      }),
    ).toMatchObject({ rollbackPolicy: { mode: 'manual' } });
  });

  it('rejects duplicate members and incomplete time-window rollback policy', () => {
    const result = releaseInputSchema.safeParse({
      name: 'Broken release',
      entries: [
        { entryId: 'page-a', revisionId: 'revision-a' },
        { entryId: 'page-a', revisionId: 'revision-b' },
      ],
      rollbackPolicy: { mode: 'time-window' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'A release cannot contain the same entry more than once.',
          'A time-window rollback policy requires windowHours.',
        ]),
      );
    }
  });
});
