# ADR 0008: Evidence-bounded accessibility and compatibility certification

- Status: Accepted
- Date: 2026-08-21
- Task: M5-006

## Context

GridStory is both a web authoring tool and a React integration surface. The repository already has semantic controls, keyboard composition operations, content-quality checks, SSR/hydration tests, a React 18.3-to-19 peer range, a Vite example, and one Chromium-family walkthrough. Those checks do not establish rendered WCAG coverage, the declared React range, cross-engine behavior, or an honest public boundary between shipped and planned adapters.

W3C WCAG evaluation requires automated and human evaluation. ATAG 2.0 has two distinct concerns: Part A makes the authoring tool accessible to authors, and Part B helps authors produce accessible content. Playwright recommends `@axe-core/playwright` for detectable rendered issues while warning that automation is incomplete, and supports isolated projects for Chromium, Firefox, and WebKit. Vite 8 publishes a fixed Baseline Widely Available production target.

## Prior-art comparison

| Approach | Who does it this way | Fits GridStory? | Cost | What we deliberately skip |
|---|---|---|---|---|
| Semantic lint and unit tests plus axe, focused manual/proxy checks, three Playwright engines, and exact framework fixtures | W3C evaluation guidance, Playwright accessibility/browser guidance, Deque axe rule tags | Yes; extends existing seams and keeps claims tied to executable evidence | One audit dependency, browser downloads, fixtures, and review documentation | No automated-only conformance claim and no adapters that do not exist |
| Chromium-only Lighthouse or axe score presented as certification | Common CI dashboards | No; misses Firefox/WebKit behavior and cannot establish WCAG/ATAG conformance | Low | Rejected because the resulting claim would be misleading |
| Independent expert/user audit across assistive technologies, operating systems, branded browsers, and every roadmap framework | Mature GA programs | Valuable later, but not a repository-only slice and most adapters are not implemented | High recurring program and external coordination | Deferred to readiness/design-partner work after the surfaces exist |
| Do nothing; reuse Biome accessibility lint and current React 19/Edge walkthrough | Current repository | No; static lint cannot inspect runtime names, relationships, contrast, hidden states, or the declared React/browser matrix | Zero | Rejected because M5-006 has explicit acceptance gaps |

## Necessity gate

1. **Traceable:** M5-006 and GA release gates explicitly require accessibility critical journeys and a green compatibility matrix; security requirements also assign browser/rendering review here.
2. **Not already solved:** Biome catches source-level semantics, content-quality checks inspect structured author input, and current Vitest/Playwright tests prove logic plus one engine; none audits rendered states or the complete declared support range.
3. **Minimal form:** certify only the shipping React renderer/client, React 18.3 and 19, Vite 8, Node 22, and Playwright's three engines. Do not build roadmap framework adapters or claim third-party conformance.
4. **Dependency justified:** axe maintains hundreds of WCAG/ACT mappings, DOM algorithms, cross-frame injection, contrast/name computation, and incomplete-result semantics that would exceed 100 locally maintained lines and should not be reimplemented.
5. **Rule of three:** use Playwright's existing project and fixture mechanisms; introduce no generic certification plugin, adapter base class, or policy framework.
6. **Reversible:** remove the audit dependency, projects, fixture, and documentation in one revert; no persisted data or public API shape changes.

## Decision

Adopt an evidence-bounded review: axe runs only official WCAG 2.x A/AA tags including `wcag22aa`, without rule suppression or excluded UI; executable tests cover keyboard bypass/equivalent operations and display adaptations; the full critical journey runs on Playwright-pinned Chromium, Firefox, and WebKit; isolated fixtures prove every declared React major and the current Vite integration. Publish exact versions, commands, gaps, ATAG findings, and application/deployment ownership.

Use the word **certified** only to mean “this exact repository matrix passed its named checks.” Do not call the result third-party certification or claim complete WCAG/ATAG conformance until experienced manual evaluation, live assistive-technology testing, and user evaluation are completed.

## Sources

- <https://www.w3.org/TR/WCAG22/>
- <https://www.w3.org/WAI/standards-guidelines/atag/>
- <https://www.w3.org/WAI/test-evaluate/>
- <https://playwright.dev/docs/accessibility-testing>
- <https://playwright.dev/docs/browsers>
- <https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#axe-core-tags>
- <https://v8.vite.dev/config/build-options#build-target>
- <https://react.dev/versions>

## Consequences

- Compatibility claims fail closed when their executable evidence fails.
- Browser-engine coverage is repeatable in CI, but branded Safari, OS accessibility APIs, and media-codec differences remain outside the claim.
- GridStory can review Studio and its example components; consuming applications remain responsible for their components, routes, semantics, styles, CSP, and deployment headers.
- Future framework adapters receive their own fixtures before appearing as supported.

## CI-002: retain native click actionability without duplicate scrolling

- Accepted: 2026-08-26T19:41:21+05:30 by Codex; T1, BUG-0459, parent investigation CI-001.
- Evidence before correction: an unchanged `CI=1 pnpm test:e2e` run passes Chromium and Firefox 14/14 each, but WebKit's responsive test reaches its existing 300-second deadline and passes retry #1 in 2.2 minutes. Its retained trace's `pw:api@1066` spends 172.16 seconds inside `selectStudioPanel`'s standalone `scrollIntoViewIfNeeded` for Marketplace at 768px; the next normal click succeeds in 571 ms. The eventual timeout is cumulative, not a recorded containment assertion. The exact browser/OS mechanism behind that stall is unproven.
- Decision: remove only the separate scroll call preceding the normal click in the existing panel and Pages selection helpers. [Playwright's scrolling guidance](https://playwright.dev/docs/input#scrolling) and [pointer actionability documentation](https://playwright.dev/docs/input#mouse-click) confirm that native clicks already scroll and check visibility, stability and event reception. Retain those checks, the explicit visibility assertions, mobile drawer settlement, exact selected route/surface checks and all responsive/theme/keyboard assertions.
- Rejected: forced clicks, DOM-dispatched clicks, dropping destinations or widths, increasing deadlines/retries, splitting away coverage, or adding an abstraction/dependency. The fix removes a redundant automation path, not an application feature or a test assertion. Rollback restores the two calls; runtime/styles/API authorization are untouched.
- Verification required: a source-preservation audit, repeated WebKit responsive scenarios without retries, then the complete quality and 42-scenario browser gates, run serially. Keep the original failing artifacts under ignored `test-results/ci002-before`.
- Limit: PR #13's hosted browser failure (BUG-0458) exposes only exit code 1 publicly; its protected failed assertion is unavailable. CI-002 does not claim equivalence to that failure, a green hosted replacement, permission to push/merge, or a broader platform-certification result. CI-001 remains blocked on the specific hosted output.
- Verified result (2026-08-26T19:59:37+05:30, Codex): the source-preservation audit confirms only the two scroll removals and one comment. The unchanged six-width/19-destination responsive sweep passes `--project=webkit --repeat-each=3 --retries=0`, 3/3 in 4.7 minutes (1.5 minutes each). Post-change `pnpm check` passes 626 tests with 17 existing optional skips and all policy/type/build gates; subsequent `CI=1 pnpm test:e2e` passes all 42 scenarios without retries (Chromium 1.8m, Firefox 2.3m, WebKit 3.9m; full WebKit responsive case 2.2m). Normal production bundles are restored, isolated test servers are stopped, and no new manual UI verification is claimed. This resolves the bounded CI-002 helper path, not the unavailable hosted assertion.
