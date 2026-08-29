import type {
  ComponentMigrationPlanResponse,
  ComponentVisualRegressionPlan,
} from '@gridstory/client';
import type { ComponentManifest, DesignSystemManifest, PropDefinition } from '@gridstory/schema';

export type DesignCatalogGovernance = {
  componentId: string;
  migration: ComponentMigrationPlanResponse;
  visual: ComponentVisualRegressionPlan;
};

type DesignCatalogProps = {
  manifests: ComponentManifest[];
  designSystem: DesignSystemManifest | null;
  designLoading: boolean;
  designError: string | null;
  governance: DesignCatalogGovernance | null;
  canMigrate: boolean;
  canInsert: boolean;
  busy: boolean;
  insertionTarget: string | null;
  onReloadDesign: () => Promise<void>;
  onInspectComponent: (componentId: string) => Promise<void>;
  onMigrate: (entryId: string, componentId: string, revisionId: string) => Promise<void>;
  onInsertSymbol: (symbolId: string) => void;
  onInsertTemplate: (templateId: string) => void;
};

function primitiveLabel(value: string | number | boolean): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function propContract(prop: PropDefinition): string {
  const constraints: string[] = [prop.type, prop.required ? 'required' : 'optional'];
  if ('values' in prop) constraints.push(prop.values.join(' | '));
  if ('minimum' in prop && prop.minimum !== undefined) constraints.push(`min ${prop.minimum}`);
  if ('maximum' in prop && prop.maximum !== undefined) constraints.push(`max ${prop.maximum}`);
  if ('minLength' in prop && prop.minLength !== undefined)
    constraints.push(`min length ${prop.minLength}`);
  if ('maxLength' in prop && prop.maxLength !== undefined)
    constraints.push(`max length ${prop.maxLength}`);
  return constraints.join(' · ');
}

