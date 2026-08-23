# CMS migration and cutover

GridStory can read Contentful, Sanity, or WordPress into a separate GridStory scope through versioned mappings, reviewed sync plans, restart-safe target writes, and a content-current cutover report. This is a guarded source bridge, not a generic ETL engine or traffic manager: sources are read-only, credentials stay on the server, source deletions never automatically delete targets, and a ready report changes no DNS, CDN, route, or source state.

## Capability and limits

| Provider | Maintained read shape | Repeat behavior | Normalized source types |
|---|---|---|---|
| Contentful | CDA Sync API initial pages and opaque next-sync token | Documented delta, including entry/asset tombstones | `contentful.Entry.<content-type>`, `contentful.Asset`, `contentful.DeletedEntry`, `contentful.DeletedAsset` |
| Sanity | Authenticated dataset NDJSON export; drafts excluded unless explicitly enabled | Complete snapshot reconciliation | `sanity.<_type>` |
| WordPress | REST `posts`, `pages`, and optionally `media`, 100 records/page with `X-WP-TotalPages` | Complete snapshot reconciliation | `wordpress.post`, `wordpress.page`, `wordpress.media` |

One read is limited to 1,000 normalized records and 8 MiB per provider response. A recipe has at most 100 field mappings; a scope has at most 50 configured sources, 100 recipes, and 50 projects. Only 20 plans and 100 runs are retained in the bounded operational document, and a plan expires after one hour. Split larger sources into separately configured, reviewed projects rather than raising limits without capacity and rollback evidence.

Not included: source writes or credential administration; arbitrary JavaScript, Liquid, or GROQ transforms; automatic source-schema inference/deployment; binary media download/transfer; source revisions, comments, or users; destructive deletion/unpublish propagation; unattended scheduling; GridStory release approval; traffic switching; or source decommissioning.

## Trusted server setup

Migration sources are constructor-injected into `buildServer`; there is deliberately no browser/Vite variable or universal credential JSON. Obtain provider read-only credentials, store them in the deployment secret manager, and compose adapters inside the trusted API runtime. The following illustrates the application composition seam; do not commit the shown secret lookups or print adapter options:

```ts
import { buildServer } from './server.js';
import {
  ContentfulMigrationSourceAdapter,
  SanityMigrationSourceAdapter,
  WordPressMigrationSourceAdapter,
} from './migration-adapters.js';

const sources = [
  new ContentfulMigrationSourceAdapter({
    id: 'contentful-production',
    name: 'Contentful production',
    spaceId: secret('CONTENTFUL_SPACE_ID'),
    environmentId: 'master',
    accessToken: secret('CONTENTFUL_READ_TOKEN'),
  }),
  new SanityMigrationSourceAdapter({
    id: 'sanity-production',
    name: 'Sanity production',
    projectId: secret('SANITY_PROJECT_ID'),
    dataset: 'production',
    token: secret('SANITY_READ_TOKEN'),
  }),
  new WordPressMigrationSourceAdapter({
    id: 'wordpress-production',
    name: 'WordPress production',
    baseUrl: 'https://cms.example.com/',
    authorizationHeader: secret('WORDPRESS_READ_AUTHORIZATION'),
    collections: ['posts', 'pages'],
    context: 'view',
  }),
];

const server = await buildServer({
  databasePath: '.gridstory/migration-shadow.db',
  migration: { sources },
});
```

Configured base URLs must be credential-free HTTPS without a query or fragment. Adapters disable redirects and reject continuation or response URLs on another origin. Use a network egress allow-list, provider rate/timeout controls, audited secret access, and a rehearsed revocation process in production. Adapter descriptors returned to Studio contain capability flags, never tokens, authorization headers, base URLs, or checkpoints.

Sanity defaults to published documents by excluding `drafts.` IDs. Set `includeDrafts: true` only for a reviewed draft migration. WordPress `context: 'view'` needs no privileged edit context but treats returned records as published; use a least-privilege authenticated `edit` context only when draft status is required. Exclude `media` until a separate binary/object migration and reference-remapping plan exists; the built-in migration reports media as unsupported rather than downloading URLs.

## Versioned mapping recipes

