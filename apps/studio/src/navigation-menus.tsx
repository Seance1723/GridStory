import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GridStoryApiError, type GridStoryClient } from '@gridstory/client';
import {
  NAVIGATION_MENU_CONTENT_TYPE,
  navigationMenuDataSchema,
  navigationMenuLimits,
  type ContentEntry,
  type ContentRevision,
  type ContentSchemaDefinition,
  type NavigationMenuData,
  type NavigationMenuItemData,
  type NavigationMenuProjection,
  type StudioOperation,
  type TranslationCompletenessReport,
  type WorkflowDefinition,
  type WorkflowInstance,
} from '@gridstory/schema';

type MenuNotice = { tone: 'success' | 'error' | 'info'; message: string };

export interface NavigationMenusProps {
  client: GridStoryClient;
  schemas: ContentSchemaDefinition[];
  can: (...operations: StudioOperation[]) => boolean;
  onDirtyChange: (dirty: boolean) => void;
  onNotice: (notice: MenuNotice) => void;
}

function messageFrom(error: unknown): string {
  if (error instanceof GridStoryApiError) return error.message;
  return error instanceof Error ? error.message : 'Navigation menus could not be updated.';
}

function titleFor(entry: ContentEntry, schemas: ContentSchemaDefinition[]): string {
  const schema = schemas.find((candidate) => candidate.id === entry.contentType);
  const value = schema ? entry.data[schema.titleField] : undefined;
  return typeof value === 'string' && value.trim() ? value : entry.id;
}

