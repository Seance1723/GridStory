# ADR 0015: CMS migration uses read-only adapters and guarded reconciliation

- Status: Accepted
- Date: 2026-08-23
- Task: M6-004

## Context

GridStory already has bounded checksummed logical portability for GridStory-to-GridStory moves, complete tenant scope, revisioned content, normal schema/reference/workflow/quality/governance publication gates, native backup/isolated restore, and optimistic SQLite/PostgreSQL documents. It does not understand the records, pagination/checkpoints, deletion signals, or publication semantics of another CMS. A useful migration needs repeatable mapping, restart safety, target-drift protection, and evidence that a shadow target is current without giving the importer source-write or traffic authority.

The provider contracts differ materially. Contentful's Sync API has initial and subsequent opaque tokens plus entry/asset tombstones. Sanity offers an authenticated NDJSON export snapshot, while its cursor documentation warns that dataset changes can make a paged cursor view inconsistent. WordPress REST collections expose bounded pagination and modified filters, but not a trustworthy complete deletion feed. Treating all three as the same inferred delta would hide missing content and make cutover evidence unsafe.

## Prior-art comparison

| Approach | Evidence and fit | Decision |
|---|---|---|
| Use GridStory logical portability | Excellent same-format archive/checksum/import behavior, but it does not normalize provider schemas, source checkpoints, deletion signals, or source-to-target links. | Reuse its bounded/checksum/dry-run/recovery principles, not its archive as a CMS importer. |
| Adopt a general ETL/iPaaS or execute arbitrary mapping code | Broad connectivity and transform power, but adds a runtime, dependency/security surface, ambient credentials, non-determinism, and provider-specific operational state beyond this product slice. | Deferred. M6-004 permits only bounded declarative field transforms. |
| One mutable import script per provider | Quick initially, but cannot prove recipe versions, target drift, idempotent retry, scope isolation, or cutover currency consistently. | Rejected. Providers normalize behind one narrow read-only source contract. |
| Infer deltas from timestamps for every provider | Efficient, but timestamp windows and APIs without deletion feeds cannot prove a complete current set. | Rejected. Only Contentful uses its documented opaque delta; Sanity and WordPress use complete reconciliation. |
| Copy source deletions/unpublishes automatically | Appears synchronized but turns a source mistake, permission gap, or incomplete response into target data loss. | Rejected. Deletions/unpublishes are visible blockers for separate editorial/governance decisions. |
| Read-only provider adapters plus scoped recipes, exact dry-run plans, deterministic links, restart-safe execution, and full cutover validation | Fits existing boundaries, supports three concrete providers, preserves all normal target gates, and can state exactly what was observed. | Selected. |
| Do nothing / keep one-off manual copy | Avoids importer code, but produces no repeatable mapping, drift evidence, durable receipts, scoped retry, or defensible content-current report. | Rejected; it leaves M6-004 and customer cutover risk unresolved. |

## Decision

Define one framework-neutral `MigrationSourceAdapter` with a public redacted descriptor and a bounded `read` method. The Node API maintains Contentful, Sanity, and WordPress adapters. Trusted server composition injects credentials and fetch; browser/client records never receive them. Base URLs must be credential-free HTTPS, redirects are disabled, every continuation/response remains on the configured origin, bodies and record counts are bounded, output is strictly normalized, and no adapter exposes a source mutation.

Contentful uses its initial/delta Sync API and persists only the opaque next sync token. Sanity uses a complete authenticated NDJSON dataset export and excludes drafts by default. WordPress reads selected REST `posts`, `pages`, and `media` collections at at most 100 items per page, verifies `X-WP-TotalPages`, and performs complete reconciliation. Sanity and WordPress snapshot checkpoints are deterministic evidence digests, not claims of provider delta semantics.

Persist one validated optimistic migration document per complete organization, tenant, workspace, site, environment, and locale scope. It contains versioned declarative recipes, projects, deterministic source-to-target links, bounded private plans, run receipts, checkpoints, and cutover reports. In-memory, SQLite, and qualified PostgreSQL repositories share the contract. Management routes use separate migration read/manage/execute authorization and `private, no-store`; mapped plan data and source checkpoints are omitted from client summaries.

Recipes select one normalized source type and target content type, then map explicit object paths with only `copy`, `string`, `number`, `boolean`, or `slug` transforms. Duplicate target fields, prototype paths, unsupported transforms, missing required inputs, and invalid target content fail validation. Every saved edit creates the next immutable recipe version.

