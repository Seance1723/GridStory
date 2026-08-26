import { describe, expect, it } from 'vitest';
import { studioDestinations, studioNavigationGroups } from '../src/navigation.js';

describe('Studio navigation metadata', () => {
  it('retains every original destination exactly once in the agreed nonempty groups', () => {
    expect(studioNavigationGroups.map(({ id, destinations }) => [id, [...destinations]])).toEqual([
      ['content', ['pages', 'workflows', 'releases', 'search']],
      ['media', ['assets']],
      ['design', ['components']],
      ['seo-quality', ['quality']],
      ['insights', ['targeting', 'experiments']],
      ['apps', ['marketplace']],
      ['tools', ['migrations']],
      [
        'advanced',
        [
          'operations',
          'identity',
          'data-governance',
          'federation',
          'fleet',
          'regions',
          'ai-gateway',
          'knowledge',
        ],
      ],
    ]);
    const destinations = studioNavigationGroups.flatMap(({ destinations }) => [...destinations]);
    expect(destinations).toHaveLength(19);
    expect(new Set(destinations).size).toBe(19);
    expect([...destinations].sort()).toEqual(Object.keys(studioDestinations).sort());
    expect(new Set(studioNavigationGroups.map(({ id }) => id)).size).toBe(8);
  });

  it('provides stable readable leaf names and icons without placeholder destinations', () => {
    expect(studioDestinations.assets.label).toBe('Library');
    expect(studioDestinations.quality.label).toBe('Page checks');
    expect(studioDestinations.identity.label).toBe('Identity providers');
    for (const { label, icon } of Object.values(studioDestinations)) {
      expect(label.trim().length).toBeGreaterThan(0);
      expect(icon.startsWith('M') || icon.startsWith('m')).toBe(true);
    }
    expect(new Set(Object.values(studioDestinations).map(({ label }) => label)).size).toBe(19);
    expect(
      studioNavigationGroups.some(({ label }) =>
        ['Home', 'Settings', 'Commerce', 'People', 'Navigation'].includes(label),
      ),
    ).toBe(false);
  });
});
