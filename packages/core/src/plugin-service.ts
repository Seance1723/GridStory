import { createPublicKey, randomUUID, verify } from 'node:crypto';
import {
  type ContentScope,
  GRIDSTORY_PLUGIN_SDK_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  type PluginCapabilityGrant,
  type PluginCapabilityName,
  type PluginInstallation,
  type PluginInvocationResult,
  type PluginUninstallPreview,
  pluginCapabilityGrantSchema,
  pluginInstallationSchema,
  pluginInvocationResultSchema,
  pluginInvocationSchema,
  pluginManifestSigningPayload,
  resourceLimits,
  type SignedPluginManifest,
  signedPluginManifestSchema,
} from '@gridstory/schema';
import { GridStoryError, NotFoundError } from './errors.js';
import type { PluginRepository } from './plugin-repository.js';
import { assertSameContentScope, contentScopeKey } from './tenant-scope.js';
import type { Awaitable } from './types.js';

export interface TrustedPluginPublisher {
  publisherId: string;
  keyId: string;
  publicKey: string;
  status: 'active' | 'revoked';
}

export interface PluginRuntimeRequest {
  protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
  scope: ContentScope;
  plugin: { id: string; version: string; publisherId: string };
  operation: string;
  grant: PluginCapabilityGrant;
  input: Record<string, unknown>;
}

export interface PluginRuntimeAdapter {
  health(input: {
    protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
    scope: ContentScope;
    plugin: { id: string; version: string; publisherId: string };
  }): Awaitable<{ healthy: boolean; message?: string }>;
  invoke(input: PluginRuntimeRequest): Awaitable<PluginInvocationResult>;
}

export type PluginTestHandler = (
  input: Record<string, unknown>,
  request: PluginRuntimeRequest,
) => Awaitable<Record<string, unknown>>;

/** Test-only in-process harness. It is intentionally not a production isolation boundary. */
export class PluginTestHarness implements PluginRuntimeAdapter {
  readonly #handlers = new Map<string, PluginTestHandler>();

  register(pluginId: string, operation: string, handler: PluginTestHandler): this {
    this.#handlers.set(`${pluginId}\u001f${operation}`, handler);
    return this;
  }

  health(input: Parameters<PluginRuntimeAdapter['health']>[0]): {
    healthy: boolean;
    message?: string;
  } {
    const prefix = `${input.plugin.id}\u001f`;
    const healthy = [...this.#handlers.keys()].some((key) => key.startsWith(prefix));
    return healthy ? { healthy } : { healthy, message: 'No test handler is registered.' };
  }

  async invoke(input: PluginRuntimeRequest): Promise<PluginInvocationResult> {
    const handler = this.#handlers.get(`${input.plugin.id}\u001f${input.operation}`);
    if (!handler) throw new Error('No test handler is registered for this plugin operation.');
    return { output: await handler(structuredClone(input.input), structuredClone(input)) };
  }
}

interface PluginServiceOptions {
  repository: PluginRepository;
  trustedPublishers: TrustedPluginPublisher[];
  runtime?: PluginRuntimeAdapter;
  sdkVersion?: string;
  now?: () => Date;
  createId?: () => string;
  invocationTimeoutMs?: number;
  invocationLimitPerMinute?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

const constraintKeys = ['contentTypes', 'networkHosts', 'secretNames', 'eventTypes'] as const;

function semverTuple(value: string): [number, number, number] {
  const [major, minor, patch] = value.split('-', 1)[0]?.split('.').map(Number) ?? [];
  if (![major, minor, patch].every(Number.isInteger)) {
    throw new GridStoryError('Plugin SDK version is invalid.', 'plugin_sdk_version_invalid', 500);
  }
  return [major as number, minor as number, patch as number];
}

function compareSemver(left: string, right: string): number {
  const a = semverTuple(left);
  const b = semverTuple(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw new GridStoryError('Plugin data must be JSON serializable.', 'plugin_data_invalid', 400);
  }
}

export class PluginService {
  readonly #repository: PluginRepository;
  readonly #trustedPublishers: TrustedPluginPublisher[];
  readonly #runtime: PluginRuntimeAdapter | undefined;
  readonly #sdkVersion: string;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #invocationTimeoutMs: number;
  readonly #invocationLimitPerMinute: number;
  readonly #maxInputBytes: number;
  readonly #maxOutputBytes: number;
  readonly #invocations = new Map<string, number[]>();

