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
