# ADR 0005: Capability-based plugin boundary

- Status: Accepted
- Date: 2026-07-17
- Last reviewed: 2026-08-20 (M5-003)

## Context

CMS plugins are supply-chain and tenant-isolation risks because they may handle content, assets, credentials, network calls, UI extensions, and background work.

## Decision

Plugins declare a signed manifest with version compatibility and granular requested capabilities. Installation grants an explicit tenant-scoped subset. Server extensions run out of process or in a restricted worker with mediated storage, network, secret, event, and job APIs. Studio extensions run in isolated frames or workers with a versioned message protocol.

No plugin receives database handles, ambient credentials, unrestricted filesystem access, or control-plane process execution. Every privileged call is authorized, rate-limited, and audited.

For M5-003, a server plugin runtime is an injected external-process or container adapter. The GridStory host validates the signed manifest, compatibility, artifact digest, lifecycle state, tenant grant, operation, and input/output bounds before and after crossing the adapter. GridStory does not import or evaluate plugin packages. The in-process SDK harness is marked test-only and is not a production isolation mechanism.

Studio manifests may declare a sandboxed-frame entry point and versioned message protocol, but the actual Studio loader is deferred. A future loader must use a unique origin where possible, omit same-origin privileges, validate every message, and mediate the same tenant grant model.

Signatures use Ed25519 over canonical JSON containing the manifest metadata and SHA-256 package digest. Verification uses an injected, publisher-bound trust record. Signing proves that the trusted publisher authorized the exact manifest and digest; it does not prove that the plugin is benign, so marketplace review, dependency analysis, SBOMs, and publisher enrollment remain separate gates.

## Research and necessity gate

| Candidate | Evidence | Decision |
|---|---|---|
| Node `vm` contexts | Node documents that `node:vm` is not a security mechanism. | Rejected for untrusted plugin isolation. |
| Worker threads or Node permission model | Threads share a process boundary; Node documents that its permission model does not protect against malicious code and recommends OS isolation. | Rejected as the production trust boundary. |
| In-process module loading | Fast and simple, but grants ambient process authority and makes revocation/resource containment unreliable. | Rejected. |
| External process/container plus a mediated protocol | Matches established extension-host and sandboxed-extension patterns while leaving OS policy to deployment. | Selected for server plugins. |
| Sandboxed cross-origin frame plus message protocol | Keeps Studio extensions away from host DOM/session authority when configured without same-origin privileges. | Selected protocol direction; loader deferred. |

The feature is necessary because accepting plugin packages without an enforceable boundary would contradict the existing roadmap and threat model. Existing adapter interfaces remain the preferred customization point when arbitrary third-party code is unnecessary. The smallest safe M5-003 slice is therefore the signed contract, tenant grant/lifecycle, durable state, external-runtime interface, and test harness—not a marketplace or general-purpose code sandbox.

Research sources reviewed for this decision:

- [Node.js VM documentation](https://nodejs.org/api/vm.html)
- [Node.js permission model](https://nodejs.org/api/permissions.html)
- [VS Code extension hosts](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [VS Code web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)
- [Directus sandboxed extensions](https://docs.directus.io/extensions/sandbox/introduction)
- [Sigstore signature verification](https://docs.sigstore.dev/cosign/verifying/verify/)

## Consequences

- Plugins are portable and reviewable through a stable SDK surface.
- Revocation and least privilege are enforceable after installation.
- Isolation has performance and implementation cost, so in-process arbitrary modules are intentionally unsupported.
- Production deployments must provide and harden the external runtime (OS user, filesystem, network, CPU, memory, and process limits); the SDK adapter alone cannot supply those controls.
- M5-003 deliberately fails closed when no runtime or publisher trust record is configured.
