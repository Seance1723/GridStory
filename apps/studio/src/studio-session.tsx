import { GridStoryApiError, type GridStoryClient } from '@gridstory/client';
import {
  type StudioContext,
  type StudioScopeSelection,
  studioContextSchema,
} from '@gridstory/schema';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { guardStudioClient } from './studio-capabilities.js';

export interface StudioSessionView {
  client: GridStoryClient;
  context: StudioContext;
  active: boolean;
  resetEntryContext: boolean;
  transitioning: boolean;
  transitionScope: (
    selection: StudioScopeSelection,
    lifecycle: { cleanup: () => Promise<void>; beforeCommit?: () => void },
  ) => Promise<void>;
  cleanupClient: Pick<GridStoryClient, 'revokePreviewSession' | 'leavePresence'>;
}

export function StudioSession({
  client,
  children,
}: {
  client: GridStoryClient;
  children: (session: StudioSessionView) => ReactNode;
}): ReactNode {
  const [activeClient, setActiveClient] = useState(client);
  const [context, setContext] = useState<StudioContext | null>(null);
  const [status, setStatus] = useState<
    'checking' | 'ready' | 'failed' | 'signed-out' | 'forbidden'
  >('checking');
  const [lifetime, setLifetime] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [resetEntryContext, setResetEntryContext] = useState(false);
  const lifetimeRef = useRef(0);
  const activeClientRef = useRef(activeClient);
  activeClientRef.current = activeClient;
  const verifiedClient = useRef<GridStoryClient | null>(null);
  const authority = useRef<{ context: StudioContext; generation: number } | null>(null);
  const generation = useRef(0);
  const fingerprint = useRef('');
  const request = useRef<AbortController | null>(null);
  const transitionRequest = useRef<AbortController | null>(null);
  const transitionPending = useRef(false);
  const prevalidatedClient = useRef<GridStoryClient | null>(null);
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
        routineFocus && verifiedClient.current === activeClient ? authority.current : null;
      if (!previousAuthority) {
        authority.current = null;
        setStatus('checking');
      }
      try {
        // Also validate injected clients; never fall back to raw identity/role information.
        const next = studioContextSchema.parse(
          await activeClient.getStudioContext({ signal: controller.signal }),
        );
        if (!mounted.current || controller.signal.aborted || current !== generation.current) return;
        const identity = JSON.stringify([next.principalId, next.scope, next.capabilities]);
        if (identity === deniedFingerprint) {
          setStatus('forbidden');
          return;
        }
        const unchanged = identity === fingerprint.current;
        const replacingAuthority = !unchanged && fingerprint.current !== '';
        if (!unchanged) {
          fingerprint.current = identity;
          lifetimeRef.current += 1;
          setLifetime(lifetimeRef.current);
          if (replacingAuthority) setResetEntryContext(true);
        }
        verifiedClient.current = activeClient;
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
          setResetEntryContext(true);
          setContext(null);
          fingerprint.current = '';
          setStatus(error.status === 401 ? 'signed-out' : 'failed');
        } else {
          // Retain same-session drafts only in the suspended, inaccessible subtree.
          setStatus('failed');
        }
      }
    },
    [activeClient],
  );

  const guardedClient = useMemo(() => {
    const born = lifetime;
    return guardStudioClient(
      activeClient,
      () => {
        const lease = authority.current;
        return lease && born === lifetimeRef.current && verifiedClient.current === activeClient
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
        setResetEntryContext(true);
        setLifetime(lifetimeRef.current);
        setContext(null);
        setStatus(status === 401 ? 'signed-out' : 'checking');
        if (status === 403) void refresh(deniedFingerprint);
      },
    );
  }, [activeClient, lifetime, refresh]);

  // Cleanup-only transport: permits closing an already-issued preview/presence lifetime
  // after its authority has gone away. It cannot initiate feature reads or writes.
  const cleanupClient = useMemo(
    () => ({
      revokePreviewSession: activeClient.revokePreviewSession.bind(activeClient),
      leavePresence: activeClient.leavePresence.bind(activeClient),
    }),
    [activeClient],
  );

  const transitionScope = useCallback(
    async (
      selection: StudioScopeSelection,
      lifecycle: { cleanup: () => Promise<void>; beforeCommit?: () => void },
    ) => {
      if (transitionPending.current) throw new Error('A Studio context switch is already pending.');
      const lease = authority.current;
      if (!lease || verifiedClient.current !== activeClient) {
        throw new Error('Studio access must be verified before switching context.');
      }
      const allowed = lease.context.selection.choices.find(
        ({ scope }) =>
          scope.siteId === selection.siteId &&
          scope.environmentId === selection.environmentId &&
          scope.locale === selection.locale,
      );
      if (!allowed) throw new Error('That Studio context is no longer available.');
      if (
        lease.context.scope.siteId === selection.siteId &&
        lease.context.scope.environmentId === selection.environmentId &&
        lease.context.scope.locale === selection.locale
      )
        return;

      transitionPending.current = true;
      setTransitioning(true);
      const controller = new AbortController();
      transitionRequest.current = controller;
      const originalGeneration = lease.generation;
      const candidate = activeClient.withStudioScope(selection);
      try {
        const next = studioContextSchema.parse(
          await candidate.getStudioContext({ signal: controller.signal }),
        );
        if (
          !mounted.current ||
          controller.signal.aborted ||
          activeClientRef.current !== activeClient ||
          authority.current?.generation !== originalGeneration
        ) {
          throw new DOMException('The Studio context switch was superseded.', 'AbortError');
        }
        if (
          next.principalId !== lease.context.principalId ||
          next.scope.organizationId !== allowed.scope.organizationId ||
          next.scope.tenantId !== allowed.scope.tenantId ||
          next.scope.workspaceId !== allowed.scope.workspaceId ||
          next.scope.siteId !== allowed.scope.siteId ||
          next.scope.environmentId !== allowed.scope.environmentId ||
          next.scope.locale !== allowed.scope.locale
        ) {
          throw new Error('The selected Studio context could not be verified.');
        }

        await lifecycle.cleanup();
        if (
          !mounted.current ||
          controller.signal.aborted ||
          activeClientRef.current !== activeClient ||
          authority.current?.generation !== originalGeneration
        ) {
          throw new DOMException('The Studio context switch was superseded.', 'AbortError');
        }

        lifecycle.beforeCommit?.();
        request.current?.abort();
        const current = ++generation.current;
        const identity = JSON.stringify([next.principalId, next.scope, next.capabilities]);
        fingerprint.current = identity;
        lifetimeRef.current += 1;
        setResetEntryContext(true);
        authority.current = { context: next, generation: current };
        verifiedClient.current = candidate;
        prevalidatedClient.current = candidate;
        activeClientRef.current = candidate;
        setActiveClient(candidate);
        setContext(next);
        setLifetime(lifetimeRef.current);
        setStatus('ready');
      } finally {
        if (transitionRequest.current === controller) transitionRequest.current = null;
        transitionPending.current = false;
        if (mounted.current) setTransitioning(false);
      }
    },
    [activeClient],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      authority.current = null;
      generation.current += 1;
      request.current?.abort();
      transitionRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (prevalidatedClient.current === activeClient) prevalidatedClient.current = null;
    else {
      fingerprint.current = '';
      setContext(null);
      void refresh();
    }
    const focus = () => {
      if (transitionPending.current) return;
      void refresh(undefined, true);
    };
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('focus', focus);
    };
  }, [activeClient, refresh]);

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
      {context && verifiedClient.current === activeClient ? (
        <div key={lifetime} hidden={status !== 'ready'} inert={status !== 'ready'}>
          {children({
            client: guardedClient,
            context,
            active: status === 'ready',
            resetEntryContext,
            transitioning,
            transitionScope,
            cleanupClient,
          })}
        </div>
      ) : null}
    </>
  );
}
