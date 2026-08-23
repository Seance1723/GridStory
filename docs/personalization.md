# Consent-aware personalization and targeting

GridStory M7-001 provides a deterministic content-variant decision boundary. It stores scoped targeting configuration, not customer profiles. Applications collect and normalize permitted inputs, determine the applicable consent state, call the decision endpoint, and render the returned variant.

## Model and lifecycle

One document exists per complete organization, tenant, workspace, site, environment, and locale scope. Its draft and published revisions are separate:

1. An authorized editor reads `GET /api/v1/personalization` and edits the draft configuration.
2. `PUT /api/v1/personalization/draft` replaces the complete configuration only when `expectedVersion` is current.
3. `POST /api/v1/personalization/preview` evaluates hypothetical inputs against the draft and always returns `no-store` guidance.
4. `POST /api/v1/personalization/publish` copies the exact expected draft revision into the published snapshot.
5. Anonymous applications call `POST /api/v1/personalization/decide`; it evaluates only the published snapshot.

Draft updates never change an existing published decision. Management and decision HTTP responses are `private, no-store`; application-owned edge code may cache a decision only when its returned guidance says `shared` and only under the complete returned key.

## Configuration

A configuration contains:

- consent purposes with a plain-language description and explicit `honorGlobalPrivacyControl` behavior;
- typed attributes sourced from locale, market, device class, referral category, campaign, authentication state, or an application;
- reusable audiences made of AND conditions with unique priorities;
- resource decisions with declared variants, audience-to-variant rules, and a required fallback.

Attributes are boolean or finite enums. Personal attributes require at least one declared purpose and are always private-cache only. Authentication state is also private-cache only. Unknown context keys, unknown consent purposes, mistyped values, dangling references, duplicate priorities, and undeclared variants fail closed.

```json
{
  "purposes": [
    {
      "id": "personalization",
      "name": "Personalized content",
      "description": "Use a declared preference to select site content.",
      "honorGlobalPrivacyControl": true
    }
  ],
  "attributes": [
    {
      "key": "market",
      "name": "Market",
      "source": "market",
      "valueType": "enum",
      "allowedValues": ["uk", "us"],
      "classification": "public",
      "requiredPurposes": [],
      "cacheability": "shared"
    },
    {
      "key": "affinity",
      "name": "Declared affinity",
      "source": "application",
      "valueType": "enum",
      "allowedValues": ["travel", "technology"],
      "classification": "personal",
      "requiredPurposes": ["personalization"],
      "cacheability": "private"
    }
  ],
  "audiences": [
    {
      "id": "travel-readers",
      "name": "Travel readers",
      "description": "Readers with a declared travel preference.",
      "priority": 10,
      "conditions": [
        { "attributeKey": "affinity", "operator": "equals", "value": "travel" }
      ]
    }
  ],
  "decisions": [
    {
      "resourceKey": "homepage-hero",
      "name": "Homepage hero",
      "variants": ["default", "travel"],
      "rules": [{ "audienceId": "travel-readers", "variant": "travel" }],
      "fallbackVariant": "default"
    }
  ]
}
```

Rules are evaluated by audience priority; the first match wins. The ordinary targeting call remains deterministic and has no percentage allocation or sticky subject identifier. M7-002 experiments are an explicit, separately consented application call documented in [Governed content experiments](experiments.md); they do not change this baseline endpoint.

## Decision call

The universal client exposes the same contract in browsers, servers, and React Server Component backends:

```ts
const result = await client.decidePersonalization({
  resourceKey: 'homepage-hero',
  attributes: { market: 'uk', affinity: 'travel' },
  consent: {
    grantedPurposes: ['personalization'],
    deniedPurposes: [],
    globalPrivacyControl: false,
  },
});

const component = variants[result.variant] ?? variants.default;
```

If `Sec-GPC: 1` is present, the API sets `globalPrivacyControl` to true even if the JSON body says false. GPC suppresses only configured purposes whose `honorGlobalPrivacyControl` is true. GridStory does not interpret jurisdiction, lawful basis, or every possible first-party use; the customer owns notices, consent collection, purpose definitions, and legal review.

## Preview without impersonation

Studio sends an ordinary hypothetical context to the draft preview route. An optional `override` can name a declared audience or variant for visual QA. The response contains audience IDs, boolean condition outcomes, and reason codes, never raw evaluated values. The anonymous published decision returns the variant without internal audience identity. Preview does not search a directory, load a customer profile, persist inputs, set an assignment cookie, alter the published snapshot, or prime a delivery cache.

Do not paste names, email addresses, account identifiers, IP addresses, user-agent strings, cookies, raw referral URLs, or other free-form identifying values into Studio or the API. Use a reviewed application adapter to map source data to declared finite values before calling GridStory.

## Cache guidance

The decision result has `cache.mode`, `cache.inputs`, `cache.reason`, `cache.tag`, and sometimes `cache.key`:

- `shared`: every possible decision input is bounded, public, consent-independent, and explicitly shared-cache eligible. Use the exact complete key; it binds SHA-256 digests of tenant scope/locale and the canonical full decision-input set (including missing-value markers) together with published revision and resource.
- `private`: any possible decision input is personal, consent-dependent, authentication state, or private-cache only. Do not put the decision or rendered personalized response into a shared cache.
- `no-store`: used for draft preview and unavailable/invalid operations. Store nothing.

The API's POST response remains `private, no-store` in every case. `shared` is guidance for trusted application-owned edge code building its own cache entry. Never shorten the key, omit scope/revision/input segments, reuse a preview key, cache `Set-Cookie` responses, or copy a private result into a published content cache. A newly published revision changes the tag and key namespace.

## Operations, rollback, and recovery

SQLite and PostgreSQL persist the same optimistic scoped document. Native backup/restore includes targeting documents and governed experiment history; recovery tests restore the exact draft, published snapshot, and running experiment state. Application traffic remains application-owned, so deployments should validate representative decisions before switching consumers to a new published revision.

To roll back a bad configuration, restore the prior configuration into a new draft, preview it, and publish that new revision. Do not rewrite history or decrement revision numbers. To roll back the code feature, stop application calls first, render application fallbacks, then revert the M7-001 commit. A code revert does not undo application caches; purge old targeting tags/keys at the edge according to the application/CDN runbook.

External CDPs may later map segments into this bounded input contract, but GridStory does not yet hold CDP credentials, fetch customer profiles, ingest behavioral events, or certify an external provider's privacy/cache behavior.
