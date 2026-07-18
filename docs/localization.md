# Localization and translation lifecycle

GridStory treats locale as a mandatory storage and authorization dimension while linking locale-specific entries through a stable translation group. Each variant has its own immutable revisions, draft/published pointer, slug, and route. This keeps publication independent per locale without losing the relationship between translations.

## Configure locales

Set `GRIDSTORY_LOCALES_JSON` to an array of site-local configurations or pass `locales` to `buildServer`:

```json
[
  {
    "code": "en",
    "siteId": "default",
    "label": "English",
    "default": true,
    "enabled": true,
    "required": true,
    "routePrefix": ""
  },
  {
    "code": "fr",
    "siteId": "default",
    "label": "French",
    "default": false,
    "enabled": true,
    "required": true,
    "fallbackLocales": ["en"],
    "routePrefix": "/fr"
  }
]
```

Every site must have exactly one enabled default. Locale codes use BCP 47-style syntax. Fallbacks are ordered, must reference enabled locales on the same site, and cannot contain self-references or cycles. The default locale is appended to every resolution chain when it is not already reachable. `fallbackLocale` remains accepted as a single-fallback compatibility form.

`required: false` keeps a locale in authoring and fallback resolution but excludes it from the overall completeness denominator and all-required-locales publication indicator.

## Declare localized fields

Localization is part of the canonical schema IR and therefore participates in diff, migration approval, version advancement, drift, and visual-model round trips:

```ts
{
  id: 'article',
  version: 2,
  localization: {
    localizedFields: ['title', 'slug', 'body']
  }
}
```

Unknown or duplicate field names are rejected. Changing the declaration is classified as backfill work and requires a schema version advancement. A translation stores locale-specific values for these fields. Non-localized fields are copied from the source during translation creation and resolved from the default published variant, preventing translated copies from becoming an alternate source of truth.

## Authoring and completeness

Use these management operations:

- `GET /api/v1/locales`
- `GET /api/v1/content/:id/translations`
- `POST /api/v1/content/:id/translations` with `{ "locale": "fr", "data": { ... } }`
- GraphQL `locales`, `translationCompleteness(id:)`, and `createTranslation(sourceId:, locale:, data:)`

Completeness reports the stable translation group, localized field list, required locales, missing fields, field coverage, locale-specific `missing`/`draft`/`changed`/`published` status, localized route, overall percentage, and whether every required locale has its current draft published. Publishing one locale never silently publishes another.

The universal client exposes `listLocales`, `getTranslationCompleteness`, and `createTranslation`.

## Published resolution and routes

`GET /api/v1/delivery/localized/:translationGroupId` resolves the requested `x-gridstory-locale` through its ordered published fallback chain. Its response explicitly includes `requestedLocale`, `resolvedLocale`, `fallbackChain`, and `usedFallback`, so applications can show a language notice instead of silently pretending a fallback is translated.

`GET /api/v1/delivery/localized-routes/*` resolves locale-prefixed published paths. A request for `/fr/articles/hello` may use the English published variant when French is missing, while retaining the requested `/fr` route space. GraphQL `localizedContent` offers the same group resolution and accepts an explicit locale. The client exposes `getLocalizedContent` and `getLocalizedRoute`.

Localized REST delivery receives the public CDN cache policy and a `Vary` header covering every organization/tenant/workspace/site/environment/locale selector. Deployments must preserve that header and use a CDN that honors it. GraphQL remains private/no-store because one document can mix management and delivery fields.

## Storage and migration

SQLite and PostgreSQL persist translation links with a unique full-scope, locale, and group constraint. Existing entries are idempotently backfilled as their own source translation group during repository initialization. Variant listing never drops organization, tenant, workspace, site, or environment isolation.
