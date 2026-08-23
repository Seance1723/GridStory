import {
  type AssetRecord,
  type AssetUsageReport,
  type BacklinkRecord,
  type CollaborationSnapshot,
  type ComponentManifest,
  type ComponentMigrationPlanResponse,
  type ComponentVisualRegressionPlan,
  type ContentEntry,
  type ContentQualityReport,
  type ContentRevision,
  createGridStoryClient,
  type DurableJobRecord,
  type GovernancePlan,
  type GovernanceSnapshot,
  GridStoryApiError,
  type GridStoryClient,
  type IdentitySnapshot,
  type MigrationOverviewRecord,
  type MigrationPlanSummary,
  type MigrationRecipeInput,
  type MarketplaceOverviewRecord,
  type OperationsDashboardRecord,
  type PreviewSessionGrant,
  type RelatedContentRecord,
  type Release,
  type ReleasePreview,
  type SearchIndexStatus,
  type SearchResponse,
  type TaxonomyDefinition,
  type WorkflowDefinition,
  type WorkflowInstance,
} from '@gridstory/client';
import {
  createGridStoryPreviewController,
  type GridStoryPreviewController,
} from '@gridstory/client/preview';
import { exampleDesignSystem } from '@gridstory/example-kit/design-system';
import { componentManifests } from '@gridstory/example-kit/manifests';
import { exampleComponentRegistry } from '@gridstory/example-kit/react';
import { GridStoryRenderer } from '@gridstory/react';
import type {
  AssetReference,
  CollaborationOperation,
  ComponentNode,
  ContentSchemaDefinition,
  DesignSystemManifest,
  FieldDefinition,
  PropDefinition,
  SignedPluginManifest,
  WorkflowActionDefinition,
} from '@gridstory/schema';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssetControl, RelationControl, RichTextControl } from './authoring-controls.js';
import {
  addNode,
  type CompositionResult,
  commitComposition,
  createCompositionHistory,
  findNode,
  flattenLayers,
  instantiateSymbol,
  instantiateTemplate,
  locateNode,
  type MoveTarget,
  moveNode,
  redoComposition,
  removeNode,
  undoComposition,
  updateNodePresentation,
  updateNodeProps,
} from './composition-editor.js';

const defaultClient = createGridStoryClient({
  baseUrl: import.meta.env.VITE_GRIDSTORY_API_URL ?? 'http://localhost:4000',
  tenantId: import.meta.env.VITE_GRIDSTORY_TENANT ?? 'default',
  actorId: import.meta.env.VITE_GRIDSTORY_ACTOR_ID ?? 'studio-local-admin',
  developmentIdentityHeaders: import.meta.env.VITE_GRIDSTORY_IDENTITY_MODE !== 'production',
});

type Notice = { tone: 'success' | 'error' | 'info'; message: string } | null;
type PreviewPerspective = 'draft' | 'published';
type ExternalPreviewState = {
  grant: PreviewSessionGrant;
  mode: 'iframe' | 'standalone';
  entryId: string;
  route: string;
  ready: boolean;
};
type EditableContent = Record<string, unknown>;
type ComponentGovernanceState = {
  componentId: string;
  migration: ComponentMigrationPlanResponse;
  visual: ComponentVisualRegressionPlan;
};

