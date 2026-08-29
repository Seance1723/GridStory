// @vitest-environment jsdom
import { createGridStoryClient, GridStoryApiError } from '@gridstory/client';
import {
  type StudioContext,
  studioContextSchema,
  studioDestinations,
  studioOperations,
} from '@gridstory/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioSession, type StudioSessionView } from '../src/studio-session.js';

function context(): StudioContext {
  return studioContextSchema.parse({
    version: 1,
    scope: {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
    },
    principalId: 'editor-one',
    capabilities: {
      screens: Object.fromEntries(studioDestinations.map((id) => [id, true])),
      operations: Object.fromEntries(studioOperations.map((id) => [id, true])),
    },
    selection: { mode: 'current-only', choices: [] },
  });
}
function fixture() {
  const client = createGridStoryClient({ baseUrl: 'http://unit.test', tenantId: 'default' });
  const read = vi.spyOn(client, 'getStudioContext').mockResolvedValue(context());
  vi.spyOn(client, 'listAssets').mockResolvedValue([]);
  return { client, read };
}
function scopedContext(siteId = 'default'): StudioContext {
  const scope = {
    ...context().scope,
    siteId,
    environmentId: siteId === 'campaign' ? 'preview' : 'development',
    locale: siteId === 'campaign' ? 'fr' : 'en',
  };
  return {
    ...context(),
    scope,
    selection: {
      mode: 'configured',
      choices: [
        {
          scope: context().scope,
          labels: { site: 'Default', environment: 'Development', locale: 'English' },
        },
        {
          scope: { ...context().scope, siteId: 'campaign', environmentId: 'preview', locale: 'fr' },
          labels: { site: 'Campaign', environment: 'Preview', locale: 'French' },
        },
      ],
    },
  };
}
function scopedFixture(
  alternate: () => Promise<StudioContext> = async () => scopedContext('campaign'),
) {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const client = createGridStoryClient({
    baseUrl: 'http://unit.test',
    tenantId: 'default',
    developmentIdentityHeaders: true,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), headers });
      if (String(input).endsWith('/api/v1/studio/context')) {
        const value =
          headers.get('x-gridstory-site') === 'campaign' ? await alternate() : scopedContext();
        return Response.json(value);
      }
      if (String(input).endsWith('/api/v1/assets')) return Response.json([]);
      return Response.json(
        { error: { code: 'not_found', message: 'Not found.' } },
        { status: 404 },
      );
    },
  });
  return { client, requests };
}
function Probe({ client, active }: StudioSessionView) {
  const [draft, setDraft] = useState('saved');
  return (
    <section aria-label="Private editor">
      <input
        aria-label="Private draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        disabled={!active}
        onClick={() => {
          void client.listAssets().catch(() => undefined);
        }}
      >
        Private read
      </button>
    </section>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Studio session lifetime', () => {
  it('validates an allowed complete tuple, cleans the old lifetime, and invalidates old callbacks', async () => {
    const { client, requests } = scopedFixture();
    const cleanupLifetime = vi.fn(async () => undefined);
    const beforeCommit = vi.fn();
    let captured: StudioSessionView | undefined;
    render(
      <StudioSession client={client}>
        {(view) => {
          captured = view;
          return <Probe {...view} />;
        }}
      </StudioSession>,
    );
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'old scope draft' } });
    const oldClient = captured?.client;
    await act(async () =>
      captured?.transitionScope(
        { siteId: 'campaign', environmentId: 'preview', locale: 'fr' },
        { cleanup: cleanupLifetime, beforeCommit },
      ),
    );
    await waitFor(() => expect(captured?.context.scope.siteId).toBe('campaign'));
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'saved');
    expect(cleanupLifetime).toHaveBeenCalledOnce();
    expect(beforeCommit).toHaveBeenCalledOnce();
    expect(
      requests.some(
        ({ url, headers }) =>
          url.endsWith('/api/v1/studio/context') &&
          headers.get('x-gridstory-site') === 'campaign' &&
          headers.get('x-gridstory-environment') === 'preview' &&
          headers.get('x-gridstory-locale') === 'fr',
      ),
    ).toBe(true);
    await expect(oldClient?.listAssets()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps the old authorized lifetime when candidate validation or cleanup fails', async () => {
    const denial = new GridStoryApiError('Denied candidate.', { status: 403 });
    for (const failure of ['candidate', 'cleanup'] as const) {
      const { client } = scopedFixture(async () => {
        if (failure === 'candidate') throw denial;
        return scopedContext('campaign');
      });
      const cleanupLifetime = vi.fn(async () => {
        if (failure === 'cleanup') throw new Error('Preview cleanup unavailable.');
      });
      let captured: StudioSessionView | undefined;
      const rendered = render(
        <StudioSession client={client}>
          {(view) => {
            captured = view;
            return <Probe {...view} />;
          }}
        </StudioSession>,
      );
      fireEvent.change(await screen.findByRole('textbox'), {
        target: { value: `${failure} draft` },
      });
      await expect(
        captured?.transitionScope(
          { siteId: 'campaign', environmentId: 'preview', locale: 'fr' },
          { cleanup: cleanupLifetime },
        ),
      ).rejects.toThrow(
        failure === 'candidate' ? 'Denied candidate.' : 'Preview cleanup unavailable.',
      );
      expect(captured?.context.scope.siteId).toBe('default');
      expect(screen.getByRole('textbox')).toHaveProperty('value', `${failure} draft`);
      expect(cleanupLifetime).toHaveBeenCalledTimes(failure === 'candidate' ? 0 : 1);
      rendered.unmount();
    }
  });

  it('serializes candidate validation and rejects a concurrent switch', async () => {
    const candidate = Promise.withResolvers<StudioContext>();
    const { client } = scopedFixture(() => candidate.promise);
    let captured: StudioSessionView | undefined;
    render(
      <StudioSession client={client}>
        {(view) => {
          captured = view;
          return <Probe {...view} />;
        }}
      </StudioSession>,
    );
    await screen.findByRole('textbox');
    const first = captured?.transitionScope(
      { siteId: 'campaign', environmentId: 'preview', locale: 'fr' },
      { cleanup: async () => undefined },
    );
    await expect(
      captured?.transitionScope(
        { siteId: 'campaign', environmentId: 'preview', locale: 'fr' },
        { cleanup: async () => undefined },
      ),
    ).rejects.toThrow('already pending');
    candidate.resolve(scopedContext('campaign'));
    await act(async () => first);
  });

  it('does not mount private consumers until context has been validated', async () => {
    const { client, read } = fixture();
    let resolve!: (value: StudioContext) => void;
    read.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const child = vi.fn((view: StudioSessionView) => <Probe {...view} />);
    render(<StudioSession client={client}>{child}</StudioSession>);
    expect(child).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Verifying');
    await act(async () => {
      resolve(context());
    });
    expect(screen.getByRole('textbox', { name: 'Private draft' })).toBeTruthy();
  });

  it.each([null, { version: 2 }, { ...context(), unexpected: 'private metadata' }])(
    'fails closed for malformed/unsupported context %j',
    async (value) => {
      const { client, read } = fixture();
      read.mockResolvedValue(value as StudioContext);
      const legacy = vi.spyOn(client, 'getRequestContext');
      render(<StudioSession client={client}>{(view) => <Probe {...view} />}</StudioSession>);
      await screen.findByRole('button', { name: 'Retry access' });
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(legacy).not.toHaveBeenCalled();
      expect(client.listAssets).not.toHaveBeenCalled();
    },
  );

  it('suspends private output on refresh failure and preserves the same-authority draft after retry', async () => {
    const { client, read } = fixture();
    render(<StudioSession client={client}>{(view) => <Probe {...view} />}</StudioSession>);
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'unsaved private draft' },
    });
    read.mockRejectedValueOnce(new Error('network unavailable'));
    fireEvent(window, new Event('focus'));
    await screen.findByRole('button', { name: 'Retry access' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry access' }));
    expect(await screen.findByRole('textbox')).toHaveProperty('value', 'unsaved private draft');
  });

  it('keeps the verified editor and in-flight reads through an unchanged routine focus check', async () => {
    const { client, read } = fixture();
    const check = Promise.withResolvers<StudioContext>();
    const assets = Promise.withResolvers<[]>();
    let captured: StudioSessionView | undefined;
    const child = vi.fn((view: StudioSessionView) => {
      captured = view;
      return <Probe {...view} />;
    });
    render(<StudioSession client={client}>{child}</StudioSession>);
    await screen.findByRole('textbox');
    const settledRenderCount = child.mock.calls.length;
    read.mockReturnValueOnce(check.promise);
    fireEvent(window, new Event('focus'));
    expect(screen.queryByRole('textbox')).not.toBeNull();
    expect(captured?.active).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'focus-restoring edit' } });
    vi.mocked(client.listAssets).mockReturnValueOnce(assets.promise);
    const pending = captured?.client.listAssets();
    await act(async () => check.resolve(context()));
    assets.resolve([]);
    await expect(pending).resolves.toEqual([]);
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'focus-restoring edit');
    expect(child).toHaveBeenCalledTimes(settledRenderCount);
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.listAssets).toHaveBeenCalledTimes(1);
  });

  it('still rejects in-flight reads when a focused check confirms changed authority', async () => {
    const { client, read } = fixture();
    const assets = Promise.withResolvers<[]>();
    let captured: StudioSessionView | undefined;
    render(
      <StudioSession client={client}>
        {(view) => {
          captured = view;
          return <Probe {...view} />;
        }}
      </StudioSession>,
    );
    await screen.findByRole('textbox');
    vi.mocked(client.listAssets).mockReturnValueOnce(assets.promise);
    const pending = captured?.client.listAssets();
    const next = context();
    next.principalId = 'replacement-principal';
    read.mockResolvedValueOnce(next);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(captured?.context.principalId).toBe('replacement-principal'));
    assets.resolve([]);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each(['principal', 'permission'] as const)(
    'replaces the private lifetime after a %s change',
    async (change) => {
      const { client, read } = fixture();
      render(<StudioSession client={client}>{(view) => <Probe {...view} />}</StudioSession>);
      fireEvent.change(await screen.findByRole('textbox'), {
        target: { value: 'old private draft' },
      });
      const next = context();
      if (change === 'principal') next.principalId = 'editor-two';
      else next.capabilities.operations['content.draft.update'] = false;
      read.mockResolvedValue(next);
      fireEvent(window, new Event('focus'));
      await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'saved'));
      expect(document.body.textContent).not.toContain('old private draft');
    },
  );

  it('clears the subtree on observed 401, then requires a new successful sign-in check', async () => {
    const { client, read } = fixture();
    vi.spyOn(client, 'listAssets').mockRejectedValue(
      new GridStoryApiError('private server error', { status: 401 }),
    );
    render(<StudioSession client={client}>{(view) => <Probe {...view} />}</StudioSession>);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'old secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Private read' }));
    await screen.findByRole('heading', { name: 'Sign in required' });
    expect(document.querySelector('input')).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry access' }));
    expect(await screen.findByRole('textbox')).toHaveProperty('value', 'saved');
  });

  it('refreshes authority after observed 403 and discards previous private state', async () => {
    const { client, read } = fixture();
    render(<StudioSession client={client}>{(view) => <Probe {...view} />}</StudioSession>);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'old secret' } });
    const next = context();
    next.capabilities.operations['asset.read'] = false;
    read.mockResolvedValue(next);
    vi.spyOn(client, 'listAssets').mockRejectedValue(
      new GridStoryApiError('forbidden', { status: 403 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Private read' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'saved'));
  });

  it('does not let callbacks from an old principal invoke the new session transport', async () => {
    const { client, read } = fixture();
    let captured: StudioSessionView | undefined;
    render(
      <StudioSession client={client}>
        {(view) => {
          captured = view;
          return <Probe {...view} />;
        }}
      </StudioSession>,
    );
    await screen.findByRole('textbox');
    const oldClient = captured?.client;
    const next = context();
    next.principalId = 'new-editor';
    read.mockResolvedValue(next);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(captured?.context.principalId).toBe('new-editor'));
    await expect(oldClient?.listAssets()).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.listAssets).not.toHaveBeenCalled();
  });

  it('requires an explicit retry if a 403 refresh returns unchanged authority', async () => {
    const { client, read } = fixture();
    render(<StudioSession client={client}>{(view) => <Probe {...view} />}</StudioSession>);
    await screen.findByRole('textbox');
    vi.spyOn(client, 'listAssets').mockRejectedValue(
      new GridStoryApiError('denied', { status: 403 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Private read' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Retry access' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(client.listAssets).toHaveBeenCalledTimes(1);
  });

  it('ignores late context completions across StrictMode cleanup and newer refreshes', async () => {
    const { client, read } = fixture();
    const completions: Array<(value: StudioContext) => void> = [];
    read.mockImplementation(
      () =>
        new Promise((resolve) => {
          completions.push(resolve);
        }),
    );
    const rendered = render(
      <StrictMode>
        <StudioSession client={client}>{(view) => <Probe {...view} />}</StudioSession>
      </StrictMode>,
    );
    expect(completions).toHaveLength(2);
    await act(async () => {
      completions[1]?.(context());
    });
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'current' } });
    const old = context();
    old.principalId = 'obsolete';
    await act(async () => {
      completions[0]?.(old);
    });
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'current');
    fireEvent(window, new Event('focus'));
    rendered.unmount();
    await act(async () => {
      completions[2]?.(old);
    });
    expect(document.body.textContent).toBe('');
  });
});
