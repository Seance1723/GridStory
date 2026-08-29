import type {
  SchemaLifecycleInspection,
  SchemaMigrationAssessmentResponse,
  TaxonomyDefinition,
} from '@gridstory/client';
import type { ContentSchemaDefinition, FieldDefinition } from '@gridstory/schema';
import { useState } from 'react';

type SchemaCatalogProps = {
  schemas: ContentSchemaDefinition[];
  lifecycle: SchemaLifecycleInspection | null;
  drift: import('@gridstory/schema').SchemaDriftReport | null;
  impact: SchemaMigrationAssessmentResponse | null;
  taxonomies: TaxonomyDefinition[];
  loading: boolean;
  error: string | null;
  canReadTaxonomies: boolean;
  canAssessImpact: boolean;
  impactLoading: boolean;
  impactError: string | null;
  onRetry: () => Promise<void>;
};

function fieldContract(field: FieldDefinition): string {
  const details = [field.type, field.required ? 'required' : 'optional'];
  if (field.type === 'text') {
    if (field.minLength !== undefined) details.push(`min ${field.minLength} chars`);
    if (field.maxLength !== undefined) details.push(`max ${field.maxLength} chars`);
  } else if (field.type === 'slug')
    details.push(`pattern ${field.pattern ?? '^[a-z0-9]+(?:-[a-z0-9]+)*$'}`);
  else if (field.type === 'rich-text')
    details.push(`blocks ${(field.allowedBlocks ?? []).join(', ') || 'none'}`);
  else if (field.type === 'asset') {
    details.push(`accepts ${(field.accepts ?? []).join(', ') || 'none'}`);
    if (field.requiredAlt) details.push('alt required');
  } else if (field.type === 'component-tree') {
    const accepts = field.accepts ?? [];
    details.push(accepts.length ? `accepts ${accepts.join(', ')}` : 'any component');
    details.push(`${field.minimum ?? 0}–${field.maximum ?? 'unbounded'} items`);
  } else if (field.type === 'number') {
    if (field.minimum !== undefined) details.push(`min ${field.minimum}`);
    if (field.maximum !== undefined) details.push(`max ${field.maximum}`);
  } else if (field.type === 'enum') details.push(field.values.join(' | '));
  else if (field.type === 'object') details.push(`object ${field.objectType}`);
  else if (field.type === 'array') {
    details.push(`items ${field.items.type}`);
    details.push(`${field.minimum ?? 0}–${field.maximum ?? 'unbounded'} items`);
  } else if (field.type === 'union') {
    details.push(`discriminator ${field.discriminator}`);
    details.push(`variants ${field.variants.map(({ id }) => id).join(', ')}`);
  } else if (field.type === 'relation') {
    details.push(`targets ${field.targets.join(', ')}`);
    details.push(
      field.multiple ? `${field.minimum ?? 0}–${field.maximum ?? 'unbounded'} entries` : 'single',
    );
  } else if (field.type === 'taxonomy') {
    details.push(`taxonomy ${field.taxonomy}`);
    details.push(
      field.multiple ? `${field.minimum ?? 0}–${field.maximum ?? 'unbounded'} terms` : 'single',
    );
  }
  return details.join(' · ');
}

function TaxonomyTerms({ taxonomy }: { taxonomy: TaxonomyDefinition }) {
  if (!taxonomy.hierarchical) {
    return (
      <ul className="schema-catalog__records schema-catalog__terms">
        {taxonomy.terms.map((term) => (
          <li key={term.id}>
            <strong>{term.label}</strong>
            <code>{term.id}</code>
            <small>slug {term.slug} · no parent</small>
          </li>
        ))}
      </ul>
    );
  }

  const children = new Map<string | undefined, TaxonomyDefinition['terms']>();
  taxonomy.terms.forEach((term) => {
    const branch = children.get(term.parentId) ?? [];
    branch.push(term);
    children.set(term.parentId, branch);
  });
  const renderBranch = (parentId: string | undefined): React.ReactNode => {
    const branch = children.get(parentId) ?? [];
    if (!branch.length) return null;
    return (
      <ul className="schema-catalog__records schema-catalog__terms">
        {branch.map((term) => (
          <li key={term.id}>
            <strong>{term.label}</strong>
            <code>{term.id}</code>
            <small>
              slug {term.slug} · parent {term.parentId ?? 'root'}
            </small>
            {renderBranch(term.id)}
          </li>
        ))}
      </ul>
    );
  };
  return renderBranch(undefined);
}

