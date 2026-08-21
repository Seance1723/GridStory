# Content queries and GraphQL

GridStory exposes one bounded query contract through REST, GraphQL, and the framework-neutral client. Every query is evaluated inside the complete organization, tenant, workspace, site, environment, and locale scope from the request context. Draft and published perspectives never share a cursor or cache policy.

## Query contract

A content query accepts:

- `contentType`: optional content-type restriction.
- `perspective`: `draft` or `published`; public delivery always forces `published`.
- `filter`: predicates or nested `and`, `or`, and `not` groups.
- `sort`: up to five ordered path rules with `asc`/`desc` direction and `first`/`last` null placement.
- `first`: 1 to 100 records; defaults to 20.
- `after`: an opaque signed continuation cursor.
- `projection`: up to 50 `data.*` paths. Scope, identity, status, and revision metadata remain present.

Predicate operators are `eq`, `ne`, `in`, `notIn`, `contains`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, and `exists`. Paths may select safe system fields such as `id`, `status`, `createdAt`, and `updatedAt`, or nested content values such as `data.seo.title`. Prototype-related path segments are rejected.

```json
{
  "contentType": "page",
  "filter": {
    "and": [
      { "path": "data.title", "operator": "contains", "value": "react" },
      { "path": "status", "operator": "in", "value": ["draft", "changed"] }
    ]
  },
  "sort": [
    { "path": "data.title", "direction": "asc", "nulls": "last" }
  ],
  "projection": ["data.title", "data.slug"],
  "first": 25
}
```

Sorting always receives an immutable ID tie-breaker. A cursor is signed with `GRIDSTORY_CURSOR_SECRET` and bound to the complete filter, perspective, sort, and projection. Tampering or reusing it with another query returns `invalid_query`. Replace the local default secret with a long random value in every shared environment; changing it intentionally invalidates outstanding cursors.

## REST

Management queries support `GET` and `POST /api/v1/content/query`. The GET form accepts `filter` and JSON-array `sort` as JSON strings, compact sort rules such as `data.title:asc:last,updatedAt:desc:last`, and comma-separated projection paths. POST is preferred for complex queries.

Published delivery supports `GET` and `POST /api/v1/delivery/query` and always ignores any requested draft perspective. Management uses `Cache-Control: private, no-store`; REST delivery uses the same public CDN policy as other published endpoints.

The response follows the connection shape:

```json
{
  "edges": [{ "cursor": "opaque", "node": {} }],
  "nodes": [],
  "pageInfo": {
    "startCursor": "opaque",
    "endCursor": "opaque",
    "hasNextPage": true,
    "hasPreviousPage": false
  },
  "totalCount": 42
}
```

The client exposes `queryContent(query, signal)` and `queryPublishedContent(query, signal)` with the same TypeScript contract.

## GraphQL

`POST /graphql` exposes management and delivery operations:

- Queries: `content`, `contents`, `publishedContent`, `publishedContents`, `schemas`, `components`, `schemaLifecycle`, and `schemaDrift`.
- Mutations: `createContent`, `updateDraft`, `publishContent`, `planSchema`, and `deploySchema`.

```graphql
query PublishedPages($after: String) {
  publishedContents(
    query: {
      contentType: "page"
      filter: { path: "data.title", operator: contains, value: "react" }
      sort: [{ path: "updatedAt", direction: desc }]
      first: 20
      after: $after
      projection: ["data.title", "data.slug"]
    }
  ) {
    nodes { id status data }
    pageInfo { endCursor hasNextPage }
    totalCount
  }
}
```

Every resolver applies the same RBAC/ABAC policy as REST. Anonymous and delivery principals can call only published operations; authoring and schema mutations require their specific actions. GraphQL responses are always private/no-store because one document can mix management and delivery selections. Query depth is limited to 12, a document may contain at most 50 aliases and 500 field selections, batching and subscriptions are disabled, and page/filter/sort/projection bounds are enforced by the shared engine. The 1 MiB ordinary-body limit also applies. Production introspection exposure and distributed request/concurrency policy remain deployment decisions.

## Execution model and limits

M2-006 prioritizes identical, testable semantics across SQLite and PostgreSQL. The adapter-neutral engine currently obtains the fully scoped perspective set from the repository before applying filters and projections. This is correct for the documented request bounds and the 250-entry M5-007 reference profile. Collections materially beyond that dataset require deployment benchmarks and adapter-level predicate/cursor pushdown before support can be claimed. The exact limits, budgets, and production claim boundary are in [Release evidence, tested limits, and support](release-and-support.md).
