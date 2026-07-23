import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  GridStoryApiError,
  createGridStoryClient,
  type ComponentManifest,
  type ContentEntry,
  type ContentRevision,
  type GridStoryClient,
  type OperationsDashboardRecord,
  type PreviewSessionGrant,
} from '@gridstory/client';
import {
  createGridStoryPreviewController,
  type GridStoryPreviewController,
} from '@gridstory/client/preview';
import { componentManifests } from '@gridstory/example-kit/manifests';
import { exampleDesignSystem } from '@gridstory/example-kit/design-system';
import { exampleComponentRegistry } from '@gridstory/example-kit/react';
import { GridStoryRenderer } from '@gridstory/react';
import type {
  ComponentNode,
  ContentSchemaDefinition,
  DesignSystemManifest,
  FieldDefinition,
  PropDefinition,
} from '@gridstory/schema';
import {
  addNode,
  commitComposition,
  createCompositionHistory,
  findNode,
  flattenLayers,
  instantiateSymbol,
  instantiateTemplate,
  locateNode,
  moveNode,
  redoComposition,
  removeNode,
  undoComposition,
  updateNodeProps,
  updateNodePresentation,
  type CompositionResult,
  type MoveTarget,
} from './composition-editor.js';

const defaultClient = createGridStoryClient({
  baseUrl: import.meta.env.VITE_GRIDSTORY_API_URL ?? 'http://localhost:4000',
  tenantId: import.meta.env.VITE_GRIDSTORY_TENANT ?? 'default',
  actorId: 'studio-local-admin',
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
  onChange,
}: {
  definition: Exclude<FieldDefinition, { type: 'component-tree' }>;
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactNode {
  const id = `field-${definition.id}`.replaceAll(/[^a-zA-Z0-9_-]/g, '-');
  const structured =
    definition.type === 'object' ||
    definition.type === 'array' ||
    definition.type === 'union' ||
    definition.type === 'relation' ||
    (definition.type === 'taxonomy' && definition.multiple);
  const [jsonValue, setJsonValue] = useState('');
  const [jsonError, setJsonError] = useState(false);
  useEffect(() => {
    if (structured) setJsonValue(JSON.stringify(value ?? null, null, 2));
  }, [structured, value]);

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
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
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
  const [compositionHistory, setCompositionHistory] = useState(() => createCompositionHistory([]));
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);

  const selectEntry = useCallback(
    async (id: string, componentFieldName?: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const [entry, history, publishedEntry] = await Promise.all([
          client.getContent(id, { perspective: 'draft' }),
          client.listRevisions(id),
          client.getContent(id, { perspective: 'published' }).catch((error: unknown) => {
            if (error instanceof GridStoryApiError && error.status === 404) return null;
            throw error;
          }),
        ]);
        setSelected(entry);
        setDraft(asEditableContent(entry));
        setPublished(publishedEntry ? asEditableContent(publishedEntry) : null);
        setRevisions(history);
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
    ])
      .then(async ([entryList, manifestList, schemaList, designSystemManifest]) => {
        setEntries(entryList);
        setManifests(manifestList);
        setSchemas(schemaList);
        setDesignSystem(designSystemManifest);
        if (entryList[0]) {
          const fieldName = schemaList
            .find((schema) => schema.id === entryList[0]?.contentType)
            ?.fields.find((field) => field.type === 'component-tree')?.name;
          await selectEntry(entryList[0].id, fieldName);
        } else setBusy(false);
      })
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

  const activeSchema = useMemo(
    () => schemas.find((schema) => schema.id === selected?.contentType) ?? schemas[0],
    [schemas, selected?.contentType],
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

  const changeDraft = (updater: (current: EditableContent) => EditableContent) => {
    setDraft((current) => (current ? updater(current) : current));
    setDirty(true);
    setNotice(null);
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
      setNotice({
        tone: 'success',
        message: 'Published revision is now available to React applications.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: messageFrom(error) });
    } finally {
      setBusy(false);
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
            onClick={() => void toggleOperations()}
            aria-expanded={operationsDashboard !== null}
          >
            Operations
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
            disabled={!selected || busy}
          >
            Publish
          </button>
        </div>
      </header>

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

        <main className="editor-panel">
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
                      onChange={(value) =>
                        changeDraft((current) => ({ ...current, [field.name]: value }))
                      }
                    />
                  );
                })}
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
                <GridStoryRenderer
                  nodes={previewBlocks}
                  registry={exampleComponentRegistry}
                  designSystem={designSystem}
                  breakpoint={previewBreakpoint}
                  preview={previewPerspective === 'draft'}
                />
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