A recipe matches one exact normalized `sourceType` and one deployed GridStory `targetContentType`. Field source paths walk JSON object keys separated by dots; arrays are copied as a whole, not traversed by index. Target fields must be unique, and prototype paths are rejected. Available deterministic transforms are:

- `copy`: structured JSON copy;
- `string`: string/number/boolean to string;
- `number`: a finite number or numeric string;
- `boolean`: `true`, `false`, `1`, `0`, or the strings `"true"`/`"false"`;
- `slug`: Unicode-normalized lowercase ASCII words separated by `-`, capped at 200 characters.

Mark a mapping `required: true` when absence must block the record. Every save creates the next recipe version; an already-reviewed plan cannot execute after its recipe changes. Representative paths are:

| Provider source type | Example source paths |
|---|---|
| `contentful.Entry.page` | `fields.title`, `fields.slug`, `fields.summary` |
| `sanity.page` | `title`, `slug.current`, `summary` |
| `wordpress.page` | `title.rendered`, `slug`, `excerpt.rendered` |

For example:

```http
PUT /api/v1/migrations/recipes/contentful-page
Content-Type: application/json

{
  "name": "Contentful page",
  "provider": "contentful",
  "sourceType": "contentful.Entry.page",
  "targetContentType": "page",
  "publicationMode": "draft",
  "fields": [
    { "sourcePath": "fields.title", "targetField": "title", "transform": "string", "required": true },
    { "sourcePath": "fields.slug", "targetField": "slug", "transform": "slug", "required": true }
  ]
}
```

`publicationMode: "draft"` imports drafts and leaves publication to the normal editorial workflow. `"mirror-source"` may publish a source-published record only after every normal GridStory schema, reference, route, workflow, quality, governance, optimistic-revision, and publish gate passes. It is not a bypass.

## Operator workflow

All `/api/v1/migrations` operations are private/no-store and use complete organization, tenant, workspace, site, environment, and locale scope. Migration read, manage, and execute permissions are distinct. The typed client exposes the same operations, and Studio's **Migrations** workbench supports this sequence:

1. Create and verify the database plus provider/object/application-configuration backups described below. Use a separate shadow environment and keep source traffic authoritative.
2. Save mappings for every supported source type. Intentionally leave media or unsupported records unmapped so the plan displays them as blockers.
3. Create a `dual-run` project that pins the source and current recipe versions:

   ```json
   {
     "id": "contentful-cutover",
     "name": "Website cutover",
     "sourceId": "contentful-production",
     "recipeIds": ["contentful-page"],
     "mode": "dual-run"
   }
   ```

4. Preview the first sync. A complete snapshot yields exact `create`, `update`, `publish`, `noop`, `source-deleted`, and `blocked` effects plus a SHA-256 digest. It performs no content writes.
5. Review every external ID, deterministic target ID, expected target revision, publication effect, blocker, count, expiry, and exact digest. Confirm the digest before execute.
6. Execute. The service writes a pending source link before each target mutation, uses `ContentService`, finalizes the link/receipt, and advances the checkpoint only after the complete plan succeeds. A retry recovers only a checksum-identical partial target and returns an existing successful receipt instead of duplicating content.
7. Continue editing only at the source during dual run. Repeat preview/review/execute. Contentful reads its opaque delta; Sanity and WordPress perform full reconciliation. A manual GridStory target edit blocks the next source update as `target-drift` rather than overwriting it.
8. Pause a project to prevent new plans while investigating. Resuming does not revive an expired/stale plan; create and review a new plan.
9. Run **Validate cutover**. Validation always reads a complete full source snapshot, recomputes mappings and source/target checksums, checks every link and required publication, and persists a digest-bound report.

The API routes are:

| Operation | Route |
|---|---|
| Overview | `GET /api/v1/migrations` |
| Save next recipe version | `PUT /api/v1/migrations/recipes/:id` |
| Create project | `POST /api/v1/migrations/projects` |
| Pause/resume | `POST /api/v1/migrations/projects/:id/state` |
| Create dry-run plan | `POST /api/v1/migrations/projects/:id/plans` |
| Execute exact digest | `POST /api/v1/migrations/plans/:id/execute` |
| Validate full cutover state | `POST /api/v1/migrations/projects/:id/cutover-reports` |

