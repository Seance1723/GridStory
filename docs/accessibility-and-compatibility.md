# Accessibility and compatibility review

This document is GridStory's repository-owned M5-006 review and tested-support statement as of 2026-08-21. It covers the checked-in GridStory Studio, the framework-neutral client and React renderer, and the Vite example. It is not a third-party certificate, a legal assurance, or a claim that arbitrary application-owned components conform to WCAG.

## Result and claim boundary

- The reviewed critical Studio states and published example have zero detectable violations from axe 4.13.0 when run with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa`. No rule is disabled and no element or frame is excluded.
- Keyboard bypass, keyboard component movement, equivalent non-drag controls, visible focus, 24-by-24 CSS-pixel targets, 200% zoom/reflow, reduced-motion, and forced-colors states have executable checks.
- The complete edit, secure iframe/standalone preview, save, workflow review, publish, and React-delivery journey is a release gate on Playwright-pinned Chromium, Firefox, and WebKit.
- The declared React peer range is exercised on isolated React 18.3.1 plus current React 19.2.7 rendering. Current React also has SSR/static and hydration-without-recoverable-errors tests; the React 18 fixture builds a Vite SPA and executes a server-rendered artifact.
- Vite 8.1.5 production builds use its `baseline-widely-available` target. For Vite 8 that compile target is Chrome/Edge 111, Firefox 114, Safari/iOS 16.4 or newer; it is a syntax/output floor, not proof for every browser release in that range.

Complete WCAG 2.2 AA conformance cannot be concluded from this evidence. W3C calls for experienced human evaluation alongside tools, and axe explicitly covers only mechanically detectable rules. Live assistive-technology sessions, testing with disabled authors, branded Safari/iOS on Apple hardware, RTL Studio localization, and an independent audit remain named readiness evidence for M5-008.

## Executable browser and framework matrix

| Surface | Tested version or engine | Evidence | Status |
|---|---|---|---|
| Node runtime | 22.14.0; package floor 22.12.0 | `pnpm check`, API/worker/package builds | Supported |
| React / React DOM | 19.2.7 | React renderer/static/hydration tests and the Vite example in `pnpm test:compatibility`/`pnpm check` | Supported |
| React / React DOM | 18.3.1 | Isolated `tests/compatibility/react18-vite` SPA build and SSR execution, including an exact runtime-version assertion | Supported |
| Vite SPA | 8.1.5 | Production/e2e builds, preview server, secure preview handshake, publish/delivery E2E | Supported |
| Framework-neutral client | Web Fetch API in browser and Node 22 | Client unit tests, browser journey, explicit `@gridstory/client/preview` entry | Supported |
| SSR/static React rendering | React 18.3.1 and 19.2.7 | React 18 Vite SSR artifact; React 19 `renderToStaticMarkup`, `renderToString`, and `hydrateRoot` regressions | Supported renderer pattern; framework cache/router integration remains application-owned |
| Chromium | Chrome for Testing 149.0.7827.55, Playwright build 1228 | Full functional journey plus all accessibility tests | Supported engine |
| Firefox | Firefox 151.0, Playwright build 1532 | Full functional journey plus all accessibility tests | Supported engine |
| WebKit | WebKit 26.5, Playwright build 2311 | Full functional journey plus all accessibility tests | Supported engine; not branded Safari certification |
| Next.js, React Router framework mode, TanStack Start, Astro, Gatsby | No adapter or fixture is shipped | None | Not certified; do not infer support from the universal client |
| React Native/Expo/Electron | No platform fixture is shipped | None | Not certified |

Playwright browser builds are tied to `@playwright/test` 1.61.1. Updating that dependency changes the tested browser versions and requires this matrix plus all three project gates to be refreshed. Operating-system codecs, native controls, fonts, and accessibility APIs can differ; engine evidence on CI does not replace target-OS acceptance.

## WCAG 2.2 AA review scope

| Area | Review evidence | Result / boundary |
|---|---|---|
| Names, roles, values, labels, landmarks, language, IDs, and rendered contrast | Unsuppressed axe scans on default Studio, all expandable management panels, adapted Studio, and published application | No detectable A/AA violations in tested states after resolving BUG-0227 |
| Keyboard and bypass | The explicitly sequentially focusable bypass link is the first document control on Tab in every tested engine; Enter focuses the main editor; layer arrow keys reorder without dragging; buttons expose undo/redo, move, nest, remove, save, review, preview, and publish paths | Passed tested critical path |
| Focus visibility | Shared `:focus-visible` outline plus forced-colors system outline; skip target is programmatically focusable | Passed source and browser checks; exhaustive focus-order review with assistive technology remains manual |
| Target size | Every visible enabled link/form/action target in the critical state has an effective label/control box of at least 24 by 24 CSS pixels | Passed browser assertion |
| Zoom and reflow | 640 CSS-pixel viewport at 200% browser CSS zoom, equivalent to a 320 CSS-pixel layout; no whole-document horizontal overflow | Passed; intentional horizontally scrollable local collections remain operable |
| Motion and high contrast | `prefers-reduced-motion: reduce` and forced-colors emulation; no non-zero animation/transition duration; adapted state is axe-clean | Passed browser proxy; Windows High Contrast user acceptance remains manual |
| Errors and status | Inline alert/status roles, busy/live state, immutable-save result, quality remediation, workflow state, and stable errors | Reviewed in unit/role-based E2E; live screen-reader announcement timing remains manual |
| Content output | Example-owned Hero/RichText/Callout/Stack semantics and published Vite page | Reviewed example is axe-clean; consuming application components/styles are outside GridStory's conformance claim |

The axe JSON report is attached to each Playwright result. A new violation must be fixed or entered in `BUGS.md`; exclusions, rule disables, and score thresholds are not accepted substitutes.

## ATAG 2.0-informed review

ATAG Part A concerns the accessibility of Studio to authors. Part B concerns help for producing accessible application content. ATAG 2.0 references WCAG 2.0 in its normative model; GridStory uses the newer WCAG 2.2 A/AA review tags where they strengthen the checked surface.

| ATAG concern | GridStory evidence | Review result |
|---|---|---|
| Part A: accessible authoring UI | Native form elements/buttons/landmarks, visible focus and bypass, keyboard composition, target/reflow/adaptation tests, stable status/error roles | Meets the reviewed repository critical path; live screen-reader and disabled-author acceptance outstanding |
| Part A: authors can edit and inspect content | Schema-derived fields, layers and inspector, draft/published responsive preview, source selection, keyboard/explicit controls, immutable history and undo/redo | Meets reviewed functions |
| Part A: accessible process and documentation | Non-pointer equivalents, composition keyboard help, quality remediation, this guide, and troubleshooting | Meets reviewed functions; a localized/RTL Studio is not shipped |
| Part B: enable accessible output | Structured manifests, code-owned components, constrained props/slots/tokens, required alt-capable asset metadata, semantic example components | Partial by architecture: GridStory cannot make arbitrary application components conformant |
| Part B: check and repair | Deterministic missing/poor alt, heading-order, link-purpose, and table-header checks; responsible paths, severity, remediation, recheck, publish gates | Meets implemented structured checks; final contrast, captions, landmarks, and interaction semantics require application browser audits |
| Part B: promote and preserve accessibility | Quality policy is serializable and tenant/scenario scoped; findings remain visible before publication; safe structured revisions are preserved | Meets implemented scope; template/component accessibility provenance is future adapter/marketplace work |

This is an ATAG-informed evaluation, not an ATAG conformance claim. A full claim would need complete success-criterion applicability, experienced manual evaluation, end-user testing, and a maintained report across all authoring features.

## Browser security and deployment ownership

GridStory's control plane serves JSON and private assets, not the Studio/example production HTML deployment. The API enforces exact CORS origins; preview messaging verifies exact source/origin/schema; preview and management data are private/no-store; private asset responses use `nosniff`, safe disposition, and a restrictive SVG CSP. Browser tests exercise the origin-bound preview protocol on all three engines.

The application deployer must send HTML response headers. A reviewed baseline is:

- `Content-Security-Policy` with `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, explicit API `connect-src`, explicit preview `frame-src`, and only the script/style/image/font sources actually required. Inline React style attributes and consumer components must be accounted for deliberately rather than weakening all directives without review.
- `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` (or a documented stricter-compatible policy).
- An explicit `frame-ancestors` policy. Studio can normally use `'none'`; an application preview route must allow only the exact Studio origin and therefore must not use an incompatible blanket `X-Frame-Options: DENY`.
- A least-privilege `Permissions-Policy`, HTTPS/HSTS at the deployment boundary, and cache rules that never mix preview/draft credentials with published responses.

`frame-ancestors` cannot be established by an HTML meta tag. Production header conformance remains deployment evidence under M5-008, so `GS-SEC-009` stays partial even though the repository browser/rendering review is complete.

## Commands and maintenance

```bash
# Install the exact browser engines for the pinned Playwright release
pnpm exec playwright install chromium firefox webkit

# React 18/19, Vite SPA, SSR/static, and hydration evidence
pnpm test:compatibility

# Builds once, then starts a fresh in-memory API for each engine project
pnpm test:e2e

# Complete repository gate
pnpm check
```

Any new authoring panel must be exposed in the expanded-state axe test. Any new supported React major/framework receives an isolated install/build/render/preview fixture before the matrix changes. Any Playwright/Vite/React upgrade refreshes exact versions and reruns the full matrix; failures are defects, not documentation exceptions.
