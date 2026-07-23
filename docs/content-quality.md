# Content quality and publish gates

GridStory evaluates content quality in the framework-neutral control plane. Reports are scope-bound to organization, tenant, workspace, site, environment, and locale; they are returned only by private management endpoints and are never stored in published delivery caches.

## Policy model

`ContentQualityPolicy` is a declarative, JSON-serializable contract. A policy selects one content type, one or more channels, and optionally a locale allow-list. It configures SEO, accessibility, link integrity, editorial rules, and the gate:

```ts
const policy = {
  id: 'page-web-v1',
  contentType: 'page',
  channels: ['web'],
  locales: ['en'],
  seo: {
    titleField: 'title',
    descriptionField: 'seoDescription',
    titleMinLength: 15,
    titleMaxLength: 60,
    requireCanonicalRoute: true,
  },
  accessibility: {
    requireImageAlt: true,
    rejectGenericLinkText: true,
    enforceHeadingOrder: true,
    requireTableHeader: true,
  },
  links: { requirePublishedReferences: true, checkExternal: true },
  content: {
    minWords: 100,
    maxReadingGrade: 9,
    requiredPhrases: ['accessibility statement'],
    prohibitedPhrases: ['click here'],
  },
  gate: { blockedSeverities: ['error'], minimumScore: 70 },
  bypassRoles: ['quality-admin'],
};
```

Policies are supplied through `buildServer({ qualityPolicies })`. The first policy matching content type, channel, and locale is used. No matching policy produces a passing, empty report so installations can adopt gates incrementally.

## Findings and scoring

Every finding has a stable ID, category, code, severity, responsible data path, plain-language message, remediation, and score deduction. The built-in evaluator covers:

- SEO title and description ranges, canonical route generation, and optional HTTPS canonical fields.
- Missing or poor image alt text, skipped heading levels, generic link purpose, and tables without express header semantics.
- Draft references or embeds whose targets are not published in the exact active scope, plus optional external-link results.
- Minimum word count, estimated reading grade, required phrases, and prohibited phrases.

The score begins at 100 and clamps at zero after configured rule deductions. A report passes when it meets the minimum score and has no finding in a blocked severity. A configured bypass role can bypass the quality gate but never bypasses ordinary publish authorization.

The rich-text v1 table contract does not encode header cells, so policies that require headers produce an explainable warning directing authors to a semantic component or a future header-aware model. Contrast, captions, and landmark checks that depend on final application rendering belong in application-owned browser audit adapters; structured content checks remain deterministic in the control plane.

## Link adapters

Remote checks are dependency-injected through `externalLinkChecker`. GridStory never performs hidden network requests during publication. When `checkExternal` is enabled without an adapter, external links receive an informational `external_link_unchecked` finding; an adapter can return stable success, HTTP status, and safe diagnostic text. Internal content references are checked directly against the scoped published repository perspective.

## API and client

- `GET /api/v1/content/:id/quality?channel=web` assesses the saved draft and requires content-read permission.
- `POST /api/v1/content/:id/quality?channel=web` assesses `{ "data": ... }` without saving and requires draft-update permission.
- `POST /api/v1/content/:id/publish` runs the same gate immediately before repository publication. Failure returns 422 `publish_quality_gate_failed` with the complete report in `error.details.report` and leaves the published perspective unchanged.

The universal client exposes `getContentQuality` and `assessContentQuality`. Studio uses candidate assessment so unsaved work can be checked, shows score and severity counts, and links each finding to its field/block path. Editing invalidates the visible report; authors can re-run checks before publication, and a blocked publish restores the server’s authoritative report.

## Cache and security boundaries

Quality endpoints inherit `private, no-store`. Reports can describe draft data and therefore must not be included in delivery responses, public cache tags, outbox payloads, or preview URLs. Repository lookups always include the complete content scope, and reference checks request only the `published` perspective so a draft target cannot satisfy a public link gate.