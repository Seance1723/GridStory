// Finite Studio metadata, not an extension registry. Selection and feature state stay in App.
import type { StudioCapabilities } from '@gridstory/schema';

export const studioDestinations = {
  home: { label: 'Home', icon: 'M4 11.5 12 4l8 7.5V20h-5v-5H9v5H4z' },
  pages: { label: 'Pages', icon: 'M4 4h16v16H4zM8 4v16' },
  collections: {
    label: 'Collections',
    icon: 'M4 6h16v5H4zM4 13h16v5H4zM8 8.5h8M8 15.5h8',
  },
  schemas: {
    label: 'Schemas & taxonomies',
    icon: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7zM11 8h2M8 11v2M16 11v2',
  },
  workflows: { label: 'Workflows', icon: 'M5 5h5v5H5zM14 14h5v5h-5zM10 7h4a3 3 0 0 1 3 3v4' },
  releases: { label: 'Releases', icon: 'M5 19V5h14v14zM8 9h8M8 13h5' },
  search: {
    label: 'Search',
    icon: 'm20 20-4.4-4.4M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z',
  },
  operations: { label: 'Operations', icon: 'M4 18V9m6 9V4m6 14v-6m4 6H2' },
  identity: {
    label: 'Identity providers',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  },
  'data-governance': {
    label: 'Data governance',
    icon: 'M12 3 4 6v5c0 5 3.4 8.2 8 10 4.6-1.8 8-5 8-10V6zM9 12l2 2 4-5',
  },
  migrations: { label: 'Migrations', icon: 'M7 7h10M7 7l3-3M7 7l3 3M17 17H7m10 0-3-3m3 3-3 3' },
  marketplace: { label: 'Marketplace', icon: 'M4 8h16l-1 12H5zM8 8a4 4 0 0 1 8 0' },
  targeting: {
    label: 'Targeting',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  },
  experiments: {
    label: 'Experiments',
    icon: 'M9 3v5l-5 9a3 3 0 0 0 3 4h10a3 3 0 0 0 3-4l-5-9V3M7 15h10',
  },
  'ai-gateway': {
    label: 'AI gateway',
    icon: 'M12 3l1.4 4.1L17 5l-2.1 3.6L19 10l-4.1 1.4L17 15l-3.6-2.1L12 17l-1.4-4.1L7 15l2.1-3.6L5 10l4.1-1.4L7 5l3.6 2.1z',
  },
  knowledge: {
    label: 'Knowledge',
    icon: 'M4 5h6a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H4zM20 5h-6a3 3 0 0 0-3 3v12a3 3 0 0 1 3-3h6z',
  },
  quality: {
    label: 'Page checks',
    icon: 'M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  },
  federation: { label: 'Federation', icon: 'M8 7h8M8 12h8M8 17h8M4 4h16v16H4z' },
  fleet: { label: 'Fleet', icon: 'M5 6h14v12H5zM8 18v3m8-3v3M9 10h.01M12 10h.01M15 10h.01' },
  regions: {
    label: 'Regions',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18',
  },
  components: { label: 'Components', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  assets: { label: 'Library', icon: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M16 9h.01' },
  settings: {
    label: 'Configuration',
    icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 13.5v-3l-2-.7-.8-1.8.9-1.9-2.2-2.2-1.9.9-1.8-.8-.7-2h-3l-.7 2-1.8.8-1.9-.9-2.2 2.2.9 1.9-.8 1.8-2 .7v3l2 .7.8 1.8-.9 1.9 2.2 2.2 1.9-.9 1.8.8.7 2h3l.7-2 1.8-.8 1.9.9 2.2-2.2-.9-1.9.8-1.8z',
  },
} as const;

export type StudioDestination = keyof typeof studioDestinations;

export const studioPrimaryDestinations = ['home'] as const satisfies readonly StudioDestination[];

export const studioNavigationGroups = [
  {
    id: 'content',
    label: 'Content',
    destinations: ['pages', 'collections', 'schemas', 'workflows', 'releases', 'search'],
  },
  { id: 'media', label: 'Media', destinations: ['assets'] },
  { id: 'design', label: 'Design', destinations: ['components'] },
  { id: 'seo-quality', label: 'SEO & quality', destinations: ['quality'] },
  { id: 'insights', label: 'Insights', destinations: ['targeting', 'experiments'] },
  { id: 'apps', label: 'Apps', destinations: ['marketplace'] },
  { id: 'settings', label: 'Settings', destinations: ['settings'] },
  { id: 'tools', label: 'Tools', destinations: ['migrations'] },
  {
    id: 'advanced',
    label: 'Advanced',
    destinations: [
      'operations',
      'identity',
      'data-governance',
      'federation',
      'fleet',
      'regions',
      'ai-gateway',
      'knowledge',
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  destinations: readonly StudioDestination[];
}>;

export type StudioNavigationGroupId = (typeof studioNavigationGroups)[number]['id'];

export function permittedPrimaryNavigation(capabilities: StudioCapabilities) {
  return studioPrimaryDestinations.filter((destination) => capabilities.screens[destination]);
}

export function permittedNavigation(capabilities: StudioCapabilities) {
  return studioNavigationGroups
    .map((group) => ({
      ...group,
      destinations: group.destinations.filter((destination) => capabilities.screens[destination]),
    }))
    .filter((group) => group.destinations.length > 0);
}
