import type {
  PreviewBootstrapMessage,
  PreviewMessage,
  PreviewSessionGrant,
} from '@gridstory/schema';
import type { GridStoryClient } from './index.js';

const PREVIEW_PROTOCOL_VERSION: PreviewSessionGrant['protocolVersion'] = 1;

export type PreviewPatchMessage = Extract<PreviewMessage, { type: 'gridstory.preview.patch' }>;
export type PreviewNavigateMessage = Extract<
  PreviewMessage,
  { type: 'gridstory.preview.navigate' }
>;
export type PreviewSelectMessage = Extract<PreviewMessage, { type: 'gridstory.preview.select' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0);
}

function parseBootstrapMessage(value: unknown): PreviewBootstrapMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'gridstory.preview.bootstrap' ||
    value.protocolVersion !== PREVIEW_PROTOCOL_VERSION ||
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    typeof value.token !== 'string' ||
    !value.token.startsWith('gsp_')
  ) {
    return null;
  }
  return value as PreviewBootstrapMessage;
}

function parsePreviewMessage(value: unknown): PreviewMessage | null {
  if (
    !isRecord(value) ||
    value.protocolVersion !== PREVIEW_PROTOCOL_VERSION ||
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    typeof value.nonce !== 'string' ||
    value.nonce.length < 16 ||
    value.nonce.length > 200 ||
    !isRecord(value.payload)
  ) {
    return null;
  }
  const payload = value.payload;
  if (value.type === 'gridstory.preview.handshake') {
    if (typeof payload.origin !== 'string') return null;
  } else if (
    value.type === 'gridstory.preview.ready' ||
    value.type === 'gridstory.preview.navigate'
  ) {
    if (typeof payload.route !== 'string' || !payload.route.startsWith('/')) return null;
  } else if (value.type === 'gridstory.preview.patch') {
    if (
      typeof payload.entryId !== 'string' ||
      typeof payload.contentType !== 'string' ||
      !isRecord(payload.data) ||
      !isOptionalString(payload.revisionId)
    ) {
      return null;
    }
  } else if (value.type === 'gridstory.preview.select') {
    if (
      typeof payload.entryId !== 'string' ||
      !isOptionalString(payload.nodeId) ||
      !isOptionalString(payload.fieldName) ||
      !isOptionalString(payload.slotName)
    ) {
      return null;
    }
  } else if (value.type === 'gridstory.preview.error') {
    if (typeof payload.code !== 'string' || typeof payload.message !== 'string') return null;
  } else {
    return null;
  }
  return value as PreviewMessage;
}

export interface PreviewControllerOptions {
  grant: PreviewSessionGrant;
  targetWindow: Window;
  controllerWindow?: Window;
  reconnectIntervalMs?: number;
  onReady?: (message: Extract<PreviewMessage, { type: 'gridstory.preview.ready' }>) => void;
  onNavigate?: (message: PreviewNavigateMessage) => void;
  onSelect?: (message: PreviewSelectMessage) => void;
  onError?: (message: Extract<PreviewMessage, { type: 'gridstory.preview.error' }>) => void;
}

function nonce(): string {
  return globalThis.crypto.randomUUID();
}

export class GridStoryPreviewController {
  readonly #grant: PreviewSessionGrant;
  readonly #targetWindow: Window;
  readonly #controllerWindow: Window;
  readonly #reconnectIntervalMs: number;
  readonly #onReady?: PreviewControllerOptions['onReady'];
  readonly #onNavigate?: PreviewControllerOptions['onNavigate'];
  readonly #onSelect?: PreviewControllerOptions['onSelect'];
  readonly #onError?: PreviewControllerOptions['onError'];
  readonly #handshake: Extract<PreviewMessage, { type: 'gridstory.preview.handshake' }>;
  #nextSequence = 1;
  #highestReceivedSequence = -1;
  #started = false;
  #ready = false;
  #reconnectTimer: ReturnType<typeof setInterval> | undefined;
  #pendingPatch: PreviewPatchMessage['payload'] | undefined;
  #pendingRoute: string | undefined;

  constructor(options: PreviewControllerOptions) {
    this.#grant = options.grant;
    this.#targetWindow = options.targetWindow;
    this.#controllerWindow = options.controllerWindow ?? window;
    this.#reconnectIntervalMs = options.reconnectIntervalMs ?? 300;
    this.#onReady = options.onReady;
    this.#onNavigate = options.onNavigate;
    this.#onSelect = options.onSelect;
    this.#onError = options.onError;
    this.#handshake = {
      type: 'gridstory.preview.handshake',
      protocolVersion: PREVIEW_PROTOCOL_VERSION,
      sessionId: options.grant.sessionId,
      sequence: 0,
      nonce: nonce(),
      payload: { origin: this.#controllerWindow.location.origin },
    };
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#controllerWindow.addEventListener('message', this.#handleMessage);
    this.#bootstrap();
    this.#reconnectTimer = setInterval(() => this.#bootstrap(), this.#reconnectIntervalMs);
  }

