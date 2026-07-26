# Assets and resumable uploads

GridStory models digital assets in the framework-neutral control plane. Every asset, upload session, object key, API request, usage result, and repository lookup carries the complete organization, tenant, workspace, site, environment, and locale scope.

## Asset model

An asset is a stable scoped record with immutable revisions. Each revision records the original object, portable editorial metadata, an optional focal point, the actor, and creation time. Updating metadata or the focal point appends a revision and advances `currentRevisionId`; it never rewrites the prior record.

Portable metadata includes title, alternative text, caption, credit, rights, license, expiry, tags, collections, and JSON-compatible custom values. Object descriptors include the storage key, URL, filename, media type, byte size, checksum, and optional dimensions. Renditions remain separate from the original revision and retain their named preset, dimensions, fit, output format, quality, and generated object descriptor.

The canonical contracts live in `@gridstory/schema`. `AssetService`, repositories, storage adapters, and rendition adapters live in `@gridstory/core`, without Fastify, React, or browser dependencies.

## Resumable upload lifecycle

1. Start an upload with filename, declared media type, byte size, kind, metadata, and optional dimensions.
2. Use the returned `partSize` to split the file. Send numbered binary parts and retain each server-returned ETag and size.
3. Read the upload session to resume from its recorded part list after an interrupted client request.
4. Complete with the exact recorded part descriptors. GridStory rejects missing, substituted, duplicated, or size-mismatched descriptors before consuming the storage multipart upload.
5. Abort abandoned sessions explicitly. In-process sessions also expire after 24 hours.

Studio follows this lifecycle and chunks browser files by the returned part size. The universal client exposes `startAssetUpload`, `getAssetUpload`, `uploadAssetPart`, `completeAssetUpload`, and `abortAssetUpload` so other authoring applications can provide their own retry and progress interface.

Upload-session coordination is process-local in the built-in service. A horizontally scaled deployment should route a session consistently or supply a shared coordinator when distributed resumability is required.

## Persistence and S3-compatible storage

`SqliteAssetRepository` stores scoped asset metadata in the local GridStory database and survives API restarts. `AssetRepository` is the portable durability contract; deployments using a Postgres content database should inject a durable asset repository through `buildServer({ assetRepository })`. Without that injection, the database-URL configuration uses the in-memory metadata repository.

Asset repository results are checked against the complete requested scope before they are returned or parsed, so a faulty adapter cannot substitute another tenant's record. In-memory keys use the canonical collision-safe scope tuple, and S3-compatible object paths encode every scope component independently before the generated object ID and safe filename. Private reads and completed uploads can emit the bounded canonical tenant telemetry envelope without asset bytes, credentials, or content metadata.

`S3AssetStorageAdapter` maps the storage lifecycle to a small `S3MultipartClient` interface:

- create multipart upload;
- upload a numbered part;
- complete using numbered ETags;
- abort a multipart upload;
- read a completed private object for signed delivery.

It builds object keys from the full scope plus a random object segment and never derives authorization from a URL. Applications can adapt AWS S3, MinIO, Cloudflare R2, or another compatible implementation without introducing an SDK dependency into core. The default local server uses `InMemoryAssetStorageAdapter` for development; production must inject durable object storage.

Image processing is similarly injected through `AssetRenditionAdapter`. GridStory validates presets and image-only use, deduplicates an existing preset, and stores the returned object descriptor. The application owns the image-processing library or remote service.

## Usage tracking

`AssetService.usage` scans both draft and published content in the exact active scope. The report includes total references, unique entry count, draft/published counts, and each entry/path location. Draft references never prime a published cache, and usage endpoints inherit the private management cache policy.

Studio exposes the scoped asset library, focal points, revision/rendition counts, file sizes, and usage inspection. Populated managed libraries feed schema-declared asset fields; the demonstration choices remain only when no managed assets exist.

## API, authorization, and cache policy

The private REST surface is:

- `GET /api/v1/assets`
- `POST /api/v1/assets/uploads`
- `GET /api/v1/assets/uploads/:id`
- `PUT /api/v1/assets/uploads/:id/parts/:partNumber`
- `POST /api/v1/assets/uploads/:id/complete`
- `DELETE /api/v1/assets/uploads/:id`
- `POST /api/v1/assets/:id/delivery`
- `GET /api/v1/assets/:id/content?token=...`
- `GET /api/v1/assets/:id`
- `PATCH /api/v1/assets/:id`
- `POST /api/v1/assets/:id/renditions`
- `GET /api/v1/assets/:id/usage`

Viewer roles can read assets and usage. Author and publisher roles can also create uploads and update assets; administrators retain wildcard access. All routes authorize against the scoped asset resource and respond with `Cache-Control: private, no-store`.

The universal client mirrors these routes with typed asset methods. Binary upload bodies use `application/octet-stream`; all other request and response bodies use the canonical serializable contracts.

## Security inspection, quarantine, and private delivery

Completion buffers the exact server-recorded upload parts and passes them through `AssetContentInspector` before storage becomes deliverable. The built-in inspector recognizes JPEG, PNG, GIF, WebP, PDF, ZIP, MP4, SVG, JSON, Markdown, CSV, and UTF-8 text. It rejects declared MIME mismatches and image/video kind mismatches with stable 422 errors. `application/octet-stream` remains an explicit generic-file wildcard.

SVG uploads run through `ConservativeSvgSanitizer`. It rejects document types and entities, removes executable/embedded elements, event and style attributes, external links, and non-fragment URL references, then stores the sanitized bytes instead of the original. Deployments with a stronger policy can inject another `AssetContentInspector` or `AssetSvgSanitizer` without moving vendor code into the control plane.

`AssetMalwareScanner` is an injected hook over the original uploaded bytes and checksum. A clean verdict makes the inspected revision deliverable. An infected verdict or scanner exception fails closed: the immutable revision records a quarantined security verdict and findings, and GridStory denies rendition generation, delivery-grant creation, and object reads with `asset_not_deliverable`. When no scanner is configured the revision records `not_configured`; production deployments that require malware scanning must inject a provider adapter.

Each revision records declared and detected MIME types, inspection time, sanitization state, malware verdict/provider/signature, findings, and its verified or quarantined status. Studio displays this state and offers only verified managed revisions to asset fields. Legacy revisions without a security verdict are not deliverable through the signed route.

### Signed private delivery

Authorized readers request a grant with `POST /api/v1/assets/:id/delivery`, optionally selecting a revision and a 30-900 second lifetime. `AssetDeliveryService` signs an HMAC-SHA256 token containing the complete six-dimensional scope, exact asset and revision IDs, issue/expiry times, and a nonce. The universal client method is `createAssetDelivery`; it resolves the returned relative content path against the configured API base URL.

`GET /api/v1/assets/:id/content?token=...` authenticates that token without tenant headers, rechecks the stored revision's verified state, scope-checks the storage object key, and streams only that private object. Responses use `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, a safe encoded filename, and a restrictive sandbox CSP for SVG. Invalid, tampered, wrong-asset, or expired grants return 401.

Production object storage must remain private. The descriptor URL is metadata for the configured adapter, not an authorization grant; applications should render confidential bytes through a fresh signed delivery URL. Use a distinct random `GRIDSTORY_ASSET_DELIVERY_SIGNING_SECRET` of at least 32 characters, rotate it independently of preview/cursor/webhook secrets, and never place preview credentials, draft content, or delivery tokens in object keys or published cache keys.