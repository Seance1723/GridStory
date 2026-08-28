// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGridStoryClient } from '../src/index.js';
import { createGridStoryPreviewController, createGridStoryPreviewRuntime } from '../src/preview.js';

const grant = {
  token: 'gsp_token',
  sessionId: 'session-1',
  previewUrl: 'https://preview.example.test/',
  origin: 'https://preview.example.test',
  protocolVersion: 1 as const,
  expiresAt: '2026-07-23T12:00:00.000Z',
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('browser preview transport', () => {
  it('keeps scope-checked management revocation separate from preview self-revocation', async () => {
    const requests: RequestInit[] = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'tenant',
      scope: {
        organizationId: 'organization',
        workspaceId: 'workspace',
        siteId: 'site',
        environmentId: 'preview',
        locale: 'fr',
      },
      fetch: async (_input, init) => {
        requests.push(init ?? {});
        return new Response(null, { status: 204 });
      },
    });
    await client.revokePreviewSession('managed-session');
    await client.revokePreviewSession('self-session', 'gsp_preview-token');
    const managed = new Headers(requests[0]?.headers);
    expect(requests[0]?.credentials).toBe('include');
    expect(managed.get('authorization')).toBeNull();
    expect(managed.get('x-gridstory-tenant')).toBe('tenant');
    expect(managed.get('x-gridstory-site')).toBe('site');
    expect(managed.get('x-gridstory-environment')).toBe('preview');
    expect(managed.get('x-gridstory-locale')).toBe('fr');
    const self = new Headers(requests[1]?.headers);
    expect(self.get('authorization')).toBe('Bearer gsp_preview-token');
    expect(self.get('x-gridstory-tenant')).toBeNull();
  });

  it('bootstraps an exact-origin target and flushes the latest route and patch after readiness', () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const targetWindow = { postMessage } as unknown as Window;
    const onSelect = vi.fn();
    const controller = createGridStoryPreviewController({
      grant,
      targetWindow,
      controllerWindow: window,
      onSelect,
    });

    controller.start();
    controller.navigate('/draft');
    controller.patch({
      entryId: 'page-1',
      contentType: 'page',
      data: { title: 'Unsaved' },
    });
    expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'gridstory.preview.bootstrap',
      token: 'gsp_token',
    });
    expect(postMessage.mock.calls.every((call) => call[1] === grant.origin)).toBe(true);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: grant.origin,
        source: targetWindow,
        data: {
          type: 'gridstory.preview.ready',
          protocolVersion: 1,
          sessionId: grant.sessionId,
          sequence: 1,
          nonce: 'nonce-0000000001',
          payload: { route: '/' },
        },
      }),
    );

    expect(postMessage.mock.calls.map((call) => call[0].type)).toEqual([
      'gridstory.preview.bootstrap',
      'gridstory.preview.handshake',
      'gridstory.preview.navigate',
      'gridstory.preview.patch',
    ]);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: grant.origin,
        source: targetWindow,
        data: {
          type: 'gridstory.preview.select',
          protocolVersion: 1,
          sessionId: grant.sessionId,
          sequence: 4,
          nonce: 'nonce-0000000004',
          payload: { entryId: 'page-1', nodeId: 'hero-1' },
        },
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { entryId: 'page-1', nodeId: 'hero-1' } }),
    );
    controller.dispose();
  });

  it('accepts replay-checked messages before rendering patches and returning click selections', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGridStoryClient({
      baseUrl: 'http://gridstory.test',
      tenantId: 'tenant',
      fetch: async (input, init) => {
        requests.push({ url: String(input), ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ accepted: true, sequence: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const controllerPost = vi.fn();
    const controllerWindow = { postMessage: controllerPost } as unknown as Window;
    Object.defineProperty(window, 'opener', { configurable: true, value: controllerWindow });
    const onPatch = vi.fn();
    const runtime = createGridStoryPreviewRuntime({
      client,
      controllerOrigin: 'https://studio.example.test',
      runtimeWindow: window,
      onPatch,
    });
    runtime.start();

    const dispatch = (data: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://studio.example.test',
          source: controllerWindow,
          data,
        }),
      );
    dispatch({
      type: 'gridstory.preview.bootstrap',
      protocolVersion: 1,
      sessionId: grant.sessionId,
      token: grant.token,
    });
    dispatch({
      type: 'gridstory.preview.handshake',
      protocolVersion: 1,
      sessionId: grant.sessionId,
      sequence: 0,
      nonce: 'nonce-0000000000',
      payload: { origin: 'https://studio.example.test' },
    });
    await vi.waitFor(() => expect(controllerPost).toHaveBeenCalledOnce());

    dispatch({
      type: 'gridstory.preview.patch',
      protocolVersion: 1,
      sessionId: grant.sessionId,
      sequence: 2,
      nonce: 'nonce-0000000002',
      payload: { entryId: 'page-1', contentType: 'page', data: { title: 'Unsaved' } },
    });
    await vi.waitFor(() => expect(onPatch).toHaveBeenCalledOnce());

    const node = document.createElement('button');
    node.dataset.gridstoryNode = 'hero-1';
    document.body.append(node);
    node.click();
    await vi.waitFor(() => expect(controllerPost).toHaveBeenCalledTimes(2));
    expect(controllerPost.mock.calls[1]?.[0]).toMatchObject({
      type: 'gridstory.preview.select',
      payload: { entryId: 'page-1', nodeId: 'hero-1' },
    });
    expect(requests).toHaveLength(4);
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe('Bearer gsp_token');
    runtime.dispose();
  });
});