  constructor(options: PluginServiceOptions) {
    this.#repository = options.repository;
    this.#trustedPublishers = [...options.trustedPublishers];
    this.#runtime = options.runtime;
    this.#sdkVersion = options.sdkVersion ?? GRIDSTORY_PLUGIN_SDK_VERSION;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
    this.#invocationTimeoutMs =
      options.invocationTimeoutMs ?? resourceLimits.plugins.defaultInvocationTimeoutMs;
    this.#invocationLimitPerMinute =
      options.invocationLimitPerMinute ??
      resourceLimits.plugins.defaultInvocationsPerMinutePerScope;
    this.#maxInputBytes = options.maxInputBytes ?? resourceLimits.plugins.defaultInputBytes;
    this.#maxOutputBytes = options.maxOutputBytes ?? resourceLimits.plugins.defaultOutputBytes;
  }

  async list(scope: ContentScope): Promise<PluginInstallation[]> {
    const installations = await this.#repository.list(scope);
    for (const installation of installations) assertSameContentScope(scope, installation, 'plugin');
    return installations;
  }

  async get(scope: ContentScope, id: string): Promise<PluginInstallation> {
    const installation = await this.#repository.get(scope, id);
    if (!installation) throw new NotFoundError('Plugin installation was not found.');
    assertSameContentScope(scope, installation, 'plugin');
    return installation;
  }

  async install(input: {
    scope: ContentScope;
    manifest: SignedPluginManifest;
    artifactDigest: string;
    grantedCapabilities: PluginCapabilityGrant[];
    actorId: string;
    reason: string;
  }): Promise<PluginInstallation> {
    const manifest = signedPluginManifestSchema.parse(input.manifest);
    this.#verifyManifest(manifest, input.artifactDigest);
    const grants = this.#validateGrants(manifest, input.grantedCapabilities);
    const previous = await this.#repository.get(input.scope, manifest.id);
    if (previous && previous.state !== 'uninstalled') {
      throw new GridStoryError('Plugin is already installed in this scope.', 'plugin_exists', 409);
    }
    if (previous) assertSameContentScope(input.scope, previous, 'plugin');
    const now = this.#now().toISOString();
    const event = this.#event('installed', input.actorId, input.reason, now);
    return this.#repository.save(
      pluginInstallationSchema.parse({
        ...input.scope,
        id: manifest.id,
        manifest,
        artifactDigest: input.artifactDigest,
        state: 'installed',
        grantedCapabilities: grants,
        installedAt: now,
        installedBy: input.actorId,
        updatedAt: now,
        events: [...(previous?.events ?? []), event],
      }),
    );
  }

  async enable(input: {
    scope: ContentScope;
    id: string;
    actorId: string;
    reason: string;
  }): Promise<PluginInstallation> {
    const installation = await this.get(input.scope, input.id);
    if (installation.state !== 'installed' && installation.state !== 'disabled') {
      throw new GridStoryError(
        'Plugin cannot be enabled from its current state.',
        'plugin_state',
        409,
      );
    }
    if (installation.manifest.runtimes.server) {
      const runtime = this.#requiredRuntime();
      const health = await this.#withTimeout(
        runtime.health({
          protocolVersion: PLUGIN_PROTOCOL_VERSION,
          scope: input.scope,
          plugin: this.#runtimeIdentity(installation.manifest),
        }),
      );
      if (!health.healthy) {
        throw new GridStoryError(
          health.message ?? 'Plugin runtime is unhealthy.',
          'plugin_runtime_unhealthy',
          503,
        );
      }
    }
    return this.#transition(installation, 'enabled', input.actorId, input.reason);
  }

  async disable(input: {
    scope: ContentScope;
    id: string;
    actorId: string;
    reason: string;
  }): Promise<PluginInstallation> {
    const installation = await this.get(input.scope, input.id);
    if (installation.state !== 'enabled') {
      throw new GridStoryError('Only an enabled plugin can be disabled.', 'plugin_state', 409);
    }
    return this.#transition(installation, 'disabled', input.actorId, input.reason);
  }

