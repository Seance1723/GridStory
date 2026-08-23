# Evidence-bound plugin marketplace

GridStory's marketplace is a private, operator-curated catalog layered on the signed Plugin SDK. It records publisher identity evidence, immutable release metadata, automated inspection results, and accountable human decisions under the complete organization, tenant, workspace, site, environment, and locale scope. It is not a hosted public registry, package CDN, malware scanner, or plugin sandbox.

## Trust statements

Treat each signal separately:

| Signal | What it establishes | What it does not establish |
|---|---|---|
| Signed manifest | The exact manifest, package digest, size, compatibility, support metadata, and requested capabilities were signed by the recorded Ed25519 key. | That the publisher is legitimate or the package is safe. |
| Verified publisher | The exact DNS TXT challenge was observed before expiry and a different authenticated operator approved the identity evidence. | Business legitimacy, code quality, support performance, or package safety. |
| Passing automated review | A configured trusted inspector returned current evidence for the exact digest/size and required inventory, SPDX SBOM, provenance, malware, vulnerability, and license checks passed policy. | Freedom from vulnerabilities or malicious behavior. Provenance is origin evidence, not a safety verdict. |
| Approved release | A distinct authenticated operator accepted the exact passing review and immutable release. | Automatic installation, enablement, capability grants, or safe runtime isolation. |
| Declared support | The signed publisher metadata states a support status and HTTPS policy/contact locations. | A GridStory support commitment or guaranteed response time. |

Approved marketplace installation hands the already signed manifest and digest to the existing Plugin SDK installer with an empty capability grant. The installation remains disabled. A tenant administrator must separately review and grant a subset of the signed requested capabilities, then enable it through an operator-provided hardened process/container runtime.

## Signed marketplace metadata

The publisher signature covers the ordinary Plugin SDK contract plus bounded marketplace fields:

- categories, keywords, homepage, documentation, and source-repository HTTPS links;
- an inclusive GridStory minimum and exclusive maximum compatible version;
- bounded tested-runtime evidence links and dates;
- `maintained`, `limited`, `deprecated`, or `unsupported` support status plus HTTPS policy/contact links and optional support end date;
- requested capabilities and constraints, exact SHA-256 package digest, package size, SDK/runtime protocol, operations, publisher ID, key ID, and release version.

Changing any signed field invalidates the signature. A submitted plugin/version release is immutable; publish a new version instead of replacing its digest or metadata.

## Publisher enrollment

1. An authorized marketplace manager registers a stable publisher ID, display name, registrable domain, same-domain HTTPS website, HTTPS support URL, and Ed25519 public verification key. Never submit a private key.
2. GridStory issues a short-lived token for `_gridstory-verification.<domain>`.
3. Publish the token as one DNS TXT value. GridStory resolves the exact name and requires an exact token match before expiry.
4. A different authenticated marketplace manager reviews the domain, key fingerprint, owner evidence, and evidence reference, then approves or declines outside the application as appropriate.
5. Suspend the publisher immediately if domain/key control, identity evidence, or conduct becomes questionable. Suspension removes marketplace trust from every release and blocks new marketplace installations.

DNS possession is one identity signal. It does not prove that the organization is safe or that every subdomain is controlled by the expected team. Operators should independently verify the publisher and protect approval permissions with enterprise sessions and operational review.

## Release review

Only a currently verified publisher can submit a manifest whose publisher and key match the enrolled record and whose signature verifies. The opaque `artifactReference` is supplied only to the configured `MarketplaceArtifactInspector`; it is omitted from catalog summaries. GridStory never downloads, imports, evaluates, or executes the package.

Built-in deterministic checks verify current publisher trust, the signature, host/SDK compatibility, and transparent capability requests. The injected inspector must return:

- exact SHA-256 digest and byte size;
- archive inventory counts, path-traversal status, install-script count, and native-binary count;
- an SPDX JSON 2.3 or 3.0 SBOM digest and package count;
- provenance verification with an exact subject digest, builder, source repository, and revision;
- malware verdict;
- vulnerability counts and identifiers;
- license-policy verdict and identifiers;
- stable inspector identity/version, completion time, and an evidence reference.

Review fails closed when no inspector is configured, the adapter errors, evidence is stale or mismatched, inventory is unsafe, provenance does not bind the artifact, malware is not clean, critical/high vulnerabilities exist, or license evidence is not allowed. Capability requests are recorded as warnings for human review. The control plane trusts the configured inspector transport and evidence; production deployments must authenticate that adapter, restrict egress, protect its evidence store, monitor freshness and availability, and validate the actual scanner policies.

An automated-review operator cannot approve their own release review. Release approval requires another authenticated marketplace reviewer and the latest current review must still pass. Rejected and yanked releases remain in history.

## API and Studio

All marketplace routes are management endpoints with `Cache-Control: private, no-store`:

- `GET /api/v1/marketplace` and `GET /api/v1/marketplace/publishers/:id`;
- `POST /api/v1/marketplace/publishers`;
- `POST /api/v1/marketplace/publishers/:id/challenge|verify-domain|approve|suspend`;
- `POST /api/v1/marketplace/releases`;
- `POST /api/v1/marketplace/releases/:id/review|approve|reject|yank|install`.

`marketplace.read`, `marketplace.manage`, and `marketplace.review` are distinct deny-by-default actions. Installation additionally requires `plugin.manage`. The universal client provides matching typed methods. Studio's Marketplace workbench displays fingerprints, compatibility, signed support status, transparent permissions, review checks, and the trust/safety disclaimer; it does not display public-key bodies, pending challenge state in catalog responses, or opaque artifact references.

## Incident response and rollback

For suspected publisher compromise, suspend the publisher first, then revoke affected tenant installations through the Plugin SDK lifecycle. For one bad version, yank the exact release and revoke any affected installations. Yanking or suspension blocks future marketplace installation but does not silently alter an existing installation record or terminate an external runtime; explicit revocation is the containment action.

Preserve the scoped marketplace document, scanner evidence reference, manifest, key fingerprint, review checks, approval identities/reasons, plugin lifecycle history, and relevant protected logs. Rotate by registering and reviewing a new key according to an approved migration; immutable older releases remain bound to their original key.

Database-native backup includes marketplace publisher/release/review state. Package bytes and external scanner evidence do not live in GridStory and require coordinated recovery. After restore, verify publisher state, yanked releases, latest review freshness, and affected plugin lifecycle records before resuming installation or enablement.

Code rollback uses the M6-005 commit revert. Persisted catalog state may remain inert because older code does not consume its table. Keep approved installations disabled or revoked while investigating. See [Plugin SDK and isolation](plugins.md), [Database recovery and rollouts](recovery-and-rollouts.md), [Support policy](../SUPPORT.md), and [ADR 0016](adr/0016-evidence-bound-marketplace.md).
