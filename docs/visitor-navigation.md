# Visitor navigation menus

GridStory stores visitor navigation as the reserved `navigation-menu` content type. It deliberately supplies structured, versioned data rather than controlling an application's router, HTML or visual theme.

## Model and identity

A menu has an immutable lowercase kebab-case `key`, an editor-facing `name` and at most 100 ordered items. Item IDs are stable within the menu. An optional `parentId` points to an earlier item, producing a canonical tree no deeper than three levels. Every item has a localized label and exactly one destination:

- an internal reference to routed content in the same complete organization, tenant, workspace, site, environment and locale context; or
- an absolute HTTP(S) URL without embedded username/password credentials.

The entry ID is derived from the stable key. A second menu with the same key in the same exact scope is rejected before persistence. The reserved type cannot be safely bypassed through generic writes: the lifecycle validator applies to create, update, ordinary publication and release future-state assessment.

## Authoring and localization

Use **Navigation > Menus** to create or select a menu, edit its name and links, reorder items, and indent or outdent them within the depth bound. Saving creates an ordinary immutable draft revision. Preview returns a strict private/no-store projection whose internal links resolve against current drafts. Workflow review, independent approval when configured, and publication use the existing content lifecycle.

The default locale variant is required before another locale is created. Locale variants keep the same stable menu key and can translate the menu name, labels and destination choices. Published delivery follows the configured locale fallback chain and reports both requested and resolved locale; it never falls back to a draft.

## Publication, releases and rollback

An internal target must exist, remain routed, and be visible in the lifecycle view being validated. Ordinary publication overlays the menu candidate on current published state. Release assessment overlays every pinned candidate on current published state, so a new page and the menu that links to it can publish atomically in one release.

Rollback uses the existing release pointer restoration for entries that were previously published. As with all current release members, a first publication has no earlier pointer and makes that release non-rollbackable; publish a corrective revision instead. Retirement, unpublish and tombstone behavior remain separate lifecycle work.

## API and application rendering

Authenticated management creates a stable menu with `POST /api/v1/navigation-menus`. Private Studio preview reads `GET /api/v1/navigation-menus/:id/preview`. Anonymous applications read only published data from `GET /api/v1/delivery/navigation-menus/:key` or use `client.getPublishedNavigationMenu(key)`.

The public projection contains the exact scope, stable menu identity, requested/resolved locale, published revision and ordered items with resolved hrefs. It omits draft data, workflow state, revision history and credentials. Cache tags include both the menu and its resolved content targets, so an application/CDN can invalidate dependent navigation when a routed target changes. The official named-menu client explicitly revalidates its credential-free browser read, preventing a previously cached label from winning after publication while the response retains its shared-cache tags and policy.

Applications should render ordinary labelled `nav`, list and anchor elements, then decide how hierarchy behaves at each breakpoint. They may pass internal hrefs to their own router. Missing optional menus should not prevent the page body from rendering. The Vite example demonstrates independent Header and Footer consumption without making GridStory responsible for application layout or CSS.

## Operational and security notes

- Do not put preview credentials into the public menu request; the universal client intentionally uses its credential-omitting public transport.
- Do not treat an external URL as trusted application code. GridStory restricts its scheme and credentials, while the consuming application still owns target-window, referrer and CSP policy.
- Shared caches must partition by the existing complete delivery scope and locale policy and respect the returned dependency tags.
- Menu availability does not prove target uptime, external ownership or accessibility of application-specific interaction. Verify those in the consuming deployment.

The accepted design and exclusions are recorded in [ADR 0034](adr/0034-versioned-visitor-navigation-menus.md).