A sync begins with a complete snapshot and later uses a trustworthy provider delta or another complete reconciliation. Its dry-run records exact creates, updates, publications, no-ops, source deletions, and blockers; source checksum, expected target revision, project/recipe versions, expiry, and a canonical SHA-256 digest bind the review. Execution requires that exact digest. Before a target write it persists a deterministic pending link; a retry may recover only a checksum-identical partial target. It finalizes the link/receipt and advances the source checkpoint only after every effect succeeds. Completed execution returns the same receipt.

Creates, updates, and requested publications use `ContentService`, retaining schema, reference, route, optimistic-revision, workflow, quality, governance, and publication gates. Manual target drift, recipe/project changes, invalid/incomplete sources, unsupported media, missing mappings, and source deletions fail closed. M6-004 never propagates deletion or unpublish and never downloads media binaries.

Cutover validation always performs a complete source reconciliation. A report is ready only when every mapped active record has an applied link whose source and mapped-data checksums match the current target, and every source-published record is currently published. The report changes no traffic and proves no application, media, route outside mapped schemas, SEO, analytics, identity, infrastructure, legal, backup, or source-decommissioning property.

## Necessity gate

1. **Traceable:** M6-004 explicitly requires major-CMS importers, repeatable mappings, dual-run synchronization, and cutover validation.
2. **Not already solved:** logical portability has the same-format archive and rollback principles but no external provider normalization, checkpoint, deletion, mapping, or link contract.
3. **Minimal form:** three read-only adapters, one declarative mapping model, one scoped optimistic document, one reviewed execution loop, and one content-only report are the smallest runnable vertical slice. Generic ETL, custom code, media transfer, scheduling, and traffic control are excluded.
4. **Dependencies justified:** no dependency was added. Injected platform `fetch` and provider-documented HTTP formats keep provider authentication/retry ownership at the trusted Node edge.
5. **Rule of three:** a shared source interface is justified by immediate maintained Contentful, Sanity, and WordPress implementations; provider-specific parsing/checkpoint behavior remains inside each adapter.
6. **Reversible:** adapters never mutate sources, tables/routes/UI are additive, target writes retain revisions, and production use begins in a backed-up shadow environment. One revert removes the feature; target-data rollback uses the verified database restore or retained revisions while source traffic stays unchanged.

## Sources that changed the decision

- [Contentful Sync API](https://www.contentful.com/developers/docs/concepts/sync/) documents initial versus subsequent synchronization, opaque page/sync tokens, localization behavior, and deleted entry/asset records. That permits a trustworthy Contentful delta and requires tombstone normalization.
- [Sanity export HTTP reference](https://www.sanity.io/docs/http-reference/export) documents authenticated newline-delimited JSON dataset export. A full bounded export is therefore the maintained migration source shape.
- [WordPress REST pagination](https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/) documents `page`, the 100-item `per_page` maximum, and `X-WP-TotalPages`; the adapter follows those headers rather than guessing collection completion.
- [WordPress posts REST reference](https://developer.wordpress.org/rest-api/reference/posts/) documents modified-time filters but no complete deletion stream. WordPress therefore uses full reconciliation, not inferred delta correctness.

## Safety, rollback, and recovery

Before a production run, create a native database backup with `pnpm database:backup -- --output <artifact>`, verify its manifest, coordinate provider/object/application-config backups, and operate only in a separate shadow environment. Review every plan effect and blocker, confirm the exact digest, and keep the source authoritative. Abort by pausing the project and leaving traffic unchanged.

A code rollback is `git revert <M6-004-commit>`. To restore target data, restore the verified database into an absent/empty isolated target using the commands in the recovery runbook or use retained GridStory revisions through a separately reviewed editorial operation. Never improvise an in-place source write, target bulk delete, database downgrade, or DNS change.

## Consequences and revisit triggers

- Declarative mapping is intentionally limited; complex references, localization reshaping, rich text, media binaries, history, users, and comments require reviewed project-specific preprocessing or later narrowly typed transforms.
- Full Sanity/WordPress reconciliation costs more than timestamp polling but is the honest boundary without a reliable deletion delta. Revisit only with documented provider semantics and hostile contract tests.
- Migration runs are operator-triggered; unattended scheduling needs separate lease, authorization, alerting, and failure policy.
- A ready content report reduces uncertainty but cannot authorize traffic. Revisit automated cutover only as a separate T3 feature with application, routing, cache, SEO, observability, backup, and rollback ownership.
