# ADR 0013: Enterprise identity is a relying-party boundary

- Status: Accepted
- Date: 2026-08-21
- Task: M6-002

## Context

GridStory currently has deny-by-default scoped authorization, an OIDC verifier interface, tenant-bound group roles, hashed opaque service-token foundations, and immutable content audit storage. The executable API still derives ordinary management identity from development headers, while identity sessions and service credentials are process-local. M6-002 must add enterprise federation, provisioning, phishing-resistant step-up, durable session policy, and emergency access without turning the CMS into an identity provider or moving protocol cryptography into the framework-neutral control plane.

## Options considered

| Approach | Who does it this way | Fits GridStory? | Cost | What we would skip |
|---|---|---|---|---|
| Durable framework-neutral identity kernel plus maintained OIDC/SAML/WebAuthn adapters at the Node API edge | Enterprise applications acting as OIDC/SAML relying parties and SCIM service providers | Yes; it preserves explicit boundaries and supports self-hosting | Additive identity storage, protocol dependencies, API/session integration, and UI | IdP operation, local passwords, broad protocol variants, hosted-provider claims |
| Require an external identity-aware proxy and trust installed headers | Some infrastructure-owned internal applications | Partly; it can work operationally but does not provide GridStory sessions, SCIM, WebAuthn step-up, or caller-override protection by itself | Small application diff, large undocumented deployment contract | Rejected as the only product boundary; may remain an upstream layer after exact trust configuration |
| Implement XML signatures, OIDC/JWT validation, and WebAuthn verification directly | Bespoke identity stacks | No; subtle parser, canonicalization, algorithm, challenge, and credential-counter failures are security-critical | High maintenance and audit burden | Rejected; maintained protocol libraries are justified |
| Build GridStory as an IdP with passwords and recovery | Full identity platforms | No; unrelated to content management and vastly expands sensitive-data/abuse scope | A separate security product | Rejected |
| Do nothing / reuse the current `IdentityService` and development headers | Current baseline | No; state is process-local and the API never authenticates it | Zero | Fails M6-002, GS-SEC-010/013/014/017, THREAT-0002, and BETA-003 |

## Decision

GridStory will remain a relying party and SCIM service provider. A durable identity repository owns tenant users/groups, scoped group mappings, hashed sessions/service/emergency credentials, one-time protocol/WebAuthn challenges, authenticators, policy, and append-only security events. The framework-neutral service owns lifecycle, tenant isolation, role materialization, session bounds/revocation, deprovisioning, break-glass constraints, and audit/telemetry inputs. It accepts only already verified provider/WebAuthn results.

The Node API edge owns protocol details. Use maintained libraries for OIDC Authorization Code with state/nonce/PKCE, SAML Web Browser SSO with signed-response/assertion, issuer/audience/time and mandatory `InResponseTo` validation, and WebAuthn registration/authentication verification with exact RP ID/origin and required user verification. Production requests authenticate with backend-held hashed opaque sessions in `Secure`, `HttpOnly`, `SameSite=Lax` cookies or explicit scoped service credentials. Organization/tenant identity comes from the verified principal/session rather than development headers; development mode remains explicit and cannot be selected accidentally by a production configuration.

SCIM implements the interoperable tenant Users/Groups core, discovery, pagination, exact supported equality filters, PUT/PATCH, ETags, and deprovisioning. It advertises unsupported bulk/password/filter features honestly rather than accepting incomplete semantics. Group membership never becomes a GridStory role directly: an administrator-owned scoped mapping is the only bridge.

WebAuthn is enrollment and phishing-resistant step-up for federated users. Passkey-first recovery and local password accounts are deferred. Break-glass credentials are administrator-provisioned, randomly generated, hashed, shown once, rate-limited, single-use, incident/reason-bound, and issue a short non-renewable session. Creation, failed/successful activation, use, revocation, expiry, user/group lifecycle, session changes, and authenticator lifecycle produce append-only scoped security events and bounded telemetry without secrets or assertion bodies.

## Necessity gate

1. **Traceable:** M6-002, GS-SEC-010/013/014/017/028, THREAT-0002/0016/0018, BETA-003, and the explicit user request require the capability.
2. **Not already solved:** authorization and verifier foundations exist, but they do not wire an API identity boundary, persist sessions/directory state, implement provider flows/SCIM/WebAuthn, or constrain emergency access.
3. **Minimal form:** this is a relying-party/SCIM-service-provider slice, not an IdP, password/recovery system, complete SAML/SCIM suite, customer onboarding portal, or hosted identity service.
4. **Dependency justified:** maintained OIDC, SAML XML-signature, WebAuthn, cookie, and form parsers each remove well over 100 lines of security-critical protocol/canonicalization/encoding code and are isolated to the Node/browser edges.
5. **Rule of three:** the core introduces one identity lifecycle boundary for six inseparable consumers; it does not create a generic protocol/plugin framework, and adapters implement one narrow start/complete contract.
6. **Reversible:** production identity is opt-in and fail-closed; disabling it restores explicit local development behavior, while additive identity tables can be removed after non-production rollback without changing content revisions or delivery.

## Sources that changed the decision

- [OASIS SAML 2.0 specifications](https://docs.oasis-open.org/security/saml/v2.0/) define the browser SSO, binding, metadata, assertion, and signature contracts; the selected slice intentionally omits ECP/artifact and complete SLO.
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0-18.html) requires exact redirects and establishes state/nonce, authorization-code, authentication-context, and token-validation behavior.
- [SCIM Core Schema RFC 7643](https://datatracker.ietf.org/doc/html/rfc7643) and [Protocol RFC 7644](https://datatracker.ietf.org/doc/html/rfc7644) define JSON Users/Groups, discovery, HTTP lifecycle, multi-tenancy, TLS, and bearer-token constraints.
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) defines RP-scoped public-key credentials, challenges, user verification, and signature-counter handling.
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) supports bounded reauthentication, random challenges, authenticator lifecycle, and phishing-resistant WebAuthn without treating a cookie as an authenticator.
- [`@node-saml/node-saml` 5.1.0 security advisory](https://github.com/node-saml/node-saml/security/advisories/GHSA-4mxg-3p6v-xgq3) makes 5.1.0 the minimum acceptable line because earlier releases could consume identity data outside the verified XML.
- [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server) confirms maintained Node verification and the exact persistent credential material expected at the adapter boundary.

## Consequences and revisit triggers

- Repository tests can prove protocol fixtures, lifecycle, negative cases, and restart behavior, but cannot certify a customer's IdP, TLS, proxy, secret manager, authenticator fleet, or operational approval process.
- Secure cookies require HTTPS in production and deliberate local development handling; CORS must allow credentials only for exact configured Studio origins.
- Disabling or deleting a provisioned user invalidates sessions immediately; IdP logout propagation and complete SAML SLO remain separate interoperability work.
- Revisit passkey-first sign-in/recovery only after an approved account-recovery threat model. Revisit SCIM bulk/general filters or SAML artifact/SLO only when a real provider requires them.