export function DesignCatalog({
  manifests,
  designSystem,
  designLoading,
  designError,
  governance,
  canMigrate,
  canInsert,
  busy,
  insertionTarget,
  onReloadDesign,
  onInspectComponent,
  onMigrate,
  onInsertSymbol,
  onInsertTemplate,
}: DesignCatalogProps) {
  const selectedManifest = manifests.find(({ id }) => id === governance?.componentId);
  const migrationLocations = governance
    ? [
        ...new Map(
          governance.migration.usage.locations
            .filter(
              (location) =>
                location.perspective === 'draft' &&
                location.version !== governance.migration.component.version,
            )
            .map((location) => [location.entryId, location]),
        ).values(),
      ]
    : [];

  return (
    <section className="design-catalog" aria-label="Governed design catalog">
      <header className="section-heading design-catalog__heading">
        <div>
          <span className="kicker">Design catalog</span>
          <h2>{designSystem?.name ?? 'Application-owned design system'}</h2>
          <p>
            Browse immutable choices supplied by application code. Studio appearance is independent
            and this catalog cannot edit source, global tokens, or rendering behavior.
          </p>
        </div>
        <fieldset className="design-catalog__identity">
          <legend>Design ownership</legend>
          <strong>Code-owned · read-only</strong>
          <code>
            {designSystem ? `${designSystem.id} · version ${designSystem.version}` : 'Unavailable'}
          </code>
        </fieldset>
      </header>

      {designLoading ? <p className="design-catalog__state">Loading design manifest…</p> : null}
      {designError ? (
        <div className="design-catalog__state design-catalog__state--error" role="alert">
          <div>
            <strong>Design choices are unavailable.</strong>
            <p>{designError}</p>
          </div>
          <button className="button button--secondary" type="button" onClick={onReloadDesign}>
            Retry design catalog
          </button>
        </div>
      ) : null}

      <section className="design-catalog__section" aria-labelledby="catalog-components-heading">
        <div className="design-catalog__section-heading">
          <div>
            <span className="kicker">Components</span>
            <h3 id="catalog-components-heading">Contracts, impact, and migration</h3>
          </div>
          {manifests.length ? (
            <label className="gs-field design-catalog__component-picker">
              <span>Inspect component</span>
              <select
                data-required-operations="component.read"
                value={governance?.componentId ?? manifests[0]?.id ?? ''}
                onChange={(event) => void onInspectComponent(event.target.value)}
              >
                {manifests.map((manifest) => (
                  <option key={manifest.id} value={manifest.id}>
                    {manifest.name} · v{manifest.version}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {selectedManifest && governance ? (
          <div className="design-catalog__component-layout">
            <article
              className="design-catalog-card"
              aria-label={`${selectedManifest.name} contract`}
            >
              <header className="design-catalog-card__heading">
                <div>
                  <strong>{selectedManifest.name}</strong>
                  <span>{selectedManifest.category}</span>
                </div>
                <span
                  className={`design-catalog__status design-catalog__status--${selectedManifest.status}`}
                >
                  {selectedManifest.status}
                </span>
              </header>
              <p>{selectedManifest.description || 'No code-owned description.'}</p>
              <code>
                {selectedManifest.id} · immutable v{selectedManifest.version}
              </code>
              {selectedManifest.deprecation ? (
                <p className="design-catalog__warning">
                  {selectedManifest.deprecation.reason}
                  {selectedManifest.deprecation.replacementId
                    ? ` Replacement: ${selectedManifest.deprecation.replacementId}.`
                    : ''}
                </p>
              ) : null}
              <div className="design-catalog__contract-columns">
                <div>
                  <h4>Props ({selectedManifest.props.length})</h4>
                  {selectedManifest.props.length ? (
                    <ul className="design-catalog__records">
                      {selectedManifest.props.map((prop) => (
                        <li key={prop.id}>
                          <strong>{prop.label}</strong>
                          <code>{prop.name}</code>
                          <small>{propContract(prop)}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No editable props.</p>
                  )}
                </div>
                <div>
                  <h4>Slots ({selectedManifest.slots.length})</h4>
                  {selectedManifest.slots.length ? (
                    <ul className="design-catalog__records">
                      {selectedManifest.slots.map((slot) => (
                        <li key={slot.id}>
                          <strong>{slot.label}</strong>
                          <code>{slot.name}</code>
                          <small>
                            {slot.accepts.length
                              ? slot.accepts.join(', ')
                              : 'Any registered component'}
                            {' · '}
                            {slot.min}–{slot.max ?? 'unbounded'} items
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No composition slots.</p>
                  )}
                </div>
              </div>
            </article>

            <article className="design-catalog-card" aria-label="Component impact and migration">
              <header className="design-catalog-card__heading">
                <div>
                  <strong>Scoped impact</strong>
                  <span>
                    {governance.migration.ready ? 'Migration path ready' : 'Review required'}
                  </span>
                </div>
                <span>{governance.migration.outdatedInstances} outdated</span>
              </header>
              <p>
                {governance.migration.usage.totalInstances} scoped usages across{' '}
                {governance.migration.usage.entries} entries.
              </p>
              <dl className="design-catalog__facts">
                <div>
                  <dt>Current version</dt>
                  <dd>{governance.migration.component.version}</dd>
                </div>
                <div>
                  <dt>Unmigratable</dt>
                  <dd>{governance.migration.unmigratableVersions.join(', ') || 'None'}</dd>
                </div>
                <div>
                  <dt>Code scenarios</dt>
                  <dd>{governance.visual.scenarios.length}</dd>
                </div>
                <div>
                  <dt>Content hooks</dt>
                  <dd>{governance.visual.usageHooks.length}</dd>
                </div>
              </dl>
              <div>
                <strong>Visual regression selector</strong>
                <code>{governance.visual.selector}</code>
              </div>
              {migrationLocations.length ? (
                <div className="design-catalog__migration-actions">
                  {migrationLocations.map((location) => (
                    <button
                      data-required-operations="content.draft.update"
                      type="button"
                      className="button button--secondary"
                      key={location.entryId}
                      disabled={!canMigrate || !governance.migration.ready || busy}
                      onClick={() =>
                        void onMigrate(
                          location.entryId,
                          governance.componentId,
                          location.revisionId,
                        )
                      }
                    >
                      Migrate {location.entryId} from v{location.version}
                    </button>
                  ))}
                </div>
              ) : (
                <p>No outdated draft entries require migration.</p>
              )}
            </article>
          </div>
        ) : (
          <p className="design-catalog__state">No component contract is available to inspect.</p>
        )}
      </section>

      <section className="design-catalog__section" aria-labelledby="catalog-tokens-heading">
        <div className="design-catalog__section-heading">
          <div>
            <span className="kicker">Tokens and variants</span>
            <h3 id="catalog-tokens-heading">Approved presentation choices</h3>
          </div>
          <span>Read-only · application resolved</span>
        </div>
        {designSystem ? (
          <div className="design-catalog__catalog-grid">
            <article className="design-catalog-card">
              <h4>Tokens ({designSystem.tokens.length})</h4>
              <ul className="design-catalog__records">
                {designSystem.tokens.map((token) => (
                  <li key={token.id}>
                    <div className="design-catalog__record-heading">
                      <strong>{token.name}</strong>
                      <span>{token.category}</span>
                    </div>
                    <code>
                      {token.id} = {primitiveLabel(token.value)}
                    </code>
                    <small>{token.description || 'No code-owned description.'}</small>
                  </li>
                ))}
              </ul>
            </article>
            <article className="design-catalog-card">
              <h4>Breakpoints ({designSystem.breakpoints.length})</h4>
              <ol className="design-catalog__records">
                {designSystem.breakpoints.map((breakpoint) => (
                  <li key={breakpoint.id}>
                    <strong>{breakpoint.name}</strong>
                    <code>{breakpoint.id}</code>
                    <small>Minimum width {breakpoint.minWidth}px</small>
                  </li>
                ))}
              </ol>
            </article>
            <article className="design-catalog-card">
              <h4>Variants ({designSystem.variants.length})</h4>
              <ul className="design-catalog__records">
                {designSystem.variants.map((variant) => (
                  <li key={variant.id}>
                    <strong>{variant.name}</strong>
                    <code>
                      {variant.id} → {variant.component}
                    </code>
                    <small>{variant.description || 'No code-owned description.'}</small>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        ) : (
          <p className="design-catalog__state">No design choices are currently available.</p>
        )}
      </section>

      <section className="design-catalog__section" aria-labelledby="catalog-patterns-heading">
        <div className="design-catalog__section-heading">
          <div>
            <span className="kicker">Templates and symbols</span>
            <h3 id="catalog-patterns-heading">Approved reusable patterns</h3>
          </div>
          <span>
            {insertionTarget
              ? `Unsaved target: ${insertionTarget}`
              : 'Open a component-capable entry to insert'}
          </span>
        </div>
        {designSystem ? (
          <div className="design-catalog__pattern-grid">
            {designSystem.symbols.map((symbol) => (
              <article className="design-catalog-card" key={symbol.id}>
                <header className="design-catalog-card__heading">
                  <strong>{symbol.name}</strong>
                  <span>Symbol · v{designSystem.version}</span>
                </header>
                <p>{symbol.description || 'No code-owned description.'}</p>
                <code>{symbol.id}</code>
                <small>
                  Root {symbol.node.component} · approved overrides:{' '}
                  {symbol.allowedPropOverrides.join(', ') || 'none'}
                </small>
                <button
                  data-required-operations="content.draft.update"
                  type="button"
                  className="button button--secondary"
                  disabled={!canInsert || busy}
                  onClick={() => onInsertSymbol(symbol.id)}
                >
                  Insert {symbol.name}
                </button>
              </article>
            ))}
            {designSystem.templates.map((template) => (
              <article className="design-catalog-card" key={template.id}>
                <header className="design-catalog-card__heading">
                  <strong>{template.name}</strong>
                  <span>Template · v{designSystem.version}</span>
                </header>
                <p>{template.description || 'No code-owned description.'}</p>
                <code>{template.id}</code>
                <small>
                  {template.category} · {template.nodes.length} root component(s)
                </small>
                <button
                  data-required-operations="content.draft.update"
                  type="button"
                  className="button button--secondary"
                  disabled={!canInsert || busy}
                  onClick={() => onInsertTemplate(template.id)}
                >
                  Insert {template.name}
                </button>
              </article>
            ))}
            {designSystem.symbols.length === 0 && designSystem.templates.length === 0 ? (
              <p className="design-catalog__state">No approved reusable patterns are registered.</p>
            ) : null}
          </div>
        ) : (
          <p className="design-catalog__state">No approved reusable patterns are available.</p>
        )}
        <p className="design-catalog__boundary">
          Insertions use the current root acceptance, cardinality, validation, undo/redo, draft,
          revision, and publication boundaries. They never change the design catalog itself.
        </p>
      </section>
    </section>
  );
}
