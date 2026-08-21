# Enterprise identity and access

GridStory can run with either an explicit local-development identity boundary or a production-selectable enterprise relying-party boundary. Production mode makes GridStory an OIDC/SAML relying party and a SCIM 2.0 service provider. It does not make GridStory an identity provider, password database, or account-recovery service.

## Boundary and data flow

The framework-neutral identity kernel in `@gridstory/core` persists one tenant document per organization/tenant in SQLite or PostgreSQL. It owns providers, users, groups, scoped role mappings, session policy, opaque session hashes, WebAuthn credentials and challenges, one-time federation state, SCIM credentials, break-glass records, and ordered security events. The API edge passes only cryptographically verified federation or WebAuthn results into that kernel.

The Node API uses the pinned maintained adapters:

- `openid-client` for OIDC discovery and Authorization Code flow with exact redirect, state, nonce, and S256 PKCE checks;
- `@node-saml/node-saml` 5.1.0 for SAML Web Browser SSO with trusted IdP certificate, issuer/audience/time checks, signed assertions/responses, durable request IDs, and mandatory `InResponseTo` validation;
- `@simplewebauthn/server` for exact RP ID/origin, challenge, user-presence, user-verification, public-key signature, and counter checks;
- Fastify's official cookie and form-body adapters for `HttpOnly` session cookies and SAML POST binding.

Management, identity, GraphQL, and SCIM responses remain `Cache-Control: private, no-store`. Published delivery remains anonymous and publicly cacheable. Session, SCIM, federation, WebAuthn, and emergency credentials never enter published content or cache tags.

## Development and production modes

`GRIDSTORY_IDENTITY_MODE=development` is the default for the local example. It retains `x-gridstory-actor` and related development behavior. Never expose this mode to an untrusted network.

`GRIDSTORY_IDENTITY_MODE=production` changes the request boundary:

- `x-gridstory-actor`, `x-gridstory-principal-type`, and `x-gridstory-roles` are rejected, even when a valid session is also supplied;
- private requests require a backend-verified `gridstory_session` cookie or an explicit `gss_` bearer session;
- organization/tenant headers or federation callback query values are routing hints only—the selected tenant repository and opaque token hash must also match;
- exact configured CORS origins may send credentials; the cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` by default;
- public health/readiness and published delivery remain anonymous, while preview-token requests continue through the separate origin-bound preview boundary.

Studio must set `VITE_GRIDSTORY_IDENTITY_MODE=production` so the universal client includes cookies and stops emitting its development actor header.

## Provider configuration

Runtime protocol configuration is deployment-owned JSON in `GRIDSTORY_FEDERATION_PROVIDERS_JSON`. Do not commit real client secrets or IdP certificates. Inject the JSON from a secret manager or protected runtime configuration. Example OIDC entry:

```json
[
  {
    "id": "workforce",
    "protocol": "oidc",
    "issuer": "https://identity.example.com",
    "clientId": "gridstory",
    "clientSecret": "injected-at-runtime",
    "redirectUri": "https://cms.example.com/api/v1/identity/federation/workforce/callback?organizationId=acme&tenantId=main",
    "scopes": ["openid", "profile", "email"],
    "groupClaim": "groups"
  }
]
```

Example SAML entry:

```json
[
  {
    "id": "workforce-saml",
    "protocol": "saml",
    "issuer": "https://identity.example.com/saml",
    "entryPoint": "https://identity.example.com/saml/login",
    "idpCertificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
    "serviceProviderIssuer": "https://cms.example.com/saml/metadata",
    "callbackUrl": "https://cms.example.com/api/v1/identity/federation/workforce-saml/callback?organizationId=acme&tenantId=main",
    "groupAttribute": "groups"
  }
]
```

The same adapter ID, protocol, and exact issuer must then be enabled for that tenant through `POST /api/v1/identity/providers` or Studio's Identity panel. This two-part configuration prevents an administrator from turning an arbitrary issuer into a runtime trust anchor. Automatic remote SAML metadata trust is intentionally absent.

OIDC and SAML callbacks need stable organization/tenant routing hints in their pre-registered callback query for a multi-tenant deployment. The opaque state/RelayState and durable protocol request are still verified and single-use; query values alone never authenticate a user.

## Sessions and scoped group mapping

Federated users are linked by provider ID plus provider subject. Just-in-time provisioning is off unless the tenant provider explicitly enables it. Asserted federation groups are persisted as directory attributes so every request can recompute current role assignments. A group has no authority by itself: only an administrator-created `externalGroup -> roleId` mapping grants a role, and each mapping is explicitly bound to organization/tenant with optional workspace, site, environment, locale, and content-type constraints.

Default session policy:

| Control | Default |
|---|---:|
| Idle lifetime | 30 minutes |
| Absolute lifetime | 8 hours |
| Recent-authentication window | 30 minutes |
| Concurrent sessions per user | 5 |
| Break-glass session | 15 minutes |
| Failed break-glass attempts | 5 |

Session identifiers have an independent CSPRNG secret; only a SHA-256 digest is persisted and verification uses a constant-time comparison. Every request checks idle/absolute/revoked/user-active state and reconstructs roles from current mappings. SCIM disable/delete and administrative revocation invalidate sessions immediately. Concurrent-session overflow revokes the oldest session. Break-glass sessions are always non-renewable.

## SCIM 2.0

An identity admin issues a tenant-bound opaque `gsc_` directory credential once through Studio or `POST /api/v1/identity/directory-credentials`. Send it as `Authorization: Bearer ...` with the exact organization/tenant routing headers. Rotate it by issuing a replacement and revoking the old credential through the repository/API lifecycle before its bounded expiry.

The `/api/v1/scim/v2` surface provides:

- `ServiceProviderConfig`, `ResourceTypes`, and `Schemas` discovery;
- Users and Groups list/create/read/replace/patch/deprovision;
- exact equality filters for `userName`, `externalId`, or `displayName`;
- bounded pagination, weak ETags, and required `If-Match` on PUT/PATCH;
- RFC-shaped list and error envelopes;
- immediate session revocation when a user becomes inactive.

Bulk operations, password changes, sorting, general filter expressions, and arbitrary SCIM extensions are advertised as unsupported. Group member IDs must reference users inside the same tenant. A credential from one tenant cannot read or mutate another.

## WebAuthn step-up

WebAuthn is an enrolled step-up factor for a federated session, not a passwordless recovery path. Configure an exact domain RP ID and HTTPS origin list:

```text
GRIDSTORY_WEBAUTHN_RP_NAME=GridStory
GRIDSTORY_WEBAUTHN_RP_ID=cms.example.com
GRIDSTORY_WEBAUTHN_ORIGINS=https://cms.example.com
```

Registration and authentication each use a server-created five-minute, user/session-bound, single-use challenge. The verifier requires user verification and persists the credential ID, public key, counter, transports, device type, backup state, and lifecycle timestamps. Successful authentication raises the existing session to `phishing-resistant` and refreshes its recent-authentication window. Counter regression, wrong user/session, wrong origin/RP, expired/replayed challenge, revoked credential, or failed signature is denied.

Attestation allow-lists and passkey-first recovery are not implemented. Operators must define their authenticator enrollment/help-desk policy before enabling privileged step-up.

## Break-glass operations

Break-glass is for a named incident, not routine login:

1. An authenticated identity admin supplies a name, exact role, future expiry, and incident ID.
2. GridStory shows a high-entropy `gbg_` credential once and stores only its digest.
3. Activation must repeat the incident ID, is rate-limited by tenant policy, consumes the credential permanently, and creates a short non-renewable session.
4. A second use, expired/revoked credential, wrong secret, or attempt limit is denied. Administrators can revoke the account and all derived sessions.
5. Creation, denial, activation, session creation/revocation, and account revocation are stored as ordered tenant security events without credential material or assertion bodies.

The repository does not integrate an external ticket/approval system or distributed abuse counter. Production operators must require human approval in their incident process, monitor repeated failures, restrict who can create credentials, and test revocation.

## API and operations checklist

Before enabling production mode:

1. Use PostgreSQL, HTTPS, a trusted reverse proxy, exact CORS origins, and secure cookies. Do not disable secure cookies outside isolated local testing.
2. Store client secrets, private keys, IdP certificates, SCIM credentials, and break-glass secrets in an approved secret manager; inventory owners, expiry, rotation, revocation, and access logging.
3. Register exact OIDC/SAML redirects and verify issuer, audience/entity ID, signing algorithms, group claim/attribute, clock policy, and logout expectations with each customer IdP.
4. Create minimal scoped role mappings and verify users without a mapping have no management authority.
5. Configure SCIM, exercise create/update/disable/group changes, stale ETag, cross-tenant denial, and session revocation in staging.
6. Verify WebAuthn on the exact production origins and supported authenticator fleet. Document enrollment loss/replacement procedures that do not weaken federation.
7. Exercise break-glass creation, failed attempt, activation, one-time denial, expiry, and revocation; confirm security events reach the protected operational process.
8. Run `pnpm check`, `pnpm security:check`, `pnpm test:postgres`, and `pnpm test:e2e`, then perform live IdP interoperability and trusted-proxy/TLS tests. Repository checks do not certify the deployed IdP, proxy, secret manager, or authenticator fleet.

## Rollback and limitations

Set production traffic to a previously verified release and disable the new production identity mode only under an approved non-production/local rollback. Never expose development mode as a production workaround. Identity tables are additive and can be removed after retaining required security/audit evidence; content revisions and published delivery data do not change.

Complete SAML Single Logout/artifact/ECP, SCIM bulk/password/general filters, local passwords, account recovery, LDAP, IdP operation, remote metadata auto-trust, authenticator attestation allow-lists, customer onboarding UX, distributed rate counters, and deployment certification remain outside M6-002.
