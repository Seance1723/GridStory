// @vitest-environment jsdom

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStudioHistory, type StudioHistory } from '../src/studio-history.js';

let adapter: StudioHistory | undefined;
afterEach(() => {
  adapter?.dispose();
  window.history.replaceState(null, '', '/');
});

describe('native Studio history', () => {
  it('preserves the served path, outer query and unrelated state without storing editor data', async () => {
    window.history.replaceState({ host: 'kept' }, '', '/studio/?host=1');
    adapter = createStudioHistory(window, async (location) => location);
    adapter.replace({ destination: 'pages', entryId: 'one', type: 'page' });
    const length = window.history.length;
    await adapter.navigate({ destination: 'search', entryId: 'one', type: 'page' });
    await adapter.navigate({ destination: 'search', entryId: 'one', type: 'page' });
    expect(window.history.length).toBe(length + 1);
    expect(window.location.pathname + window.location.search).toBe('/studio/?host=1');
    expect(Object.keys(window.history.state)).toEqual(['host', 'gridstoryStudio']);
    expect(Object.keys(window.history.state.gridstoryStudio)).toEqual([
      'version',
      'owner',
      'index',
    ]);
  });

  it('compensates cancelled owned multi-entry traversal, deduplicates events and still goes back/forward', async () => {
    const request = vi.fn(async (location) => location);
    adapter = createStudioHistory(window, request);
    adapter.replace({ destination: 'pages' });
    await adapter.navigate({ destination: 'search' });
    await adapter.navigate({ destination: 'assets' });
    request.mockResolvedValueOnce(false);
    window.history.go(-2);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(window.location.hash).toBe('#/assets'));
    expect(request).toHaveBeenCalledTimes(3);
    window.history.back();
    await waitFor(() => expect(window.location.hash).toBe('#/search'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    window.history.forward();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(5));
    expect(window.location.hash).toBe('#/assets');
  });

  it('restores a rejected unowned fragment without a guessed traversal and disposes listeners', async () => {
    const request = vi.fn(async () => false as const);
    adapter = createStudioHistory(window, request);
    adapter.replace({ destination: 'pages' });
    const owner = window.history.state.gridstoryStudio.owner;
    window.location.hash = '#/assets';
    await waitFor(() => expect(window.location.hash).toBe('#/pages'));
    expect(window.history.state.gridstoryStudio.owner).not.toBe(owner);
    expect(request).toHaveBeenCalledTimes(1);
    adapter.dispose();
    window.location.hash = '#/search';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('aborts superseded requests and ignores late acceptance', async () => {
    let resolveFirst!: (value: { destination: 'search' }) => void;
    let firstSignal: AbortSignal | undefined;
    adapter = createStudioHistory(window, async (location, { signal }) => {
      if (location.destination === 'search') {
        firstSignal = signal;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return location;
    });
    adapter.replace({ destination: 'pages' });
    const first = adapter.navigate({ destination: 'search' });
    await adapter.navigate({ destination: 'assets' });
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst({ destination: 'search' });
    await first;
    expect(window.location.hash).toBe('#/assets');
  });

  it('restores the accepted address when an internal rejection supersedes a pending traversal', async () => {
    const request = vi.fn(async (location) => location);
    adapter = createStudioHistory(window, request);
    adapter.replace({ destination: 'pages' });
    await adapter.navigate({ destination: 'search' });
    await adapter.navigate({ destination: 'assets' });
    let resolve!: (location: { destination: 'search' }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    window.history.back();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    request.mockResolvedValueOnce(false);
    await adapter.navigate({ destination: 'pages' });
    await waitFor(() => expect(window.location.hash).toBe('#/assets'));
    resolve({ destination: 'search' });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('accepts only the newest rapid Back request and supports subsequent Forward', async () => {
    const request = vi.fn(async (location) => location);
    adapter = createStudioHistory(window, request);
    adapter.replace({ destination: 'pages' });
    await adapter.navigate({ destination: 'search' });
    await adapter.navigate({ destination: 'assets' });
    let resolve!: (location: { destination: 'search' }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    window.history.back();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    window.history.back();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    resolve({ destination: 'search' });
    expect(window.location.hash).toBe('#/pages');
    window.history.forward();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(5));
    expect(window.location.hash).toBe('#/search');
  });
});