function isDescendant(
  items: NavigationMenuItemData[],
  candidate: NavigationMenuItemData,
  ancestorId: string,
): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  let parentId = candidate.parentId;
  while (parentId) {
    if (parentId === ancestorId) return true;
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

function subtreeEnd(items: NavigationMenuItemData[], index: number): number {
  const root = items[index];
  if (!root) return index + 1;
  let end = index + 1;
  while (items[end] && isDescendant(items, items[end] as NavigationMenuItemData, root.id)) end += 1;
  return end;
}

function itemDepth(items: NavigationMenuItemData[], item: NavigationMenuItemData): number {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  let depth = 1;
  let parentId = item.parentId;
  while (parentId) {
    depth += 1;
    parentId = byId.get(parentId)?.parentId;
  }
  return depth;
}

export function NavigationMenus({
  client,
  schemas,
  can,
  onDirtyChange,
  onNotice,
}: NavigationMenusProps) {
  const [menus, setMenus] = useState<ContentEntry[]>([]);
  const [targets, setTargets] = useState<ContentEntry[]>([]);
  const [selected, setSelected] = useState<ContentEntry | null>(null);
  const [draft, setDraft] = useState<NavigationMenuData | null>(null);
  const [savedData, setSavedData] = useState('');
  const [preview, setPreview] = useState<NavigationMenuProjection | null>(null);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowInstance | null>(null);
  const [workflowDefinition, setWorkflowDefinition] = useState<WorkflowDefinition | null>(null);
  const [translations, setTranslations] = useState<TranslationCompletenessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const selectedId = useRef<string | null>(null);

  const dirty = draft !== null && JSON.stringify(draft) !== savedData;
  const routedSchemas = useMemo(
    () => schemas.filter((schema) => schema.route && schema.id !== NAVIGATION_MENU_CONTENT_TYPE),
    [schemas],
  );

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const applySelected = useCallback(
    async (entry: ContentEntry) => {
      setBusy(true);
      setError(null);
      setPreview(null);
      try {
        const parsed = navigationMenuDataSchema.safeParse(entry.data);
        if (!parsed.success)
          throw new Error('This menu draft is invalid and cannot be edited safely.');
        const [nextRevisions, nextWorkflow, definitions, nextTranslations] = await Promise.all([
          can('content.history.read') ? client.listRevisions(entry.id) : Promise.resolve([]),
          can('workflow.read') ? client.getContentWorkflow(entry.id) : Promise.resolve(null),
          can('workflow.read') ? client.listWorkflows() : Promise.resolve([]),
          can('locales.read') ? client.getTranslationCompleteness(entry.id) : Promise.resolve(null),
        ]);
        selectedId.current = entry.id;
        setSelected(entry);
        setDraft(parsed.data);
        setSavedData(JSON.stringify(parsed.data));
        setRevisions(nextRevisions);
        setWorkflow(nextWorkflow);
        setWorkflowDefinition(
          nextWorkflow
            ? (definitions.find((definition) => definition.id === nextWorkflow.workflowId) ?? null)
            : null,
        );
        setTranslations(nextTranslations);
      } catch (caught) {
        setError(messageFrom(caught));
      } finally {
        setBusy(false);
      }
    },
    [can, client],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextMenus = await client.listContent({ contentType: NAVIGATION_MENU_CONTENT_TYPE });
      const nextTargets = (
        await Promise.all(
          routedSchemas.map((schema) => client.listContent({ contentType: schema.id })),
        )
      ).flat();
      setMenus(nextMenus);
      setTargets(nextTargets);
      const current = nextMenus.find((menu) => menu.id === selectedId.current) ?? nextMenus[0];
      if (current) await applySelected(current);
      else {
        selectedId.current = null;
        setSelected(null);
        setDraft(null);
        setSavedData('');
      }
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }, [applySelected, client, routedSchemas]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeDraft = (update: (current: NavigationMenuData) => NavigationMenuData) => {
    setDraft((current) => (current ? update(current) : current));
    setPreview(null);
  };

  const createMenu = async () => {
    if (!newKey.trim() || !newName.trim()) return;
    setBusy(true);
    try {
      const created = await client.createNavigationMenu(newKey.trim(), newName.trim());
      setNewKey('');
      setNewName('');
      setMenus((current) => [...current, created]);
      await applySelected(created);
      onNotice({ tone: 'success', message: 'Navigation menu draft created.' });
    } catch (caught) {
      onNotice({ tone: 'error', message: messageFrom(caught) });
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<ContentEntry | null> => {
    if (!selected || !draft) return null;
    setBusy(true);
    try {
      const parsed = navigationMenuDataSchema.parse(draft);
      const updated = await client.saveDraft(selected.id, selected.draftRevisionId, parsed);
      setMenus((current) => current.map((menu) => (menu.id === updated.id ? updated : menu)));
      await applySelected(updated);
      onNotice({ tone: 'success', message: 'Navigation menu draft saved.' });
      return updated;
    } catch (caught) {
      onNotice({ tone: 'error', message: messageFrom(caught) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async () => {
    if (!selected || dirty) return;
    setBusy(true);
    try {
      setPreview(await client.getNavigationMenuDraft(selected.id));
      onNotice({ tone: 'info', message: 'Resolved draft preview refreshed.' });
    } catch (caught) {
      onNotice({ tone: 'error', message: messageFrom(caught) });
    } finally {
      setBusy(false);
    }
  };

  const runTransition = async (transitionId: string) => {
    if (!selected || dirty) return;
    setBusy(true);
    try {
      setWorkflow(await client.requestWorkflowTransition(selected.id, transitionId, ['items']));
      onNotice({ tone: 'success', message: 'Navigation workflow state updated.' });
    } catch (caught) {
      onNotice({ tone: 'error', message: messageFrom(caught) });
    } finally {
      setBusy(false);
    }
  };

  const decideApproval = async (decision: 'approved' | 'rejected') => {
    if (!selected || !workflow?.pendingApproval || dirty) return;
    setBusy(true);
    try {
      setWorkflow(
        await client.decideWorkflowApproval(
          selected.id,
          workflow.pendingApproval.id,
          decision,
          'Reviewed in the navigation menu editor.',
        ),
      );
      onNotice({
        tone: decision === 'approved' ? 'success' : 'info',
        message: decision === 'approved' ? 'Navigation approval recorded.' : 'Changes requested.',
      });
    } catch (caught) {
      onNotice({ tone: 'error', message: messageFrom(caught) });
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!selected || dirty) return;
    setBusy(true);
    try {
      const published = await client.publish(selected.id, selected.draftRevisionId);
      setMenus((current) => current.map((menu) => (menu.id === published.id ? published : menu)));
      await applySelected(published);
      onNotice({ tone: 'success', message: 'Published menu is available to connected sites.' });
    } catch (caught) {
      onNotice({ tone: 'error', message: messageFrom(caught) });
    } finally {
      setBusy(false);
    }
  };

  const addItem = () => {
    if (!draft || draft.items.length >= navigationMenuLimits.maximumItems) return;
    const base = `item-${draft.items.length + 1}`;
    let id = base;
    let suffix = 2;
    while (draft.items.some((item) => item.id === id)) id = `${base}-${suffix++}`;
    changeDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        { id, label: 'New link', kind: 'external', externalUrl: 'https://example.com' },
      ],
    }));
  };

  const updateItem = (index: number, update: Partial<NavigationMenuItemData>) =>
    changeDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? ({ ...item, ...update } as NavigationMenuItemData) : item,
      ),
    }));

  const removeItem = (index: number) =>
    changeDraft((current) => {
      const root = current.items[index];
      if (!root) return current;
      return {
        ...current,
        items: current.items.filter(
          (item, itemIndex) => itemIndex !== index && !isDescendant(current.items, item, root.id),
        ),
      };
    });

  const moveItem = (index: number, direction: -1 | 1) =>
    changeDraft((current) => {
      const item = current.items[index];
      if (!item) return current;
      const siblings = current.items
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate }) => candidate.parentId === item.parentId);
      const siblingIndex = siblings.findIndex(({ candidateIndex }) => candidateIndex === index);
      const other = siblings[siblingIndex + direction];
      if (!other) return current;
      const itemEnd = subtreeEnd(current.items, index);
      const otherEnd = subtreeEnd(current.items, other.candidateIndex);
      if (direction < 0) {
        return {
          ...current,
          items: [
            ...current.items.slice(0, other.candidateIndex),
            ...current.items.slice(index, itemEnd),
            ...current.items.slice(other.candidateIndex, index),
            ...current.items.slice(itemEnd),
          ],
        };
      }
      return {
        ...current,
        items: [
          ...current.items.slice(0, index),
          ...current.items.slice(itemEnd, otherEnd),
          ...current.items.slice(index, itemEnd),
          ...current.items.slice(otherEnd),
        ],
      };
    });

  const indentItem = (index: number) => {
    if (!draft) return;
    const item = draft.items[index];
    if (!item) return;
    const previous = [...draft.items.slice(0, index)]
      .reverse()
      .find((candidate) => candidate.parentId === item.parentId);
    if (!previous || itemDepth(draft.items, previous) >= navigationMenuLimits.maximumDepth) return;
    updateItem(index, { parentId: previous.id });
  };

  const outdentItem = (index: number) => {
    if (!draft) return;
    const item = draft.items[index];
    if (!item?.parentId) return;
    const parent = draft.items.find((candidate) => candidate.id === item.parentId);
    updateItem(index, { parentId: parent?.parentId });
  };

  const availableTransitions =
    workflowDefinition && workflow
      ? workflowDefinition.transitions.filter((transition) => transition.from === workflow.stateId)
      : [];
  const publishReady = availableTransitions.some((transition) =>
    workflowDefinition?.states.some(
      (state) => state.id === transition.to && state.kind === 'published',
    ),
  );

  if (loading) return <div className="loading-state">Loading navigation menus…</div>;

  return (
    <section className="feature-panel navigation-menus" aria-labelledby="navigation-menus-title">
      <header className="section-heading navigation-menus__heading">
        <div>
          <span className="kicker">Navigation</span>
          <h1 id="navigation-menus-title">Visitor menus</h1>
          <p>
            Version, localize and publish link data while each application owns its markup and CSS.
          </p>
        </div>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void refresh()}
          disabled={busy}
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className="notice notice--error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      ) : null}

      <form
        className="navigation-menus__create"
        aria-label="Create navigation menu"
        onSubmit={(event) => {
          event.preventDefault();
          void createMenu();
        }}
      >
        <label className="gs-field">
          <span>New menu key</span>
          <input
            value={newKey}
            placeholder="header"
            maxLength={navigationMenuLimits.maximumKeyCharacters}
            onChange={(event) => setNewKey(event.target.value)}
          />
        </label>
        <label className="gs-field">
          <span>New menu name</span>
          <input
            value={newName}
            placeholder="Header navigation"
            maxLength={navigationMenuLimits.maximumNameCharacters}
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        <button
          data-required-operations="content.create"
          type="submit"
          className="button button--primary"
          disabled={!can('content.create') || busy || !newKey.trim() || !newName.trim()}
        >
          Create menu
        </button>
      </form>

      <div className="navigation-menus__workspace">
        <aside className="navigation-menus__list" aria-label="Navigation menus">
          <h2>Menus</h2>
          {menus.length ? (
            <ul>
              {menus.map((menu) => (
                <li key={menu.id}>
                  <button
                    type="button"
                    className={`entry-card${selected?.id === menu.id ? ' entry-card--active' : ''}`}
                    aria-current={selected?.id === menu.id ? 'true' : undefined}
                    onClick={() => void applySelected(menu)}
                    disabled={busy}
                  >
                    <span className="entry-card__title">{String(menu.data.name ?? menu.id)}</span>
                    <span className="entry-card__meta">
                      {String(menu.data.key ?? '')} · {menu.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-copy">No visitor menus exist in this locale and site context.</p>
          )}
        </aside>

        {selected && draft ? (
          <div className="navigation-menus__editor" aria-busy={busy}>
            <div inert={busy} style={{ display: 'contents' }}>
              <div className="section-heading">
                <div>
                  <span className="kicker">{draft.key}</span>
                  <h2>{draft.name}</h2>
                  <p>
                    {draft.items.length} / {navigationMenuLimits.maximumItems} items · maximum depth{' '}
                    {navigationMenuLimits.maximumDepth}
                  </p>
                </div>
                <span className={`status status--${selected.status}`}>{selected.status}</span>
              </div>

              <div className="navigation-menus__fields">
                <label className="gs-field">
                  <span>Stable key</span>
                  <input value={draft.key} readOnly aria-readonly="true" />
                </label>
                <label className="gs-field">
                  <span>Menu name</span>
                  <input
                    value={draft.name}
                    maxLength={navigationMenuLimits.maximumNameCharacters}
                    onChange={(event) =>
                      changeDraft((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="navigation-menus__toolbar">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={addItem}
                  disabled={
                    !can('content.draft.update') ||
                    busy ||
                    draft.items.length >= navigationMenuLimits.maximumItems
                  }
                >
                  Add link
                </button>
                <button
                  data-required-operations="content.draft.update"
                  type="button"
                  className="button button--primary"
                  onClick={() => void save()}
                  disabled={!can('content.draft.update') || busy || !dirty}
                >
                  Save draft
                </button>
                <button
                  type="button"
                  className="button button--outline"
                  onClick={() => void showPreview()}
                  disabled={busy || dirty}
                >
                  Preview resolved links
                </button>
                <button
                  data-required-operations="content.publish"
                  type="button"
                  className="button button--primary"
                  onClick={() => void publish()}
                  disabled={!can('content.publish') || busy || dirty || !publishReady}
                >
                  Publish
                </button>
              </div>

              <ol className="navigation-menus__items">
                {draft.items.map((item, index) => (
                  <li
                    key={item.id}
                    className="navigation-menu-item"
                    style={{ '--menu-depth': itemDepth(draft.items, item) } as CSSProperties}
                  >
                    <div className="navigation-menu-item__heading">
                      <strong>{item.label || item.id}</strong>
                      <span>Depth {itemDepth(draft.items, item)}</span>
                    </div>
                    <div className="navigation-menu-item__fields">
                      <label className="gs-field">
                        <span>Stable item ID</span>
                        <input
                          value={item.id}
                          maxLength={navigationMenuLimits.maximumItemIdCharacters}
                          onChange={(event) => updateItem(index, { id: event.target.value })}
                        />
                      </label>
                      <label className="gs-field">
                        <span>Link label</span>
                        <input
                          value={item.label}
                          maxLength={navigationMenuLimits.maximumLabelCharacters}
                          onChange={(event) => updateItem(index, { label: event.target.value })}
                        />
                      </label>
                      <label className="gs-field">
                        <span>Link kind</span>
                        <select
                          value={item.kind}
                          onChange={(event) =>
                            event.target.value === 'internal'
                              ? updateItem(index, {
                                  kind: 'internal',
                                  target: targets[0]
                                    ? { id: targets[0].id, contentType: targets[0].contentType }
                                    : undefined,
                                  externalUrl: undefined,
                                })
                              : updateItem(index, {
                                  kind: 'external',
                                  target: undefined,
                                  externalUrl: 'https://example.com',
                                })
                          }
                        >
                          <option value="internal">Internal content</option>
                          <option value="external">External URL</option>
                        </select>
                      </label>
                      {item.kind === 'internal' ? (
                        <label className="gs-field">
                          <span>Content target</span>
                          <select
                            value={
                              item.target ? `${item.target.contentType}:${item.target.id}` : ''
                            }
                            onChange={(event) => {
                              const target = targets.find(
                                (candidate) =>
                                  `${candidate.contentType}:${candidate.id}` === event.target.value,
                              );
                              updateItem(index, {
                                target: target
                                  ? { id: target.id, contentType: target.contentType }
                                  : undefined,
                              });
                            }}
                          >
                            <option value="">Choose routed content</option>
                            {targets.map((target) => (
                              <option
                                key={`${target.contentType}:${target.id}`}
                                value={`${target.contentType}:${target.id}`}
                              >
                                {titleFor(target, schemas)} · {target.contentType}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <label className="gs-field">
                          <span>Absolute HTTP(S) URL</span>
                          <input
                            type="url"
                            value={item.externalUrl ?? ''}
                            maxLength={navigationMenuLimits.maximumUrlCharacters}
                            onChange={(event) =>
                              updateItem(index, { externalUrl: event.target.value })
                            }
                          />
                        </label>
                      )}
                    </div>
                    <div className="navigation-menu-item__actions">
                      <button
                        type="button"
                        className="button button--outline button--compact"
                        onClick={() => moveItem(index, -1)}
                        disabled={busy}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className="button button--outline button--compact"
                        onClick={() => moveItem(index, 1)}
                        disabled={busy}
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        className="button button--outline button--compact"
                        onClick={() => indentItem(index)}
                        disabled={
                          busy || itemDepth(draft.items, item) >= navigationMenuLimits.maximumDepth
                        }
                      >
                        Indent
                      </button>
                      <button
                        type="button"
                        className="button button--outline button--compact"
                        onClick={() => outdentItem(index)}
                        disabled={busy || !item.parentId}
                      >
                        Outdent
                      </button>
                      <button
                        type="button"
                        className="button button--danger button--compact"
                        onClick={() => removeItem(index)}
                        disabled={busy}
                      >
                        Remove subtree
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              {draft.items.length === 0 ? (
                <p className="empty-copy">Add the first internal or external visitor link.</p>
              ) : null}

              {preview ? (
                <section
                  className="navigation-menus__preview"
                  aria-label="Resolved draft navigation"
                >
                  <h3>Resolved draft preview</h3>
                  <nav aria-label={`${preview.name} draft preview`}>
                    <ul>
                      {preview.items.map((item) => (
                        <li
                          key={item.id}
                          style={{ '--menu-depth': item.parentId ? 2 : 1 } as CSSProperties}
                        >
                          <a href={item.href} onClick={(event) => event.preventDefault()}>
                            {item.label}
                          </a>
                          <small>{item.href}</small>
                        </li>
                      ))}
                    </ul>
                  </nav>
                </section>
              ) : null}

              {workflow ? (
                <section className="navigation-menus__workflow" aria-label="Navigation workflow">
                  <div className="section-heading">
                    <div>
                      <span className="kicker">Workflow</span>
                      <h3>{workflowDefinition?.name ?? workflow.workflowId}</h3>
                    </div>
                    <span className="workflow-state">
                      {workflowDefinition?.states.find((state) => state.id === workflow.stateId)
                        ?.label ?? workflow.stateId}
                    </span>
                  </div>
                  <div className="navigation-menus__toolbar">
                    {availableTransitions
                      .filter(
                        (transition) =>
                          !workflowDefinition?.states.some(
                            (state) => state.id === transition.to && state.kind === 'published',
                          ),
                      )
                      .map((transition) => (
                        <button
                          data-required-operations="workflow.transition"
                          type="button"
                          className="button button--secondary"
                          key={transition.id}
                          disabled={
                            !can('workflow.transition') ||
                            busy ||
                            dirty ||
                            Boolean(workflow.pendingApproval)
                          }
                          onClick={() => void runTransition(transition.id)}
                        >
                          {transition.label}
                        </button>
                      ))}
                  </div>
                  {workflow.pendingApproval ? (
                    <div className="approval-card">
                      <div>
                        <strong>Approval pending</strong>
                        <p>Requested by {workflow.pendingApproval.requestedBy}</p>
                      </div>
                      <div className="navigation-menus__toolbar">
                        <button
                          data-required-operations="workflow.approve"
                          type="button"
                          className="button button--primary"
                          disabled={!can('workflow.approve') || busy || dirty}
                          onClick={() => void decideApproval('approved')}
                        >
                          Approve
                        </button>
                        <button
                          data-required-operations="workflow.approve"
                          type="button"
                          className="button button--secondary"
                          disabled={!can('workflow.approve') || busy || dirty}
                          onClick={() => void decideApproval('rejected')}
                        >
                          Request changes
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section
                className="navigation-menus__evidence"
                aria-label="Revisions and translations"
              >
                <div>
                  <h3>Revision history</h3>
                  <p>
                    {can('content.history.read')
                      ? `${revisions.length} immutable revisions`
                      : 'History access is not permitted.'}
                  </p>
                </div>
                <div>
                  <h3>Localization</h3>
                  {translations ? (
                    <>
                      <p>{translations.percentage}% complete across required locales.</p>
                      <div className="navigation-menus__toolbar">
                        {translations.locales
                          .filter((locale) => !locale.exists)
                          .map((locale) => (
                            <button
                              data-required-operations="content.create"
                              key={locale.locale}
                              type="button"
                              className="button button--outline button--compact"
                              disabled={!can('content.create') || busy || dirty}
                              onClick={() =>
                                void client
                                  .createTranslation(selected.id, locale.locale, {
                                    items: draft.items,
                                  })
                                  .then(() => applySelected(selected))
                                  .then(() =>
                                    onNotice({
                                      tone: 'success',
                                      message: `${locale.locale} menu variant created.`,
                                    }),
                                  )
                                  .catch((caught: unknown) =>
                                    onNotice({ tone: 'error', message: messageFrom(caught) }),
                                  )
                              }
                            >
                              Create {locale.locale} variant
                            </button>
                          ))}
                      </div>
                    </>
                  ) : (
                    <p>Localization status is unavailable.</p>
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <h2>Select or create a menu</h2>
            <p>Menus remain drafts until they complete workflow review and publication.</p>
          </div>
        )}
      </div>
    </section>
  );
}
