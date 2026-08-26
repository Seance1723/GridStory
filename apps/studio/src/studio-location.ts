import { type StudioDestination, studioDestinations } from './navigation.js';

export type StudioLocation = { destination: StudioDestination; entryId?: string; type?: 'page' };
export type ParsedStudioLocation = { location: StudioLocation; invalid: boolean };

const fallback = (): ParsedStudioLocation => ({
  location: { destination: 'pages' },
  invalid: true,
});

// Only the fragment is Studio-owned. Never infer client scope from an address.
export function parseStudioLocation(hash: string): ParsedStudioLocation {
  if (!hash || hash === '#') return { location: { destination: 'pages' }, invalid: false };
  if (hash.length > 4096) return fallback();
  const match = /^#\/([a-z-]+)(?:\?([^#]*))?$/.exec(hash);
  if (!match || !Object.hasOwn(studioDestinations, match[1] ?? '')) return fallback();
  try {
    // URLSearchParams tolerates malformed percent escapes; our contract does not.
    decodeURIComponent(match[2] ?? '');
    const params = new URLSearchParams(match[2]);
    const keys = [...params.keys()];
    if (keys.some((key) => key !== 'entry' && key !== 'type') || new Set(keys).size !== keys.length)
      return fallback();
    const destination = match[1] as StudioDestination;
    if (keys.length === 0) return { location: { destination }, invalid: false };
    const entryId = params.get('entry');
    if (
      keys.length !== 2 ||
      !entryId ||
      entryId.length > 256 ||
      [...entryId].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      }) ||
      params.get('type') !== 'page'
    )
      return fallback();
    return { location: { destination, entryId, type: 'page' }, invalid: false };
  } catch {
    return fallback();
  }
}

export function formatStudioLocation(location: StudioLocation): string {
  const query = location.entryId
    ? `?${new URLSearchParams({ entry: location.entryId, type: 'page' })}`
    : '';
  return `#/${location.destination}${query}`;
}
