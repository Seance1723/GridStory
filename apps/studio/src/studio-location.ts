import { type StudioDestination, studioDestinations } from './navigation.js';

export type StudioLocation = { destination: StudioDestination; entryId?: string; type?: string };
export type ParsedStudioLocation = { location: StudioLocation; invalid: boolean };

const fallback = (): ParsedStudioLocation => ({
  location: { destination: 'home' },
  invalid: true,
});

// Only the fragment is Studio-owned. Never infer client scope from an address.
export function parseStudioLocation(hash: string): ParsedStudioLocation {
  if (!hash || hash === '#') return { location: { destination: 'home' }, invalid: false };
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
    const contentType = params.get('type');
    if (
      !contentType ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(contentType) ||
      (entryId !== null &&
        (!entryId ||
          entryId.length > 256 ||
          [...entryId].some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || (code >= 127 && code <= 159);
          }))) ||
      (entryId !== null && keys.length !== 2) ||
      (entryId === null && keys.length !== 1)
    )
      return fallback();
    return {
      location: { destination, ...(entryId ? { entryId } : {}), type: contentType },
      invalid: false,
    };
  } catch {
    return fallback();
  }
}

export function formatStudioLocation(location: StudioLocation): string {
  const query = location.entryId
    ? `?${new URLSearchParams({ entry: location.entryId, type: location.type ?? 'page' })}`
    : location.type
      ? `?${new URLSearchParams({ type: location.type })}`
      : '';
  return `#/${location.destination}${query}`;
}
