# Plugin SDK and isolation boundary

GridStory Plugin SDK v1 is a framework-neutral contract for installing signed plugin metadata, granting a tenant-scoped least-privilege subset, managing durable lifecycle state, and invoking a separately operated runtime. It is not an in-process module loader or a general-purpose JavaScript sandbox.

## Security boundary

The control plane never imports or evaluates a plugin package. A server plugin declares `isolation: "external"` and communicates through `PluginRuntimeAdapter` protocol version 1. Production deployments provide the process/container transport and must restrict its OS user, filesystem, network, environment, CPU, memory, child processes, and credentials. When the adapter is absent or unhealthy, enablement and invocation fail closed.

Node `vm`, worker threads, and the Node permission model are not used as trust boundaries. `PluginTestHarness` deliberately runs handlers in process for deterministic tests only and must not be wired into an untrusted production installation.

Studio manifests may declare a `sandboxed-frame` entry point and protocol version. M5-003 validates that contract but does not load the asset. A future loader must use a unique origin where possible, omit same-origin privileges, validate source/origin/schema for every message, and mediate the same grant model.

## Signed manifest

A v1 manifest binds these security-relevant values:

- stable plugin and publisher identities;
- plugin version and an inclusive SDK minimum plus exclusive SDK maximum;
- exact SHA-256 package digest and bounded package size;
- server and/or Studio isolation mode plus protocol version;
- unique requested capabilities and their allow-list constraints;
- unique runtime operations and optional declarative configuration schema;
- Ed25519 publisher key ID and signature.

The signature covers canonical JSON for every field except the signature object itself, including the package digest. Installation separately receives the downloaded/verified artifact digest and requires an exact match. A publisher trust record is injected into `buildServer`; an unknown or revoked publisher/key, malformed public key, incompatible SDK range, digest mismatch, or invalid signature stops installation.

Trusting a publisher signature authenticates metadata and artifact identity; it does not establish that the code is safe. Marketplace review, dependency analysis, SBOM/provenance, publisher enrollment, package download, and support policy remain M6-005/M5-007 work.

## Capabilities and grants

The current capability vocabulary is exported by `@gridstory/schema`:

| Group | Capabilities | Constraint |
|---|---|---|
| Model/content | `schema.read`, `content.read`, `content.draft.write` | Optional `contentTypes` allow-list. |
| Assets/workflow/search | `asset.read`, `asset.write`, `workflow.transition`, `search.read` | Context is supplied by the mediated operation. |
| Events/jobs | `events.subscribe`, `jobs.enqueue` | `events.subscribe` requires `eventTypes`. |
| External/secret | `network.request`, `secrets.read` | Exact `networkHosts` or `secretNames` is mandatory. Wildcards are not accepted. |
| Studio | `studio.embed` | Used only by a future sandboxed-frame loader. |

Installation grants a unique subset of the signed request. A grant cannot add a capability, remove a signed constraint, or add an allow-list value. An empty grant is valid and useful for a metadata-only plugin. Capabilities do not create ambient authority: future storage/network/secret/event/job host calls must be explicit mediated APIs that recheck the installation, scope, grant, and request-specific constraint.

## Lifecycle

Lifecycle state is stored by complete organization, tenant, workspace, site, environment, and locale scope in memory, SQLite, or PostgreSQL:

1. `install` verifies signature, digest, compatibility, and grants, then creates a disabled-by-default `installed` record.
2. `enable` requires `installed` or `disabled`; a server plugin must pass the external runtime health check.
3. `disable` stops new invocations while preserving configuration and history.
4. `revoke` immediately stops invocation and cannot be reversed by enablement. Reinstall requires uninstall first.
5. `uninstall-preview` reports enabled-state and external-data warnings.
6. `uninstall` requires a non-enabled installation and retains lifecycle evidence in an `uninstalled` record.

Every lifecycle event records a stable ID, actor, reason, action, and timestamp. Lifecycle routes require the admin-only `plugin.manage` action; reads and invocation use separate `plugin.read` and `plugin.invoke` actions. All management responses are private/no-store.

## Runtime invocation

Only an enabled plugin with a declared server runtime, declared operation, and granted capability can be invoked. The adapter receives protocol version, exact tenant scope, plugin/publisher/version identity, the one effective grant, and a cloned JSON object. Defaults enforce:

- 60 invocations per plugin and exact scope per minute;
- a 5-second health/invocation timeout;
- 64 KiB JSON input and 256 KiB JSON output;
- JSON-object input/output validation;
- stable denial for missing runtime, state, operation, capability, or trust.

The current limiter is process-local. M5-007 publishes and centralizes these host defaults, but distributed rate/concurrency enforcement and OS/container CPU, memory, process, filesystem, and network limits remain deployment evidence. The runtime transport must not put secret values or draft content in logs and should correlate operations with separately protected telemetry under M5-004.

## API and client

The management API exposes:

- `GET /api/v1/plugins`, `GET /api/v1/plugins/:id`;
- `POST /api/v1/plugins/install`;
- `POST /api/v1/plugins/:id/enable|disable|revoke`;
- `POST /api/v1/plugins/:id/invoke`;
- `GET /api/v1/plugins/:id/uninstall-preview`;
- `DELETE /api/v1/plugins/:id`.

`@gridstory/client` provides matching typed `listPlugins`, `getPlugin`, `installPlugin`, lifecycle, preview, uninstall, and `invokePlugin` methods. Identifiers are URL encoded and all ordinary tenant headers are included by the universal client.

## Runtime integration checklist

Before enabling a production runtime:

- provision it as a separate least-privilege process/container and set CPU, memory, process, filesystem, egress, and timeout controls;
- implement protocol version 1 health and invocation transport without importing plugin modules into the API/worker;
- source publisher public keys from a reviewed trust configuration and exercise key revocation;
- verify package bytes independently and pass their lowercase SHA-256 digest to installation;
- grant only the capabilities and allow-list values approved by a tenant administrator;
- send runtime/security logs to a protected sink without tokens, secrets, raw drafts, or private asset bytes;
- test disable, revoke, unhealthy runtime, timeout, oversized input/output, tenant crossing, upgrade incompatibility, and rollback behavior.

The focused SDK, service, SQLite, PostgreSQL, API, and client tests are the executable v1 contract. See [ADR 0005](adr/0005-plugin-capabilities.md) for the research and necessity decision and [Security requirements](security/security-requirements.md) for normative controls.