  async revoke(input: {
    scope: ContentScope;
    id: string;
    actorId: string;
    reason: string;
  }): Promise<PluginInstallation> {
    const installation = await this.get(input.scope, input.id);
    if (installation.state === 'revoked' || installation.state === 'uninstalled') {
      throw new GridStoryError(
        'Plugin cannot be revoked from its current state.',
        'plugin_state',
        409,
      );
    }
    return this.#transition(installation, 'revoked', input.actorId, input.reason);
  }

  async uninstallPreview(scope: ContentScope, id: string): Promise<PluginUninstallPreview> {
    const installation = await this.get(scope, id);
    return {
      pluginId: id,
      state: installation.state,
      externalDataDeletionRequired: Boolean(installation.manifest.runtimes.server),
      retainedLifecycleEvents: installation.events.length,
      warnings: [
        ...(installation.state === 'enabled' ? ['Disable the plugin before uninstalling it.'] : []),
        ...(installation.manifest.runtimes.server
          ? ['GridStory does not delete data owned by the external plugin runtime.']
          : []),
      ],
    };
  }

  async uninstall(input: {
    scope: ContentScope;
    id: string;
    actorId: string;
    reason: string;
  }): Promise<PluginInstallation> {
    const installation = await this.get(input.scope, input.id);
    if (installation.state === 'enabled') {
      throw new GridStoryError('Disable the plugin before uninstalling it.', 'plugin_state', 409);
    }
    if (installation.state === 'uninstalled') {
      throw new GridStoryError('Plugin is already uninstalled.', 'plugin_state', 409);
    }
    return this.#transition(installation, 'uninstalled', input.actorId, input.reason);
  }

