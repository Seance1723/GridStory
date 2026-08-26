import { GridStoryApiError, type GridStoryClient } from '@gridstory/client';
import { type StudioContext, studioContextSchema } from '@gridstory/schema';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { guardStudioClient } from './studio-capabilities.js';

export interface StudioSessionView {
  client: GridStoryClient;
  context: StudioContext;
  active: boolean;
  cleanupClient: Pick<GridStoryClient, 'revokePreviewSession' | 'leavePresence'>;
}

export function StudioSession({
  client,
  children,
}: {
  client: GridStoryClient;
  children: (session: StudioSessionView) => ReactNode;
}): ReactNode {
  const [context, setContext] = useState<StudioContext | null>(null);
  const [status, setStatus] = useState<
    'checking' | 'ready' | 'failed' | 'signed-out' | 'forbidden'
  >('checking');
  const [lifetime, setLifetime] = useState(0);
  const lifetimeRef = useRef(0);
  const verifiedClient = useRef<GridStoryClient | null>(null);
  const authority = useRef<{ context: StudioContext; generation: number } | null>(null);
  const generation = useRef(0);
  const fingerprint = useRef('');
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback(
    async (deniedFingerprint?: string, routineFocus = false) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const current = ++generation.current;
      // Returning from a live preview is also window focus. Keep an already
      // verified editor usable during this check; its outcome, not the focus
      // event itself, determines whether to suspend or replace that lifetime.
      const previousAuthority =
        routineFocus && verifiedClient.current === client ? authority.current : null;
      if (!previousAuthority) {
        authority.current = null;
        setStatus('checking');
      }
      try {
        // Also validate injected clients; never fall back to raw identity/role information.
        const next = studioContextSchema.parse(
          await client.getStudioContext({ signal: controller.signal }),
        );
        if (!mounted.current || controller.signal.aborted || current !== generation.current) return;
        const identity = JSON.stringify([next.principalId, next.scope, next.capabilities]);
        if (identity === deniedFingerprint) {
          setStatus('forbidden');
          return;
        }
        const unchanged = identity === fingerprint.current;
        if (!unchanged) {
          fingerprint.current = identity;
          lifetimeRef.current += 1;
          setLifetime(lifetimeRef.current);
        }
        verifiedClient.current = client;
        authority.current = {
          context: next,
          generation: unchanged && previousAuthority ? previousAuthority.generation : current,
        };
        setContext(next);
        setStatus('ready');
      } catch (error) {
        if (!mounted.current || controller.signal.aborted || current !== generation.current) return;
        authority.current = null;
        if (error instanceof GridStoryApiError && (error.status === 401 || error.status === 403)) {
          setContext(null);
          fingerprint.current = '';
          setStatus(error.status === 401 ? 'signed-out' : 'failed');
        } else {
          // Retain same-session drafts only in the suspended, inaccessible subtree.
          setStatus('failed');
        }
      }
    },
    [client],
  );

  const guardedClient = useMemo(() => {
    const born = lifetime;
    return guardStudioClient(
      client,
      () => {
        const lease = authority.current;
        return lease && born === lifetimeRef.current && verifiedClient.current === client
          ? { capabilities: lease.context.capabilities, generation: lease.generation }
          : null;
      },
      (status) => {
        const deniedFingerprint = fingerprint.current;
        authority.current = null;
        generation.current += 1;
        request.current?.abort();
        fingerprint.current = '';
        lifetimeRef.current += 1;
        setLifetime(lifetimeRef.current);
        setContext(null);
        setStatus(status === 401 ? 'signed-out' : 'checking');
        if (status === 403) void refresh(deniedFingerprint);
      },
    );
  }, [client, lifetime, refresh]);

  // Cleanup-only transport: permits closing an already-issued preview/presence lifetime
  // after its authority has gone away. It cannot initiate feature reads or writes.
  const cleanupClient = useMemo(
    () => ({
      revokePreviewSession: client.revokePreviewSession.bind(client),
      leavePresence: client.leavePresence.bind(client),
    }),
    [client],
  );

  useEffect(() => {
    mounted.current = true;
    fingerprint.current = '';
    setContext(null);
    void refresh();
    const focus = () => {
      void refresh(undefined, true);
    };
    window.addEventListener('focus', focus);
    return () => {
      mounted.current = false;
      authority.current = null;
      generation.current += 1;
      request.current?.abort();
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);

  return (
    <>
      {status !== 'ready' ? (
        <main className="loading-state" aria-label="Studio access">
          <h1>{status === 'signed-out' ? 'Sign in required' : 'Checking Studio access'}</h1>
          <p role={status === 'checking' ? 'status' : 'alert'}>
            {status === 'checking'
              ? 'Verifying your current permissions…'
              : status === 'signed-out'
                ? 'Your session is no longer available. Sign in, then retry.'
                : status === 'forbidden'
                  ? 'The requested operation is unavailable. Permissions were rechecked; contact your administrator or retry when access changes.'
                  : 'Studio access could not be verified. Check your connection and compatible API, then retry.'}
          </p>
          {status !== 'checking' ? (
            <button type="button" className="button button--primary" onClick={() => void refresh()}>
              Retry access
            </button>
          ) : null}
        </main>
      ) : null}
      {context && verifiedClient.current === client ? (
        <div key={lifetime} hidden={status !== 'ready'} inert={status !== 'ready'}>
          {children({ client: guardedClient, context, active: status === 'ready', cleanupClient })}
        </div>
      ) : null}
    </>
  );
}
