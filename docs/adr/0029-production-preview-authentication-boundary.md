# ADR 0029: Close the production preview-token authentication bypass

- Status: Proposed — implementation requires explicit approval.
- Created: 2026-08-26T16:03:30+05:30 by Codex.
- Task: AUTH-001 (T2), prerequisite for CMS-003.
- Baseline: `1de8211` on `main`; this checkpoint changes documentation only.
- Defect: BUG-0433, Critical. No live deployment or exploitation is asserted.

## Ask and priority change

The user asked to proceed from completed CMS-002 to CMS-003 planning. Inspecting the existing authentication, authorization, scope and Studio seams exposed a production authentication bypass. The delivery loop requires this security defect to take priority; a new capability projection must not be placed behind the defective boundary.

AUTH-001 is a small, independently shippable security prerequisite. CMS-003's capability/context contract remains unapproved and blocked until this fix is verified. This proposal does not authorize an authentication redesign or an operational action against any running installation.

## Evidence and root cause

- [The production request hook](../../apps/api/src/identity-routes.ts) rejects development headers, then calls `isPublicPath` before authenticating an opaque session. That classifier returns true for any bearer value starting with the preview prefix, regardless of route or method. It does not validate that token.
- [Request context construction](../../apps/api/src/request-context.ts) supplies a development principal, defaulting to admin, when no verified identity was bound. The two behaviors combine into an ordinary-management authentication bypass.
- An isolated `buildServer({ databasePath: ':memory:', seed: false, identity: { mode: 'production' } })` injection against the built baseline returned HTTP 200 for `GET /api/v1/context` using a deliberately invalid preview-prefixed value. The response identified a development user with admin roles. The fixture was closed after the read; it never listened on a port and did not use saved project data or credentials.
- A repeated controlled fixture returned 401/`invalid_session` for context with no session, 200/development identity for context with the invalid preview prefix, and 200 for schemas with that same invalid prefix. This confirms the prefix changes the management authentication outcome; no mutation endpoint was exercised.
- The [preview handlers](../../apps/api/src/server.ts) already validate signatures, expiry/revocation, scope, origin and entry/session matching through [PreviewSessionService](../../packages/core/src/preview-service.ts). That validator is not reached for unrelated management routes. This is a request-dispatch/authentication failure, not evidence that preview cryptography itself is broken.
- The existing [production identity tests](../../apps/api/test/identity-server.test.ts) cover development-header rejection and real tenant-bound sessions but not a preview-prefixed bearer on ordinary management paths. New regressions must reproduce that missing case before the fix.

## Options and prior art