function emptyCollaborationSnapshot(entryId = ''): CollaborationSnapshot {
  return {
    organizationId: '',
    tenantId: '',
    workspaceId: '',
    siteId: '',
    environmentId: '',
    locale: '',
    entryId,
    version: 0,
    threads: [],
    presence: [],
    operations: [],
    branches: [
      {
        id: 'main',
        entryId,
        name: 'Main',
        status: 'open',
        baseOperationIds: [],
        operationIds: [],
        headOperationIds: [],
        createdBy: 'system',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    ],
    branchStates: [],
    suggestions: [],
    merges: [],
    conflicts: [],
  };
}

function collaborationValueLabel(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (!serialized) return 'Deleted value';
  return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
}

function collaborationJsonValue(value: unknown): CollaborationOperation['value'] {
  return JSON.parse(JSON.stringify(value)) as CollaborationOperation['value'];
}

function asEditableContent(entry: ContentEntry): EditableContent {
  return entry.data;
}

function compositionFrom(entry: ContentEntry, fieldName?: string): ComponentNode[] {
  const explicit = fieldName ? entry.data[fieldName] : undefined;
  if (Array.isArray(explicit)) return explicit as ComponentNode[];
  const fallback = Object.values(entry.data).find(
    (value) =>
      Array.isArray(value) &&
      value.every(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'id' in item &&
          'component' in item &&
          'props' in item,
      ),
  );
  return Array.isArray(fallback) ? (fallback as ComponentNode[]) : [];
}

function entryTitle(entry: ContentEntry, schemas: ContentSchemaDefinition[]): string {
  const schema = schemas.find((candidate) => candidate.id === entry.contentType);
  return String(entry.data[schema?.titleField ?? 'title'] ?? 'Untitled');
}

function entrySlug(entry: ContentEntry, schemas: ContentSchemaDefinition[]): string {
  const schema = schemas.find((candidate) => candidate.id === entry.contentType);
  const slug = schema?.fields.find((field) => field.type === 'slug');
  return String(entry.data[slug?.name ?? 'slug'] ?? '');
}

function messageFrom(error: unknown): string {
  if (error instanceof GridStoryApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'An unknown GridStory error occurred.';
}

function newNode(manifest: ComponentManifest): ComponentNode {
  const props = Object.fromEntries(
    manifest.props.map((prop) => {
      if (prop.defaultValue !== undefined) return [prop.name, prop.defaultValue];
      if (prop.type === 'boolean') return [prop.name, false];
      if (prop.type === 'number') return [prop.name, 0];
      if (prop.type === 'enum') return [prop.name, prop.values[0] ?? ''];
      return [prop.name, ''];
    }),
  );
  return {
    id: crypto.randomUUID(),
    component: manifest.id,
    version: manifest.version,
    props,
    ...(manifest.slots.length > 0
      ? { slots: Object.fromEntries(manifest.slots.map((slot) => [slot.name, []])) }
      : {}),
  };
}

function tokenCompatible(definition: PropDefinition, value: string | number | boolean): boolean {
  if (definition.type === 'boolean') return typeof value === 'boolean';
  if (definition.type === 'number') {
    return (
      typeof value === 'number' &&
      (definition.minimum === undefined || value >= definition.minimum) &&
      (definition.maximum === undefined || value <= definition.maximum)
    );
  }
  if (typeof value !== 'string') return false;
  if (definition.type === 'enum') return definition.values.includes(value);
  return (
    (definition.minLength === undefined || value.length >= definition.minLength) &&
    (definition.maxLength === undefined || value.length <= definition.maxLength)
  );
}

function FieldControl({
  idPrefix,
  definition,
  value,
  onChange,
}: {
  idPrefix: string;
  definition: PropDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactNode {
  const id = `${idPrefix}-${definition.id}`.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
  if (definition.type === 'textarea') {
    return (
      <label className="gs-field" htmlFor={id}>
        <span>{definition.label}</span>
        <textarea
          id={id}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
        />
      </label>
    );
  }
  if (definition.type === 'enum') {
    return (
      <label className="gs-field" htmlFor={id}>
        <span>{definition.label}</span>
        <select
          id={id}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {definition.values.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }
  if (definition.type === 'boolean') {
    return (
      <label className="gs-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{definition.label}</span>
      </label>
    );
  }
  if (definition.type === 'number') {
    return (
      <label className="gs-field" htmlFor={id}>
        <span>{definition.label}</span>
        <input
          id={id}
          type="number"
          value={Number(value ?? 0)}
          onChange={(event) => onChange(event.target.valueAsNumber)}
        />
      </label>
    );
  }
  return (
    <label className="gs-field" htmlFor={id}>
      <span>{definition.label}</span>
      <input
        id={id}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SchemaFieldControl({
  definition,
  value,
  entries,
  assets,
  onChange,
}: {
  definition: Exclude<FieldDefinition, { type: 'component-tree' }>;
  value: unknown;
  entries: ContentEntry[];
  onChange: (value: unknown) => void;
  assets: AssetReference[];
}): ReactNode {
  const id = `field-${definition.id}`.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
  const structured =
    definition.type === 'object' ||
    definition.type === 'array' ||
    definition.type === 'union' ||
    (definition.type === 'taxonomy' && definition.multiple);
  const [jsonValue, setJsonValue] = useState('');
  const [jsonError, setJsonError] = useState(false);
  useEffect(() => {
    if (structured) setJsonValue(JSON.stringify(value ?? null, null, 2));
  }, [structured, value]);

  if (definition.type === 'rich-text') {
    return (
      <RichTextControl
        definition={definition}
        value={value}
        entries={entries}
        onChange={onChange}
      />
    );
  }
  if (definition.type === 'asset') {
    return (
      <AssetControl definition={definition} value={value} assets={assets} onChange={onChange} />
    );
  }
  if (definition.type === 'relation') {
    return (
      <RelationControl
        definition={definition}
        value={value}
        entries={entries}
        onChange={onChange}
      />
    );
  }
  if (definition.type === 'slug') {
    return (
      <label className="gs-field" htmlFor={id}>
        <span>{definition.label}</span>
        <div className="slug-field">
          <span aria-hidden="true">/</span>
          <input
            id={id}
            required={definition.required}
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      </label>
    );
  }
  if (definition.type === 'number') {
    return (
      <label className="gs-field" htmlFor={id}>
        <span>{definition.label}</span>
        <input
          id={id}
          type="number"
          required={definition.required}
          min={definition.minimum}
          max={definition.maximum}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : event.target.valueAsNumber)
          }
        />
      </label>
    );
  }
  if (definition.type === 'boolean') {
    return (
      <label className="gs-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{definition.label}</span>
      </label>
    );
  }
  if (definition.type === 'enum') {
    return (
      <label className="gs-field" htmlFor={id}>
        <span>{definition.label}</span>
        <select
          id={id}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          {!definition.required ? <option value="">None</option> : null}
          {definition.values.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }
  if (structured) {
    return (
      <label className="gs-field" htmlFor={id}>
        <span>{definition.label} (structured JSON)</span>
        <textarea
          id={id}
          rows={6}
          aria-invalid={jsonError}
          value={jsonValue}
          onChange={(event) => {
            const next = event.target.value;
            setJsonValue(next);
            try {
              onChange(JSON.parse(next));
              setJsonError(false);
            } catch {
              setJsonError(true);
            }
          }}
        />
        {jsonError ? <small role="alert">Enter valid JSON before saving this field.</small> : null}
      </label>
    );
  }
  return (
    <label className="gs-field" htmlFor={id}>
      <span>{definition.label}</span>
      <input
        id={id}
        required={definition.required}
        minLength={definition.type === 'text' ? definition.minLength : undefined}
        maxLength={definition.type === 'text' ? definition.maxLength : undefined}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function initialFieldValue(field: FieldDefinition, titleField: string, suffix: string): unknown {
  if (field.type === 'component-tree') return undefined;
  if (field.type === 'slug') return `untitled-${suffix}`;
  if (field.name === titleField) return 'Untitled page';
  if (field.type === 'number') return field.minimum ?? 0;
  if (field.type === 'boolean') return false;
  if (field.type === 'enum') return field.values[0] ?? '';
  if (field.type === 'rich-text') return { version: 1, blocks: [] };
  if (field.type === 'asset') return undefined;
  if (field.type === 'array' || (field.type === 'relation' && field.multiple)) return [];
  if (field.type === 'taxonomy' && field.multiple) return [];
  if (field.type === 'object') return {};
  return '';
}

export interface AppProps {
  client?: GridStoryClient;
}

export function App({ client = defaultClient }: AppProps = {}): ReactNode {
  const [entries, setEntries] = useState<ContentEntry[]>([]);
  const [selected, setSelected] = useState<ContentEntry | null>(null);
  const [draft, setDraft] = useState<EditableContent | null>(null);
  const [published, setPublished] = useState<EditableContent | null>(null);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [schemas, setSchemas] = useState<ContentSchemaDefinition[]>([]);
  const [manifests, setManifests] = useState<ComponentManifest[]>(componentManifests);
  const [designSystem, setDesignSystem] = useState<DesignSystemManifest>(exampleDesignSystem);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetUsage, setAssetUsage] = useState<AssetUsageReport | null>(null);
  const [assetUploading, setAssetUploading] = useState(false);

  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [qualityReport, setQualityReport] = useState<ContentQualityReport | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [previewPerspective, setPreviewPerspective] = useState<PreviewPerspective>('draft');
  const [previewBreakpoint, setPreviewBreakpoint] = useState('desktop');
  const [externalPreview, setExternalPreview] = useState<ExternalPreviewState | null>(null);
  const previewControllerRef = useRef<GridStoryPreviewController | null>(null);
  const previewGrantRef = useRef<PreviewSessionGrant | null>(null);
  const previewPopupRef = useRef<Window | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const lastPreviewSlugRef = useRef<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [operationsDashboard, setOperationsDashboard] = useState<OperationsDashboardRecord | null>(
    null,
  );
  const [identitySnapshot, setIdentitySnapshot] = useState<IdentitySnapshot | null>(null);
  const [identityProviderId, setIdentityProviderId] = useState('');
  const [identityProviderIssuer, setIdentityProviderIssuer] = useState('');
  const [identityProviderName, setIdentityProviderName] = useState('');
  const [identityProviderProtocol, setIdentityProviderProtocol] = useState<'oidc' | 'saml'>('oidc');
  const [identityGroup, setIdentityGroup] = useState('');
  const [identityRole, setIdentityRole] = useState('');
  const [identityIncident, setIdentityIncident] = useState('');
  const [identityOneTimeSecret, setIdentityOneTimeSecret] = useState<string | null>(null);
  const [dataGovernance, setDataGovernance] = useState<GovernanceSnapshot | null>(null);
  const [governanceSubjectReference, setGovernanceSubjectReference] = useState('');
  const [governanceHoldMatter, setGovernanceHoldMatter] = useState('');
  const [governanceHoldReason, setGovernanceHoldReason] = useState('');
  const [governanceApprovalReason, setGovernanceApprovalReason] = useState('');
  const [governanceBackupReference, setGovernanceBackupReference] = useState('');
  const [governanceBackupSha, setGovernanceBackupSha] = useState('');
  const [migrationOverview, setMigrationOverview] = useState<MigrationOverviewRecord | null>(null);
  const [migrationSourceId, setMigrationSourceId] = useState('');
  const [migrationRecipeId, setMigrationRecipeId] = useState('');
  const [migrationRecipeName, setMigrationRecipeName] = useState('');
  const [migrationSourceType, setMigrationSourceType] = useState('');
  const [migrationTargetType, setMigrationTargetType] = useState('page');
  const [migrationMappings, setMigrationMappings] = useState(
    'title -> title -> string\nslug -> slug -> slug',
  );
  const [migrationPublicationMode, setMigrationPublicationMode] = useState<
    'draft' | 'mirror-source'
  >('draft');
  const [migrationProjectId, setMigrationProjectId] = useState('');
  const [migrationProjectName, setMigrationProjectName] = useState('');
  const [activeMigrationProjectId, setActiveMigrationProjectId] = useState('');
  const [migrationPlanReviewed, setMigrationPlanReviewed] = useState(false);
  const [marketplaceOverview, setMarketplaceOverview] = useState<MarketplaceOverviewRecord | null>(
    null,
  );
  const [marketplacePublisherId, setMarketplacePublisherId] = useState('');
  const [marketplacePublisherName, setMarketplacePublisherName] = useState('');
  const [marketplacePublisherDomain, setMarketplacePublisherDomain] = useState('');
  const [marketplacePublisherKeyId, setMarketplacePublisherKeyId] = useState('release-1');
  const [marketplacePublisherPublicKey, setMarketplacePublisherPublicKey] = useState('');
  const [marketplaceChallenge, setMarketplaceChallenge] = useState<{
    recordName: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const [marketplaceEvidenceReference, setMarketplaceEvidenceReference] = useState('');
  const [marketplaceReason, setMarketplaceReason] = useState('');
  const [marketplaceManifestJson, setMarketplaceManifestJson] = useState('');
  const [marketplaceArtifactReference, setMarketplaceArtifactReference] = useState('');
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [searchTaxonomies, setSearchTaxonomies] = useState<TaxonomyDefinition[]>([]);
  const [searchIndexStatus, setSearchIndexStatus] = useState<SearchIndexStatus | null>(null);
  const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([]);
  const [relatedContent, setRelatedContent] = useState<RelatedContentRecord[]>([]);
  const [componentGovernance, setComponentGovernance] = useState<ComponentGovernanceState | null>(
    null,
  );
  const [compositionHistory, setCompositionHistory] = useState(() => createCompositionHistory([]));
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [collaboration, setCollaboration] = useState<CollaborationSnapshot>(() =>
    emptyCollaborationSnapshot(),
  );
  const [collaborationBranchId, setCollaborationBranchId] = useState('main');
  const [collaborationBranchName, setCollaborationBranchName] = useState('');
  const [collaborationTargetField, setCollaborationTargetField] = useState('');
  const [collaborationSuggestionValue, setCollaborationSuggestionValue] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentAssignee, setCommentAssignee] = useState('');
  const [commentDueAt, setCommentDueAt] = useState('');
  const [commentTargetField, setCommentTargetField] = useState('');
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [workflowDefinitions, setWorkflowDefinitions] = useState<WorkflowDefinition[]>([]);
  const [workflowInstance, setWorkflowInstance] = useState<WorkflowInstance | null>(null);
  const [workflowScheduleAt, setWorkflowScheduleAt] = useState('');
  const [workflowDesignerOpen, setWorkflowDesignerOpen] = useState(false);
  const [workflowDesign, setWorkflowDesign] = useState<WorkflowDefinition | null>(null);
  const [workflowActionDeliveries, setWorkflowActionDeliveries] = useState<DurableJobRecord[]>([]);
  const [workflowTimeZone, setWorkflowTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [releasePanelOpen, setReleasePanelOpen] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseName, setReleaseName] = useState('');
  const [releaseEntryIds, setReleaseEntryIds] = useState<string[]>([]);
  const [activeReleaseId, setActiveReleaseId] = useState<string | null>(null);
  const [releasePreview, setReleasePreview] = useState<ReleasePreview | null>(null);
  const [releaseScheduleAt, setReleaseScheduleAt] = useState('');
  const [releaseTimeZone, setReleaseTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );

  const selectEntry = useCallback(
    async (id: string, componentFieldName?: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const [entry, history, publishedEntry, workflowState] = await Promise.all([
          client.getContent(id, { perspective: 'draft' }),
          client.listRevisions(id),
          client.getContent(id, { perspective: 'published' }).catch((error: unknown) => {
            if (error instanceof GridStoryApiError && error.status === 404) return null;
            throw error;
          }),
          client.getContentWorkflow(id),
        ]);
        setSelected(entry);
        setDraft(asEditableContent(entry));
        setPublished(publishedEntry ? asEditableContent(publishedEntry) : null);
        setRevisions(history);
        setWorkflowInstance(workflowState);
        setWorkflowScheduleAt('');
        setQualityReport(null);
        setCompositionHistory(createCompositionHistory(compositionFrom(entry, componentFieldName)));
        setDirty(false);
        setPreviewPerspective('draft');
      } catch (error) {
        setNotice({ tone: 'error', message: messageFrom(error) });
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const refreshList = useCallback(
    async (preferredId?: string) => {
      const result = await client.listContent({ contentType: 'page', perspective: 'draft' });
      setEntries(result);
      const target = preferredId ?? selected?.id ?? result[0]?.id;
      if (target) {
        const targetEntry = result.find((entry) => entry.id === target);
        const fieldName = schemas
          .find((schema) => schema.id === targetEntry?.contentType)
          ?.fields.find((field) => field.type === 'component-tree')?.name;
        await selectEntry(target, fieldName);
      } else setBusy(false);
    },
    [client, schemas, selectEntry, selected?.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setFatalError(null);
    setNotice(
      reloadToken > 0 ? { tone: 'info', message: 'Retrying the GridStory connection…' } : null,
    );
    Promise.all([
      client.listContent({ contentType: 'page', signal: controller.signal }),
      client.getComponentManifests(controller.signal),
      client.getSchemas(controller.signal),
      client.getDesignSystem(controller.signal),
      client.listAssets(controller.signal).catch(() => []),
      client.listWorkflows(controller.signal),
      client.listReleases(controller.signal).catch(() => []),
    ])
      .then(
        async ([
          entryList,
          manifestList,
          schemaList,
          designSystemManifest,
          assetList,
          workflowList,
          releaseList,
        ]) => {
          setEntries(entryList);
          setManifests(manifestList);
          setSchemas(schemaList);
          setDesignSystem(designSystemManifest);
          setAssets(assetList);
          setWorkflowDefinitions(workflowList);
          setReleases(releaseList);
          setActiveReleaseId(releaseList[0]?.id ?? null);
          if (entryList[0]) {
            const fieldName = schemaList
              .find((schema) => schema.id === entryList[0]?.contentType)
              ?.fields.find((field) => field.type === 'component-tree')?.name;
            await selectEntry(entryList[0].id, fieldName);
          } else setBusy(false);
        },
      )
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') {
          setNotice({ tone: 'error', message: messageFrom(error) });
          setFatalError(messageFrom(error));
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [client, reloadToken, selectEntry]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const manifestById = useMemo(
    () => new Map(manifests.map((manifest) => [manifest.id, manifest])),
    [manifests],
  );

  const assetChoices = useMemo<AssetReference[]>(
    () =>
      assets.flatMap((asset) => {
        const revision = asset.revisions.find(
          (candidate) => candidate.id === asset.currentRevisionId,
        );
        if (revision?.security?.status !== 'verified') return [];
        return [
          {
            id: asset.id,
            kind: asset.kind,
            url: revision.original.url,
            title: revision.metadata.title,
            ...(revision.metadata.alt ? { alt: revision.metadata.alt } : {}),
            mimeType: revision.original.mediaType,
            ...(revision.original.width ? { width: revision.original.width } : {}),
            ...(revision.original.height ? { height: revision.original.height } : {}),
          },
        ];
      }),
    [assets],
  );
  const activeSchema = useMemo(
    () => schemas.find((schema) => schema.id === selected?.contentType) ?? schemas[0],
    [schemas, selected?.contentType],
  );
  const activeRelease = releases.find((release) => release.id === activeReleaseId) ?? releases[0];
  const activeWorkflow = workflowDefinitions.find(
    (definition) => definition.id === workflowInstance?.workflowId,
  );
  const workflowState = activeWorkflow?.states.find(
    (state) => state.id === workflowInstance?.stateId,
  );
  const availableWorkflowTransitions =
    activeWorkflow?.transitions.filter(
      (transition) => transition.from === workflowInstance?.stateId,
    ) ?? [];
  const publishWorkflowTransition = availableWorkflowTransitions.find((transition) =>
    activeWorkflow?.states.some(
      (state) => state.id === transition.to && state.kind === 'published',
    ),
  );
  const componentField = activeSchema?.fields.find((field) => field.type === 'component-tree');
  const rootAccepts = useMemo(() => componentField?.accepts ?? [], [componentField]);
  const draftBlocks = compositionHistory.present;
  const compositionRules = useMemo(
    () => ({
      manifests,
      rootAccepts,
      rootMinimum: componentField?.minimum ?? 0,
      ...(componentField?.maximum !== undefined ? { rootMaximum: componentField.maximum } : {}),
    }),
    [componentField, manifests, rootAccepts],
  );
  const layers = useMemo(() => flattenLayers(draftBlocks), [draftBlocks]);
  const selectedNode = compositionHistory.selectedId
    ? findNode(draftBlocks, compositionHistory.selectedId)
    : undefined;
  const selectedManifest = selectedNode ? manifestById.get(selectedNode.component) : undefined;
  const selectedEntryId = selected?.id;
  const selectedCommentNodeId =
    commentTargetField === componentField?.name ? selectedNode?.id : undefined;
  const selectedPresenceNodeId =
    !commentTargetField || commentTargetField === componentField?.name
      ? selectedNode?.id
      : undefined;
  const selectedCollaborationNodeId =
    collaborationTargetField === componentField?.name ? selectedNode?.id : undefined;
  const selectedCollaborationValue = selectedCollaborationNodeId
    ? selectedNode
    : collaborationTargetField
      ? draft?.[collaborationTargetField]
      : undefined;

  useEffect(() => {
    if (!selectedEntryId) {
      setCollaboration(emptyCollaborationSnapshot());
      return;
    }
    const entryId = selectedEntryId;
    let active = true;
    const refresh = async () => {
      const [snapshot, presence] = await Promise.all([
        client.getCollaboration(entryId),
        client.heartbeatPresence(entryId, {
          displayName: 'Studio editor',
          ...(commentTargetField ? { field: commentTargetField } : {}),
          ...(selectedPresenceNodeId ? { nodeId: selectedPresenceNodeId } : {}),
        }),
      ]);
      if (active) setCollaboration({ ...snapshot, presence });
    };
    void refresh().catch(() => undefined);
    const interval = window.setInterval(() => void refresh().catch(() => undefined), 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      void client.leavePresence(entryId).catch(() => undefined);
    };
  }, [client, commentTargetField, selectedEntryId, selectedPresenceNodeId]);
  const selectedSymbol = selectedNode?.presentation?.symbol
    ? designSystem.symbols.find((symbol) => symbol.id === selectedNode.presentation?.symbol?.id)
    : undefined;
  const selectedVariants = selectedNode
    ? designSystem.variants.filter((variant) => variant.component === selectedNode.component)
    : [];
  const publishedBlocks = useMemo(
    () =>
      componentField && Array.isArray(published?.[componentField.name])
        ? (published[componentField.name] as ComponentNode[])
        : [],
    [componentField, published],
  );

  const refreshAssets = useCallback(async () => {
    setAssets(await client.listAssets());
  }, [client]);

  const uploadAssetFile = async (file: File) => {
    setAssetUploading(true);
    setAssetUsage(null);
    setNotice(null);
    try {
      const body = new Uint8Array(await file.arrayBuffer());
      const kind = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : 'file';
      const upload = await client.startAssetUpload({
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        size: body.byteLength,
        kind,
        metadata: { title: file.name },
      });
      const parts = [];
      for (let offset = 0, partNumber = 1; offset < body.byteLength; partNumber += 1) {
        const end = Math.min(offset + upload.partSize, body.byteLength);
        parts.push(await client.uploadAssetPart(upload.id, partNumber, body.subarray(offset, end)));
        offset = end;
      }
      await client.completeAssetUpload(upload.id, parts);
      await refreshAssets();
      setNotice({ tone: 'success', message: `${file.name} added to the asset library.` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setAssetUploading(false);
    }
  };

  const inspectAssetUsage = async (assetId: string) => {
    try {
      setAssetUsage(await client.getAssetUsage(assetId));
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const changeDraft = (updater: (current: EditableContent) => EditableContent) => {
    setDraft((current) => (current ? updater(current) : current));
    setDirty(true);
    setQualityReport(null);
    setNotice(null);
  };

  const replaceCollaborationThread = (thread: CollaborationSnapshot['threads'][number]) => {
    setCollaboration((current) => ({
      ...current,
      threads: current.threads.some((candidate) => candidate.id === thread.id)
        ? current.threads.map((candidate) => (candidate.id === thread.id ? thread : candidate))
        : [...current.threads, thread],
    }));
  };

  const createComment = async () => {
    if (!selected || !commentBody.trim()) return;
    try {
      const thread = await client.createCommentThread(selected.id, {
        target: {
          ...(commentTargetField ? { field: commentTargetField } : {}),
          ...(selectedCommentNodeId ? { nodeId: selectedCommentNodeId } : {}),
        },
        body: commentBody,
        ...(commentAssignee ? { assigneeId: commentAssignee } : {}),
        ...(commentDueAt ? { dueAt: new Date(commentDueAt).toISOString() } : {}),
      });
      replaceCollaborationThread(thread);
      setCommentBody('');
      setNotice({ tone: 'success', message: 'Comment thread created.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const replyToThread = async (threadId: string) => {
    if (!selected || !replyBodies[threadId]?.trim()) return;
    try {
      const thread = await client.replyToComment(selected.id, threadId, replyBodies[threadId]);
      replaceCollaborationThread(thread);
      setReplyBodies((current) => ({ ...current, [threadId]: '' }));
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const setThreadResolved = async (threadId: string, resolved: boolean) => {
    if (!selected) return;
    try {
      replaceCollaborationThread(
        await client.updateCommentThread(selected.id, threadId, { resolved }),
      );
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const refreshCollaboration = async () => {
    if (!selected) return;
    setCollaboration(await client.getCollaboration(selected.id));
  };

  const shareCollaborationValue = async () => {
    if (!selected || !collaborationTargetField || selectedCollaborationValue === undefined) return;
    try {
      await client.submitCollaborationOperation(selected.id, {
        branchId: collaborationBranchId,
        target: {
          field: collaborationTargetField,
          ...(selectedCollaborationNodeId ? { nodeId: selectedCollaborationNodeId } : {}),
        },
        value: collaborationJsonValue(selectedCollaborationValue),
      });
      await refreshCollaboration();
      setNotice({ tone: 'success', message: 'Current value shared with collaborators.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const createCollaborationBranch = async () => {
    if (!selected || !collaborationBranchName.trim()) return;
    try {
      const created = await client.createCollaborationBranch(selected.id, {
        name: collaborationBranchName,
        parentBranchId: collaborationBranchId,
      });
      setCollaborationBranchId(created.id);
      setCollaborationBranchName('');
      await refreshCollaboration();
      setNotice({ tone: 'success', message: `${created.name} branch created.` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const createCollaborationSuggestion = async () => {
    if (!selected || !collaborationTargetField || !collaborationSuggestionValue.trim()) return;
    try {
      await client.createCollaborationSuggestion(selected.id, {
        branchId: collaborationBranchId,
        target: {
          field: collaborationTargetField,
          ...(selectedCollaborationNodeId ? { nodeId: selectedCollaborationNodeId } : {}),
        },
        value: collaborationSuggestionValue,
      });
      setCollaborationSuggestionValue('');
      await refreshCollaboration();
      setNotice({ tone: 'success', message: 'Suggestion opened for review.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const reviewCollaborationSuggestion = async (
    suggestionId: string,
    decision: 'accept' | 'reject',
  ) => {
    if (!selected) return;
    try {
      await client.reviewCollaborationSuggestion(selected.id, suggestionId, decision);
      await refreshCollaboration();
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const mergeCollaborationBranch = async () => {
    if (!selected || collaborationBranchId === 'main') return;
    try {
      const merge = await client.mergeCollaborationBranch(selected.id, collaborationBranchId);
      await refreshCollaboration();
      setNotice({
        tone: merge.status === 'merged' ? 'success' : 'info',
        message:
          merge.status === 'merged'
            ? 'Branch merged into Main.'
            : `${merge.conflictIds.length} conflict${merge.conflictIds.length === 1 ? '' : 's'} need resolution.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const resolveCollaborationConflict = async (conflictId: string, operationId: string) => {
    if (!selected) return;
    try {
      await client.resolveCollaborationConflict(selected.id, conflictId, { operationId });
      await refreshCollaboration();
      setNotice({ tone: 'success', message: 'Conflict resolved.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const commitBlocks = (nodes: ComponentNode[], selectedId = compositionHistory.selectedId) => {
    if (!componentField) return;
    const nextHistory = commitComposition(compositionHistory, nodes, selectedId);
    if (nextHistory === compositionHistory) return;
    setCompositionHistory(nextHistory);
    changeDraft((current) => ({ ...current, [componentField.name]: nextHistory.present }));
  };

  const changeBlocks = (
    updater: (current: ComponentNode[]) => ComponentNode[],
    selectedId = compositionHistory.selectedId,
  ) => {
    commitBlocks(updater(draftBlocks), selectedId);
  };

  const applyComposition = (result: CompositionResult, selectedId?: string) => {
    if (!result.ok) {
      setNotice({ tone: 'error', message: result.error ?? 'Composition change was rejected.' });
      return;
    }
    commitBlocks(result.nodes, selectedId);
  };

  const restoreComposition = (direction: 'undo' | 'redo') => {
    if (!componentField) return;
    const restored =
      direction === 'undo'
        ? undoComposition(compositionHistory)
        : redoComposition(compositionHistory);
    if (restored === compositionHistory) return;
    setCompositionHistory(restored);
    changeDraft((current) => ({ ...current, [componentField.name]: restored.present }));
  };

  const targetAt = (location: ReturnType<typeof locateNode>, index: number): MoveTarget => ({
    ...(location?.parentId ? { parentId: location.parentId } : {}),
    ...(location?.slotName ? { slotName: location.slotName } : {}),
    index,
  });

  const moveByKeyboard = (id: string, key: string) => {
    const location = locateNode(draftBlocks, id);
    if (!location) return;
    if (key === 'ArrowUp') {
      applyComposition(
        moveNode(draftBlocks, id, targetAt(location, location.index - 1), compositionRules),
        id,
      );
    } else if (key === 'ArrowDown') {
      applyComposition(
        moveNode(draftBlocks, id, targetAt(location, location.index + 2), compositionRules),
        id,
      );
    } else if (key === 'ArrowLeft' && location.parentId) {
      const parentLocation = locateNode(draftBlocks, location.parentId);
      if (parentLocation) {
        applyComposition(
          moveNode(
            draftBlocks,
            id,
            targetAt(parentLocation, parentLocation.index + 1),
            compositionRules,
          ),
          id,
        );
      }
    } else if (key === 'ArrowRight' && location.index > 0) {
      const previous = layers.find(
        (layer) =>
          layer.location.parentId === location.parentId &&
          layer.location.slotName === location.slotName &&
          layer.location.index === location.index - 1,
      );
      const slot = previous
        ? manifestById
            .get(previous.node.component)
            ?.slots.find(
              (candidate) =>
                candidate.accepts.length === 0 ||
                candidate.accepts.includes(findNode(draftBlocks, id)?.component ?? ''),
            )
        : undefined;
      if (previous && slot) {
        applyComposition(
          moveNode(
            draftBlocks,
            id,
            {
              parentId: previous.node.id,
              slotName: slot.name,
              index: previous.node.slots?.[slot.name]?.length ?? 0,
            },
            compositionRules,
          ),
          id,
        );
      }
    } else if (key === 'Delete') {
      applyComposition(removeNode(draftBlocks, id, compositionRules));
    }
  };

  const editablePropsFor = (node: ComponentNode, manifest: ComponentManifest) => {
    const reference = node.presentation?.symbol;
    if (!reference || reference.detached) return manifest.props;
    const symbol = designSystem.symbols.find((candidate) => candidate.id === reference.id);
    if (!symbol) return manifest.props;
    return manifest.props.filter((prop) => symbol.allowedPropOverrides.includes(prop.name));
  };

  const changePresentation = (
    node: ComponentNode,
    updater: (
      current: NonNullable<ComponentNode['presentation']>,
    ) => NonNullable<ComponentNode['presentation']> | undefined,
  ) => {
    changeBlocks(
      (current) =>
        updateNodePresentation(
          current,
          node.id,
          updater({ designSystemVersion: designSystem.version, ...node.presentation }),
        ),
      node.id,
    );
  };

  const addTemplateAtRoot = (templateId: string) => {
    const template = designSystem.templates.find((candidate) => candidate.id === templateId);
    if (!template) return;
    const nodes = instantiateTemplate(template, () => crypto.randomUUID());
    let result: CompositionResult = { ok: true, nodes: draftBlocks };
    for (const node of nodes) {
      result = addNode(result.nodes, node, { index: result.nodes.length }, compositionRules);
      if (!result.ok) break;
    }
    applyComposition(result, result.ok ? nodes[0]?.id : undefined);
  };

  const addSymbolAtRoot = (symbolId: string) => {
    const symbol = designSystem.symbols.find((candidate) => candidate.id === symbolId);
    if (!symbol) return;
    const node = instantiateSymbol(symbol, designSystem.version, () => crypto.randomUUID());
    applyComposition(
      addNode(draftBlocks, node, { index: draftBlocks.length }, compositionRules),
      node.id,
    );
  };

  const requestSelectEntry = (id: string) => {
    if (dirty && !window.confirm('Discard the unsaved changes and open another content entry?')) {
      return;
    }
    void selectEntry(id, componentField?.name);
  };

  const createPage = async () => {
    if (dirty && !window.confirm('Discard the unsaved changes and create a new page?')) return;
    setBusy(true);
    try {
      const schema = schemas[0];
      if (!schema) throw new Error('No content schemas are registered.');
      const hero = manifests.find((manifest) => manifest.id === 'gridstory.hero') ?? manifests[0];
      if (!hero) throw new Error('No components are registered for a new page.');
      const suffix = Date.now().toString(36);
      const data = Object.fromEntries(
        schema.fields.map((field) => {
          if (field.type === 'component-tree') return [field.name, [newNode(hero)]];
          return [field.name, initialFieldValue(field, schema.titleField, suffix)];
        }),
      );
      const entry = await client.createContent(schema.id, data);
      await refreshList(entry.id);
      setNotice({ tone: 'success', message: 'Draft page created.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
      setBusy(false);
    }
  };

  const save = async (): Promise<ContentEntry | null> => {
    if (!selected || !draft) return null;
    setBusy(true);
    try {
      const updated = await client.saveDraft(selected.id, selected.draftRevisionId, draft);
      setSelected(updated);
      setEntries((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setRevisions(await client.listRevisions(updated.id));
      setWorkflowInstance(await client.getContentWorkflow(updated.id));
      setDirty(false);
      setNotice({ tone: 'success', message: 'Draft saved as a new immutable revision.' });
      return updated;
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const runQuality = async () => {
    if (!selected || !draft) return;
    setBusy(true);
    try {
      setQualityReport(await client.assessContentQuality(selected.id, draft));
      setNotice({ tone: 'info', message: 'Quality report refreshed for the current draft.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const toggleQuality = async () => {
    if (qualityReport) {
      setQualityReport(null);
      return;
    }
    await runQuality();
  };
  const publish = async () => {
    if (!selected || !draft) return;
    let publishable = selected;
    if (dirty) {
      const saved = await save();
      if (!saved) return;
      publishable = saved;
    }
    setBusy(true);
    try {
      const result = await client.publish(publishable.id, publishable.draftRevisionId);
      setSelected(result);
      setPublished(asEditableContent(result));
      setEntries((current) => current.map((entry) => (entry.id === result.id ? result : entry)));
      setWorkflowInstance(await client.getContentWorkflow(result.id));
      setNotice({
        tone: 'success',
        message: 'Published revision is now available to React applications.',
      });
    } catch (error) {
      if (
        error instanceof GridStoryApiError &&
        typeof error.details === 'object' &&
        error.details !== null &&
        'report' in error.details
      ) {
        setQualityReport((error.details as { report: ContentQualityReport }).report);
      }
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const runWorkflowTransition = async (transitionId: string) => {
    if (!selected) return;
    let entry = selected;
    if (dirty) {
      const saved = await save();
      if (!saved) return;
      entry = saved;
    }
    setBusy(true);
    try {
      const result = await client.requestWorkflowTransition(
        entry.id,
        transitionId,
        activeSchema?.fields.map((field) => field.name) ?? [],
      );
      setWorkflowInstance(result);
      setNotice({
        tone: 'success',
        message: result.pendingApproval
          ? 'Approval request sent to the configured reviewer roles.'
          : 'Workflow state updated.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const decideWorkflow = async (decision: 'approved' | 'rejected') => {
    if (!selected || !workflowInstance?.pendingApproval) return;
    if (dirty) {
      setNotice({ tone: 'error', message: 'Save or discard draft changes before reviewing.' });
      return;
    }
    setBusy(true);
    try {
      const result = await client.decideWorkflowApproval(
        selected.id,
        workflowInstance.pendingApproval.id,
        decision,
      );
      setWorkflowInstance(result);
      setNotice({
        tone: decision === 'approved' ? 'success' : 'info',
        message: decision === 'approved' ? 'Approval recorded.' : 'Changes requested.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const scheduleWorkflowTransition = async (transitionId: string) => {
    if (!selected || !workflowScheduleAt) return;
    const instant = new Date(workflowScheduleAt);
    if (!Number.isFinite(instant.getTime())) {
      setNotice({ tone: 'error', message: 'Choose a valid schedule date and time.' });
      return;
    }
    setBusy(true);
    try {
      const result = await client.scheduleWorkflowTransition(selected.id, {
        transitionId,
        runAt: instant.toISOString(),
        timeZone: workflowTimeZone,
      });
      setWorkflowInstance(result);
      setWorkflowScheduleAt('');
      setNotice({ tone: 'success', message: 'Workflow transition scheduled.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const cancelWorkflowSchedule = async (scheduleId: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      setWorkflowInstance(await client.cancelWorkflowSchedule(selected.id, scheduleId));
      setNotice({ tone: 'info', message: 'Workflow schedule cancelled.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const storeRelease = (release: Release) => {
    setReleases((current) => [
      release,
      ...current.filter((candidate) => candidate.id !== release.id),
    ]);
    setActiveReleaseId(release.id);
  };

  const createRelease = async () => {
    if (!releaseName.trim() || releaseEntryIds.length < 2) {
      setNotice({
        tone: 'error',
        message: 'Name the release and select at least two saved entries.',
      });
      return;
    }
    if (dirty && selected && releaseEntryIds.includes(selected.id)) {
      setNotice({
        tone: 'error',
        message: 'Save the selected draft before adding it to a release.',
      });
      return;
    }
    setBusy(true);
    try {
      const release = await client.createRelease({
        name: releaseName.trim(),
        entries: releaseEntryIds.map((entryId) => {
          const entry = entries.find((candidate) => candidate.id === entryId);
          if (!entry) throw new Error('A selected release entry is no longer available.');
          return { entryId, revisionId: entry.draftRevisionId };
        }),
        rollbackPolicy: { mode: 'manual' },
      });
      storeRelease(release);
      setReleaseName('');
      setReleaseEntryIds([]);
      setReleasePreview(null);
      setNotice({ tone: 'success', message: 'Release created from immutable draft revisions.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const validateActiveRelease = async () => {
    if (!activeRelease) return;
    setBusy(true);
    try {
      const release = await client.validateRelease(activeRelease.id);
      storeRelease(release);
      setNotice({
        tone: release.validation?.valid ? 'success' : 'error',
        message: release.validation?.valid
          ? 'Every pinned revision is ready for atomic publication.'
          : 'Release validation found blocking issues.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const previewActiveRelease = async () => {
    if (!activeRelease) return;
    setBusy(true);
    try {
      const release = await client.validateRelease(activeRelease.id);
      storeRelease(release);
      setReleasePreview(await client.previewRelease(activeRelease.id));
      setNotice({ tone: 'info', message: 'Future-state preview loaded from pinned revisions.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const scheduleActiveRelease = async () => {
    if (!activeRelease || !releaseScheduleAt) return;
    const instant = new Date(releaseScheduleAt);
    if (!Number.isFinite(instant.getTime())) {
      setNotice({ tone: 'error', message: 'Choose a valid release schedule date and time.' });
      return;
    }
    setBusy(true);
    try {
      storeRelease(
        await client.scheduleRelease(activeRelease.id, {
          runAt: instant.toISOString(),
          timeZone: releaseTimeZone,
        }),
      );
      setReleaseScheduleAt('');
      setNotice({ tone: 'success', message: 'Atomic release scheduled.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const cancelActiveReleaseSchedule = async () => {
    if (!activeRelease) return;
    setBusy(true);
    try {
      storeRelease(await client.cancelReleaseSchedule(activeRelease.id));
      setNotice({ tone: 'info', message: 'Release schedule cancelled.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const executeActiveRelease = async () => {
    if (!activeRelease) return;
    setBusy(true);
    try {
      storeRelease(await client.executeRelease(activeRelease.id));
      setReleasePreview(null);
      await refreshList(selected?.id);
      setNotice({ tone: 'success', message: 'All release revisions were published atomically.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const rollbackActiveRelease = async () => {
    if (!activeRelease) return;
    setBusy(true);
    try {
      storeRelease(
        await client.rollbackRelease(activeRelease.id, 'Rollback requested from GridStory Studio.'),
      );
      setReleasePreview(null);
      await refreshList(selected?.id);
      setNotice({
        tone: 'info',
        message: 'Every release member was restored to its prior revision.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };
  const refreshWorkflowActionDeliveries = async () => {
    const deliveries = await client.listWorkflowActions();
    setWorkflowActionDeliveries(deliveries);
  };

  const toggleWorkflowDesigner = async () => {
    if (workflowDesignerOpen) {
      setWorkflowDesignerOpen(false);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const definitions = await client.listWorkflows();
      setWorkflowDefinitions(definitions);
      setWorkflowDesign(definitions[0] ? structuredClone(definitions[0]) : null);
      await refreshWorkflowActionDeliveries();
      setWorkflowDesignerOpen(true);
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const addWorkflowAction = (transitionId: string, type: WorkflowActionDefinition['type']) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const action: WorkflowActionDefinition =
      type === 'notification'
        ? {
            id: `notify-${suffix}`,
            label: 'Notify reviewers',
            type,
            message: 'A workflow transition completed.',
            audienceRoles: ['publisher'],
            maxAttempts: 5,
          }
        : type === 'webhook'
          ? {
              id: `webhook-${suffix}`,
              label: 'Deliver webhook',
              type,
              url: 'https://hooks.example.com/gridstory',
              eventName: 'workflow-transition',
              maxAttempts: 8,
            }
          : {
              id: `cache-${suffix}`,
              label: 'Invalidate cache tags',
              type,
              tags: ['gridstory:workflow'],
              maxAttempts: 5,
            };
    setWorkflowDesign((current) =>
      current
        ? {
            ...current,
            transitions: current.transitions.map((transition) =>
              transition.id === transitionId
                ? { ...transition, actions: [...transition.actions, action] }
                : transition,
            ),
          }
        : current,
    );
  };

  const updateWorkflowAction = (
    transitionId: string,
    actionId: string,
    update: (action: WorkflowActionDefinition) => WorkflowActionDefinition,
  ) => {
    setWorkflowDesign((current) =>
      current
        ? {
            ...current,
            transitions: current.transitions.map((transition) =>
              transition.id === transitionId
                ? {
                    ...transition,
                    actions: transition.actions.map((action) =>
                      action.id === actionId ? update(action) : action,
                    ),
                  }
                : transition,
            ),
          }
        : current,
    );
  };

  const removeWorkflowAction = (transitionId: string, actionId: string) => {
    setWorkflowDesign((current) =>
      current
        ? {
            ...current,
            transitions: current.transitions.map((transition) =>
              transition.id === transitionId
                ? {
                    ...transition,
                    actions: transition.actions.filter((action) => action.id !== actionId),
                  }
                : transition,
            ),
          }
        : current,
    );
  };

  const saveWorkflowDesign = async () => {
    if (!workflowDesign) return;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await client.saveWorkflow(workflowDesign.id, {
        ...workflowDesign,
        version: workflowDesign.version + 1,
      });
      setWorkflowDesign(saved);
      setWorkflowDefinitions((current) => [
        saved,
        ...current.filter((definition) => definition.id !== saved.id),
      ]);
      setNotice({ tone: 'success', message: `Workflow version ${saved.version} saved.` });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const drainWorkflowActions = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await client.drainWorkflowActions(50);
      await refreshWorkflowActionDeliveries();
      setNotice({
        tone: 'success',
        message: `${result.delivery.completedJobs} workflow delivery job(s) completed; ${result.delivery.retriedJobs} retrying and ${result.delivery.deadJobs} dead.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const replayWorkflowAction = async (id: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await client.replayWorkflowAction(id);
      await refreshWorkflowActionDeliveries();
      setNotice({ tone: 'success', message: 'Workflow action queued for replay.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const refreshSearchContext = async () => {
    const selectedId = selected?.id;
    const [taxonomies, status, selectedBacklinks, selectedRelated] = await Promise.all([
      client.listTaxonomies(),
      client.getSearchIndexStatus(),
      selectedId ? client.listBacklinks(selectedId, 'draft') : Promise.resolve([]),
      selectedId
        ? client.listRelatedContent(selectedId, { perspective: 'draft', limit: 8 })
        : Promise.resolve([]),
    ]);
    setSearchTaxonomies(taxonomies);
    setSearchIndexStatus(status);
    setBacklinks(selectedBacklinks);
    setRelatedContent(selectedRelated);
  };

  const runSearch = async () => {
    setSearchBusy(true);
    setNotice(null);
    try {
      setSearchResponse(await client.search({ text: searchText, perspective: 'draft', first: 20 }));
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setSearchBusy(false);
    }
  };

  const toggleSearchPanel = async () => {
    if (searchPanelOpen) {
      setSearchPanelOpen(false);
      return;
    }
    setSearchPanelOpen(true);
    setSearchBusy(true);
    setNotice(null);
    try {
      await Promise.all([refreshSearchContext(), runSearch()]);
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setSearchBusy(false);
    }
  };

  const rebuildSearchIndex = async () => {
    setSearchBusy(true);
    setNotice(null);
    try {
      await client.rebuildSearchIndex('draft');
      const result = await client.drainOperations(100);
      await refreshSearchContext();
      setNotice({
        tone: 'success',
        message: `Search rebuild completed with ${result.completedJobs} durable job(s).`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setSearchBusy(false);
    }
  };
  const toggleOperations = async () => {
    if (operationsDashboard) {
      setOperationsDashboard(null);
      return;
    }
    try {
      setOperationsDashboard(await client.getOperationsDashboard());
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const refreshIdentity = async () => {
    setIdentitySnapshot(await client.getIdentity());
  };
  const refreshDataGovernance = async () => {
    setDataGovernance(await client.getGovernance());
  };
  const toggleDataGovernance = async () => {
    if (dataGovernance) {
      setDataGovernance(null);
      return;
    }
    try {
      await refreshDataGovernance();
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const registerDataSubject = async () => {
    if (!governanceSubjectReference.trim()) {
      setNotice({ tone: 'error', message: 'A bounded data-subject reference is required.' });
      return;
    }
    try {
      await client.createDataSubject(governanceSubjectReference.trim());
      setGovernanceSubjectReference('');
      await refreshDataGovernance();
      setNotice({ tone: 'success', message: 'Data subject registered in this exact scope.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const createScopeHold = async () => {
    if (!governanceHoldMatter.trim() || !governanceHoldReason.trim()) {
      setNotice({ tone: 'error', message: 'A hold matter and reason are required.' });
      return;
    }
    try {
      await client.createLegalHold({
        matter: governanceHoldMatter.trim(),
        reason: governanceHoldReason.trim(),
        target: { kind: 'scope' },
      });
      setGovernanceHoldMatter('');
      setGovernanceHoldReason('');
      await refreshDataGovernance();
      setNotice({ tone: 'success', message: 'Legal hold activated for this exact scope.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const previewRetention = async () => {
    try {
      await client.createRetentionPlan();
      await refreshDataGovernance();
      setNotice({ tone: 'info', message: 'Dry-run retention plan created. No data was erased.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const approveGovernancePlan = async (plan: GovernancePlan) => {
    if (!governanceApprovalReason.trim() || !governanceBackupReference.trim()) {
      setNotice({
        tone: 'error',
        message: 'Approval reason and verified backup reference are required.',
      });
      return;
    }
    try {
      await client.approveGovernancePlan(plan.id, {
        digest: plan.digest,
        reason: governanceApprovalReason.trim(),
        backup: {
          reference: governanceBackupReference.trim(),
          sha256: governanceBackupSha.trim(),
          verifiedAt: new Date().toISOString(),
        },
      });
      await refreshDataGovernance();
      setNotice({ tone: 'success', message: 'Plan approved for asynchronous guarded execution.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const refreshMigrations = async () => {
    const overview = await client.getMigrations();
    setMigrationOverview(overview);
    setMigrationSourceId((current) => current || overview.sources[0]?.id || '');
    setActiveMigrationProjectId((current) => current || overview.projects[0]?.id || '');
  };
  const toggleMigrations = async () => {
    if (migrationOverview) {
      setMigrationOverview(null);
      setMigrationPlanReviewed(false);
      return;
    }
    try {
      await refreshMigrations();
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const parsedMigrationFields = (): MigrationRecipeInput['fields'] => {
    const transforms = new Set(['copy', 'string', 'number', 'boolean', 'slug']);
    return migrationMappings
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sourcePath, targetField, requestedTransform = 'copy'] = line
          .split('->')
          .map((part) => part.trim());
        if (!sourcePath || !targetField || !transforms.has(requestedTransform)) {
          throw new Error(
            'Each field mapping must be `source.path -> targetField -> copy|string|number|boolean|slug`.',
          );
        }
        return {
          sourcePath,
          targetField,
          transform: requestedTransform as MigrationRecipeInput['fields'][number]['transform'],
          required: true,
        };
      });
  };
  const saveMigrationRecipe = async () => {
    const source = migrationOverview?.sources.find(
      (candidate) => candidate.id === migrationSourceId,
    );
    if (
      !source ||
      !migrationRecipeId.trim() ||
      !migrationRecipeName.trim() ||
      !migrationSourceType.trim() ||
      !migrationTargetType.trim()
    ) {
      setNotice({ tone: 'error', message: 'Source and complete recipe identity are required.' });
      return;
    }
    try {
      await client.saveMigrationRecipe({
        id: migrationRecipeId.trim(),
        name: migrationRecipeName.trim(),
        provider: source.provider,
        sourceType: migrationSourceType.trim(),
        targetContentType: migrationTargetType.trim(),
        publicationMode: migrationPublicationMode,
        fields: parsedMigrationFields(),
      });
      await refreshMigrations();
      setNotice({ tone: 'success', message: 'Versioned migration recipe saved.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const createMigrationProject = async () => {
    if (
      !migrationSourceId ||
      !migrationRecipeId.trim() ||
      !migrationProjectId.trim() ||
      !migrationProjectName.trim()
    ) {
      setNotice({ tone: 'error', message: 'Source, recipe, project ID, and name are required.' });
      return;
    }
    try {
      const project = await client.createMigrationProject({
        id: migrationProjectId.trim(),
        name: migrationProjectName.trim(),
        sourceId: migrationSourceId,
        recipeIds: [migrationRecipeId.trim()],
        mode: 'dual-run',
      });
      setActiveMigrationProjectId(project.id);
      await refreshMigrations();
      setNotice({ tone: 'success', message: 'Dual-run migration project created.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const setMigrationProjectState = async (state: 'active' | 'paused') => {
    if (!activeMigrationProjectId) return;
    try {
      await client.setMigrationProjectState(activeMigrationProjectId, state);
      await refreshMigrations();
      setNotice({
        tone: state === 'paused' ? 'info' : 'success',
        message: `Migration project ${state === 'paused' ? 'paused' : 'resumed'}.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const previewMigrationSync = async () => {
    if (!activeMigrationProjectId) return;
    try {
      await client.createMigrationPlan(activeMigrationProjectId);
      setMigrationPlanReviewed(false);
      await refreshMigrations();
      setNotice({
        tone: 'info',
        message: 'Dry-run sync plan created. Target content is unchanged.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const executeMigrationPlan = async (plan: MigrationPlanSummary) => {
    if (!migrationPlanReviewed) {
      setNotice({
        tone: 'error',
        message: 'Review the exact digest and effects before execution.',
      });
      return;
    }
    try {
      await client.executeMigrationPlan(plan.id, plan.digest);
      setMigrationPlanReviewed(false);
      await Promise.all([refreshMigrations(), refreshList()]);
      setNotice({ tone: 'success', message: 'Migration plan completed with a durable receipt.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const validateMigrationCutover = async () => {
    if (!activeMigrationProjectId) return;
    try {
      const report = await client.validateMigrationCutover(activeMigrationProjectId);
      await refreshMigrations();
      setNotice({
        tone: report.ready ? 'success' : 'info',
        message: report.ready
          ? 'Content cutover checks are current. Traffic switching remains external.'
          : `Cutover remains blocked by ${report.blockers.length} observed issue(s).`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const refreshMarketplace = async () => {
    setMarketplaceOverview(await client.getMarketplace());
  };
  const toggleMarketplace = async () => {
    if (marketplaceOverview) {
      setMarketplaceOverview(null);
      setMarketplaceChallenge(null);
      return;
    }
    try {
      await refreshMarketplace();
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const registerMarketplacePublisher = async () => {
    if (
      !marketplacePublisherId.trim() ||
      !marketplacePublisherName.trim() ||
      !marketplacePublisherDomain.trim() ||
      !marketplacePublisherKeyId.trim() ||
      !marketplacePublisherPublicKey.trim()
    ) {
      setNotice({
        tone: 'error',
        message: 'Publisher identity, domain, and Ed25519 key are required.',
      });
      return;
    }
    try {
      const domain = marketplacePublisherDomain.trim().toLowerCase();
      await client.registerMarketplacePublisher({
        id: marketplacePublisherId.trim(),
        displayName: marketplacePublisherName.trim(),
        domain,
        websiteUrl: `https://${domain}`,
        supportUrl: `https://${domain}/support`,
        key: {
          keyId: marketplacePublisherKeyId.trim(),
          algorithm: 'ed25519',
          publicKey: marketplacePublisherPublicKey.trim(),
        },
      });
      await refreshMarketplace();
      setNotice({
        tone: 'success',
        message:
          'Publisher registered as pending. Domain proof and a distinct reviewer are still required.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const issueMarketplaceChallenge = async (publisherId: string) => {
    try {
      const challenge = await client.issueMarketplacePublisherChallenge(publisherId);
      setMarketplaceChallenge(challenge);
      setNotice({ tone: 'info', message: 'Publish the exact TXT value before it expires.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const verifyMarketplaceDomain = async (publisherId: string) => {
    try {
      await client.verifyMarketplacePublisherDomain(publisherId);
      setMarketplaceChallenge(null);
      await refreshMarketplace();
      setNotice({
        tone: 'success',
        message: 'Domain possession verified; human approval remains separate.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const approveMarketplacePublisher = async (publisherId: string) => {
    if (!marketplaceEvidenceReference.trim() || !marketplaceReason.trim()) {
      setNotice({
        tone: 'error',
        message: 'Publisher evidence reference and review reason are required.',
      });
      return;
    }
    try {
      await client.approveMarketplacePublisher(publisherId, {
        evidenceReference: marketplaceEvidenceReference.trim(),
        reason: marketplaceReason.trim(),
      });
      await refreshMarketplace();
      setNotice({
        tone: 'success',
        message: 'Publisher verified by a distinct accountable reviewer.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const suspendMarketplacePublisher = async (publisherId: string) => {
    if (!marketplaceReason.trim()) {
      setNotice({ tone: 'error', message: 'A suspension reason is required.' });
      return;
    }
    try {
      await client.suspendMarketplacePublisher(publisherId, marketplaceReason.trim());
      await refreshMarketplace();
      setNotice({
        tone: 'info',
        message: 'Publisher trust suspended for future reviews and installs.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const submitMarketplaceRelease = async () => {
    if (!marketplaceManifestJson.trim() || !marketplaceArtifactReference.trim()) {
      setNotice({
        tone: 'error',
        message: 'A signed manifest and opaque artifact reference are required.',
      });
      return;
    }
    try {
      const manifest = JSON.parse(marketplaceManifestJson) as SignedPluginManifest;
      await client.submitMarketplaceRelease({
        manifest,
        artifactReference: marketplaceArtifactReference.trim(),
      });
      await refreshMarketplace();
      setNotice({
        tone: 'success',
        message: 'Immutable signed release submitted. No artifact code was loaded or executed.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const reviewMarketplaceRelease = async (releaseId: string) => {
    try {
      await client.reviewMarketplaceRelease(releaseId);
      await refreshMarketplace();
      setNotice({
        tone: 'info',
        message: 'Trusted automated evidence recorded; human approval remains separate.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const decideMarketplaceRelease = async (
    releaseId: string,
    decision: 'approve' | 'reject' | 'yank',
  ) => {
    if (!marketplaceReason.trim()) {
      setNotice({ tone: 'error', message: 'A review decision reason is required.' });
      return;
    }
    try {
      await client.decideMarketplaceRelease(releaseId, decision, marketplaceReason.trim());
      await refreshMarketplace();
      setNotice({
        tone: decision === 'approve' ? 'success' : 'info',
        message: `Marketplace release ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'yanked'}.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const installMarketplaceRelease = async (releaseId: string) => {
    try {
      await client.installMarketplaceRelease({
        releaseId,
        grantedCapabilities: [],
        reason: 'Install reviewed marketplace metadata without capability grants.',
      });
      setNotice({
        tone: 'success',
        message:
          'Release installed disabled with no grants. Enablement and runtime isolation remain separate.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const toggleIdentity = async () => {
    if (identitySnapshot) {
      setIdentitySnapshot(null);
      setIdentityOneTimeSecret(null);
      return;
    }
    try {
      await refreshIdentity();
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const configureIdentityProvider = async () => {
    if (
      !identityProviderId.trim() ||
      !identityProviderIssuer.trim() ||
      !identityProviderName.trim()
    ) {
      setNotice({ tone: 'error', message: 'Provider ID, issuer, and display name are required.' });
      return;
    }
    try {
      await client.configureIdentityProvider({
        id: identityProviderId.trim(),
        protocol: identityProviderProtocol,
        issuer: identityProviderIssuer.trim(),
        displayName: identityProviderName.trim(),
        enabled: true,
        allowJitProvisioning: false,
      });
      await refreshIdentity();
      setNotice({ tone: 'success', message: 'Enterprise identity provider configured.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const saveIdentityPolicy = async () => {
    if (!identitySnapshot) return;
    try {
      await client.updateSessionPolicy(identitySnapshot.policy);
      await refreshIdentity();
      setNotice({ tone: 'success', message: 'Session policy saved.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const createIdentityMapping = async () => {
    if (!identityGroup.trim() || !identityRole.trim()) {
      setNotice({ tone: 'error', message: 'External group and GridStory role are required.' });
      return;
    }
    try {
      await client.createGroupRoleMapping({
        id: `mapping-${Date.now()}`,
        externalGroup: identityGroup.trim(),
        roleId: identityRole.trim(),
        createdBy: 'studio-identity-admin',
      });
      await refreshIdentity();
      setNotice({ tone: 'success', message: 'Group-to-role mapping created.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const issueDirectoryCredential = async () => {
    try {
      const credential = await client.issueDirectoryCredential('Studio-created SCIM credential');
      setIdentityOneTimeSecret(credential.token);
      setNotice({ tone: 'success', message: 'Directory credential issued. Copy it now.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const issueBreakGlassCredential = async () => {
    if (!identityIncident.trim()) {
      setNotice({ tone: 'error', message: 'An incident ID is required for break-glass access.' });
      return;
    }
    try {
      const credential = await client.createBreakGlassCredential({
        name: `Emergency access for ${identityIncident.trim()}`,
        roleId: 'admin',
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
        incidentId: identityIncident.trim(),
      });
      setIdentityOneTimeSecret(credential.token);
      await refreshIdentity();
      setNotice({ tone: 'success', message: 'One-time break-glass credential issued.' });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };
  const inspectComponent = async (componentId?: string) => {
    if (!componentId) {
      setComponentGovernance(null);
      return;
    }
    try {
      const [migration, visual] = await Promise.all([
        client.getComponentMigration(componentId),
        client.getComponentVisualRegression(componentId),
      ]);
      setComponentGovernance({ componentId, migration, visual });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  const toggleComponentGovernance = async () => {
    if (componentGovernance) {
      setComponentGovernance(null);
      return;
    }
    await inspectComponent(manifests[0]?.id);
  };

  const migrateComponentEntry = async (
    entryId: string,
    componentId: string,
    revisionId: string,
  ) => {
    if (dirty && selected?.id === entryId) {
      setNotice({
        tone: 'error',
        message: 'Save or discard local edits before migrating this entry.',
      });
      return;
    }
    setBusy(true);
    try {
      const result = await client.migrateEntryComponent(entryId, componentId, revisionId);
      await inspectComponent(componentId);
      await refreshList(result.entry.id);
      setNotice({
        tone: 'success',
        message: `Migrated ${result.migratedInstances} component instance${result.migratedInstances === 1 ? '' : 's'} to the current version.`,
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
    }
  };

  const previewContent = previewPerspective === 'draft' ? draft : published;
  const previewBlocks = previewPerspective === 'draft' ? draftBlocks : publishedBlocks;
  const slugField = activeSchema?.fields.find((field) => field.type === 'slug');
  const previewSlug = String(previewContent?.[slugField?.name ?? 'slug'] ?? 'preview');

  const closeExternalPreview = useCallback(async () => {
    previewControllerRef.current?.dispose();
    previewControllerRef.current = null;
    const grant = previewGrantRef.current;
    previewGrantRef.current = null;
    lastPreviewSlugRef.current = null;
    const popup = previewPopupRef.current;
    previewPopupRef.current = null;
    if (popup && !popup.closed) popup.close();
    setExternalPreview(null);
    if (grant) {
      try {
        await client.revokePreviewSession(grant.sessionId);
      } catch (error) {
        setNotice({ tone: 'error', message: messageFrom(error) });
      }
    }
  }, [client]);

  const connectPreviewTarget = useCallback((targetWindow: Window, grant: PreviewSessionGrant) => {
    previewControllerRef.current?.dispose();
    const controller = createGridStoryPreviewController({
      grant,
      targetWindow,
      onReady: () => {
        setExternalPreview((current) =>
          current?.grant.sessionId === grant.sessionId ? { ...current, ready: true } : current,
        );
      },
      onNavigate: (message) => {
        setExternalPreview((current) =>
          current?.grant.sessionId === grant.sessionId
            ? { ...current, route: message.payload.route }
            : current,
        );
      },
      onSelect: (message) => {
        const nodeId = message.payload.nodeId;
        if (!nodeId) return;
        setCompositionHistory((current) =>
          findNode(current.present, nodeId) ? { ...current, selectedId: nodeId } : current,
        );
      },
      onError: (message) => setNotice({ tone: 'error', message: message.payload.message }),
    });
    previewControllerRef.current = controller;
    controller.start();
  }, []);

  const startExternalPreview = async (mode: 'iframe' | 'standalone') => {
    if (!selected || !draft) return;
    setPreviewPerspective('draft');
    const popup =
      mode === 'standalone'
        ? window.open('about:blank', 'gridstory-standalone-preview', 'popup,width=1280,height=900')
        : null;
    if (mode === 'standalone' && !popup) {
      setNotice({ tone: 'error', message: 'The standalone preview popup was blocked.' });
      return;
    }
    await closeExternalPreview();
    const route = previewSlug.startsWith('/') ? previewSlug : `/${previewSlug}`;
    try {
      const grant = await client.createPreviewSession({
        previewUrl: import.meta.env.VITE_GRIDSTORY_PREVIEW_URL ?? 'http://localhost:5174/',
        route,
        mode,
        entryId: selected.id,
      });
      previewGrantRef.current = grant;
      setExternalPreview({ grant, mode, entryId: selected.id, route, ready: false });
      if (popup) {
        previewPopupRef.current = popup;
        popup.location.replace(grant.previewUrl);
        connectPreviewTarget(popup, grant);
      }
    } catch (error) {
      popup?.close();
      setNotice({ tone: 'error', message: messageFrom(error) });
    }
  };

  useEffect(() => {
    if (
      externalPreview?.mode !== 'iframe' ||
      previewControllerRef.current ||
      !previewFrameRef.current?.contentWindow
    ) {
      return;
    }
    connectPreviewTarget(previewFrameRef.current.contentWindow, externalPreview.grant);
  }, [connectPreviewTarget, externalPreview]);

  useEffect(() => {
    const controller = previewControllerRef.current;
    const sessionId = externalPreview?.grant.sessionId;
    if (!controller || !sessionId || !selected || !draft) return;
    if (lastPreviewSlugRef.current !== previewSlug) {
      const route = previewSlug.startsWith('/') ? previewSlug : `/${previewSlug}`;
      lastPreviewSlugRef.current = previewSlug;
      controller.navigate(route);
      setExternalPreview((current) =>
        current?.grant.sessionId === sessionId ? { ...current, route } : current,
      );
    }
    controller.patch({
      entryId: selected.id,
      contentType: selected.contentType,
      data: draft,
      revisionId: selected.draftRevisionId,
    });
  }, [draft, externalPreview?.grant.sessionId, previewSlug, selected]);

  useEffect(() => {
    if (externalPreview && externalPreview.entryId !== selected?.id) {
      void closeExternalPreview();
    }
  }, [closeExternalPreview, externalPreview, selected?.id]);

  useEffect(
    () => () => {
      previewControllerRef.current?.dispose();
      const grant = previewGrantRef.current;
      if (grant) void client.revokePreviewSession(grant.sessionId).catch(() => undefined);
      const popup = previewPopupRef.current;
      if (popup && !popup.closed) popup.close();
    },
    [client],
  );

  return (
    <div className="studio-shell">
      <a className="skip-link" href="#studio-editor" tabIndex={0}>
        Skip to page editor
      </a>
      <header className="studio-header">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-copy">
          <p>GridStory</p>
          <span>Local Studio · default tenant</span>
        </div>
        <div className="header-actions">
          <span className={`save-state ${dirty ? 'save-state--dirty' : ''}`}>
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleWorkflowDesigner()}
            aria-expanded={workflowDesignerOpen}
          >
            Workflows
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setReleasePanelOpen((current) => !current)}
            aria-expanded={releasePanelOpen}
          >
            Releases
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleSearchPanel()}
            aria-expanded={searchPanelOpen}
          >
            Search
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleOperations()}
            aria-expanded={operationsDashboard !== null}
          >
            Operations
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleIdentity()}
            aria-expanded={identitySnapshot !== null}
          >
            Identity
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleDataGovernance()}
            aria-expanded={dataGovernance !== null}
          >
            Data governance
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleMigrations()}
            aria-expanded={migrationOverview !== null}
          >
            Migrations
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleMarketplace()}
            aria-expanded={marketplaceOverview !== null}
          >
            Marketplace
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleComponentGovernance()}
            aria-expanded={componentGovernance !== null}
          >
            Components
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setAssetLibraryOpen((current) => !current)}
            aria-expanded={assetLibraryOpen}
          >
            Assets
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void toggleQuality()}
            aria-expanded={qualityReport !== null}
            disabled={!selected || busy}
          >
            Quality
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void save()}
            disabled={!dirty || busy}
          >
            Save draft
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void publish()}
            disabled={!selected || busy || !publishWorkflowTransition}
          >
            Publish
          </button>
        </div>
      </header>
      {workflowDesignerOpen ? (
        <section className="workflow-designer" aria-label="Workflow action designer">
          <div className="section-heading">
            <div>
              <span className="kicker">Durable automation</span>
              <h2>Workflow action designer</h2>
              <p>
                Attach scoped side effects to completed transitions, then inspect every leased
                delivery, retry, and dead letter.
              </p>
            </div>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => void drainWorkflowActions()}
            >
              Run due actions
            </button>
          </div>

          <div className="workflow-designer-layout">
            <div className="workflow-definition-editor">
              <div className="workflow-designer-toolbar">
                <label className="gs-field">
                  <span>Workflow</span>
                  <select
                    value={workflowDesign?.id ?? ''}
                    onChange={(event) => {
                      const definition = workflowDefinitions.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      setWorkflowDesign(definition ? structuredClone(definition) : null);
                    }}
                  >
                    {workflowDefinitions.map((definition) => (
                      <option key={definition.id} value={definition.id}>
                        {definition.name} · v{definition.version}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!workflowDesign || busy}
                  onClick={() => void saveWorkflowDesign()}
                >
                  Save next version
                </button>
              </div>

              {workflowDesign ? (
                <>
                  <ul className="workflow-state-map" aria-label="Workflow states">
                    {workflowDesign.states.map((state) => (
                      <li
                        className={`workflow-state-node workflow-state-node--${state.kind}`}
                        key={state.id}
                      >
                        <strong>{state.label}</strong>
                        <code>{state.id}</code>
                      </li>
                    ))}
                  </ul>
                  <div className="workflow-transition-list">
                    {workflowDesign.transitions.map((transition) => (
                      <article className="workflow-transition-card" key={transition.id}>
                        <div className="workflow-transition-heading">
                          <div>
                            <strong>{transition.label}</strong>
                            <span>
                              {transition.from} → {transition.to}
                            </span>
                          </div>
                          <code>{transition.id}</code>
                        </div>
                        <fieldset className="workflow-action-adders">
                          <legend>Add actions to {transition.label}</legend>
                          <button
                            type="button"
                            onClick={() => addWorkflowAction(transition.id, 'notification')}
                          >
                            + Notification
                          </button>
                          <button
                            type="button"
                            onClick={() => addWorkflowAction(transition.id, 'webhook')}
                          >
                            + Webhook
                          </button>
                          <button
                            type="button"
                            onClick={() => addWorkflowAction(transition.id, 'cache-invalidate')}
                          >
                            + Cache tags
                          </button>
                        </fieldset>
                        {transition.actions.length ? (
                          <ul className="workflow-action-definitions">
                            {transition.actions.map((action) => (
                              <li key={action.id}>
                                <div className="workflow-action-definition-heading">
                                  <span className="workflow-action-kind">{action.type}</span>
                                  <button
                                    type="button"
                                    className="text-button text-button--danger"
                                    onClick={() => removeWorkflowAction(transition.id, action.id)}
                                  >
                                    Remove
                                  </button>
                                </div>
                                <label className="gs-field">
                                  <span>Action label</span>
                                  <input
                                    aria-label={`${transition.label} ${action.id} label`}
                                    value={action.label}
                                    onChange={(event) =>
                                      updateWorkflowAction(transition.id, action.id, (current) => ({
                                        ...current,
                                        label: event.target.value,
                                      }))
                                    }
                                  />
                                </label>
                                {action.type === 'notification' ? (
                                  <>
                                    <label className="gs-field">
                                      <span>Message</span>
                                      <input
                                        value={action.message}
                                        onChange={(event) =>
                                          updateWorkflowAction(
                                            transition.id,
                                            action.id,
                                            (current) =>
                                              current.type === 'notification'
                                                ? { ...current, message: event.target.value }
                                                : current,
                                          )
                                        }
                                      />
                                    </label>
                                    <label className="gs-field">
                                      <span>Audience roles</span>
                                      <input
                                        value={action.audienceRoles.join(', ')}
                                        onChange={(event) =>
                                          updateWorkflowAction(
                                            transition.id,
                                            action.id,
                                            (current) =>
                                              current.type === 'notification'
                                                ? {
                                                    ...current,
                                                    audienceRoles: event.target.value
                                                      .split(',')
                                                      .map((role) => role.trim())
                                                      .filter(Boolean),
                                                  }
                                                : current,
                                          )
                                        }
                                      />
                                    </label>
                                  </>
                                ) : action.type === 'webhook' ? (
                                  <>
                                    <label className="gs-field">
                                      <span>HTTPS endpoint</span>
                                      <input
                                        value={action.url}
                                        onChange={(event) =>
                                          updateWorkflowAction(
                                            transition.id,
                                            action.id,
                                            (current) =>
                                              current.type === 'webhook'
                                                ? { ...current, url: event.target.value }
                                                : current,
                                          )
                                        }
                                      />
                                    </label>
                                    <label className="gs-field">
                                      <span>Event name</span>
                                      <input
                                        value={action.eventName}
                                        onChange={(event) =>
                                          updateWorkflowAction(
                                            transition.id,
                                            action.id,
                                            (current) =>
                                              current.type === 'webhook'
                                                ? { ...current, eventName: event.target.value }
                                                : current,
                                          )
                                        }
                                      />
                                    </label>
                                  </>
                                ) : (
                                  <label className="gs-field">
                                    <span>Cache tags</span>
                                    <input
                                      value={action.tags.join(', ')}
                                      onChange={(event) =>
                                        updateWorkflowAction(transition.id, action.id, (current) =>
                                          current.type === 'cache-invalidate'
                                            ? {
                                                ...current,
                                                tags: event.target.value
                                                  .split(',')
                                                  .map((tag) => tag.trim())
                                                  .filter(Boolean),
                                              }
                                            : current,
                                        )
                                      }
                                    />
                                  </label>
                                )}
                                <label className="gs-field workflow-attempt-field">
                                  <span>Maximum attempts</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={action.maxAttempts}
                                    onChange={(event) =>
                                      updateWorkflowAction(transition.id, action.id, (current) => ({
                                        ...current,
                                        maxAttempts: Number(event.target.value),
                                      }))
                                    }
                                  />
                                </label>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="empty-copy">No durable actions on this transition.</p>
                        )}
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <p className="empty-copy">No workflow definition is available.</p>
              )}
            </div>

            <aside className="workflow-delivery-log" aria-label="Workflow action delivery log">
              <div className="workflow-delivery-log-heading">
                <div>
                  <span className="kicker">Delivery log</span>
                  <h3>Attempts and dead letters</h3>
                </div>
                <span>{workflowActionDeliveries.length}</span>
              </div>
              {workflowActionDeliveries.length ? (
                <ol>
                  {workflowActionDeliveries.map((delivery) => (
                    <li key={delivery.id}>
                      <div>
                        <strong>
                          {String(
                            delivery.payload.action &&
                              typeof delivery.payload.action === 'object' &&
                              'label' in delivery.payload.action
                              ? delivery.payload.action.label
                              : 'Workflow action',
                          )}
                        </strong>
                        <span
                          className={`workflow-delivery-state workflow-delivery-state--${delivery.state}`}
                        >
                          {delivery.state}
                        </span>
                      </div>
                      <code>{delivery.idempotencyKey}</code>
                      <small>
                        {delivery.attempts}/{delivery.maxAttempts} attempt(s) ·{' '}
                        {new Date(delivery.updatedAt).toLocaleString()}
                      </small>
                      {delivery.lastError ? <p>{delivery.lastError}</p> : null}
                      {delivery.state === 'dead' || delivery.state === 'succeeded' ? (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => void replayWorkflowAction(delivery.id)}
                        >
                          Replay delivery
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty-copy">No workflow action deliveries yet.</p>
              )}
            </aside>
          </div>
        </section>
      ) : null}
      {releasePanelOpen ? (
        <section className="release-panel" aria-label="Release manager">
          <div className="section-heading">
            <div>
              <span className="kicker">Coordinated delivery</span>
              <h2>Atomic releases</h2>
              <p>
                Pin saved drafts, validate their future state, then publish every entry together.
              </p>
            </div>
            <span className={`release-state release-state--${activeRelease?.state ?? 'draft'}`}>
              {activeRelease?.state ?? 'No release selected'}
            </span>
          </div>

          <div className="release-layout">
            <div className="release-builder">
              <h3>Compose release</h3>
              <label className="gs-field">
                <span>Release name</span>
                <input
                  value={releaseName}
                  placeholder="Campaign launch"
                  onChange={(event) => setReleaseName(event.target.value)}
                />
              </label>
              <fieldset className="release-entry-picker">
                <legend>Saved entries</legend>
                {entries.map((entry) => (
                  <label key={entry.id}>
                    <input
                      type="checkbox"
                      checked={releaseEntryIds.includes(entry.id)}
                      onChange={(event) =>
                        setReleaseEntryIds((current) =>
                          event.target.checked
                            ? [...current, entry.id]
                            : current.filter((id) => id !== entry.id),
                        )
                      }
                    />
                    <span>
                      {String(entry.data.title ?? entry.data.headline ?? entry.id)}
                      <small>{entry.draftRevisionId}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                className="button button--primary"
                disabled={busy || !releaseName.trim() || releaseEntryIds.length < 2}
                onClick={() => void createRelease()}
              >
                Create release
              </button>
            </div>

            <div className="release-workbench">
              <h3>Release workbench</h3>
              {releases.length ? (
                <ul className="release-selector" aria-label="Scoped releases">
                  {releases.map((release) => (
                    <li key={release.id}>
                      <button
                        type="button"
                        className={release.id === activeRelease?.id ? 'active' : ''}
                        onClick={() => {
                          setActiveReleaseId(release.id);
                          setReleasePreview(null);
                        }}
                      >
                        <strong>{release.name}</strong>
                        <small>{release.state}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-copy">No releases in this tenant scope yet.</p>
              )}

              {activeRelease ? (
                <article className="release-card">
                  <div className="release-card-heading">
                    <div>
                      <strong>{activeRelease.name}</strong>
                      <small>
                        {activeRelease.entries.length} pinned revisions ·{' '}
                        {activeRelease.rollbackPolicy.mode} rollback
                      </small>
                    </div>
                    <code>{activeRelease.id}</code>
                  </div>
                  <ul className="release-member-list">
                    {activeRelease.entries.map((member) => (
                      <li key={member.entryId}>
                        <span>
                          {String(
                            entries.find((entry) => entry.id === member.entryId)?.data.title ??
                              entries.find((entry) => entry.id === member.entryId)?.data.headline ??
                              member.entryId,
                          )}
                        </span>
                        <code>{member.revisionId}</code>
                      </li>
                    ))}
                  </ul>
                  {activeRelease.validation ? (
                    <div
                      className={`release-validation ${activeRelease.validation.valid ? 'release-validation--valid' : ''}`}
                    >
                      <strong>
                        {activeRelease.validation.valid
                          ? 'Validation passed'
                          : 'Validation blocked'}
                      </strong>
                      <span>{activeRelease.validation.issues.length} issue(s)</span>
                      {activeRelease.validation.issues.length ? (
                        <ul>
                          {activeRelease.validation.issues.map((issue) => (
                            <li
                              key={`${issue.code}-${issue.entryId ?? 'release'}-${issue.path?.join('.') ?? 'root'}-${issue.message}`}
                            >
                              {issue.severity}: {issue.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="release-actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={
                        busy ||
                        ['executing', 'published', 'rolled-back'].includes(activeRelease.state)
                      }
                      onClick={() => void validateActiveRelease()}
                    >
                      Validate release
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={busy}
                      onClick={() => void previewActiveRelease()}
                    >
                      Preview future state
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={
                        busy ||
                        !activeRelease.validation?.valid ||
                        ['executing', 'published', 'rolled-back'].includes(activeRelease.state)
                      }
                      onClick={() => void executeActiveRelease()}
                    >
                      Publish release
                    </button>
                    {activeRelease.state === 'published' ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={
                          busy ||
                          activeRelease.rollbackPolicy.mode === 'disabled' ||
                          activeRelease.entries.some(
                            (entry) => entry.previousPublishedRevisionId === null,
                          )
                        }
                        onClick={() => void rollbackActiveRelease()}
                      >
                        Roll back release
                      </button>
                    ) : null}
                  </div>

                  {activeRelease.state === 'validated' || activeRelease.state === 'scheduled' ? (
                    <div className="release-scheduler">
                      <label className="gs-field">
                        <span>Date and time</span>
                        <input
                          type="datetime-local"
                          value={releaseScheduleAt}
                          onChange={(event) => setReleaseScheduleAt(event.target.value)}
                        />
                      </label>
                      <label className="gs-field">
                        <span>IANA time zone</span>
                        <input
                          value={releaseTimeZone}
                          onChange={(event) => setReleaseTimeZone(event.target.value)}
                        />
                      </label>
                      {activeRelease.schedule?.state === 'pending' ? (
                        <button
                          type="button"
                          className="button button--secondary"
                          disabled={busy}
                          onClick={() => void cancelActiveReleaseSchedule()}
                        >
                          Cancel release schedule
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="button button--secondary"
                          disabled={busy || !releaseScheduleAt}
                          onClick={() => void scheduleActiveRelease()}
                        >
                          Schedule release
                        </button>
                      )}
                    </div>
                  ) : null}

                  {releasePreview?.releaseId === activeRelease.id ? (
                    <div className="release-preview">
                      <h3>Future state</h3>
                      <ul>
                        {releasePreview.entries.map((entry) => (
                          <li key={entry.entryId}>
                            <strong>
                              {String(entry.data.title ?? entry.data.headline ?? entry.entryId)}
                            </strong>
                            <span>{entry.route ?? 'No canonical route'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}{' '}
      {assetLibraryOpen ? (
        <section className="asset-library-panel" aria-label="Asset library">
          <div className="section-heading">
            <div>
              <span className="kicker">Digital assets</span>
              <h2>Asset library</h2>
              <p>Verified uploads, quarantine status, governed metadata, and scoped usage.</p>
            </div>
            <label className="button button--primary asset-upload-button">
              {assetUploading ? 'Uploading...' : 'Upload asset'}
              <input
                type="file"
                disabled={assetUploading}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void uploadAssetFile(file);
                }}
              />
            </label>
          </div>
          <div className="asset-library-grid">
            {assets.length > 0 ? (
              assets.map((asset) => {
                const revision = asset.revisions.find(
                  (candidate) => candidate.id === asset.currentRevisionId,
                );
                if (!revision) return null;
                return (
                  <article className="asset-library-card" key={asset.id}>
                    <div>
                      <div className="asset-library-title-row">
                        <strong>{revision.metadata.title}</strong>
                        <span
                          className={`asset-security-badge asset-security-badge--${revision.security?.status ?? 'unverified'}`}
                        >
                          {revision.security?.status === 'verified'
                            ? 'Verified'
                            : revision.security?.status === 'quarantined'
                              ? 'Quarantined'
                              : 'Unverified'}
                        </span>
                      </div>
                      <span>
                        {asset.kind} - {revision.original.mediaType}
                      </span>
                      {revision.security ? (
                        <small>
                          Detected {revision.security.detectedMediaType} - malware{' '}
                          {revision.security.malware.status}
                          {revision.security.sanitized ? ' - sanitized' : ''}
                        </small>
                      ) : null}
                    </div>
                    <dl>
                      <div>
                        <dt>Version</dt>
                        <dd>{revision.version}</dd>
                      </div>
                      <div>
                        <dt>Renditions</dt>
                        <dd>{asset.renditions.length}</dd>
                      </div>
                      <div>
                        <dt>Size</dt>
                        <dd>{revision.original.size} B</dd>
                      </div>
                    </dl>
                    {revision.focalPoint ? (
                      <small>
                        Focal point {revision.focalPoint.x.toFixed(2)},{' '}
                        {revision.focalPoint.y.toFixed(2)}
                      </small>
                    ) : null}
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => void inspectAssetUsage(asset.id)}
                    >
                      Inspect usage
                    </button>
                  </article>
                );
              })
            ) : (
              <p className="empty-state">Upload the first asset for this tenant and locale.</p>
            )}
          </div>
          {assetUsage ? (
            <p className="asset-usage-summary" role="status">
              {assetUsage.totalReferences} references across {assetUsage.entries} entries -{' '}
              {assetUsage.byPerspective.draft} draft - {assetUsage.byPerspective.published}{' '}
              published
            </p>
          ) : null}
        </section>
      ) : null}
      {searchPanelOpen ? (
        <section className="search-panel" aria-label="Search and discovery">
          <div className="search-panel__query">
            <div>
              <span className="kicker">Discovery</span>
              <h2>Search content</h2>
              <p>
                Search draft content, inspect taxonomy facets, and follow content relationships.
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch();
              }}
            >
              <label htmlFor="studio-search">Search terms</label>
              <div>
                <input
                  id="studio-search"
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Title, body, slug…"
                />
                <button className="button button--primary" type="submit" disabled={searchBusy}>
                  Search
                </button>
              </div>
            </form>
            <fieldset className="search-taxonomies">
              <legend>Available taxonomies</legend>
              {searchTaxonomies.map((taxonomy) => (
                <span key={taxonomy.id}>
                  {taxonomy.name} · {taxonomy.terms.length} terms
                </span>
              ))}
            </fieldset>
          </div>
          <div className="search-panel__results" aria-live="polite">
            <strong>{searchResponse?.total ?? 0} result(s)</strong>
            <ul>
              {searchResponse?.hits.map((hit) => (
                <li key={hit.entry.id}>
                  <button type="button" onClick={() => void selectEntry(hit.entry.id)}>
                    {entryTitle(hit.entry, schemas)}
                  </button>
                  <span>Score {hit.score}</span>
                </li>
              ))}
            </ul>
          </div>
          <aside className="search-panel__context">
            <div className="search-index-summary">
              <span className="kicker">Index</span>
              <strong>{searchIndexStatus?.adapter ?? 'Loading…'}</strong>
              <span>
                {searchIndexStatus?.draftDocuments ?? 0} drafts ·{' '}
                {searchIndexStatus?.pendingJobs ?? 0} pending · {searchIndexStatus?.deadJobs ?? 0}{' '}
                dead
              </span>
              <button
                type="button"
                className="button button--secondary"
                disabled={searchBusy}
                onClick={() => void rebuildSearchIndex()}
              >
                Rebuild draft index
              </button>
            </div>
            <div>
              <strong>Backlinks to selected entry</strong>
              <ul>
                {backlinks.map((backlink) => (
                  <li key={backlink.source.id}>{entryTitle(backlink.source, schemas)}</li>
                ))}
                {backlinks.length === 0 ? <li>None</li> : null}
              </ul>
            </div>
            <div>
              <strong>Related content</strong>
              <ul>
                {relatedContent.map((related) => (
                  <li key={related.entry.id}>
                    {entryTitle(related.entry, schemas)} · {related.reasons.join(', ')}
                  </li>
                ))}
                {relatedContent.length === 0 ? <li>None</li> : null}
              </ul>
            </div>
          </aside>
        </section>
      ) : null}{' '}
      {operationsDashboard ? (
        <section className="operations-panel" aria-label="Administrator operations">
          <div>
            <span className="kicker">Administrator</span>
            <h2>System integrity</h2>
            <p>
              Audit chain {operationsDashboard.audit.valid ? 'verified' : 'requires attention'} ·{' '}
              {operationsDashboard.audit.eventCount} events
            </p>
          </div>
          <dl>
            <div className="operation-metric">
              <dt>Content</dt>
              <dd>{operationsDashboard.content.total}</dd>
            </div>
            <div className="operation-metric">
              <dt>Pending events</dt>
              <dd>{operationsDashboard.outbox.pending}</dd>
            </div>
            <div className="operation-metric">
              <dt>Dead jobs</dt>
              <dd>{operationsDashboard.jobs.dead}</dd>
            </div>
            <div className="operation-metric">
              <dt>Active webhooks</dt>
              <dd>{operationsDashboard.webhooks.active}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      {identitySnapshot ? (
        <section className="identity-panel" aria-label="Enterprise identity administration">
          <div className="section-heading">
            <div>
              <span className="kicker">Enterprise identity</span>
              <h2>Federation and access controls</h2>
              <p>
                {identitySnapshot.providers.length} providers · {identitySnapshot.users.length}{' '}
                users · {identitySnapshot.sessions.filter((session) => !session.revokedAt).length}{' '}
                active sessions
              </p>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void refreshIdentity()}
            >
              Refresh identity state
            </button>
          </div>
          <div className="identity-panel__grid">
            <fieldset>
              <legend>Trusted provider</legend>
              <label>
                <span>Adapter ID</span>
                <input
                  value={identityProviderId}
                  onChange={(event) => setIdentityProviderId(event.target.value)}
                  placeholder="workforce-oidc"
                />
              </label>
              <label>
                <span>Protocol</span>
                <select
                  value={identityProviderProtocol}
                  onChange={(event) =>
                    setIdentityProviderProtocol(event.target.value as 'oidc' | 'saml')
                  }
                >
                  <option value="oidc">OIDC</option>
                  <option value="saml">SAML 2.0</option>
                </select>
              </label>
              <label>
                <span>Issuer</span>
                <input
                  value={identityProviderIssuer}
                  onChange={(event) => setIdentityProviderIssuer(event.target.value)}
                  placeholder="https://identity.example.com"
                />
              </label>
              <label>
                <span>Display name</span>
                <input
                  value={identityProviderName}
                  onChange={(event) => setIdentityProviderName(event.target.value)}
                  placeholder="Workforce identity"
                />
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void configureIdentityProvider()}
              >
                Save trusted provider
              </button>
              <ul>
                {identitySnapshot.providers.map((provider) => (
                  <li key={provider.id}>
                    {provider.displayName} · {provider.protocol.toUpperCase()} ·{' '}
                    {provider.enabled ? 'enabled' : 'disabled'}
                  </li>
                ))}
              </ul>
            </fieldset>

            <fieldset>
              <legend>Session policy</legend>
              {(
                [
                  ['idleTtlSeconds', 'Idle lifetime'],
                  ['absoluteTtlSeconds', 'Absolute lifetime'],
                  ['reauthenticationSeconds', 'Reauthentication'],
                  ['maximumConcurrentSessions', 'Concurrent sessions'],
                ] as const
              ).map(([field, label]) => (
                <label key={field}>
                  <span>{label}</span>
                  <input
                    type="number"
                    min={1}
                    value={identitySnapshot.policy[field]}
                    onChange={(event) =>
                      setIdentitySnapshot((current) =>
                        current
                          ? {
                              ...current,
                              policy: {
                                ...current.policy,
                                [field]: Number(event.target.value),
                              },
                            }
                          : current,
                      )
                    }
                  />
                </label>
              ))}
              <label className="identity-panel__checkbox">
                <input
                  type="checkbox"
                  checked={identitySnapshot.policy.privilegedStepUpRequired}
                  onChange={(event) =>
                    setIdentitySnapshot((current) =>
                      current
                        ? {
                            ...current,
                            policy: {
                              ...current.policy,
                              privilegedStepUpRequired: event.target.checked,
                            },
                          }
                        : current,
                    )
                  }
                />
                <span>Require WebAuthn step-up for privileged operations</span>
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void saveIdentityPolicy()}
              >
                Save session policy
              </button>
            </fieldset>

            <fieldset>
              <legend>Group role mapping</legend>
              <label>
                <span>External group</span>
                <input
                  value={identityGroup}
                  onChange={(event) => setIdentityGroup(event.target.value)}
                  placeholder="cms-editors"
                />
              </label>
              <label>
                <span>GridStory role</span>
                <input
                  value={identityRole}
                  onChange={(event) => setIdentityRole(event.target.value)}
                  placeholder="author"
                />
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void createIdentityMapping()}
              >
                Add mapping
              </button>
              <ul>
                {identitySnapshot.mappings.map((mapping) => (
                  <li key={mapping.id}>
                    {mapping.externalGroup} → {mapping.roleId}
                  </li>
                ))}
              </ul>
            </fieldset>

            <fieldset>
              <legend>Emergency and directory access</legend>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void issueDirectoryCredential()}
              >
                Issue SCIM credential
              </button>
              <label>
                <span>Incident ID</span>
                <input
                  value={identityIncident}
                  onChange={(event) => setIdentityIncident(event.target.value)}
                  placeholder="INC-2026-001"
                />
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void issueBreakGlassCredential()}
              >
                Issue one-time break-glass credential
              </button>
              {identityOneTimeSecret ? (
                <div className="identity-panel__secret" role="status">
                  <strong>Copy this secret now. It will not be shown again.</strong>
                  <code>{identityOneTimeSecret}</code>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setIdentityOneTimeSecret(null)}
                  >
                    I saved it
                  </button>
                </div>
              ) : null}
            </fieldset>
          </div>
          <div className="identity-panel__events">
            <h3>Recent security events</h3>
            <ol>
              {identitySnapshot.securityEvents
                .slice(-8)
                .reverse()
                .map((event) => (
                  <li key={event.id}>
                    <strong>{event.action}</strong> · {event.outcome} · {event.occurredAt}
                  </li>
                ))}
            </ol>
          </div>
        </section>
      ) : null}
      {dataGovernance ? (
        <section className="data-governance-panel" aria-label="Data governance administration">
          <div className="section-heading">
            <div>
              <span className="kicker">Guarded lifecycle</span>
              <h2>Retention, privacy requests, and legal holds</h2>
              <p>
                {dataGovernance.subjects.length} subjects ·{' '}
                {dataGovernance.holds.filter((hold) => hold.status === 'active').length} active
                holds · {dataGovernance.plans.length} plans
              </p>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void refreshDataGovernance()}
            >
              Refresh governance state
            </button>
          </div>
          <p className="data-governance-panel__warning" role="note">
            Erasure is irreversible: a code rollback cannot restore erased records or external
            objects. Verify a recoverable backup before approval.
          </p>
          <div className="data-governance-panel__grid">
            <fieldset>
              <legend>Data subjects</legend>
              <label>
                <span>Customer reference</span>
                <input
                  value={governanceSubjectReference}
                  onChange={(event) => setGovernanceSubjectReference(event.target.value)}
                  placeholder="customer-123"
                />
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void registerDataSubject()}
              >
                Register subject
              </button>
              <ul>
                {dataGovernance.subjects.map((subject) => (
                  <li key={subject.id}>
                    {subject.reference} · {subject.status}
                  </li>
                ))}
                {dataGovernance.subjects.length === 0 ? <li>No subjects in this scope.</li> : null}
              </ul>
            </fieldset>
            <fieldset>
              <legend>Legal holds</legend>
              <label>
                <span>Matter</span>
                <input
                  value={governanceHoldMatter}
                  onChange={(event) => setGovernanceHoldMatter(event.target.value)}
                  placeholder="CASE-2026-001"
                />
              </label>
              <label>
                <span>Reason</span>
                <textarea
                  value={governanceHoldReason}
                  onChange={(event) => setGovernanceHoldReason(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void createScopeHold()}
              >
                Activate scope hold
              </button>
              <ul>
                {dataGovernance.holds.map((hold) => (
                  <li key={hold.id}>
                    {hold.matter} · {hold.status}
                  </li>
                ))}
              </ul>
            </fieldset>
            <fieldset>
              <legend>Retention execution</legend>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void previewRetention()}
              >
                Preview retention plan
              </button>
              <label>
                <span>Independent approval reason</span>
                <textarea
                  value={governanceApprovalReason}
                  onChange={(event) => setGovernanceApprovalReason(event.target.value)}
                />
              </label>
              <label>
                <span>Verified backup reference</span>
                <input
                  value={governanceBackupReference}
                  onChange={(event) => setGovernanceBackupReference(event.target.value)}
                  placeholder="backup://tenant/date"
                />
              </label>
              <label>
                <span>Backup SHA-256</span>
                <input
                  value={governanceBackupSha}
                  onChange={(event) => setGovernanceBackupSha(event.target.value)}
                  placeholder="64 lowercase hex characters"
                />
              </label>
            </fieldset>
          </div>
          <div className="data-governance-panel__plans">
            <h3>Plan effects and blockers</h3>
            {dataGovernance.plans
              .slice()
              .reverse()
              .map((plan) => (
                <article key={plan.id}>
                  <div>
                    <strong>
                      {plan.kind} · {plan.state}
                    </strong>
                    <code>{plan.digest}</code>
                  </div>
                  <ul>
                    {plan.candidates.map((candidate) => (
                      <li key={candidate.id}>
                        {candidate.action} {candidate.resource.type}:{candidate.resource.id} ·{' '}
                        {candidate.state}
                        {candidate.blockers.length > 0 ? ` · ${candidate.blockers.join(', ')}` : ''}
                      </li>
                    ))}
                    {plan.candidates.length === 0 ? <li>No eligible resources.</li> : null}
                  </ul>
                  {plan.state === 'preview' ? (
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => void approveGovernancePlan(plan)}
                    >
                      Approve irreversible plan
                    </button>
                  ) : null}
                </article>
              ))}
          </div>
        </section>
      ) : null}
      {migrationOverview ? (
        <section className="migration-panel" aria-label="CMS migration workbench">
          <div className="section-heading">
            <div>
              <span className="kicker">Read-only source bridge</span>
              <h2>CMS migration and cutover evidence</h2>
              <p>
                {migrationOverview.sources.length} configured sources ·{' '}
                {migrationOverview.projects.length} projects · {migrationOverview.runs.length} runs
              </p>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void refreshMigrations()}
            >
              Refresh migration state
            </button>
          </div>
          <p className="migration-panel__warning" role="note">
            Source adapters are read-only. A ready report proves only the observed content checks;
            it does not switch traffic, migrate media binaries, decommission the source, or replace
            a verified backup.
          </p>
          <div className="migration-panel__setup">
            <fieldset>
              <legend>Versioned mapping recipe</legend>
              <label>
                <span>Configured source</span>
                <select
                  value={migrationSourceId}
                  onChange={(event) => setMigrationSourceId(event.target.value)}
                >
                  <option value="">Select a source</option>
                  {migrationOverview.sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} · {source.provider}
                    </option>
                  ))}
                </select>
              </label>
              {migrationOverview.sources.length === 0 ? (
                <p className="empty-copy">Configure a trusted server-side source adapter first.</p>
              ) : null}
              <div className="migration-panel__fields">
                <label>
                  <span>Recipe ID</span>
                  <input
                    value={migrationRecipeId}
                    onChange={(event) => setMigrationRecipeId(event.target.value)}
                    placeholder="contentful-page"
                  />
                </label>
                <label>
                  <span>Recipe name</span>
                  <input
                    value={migrationRecipeName}
                    onChange={(event) => setMigrationRecipeName(event.target.value)}
                    placeholder="Contentful pages"
                  />
                </label>
                <label>
                  <span>Source type</span>
                  <input
                    value={migrationSourceType}
                    onChange={(event) => setMigrationSourceType(event.target.value)}
                    placeholder="contentful.Entry.page"
                  />
                </label>
                <label>
                  <span>Target content type</span>
                  <input
                    value={migrationTargetType}
                    onChange={(event) => setMigrationTargetType(event.target.value)}
                  />
                </label>
              </div>
              <label>
                <span>Field mappings, one per line</span>
                <textarea
                  value={migrationMappings}
                  onChange={(event) => setMigrationMappings(event.target.value)}
                  aria-describedby="migration-mapping-help"
                />
                <small id="migration-mapping-help">
                  source.path -&gt; targetField -&gt; copy|string|number|boolean|slug
                </small>
              </label>
              <label>
                <span>Publication behavior</span>
                <select
                  value={migrationPublicationMode}
                  onChange={(event) =>
                    setMigrationPublicationMode(event.target.value as 'draft' | 'mirror-source')
                  }
                >
                  <option value="draft">Import drafts; publish through normal workflow</option>
                  <option value="mirror-source">
                    Mirror source status through all publish gates
                  </option>
                </select>
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void saveMigrationRecipe()}
              >
                Save next recipe version
              </button>
            </fieldset>
            <fieldset>
              <legend>Dual-run project</legend>
              <label>
                <span>Project ID</span>
                <input
                  value={migrationProjectId}
                  onChange={(event) => setMigrationProjectId(event.target.value)}
                  placeholder="contentful-cutover"
                />
              </label>
              <label>
                <span>Project name</span>
                <input
                  value={migrationProjectName}
                  onChange={(event) => setMigrationProjectName(event.target.value)}
                  placeholder="Website cutover"
                />
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void createMigrationProject()}
              >
                Create dual-run project
              </button>
              <label>
                <span>Active project</span>
                <select
                  value={activeMigrationProjectId}
                  onChange={(event) => {
                    setActiveMigrationProjectId(event.target.value);
                    setMigrationPlanReviewed(false);
                  }}
                >
                  <option value="">Select a project</option>
                  {migrationOverview.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} · {project.state}
                    </option>
                  ))}
                </select>
              </label>
              {activeMigrationProjectId ? (
                <div className="migration-panel__actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => void previewMigrationSync()}
                    disabled={
                      migrationOverview.projects.find(
                        (project) => project.id === activeMigrationProjectId,
                      )?.state !== 'active'
                    }
                  >
                    Preview next sync
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() =>
                      void setMigrationProjectState(
                        migrationOverview.projects.find(
                          (project) => project.id === activeMigrationProjectId,
                        )?.state === 'paused'
                          ? 'active'
                          : 'paused',
                      )
                    }
                  >
                    {migrationOverview.projects.find(
                      (project) => project.id === activeMigrationProjectId,
                    )?.state === 'paused'
                      ? 'Resume project'
                      : 'Pause project'}
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void validateMigrationCutover()}
                  >
                    Validate cutover
                  </button>
                </div>
              ) : null}
            </fieldset>
          </div>
          <div className="migration-panel__evidence">
            <section aria-label="Migration sync plans">
              <h3>Sync plans and exact effects</h3>
              {migrationOverview.plans
                .filter((plan) => plan.projectId === activeMigrationProjectId)
                .slice()
                .reverse()
                .map((plan) => (
                  <article key={plan.id} className="migration-plan-card">
                    <div>
                      <strong>
                        {plan.snapshotKind} · {plan.state}
                      </strong>
                      <code>{plan.digest}</code>
                    </div>
                    <p>
                      {plan.counts.create} create · {plan.counts.update} update ·{' '}
                      {plan.counts.publish} publish · {plan.counts.noop} unchanged ·{' '}
                      {plan.counts.sourceDeleted} deleted at source · {plan.counts.blocked} blocked
                    </p>
                    <ul>
                      {plan.effects.map((effect) => (
                        <li key={`${plan.id}-${effect.externalId}`}>
                          <strong>{effect.externalId}</strong> · {effect.action}
                          {effect.publish ? ' · publish' : ''}
                          {effect.blockers.map((blocker) => ` · ${blocker.code}`).join('')}
                        </li>
                      ))}
                    </ul>
                    {plan.state === 'preview' ? (
                      <>
                        <label className="migration-panel__review">
                          <input
                            type="checkbox"
                            checked={migrationPlanReviewed}
                            onChange={(event) => setMigrationPlanReviewed(event.target.checked)}
                          />
                          <span>I reviewed this exact digest, every effect, and all blockers.</span>
                        </label>
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={
                            !migrationPlanReviewed ||
                            plan.counts.blocked > 0 ||
                            plan.counts.sourceDeleted > 0
                          }
                          onClick={() => void executeMigrationPlan(plan)}
                        >
                          Execute reviewed plan
                        </button>
                      </>
                    ) : null}
                  </article>
                ))}
              {migrationOverview.plans.every(
                (plan) => plan.projectId !== activeMigrationProjectId,
              ) ? (
                <p className="empty-copy">No sync plan for the selected project.</p>
              ) : null}
            </section>
            <section aria-label="Migration cutover reports">
              <h3>Cutover readiness reports</h3>
              {migrationOverview.cutoverReports
                .filter((report) => report.projectId === activeMigrationProjectId)
                .slice()
                .reverse()
                .map((report) => (
                  <article
                    key={report.id}
                    className={`migration-cutover-card migration-cutover-card--${report.ready ? 'ready' : 'blocked'}`}
                  >
                    <strong>{report.ready ? 'Content checks ready' : 'Cutover blocked'}</strong>
                    <span>
                      {report.currentCount}/{report.sourceCount} current · {report.publishedCount}{' '}
                      published
                    </span>
                    <code>{report.digest}</code>
                    <ul>
                      {report.blockers.map((blocker, index) => (
                        <li key={`${report.id}-${blocker.externalId ?? index}-${blocker.code}`}>
                          {blocker.externalId ? `${blocker.externalId} · ` : ''}
                          {blocker.code}: {blocker.message}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              {migrationOverview.cutoverReports.every(
                (report) => report.projectId !== activeMigrationProjectId,
              ) ? (
                <p className="empty-copy">No cutover report for the selected project.</p>
              ) : null}
            </section>
          </div>
        </section>
      ) : null}
      {marketplaceOverview ? (
        <section className="marketplace-panel" aria-label="Plugin marketplace workbench">
          <div className="section-heading">
            <div>
              <span className="kicker">Evidence-bound extensions</span>
              <h2>Verified publishers and reviewed packages</h2>
              <p>
                {marketplaceOverview.publishers.length} publishers ·{' '}
                {marketplaceOverview.releases.length} immutable releases
              </p>
            </div>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void refreshMarketplace()}
            >
              Refresh marketplace
            </button>
          </div>
          <p className="marketplace-panel__warning" role="note">
            A verified badge means domain possession plus accountable human review. A passing scan
            and provenance identify observed evidence; neither proves package safety. Installed
            plugins remain disabled, ungranted, and dependent on a separately hardened runtime.
          </p>
          <div className="marketplace-panel__setup">
            <fieldset>
              <legend>Register publisher identity</legend>
              <div className="marketplace-panel__fields">
                <label>
                  <span>Publisher ID</span>
                  <input
                    value={marketplacePublisherId}
                    onChange={(event) => setMarketplacePublisherId(event.target.value)}
                    placeholder="example"
                  />
                </label>
                <label>
                  <span>Display name</span>
                  <input
                    value={marketplacePublisherName}
                    onChange={(event) => setMarketplacePublisherName(event.target.value)}
                    placeholder="Example"
                  />
                </label>
                <label>
                  <span>Verified domain</span>
                  <input
                    value={marketplacePublisherDomain}
                    onChange={(event) => setMarketplacePublisherDomain(event.target.value)}
                    placeholder="example.com"
                  />
                </label>
                <label>
                  <span>Signing key ID</span>
                  <input
                    value={marketplacePublisherKeyId}
                    onChange={(event) => setMarketplacePublisherKeyId(event.target.value)}
                  />
                </label>
              </div>
              <label>
                <span>Ed25519 public key (PEM)</span>
                <textarea
                  value={marketplacePublisherPublicKey}
                  onChange={(event) => setMarketplacePublisherPublicKey(event.target.value)}
                  aria-describedby="marketplace-key-help"
                />
                <small id="marketplace-key-help">
                  Public verification material only. Never paste a private signing key.
                </small>
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void registerMarketplacePublisher()}
              >
                Register pending publisher
              </button>
            </fieldset>
            <fieldset>
              <legend>Submit immutable signed release</legend>
              <label>
                <span>Signed Plugin SDK manifest JSON</span>
                <textarea
                  value={marketplaceManifestJson}
                  onChange={(event) => setMarketplaceManifestJson(event.target.value)}
                  aria-describedby="marketplace-manifest-help"
                />
                <small id="marketplace-manifest-help">
                  Compatibility, support links, permissions, digest, and size must already be inside
                  the publisher signature.
                </small>
              </label>
              <label>
                <span>Opaque artifact scanner reference</span>
                <input
                  value={marketplaceArtifactReference}
                  onChange={(event) => setMarketplaceArtifactReference(event.target.value)}
                  placeholder="scanner://review-system/package-version"
                />
              </label>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void submitMarketplaceRelease()}
              >
                Submit release for review
              </button>
            </fieldset>
          </div>
          {marketplaceChallenge ? (
            <div className="marketplace-challenge" role="status">
              <strong>Pending DNS TXT proof</strong>
              <span>{marketplaceChallenge.recordName}</span>
              <code>{marketplaceChallenge.token}</code>
              <small>Expires {new Date(marketplaceChallenge.expiresAt).toLocaleString()}</small>
            </div>
          ) : null}
          <fieldset className="marketplace-panel__review-inputs">
            <legend>Accountable review decision</legend>
            <label>
              <span>Evidence reference</span>
              <input
                value={marketplaceEvidenceReference}
                onChange={(event) => setMarketplaceEvidenceReference(event.target.value)}
                placeholder="publisher-review:ticket-123"
              />
            </label>
            <label>
              <span>Reason</span>
              <input
                value={marketplaceReason}
                onChange={(event) => setMarketplaceReason(event.target.value)}
                placeholder="What was reviewed and why this decision is safe"
              />
            </label>
            <small>
              Publisher owners, automated-review operators, and release approvers must be distinct
              authenticated principals where required.
            </small>
          </fieldset>
          <div className="marketplace-panel__catalog">
            <section aria-label="Marketplace publishers">
              <h3>Publisher identity</h3>
              {marketplaceOverview.publishers.map((publisher) => (
                <article key={publisher.id} className="marketplace-card">
                  <div className="marketplace-card__heading">
                    <div>
                      <strong>{publisher.displayName}</strong>
                      <span>{publisher.domain}</span>
                    </div>
                    <span className={`status-pill status-pill--${publisher.state}`}>
                      {publisher.state}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Domain proof</dt>
                      <dd>{publisher.domainVerifiedAt ? 'observed' : 'pending'}</dd>
                    </div>
                    <div>
                      <dt>Key</dt>
                      <dd>{publisher.key.keyId}</dd>
                    </div>
                    <div>
                      <dt>Fingerprint</dt>
                      <dd>
                        <code>{publisher.key.fingerprint}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Human reviewer</dt>
                      <dd>{publisher.verifiedBy ?? 'pending'}</dd>
                    </div>
                  </dl>
                  <div className="marketplace-card__actions">
                    {publisher.state === 'pending' ? (
                      <>
                        <button
                          type="button"
                          className="button button--secondary"
                          onClick={() => void issueMarketplaceChallenge(publisher.id)}
                        >
                          Issue DNS challenge
                        </button>
                        <button
                          type="button"
                          className="button button--secondary"
                          onClick={() => void verifyMarketplaceDomain(publisher.id)}
                        >
                          Verify TXT proof
                        </button>
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={!publisher.domainVerifiedAt}
                          onClick={() => void approveMarketplacePublisher(publisher.id)}
                        >
                          Approve publisher
                        </button>
                      </>
                    ) : null}
                    {publisher.state === 'verified' ? (
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={() => void suspendMarketplacePublisher(publisher.id)}
                      >
                        Suspend trust
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {marketplaceOverview.publishers.length === 0 ? (
                <p className="empty-copy">No publisher identity has been registered.</p>
              ) : null}
            </section>
            <section aria-label="Marketplace releases">
              <h3>Signed package releases</h3>
              {marketplaceOverview.releases.map((release) => {
                const metadata = release.manifest.marketplace;
                const review = release.reviews.at(-1);
                return (
                  <article key={release.id} className="marketplace-card marketplace-release-card">
                    <div className="marketplace-card__heading">
                      <div>
                        <strong>{release.manifest.name}</strong>
                        <span>
                          {release.pluginId} · v{release.version}
                        </span>
                      </div>
                      <span className={`status-pill status-pill--${release.state}`}>
                        {release.state}
                      </span>
                    </div>
                    <p>{release.manifest.description}</p>
                    <dl>
                      <div>
                        <dt>Publisher</dt>
                        <dd>{release.publisherId}</dd>
                      </div>
                      <div>
                        <dt>Compatibility</dt>
                        <dd>
                          {metadata
                            ? `${metadata.compatibility.gridstory.minVersion}–${metadata.compatibility.gridstory.maxVersionExclusive}`
                            : 'missing'}
                        </dd>
                      </div>
                      <div>
                        <dt>Support</dt>
                        <dd>{metadata?.support.status ?? 'missing'}</dd>
                      </div>
                      <div>
                        <dt>Artifact digest</dt>
                        <dd>
                          <code>{release.manifest.package.sha256}</code>
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <strong>Transparent permissions</strong>
                      {release.manifest.requestedCapabilities.length > 0 ? (
                        <ul>
                          {release.manifest.requestedCapabilities.map((grant) => (
                            <li key={grant.capability}>{grant.capability}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>No capability requested.</p>
                      )}
                    </div>
                    {review ? (
                      <section
                        className="marketplace-review"
                        aria-label={`Review for ${release.pluginId}`}
                      >
                        <strong>
                          Automated evidence · {review.status} · {review.inspector.id}{' '}
                          {review.inspector.version}
                        </strong>
                        <ul>
                          {review.checks.map((check) => (
                            <li key={check.id} data-status={check.status}>
                              {check.status} · {check.category}: {check.summary}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : (
                      <p className="empty-copy">No automated review evidence recorded.</p>
                    )}
                    <div className="marketplace-card__actions">
                      {release.state === 'submitted' ? (
                        <button
                          type="button"
                          className="button button--secondary"
                          onClick={() => void reviewMarketplaceRelease(release.id)}
                        >
                          Run trusted review
                        </button>
                      ) : null}
                      {release.state === 'reviewed' ? (
                        <>
                          <button
                            type="button"
                            className="button button--primary"
                            onClick={() => void decideMarketplaceRelease(release.id, 'approve')}
                          >
                            Approve exact release
                          </button>
                          <button
                            type="button"
                            className="button button--danger"
                            onClick={() => void decideMarketplaceRelease(release.id, 'reject')}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {release.state === 'approved' ? (
                        <>
                          <button
                            type="button"
                            className="button button--secondary"
                            onClick={() => void installMarketplaceRelease(release.id)}
                          >
                            Install disabled · no grants
                          </button>
                          <button
                            type="button"
                            className="button button--danger"
                            onClick={() => void decideMarketplaceRelease(release.id, 'yank')}
                          >
                            Yank release
                          </button>
                        </>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {marketplaceOverview.releases.length === 0 ? (
                <p className="empty-copy">No signed release has been submitted.</p>
              ) : null}
            </section>
          </div>
        </section>
      ) : null}
      {componentGovernance ? (
        <section className="governance-panel" aria-label="Component governance">
          <div className="governance-panel__heading">
            <span className="kicker">Component governance</span>
            <label>
              <span>Inspect component</span>
              <select
                value={componentGovernance.componentId}
                onChange={(event) => void inspectComponent(event.target.value)}
              >
                {manifests.map((manifest) => (
                  <option key={manifest.id} value={manifest.id}>
                    {manifest.name} · v{manifest.version}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <strong>
              {componentGovernance.migration.component.name} ·{' '}
              {componentGovernance.migration.component.status}
            </strong>
            {componentGovernance.migration.component.deprecation ? (
              <p>
                {componentGovernance.migration.component.deprecation.reason}
                {componentGovernance.migration.component.deprecation.replacementId
                  ? ` Replace with ${componentGovernance.migration.component.deprecation.replacementId}.`
                  : ''}
              </p>
            ) : null}
            <p>
              {componentGovernance.migration.usage.totalInstances} scoped usages across{' '}
              {componentGovernance.migration.usage.entries} entries ·{' '}
              {componentGovernance.migration.outdatedInstances} outdated
            </p>
          </div>
          <div>
            <strong>Visual regression hooks</strong>
            <p>
              {componentGovernance.visual.scenarios.length} code-owned scenarios ·{' '}
              {componentGovernance.visual.usageHooks.length} content hooks
            </p>
            <code>{componentGovernance.visual.selector}</code>
          </div>
          <div className="governance-panel__migrations">
            {[
              ...new Map(
                componentGovernance.migration.usage.locations
                  .filter(
                    (location) =>
                      location.perspective === 'draft' &&
                      location.version !== componentGovernance.migration.component.version,
                  )
                  .map((location) => [location.entryId, location]),
              ).values(),
            ].map((location) => (
              <button
                type="button"
                className="button button--secondary"
                key={location.entryId}
                disabled={!componentGovernance.migration.ready || busy}
                onClick={() =>
                  void migrateComponentEntry(
                    location.entryId,
                    componentGovernance.componentId,
                    location.revisionId,
                  )
                }
              >
                Migrate {location.entryId} from v{location.version}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {qualityReport ? (
        <section className="quality-panel" aria-label="Content quality report">
          <div className="quality-panel__score">
            <span className="kicker">Publish quality</span>
            <strong>{qualityReport.score}</strong>
            <span>{qualityReport.passed ? 'Ready to publish' : 'Gate blocked'}</span>
          </div>
          <div className="quality-panel__summary">
            <p>
              {qualityReport.summary.error} errors · {qualityReport.summary.warning} warnings ·{' '}
              {qualityReport.summary.info} notes
            </p>
            <p>
              Policy {qualityReport.policyId ?? 'none'} · {qualityReport.channel}
              {qualityReport.bypassed ? ' · role bypass applied' : ''}
            </p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void runQuality()}
              disabled={busy}
            >
              Re-run checks
            </button>
          </div>
          {qualityReport.findings.length > 0 ? (
            <ol className="quality-findings">
              {qualityReport.findings.map((finding) => (
                <li
                  key={finding.id}
                  className={`quality-finding quality-finding--${finding.severity}`}
                >
                  <span>
                    {finding.category} · {finding.severity}
                  </span>
                  <strong>{finding.message}</strong>
                  <code>{finding.path.length > 0 ? finding.path.join('.') : 'document'}</code>
                  <p>{finding.remediation}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="quality-panel__empty">No findings for this policy and channel.</p>
          )}
        </section>
      ) : null}{' '}
      <div className="studio-workspace" aria-busy={busy}>
        <aside className="content-sidebar" aria-label="Content entries">
          <div className="sidebar-heading">
            <div>
              <span className="kicker">Content</span>
              <h1>Pages</h1>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => void createPage()}
              aria-label="Create page"
            >
              +
            </button>
          </div>
          <nav>
            {entries.map((entry) => (
              <button
                type="button"
                className={`entry-card ${selected?.id === entry.id ? 'entry-card--active' : ''}`}
                key={entry.id}
                onClick={() => requestSelectEntry(entry.id)}
              >
                <span className="entry-card__title">{entryTitle(entry, schemas)}</span>
                <span className="entry-card__meta">/{entrySlug(entry, schemas)}</span>
                <span className={`status status--${entry.status}`}>{entry.status}</span>
              </button>
            ))}
          </nav>
          {entries.length === 0 && !busy ? (
            <p className="empty-copy">No pages yet. Create the first one.</p>
          ) : null}
        </aside>

        <main className="editor-panel" id="studio-editor" tabIndex={-1}>
          {notice ? (
            <div className={`notice notice--${notice.tone}`} role="status">
              {notice.message}
            </div>
          ) : null}
          {busy && !draft ? (
            <div className="loading-state" role="status" aria-live="polite">
              Loading GridStory…
            </div>
          ) : null}
          {fatalError && !draft ? (
            <div className="loading-state" role="alert">
              <p>GridStory could not load: {fatalError}</p>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setReloadToken((current) => current + 1)}
              >
                Try again
              </button>
            </div>
          ) : null}
          {draft && selected ? (
            <>
              <section className="document-heading">
                <div>
                  <span className="kicker">Page entry</span>
                  <h2>{String(draft[activeSchema?.titleField ?? 'title'] || 'Untitled page')}</h2>
                </div>
                <span className={`status status--${selected.status}`}>{selected.status}</span>
              </section>
              <section className="document-fields" aria-label="Page fields">
                {activeSchema?.fields.map((field) => {
                  if (field.type === 'component-tree') return null;
                  return (
                    <SchemaFieldControl
                      key={field.id}
                      definition={field}
                      value={draft[field.name]}
                      entries={entries}
                      assets={assetChoices}
                      onChange={(value) =>
                        changeDraft((current) => ({ ...current, [field.name]: value }))
                      }
                    />
                  );
                })}
              </section>

              <section className="workflow-panel" aria-label="Editorial workflow">
                <div className="section-heading">
                  <div>
                    <span className="kicker">Governance</span>
                    <h2>Editorial workflow</h2>
                    <p>
                      {activeWorkflow?.name ?? 'Configured workflow'} · version{' '}
                      {workflowInstance?.workflowVersion ?? '—'}
                    </p>
                  </div>
                  <span
                    className={`workflow-state workflow-state--${workflowState?.kind ?? 'draft'}`}
                  >
                    {workflowState?.label ?? workflowInstance?.stateId ?? 'Loading'}
                  </span>
                </div>

                <div className="workflow-grid">
                  <div className="workflow-actions">
                    <h3>Available actions</h3>
                    <div className="workflow-action-row">
                      {availableWorkflowTransitions
                        .filter((transition) => transition.id !== publishWorkflowTransition?.id)
                        .map((transition) => (
                          <button
                            key={transition.id}
                            type="button"
                            className="button button--secondary"
                            disabled={busy || workflowInstance?.pendingApproval !== undefined}
                            onClick={() => void runWorkflowTransition(transition.id)}
                          >
                            {transition.label}
                          </button>
                        ))}
                      {availableWorkflowTransitions.length === 0 ? (
                        <span className="empty-copy">
                          Save a new draft to restart editorial review.
                        </span>
                      ) : null}
                    </div>

                    {workflowInstance?.pendingApproval ? (
                      <article className="approval-card">
                        <div>
                          <strong>Approval pending</strong>
                          <p>
                            Requested by {workflowInstance.pendingApproval.requestedBy}
                            {workflowInstance.pendingApproval.dueAt
                              ? ` · due ${new Date(
                                  workflowInstance.pendingApproval.dueAt,
                                ).toLocaleString()}`
                              : ''}
                          </p>
                          <small>
                            {
                              workflowInstance.pendingApproval.decisions.filter(
                                (decision) => decision.decision === 'approved',
                              ).length
                            }{' '}
                            approvals recorded
                            {workflowInstance.pendingApproval.escalatedAt ? ' · escalated' : ''}
                          </small>
                        </div>
                        <div className="workflow-action-row">
                          <button
                            type="button"
                            className="button button--primary"
                            disabled={busy || dirty}
                            onClick={() => void decideWorkflow('approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="button button--secondary"
                            disabled={busy || dirty}
                            onClick={() => void decideWorkflow('rejected')}
                          >
                            Reject and request changes
                          </button>
                        </div>
                      </article>
                    ) : null}

                    {publishWorkflowTransition ? (
                      <div className="workflow-scheduler">
                        <h3>Schedule publication</h3>
                        <label className="gs-field">
                          <span>Date and time</span>
                          <input
                            type="datetime-local"
                            value={workflowScheduleAt}
                            onChange={(event) => setWorkflowScheduleAt(event.target.value)}
                          />
                        </label>
                        <label className="gs-field">
                          <span>IANA time zone</span>
                          <input
                            value={workflowTimeZone}
                            onChange={(event) => setWorkflowTimeZone(event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="button button--secondary"
                          disabled={!workflowScheduleAt || busy}
                          onClick={() =>
                            void scheduleWorkflowTransition(publishWorkflowTransition.id)
                          }
                        >
                          Schedule publish
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="workflow-activity">
                    <h3>Schedules and notifications</h3>
                    {workflowInstance?.schedules.length ? (
                      <ul className="workflow-list">
                        {workflowInstance.schedules
                          .slice()
                          .reverse()
                          .slice(0, 4)
                          .map((schedule) => (
                            <li key={schedule.id}>
                              <div>
                                <strong>{schedule.transitionId}</strong>
                                <small>
                                  {new Date(schedule.runAt).toLocaleString()} · {schedule.timeZone}{' '}
                                  · {schedule.state}
                                </small>
                              </div>
                              {schedule.state === 'pending' ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void cancelWorkflowSchedule(schedule.id)}
                                >
                                  Cancel
                                </button>
                              ) : null}
                            </li>
                          ))}
                      </ul>
                    ) : null}
                    {workflowInstance?.notifications.length ? (
                      <ol className="workflow-list workflow-notifications">
                        {workflowInstance.notifications
                          .slice()
                          .reverse()
                          .slice(0, 5)
                          .map((notification) => (
                            <li key={notification.id}>
                              <div>
                                <strong>{notification.message}</strong>
                                <small>
                                  {new Date(notification.createdAt).toLocaleString()}
                                  {notification.audienceRoles.length
                                    ? ` · ${notification.audienceRoles.join(', ')}`
                                    : ''}
                                </small>
                              </div>
                            </li>
                          ))}
                      </ol>
                    ) : (
                      <p className="empty-copy">No workflow activity yet.</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="collaboration-panel" aria-label="Collaboration workspace">
                <div className="section-heading">
                  <div>
                    <span className="kicker">Collaboration</span>
                    <h2>Branches, suggestions, and comments</h2>
                  </div>
                  <ul className="presence-list" aria-label="Active editors">
                    {collaboration.presence.length > 0 ? (
                      collaboration.presence.map((participant) => (
                        <li className="presence-chip" key={participant.actorId}>
                          {participant.displayName}
                          {participant.field ? ` · ${participant.field}` : ''}
                        </li>
                      ))
                    ) : (
                      <li className="presence-chip presence-chip--idle">No active editors</li>
                    )}
                  </ul>
                </div>
                <div className="collaboration-workbench">
                  <div className="collaboration-controls">
                    <label className="gs-field">
                      <span>Working branch</span>
                      <select
                        value={collaborationBranchId}
                        onChange={(event) => setCollaborationBranchId(event.target.value)}
                      >
                        {collaboration.branches.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name} · {candidate.status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="gs-field">
                      <span>Shared field or block</span>
                      <select
                        value={collaborationTargetField}
                        onChange={(event) => setCollaborationTargetField(event.target.value)}
                      >
                        <option value="">Choose a field</option>
                        {activeSchema?.fields.map((field) => (
                          <option key={field.id} value={field.name}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={
                        !collaborationTargetField || selectedCollaborationValue === undefined
                      }
                      onClick={() => void shareCollaborationValue()}
                    >
                      Share current value
                    </button>
                    <span className="collaboration-version">
                      {collaboration.operations.length} operations · document v
                      {collaboration.version}
                    </span>
                  </div>

                  <div className="collaboration-create-row">
                    <label className="gs-field">
                      <span>New branch from current</span>
                      <input
                        placeholder="Campaign revision"
                        value={collaborationBranchName}
                        onChange={(event) => setCollaborationBranchName(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={!collaborationBranchName.trim()}
                      onClick={() => void createCollaborationBranch()}
                    >
                      Create branch
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={
                        collaborationBranchId === 'main' ||
                        collaboration.branches.find(
                          (candidate) => candidate.id === collaborationBranchId,
                        )?.status !== 'open'
                      }
                      onClick={() => void mergeCollaborationBranch()}
                    >
                      Merge into Main
                    </button>
                  </div>

                  <div className="collaboration-create-row collaboration-suggestion-composer">
                    <label className="gs-field">
                      <span>Proposed value</span>
                      <textarea
                        rows={2}
                        placeholder="Suggest a replacement value for the selected field or block"
                        value={collaborationSuggestionValue}
                        onChange={(event) => setCollaborationSuggestionValue(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={!collaborationTargetField || !collaborationSuggestionValue.trim()}
                      onClick={() => void createCollaborationSuggestion()}
                    >
                      Open suggestion
                    </button>
                  </div>

                  {collaboration.suggestions.length > 0 ? (
                    <section className="collaboration-review-list" aria-label="Suggestions">
                      <h3>Suggestions</h3>
                      {collaboration.suggestions.map((suggestion) => (
                        <article key={suggestion.id} className="collaboration-review-card">
                          <div>
                            <strong>{suggestion.target.field}</strong>
                            {suggestion.target.nodeId ? ` · ${suggestion.target.nodeId}` : ''}
                            <p>{collaborationValueLabel(suggestion.value)}</p>
                            <small>
                              {suggestion.createdBy} · {suggestion.status}
                            </small>
                          </div>
                          {suggestion.status === 'open' ? (
                            <div className="collaboration-card-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  void reviewCollaborationSuggestion(suggestion.id, 'accept')
                                }
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void reviewCollaborationSuggestion(suggestion.id, 'reject')
                                }
                              >
                                Reject
                              </button>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </section>
                  ) : null}

                  {collaboration.conflicts.some((conflict) => conflict.status === 'open') ? (
                    <section className="collaboration-review-list" aria-label="Merge conflicts">
                      <h3>Merge conflicts</h3>
                      {collaboration.conflicts
                        .filter((conflict) => conflict.status === 'open')
                        .map((conflict) => (
                          <article
                            key={conflict.id}
                            className="collaboration-review-card collaboration-conflict-card"
                          >
                            <div>
                              <strong>{conflict.target.field}</strong>
                              {conflict.target.nodeId ? ` · ${conflict.target.nodeId}` : ''}
                              <p>Choose the value that should become the causal successor.</p>
                            </div>
                            <div className="collaboration-conflict-variants">
                              {conflict.variants.map((variant) => (
                                <button
                                  type="button"
                                  key={variant.operationId}
                                  onClick={() =>
                                    void resolveCollaborationConflict(
                                      conflict.id,
                                      variant.operationId,
                                    )
                                  }
                                >
                                  <strong>{variant.branchId}</strong>
                                  <span>{collaborationValueLabel(variant.value)}</span>
                                  <small>{variant.actorId}</small>
                                </button>
                              ))}
                            </div>
                          </article>
                        ))}
                    </section>
                  ) : null}
                </div>
                <h3 className="collaboration-comments-heading">Comments</h3>
                <div className="comment-composer">
                  <label className="gs-field">
                    <span>Comment target</span>
                    <select
                      value={commentTargetField}
                      onChange={(event) => setCommentTargetField(event.target.value)}
                    >
                      <option value="">Whole entry</option>
                      {activeSchema?.fields.map((field) => (
                        <option key={field.id} value={field.name}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="gs-field comment-body-field">
                    <span>New comment</span>
                    <textarea
                      rows={3}
                      placeholder="Write a comment and mention @reviewer"
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                    />
                  </label>
                  <label className="gs-field">
                    <span>Assign to</span>
                    <input
                      placeholder="actor-id"
                      value={commentAssignee}
                      onChange={(event) => setCommentAssignee(event.target.value)}
                    />
                  </label>
                  <label className="gs-field">
                    <span>Due date</span>
                    <input
                      type="datetime-local"
                      value={commentDueAt}
                      onChange={(event) => setCommentDueAt(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={!commentBody.trim()}
                    onClick={() => void createComment()}
                  >
                    Add comment
                  </button>
                </div>
                <div className="comment-thread-list">
                  {collaboration.threads.map((thread) => (
                    <article
                      className={`comment-thread${thread.resolvedAt ? ' comment-thread--resolved' : ''}`}
                      key={thread.id}
                    >
                      <header>
                        <div>
                          <strong>
                            {thread.target.field ?? 'Entry'}
                            {thread.target.nodeId ? ` · ${thread.target.nodeId}` : ''}
                          </strong>
                          <small>
                            {thread.assigneeId ? `Assigned to ${thread.assigneeId}` : 'Unassigned'}
                            {thread.dueAt
                              ? ` · due ${new Date(thread.dueAt).toLocaleDateString()}`
                              : ''}
                          </small>
                        </div>
                        <button
                          type="button"
                          onClick={() => void setThreadResolved(thread.id, !thread.resolvedAt)}
                        >
                          {thread.resolvedAt ? 'Reopen' : 'Resolve'}
                        </button>
                      </header>
                      <ol>
                        {thread.messages.map((message) => (
                          <li key={message.id}>
                            <strong>{message.actorId}</strong>
                            <p>{message.body}</p>
                            {message.mentions.length > 0 ? (
                              <small>Mentioned: {message.mentions.join(', ')}</small>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                      <div className="comment-reply">
                        <input
                          aria-label={`Reply to comment ${thread.id}`}
                          placeholder="Reply…"
                          value={replyBodies[thread.id] ?? ''}
                          onChange={(event) =>
                            setReplyBodies((current) => ({
                              ...current,
                              [thread.id]: event.target.value,
                            }))
                          }
                        />
                        <button type="button" onClick={() => void replyToThread(thread.id)}>
                          Reply
                        </button>
                      </div>
                    </article>
                  ))}
                  {collaboration.threads.length === 0 ? (
                    <p className="empty-copy">No comment threads for this entry.</p>
                  ) : null}
                </div>
              </section>

              <section className="blocks-section">
                <div className="section-heading">
                  <div>
                    <span className="kicker">Composition</span>
                    <h2>{componentField?.label ?? 'Page blocks'}</h2>
                  </div>
                  <div className="composition-toolbar">
                    <span>{layers.length} components</span>
                    <button
                      type="button"
                      onClick={() => restoreComposition('undo')}
                      disabled={compositionHistory.past.length === 0}
                      aria-label="Undo composition change"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={() => restoreComposition('redo')}
                      disabled={compositionHistory.future.length === 0}
                      aria-label="Redo composition change"
                    >
                      Redo
                    </button>
                  </div>
                </div>
                <section className="layers-panel" aria-label="Composition layers">
                  <span>Layers</span>
                  <p className="composition-help" id="composition-keyboard-help">
                    Select a layer, then use arrow keys to reorder or nest it. Press Delete to
                    remove it.
                  </p>
                  <button
                    type="button"
                    className="layer-root-drop"
                    onClick={() => {
                      if (compositionHistory.selectedId) {
                        applyComposition(
                          moveNode(
                            draftBlocks,
                            compositionHistory.selectedId,
                            { index: draftBlocks.length },
                            compositionRules,
                          ),
                          compositionHistory.selectedId,
                        );
                      }
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedNodeId) {
                        applyComposition(
                          moveNode(
                            draftBlocks,
                            draggedNodeId,
                            { index: draftBlocks.length },
                            compositionRules,
                          ),
                          draggedNodeId,
                        );
                      }
                      setDraggedNodeId(null);
                    }}
                  >
                    Move selected to root
                  </button>
                  {layers.map((layer) => (
                    <button
                      type="button"
                      className={`layer-row ${compositionHistory.selectedId === layer.node.id ? 'layer-row--selected' : ''}`}
                      key={layer.node.id}
                      aria-describedby="composition-keyboard-help"
                      style={{ paddingLeft: `${0.75 + layer.depth * 1.1}rem` }}
                      draggable
                      onDragStart={() => setDraggedNodeId(layer.node.id)}
                      onDragEnd={() => setDraggedNodeId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedNodeId && draggedNodeId !== layer.node.id) {
                          applyComposition(
                            moveNode(
                              draftBlocks,
                              draggedNodeId,
                              targetAt(layer.location, layer.location.index),
                              compositionRules,
                            ),
                            draggedNodeId,
                          );
                        }
                        setDraggedNodeId(null);
                      }}
                      onClick={() =>
                        setCompositionHistory((current) => ({
                          ...current,
                          selectedId: layer.node.id,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (
                          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete'].includes(
                            event.key,
                          )
                        ) {
                          event.preventDefault();
                          moveByKeyboard(layer.node.id, event.key);
                        }
                      }}
                    >
                      <span>
                        {manifestById.get(layer.node.component)?.name ?? layer.node.component}
                      </span>
                      <small>
                        {layer.location.slotName ? `${layer.location.slotName} · ` : ''}
                        {layer.node.id}
                      </small>
                    </button>
                  ))}
                </section>
                <div className="block-list">
                  {draftBlocks.map((node, index) => {
                    const manifest = manifestById.get(node.component);
                    return (
                      <article
                        className={`block-editor ${compositionHistory.selectedId === node.id ? 'block-editor--selected' : ''}`}
                        key={node.id}
                      >
                        <header>
                          <button
                            type="button"
                            className="block-select"
                            onClick={() =>
                              setCompositionHistory((current) => ({
                                ...current,
                                selectedId: node.id,
                              }))
                            }
                          >
                            <span className="block-number">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span>
                              <strong>{manifest?.name ?? node.component}</strong>
                              <small>{manifest?.description}</small>
                            </span>
                          </button>
                          <div className="block-actions">
                            <button
                              type="button"
                              aria-label="Move block up"
                              disabled={index === 0}
                              onClick={() =>
                                applyComposition(
                                  moveNode(
                                    draftBlocks,
                                    node.id,
                                    { index: index - 1 },
                                    compositionRules,
                                  ),
                                  node.id,
                                )
                              }
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label="Move block down"
                              disabled={index === draftBlocks.length - 1}
                              onClick={() =>
                                applyComposition(
                                  moveNode(
                                    draftBlocks,
                                    node.id,
                                    { index: index + 2 },
                                    compositionRules,
                                  ),
                                  node.id,
                                )
                              }
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="danger"
                              aria-label="Remove block"
                              disabled={draftBlocks.length <= (componentField?.minimum ?? 0)}
                              onClick={() =>
                                applyComposition(removeNode(draftBlocks, node.id, compositionRules))
                              }
                            >
                              ×
                            </button>
                          </div>
                        </header>
                        <div className="block-fields">
                          {manifest
                            ? editablePropsFor(node, manifest).map((prop) => (
                                <FieldControl
                                  key={prop.id}
                                  idPrefix={node.id}
                                  definition={prop}
                                  value={node.props[prop.name]}
                                  onChange={(value) =>
                                    changeBlocks(
                                      (current) =>
                                        updateNodeProps(current, node.id, {
                                          ...node.props,
                                          [prop.name]: value,
                                        }),
                                      node.id,
                                    )
                                  }
                                />
                              ))
                            : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="component-palette">
                  <span>Add at root</span>
                  {manifests
                    .filter(
                      (manifest) => rootAccepts.length === 0 || rootAccepts.includes(manifest.id),
                    )
                    .map((manifest) => (
                      <button
                        type="button"
                        key={manifest.id}
                        onClick={() => {
                          const node = newNode(manifest);
                          applyComposition(
                            addNode(
                              draftBlocks,
                              node,
                              { index: draftBlocks.length },
                              compositionRules,
                            ),
                            node.id,
                          );
                        }}
                      >
                        + {manifest.name}
                      </button>
                    ))}
                </div>
                <div className="design-library">
                  <fieldset className="component-palette">
                    <legend>Reusable symbols</legend>
                    {designSystem.symbols.map((symbol) => (
                      <button
                        type="button"
                        key={symbol.id}
                        onClick={() => addSymbolAtRoot(symbol.id)}
                      >
                        + {symbol.name}
                      </button>
                    ))}
                  </fieldset>
                  <fieldset className="component-palette">
                    <legend>Page templates</legend>
                    {designSystem.templates.map((template) => (
                      <button
                        type="button"
                        key={template.id}
                        onClick={() => addTemplateAtRoot(template.id)}
                      >
                        Apply {template.name}
                      </button>
                    ))}
                  </fieldset>
                </div>
                {selectedNode && selectedManifest ? (
                  <section
                    className="component-inspector"
                    aria-label="Selected component inspector"
                  >
                    <header>
                      <div>
                        <span className="kicker">Selected component</span>
                        <h3>{selectedManifest.name}</h3>
                        <code>{selectedNode.id}</code>
                      </div>
                      <button
                        type="button"
                        className="danger-link"
                        onClick={() =>
                          applyComposition(
                            removeNode(draftBlocks, selectedNode.id, compositionRules),
                          )
                        }
                      >
                        Remove
                      </button>
                    </header>
                    {selectedSymbol ? (
                      <p className="symbol-notice">
                        Linked to {selectedSymbol.name}. Only approved overrides are editable;
                        governed values update from the design system.
                      </p>
                    ) : null}
                    {editablePropsFor(selectedNode, selectedManifest).length > 0 ? (
                      <div className="block-fields">
                        {editablePropsFor(selectedNode, selectedManifest).map((prop) => (
                          <FieldControl
                            key={prop.id}
                            idPrefix={`inspector-${selectedNode.id}`}
                            definition={prop}
                            value={selectedNode.props[prop.name]}
                            onChange={(value) =>
                              changeBlocks(
                                (current) =>
                                  updateNodeProps(current, selectedNode.id, {
                                    ...selectedNode.props,
                                    [prop.name]: value,
                                  }),
                                selectedNode.id,
                              )
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                    <section className="presentation-editor" aria-label="Design bindings">
                      <label className="gs-field">
                        <span>Component variant</span>
                        <select
                          value={selectedNode.presentation?.variantId ?? ''}
                          onChange={(event) =>
                            changePresentation(selectedNode, (current) => ({
                              ...current,
                              ...(event.target.value
                                ? { variantId: event.target.value }
                                : { variantId: undefined }),
                            }))
                          }
                        >
                          <option value="">Default</option>
                          {selectedVariants.map((variant) => (
                            <option key={variant.id} value={variant.id}>
                              {variant.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="binding-list">
                        {editablePropsFor(selectedNode, selectedManifest).map((prop) => {
                          const tokens = designSystem.tokens.filter((token) =>
                            tokenCompatible(prop, token.value),
                          );
                          return (
                            <div className="binding-row" key={prop.id}>
                              <label>
                                <span>{prop.label} token</span>
                                <select
                                  value={
                                    selectedNode.presentation?.tokenBindings?.[prop.name] ?? ''
                                  }
                                  onChange={(event) =>
                                    changePresentation(selectedNode, (current) => {
                                      const tokenBindings = {
                                        ...current.tokenBindings,
                                      };
                                      if (event.target.value)
                                        tokenBindings[prop.name] = event.target.value;
                                      else delete tokenBindings[prop.name];
                                      return { ...current, tokenBindings };
                                    })
                                  }
                                >
                                  <option value="">Unbound</option>
                                  {tokens.map((token) => (
                                    <option key={token.id} value={token.id}>
                                      {token.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                onClick={() =>
                                  changePresentation(selectedNode, (current) => ({
                                    ...current,
                                    responsive: {
                                      ...current.responsive,
                                      [prop.name]: {
                                        ...current.responsive?.[prop.name],
                                        [previewBreakpoint]: selectedNode.props[prop.name],
                                      },
                                    },
                                  }))
                                }
                              >
                                Capture for {previewBreakpoint}
                              </button>
                              {Object.hasOwn(
                                selectedNode.presentation?.responsive?.[prop.name] ?? {},
                                previewBreakpoint,
                              ) ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    changePresentation(selectedNode, (current) => {
                                      const values = { ...current.responsive?.[prop.name] };
                                      delete values[previewBreakpoint];
                                      return {
                                        ...current,
                                        responsive: {
                                          ...current.responsive,
                                          [prop.name]: values,
                                        },
                                      };
                                    })
                                  }
                                >
                                  Clear {previewBreakpoint}
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                    {selectedManifest.slots.length > 0 ? (
                      <div className="slot-list">
                        {selectedManifest.slots.map((slot) => {
                          const children = selectedNode.slots?.[slot.name] ?? [];
                          return (
                            <section className="slot-editor" key={slot.id}>
                              <header>
                                <div>
                                  <strong className="slot-title">{slot.label}</strong>
                                  <span className="slot-count">
                                    {children.length}
                                    {slot.max === undefined ? '' : ` / ${slot.max}`} components
                                  </span>
                                </div>
                                <small className="slot-rule">
                                  Minimum {slot.min}; accepts{' '}
                                  {slot.accepts.length > 0
                                    ? slot.accepts.join(', ')
                                    : 'any component'}
                                </small>
                              </header>
                              <button
                                type="button"
                                className="slot-drop-zone"
                                onClick={() =>
                                  setNotice({
                                    tone: 'info',
                                    message:
                                      'To nest without dragging, focus the layer after a compatible container and press ArrowRight.',
                                  })
                                }
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  if (draggedNodeId) {
                                    applyComposition(
                                      moveNode(
                                        draftBlocks,
                                        draggedNodeId,
                                        {
                                          parentId: selectedNode.id,
                                          slotName: slot.name,
                                          index: children.length,
                                        },
                                        compositionRules,
                                      ),
                                      draggedNodeId,
                                    );
                                  }
                                  setDraggedNodeId(null);
                                }}
                              >
                                Drop a layer into {slot.label} · keyboard help
                              </button>
                              <fieldset className="slot-palette">
                                <legend>Add to {slot.label}</legend>
                                {manifests
                                  .filter(
                                    (manifest) =>
                                      slot.accepts.length === 0 ||
                                      slot.accepts.includes(manifest.id),
                                  )
                                  .map((manifest) => (
                                    <button
                                      type="button"
                                      key={manifest.id}
                                      disabled={
                                        slot.max !== undefined && children.length >= slot.max
                                      }
                                      onClick={() => {
                                        const node = newNode(manifest);
                                        applyComposition(
                                          addNode(
                                            draftBlocks,
                                            node,
                                            {
                                              parentId: selectedNode.id,
                                              slotName: slot.name,
                                              index: children.length,
                                            },
                                            compositionRules,
                                          ),
                                          node.id,
                                        );
                                      }}
                                    >
                                      + {manifest.name}
                                    </button>
                                  ))}
                              </fieldset>
                            </section>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </section>

              <section className="history-section">
                <div className="section-heading">
                  <div>
                    <span className="kicker">History</span>
                    <h2>Immutable revisions</h2>
                  </div>
                  <span>{revisions.length} saved</span>
                </div>
                <ol>
                  {revisions.map((revision) => (
                    <li key={revision.id}>
                      <strong>Revision {revision.sequence}</strong>
                      <span>{new Date(revision.createdAt).toLocaleString()}</span>
                      <code>{revision.actorId}</code>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          ) : null}
        </main>

        <aside className="preview-panel" aria-label="Live page preview">
          <div className="preview-toolbar">
            <div>
              <span className="kicker">Live React preview</span>
              <strong>
                {externalPreview
                  ? `${externalPreview.mode} · ${externalPreview.ready ? 'connected' : 'connecting'}`
                  : `${previewBreakpoint} · 100%`}
              </strong>
            </div>
            <div className="preview-controls">
              <fieldset className="segmented" aria-label="Preview breakpoint">
                {designSystem.breakpoints.map((breakpoint) => (
                  <button
                    type="button"
                    key={breakpoint.id}
                    className={previewBreakpoint === breakpoint.id ? 'active' : ''}
                    onClick={() => setPreviewBreakpoint(breakpoint.id)}
                  >
                    {breakpoint.name}
                  </button>
                ))}
              </fieldset>
              <fieldset className="segmented" aria-label="Preview perspective">
                <button
                  type="button"
                  className={previewPerspective === 'draft' ? 'active' : ''}
                  onClick={() => setPreviewPerspective('draft')}
                >
                  Draft
                </button>
                <button
                  type="button"
                  className={previewPerspective === 'published' ? 'active' : ''}
                  onClick={() => setPreviewPerspective('published')}
                  disabled={!published}
                >
                  Published
                </button>
              </fieldset>
              <fieldset className="segmented" aria-label="Application preview">
                <button
                  type="button"
                  className={externalPreview?.mode === 'iframe' ? 'active' : ''}
                  onClick={() => void startExternalPreview('iframe')}
                  disabled={!selected}
                >
                  App iframe
                </button>
                <button
                  type="button"
                  className={externalPreview?.mode === 'standalone' ? 'active' : ''}
                  onClick={() => void startExternalPreview('standalone')}
                  disabled={!selected}
                >
                  Standalone
                </button>
                {externalPreview ? (
                  <button type="button" onClick={() => void closeExternalPreview()}>
                    Close app preview
                  </button>
                ) : null}
              </fieldset>
            </div>
          </div>
          <div className="preview-canvas">
            <div className="preview-browser-bar">
              <span />
              <span />
              <span />
              <div>{externalPreview?.route ?? `/${previewSlug}`}</div>
            </div>
            <div
              className={`preview-page${externalPreview?.mode === 'iframe' ? ' preview-page--external' : ''}`}
            >
              {externalPreview?.mode === 'iframe' ? (
                <iframe
                  ref={previewFrameRef}
                  src={externalPreview.grant.previewUrl}
                  title="Application draft preview"
                  sandbox="allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                />
              ) : previewContent ? (
                <>
                  {previewPerspective === 'draft' && selectedNode && selectedManifest ? (
                    <section className="inline-editor" aria-label="Inline component editor">
                      <span className="kicker">Inline edit · {selectedManifest.name}</span>
                      <div>
                        {editablePropsFor(selectedNode, selectedManifest).map((prop) => (
                          <FieldControl
                            key={prop.id}
                            idPrefix={`inline-${selectedNode.id}`}
                            definition={prop}
                            value={selectedNode.props[prop.name]}
                            onChange={(value) =>
                              changeBlocks(
                                (current) =>
                                  updateNodeProps(current, selectedNode.id, {
                                    ...selectedNode.props,
                                    [prop.name]: value,
                                  }),
                                selectedNode.id,
                              )
                            }
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                  <GridStoryRenderer
                    nodes={previewBlocks}
                    registry={exampleComponentRegistry}
                    designSystem={designSystem}
                    breakpoint={previewBreakpoint}
                    preview={previewPerspective === 'draft'}
                  />
                </>
              ) : (
                <div className="preview-empty">This page has not been published yet.</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
