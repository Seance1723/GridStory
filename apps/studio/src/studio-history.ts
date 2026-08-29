import {
  formatStudioLocation,
  parseStudioLocation,
  type StudioLocation,
} from './studio-location.js';

const namespace = 'gridstoryStudio';
type Marker = { version: 1; owner: string; index: number };
type Request = (
  location: StudioLocation,
  context: { signal: AbortSignal; invalid: boolean },
) => Promise<StudioLocation | false>;

// A finite adapter for this document, not a router or a global History patch.
export function createStudioHistory(browser: Window, request: Request) {
  let owner = browser.crypto.randomUUID();
  const known = new Map<number, string>();
  let accepted = { hash: browser.location.hash, index: 0 };
  let observed = '';
  let disposed = false;
  let pending: AbortController | undefined;
  let compensation: typeof accepted | undefined;

  const marker = (): Marker | undefined => {
    const value = browser.history.state?.[namespace] as Marker | undefined;
    return value?.version === 1 &&
      value.owner === owner &&
      Number.isSafeInteger(value.index) &&
      known.get(value.index) === browser.location.hash
      ? value
      : undefined;
  };
  const key = () => `${marker()?.index ?? 'external'}:${browser.location.hash}`;
  const newEpoch = () => {
    owner = browser.crypto.randomUUID();
    known.clear();
    accepted = { ...accepted, index: 0 };
  };
  const write = (hash: string, index: number, push: boolean) => {
    const previous = browser.history.state;
    const state = {
      ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
      [namespace]: { version: 1, owner, index } satisfies Marker,
    };
    const url = `${browser.location.pathname}${browser.location.search}${hash}`;
    browser.history[push ? 'pushState' : 'replaceState'](state, '', url);
    known.set(index, hash);
    accepted = { hash, index };
    observed = key();
  };
  const restore = () => {
    const current = marker();
    if (current && current.index !== accepted.index) {
      compensation = { ...accepted };
      browser.history.go(accepted.index - current.index);
    } else {
      // Unknown stacks cannot supply a trustworthy traversal delta.
      if (!current) newEpoch();
      write(accepted.hash, accepted.index, false);
    }
  };
  const push = (hash: string) => {
    const current = marker();
    if (!current) newEpoch();
    write(hash, (current?.index ?? accepted.index) + 1, true);
  };
  const transition = async (hash: string, external: boolean) => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const parsed = parseStudioLocation(hash);
    let result: StudioLocation | false;
    try {
      result = await request(parsed.location, {
        signal: controller.signal,
        invalid: parsed.invalid,
      });
    } catch {
      result = false;
    }
    if (disposed || controller.signal.aborted) return;
    pending = undefined;
    if (!result) {
      if (external || browser.location.hash !== accepted.hash) restore();
      return;
    }
    const canonical = formatStudioLocation(result);
    if (external) {
      const current = marker();
      if (!current) newEpoch();
      write(canonical, current?.index ?? accepted.index, false);
    } else if (canonical !== accepted.hash) push(canonical);
    else if (browser.location.hash !== accepted.hash) restore();
  };
  const onChange = () => {
    if (disposed) return;
    const currentKey = key();
    if (currentKey === observed) return;
    observed = currentKey;
    if (
      compensation &&
      marker()?.index === compensation.index &&
      browser.location.hash === compensation.hash
    ) {
      compensation = undefined;
      return;
    }
    compensation = undefined;
    void transition(browser.location.hash, true);
  };
  browser.addEventListener('popstate', onChange);
  browser.addEventListener('hashchange', onChange);
  return {
    replace(location: StudioLocation) {
      write(formatStudioLocation(location), accepted.index, false);
    },
    push(location: StudioLocation) {
      const hash = formatStudioLocation(location);
      if (hash !== accepted.hash) push(hash);
    },
    reset(location: StudioLocation) {
      pending?.abort();
      compensation = undefined;
      newEpoch();
      write(formatStudioLocation(location), 0, false);
    },
    navigate(location: StudioLocation) {
      if (compensation) return Promise.resolve();
      return transition(formatStudioLocation(location), false);
    },
    dispose() {
      disposed = true;
      pending?.abort();
      browser.removeEventListener('popstate', onChange);
      browser.removeEventListener('hashchange', onChange);
    },
  };
}

export type StudioHistory = ReturnType<typeof createStudioHistory>;