  async invoke(input: {
    scope: ContentScope;
    id: string;
    operation: string;
    capability: PluginCapabilityName;
    payload: Record<string, unknown>;
  }): Promise<PluginInvocationResult> {
    const invocation = pluginInvocationSchema.parse({
      operation: input.operation,
      capability: input.capability,
      input: input.payload,
    });
    const installation = await this.get(input.scope, input.id);
    if (installation.state !== 'enabled') {
      throw new GridStoryError('Plugin must be enabled before invocation.', 'plugin_disabled', 409);
    }
    if (!installation.manifest.runtimes.server) {
      throw new GridStoryError('Plugin has no server runtime.', 'plugin_runtime_missing', 409);
    }
    if (!installation.manifest.operations.includes(invocation.operation)) {
      throw new GridStoryError('Plugin operation is not declared.', 'plugin_operation_denied', 403);
    }
    const grant = installation.grantedCapabilities.find(
      ({ capability }) => capability === invocation.capability,
    );
    if (!grant) {
      throw new GridStoryError(
        'Plugin capability was not granted.',
        'plugin_capability_denied',
        403,
      );
    }
    if (serializedBytes(invocation.input) > this.#maxInputBytes) {
      throw new GridStoryError(
        'Plugin input exceeds the configured limit.',
        'plugin_input_too_large',
        413,
      );
    }
    this.#checkRateLimit(input.scope, input.id);
    const result = pluginInvocationResultSchema.parse(
      await this.#withTimeout(
        this.#requiredRuntime().invoke({
          protocolVersion: PLUGIN_PROTOCOL_VERSION,
          scope: input.scope,
          plugin: this.#runtimeIdentity(installation.manifest),
          operation: invocation.operation,
          grant,
          input: invocation.input,
        }),
      ),
    );
    if (serializedBytes(result.output) > this.#maxOutputBytes) {
      throw new GridStoryError(
        'Plugin output exceeds the configured limit.',
        'plugin_output_too_large',
        502,
      );
    }
    return result;
  }

  #verifyManifest(manifest: SignedPluginManifest, artifactDigest: string): void {
    if (manifest.package.sha256 !== artifactDigest) {
      throw new GridStoryError(
        'Plugin artifact digest does not match the manifest.',
        'plugin_digest',
        422,
      );
    }
    if (
      compareSemver(this.#sdkVersion, manifest.sdk.minVersion) < 0 ||
      compareSemver(this.#sdkVersion, manifest.sdk.maxVersionExclusive) >= 0
    ) {
      throw new GridStoryError(
        'Plugin is incompatible with this SDK version.',
        'plugin_incompatible',
        422,
      );
    }
    const publisher = this.#trustedPublishers.find(
      (candidate) =>
        candidate.publisherId === manifest.publisher.id &&
        candidate.keyId === manifest.signature.keyId,
    );
    if (publisher?.status !== 'active') {
      throw new GridStoryError('Plugin publisher key is not trusted.', 'plugin_untrusted', 403);
    }
    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(pluginManifestSigningPayload(manifest), 'utf8'),
        createPublicKey(publisher.publicKey),
        Buffer.from(manifest.signature.value, 'base64'),
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new GridStoryError('Plugin manifest signature is invalid.', 'plugin_signature', 422);
    }
  }

  #validateGrants(
    manifest: SignedPluginManifest,
    candidateGrants: PluginCapabilityGrant[],
  ): PluginCapabilityGrant[] {
    const grants = candidateGrants.map((grant) => pluginCapabilityGrantSchema.parse(grant));
    const duplicate = grants.find(
      ({ capability }, index) =>
        grants.findIndex((grant) => grant.capability === capability) !== index,
    );
    if (duplicate) {
      throw new GridStoryError(
        'Plugin capability grants must be unique.',
        'plugin_grants_invalid',
        422,
      );
    }
    for (const grant of grants) {
      const requested = manifest.requestedCapabilities.find(
        ({ capability }) => capability === grant.capability,
      );
      if (!requested) {
        throw new GridStoryError(
          'A grant exceeds the requested capabilities.',
          'plugin_grant_exceeds',
          422,
        );
      }
      for (const key of constraintKeys) {
        const requestedValues = requested.constraints?.[key];
        const grantedValues = grant.constraints?.[key];
        if (requestedValues && !grantedValues) {
          throw new GridStoryError(
            'A grant cannot remove a requested capability constraint.',
            'plugin_grant_exceeds',
            422,
          );
        }
        if (requestedValues && grantedValues?.some((value) => !requestedValues.includes(value))) {
          throw new GridStoryError(
            'A grant constraint exceeds the requested allow-list.',
            'plugin_grant_exceeds',
            422,
          );
        }
      }
    }
    return grants;
  }

  async #transition(
    installation: PluginInstallation,
    state: 'enabled' | 'disabled' | 'revoked' | 'uninstalled',
    actorId: string,
    reason: string,
  ): Promise<PluginInstallation> {
    const now = this.#now().toISOString();
    return this.#repository.save({
      ...installation,
      state,
      updatedAt: now,
      events: [...installation.events, this.#event(state, actorId, reason, now)],
    });
  }

  #event(
    action: 'installed' | 'enabled' | 'disabled' | 'revoked' | 'uninstalled',
    actorId: string,
    reason: string,
    occurredAt: string,
  ) {
    return { id: this.#createId(), action, actorId, reason, occurredAt } as const;
  }

  #runtimeIdentity(manifest: SignedPluginManifest) {
    return { id: manifest.id, version: manifest.version, publisherId: manifest.publisher.id };
  }

  #requiredRuntime(): PluginRuntimeAdapter {
    if (!this.#runtime) {
      throw new GridStoryError(
        'No external plugin runtime is configured.',
        'plugin_runtime_unavailable',
        503,
      );
    }
    return this.#runtime;
  }

  #checkRateLimit(scope: ContentScope, id: string): void {
    const key = `${contentScopeKey(scope)}\u001f${id}`;
    const cutoff = this.#now().getTime() - 60_000;
    const recent = (this.#invocations.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.#invocationLimitPerMinute) {
      throw new GridStoryError(
        'Plugin invocation rate limit exceeded.',
        'plugin_rate_limited',
        429,
      );
    }
    recent.push(this.#now().getTime());
    this.#invocations.set(key, recent);
  }

  async #withTimeout<T>(operation: Awaitable<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new GridStoryError('Plugin runtime timed out.', 'plugin_runtime_timeout', 504),
              ),
            this.#invocationTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