function fingerprint(value: string | undefined): string {
  return value ? `${value.slice(0, 12)}…` : 'Missing';
}

export function SchemaCatalog({
  schemas,
  lifecycle,
  drift,
  impact,
  taxonomies,
  loading,
  error,
  canReadTaxonomies,
  canAssessImpact,
  impactLoading,
  impactError,
  onRetry,
}: SchemaCatalogProps) {
  const [selectedSchemaId, setSelectedSchemaId] = useState('');
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState('');
  const selectedSchema = schemas.find(({ id }) => id === selectedSchemaId) ?? schemas.at(0) ?? null;
  const selectedTaxonomy =
    taxonomies.find(({ id }) => id === selectedTaxonomyId) ?? taxonomies.at(0) ?? null;

  return (
    <section className="schema-catalog" aria-label="Schema and taxonomy catalog">
      <header className="section-heading schema-catalog__heading">
        <div>
          <span className="kicker">Content model</span>
          <h2>Schemas &amp; taxonomies</h2>
          <p>
            Inspect the canonical application-owned contracts used by validation, routes, search,
            generated types, and runtime deployment. This surface is read-only.
          </p>
        </div>
        <fieldset className="schema-catalog__identity">
          <legend>Model ownership</legend>
          <strong>Code-owned · read-only</strong>
          <code>
            {lifecycle
              ? `${lifecycle.source.format} · IR v${lifecycle.source.irVersion}`
              : 'Unavailable'}
          </code>
        </fieldset>
      </header>

      {loading ? <p className="schema-catalog__state">Loading canonical contracts…</p> : null}
      {error ? (
        <div className="schema-catalog__state schema-catalog__state--error" role="alert">
          <div>
            <strong>Schema inspection is unavailable.</strong>
            <p>{error}</p>
          </div>
          <button className="button button--secondary" type="button" onClick={onRetry}>
            Retry schema catalog
          </button>
        </div>
      ) : null}

      {!error && lifecycle && drift ? (
        <section className="schema-catalog__section" aria-labelledby="schema-lifecycle-heading">
          <div className="schema-catalog__section-heading">
            <div>
              <span className="kicker">Lifecycle</span>
              <h3 id="schema-lifecycle-heading">Source, deployment, and drift</h3>
            </div>
            <span
              className={`schema-catalog__status schema-catalog__status--${drift.inSync ? 'match' : 'drift'}`}
            >
              {drift.inSync ? 'In sync' : 'Review drift'}
            </span>
          </div>
          <dl className="schema-catalog__facts">
            <div>
              <dt>Source fingerprint</dt>
              <dd title={lifecycle.fingerprint}>{fingerprint(lifecycle.fingerprint)}</dd>
            </div>
            <div>
              <dt>Generated types</dt>
              <dd title={lifecycle.generatedTypesFingerprint}>
                {fingerprint(lifecycle.generatedTypesFingerprint)}
              </dd>
            </div>
            <div>
              <dt>Deployment</dt>
              <dd>{lifecycle.deployment ? 'Recorded' : 'Missing'}</dd>
            </div>
            <div>
              <dt>Registered contracts</dt>
              <dd>
                {lifecycle.source.schemas.length} models · {lifecycle.source.components.length}{' '}
                components
              </dd>
            </div>
          </dl>
          <div className="schema-catalog__drift-grid">
            {drift.states.map((state) => (
              <article className="schema-catalog-card" key={state.source}>
                <header className="schema-catalog-card__heading">
                  <strong>{state.source.replace('-', ' ')}</strong>
                  <span
                    className={`schema-catalog__status schema-catalog__status--${state.status}`}
                  >
                    {state.status}
                  </span>
                </header>
                <small>Expected</small>
                <code title={state.expectedFingerprint}>
                  {fingerprint(state.expectedFingerprint)}
                </code>
                <small>Actual</small>
                <code title={state.actualFingerprint}>{fingerprint(state.actualFingerprint)}</code>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!error ? (
        <section className="schema-catalog__section" aria-labelledby="registered-models-heading">
          <div className="schema-catalog__section-heading">
            <div>
              <span className="kicker">Registered types</span>
              <h3 id="registered-models-heading">Fields, routes, and reusable objects</h3>
            </div>
            {schemas.length ? (
              <label className="gs-field schema-catalog__picker">
                <span>Inspect model</span>
                <select
                  data-required-operations="schema.read"
                  value={selectedSchema?.id ?? ''}
                  onChange={(event) => setSelectedSchemaId(event.target.value)}
                >
                  {schemas.map((schema) => (
                    <option key={schema.id} value={schema.id}>
                      {schema.name} · v{schema.version}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {selectedSchema ? (
            <div className="schema-catalog__model-layout">
              <article
                className="schema-catalog-card"
                aria-label={`${selectedSchema.name} model identity`}
              >
                <header className="schema-catalog-card__heading">
                  <div>
                    <strong>{selectedSchema.name}</strong>
                    <span>{selectedSchema.description || 'No code-owned description.'}</span>
                  </div>
                  <code>
                    {selectedSchema.id} · v{selectedSchema.version}
                  </code>
                </header>
                <dl className="schema-catalog__facts">
                  <div>
                    <dt>Collection</dt>
                    <dd>{selectedSchema.collection}</dd>
                  </div>
                  <div>
                    <dt>Title field</dt>
                    <dd>{selectedSchema.titleField}</dd>
                  </div>
                  <div>
                    <dt>Route pattern</dt>
                    <dd>{selectedSchema.route?.pattern ?? 'Not routed'}</dd>
                  </div>
                  <div>
                    <dt>Route slug</dt>
                    <dd>{selectedSchema.route?.slugField ?? 'None'}</dd>
                  </div>
                </dl>
                <div>
                  <strong>Localized fields</strong>
                  <p>{selectedSchema.localization?.localizedFields?.join(', ') || 'None'}</p>
                </div>
                <div>
                  <strong>Reusable objects</strong>
                  <p>
                    {(selectedSchema.objects ?? [])
                      .map((object) => `${object.name} (${object.id})`)
                      .join(', ') || 'None'}
                  </p>
                </div>
              </article>
              <article
                className="schema-catalog-card"
                aria-label={`${selectedSchema.name} field contracts`}
              >
                <header className="schema-catalog-card__heading">
                  <strong>Field contracts</strong>
                  <span>{selectedSchema.fields.length} fields</span>
                </header>
                <ul className="schema-catalog__records">
                  {selectedSchema.fields.map((field) => (
                    <li key={field.id}>
                      <strong>{field.label}</strong>
                      <code>
                        {field.name} · {field.id}
                      </code>
                      <small>{fieldContract(field)}</small>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          ) : (
            <p className="empty-copy">No registered content models are available.</p>
          )}
        </section>
      ) : null}

      {!error ? (
        <section className="schema-catalog__section" aria-labelledby="taxonomy-catalog-heading">
          <div className="schema-catalog__section-heading">
            <div>
              <span className="kicker">Taxonomy contracts</span>
              <h3 id="taxonomy-catalog-heading">Categories, tags, and stable term IDs</h3>
            </div>
            {taxonomies.length ? (
              <label className="gs-field schema-catalog__picker">
                <span>Inspect taxonomy</span>
                <select
                  data-required-operations="search.read"
                  value={selectedTaxonomy?.id ?? ''}
                  onChange={(event) => setSelectedTaxonomyId(event.target.value)}
                >
                  {taxonomies.map((taxonomy) => (
                    <option key={taxonomy.id} value={taxonomy.id}>
                      {taxonomy.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {!canReadTaxonomies ? (
            <p className="schema-catalog__boundary">
              Taxonomy inspection requires existing search read access. No taxonomy request was
              sent.
            </p>
          ) : selectedTaxonomy ? (
            <article
              className="schema-catalog-card"
              aria-label={`${selectedTaxonomy.name} taxonomy`}
            >
              <header className="schema-catalog-card__heading">
                <div>
                  <strong>{selectedTaxonomy.name}</strong>
                  <code>{selectedTaxonomy.id}</code>
                </div>
                <span className="schema-catalog__classification">
                  {selectedTaxonomy.hierarchical ? 'Hierarchical categories' : 'Flat tags'}
                </span>
              </header>
              <TaxonomyTerms taxonomy={selectedTaxonomy} />
            </article>
          ) : (
            <p className="empty-copy">No taxonomy definitions are registered.</p>
          )}
        </section>
      ) : null}

      {!error ? (
        <section className="schema-catalog__section" aria-labelledby="schema-impact-heading">
          <div className="schema-catalog__section-heading">
            <div>
              <span className="kicker">Current-source assessment</span>
              <h3 id="schema-impact-heading">Migration impact</h3>
            </div>
          </div>
          {!canAssessImpact ? (
            <p className="schema-catalog__boundary">
              Impact assessment requires existing schema plan access. This read-only catalog does
              not request or imply deployment authority.
            </p>
          ) : impactLoading ? (
            <p className="schema-catalog__state">
              Assessing current source against scoped content…
            </p>
          ) : impactError ? (
            <p className="schema-catalog__state schema-catalog__state--error" role="alert">
              {impactError}
            </p>
          ) : impact ? (
            <div className="schema-catalog__impact-layout">
              <dl className="schema-catalog__facts">
                <div>
                  <dt>Scanned entries</dt>
                  <dd>{impact.impact.scannedEntries}</dd>
                </div>
                <div>
                  <dt>Affected entries</dt>
                  <dd>{impact.impact.affectedEntries}</dd>
                </div>
                <div>
                  <dt>Invalid entries</dt>
                  <dd>{impact.impact.invalidEntries.length}</dd>
                </div>
                <div>
                  <dt>Lock estimate</dt>
                  <dd>{impact.plan.estimate.lock}</dd>
                </div>
                <div>
                  <dt>Safe changes</dt>
                  <dd>{impact.plan.summary.safe}</dd>
                </div>
                <div>
                  <dt>Backfill changes</dt>
                  <dd>{impact.plan.summary.backfill}</dd>
                </div>
                <div>
                  <dt>Destructive changes</dt>
                  <dd>{impact.plan.summary.destructive}</dd>
                </div>
                <div>
                  <dt>Rollback</dt>
                  <dd>{impact.plan.rollback.mode}</dd>
                </div>
              </dl>
              <article className="schema-catalog-card">
                <strong>Scope impact by content type</strong>
                {Object.keys(impact.impact.byContentType).length ? (
                  <ul className="schema-catalog__records">
                    {Object.entries(impact.impact.byContentType).map(([contentType, count]) => (
                      <li key={contentType}>
                        <code>{contentType}</code>
                        <strong>{count} entries</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No current-source changes affect scoped entries.</p>
                )}
                <small>Plan {impact.plan.id} · assessment only · no activation action</small>
              </article>
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="schema-catalog__boundary">
        Model source, taxonomy terms, generated contracts, and deployment remain
        application/operator owned. Studio provides inspection only.
      </p>
    </section>
  );
}
