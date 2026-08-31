import { describe, expect, it } from 'vitest';
import {
  navigationMenuDataSchema,
  navigationMenuEntryId,
  navigationMenuLimits,
  navigationMenuProjectionSchema,
} from '../src/navigation.js';

const validMenu = {
  key: 'header',
  name: 'Header',
  items: [
    {
      id: 'home',
      label: 'Home',
      kind: 'internal' as const,
      target: { id: 'page-home', contentType: 'page' },
    },
    {
      id: 'company',
      label: 'Company',
      kind: 'external' as const,
      externalUrl: 'https://example.com/company?from=menu#team',
    },
    {
      id: 'about',
      parentId: 'company',
      label: 'About',
      kind: 'external' as const,
      externalUrl: 'http://example.com/about',
    },
  ],
};

describe('visitor navigation contracts', () => {
  it('accepts bounded ordered internal and credential-free HTTP(S) items', () => {
    expect(navigationMenuDataSchema.parse(validMenu)).toEqual(validMenu);
    expect(navigationMenuEntryId('header')).toBe('navigation-menu:header');
  });

  it.each([
    ['script scheme', { ...validMenu.items[1], externalUrl: 'javascript:alert(1)' }],
    ['credentials', { ...validMenu.items[1], externalUrl: 'https://user:secret@example.com' }],
    ['dual target', { ...validMenu.items[1], target: { id: 'page-home', contentType: 'page' } }],
    ['missing internal target', { id: 'broken', label: 'Broken', kind: 'internal' }],
  ])('rejects %s', (_name, item) => {
    expect(
      navigationMenuDataSchema.safeParse({ ...validMenu, items: [validMenu.items[0], item] })
        .success,
    ).toBe(false);
  });

  it('rejects duplicate, missing, forward, cyclic, deep and oversized structures', () => {
    const invalidStructures = [
      [validMenu.items[0], { ...validMenu.items[1], id: 'home' }],
      [{ ...validMenu.items[0], parentId: 'missing' }],
      [
        { ...validMenu.items[0], parentId: 'company' },
        { ...validMenu.items[1], id: 'company' },
      ],
      [{ ...validMenu.items[0], parentId: 'home' }],
      [
        validMenu.items[0],
        { ...validMenu.items[1], id: 'level-two', parentId: 'home' },
        { ...validMenu.items[1], id: 'level-three', parentId: 'level-two' },
        { ...validMenu.items[1], id: 'level-four', parentId: 'level-three' },
      ],
      Array.from({ length: navigationMenuLimits.maximumItems + 1 }, (_, index) => ({
        ...validMenu.items[1],
        id: `item-${index}`,
      })),
    ];
    invalidStructures.forEach((items) => {
      expect(navigationMenuDataSchema.safeParse({ ...validMenu, items }).success).toBe(false);
    });
  });

  it('keeps the delivery projection strict and bounded', () => {
    const projection = {
      schemaVersion: 1 as const,
      scope: {
        organizationId: 'org',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        siteId: 'site',
        environmentId: 'production',
        locale: 'en',
      },
      entryId: 'navigation-menu:header',
      key: 'header',
      name: 'Header',
      requestedLocale: 'en',
      resolvedLocale: 'en',
      perspective: 'published' as const,
      revisionId: 'revision-1',
      items: [
        {
          id: 'home',
          label: 'Home',
          kind: 'internal' as const,
          target: { id: 'page-home', contentType: 'page' },
          href: '/home',
        },
      ],
    };
    expect(navigationMenuProjectionSchema.parse(projection)).toEqual(projection);
    expect(
      navigationMenuProjectionSchema.safeParse({ ...projection, draftToken: 'never' }).success,
    ).toBe(false);
    expect(
      navigationMenuProjectionSchema.safeParse({
        ...projection,
        items: [{ ...projection.items[0], targetData: { title: 'private' } }],
      }).success,
    ).toBe(false);
  });
});
