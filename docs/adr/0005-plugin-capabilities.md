# ADR 0005: Capability-based plugin boundary

- Status: Accepted
- Date: 2026-07-17

## Context

CMS plugins are supply-chain and tenant-isolation risks because they may handle content, assets, credentials, network calls, UI extensions, and background work.

## Decision

Plugins declare a signed manifest with version compatibility and granular requested capabilities. Installation grants an explicit tenant-scoped subset. Server extensions run out of process or in a restricted worker with mediated storage, network, secret, event, and job APIs. Studio extensions run in isolated frames or workers with a versioned message protocol.

No plugin receives database handles, ambient credentials, unrestricted filesystem access, or control-plane process execution. Every privileged call is authorized, rate-limited, and audited.

## Consequences

- Plugins are portable and reviewable through a stable SDK surface.
- Revocation and least privilege are enforceable after installation.
- Isolation has performance and implementation cost, so in-process arbitrary modules are intentionally unsupported.
