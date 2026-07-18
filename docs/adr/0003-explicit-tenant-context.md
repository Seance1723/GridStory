# ADR 0003: Explicit hierarchical request context

- Status: Accepted
- Date: 2026-07-17

## Context

A production CMS must isolate organizations and tenants across storage, caches, search, assets, jobs, webhooks, audit, and telemetry. Ambient globals and optional tenant filters make cross-tenant mistakes easy.

## Decision

Every management operation carries an immutable request context containing organization, tenant, workspace, site, environment, locale, perspective, and authenticated principal. Repository methods require the relevant scope explicitly. Authorization evaluates principal, action, resource, and context before the service invokes persistence.

Development headers may construct a context only in local mode. Production identity adapters must derive it from verified sessions or scoped service credentials.

## Consequences

- Missing scope becomes a compile-time or boundary-validation error.
- Cache keys, events, audit records, and telemetry can use the same scope vocabulary.
- Hierarchical ownership and policy evaluation are consistent across adapters.
- Existing tenant-only contracts migrate incrementally behind compatibility helpers.
