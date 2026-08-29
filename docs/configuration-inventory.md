# Effective configuration inventory

GridStory Studio exposes a read-only **Settings > Configuration** page for authorized users. It answers which safe runtime facts apply to the current organization, tenant, workspace, site, environment, and locale without turning deployment configuration into browser-editable settings.

## What the inventory contains

The page has three fixed, independently authorized sections:

| Section | Existing permission | Safe facts | Ownership |
|---|---|---|---|
| Sites, environments, and locales | `locales.read` | Current permitted tuple, configured/current-only coverage, permitted current-site environments, and enabled locale labels/defaults/requirements/route prefixes/fallbacks | Operator-owned, read-only |
| Models and public routes | `schema.read` | Registered model ID/name/version/collection, optional route pattern and slug field, and localized field names | Code-owned, read-only |
| Media policy and provider availability | `asset.read` | Fixed supported kinds, upload/part/dimension/part-count limits, verified-only rules, and generic provider modes | Code/operator-owned, read-only |

A denied section stays visible as **Unavailable with current access**. `settings.read` only makes the finite page visible when at least one source permission exists; it is presentation metadata and grants no API action. Links to Schemas & taxonomies or Library appear only when those destinations are already permitted.

## Provider-mode meaning

Provider entries deliberately use a closed vocabulary:

- Storage: `built-in-local` or `configured`.
- Content inspection: `built-in` or `configured`.
- Rendition and malware scanning: `configured` or `unavailable`.

`configured` means an adapter was supplied at trusted server composition. It does not prove credentials, connectivity, health, production readiness, provider identity, bucket/region, endpoint, scanner signature, or successful external conformance.

## API contract

`GET /api/v1/configuration/inventory` is authenticated, parameter-free, complete-scope validated, and returned with `Cache-Control: private, no-store`. Queries and request bodies are rejected. The universal client method is `getConfigurationInventory({ signal? })`; it strictly parses version 1 and rejects a response whose scope differs from the client's exact scope.

The projection receives only explicit safe inputs. It does not serialize `ApiConfig`, inspect `process.env`, enumerate raw topology, inspect adapter objects, access a repository, or populate published caches. Locale/environment metadata is intersected with the already permission-filtered Studio choices; current-only mode never infers a wider topology.

## Deliberate exclusions

The inventory exposes no generic key/value record, environment-variable name/value, secret, credential state, host/port, filesystem/database path, origin, private endpoint, provider class/name, raw error, topology mutation, configuration form, save/deploy action, or public setting. DNS/TLS/domain provisioning, storage/scanner setup, editable public site settings, local Studio preferences, and site health remain separate future or existing concerns.

See [ADR 0033](adr/0033-safe-configuration-inventory.md) for the approved boundary and [Enterprise identity and access](identity-and-access.md) for production authentication limits.
