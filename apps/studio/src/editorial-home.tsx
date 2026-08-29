import type { EditorialOverview } from '@gridstory/client';
import type { ContentSchemaDefinition } from '@gridstory/schema';
import type { ReactNode } from 'react';
import type { StudioDestination } from './navigation.js';

type EntryLink = {
  id: string;
  contentType: string;
  destination: 'pages' | 'collections';
};

type EditorialHomeProps = {
  overview: EditorialOverview | null;
  loading: boolean;
  error: boolean;
  schemas: ContentSchemaDefinition[];
  busy: boolean;
  canCreate: (contentType: string) => boolean;
  canOpenEntry: (contentType: string) => boolean;
  canNavigate: (destination: StudioDestination) => boolean;
  onCreate: (schema: ContentSchemaDefinition) => void;
  onOpenEntry: (entry: EntryLink) => void;
  onNavigate: (destination: StudioDestination) => void;
  onRetry: () => void;
};

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): ReactNode {
  const headingId = `editorial-home-${title.toLocaleLowerCase().replaceAll(' ', '-')}`;
  return (
    <article className="editorial-home-card" aria-labelledby={headingId}>
      <div className="editorial-home-card__header">
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="editorial-home-card__body">{children}</div>
    </article>
  );
}

function CardState({
  loading,
  endpointError,
  unavailable,
  sourceError,
  label,
  onRetry,
}: {
  loading: boolean;
  endpointError: boolean;
  unavailable: boolean;
  sourceError: boolean;
  label: string;
  onRetry: () => void;
}): ReactNode {
  if (loading)
    return (
      <p className="editorial-home-card__state" role="status">
        Loading {label}…
      </p>
    );
  if (unavailable)
    return (
      <p className="editorial-home-card__state">
        This information is unavailable with your current access.
      </p>
    );
  if (endpointError || sourceError)
    return (
      <div className="editorial-home-card__state" role="alert">
        <p>{label[0]?.toUpperCase() + label.slice(1)} could not be loaded.</p>
        <button
          type="button"
          className="button button--secondary button--compact"
          onClick={onRetry}
        >
          Retry {label}
        </button>
      </div>
    );
  return null;
}

function Bounds({
  totalCount,
  displayedCount,
  coverage,
}: {
  totalCount: number;
  displayedCount: number;
  coverage?: 'all-registered' | 'pages-only';
}): ReactNode {
  return (
    <p className="editorial-home-card__bounds">
      Showing {displayedCount} of {totalCount} exact {coverage === 'pages-only' ? 'page' : 'scoped'}{' '}
      {totalCount === 1 ? 'item' : 'items'}.
    </p>
  );
}

