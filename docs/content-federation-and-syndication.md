# Contract-bound content federation and syndication

GridStory can expose an exact allowlist of published content types to another installation and can consume a remote offer in either live or reviewed-mirror mode. The feature is disabled by default. It is a signed application contract, not ActivityPub, WebSub, generic JSON Schema federation, a remote editor, or a legal-rights verification service.

Every record carries its canonical source URL, license URL, required credit text, attributed agents, source instance, source entry/revision/sequence, offer ID/version/digest, and exact schema fingerprint. These values are tamper-evident source assertions. Operators remain responsible for validating the license, attribution placement, contractual authority, and any royalties or withdrawal obligations.

## Boundary and modes

```text
producer published repository
        |
        | exact allowlisted schema + published revision only
        v
signed offer / record / complete snapshot
        |
        | configured HTTPS adapter, full source scope, no redirects
        v
consumer agreement (disabled after inspection)
        |
        +-- live ---- fresh signed by-ID fetch ----> no retained record
        |
        `-- mirror -- preview digest -> operator execute -> read-only mirror/tombstone
```

Producer offers and consumer agreements use complete organization, tenant, workspace, site, environment, and locale scope. A consumer pins the source instance, source scope, adapter name, canonical base URL, offer version/digest, Ed25519 public key, namespaced type versions/fingerprints, attribution terms, and mode. Reinspection creates a new disabled agreement version; activation is a separate operator decision.

Only first-slice-compatible schema fields may be offered. Assets, component trees/code, relations, rich text, drafts, preview grants, workflow state, and credentials cannot enter a signed record. A mirror is not a `ContentEntry`, has no draft/published pointer, and cannot be edited or published locally.

## Trusted server composition

The producer supplies a private Ed25519 signer through server composition. Only the public key is retained in an offer; the private key must stay in the deployment secret/key service and out of schema, persistence, browser bundles, logs, and responses.

```ts
const server = await buildServer({
  contentSchemas: deployedSchemas,
  contentFederation: {
    signer: deploymentEd25519Signer,
  },
});
```

The consumer configures one or more deployment-owned sources. Callers select only the configured adapter name; they cannot supply an origin, credential, arbitrary URL, or redirect target.

```ts
const source = new HttpContentFederationSource({
  name: 'partner-newsroom',
  baseUrl: 'https://cms.partner.example/gridstory/',
  authorizationHeader: `Bearer ${secretManagerValue}`,
  timeoutMs: 10_000,
});

const server = await buildServer({
  contentFederation: { sources: [source] },
});
```

The maintained HTTP adapter requires a credential-free HTTPS base URL, disables redirects, rejects a changed response origin, sends the complete source scope as GridStory scope headers, bounds timeout and bytes, accepts a JSON object only, and converts transport/provider diagnostics to one generic error. Deployment DNS rebinding protection, outbound proxy/firewall policy, credential rotation, source rate limits, TLS inspection, and provider availability remain operator evidence.

## Operator sequence

### Producer

1. Deploy a supported schema inventory and configure the signer.
2. Save a disabled offer with exact content type/version allowlists and reviewed attribution terms.
3. Review its public key, source/canonical URLs, type fingerprints, license, credit, and agents.
4. Save a new enabled offer version. Consumers remain pinned to the version/digest they inspected.
5. Grant `federation.consume` only to the intended source service principal.

### Consumer

1. Configure the source adapter and its least-privilege credential in the trusted server runtime.
2. Independently obtain and review the source scope, source instance, canonical base, offer ID, and Ed25519 public key.
3. Inspect the signed offer into a named local agreement. Inspection always leaves it disabled.
4. Review every pinned type/fingerprint and attribution term, then activate the agreement.
5. For `live`, resolve by local agreement, namespace, and source entry ID. GridStory performs a fresh signed fetch and retains no record.
6. For `mirror`, create an expiring synchronization preview, review every create/update/no-op/withdraw/blocked effect, then execute the exact digest. A changed source snapshot, agreement, offer, type, or plan blocks execution.

Withdrawal from a complete signed mirror snapshot becomes an explicit tombstone. Public mirror delivery then returns not found while bounded receipt and attribution history remain. Disabling an agreement stops both live and mirror delivery; it does not delete ordinary local content or mutate the producer.

## Routes and caching

Management routes are private, authorized, complete-scope, optimistic, and `Cache-Control: private, no-store`:

- `GET /api/v1/federation`
- `PUT /api/v1/federation/offers/:offerId`
- `POST /api/v1/federation/agreements/:agreementId/inspect`
- `POST /api/v1/federation/agreements/:agreementId/state`
- `POST /api/v1/federation/agreements/:agreementId/plans`
- `POST /api/v1/federation/plans/:planId/execute`

Source routes require `federation.consume` and are private/no-store:

- `GET /api/v1/federation/source/offers/:offerId?requestId=...`
- `GET /api/v1/federation/source/offers/:offerId/records/:namespace/:sourceEntryId?requestId=...`
- `GET /api/v1/federation/source/offers/:offerId/snapshot?requestId=...&maximumRecords=...`

Public delivery is `GET /api/v1/federation/delivery/:agreementId/:namespace/:sourceEntryId`. It returns the validated record and mandatory attribution but omits remote scope, adapter configuration, public-key body, credentials, and raw errors. It remains private/no-store in this slice because cross-instance key/offer/withdrawal invalidation is not yet defined.

## Failure, recovery, and removal

- Signature, request ID, expiry, instance, scope, offer version/digest, type fingerprint, schema, checksum, revision sequence, attribution, snapshot checkpoint, and requested identity mismatches fail closed.
- Mirror execution persists `executing` before the second source read, revalidates the reviewed checkpoint/effects, applies atomically, and returns the retained receipt on an exact retry.
- Revision-sequence regression or same-sequence content mutation creates a blocked effect rather than overwriting the mirror.
- SQLite and PostgreSQL native backups include `gridstory_content_federation_documents`; mirror state, plans, receipts, tombstones, and attribution recover with the database. Live records are deliberately absent from backup truth.

To disable safely, disable consumer agreements first, stop new mirror previews, reconcile or let in-flight previews expire, retain/export any contractually required receipts, then disable producer offers. Remove configured credentials/signers only after no enabled contract depends on them. Code rollback is the additive M8-002 revert after external obligations and retained evidence have been reviewed.

## Deliberate limitations

This slice has no public federation standard/profile, source discovery, automatic key rotation/discovery, push subscriptions, scheduling, bulk streaming, shared caching, federated relations, assets, components, rich text, remote drafts, local editorial mutation, source writes, automatic license validation, royalty enforcement, cross-instance search, provider catalog, multi-hop forwarding, or conflict merging. M8-004 may revisit interoperability only with concrete partner requirements.
