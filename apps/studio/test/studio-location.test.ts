import { describe, expect, it } from 'vitest';
import { studioDestinations } from '../src/navigation.js';
import {
  formatStudioLocation,
  parseStudioLocation,
  type StudioLocation,
} from '../src/studio-location.js';

describe('finite Studio locations', () => {
  it('round trips every destination, registered type, and opaque entry ID without scope or draft parameters', () => {
    for (const destination of Object.keys(studioDestinations) as StudioLocation['destination'][]) {
      for (const type of ['page', 'article']) {
        for (const entryId of [undefined, 'page /?#&=+é', 'x'.repeat(256)]) {
          const location: StudioLocation = { destination, type, ...(entryId ? { entryId } : {}) };
          expect(parseStudioLocation(formatStudioLocation(location))).toEqual({
            location,
            invalid: false,
          });
        }
      }
    }
    expect(parseStudioLocation('')).toEqual({ location: { destination: 'home' }, invalid: false });
  });

  it.each([
    '#/unknown',
    '#/Pages',
    '#/pages/extra',
    '#studio-editor',
    '#/pages#extra',
    '#/pages?entry=a',
    '#/pages?entry=&type=page',
    '#/pages?type=not/a/type',
    `#/pages?type=${'a'.repeat(129)}`,
    '#/pages?entry=a&type=page&entry=b',
    '#/pages?entry=a&type=page&tenant=other',
    '#/pages?token=secret',
    '#/pages?entry=%&type=page',
    '#/pages?entry=%C3&type=page',
    '#/pages?entry=%00&type=page',
    '#/pages?entry=%7F&type=page',
    `#/pages?entry=${'a'.repeat(257)}&type=page`,
    `#/pages?${'a'.repeat(4096)}`,
  ])('rejects invalid address without reflecting its value: %s', (hash) => {
    expect(parseStudioLocation(hash)).toEqual({
      location: { destination: 'home' },
      invalid: true,
    });
  });
});