export function EditorialHome({
  overview,
  loading,
  error,
  schemas,
  busy,
  canCreate,
  canOpenEntry,
  canNavigate,
  onCreate,
  onOpenEntry,
  onNavigate,
  onRetry,
}: EditorialHomeProps): ReactNode {
  const creatableSchemas = schemas.filter((schema) => canCreate(schema.id));
  const content = overview?.widgets.content;
  const reviews = overview?.widgets.reviews;
  const releases = overview?.widgets.releases;
  const operations = overview?.widgets.operations;
  const waiting = loading || (!overview && !error);

  return (
    <section className="editorial-home" aria-label="Editorial Home" aria-busy={waiting}>
      <div className="section-heading editorial-home__heading">
        <div>
          <span className="kicker">Editorial workspace</span>
          <h1>Home</h1>
          <p>Resume scoped work from current content, workflow, release, and operations records.</p>
        </div>
        {overview ? (
          <p className="editorial-home__generated">
            Updated{' '}
            <time dateTime={overview.generatedAt}>{formatTimestamp(overview.generatedAt)}</time>
          </p>
        ) : null}
      </div>

      {creatableSchemas.length > 0 ? (
        <section className="editorial-home__quick-create" aria-labelledby="home-quick-create">
          <div>
            <h2 id="home-quick-create">Quick create</h2>
            <p>Start a canonical draft from a registered content type.</p>
          </div>
          <div className="editorial-home__quick-actions">
            {creatableSchemas.map((schema) => (
              <button
                key={schema.id}
                type="button"
                className="button button--primary button--compact"
                disabled={busy}
                onClick={() => onCreate(schema)}
              >
                Create {schema.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="editorial-home__grid">
        <Card
          title="Content"
          description="Exact states and the five most recently updated entries."
        >
          <CardState
            loading={waiting}
            endpointError={error}
            unavailable={content?.availability === 'unavailable'}
            sourceError={content?.availability === 'error'}
            label="content summary"
            onRetry={onRetry}
          />
          {content?.availability === 'available' ? (
            <>
              <dl className="editorial-home__metrics">
                <div>
                  <dt>Draft</dt>
                  <dd>{content.states.draft}</dd>
                </div>
                <div>
                  <dt>Changed</dt>
                  <dd>{content.states.changed}</dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>{content.states.published}</dd>
                </div>
              </dl>
              <Bounds
                totalCount={content.bounds.totalCount}
                displayedCount={content.bounds.displayedCount}
                coverage={content.coverage}
              />
              {content.recent.length > 0 ? (
                <ol className="editorial-home-list">
                  {content.recent.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="editorial-home-list__link"
                        disabled={!canOpenEntry(entry.contentType)}
                        onClick={() => onOpenEntry(entry)}
                      >
                        <span>
                          <strong>{entry.title}</strong>
                          <small>{entry.contentType}</small>
                        </span>
                        <span>
                          <span
                            className={`editorial-home__status editorial-home__status--${entry.status}`}
                          >
                            {entry.status}
                          </span>
                          <time dateTime={entry.updatedAt}>{formatTimestamp(entry.updatedAt)}</time>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="editorial-home-card__empty">No content exists in this coverage.</p>
              )}
            </>
          ) : null}
        </Card>

        <Card title="Reviews" description="Pending approvals you are currently eligible to decide.">
          <CardState
            loading={waiting}
            endpointError={error}
            unavailable={reviews?.availability === 'unavailable'}
            sourceError={reviews?.availability === 'error'}
            label="review queue"
            onRetry={onRetry}
          />
          {reviews?.availability === 'available' ? (
            <>
              <Bounds
                totalCount={reviews.bounds.totalCount}
                displayedCount={reviews.bounds.displayedCount}
                coverage={reviews.coverage}
              />
              {reviews.items.length > 0 ? (
                <ol className="editorial-home-list">
                  {reviews.items.map((review) => (
                    <li key={`${review.entryId}:${review.transitionLabel}`}>
                      <button
                        type="button"
                        className="editorial-home-list__link"
                        disabled={!canOpenEntry(review.contentType)}
                        onClick={() =>
                          onOpenEntry({
                            id: review.entryId,
                            contentType: review.contentType,
                            destination: review.destination,
                          })
                        }
                      >
                        <span>
                          <strong>{review.title}</strong>
                          <small>
                            {review.workflowName} · {review.transitionLabel}
                          </small>
                        </span>
                        <span>
                          <small>{review.stateLabel}</small>
                          <time dateTime={review.dueAt ?? review.requestedAt}>
                            {review.dueAt
                              ? `Due ${formatTimestamp(review.dueAt)}`
                              : formatTimestamp(review.requestedAt)}
                          </time>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="editorial-home-card__empty">No eligible approvals are pending.</p>
              )}
            </>
          ) : null}
        </Card>

        <Card title="Releases" description="Current scoped release records, newest first.">
          <CardState
            loading={waiting}
            endpointError={error}
            unavailable={releases?.availability === 'unavailable'}
            sourceError={releases?.availability === 'error'}
            label="release summary"
            onRetry={onRetry}
          />
          {releases?.availability === 'available' ? (
            <>
              <Bounds
                totalCount={releases.bounds.totalCount}
                displayedCount={releases.bounds.displayedCount}
              />
              {releases.items.length > 0 ? (
                <ol className="editorial-home-list">
                  {releases.items.map((release) => (
                    <li key={release.id}>
                      <button
                        type="button"
                        className="editorial-home-list__link"
                        disabled={!canNavigate('releases')}
                        onClick={() => onNavigate(release.destination)}
                        aria-label={`Open ${release.name} in Releases`}
                      >
                        <span>
                          <strong>{release.name}</strong>
                          <small>{release.state}</small>
                        </span>
                        <time dateTime={release.runAt ?? release.updatedAt}>
                          {release.runAt
                            ? `Scheduled ${formatTimestamp(release.runAt)}`
                            : formatTimestamp(release.updatedAt)}
                        </time>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="editorial-home-card__empty">No releases exist in this scope.</p>
              )}
            </>
          ) : null}
        </Card>

        <Card
          title="Operator attention"
          description="Minimized delivery and audit health for operators."
        >
          <CardState
            loading={waiting}
            endpointError={error}
            unavailable={operations?.availability === 'unavailable'}
            sourceError={operations?.availability === 'error'}
            label="operator attention"
            onRetry={onRetry}
          />
          {operations?.availability === 'available' ? (
            <>
              <dl className="editorial-home__metrics">
                <div>
                  <dt>Audit chain</dt>
                  <dd>{operations.auditValid ? 'Valid' : 'Invalid'}</dd>
                </div>
                <div>
                  <dt>Dead outbox</dt>
                  <dd>
                    {operations.deadOutbox}
                    {operations.outboxTruncated ? '+' : ''}
                  </dd>
                </div>
                <div>
                  <dt>Dead jobs</dt>
                  <dd>
                    {operations.deadJobs}
                    {operations.jobsTruncated ? '+' : ''}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="button button--secondary button--compact"
                disabled={!canNavigate('operations')}
                onClick={() => onNavigate(operations.destination)}
              >
                Open Operations
              </button>
            </>
          ) : null}
        </Card>
      </div>
    </section>
  );
}
