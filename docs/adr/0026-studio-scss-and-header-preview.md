# ADR 0026: Studio styles use ordered Sass modules and preview lives outside the workspace

- Status: Accepted
- Date: 2026-08-25
- Task: STUDIO-015

## Context

The Studio currently renders editing controls and a complete live-preview panel in a three-column workspace. That panel owns its pop-out action, breakpoint/perspective controls, an in-process renderer, and an iframe mode even though the existing standalone session already opens an application-only window, carries scoped draft credentials, synchronizes edits and node selection, and supports explicit revocation.

Studio presentation is also held in one roughly 90KB `studio.css` file. It contains a late shared form layer, but many earlier destination-specific selectors independently assign input/select/textarea borders, padding, radii, surfaces, and text colors. Similar repetition exists for buttons, typography, cards, state treatments, and spacing. The cascade therefore permits semantically identical controls to look different and makes route-wide fixes difficult to place or review.

## Prior-art comparison

| Approach | Fit and cost | Decision / deliberately skipped |
|---|---|---|
| One ordered SCSS entry using purpose-owned underscore partials and Sass `@use` | Preserves the existing global class and token boundary while giving typography, calls to action, forms, cards, feature layouts, shell, themes, responsive rules, and accessibility an explicit source owner. Requires one build-time Sass implementation and careful cascade-order verification. | Proposed. Keep one emitted cascade, preserve intentional order, and move genuinely shared visual contracts to late global partials. |
| Convert every Studio surface to CSS Modules | Strong local isolation, but the current Studio is a large class-based composition and global native-control consistency would still need a shared layer. Conversion would require broad JSX/class-import churn unrelated to the reported defects. | Reject for this slice; revisit alongside a future component decomposition, not as a styling prerequisite. |
| Keep `studio.css` and append more high-specificity overrides | Adds no dependency and is initially fast, but repeats the mechanism already causing drift and leaves responsibility, order, and spacing implicit in a growing monolith. | Reject because it does not address the requested maintainability boundary or the root cause of `BUG-0404` and `BUG-0405`. |
| Adopt a UI/component or Sass framework | Supplies ready-made controls and spacing, but changes markup, behavior, theme vocabulary, bundle/dependency surface, and potentially the published preview. | Reject; preserve GridStory's current UI and runtime boundaries.
| Do nothing | No implementation risk, but retains the inline panel, inconsistent controls, missing gaps, and unreviewable stylesheet ownership. | Reject because it fails the explicit request. |

## Sass implementation comparison

| Option | Fit and cost | Decision |
|---|---|---|
| `sass` (Dart Sass compiled to portable JavaScript) | Works anywhere Node runs, exposes the standard Dart Sass behavior, and is sufficient for one Studio stylesheet. It avoids platform-specific executable packages at the cost of slower compilation than Embedded Sass. | Proposed as the single direct development dependency. |
| `sass-embedded` | Faster compilation through the embedded protocol, but installs a native Dart executable for each supported platform. | Skip because this repository does not have a demonstrated stylesheet-build bottleneck that justifies the extra platform-specific package surface. |
| A Vite Sass plugin | Redundant: Vite already resolves `.scss` when the corresponding preprocessor is installed. | Do not add. |

## Necessity gate

1. **Traceable:** STUDIO-015 is the user's explicit request to remove inline preview, move pop-out to the header, normalize forms and spacing, and create the named SCSS partials. BUG-0404 and BUG-0405 record the visible defects.
2. **Not already solved:** the secure standalone preview session exists, but its launcher and close control are inside the panel being removed. The late shared CSS rules exist, but many feature selectors own competing values and all responsibilities remain in one file.
3. **Minimal form:** retain the existing standalone protocol; expose one header toggle; remove only inline-preview state/markup; add one SCSS compiler, one entry, and responsibility-based partials; consolidate only proven global primitives and gaps. No React design-system rewrite, route work, server work, or published-app styling is included.
4. **Dependencies justified:** SCSS requires a Sass implementation. Vite's built-in preprocessor path needs no plugin, and portable `sass` is the smallest direct development dependency for this repository's scale. No runtime dependency is added.
5. **Rule of three:** text-like controls and selects repeat across more than a dozen destinations, while buttons, typography, cards, and stack spacing repeat throughout all 19 destinations. Those are real repetitions suitable for global partials; one-off feature layouts remain in bounded feature partials rather than new abstractions.
6. **Reversible:** the work is source/build organization and Studio-only composition in one commit. Reverting it restores `studio.css`, the third preview column, and removes Sass; no data migration or external state is involved.

## Decision

Install portable Dart Sass as a development dependency and import one `styles/studio.scss` entry from `main.tsx`. That entry will use forward-slash Sass `@use` statements in explicit cascade order. Required global partials are `_typographic.scss`, `_cta.scss`, `_form.scss`, and `_cards.scss`; additional partials will separate foundation/tokens, management panels, authoring, collaboration/assets, workflow/search, shell/navigation, states/themes, responsive layout, and accessibility. There will be no Sass `@import`, legacy catch-all partial, CSS Modules conversion, mixin framework, or duplicated global primitive layer. The old `studio.css` will be removed after its rules are assigned to an owner.

The Studio workspace will no longer render an inline preview panel or third column. A header-owned icon control will open the existing secure standalone preview and change to an explicit close/revoke action while that session is active. Live draft patches and preview node selection remain on the existing scoped protocol. The popup continues to render application content only, with no Studio shell or authoring controls.

Shared form styles will target text-like inputs, textareas, and native selects beneath the Studio shell, with explicit exclusions/treatments for checkbox, radio, range, color, and file inputs. Global CTA, typography, card, focus, disabled, theme, and spacing contracts remain similarly scoped so published application content is unchanged.

## Consequences and verification

Source ownership and review become explicit, and future global control changes have one canonical home. The initial migration is high-churn and cascade-sensitive, so emitted behavior must be checked through focused computed-style assertions plus every existing destination at desktop, tablet, mobile, dark mode, 200% zoom, and forced colors. Preview tests must prove one popup, no inline panel, no Studio UI in the popup, live edit/selection synchronization, and session revocation from the header.

Revisit CSS Modules only if Studio JSX is later decomposed into independently shipped components; revisit `sass-embedded` only if measured Sass build time becomes material.