## Blockers and reconciliation policy

| Blocker/effect | Meaning and action |
|---|---|
| `unmapped-source-type` | Add an intentional recipe or explicitly exclude the record outside this project. |
| `unsupported-media` | M6-004 will not fetch binary media. Complete a separate object/reference migration. |
| `missing-required-field`, `invalid-transform`, `invalid-target-content` | Correct source data, mapping, or target schema; create a new plan. |
| `target-drift` | Someone changed the GridStory draft since the last applied link. Reconcile editorial ownership manually; never force the stale plan. |
| `target-missing`, `target-unpublished` | A linked target is absent or a source-published record is not currently published. Recreate/review through normal content workflow. |
| `source-deleted` | The source reports a deletion or full reconciliation no longer sees a prior ID. GridStory preserves the target and blocks execution/cutover pending governance/editorial review. |
| `source-drift`, `project-changed`, `recipe-changed` | Reviewed evidence is stale. Discard it and create a new plan. |
| `incomplete-snapshot` | The provider result cannot support safe reconciliation. Investigate the adapter/provider and do not execute or cut over. |

Missing source records found during a complete reconciliation are represented as deletions. GridStory never automatically deletes, unpublishes, or rewrites the source. If retention policy later authorizes a target deletion, use the separately guarded data-governance workflow with its own hold, approval, backup, and receipt requirements.

## Cutover checklist and claim boundary

A `ready: true` report proves only that, at its validation time, every active normalized record covered by the selected recipes had a current checksum-identical target and every source-published record had a current GridStory publication. Before any external traffic decision, an accountable operator must separately verify:

- the exact source checkpoint/report digest and no later source writes;
- mapped counts, representative content, locales, references, rich text, routes, redirects, and canonical URLs;
- all binary assets/renditions, object permissions, cache behavior, CSP, and application rendering;
- SEO metadata, sitemaps, robots rules, analytics/consent, forms/integrations, identity, search, and webhooks;
- database plus provider/object/config backup integrity and an isolated restore drill;
- monitoring, performance/capacity, error budgets, stakeholder acceptance, legal/compliance approvals, and rollback ownership;
- a separately reviewed DNS/CDN/router/application switch with a short rollback observation window.

Do not decommission or mutate the source merely because a GridStory report is ready. Keep the source, credentials, backups, and previous traffic route available until the external acceptance and rollback window close.

## Backup, abort, and rollback

Before the first production-shadow run:

```bash
pnpm database:backup -- --output <artifact>
pnpm database:verify -- --backup <artifact>
```

Coordinate binary object, source export, provider configuration, application configuration, secret-reference, and infrastructure backups that the GridStory database does not contain. Record immutable references and checksums in the change ticket.

To abort before cutover, pause the project and leave source traffic unchanged. A code rollback is `git revert <M6-004-commit>` followed by the normal deployment preflight. It removes the importer but does not undo already-created target revisions.

For data rollback, prefer a separately reviewed revision operation when only a few target entries changed. For a complete point-in-time rollback, restore the verified database into an absent/empty isolated target:

```bash
# SQLite
pnpm database:restore -- --backup <artifact> --target <absent-path>

# PostgreSQL: GRIDSTORY_RECOVERY_TARGET_DATABASE_URL names an empty isolated database
pnpm database:restore -- --backup <artifact> --confirm-target <database>
```

Then verify database integrity, readiness, audit/governance/migration state, representative drafts/publications, jobs, objects, and application behavior before a separately approved traffic change. Never restore over the live target, improvise an in-place database downgrade, bulk-delete migrated entries, or write back to the source.

Architecture and safety reasoning are recorded in [ADR 0015](adr/0015-guarded-cms-migration.md). The provider behavior follows the official [Contentful Sync API](https://www.contentful.com/developers/docs/concepts/sync/), [Sanity export HTTP reference](https://www.sanity.io/docs/http-reference/export), [WordPress REST pagination](https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/), and [WordPress posts REST reference](https://developer.wordpress.org/rest-api/reference/posts/).
