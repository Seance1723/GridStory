import { describe, expect, it } from 'vitest';
import {
  collaborationChangeTargetSchema,
  collaborationOperationInputSchema,
  collaborationOperationSchema,
} from '../src/index.js';

describe('collaboration contracts', () => {
  it('normalizes online operation defaults while retaining optional causal metadata', () => {
    expect(
      collaborationOperationInputSchema.parse({
        target: { field: 'title' },
        value: 'Updated title',
      }),
    ).toEqual({
      branchId: 'main',
      target: { field: 'title' },
      kind: 'set',
      value: 'Updated title',
    });
  });

  it('requires explicit field/block targets and JSON operation values', () => {
    expect(
      collaborationChangeTargetSchema.safeParse({ entryId: 'entry-1', field: 'sections' }).success,
    ).toBe(true);
    expect(
      collaborationChangeTargetSchema.safeParse({
        entryId: 'entry-1',
        field: 'sections',
        property: 'heading',
      }).success,
    ).toBe(false);
    expect(
      collaborationOperationInputSchema.safeParse({
        target: { field: 'title' },
        value: new Date(),
      }).success,
    ).toBe(false);
  });

  it('rejects non-delete operations without values and cross-entry targets', () => {
    const base = {
      id: 'operation-1',
      entryId: 'entry-1',
      branchId: 'main',
      actorId: 'author',
      actorSequence: 1,
      dependencies: [],
      target: { entryId: 'entry-1', field: 'title' },
      kind: 'set',
      createdAt: '2026-08-21T00:00:00.000Z',
    };
    expect(collaborationOperationSchema.safeParse(base).success).toBe(false);
    expect(
      collaborationOperationSchema.safeParse({
        ...base,
        value: 'Title',
        target: { entryId: 'entry-2', field: 'title' },
      }).success,
    ).toBe(false);
    expect(collaborationOperationSchema.safeParse({ ...base, kind: 'delete' }).success).toBe(true);
  });
});
