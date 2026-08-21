# Search, taxonomies, backlinks, and related content

GridStory exposes search as a framework-neutral control-plane capability. Content remains authoritative in the configured repository; a `SearchAdapter` can project scoped draft and published revisions into any external engine without coupling the content service to that provider.

The published search envelope accepts at most 500 query characters, 50 content types, and 100 requested results while the built-in adapter returns at most 50. Index extraction traverses at most 12 levels and retains at most 5,000 scalar strings/100,000 characters per entry. These values are centralized in `resourceLimits`; larger production collections require an injected adapter plus deployment benchmarks. See [Release evidence, tested limits, and support](release-and-support.md).

## Contracts and default adapter

The canonical query supports bounded text, perspective, content-type, taxonomy-term, and result-count inputs. Responses include exact content entries, deterministic scores, short matched-term highlights, taxonomy facets, and a total. The bundled `repository-scan` adapter is a correct zero-configuration fallback for development and small installations. It scans only the requested organization, tenant, workspace, site, environment, and locale and resolves the requested perspective. Production deployments can inject a shared adapter into both API and worker processes.

An adapter implements `search`, `upsert`, `rebuild`, and `status`. Indexed documents contain explicit full scope, entry/content type, perspective, exact revision ID, update time, flattened searchable text, and canonical taxonomy term IDs. Adapter implementations must treat that scope plus perspective as part of every key and query.

Search adapters are untrusted tenant boundaries. Every search result and status response echoes the complete requested scope, and results also echo perspective. GridStory rejects mismatches, reloads every hit through scoped authoritative storage, and scope-checks the returned entry. Adapter-provided totals and facets are not exposed: the response total and taxonomy facets are derived only from accepted scoped hits and code-owned taxonomy definitions. Backlink, related-content, rebuild, index, and status repository reads use the same fail-closed record checks.

## Taxonomies

Taxonomies are declared on a content schema and referenced by taxonomy fields. Definitions have stable IDs, display names, optional hierarchy, and stable term IDs/slugs/labels. Parent IDs must resolve inside the same taxonomy and cycles are rejected by schema validation. The example page schema exposes a hierarchical `topics` taxonomy and an optional multi-value `topics` field.

Search filters match canonical term IDs. Facets report counts after text and content-type filtering and before the selected taxonomy filter is applied, making them useful for narrowing a result set. The management API returns the same definitions through `GET /api/v1/taxonomies`.

## Durable indexing and rebuilds

Every committed content outbox event expands into a `search.index` job in addition to cache invalidation and matching webhooks. Jobs contain identifiers and event metadata only; draft content and preview credentials never enter queue payloads. The worker reloads the exact scoped revision from the repository before handing a document to the adapter. A publish event indexes both draft and published perspectives, while create/update events index draft only.

`POST /api/v1/search/index/rebuild` enqueues a scoped `search.rebuild` job and returns `202`. Rebuilds and incremental updates reuse the existing leased queue, capped exponential retries, maximum attempts, dead letters, and immutable replay records. `GET /api/v1/search/index/status` combines adapter status and document counts with bounded pending/dead search-job counts. The API and worker must use the same external adapter configuration; the default repository adapter remains correct across separate processes because reads always come from shared content storage.

## Backlinks and related content

`GET /api/v1/content/:id/backlinks` traverses only schema-declared relation fields and reports the source entry plus exact data paths that reference the target. `GET /api/v1/content/:id/related` uses a deterministic bounded score: direct outgoing and incoming links weigh four points, each shared taxonomy term weighs two, and matching content type weighs one. Stable ID ordering breaks ties. These results are explainable suggestions, not editorially persisted relationships.

## API and client

- `POST /api/v1/search`
- `GET /api/v1/taxonomies`
- `GET /api/v1/search/index/status`
- `POST /api/v1/search/index/rebuild`
- `GET /api/v1/content/:id/backlinks?perspective=draft|published`
- `GET /api/v1/content/:id/related?perspective=draft|published&limit=10`

The universal client exposes `search`, `listTaxonomies`, `getSearchIndexStatus`, `rebuildSearchIndex`, `listBacklinks`, and `listRelatedContent`. Studio’s Search panel uses draft perspective, displays index health and discovery context, and can run a durable rebuild.

All routes are authorized management surfaces with `Cache-Control: private, no-store`. Viewers can search and inspect discovery metadata; only search managers can request rebuilds. Tenant scope is explicit in repository reads, adapter documents, jobs, status, and authorization. Published searches resolve only exact published revisions, and draft material is never admitted to public delivery caches.