| Approach | Evidence / fit | Cost | Decision / deliberately skipped |
|---|---|---|---|
| Keep the prefix-wide exemption | Current behavior; preview handlers have their own verifier. | None, but unrelated routes never reach that verifier. | Rejected: reproduces BUG-0433. |
| Route-and-method-specific preview dispatch, plus fail-closed production context | Reuses the existing session and preview validators; matches [OWASP's deny-by-default and every-request authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). | Small API-edge change with negative integration tests. | Recommended. No new permission or credential type. |
| Require a workforce session on every preview request | Removes the exemption but changes the standalone application trust model. | Breaks isolated preview applications or forces them to receive workforce credentials. | Rejected: preserve the single-purpose preview boundary from ADR 0004. |
| Replace authentication middleware or identity providers | Could centralize routing but does not remove the need for exact credential-purpose dispatch. | Broad dependency/protocol and compatibility work. | Rejected: existing verifiers are sufficient for this bounded defect. |

The recommendation is a GridStory design inference from the reproduced seam and OWASP guidance, not a certification claim. CMS-003's additional Sanity/Contentful research is retained in the gap analysis, not used to broaden this fix.

## Proposed boundary

1. Distinguish intentionally anonymous public routes, preview-credential routes and workforce-session routes. Never classify a request as public solely from an unverified credential prefix.
2. Permit the preview credential path only for these existing method/path pairs:

   | Method | Path | Existing authority that must still run |
   |---|---|---|
   | GET | `/api/v1/preview/content/:id` | Verified preview grant, origin and entry binding; reads the grant's complete draft scope. |
   | POST | `/api/v1/preview/sessions/:id/messages` | Verified grant, origin, matching session, schema, nonce and sequence. |
   | DELETE | `/api/v1/preview/sessions/:id` | Verified matching preview grant for self-revocation; the existing separately authenticated management revocation path remains available. |

   Match the whole route and method, not a prefix such as `/api/v1/preview/`. Query strings, extra suffixes, encoded separators, trailing variants and wrong methods must not expand the allowlist. Fastify route matching and credential classification must agree. Invalid preview values on these routes may reach the preview verifier only to be rejected; that is not an authenticated identity.
3. `POST /api/v1/preview/sessions` remains a management operation requiring ordinary production authentication and the existing content-read permission. Preview credentials alone cannot create another grant, call GraphQL, read context/schema/content, or perform any management write.
4. On all other private routes, keep the existing opaque session verification and tenant binding. A valid independently supplied workforce cookie may authorize a request under its own verified principal; a preview prefix never upgrades it. Do not interpret prefix possession as proof of validity or authority.
5. Record request authentication mode explicitly at the API boundary. An unbound production management context must throw a stable authentication error instead of generating development identity. Intentionally public delivery continues to construct an anonymous principal; it must never inherit the local default admin. Preserve development behavior only in explicit development mode.
6. Preserve existing public health/readiness/delivery, federation callbacks and SCIM's own verifier boundaries. Check siblings for the same prefix bypass, but do not redesign those protocols or silently broaden their public paths. Unexpected additional defects get separate ledger entries and scope decisions.
7. Keep preview error, origin, expiry, replay, complete-scope and private/no-store behavior. No token, session, draft or management result enters a URL, new log, persisted preference or public cache.

## Sequence and exact implementation fence

1. Add a failing production-mode API regression for an invalid preview-prefixed bearer on context and a second management read. Establish the missing-session control and retain the existing valid workforce-session case. This proves the actual boundary before editing it.
2. Restrict route/method credential dispatch and add the independent fail-closed request-context check. Do this before any new capability endpoint so its authentication is trustworthy.
3. Exercise every allowed preview path and management denial class with synthetic entries/sessions, including cross-tenant/revoked cases and wrong paths/methods. Reuse the existing cryptographic/session services; add no replacement verifier.
4. Run focused and full verification, update the existing security evidence and operational guidance, close BUG-0433 only when the old-code regression fails and fixed-code gates pass, then commit AUTH-001 independently. Resume CMS-003 planning afterward.

Files permitted after approval:

- `apps/api/src/identity-routes.ts`
- `apps/api/src/request-context.ts`
- `apps/api/src/server.ts` — only preview/session dispatch integration if needed, not unrelated routes or grants.
- `apps/api/test/identity-server.test.ts`
- `apps/api/test/server.test.ts` — retain/add legitimate preview/public delivery assertions.
- `apps/api/test/request-context.test.ts` (new)
- `docs/identity-and-access.md`
- `docs/adr/0004-preview-session-protocol.md`
- `docs/security/threat-model.md`, `docs/security/security-requirements.md`, `docs/security/asvs-v5-profile.md`
- `security/threat-model.json`, `security/asvs-v5.0.0-profile.json` — update affected existing authentication/preview evidence; do not certify unrelated controls.
- `README.md`, `docs/cms-admin-gap-analysis.md`, this ADR
- `TASKS.md`, `CHANGELOG.md`, `BUGS.md`

No Studio/client/schema/core implementation, dependency/lockfile, database migration, topology configuration, capability endpoint, new role/permission, CSS/theme or consuming-application change is authorized by this fence. Amend the plan and obtain approval if the boundary cannot be fixed without changing those contracts. Planning edits are limited to the five files listed in TASKS.

## Observable acceptance and verification

- Production private context/schema reads reject invalid preview-prefixed credentials with 401 instead of the reproduced 200; they return no principal, schema, draft or privileged payload. Missing/invalid/revoked workforce sessions also fail. A genuine authorized workforce session retains its ordinary behavior and tenant isolation.
- Valid, invalid, expired and revoked preview credentials alone cannot authorize private reads, GraphQL, create-grant or write endpoints. Test negative writes only against disposable fixtures; the pre-fix reproduction uses read-only routes. Wrong methods, sibling paths and suffix/encoding variants never gain a public exemption.
- Valid preview draft reads/messages/self-revocation still work under their exact grant. Wrong entry/session, foreign scope/origin, replay, expiry and revocation fail. Management revocation with its established supported session transport continues to work. Do not silently expand accepted bearer formats to fix unrelated behavior.
- Production `requestContext` never fabricates a development principal without bound identity; intentional public reads resolve anonymous and remain published-only. Development-mode authoring remains runnable. CORS, session-cookie security, cache separation and current stable error conventions remain intact.
- Run focused API/request-context regressions, `pnpm security:check`, complete `pnpm check`, then `pnpm test:e2e` serially without competing heavy jobs. Preserve all 30 current Chromium/Firefox/WebKit checks and their assertions/timeouts. Verify the actual header preview open/edit/close and edit/save/publish/deliver path using isolated synthetic services; API injection supplies production identity negative evidence, not a live IdP claim.
- Record exact commands/results, updated threat/ASVS links, resolved/deferred defects and a clean commit. PostgreSQL migrations, provider interoperability and production deployment are neither needed nor claimed for this request-dispatch-only change. A green pre-existing suite alone does not refute BUG-0433.

## Necessity, risk and rollback

1. Traceable: reproduced BUG-0433 invalidates the trust boundary CMS-003 needs.
2. Not already solved: downstream preview verification protects only preview handlers; unrelated handlers see unbound development fallback.
3. Minimal form: exact credential-purpose dispatch and fail-closed context, not a new identity engine or capability system.
4. Dependency justified: reuse existing maintained session/preview infrastructure; no dependency added.
5. Rule of three: the three real preview operations justify one finite classifier, not a generic policy/plugin framework.
6. Reversible: one API-only implementation commit with no data migration. Reverting restores the known vulnerability, so rollback must not return that build to untrusted traffic; prefer a forward correction or an operator-approved isolated shutdown. This plan authorizes neither deployment nor live isolation actions.

Main risk: over-restricting dispatch could break legitimate standalone preview or anonymous published rendering. Passing production-negative tests together with real preview/publication regressions is the release gate. Neither removing the test nor broadening the exemption is an acceptable remedy.

## Approval and handoff

AUTH-001 remains planned and BUG-0433 remains confirmed/open. CMS-003 is blocked on its verified completion; no capability/context implementation has begun. The user's `proceed to next` authorized this investigation/planning checkpoint, not an unreviewed authentication contract. Request explicit approval of the boundary, exact files and verification plan above before source edits.

Planning verification results are appended only after the checks run. The planning commit uses `docs(plan): prioritize production authentication boundary [AUTH-001]`; the future implementation commit uses a separate `fix(auth)` message with `[AUTH-001]`. Do not push or deploy as part of either local task.

## Planning checkpoint verification

At 2026-08-26T16:06:58+05:30, Codex observed:

- `pnpm lint`: passes Biome, boundaries, ledgers, existing security-model/tenant checks and historical readiness-artifact validation. These validate the existing records; they do not refute the newly reproduced bug or grant current release approval.
- `pnpm format:check`: passes across 324 managed files; Markdown links/structure were checked separately.
- `pnpm --filter @gridstory/api build`: the unchanged API compiles successfully.
- `git diff --check`: passes. Read-only PowerShell/Git audit confirms exactly the five planning documents changed, all 136 prior task IDs and completed states remain intact, only CMS-003 moved to blocked, AUTH-001 is newly planned, and 13 local documentation links resolve.
- Two isolated read-only API injections reproduce BUG-0433, including the missing-session control and second private endpoint. Fixtures were closed; existing app services and stored data were untouched.

Unit/integration/browser suites, PostgreSQL, provider interoperability and deployment were not rerun for this documentation checkpoint. No passing runtime-fix claim is made. Handoff: `main`, planning-only commit tagged `[AUTH-001]`; the single next action is explicit approval of this scoped security fix. BUG-0433 remains open until a separately implemented regression and full verification pass.
