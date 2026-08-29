import type {
  AssetRecord,
  AssetRenditionPreset,
  AssetUsageReport,
  UpdateAssetInput,
} from '@gridstory/client';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export type AssetUploadView = {
  fileName: string;
  totalBytes: number;
  uploadedBytes: number;
  uploadedParts: number;
  totalParts: number;
  status: 'starting' | 'uploading' | 'completing' | 'failed';
  message?: string;
};

type AssetLibraryProps = {
  assets: AssetRecord[];
  focusAssetId: string | null;
  loading: boolean;
  error: string | null;
  upload: AssetUploadView | null;
  canCreate: boolean;
  canUpdate: boolean;
  onReload: () => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onRetryUpload: () => Promise<void>;
  onAbortUpload: () => Promise<void>;
  onUpdateAsset: (assetId: string, input: UpdateAssetInput) => Promise<void>;
  onCreateRendition: (assetId: string, preset: AssetRenditionPreset) => Promise<void>;
  onLoadUsage: (assetId: string) => Promise<AssetUsageReport>;
  onOpenDelivery: (assetId: string, revisionId: string) => Promise<void>;
};

function currentRevision(asset: AssetRecord) {
  return asset.revisions.find((revision) => revision.id === asset.currentRevisionId);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function splitValues(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function localDateTime(value?: string): string {
  return value ? new Date(value).toISOString().slice(0, 16) : '';
}

function securityLabel(asset: AssetRecord): 'verified' | 'quarantined' | 'unverified' {
  return currentRevision(asset)?.security?.status ?? 'unverified';
}

export function AssetLibrary({
  assets,
  focusAssetId,
  loading,
  error,
  upload,
  canCreate,
  canUpdate,
  onReload,
  onUpload,
  onRetryUpload,
  onAbortUpload,
  onUpdateAsset,
  onCreateRendition,
  onLoadUsage,
  onOpenDelivery,
}: AssetLibraryProps): ReactNode {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | AssetRecord['kind']>('all');
  const [security, setSecurity] = useState<'all' | ReturnType<typeof securityLabel>>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const appliedFocusId = useRef<string | null>(null);
  const [usage, setUsage] = useState<AssetUsageReport | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [metadataRevisionId, setMetadataRevisionId] = useState('');
  const [title, setTitle] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [rights, setRights] = useState('');
  const [license, setLicense] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [tags, setTags] = useState('');
  const [collections, setCollections] = useState('');
  const [hasFocalPoint, setHasFocalPoint] = useState(false);
  const [focalX, setFocalX] = useState('0.5');
  const [focalY, setFocalY] = useState('0.5');
  const [renditionId, setRenditionId] = useState('web');
  const [renditionWidth, setRenditionWidth] = useState('1200');
  const [renditionHeight, setRenditionHeight] = useState('');
  const [renditionFit, setRenditionFit] = useState<AssetRenditionPreset['fit']>('cover');
  const [renditionFormat, setRenditionFormat] = useState<AssetRenditionPreset['format']>('webp');
  const [renditionQuality, setRenditionQuality] = useState('80');

  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return assets.filter((asset) => {
      const revision = currentRevision(asset);
      const searchable = [
        revision?.metadata.title,
        revision?.metadata.alt,
        revision?.original.filename,
        revision?.original.mediaType,
        ...(revision?.metadata.tags ?? []),
        ...(revision?.metadata.collections ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return (
        (kind === 'all' || asset.kind === kind) &&
        (security === 'all' || securityLabel(asset) === security) &&
        (!normalized || searchable.includes(normalized))
      );
    });
  }, [assets, kind, query, security]);

  const selected =
    filteredAssets.find((asset) => asset.id === selectedId) ?? filteredAssets[0] ?? null;
  const revision = selected ? currentRevision(selected) : undefined;

  useEffect(() => {
    if (
      focusAssetId &&
      focusAssetId !== appliedFocusId.current &&
      assets.some((asset) => asset.id === focusAssetId)
    ) {
      appliedFocusId.current = focusAssetId;
      setSelectedId(focusAssetId);
    }
  }, [assets, focusAssetId]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    if (!revision || revision.id === metadataRevisionId) return;
    setMetadataRevisionId(revision.id);
    setTitle(revision.metadata.title);
    setAlt(revision.metadata.alt ?? '');
    setCaption(revision.metadata.caption ?? '');
    setCredit(revision.metadata.credit ?? '');
    setRights(revision.metadata.rights ?? '');
    setLicense(revision.metadata.license ?? '');
    setExpiresAt(localDateTime(revision.metadata.expiresAt));
    setTags(revision.metadata.tags.join(', '));
    setCollections(revision.metadata.collections.join(', '));
    setHasFocalPoint(Boolean(revision.focalPoint));
    setFocalX(String(revision.focalPoint?.x ?? 0.5));
    setFocalY(String(revision.focalPoint?.y ?? 0.5));
    setUsage(null);
    setActionMessage(null);
  }, [metadataRevisionId, revision]);

  const runAction = async (action: () => Promise<void>, success: string) => {
    setActionBusy(true);
    setActionMessage(null);
    try {
      await action();
      setActionMessage({ tone: 'success', text: success });
    } catch (cause) {
      setActionMessage({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'The asset action could not be completed.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !revision || !title.trim()) return;
    const input: UpdateAssetInput = {
      metadata: {
        ...revision.metadata,
        title: title.trim(),
        ...(alt.trim() ? { alt: alt.trim() } : { alt: undefined }),
        ...(caption.trim() ? { caption: caption.trim() } : { caption: undefined }),
        ...(credit.trim() ? { credit: credit.trim() } : { credit: undefined }),
        ...(rights.trim() ? { rights: rights.trim() } : { rights: undefined }),
        ...(license.trim() ? { license: license.trim() } : { license: undefined }),
        ...(expiresAt
          ? { expiresAt: new Date(expiresAt).toISOString() }
          : { expiresAt: undefined }),
        tags: splitValues(tags),
        collections: splitValues(collections),
      },
      focalPoint: hasFocalPoint ? { x: Number(focalX), y: Number(focalY) } : null,
    };
    await runAction(
      () => onUpdateAsset(selected.id, input),
      'Metadata saved as a new immutable asset revision.',
    );
  };

  const requestRendition = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const width = renditionWidth ? Number(renditionWidth) : undefined;
    const height = renditionHeight ? Number(renditionHeight) : undefined;
    if (!width && !height) {
      setActionMessage({ tone: 'error', text: 'Provide a rendition width or height.' });
      return;
    }
    await runAction(
      () =>
        onCreateRendition(selected.id, {
          id: renditionId.trim(),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          fit: renditionFit,
          format: renditionFormat,
          quality: Number(renditionQuality),
        }),
      'Rendition created from the current verified revision.',
    );
  };

  const uploadPercent = upload
    ? Math.round((upload.uploadedBytes / Math.max(upload.totalBytes, 1)) * 100)
    : 0;

  return (
    <section className="asset-library-panel" aria-label="Asset library">
      <div className="section-heading">
        <div>
          <span className="kicker">Digital assets</span>
          <h2>Asset library</h2>
          <p>Verified uploads, immutable metadata revisions, renditions, and scoped usage.</p>
        </div>
        <div className="asset-library-actions">
          <button
            className="button button--outline"
            type="button"
            disabled={loading}
            onClick={() => void onReload()}
          >
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <label className="button button--primary asset-upload-button">
            {upload
              ? upload.status === 'failed'
                ? 'Upload paused'
                : 'Uploading…'
              : 'Upload asset'}
            <input
              aria-label="Upload asset"
              data-required-operations="asset.create"
              type="file"
              disabled={!canCreate || upload !== null}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void onUpload(file);
              }}
            />
          </label>
        </div>
      </div>

      {upload ? (
        <div className={`asset-upload-state asset-upload-state--${upload.status}`} role="status">
          <div>
            <strong>{upload.fileName}</strong>
            <span>
              {upload.status === 'failed'
                ? `Upload paused: ${upload.message ?? 'request failed'}`
                : `${upload.uploadedParts} of ${upload.totalParts} parts · ${uploadPercent}%`}
            </span>
          </div>
          <progress value={upload.uploadedBytes} max={upload.totalBytes}>
            {uploadPercent}%
          </progress>
          <div className="asset-upload-state__actions">
            {upload.status === 'failed' ? (
              <button
                className="button button--secondary button--compact"
                type="button"
                disabled={!canCreate}
                onClick={() => void onRetryUpload()}
              >
                Retry upload
              </button>
            ) : null}
            <button
              className="button button--outline button--compact"
              type="button"
              disabled={!canCreate}
              onClick={() => void onAbortUpload()}
            >
              Abort upload
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="asset-library-error" role="alert">
          <p>{error}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void onReload()}
          >
            Retry library load
          </button>
        </div>
      ) : null}

      <fieldset className="asset-library-filters">
        <legend>Filter loaded assets</legend>
        <label className="gs-field">
          <span>Search loaded assets</span>
          <input
            type="search"
            value={query}
            placeholder="Title, filename, tag, or collection"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="gs-field">
          <span>Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="all">All kinds</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="file">Files</option>
          </select>
        </label>
        <label className="gs-field">
          <span>Security state</span>
          <select
            value={security}
            onChange={(event) => setSecurity(event.target.value as typeof security)}
          >
            <option value="all">All states</option>
            <option value="verified">Verified</option>
            <option value="quarantined">Quarantined</option>
            <option value="unverified">Unverified</option>
          </select>
        </label>
      </fieldset>
      <p className="asset-library-boundary" role="status">
        Showing {filteredAssets.length} of {assets.length} loaded scoped assets.
      </p>

      {loading && assets.length === 0 ? (
        <p className="empty-state">Loading scoped assets…</p>
      ) : null}
      {!loading && !error && assets.length === 0 ? (
        <p className="empty-state">
          No assets exist in this tenant, site, environment, and locale.
        </p>
      ) : null}
      {!loading && assets.length > 0 && filteredAssets.length === 0 ? (
        <p className="empty-state">No loaded assets match these filters.</p>
      ) : null}

      {filteredAssets.length > 0 ? (
        <div className="asset-library-workspace">
          <section className="asset-library-grid" aria-label="Loaded assets">
            {filteredAssets.map((asset) => {
              const assetRevision = currentRevision(asset);
              if (!assetRevision) return null;
              const assetSecurity = securityLabel(asset);
              return (
                <button
                  className="asset-library-card"
                  type="button"
                  key={asset.id}
                  aria-pressed={asset.id === selected?.id}
                  onClick={() => setSelectedId(asset.id)}
                >
                  <span className="asset-library-title-row">
                    <strong>{assetRevision.metadata.title}</strong>
                    <span className={`asset-security-badge asset-security-badge--${assetSecurity}`}>
                      {assetSecurity}
                    </span>
                  </span>
                  <span>{assetRevision.original.filename}</span>
                  <small>
                    {asset.kind} · {assetRevision.original.mediaType} ·{' '}
                    {formatBytes(assetRevision.original.size)}
                  </small>
                  <small>
                    Version {assetRevision.version} · {asset.renditions.length} rendition(s)
                  </small>
                </button>
              );
            })}
          </section>

          {selected && revision ? (
            <article
              className="asset-detail"
              aria-label={`${revision.metadata.title} asset details`}
            >
              <header className="asset-detail__header">
                <div>
                  <span className="kicker">Selected asset</span>
                  <h3>{revision.metadata.title} details</h3>
                  <p>{revision.original.filename}</p>
                </div>
                <span
                  className={`asset-security-badge asset-security-badge--${securityLabel(selected)}`}
                >
                  {securityLabel(selected)}
                </span>
              </header>

              <section className="asset-detail__section" aria-labelledby="asset-security-heading">
                <h4 id="asset-security-heading">Security evidence</h4>
                {revision.security ? (
                  <dl className="asset-facts">
                    <div>
                      <dt>Declared</dt>
                      <dd>{revision.security.declaredMediaType}</dd>
                    </div>
                    <div>
                      <dt>Detected</dt>
                      <dd>{revision.security.detectedMediaType}</dd>
                    </div>
                    <div>
                      <dt>Malware</dt>
                      <dd>{revision.security.malware.status}</dd>
                    </div>
                    <div>
                      <dt>Provider</dt>
                      <dd>{revision.security.malware.provider ?? 'Unavailable'}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="asset-policy-state">
                    Verification evidence is unavailable. Delivery and rendition actions stay
                    blocked.
                  </p>
                )}
                {revision.security?.malware.status === 'not_configured' ? (
                  <p className="asset-policy-state">
                    Malware scanner provider is not configured; this is not a production-readiness
                    claim.
                  </p>
                ) : null}
                {revision.security?.findings.length ? (
                  <ul className="asset-finding-list">
                    {revision.security.findings.map((finding) => (
                      <li key={finding}>{finding}</li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <form className="asset-detail__section asset-metadata-form" onSubmit={saveMetadata}>
                <div className="asset-detail__section-heading">
                  <div>
                    <h4>Metadata and focal point</h4>
                    <p>Saving creates a new immutable asset revision.</p>
                  </div>
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={!canUpdate || actionBusy || !title.trim()}
                  >
                    Save metadata
                  </button>
                </div>
                <div className="asset-form-grid">
                  <label className="gs-field">
                    <span>Title</span>
                    <input
                      required
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <label className="gs-field">
                    <span>Alternative text</span>
                    <input value={alt} onChange={(event) => setAlt(event.target.value)} />
                  </label>
                  <label className="gs-field asset-form-grid__wide">
                    <span>Caption</span>
                    <textarea
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                    />
                  </label>
                  <label className="gs-field">
                    <span>Credit</span>
                    <input value={credit} onChange={(event) => setCredit(event.target.value)} />
                  </label>
                  <label className="gs-field">
                    <span>Rights</span>
                    <input value={rights} onChange={(event) => setRights(event.target.value)} />
                  </label>
                  <label className="gs-field">
                    <span>License</span>
                    <input value={license} onChange={(event) => setLicense(event.target.value)} />
                  </label>
                  <label className="gs-field">
                    <span>Expires at</span>
                    <input
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(event) => setExpiresAt(event.target.value)}
                    />
                  </label>
                  <label className="gs-field">
                    <span>Tags (comma separated)</span>
                    <input value={tags} onChange={(event) => setTags(event.target.value)} />
                  </label>
                  <label className="gs-field asset-form-grid__wide">
                    <span>Collections (comma separated)</span>
                    <input
                      value={collections}
                      onChange={(event) => setCollections(event.target.value)}
                    />
                  </label>
                </div>
                <fieldset className="asset-focal-point">
                  <legend>Focal point</legend>
                  <label className="asset-checkbox">
                    <input
                      type="checkbox"
                      checked={hasFocalPoint}
                      onChange={(event) => setHasFocalPoint(event.target.checked)}
                    />
                    Use a normalized image focal point
                  </label>
                  <div className="asset-form-grid">
                    <label className="gs-field">
                      <span>Horizontal (0–1)</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        disabled={!hasFocalPoint}
                        value={focalX}
                        onChange={(event) => setFocalX(event.target.value)}
                      />
                    </label>
                    <label className="gs-field">
                      <span>Vertical (0–1)</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        disabled={!hasFocalPoint}
                        value={focalY}
                        onChange={(event) => setFocalY(event.target.value)}
                      />
                    </label>
                  </div>
                </fieldset>
                {Object.keys(revision.metadata.custom).length ? (
                  <details className="asset-custom-metadata">
                    <summary>
                      Custom metadata ({Object.keys(revision.metadata.custom).length})
                    </summary>
                    <dl className="asset-facts">
                      {Object.entries(revision.metadata.custom).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </form>

              <section className="asset-detail__section" aria-labelledby="asset-revisions-heading">
                <h4 id="asset-revisions-heading">Immutable revisions</h4>
                <ol className="asset-record-list">
                  {[...selected.revisions]
                    .sort((left, right) => right.version - left.version)
                    .map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>Version {item.version}</strong>
                          <span>{item.metadata.title}</span>
                        </div>
                        <small>
                          {item.id === selected.currentRevisionId ? 'Current · ' : ''}
                          {item.security?.status ?? 'unverified'} · malware{' '}
                          {item.security?.malware.status ?? 'unknown'} · {item.actorId} ·{' '}
                          {new Date(item.createdAt).toLocaleString()}
                        </small>
                      </li>
                    ))}
                </ol>
              </section>

              <section className="asset-detail__section" aria-labelledby="asset-renditions-heading">
                <h4 id="asset-renditions-heading">Renditions</h4>
                {selected.renditions.length ? (
                  <ul className="asset-record-list">
                    {selected.renditions.map((item) => (
                      <li key={item.id}>
                        <strong>{item.preset.id}</strong>
                        <span>
                          {item.preset.width ?? 'auto'} × {item.preset.height ?? 'auto'} ·{' '}
                          {item.preset.format} · {formatBytes(item.object.size)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No renditions exist for this asset.</p>
                )}
                {selected.kind === 'image' && revision.security?.status === 'verified' ? (
                  <form className="asset-rendition-form" onSubmit={requestRendition}>
                    <div className="asset-form-grid">
                      <label className="gs-field">
                        <span>Preset ID</span>
                        <input
                          required
                          value={renditionId}
                          onChange={(event) => setRenditionId(event.target.value)}
                        />
                      </label>
                      <label className="gs-field">
                        <span>Width</span>
                        <input
                          type="number"
                          min="1"
                          value={renditionWidth}
                          onChange={(event) => setRenditionWidth(event.target.value)}
                        />
                      </label>
                      <label className="gs-field">
                        <span>Height</span>
                        <input
                          type="number"
                          min="1"
                          value={renditionHeight}
                          onChange={(event) => setRenditionHeight(event.target.value)}
                        />
                      </label>
                      <label className="gs-field">
                        <span>Fit</span>
                        <select
                          value={renditionFit}
                          onChange={(event) =>
                            setRenditionFit(event.target.value as AssetRenditionPreset['fit'])
                          }
                        >
                          <option value="cover">Cover</option>
                          <option value="contain">Contain</option>
                          <option value="crop">Crop</option>
                        </select>
                      </label>
                      <label className="gs-field">
                        <span>Format</span>
                        <select
                          value={renditionFormat}
                          onChange={(event) =>
                            setRenditionFormat(event.target.value as AssetRenditionPreset['format'])
                          }
                        >
                          <option value="original">Original</option>
                          <option value="jpeg">JPEG</option>
                          <option value="png">PNG</option>
                          <option value="webp">WebP</option>
                          <option value="avif">AVIF</option>
                        </select>
                      </label>
                      <label className="gs-field">
                        <span>Quality</span>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={renditionQuality}
                          onChange={(event) => setRenditionQuality(event.target.value)}
                        />
                      </label>
                    </div>
                    <button
                      className="button button--secondary"
                      type="submit"
                      disabled={!canUpdate || actionBusy || !renditionId.trim()}
                    >
                      Create rendition
                    </button>
                  </form>
                ) : (
                  <p className="asset-policy-state">
                    Renditions require an image with a verified current revision.
                  </p>
                )}
              </section>

              <section className="asset-detail__section" aria-labelledby="asset-usage-heading">
                <div className="asset-detail__section-heading">
                  <div>
                    <h4 id="asset-usage-heading">Usage locations</h4>
                    <p>Exact references in the current authorized scope.</p>
                  </div>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={usageBusy}
                    onClick={() => {
                      setUsageBusy(true);
                      setActionMessage(null);
                      void onLoadUsage(selected.id)
                        .then(setUsage)
                        .catch((cause: unknown) =>
                          setActionMessage({
                            tone: 'error',
                            text:
                              cause instanceof Error
                                ? cause.message
                                : 'Asset usage could not be loaded.',
                          }),
                        )
                        .finally(() => setUsageBusy(false));
                    }}
                  >
                    {usageBusy ? 'Inspecting…' : 'Inspect usage'}
                  </button>
                </div>
                {usage ? (
                  <div className="asset-usage-summary" role="status">
                    <strong>
                      {usage.totalReferences} references across {usage.entries} entries
                    </strong>
                    <span>
                      {usage.byPerspective.draft} draft · {usage.byPerspective.published} published
                    </span>
                    {usage.locations.length ? (
                      <ul className="asset-record-list">
                        {usage.locations.map((location) => (
                          <li key={`${location.entryId}:${location.revisionId}:${location.path}`}>
                            <strong>{location.entryId}</strong>
                            <span>
                              {location.contentType} · {location.perspective} · {location.field}
                            </span>
                            <small>{location.path}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No individual usage locations were returned.</p>
                    )}
                  </div>
                ) : null}
              </section>

              <section className="asset-detail__section asset-delivery">
                <div>
                  <h4>Private delivery</h4>
                  <p>
                    Opens a short-lived signed delivery in a new window. The grant URL is not stored
                    in Studio state or browser storage.
                  </p>
                </div>
                <button
                  className="button button--outline"
                  type="button"
                  disabled={revision.security?.status !== 'verified' || actionBusy}
                  onClick={() =>
                    void runAction(
                      () => onOpenDelivery(selected.id, revision.id),
                      'Private delivery opened in a new window.',
                    )
                  }
                >
                  Open private delivery
                </button>
              </section>

              {actionMessage ? (
                <p
                  className={`asset-action-message asset-action-message--${actionMessage.tone}`}
                  role={actionMessage.tone === 'error' ? 'alert' : 'status'}
                >
                  {actionMessage.text}
                </p>
              ) : null}
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
