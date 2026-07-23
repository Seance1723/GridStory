# ADR 0004: Isolated preview session protocol

- Status: Accepted
- Date: 2026-07-17

## Context

Studio needs live React preview without giving the CMS ownership of application routing or executing application components inside the control plane. Draft credentials and content must never enter published caches.

## Decision

Keep in-process preview for local component editing and introduce an external preview protocol based on short-lived, audience-bound preview sessions. The application owns a preview route and component registry. Studio sends structured content patches and route/viewport state through an origin-checked channel; the application returns source-map selections and navigation state.

Preview endpoints use private, no-store responses. Tokens are single-purpose, expire quickly, bind tenant/site/environment, and are never accepted by public delivery routes.

## Consequences

- Applications retain router, rendering, CSP, and styling ownership.
- Preview can represent SSR and application-only behavior without sharing control-plane credentials.
- The protocol needs replay protection, origin validation, version negotiation, and reconnect handling.

## Implemented transport

`@gridstory/client/preview` is the explicit browser-only entry point. Studio creates a short-lived grant through the management client, opens the allow-listed application without credentials in its URL, and transfers the grant only to the exact target origin through a source-checked bootstrap message. The application runtime validates the expected Studio origin and parent/opener window before accepting the bootstrap.

The application runtime submits every sequenced handshake, patch, navigation, readiness, and selection message to the private API acceptance endpoint before applying or returning it. Studio queues the latest route and full-content patch until readiness, retries bootstrap during application startup, synchronizes application navigation, and maps preview source clicks back to the selected component node. Closing Studio preview uses scope-checked management revocation; an application may also revoke its own token-bound session.

Preview applications keep router, CSP, component registry, and rendering ownership. The included Vite application demonstrates the runtime and renders preview-only source attributes; normal published rendering and public caches never receive the preview grant or draft patch.