  patch(payload: PreviewPatchMessage['payload']): void {
    this.#pendingPatch = structuredClone(payload);
    if (this.#ready) this.#flushPatch();
  }

  navigate(route: string): void {
    if (!route.startsWith('/')) throw new Error('Preview routes must start with /.');
    this.#pendingRoute = route;
    if (this.#ready) this.#flushRoute();
  }

  dispose(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#controllerWindow.removeEventListener('message', this.#handleMessage);
    if (this.#reconnectTimer) clearInterval(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
  }

  #bootstrap(): void {
    if (this.#ready) return;
    this.#targetWindow.postMessage(
      {
        type: 'gridstory.preview.bootstrap',
        protocolVersion: PREVIEW_PROTOCOL_VERSION,
        sessionId: this.#grant.sessionId,
        token: this.#grant.token,
      },
      this.#grant.origin,
    );
    this.#targetWindow.postMessage(this.#handshake, this.#grant.origin);
  }

  #post(message: PreviewMessage): void {
    this.#targetWindow.postMessage(message, this.#grant.origin);
  }

  #flushPatch(): void {
    if (!this.#pendingPatch) return;
    const payload = this.#pendingPatch;
    this.#pendingPatch = undefined;
    this.#post({
      type: 'gridstory.preview.patch',
      protocolVersion: PREVIEW_PROTOCOL_VERSION,
      sessionId: this.#grant.sessionId,
      sequence: this.#nextSequence++,
      nonce: nonce(),
      payload,
    });
  }

  #flushRoute(): void {
    if (!this.#pendingRoute) return;
    const route = this.#pendingRoute;
    this.#pendingRoute = undefined;
    this.#post({
      type: 'gridstory.preview.navigate',
      protocolVersion: PREVIEW_PROTOCOL_VERSION,
      sessionId: this.#grant.sessionId,
      sequence: this.#nextSequence++,
      nonce: nonce(),
      payload: { route },
    });
  }

  #handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.#targetWindow || event.origin !== this.#grant.origin) return;
    const message = parsePreviewMessage(event.data);
    if (!message || message.sessionId !== this.#grant.sessionId) return;
    if (message.sequence <= this.#highestReceivedSequence) return;
    this.#highestReceivedSequence = message.sequence;
    this.#nextSequence = Math.max(this.#nextSequence, message.sequence + 1);
    if (message.type === 'gridstory.preview.ready') {
      this.#ready = true;
      if (this.#reconnectTimer) clearInterval(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
      this.#onReady?.(message);
      this.#flushRoute();
      this.#flushPatch();
    } else if (message.type === 'gridstory.preview.navigate') {
      this.#onNavigate?.(message);
    } else if (message.type === 'gridstory.preview.select') {
      this.#onSelect?.(message);
    } else if (message.type === 'gridstory.preview.error') {
      this.#onError?.(message);
    }
  };
}

export interface PreviewRuntimeOptions {
  client: GridStoryClient;
  controllerOrigin: string;
  runtimeWindow?: Window;
  onPatch: (message: PreviewPatchMessage) => void;
  onNavigate?: (message: PreviewNavigateMessage) => void;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

function currentRoute(runtimeWindow: Window): string {
  return `${runtimeWindow.location.pathname}${runtimeWindow.location.search}${runtimeWindow.location.hash}`;
}

export class GridStoryPreviewRuntime {
  readonly #client: GridStoryClient;
  readonly #controllerOrigin: string;
  readonly #runtimeWindow: Window;
  readonly #onPatch: PreviewRuntimeOptions['onPatch'];
  readonly #onNavigate?: PreviewRuntimeOptions['onNavigate'];
  readonly #onReady?: PreviewRuntimeOptions['onReady'];
  readonly #onError?: PreviewRuntimeOptions['onError'];
  #controllerWindow: Window | undefined;
  #sessionId: string | undefined;
  #token: string | undefined;
  #entryId?: string;
  #nextSequence = 0;
  #incomingQueue: Promise<void> = Promise.resolve();
  #started = false;

  constructor(options: PreviewRuntimeOptions) {
    this.#client = options.client;
    this.#controllerOrigin = new URL(options.controllerOrigin).origin;
    this.#runtimeWindow = options.runtimeWindow ?? window;
    this.#onPatch = options.onPatch;
    this.#onNavigate = options.onNavigate;
    this.#onReady = options.onReady;
    this.#onError = options.onError;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#runtimeWindow.addEventListener('message', this.#handleMessage);
    this.#runtimeWindow.addEventListener('popstate', this.#handlePopState);
    this.#runtimeWindow.document.addEventListener('click', this.#handleClick);
  }

  dispose(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#runtimeWindow.removeEventListener('message', this.#handleMessage);
    this.#runtimeWindow.removeEventListener('popstate', this.#handlePopState);
    this.#runtimeWindow.document.removeEventListener('click', this.#handleClick);
    this.#controllerWindow = undefined;
    this.#sessionId = undefined;
    this.#token = undefined;
  }

  #expectedController(): Window | null {
    if (this.#runtimeWindow.parent !== this.#runtimeWindow) return this.#runtimeWindow.parent;
    return this.#runtimeWindow.opener;
  }

  #handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.origin !== this.#controllerOrigin) return;
    const bootstrap = parseBootstrapMessage(event.data);
    if (bootstrap) {
      const expected = this.#expectedController();
      if (!expected || event.source !== expected) return;
      this.#controllerWindow = expected;
      this.#sessionId = bootstrap.sessionId;
      this.#token = bootstrap.token;
      return;
    }
    const message = parsePreviewMessage(event.data);
    if (!message || !this.#controllerWindow || event.source !== this.#controllerWindow) return;
    if (!this.#sessionId || !this.#token || message.sessionId !== this.#sessionId) return;
    this.#incomingQueue = this.#incomingQueue.then(() => this.#acceptIncoming(message));
  };

  async #acceptIncoming(message: PreviewMessage): Promise<void> {
    if (!this.#sessionId || !this.#token) return;
    try {
      await this.#client.acceptPreviewMessage(this.#sessionId, this.#token, message);
      this.#nextSequence = Math.max(this.#nextSequence, message.sequence + 1);
      if (message.type === 'gridstory.preview.handshake') {
        await this.#send({
          type: 'gridstory.preview.ready',
          payload: { route: currentRoute(this.#runtimeWindow) },
        });
        this.#onReady?.();
      } else if (message.type === 'gridstory.preview.patch') {
        this.#entryId = message.payload.entryId;
        this.#onPatch(message);
      } else if (message.type === 'gridstory.preview.navigate') {
        if (currentRoute(this.#runtimeWindow) !== message.payload.route) {
          this.#runtimeWindow.history.pushState(null, '', message.payload.route);
        }
        this.#onNavigate?.(message);
      }
    } catch (error) {
      this.#onError?.(error);
    }
  }

  async #send(
    input:
      | Pick<Extract<PreviewMessage, { type: 'gridstory.preview.ready' }>, 'type' | 'payload'>
      | Pick<PreviewNavigateMessage, 'type' | 'payload'>
      | Pick<PreviewSelectMessage, 'type' | 'payload'>,
  ): Promise<void> {
    if (!this.#sessionId || !this.#token || !this.#controllerWindow) return;
    const message = {
      ...input,
      protocolVersion: PREVIEW_PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      sequence: this.#nextSequence++,
      nonce: nonce(),
    } as PreviewMessage;
    try {
      await this.#client.acceptPreviewMessage(this.#sessionId, this.#token, message);
      this.#controllerWindow.postMessage(message, this.#controllerOrigin);
    } catch (error) {
      this.#onError?.(error);
    }
  }

  #handlePopState = (): void => {
    void this.#send({
      type: 'gridstory.preview.navigate',
      payload: { route: currentRoute(this.#runtimeWindow) },
    });
  };

  #handleClick = (event: MouseEvent): void => {
    if (!this.#entryId || !(event.target instanceof Element)) return;
    const source = event.target.closest<HTMLElement>('[data-gridstory-node]');
    const nodeId = source?.dataset.gridstoryNode;
    if (!nodeId) return;
    void this.#send({
      type: 'gridstory.preview.select',
      payload: { entryId: this.#entryId, nodeId },
    });
  };
}

export function createGridStoryPreviewController(
  options: PreviewControllerOptions,
): GridStoryPreviewController {
  return new GridStoryPreviewController(options);
}

export function createGridStoryPreviewRuntime(
  options: PreviewRuntimeOptions,
): GridStoryPreviewRuntime {
  return new GridStoryPreviewRuntime(options);
}
