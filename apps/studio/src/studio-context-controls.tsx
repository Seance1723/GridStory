import type { StudioContext, StudioScopeChoice, StudioScopeSelection } from '@gridstory/schema';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

function scopeKey(scope: StudioScopeChoice['scope']): string {
  return JSON.stringify(scope);
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function StudioContextControls({
  context,
  disabled = false,
  transitioning = false,
  onCommit,
}: {
  context: StudioContext;
  disabled?: boolean;
  transitioning?: boolean;
  onCommit: (selection: StudioScopeSelection) => void | Promise<void>;
}): ReactNode {
  const choices = context.selection.choices;
  const committedKey = scopeKey(context.scope);
  const [stagedKey, setStagedKey] = useState(committedKey);
  useEffect(() => setStagedKey(committedKey), [committedKey]);

  const committed =
    choices.find(({ scope }) => scopeKey(scope) === committedKey) ??
    ({
      scope: context.scope,
      labels: {
        site: context.scope.siteId,
        environment: context.scope.environmentId,
        locale: context.scope.locale,
      },
    } satisfies StudioScopeChoice);
  const staged = choices.find(({ scope }) => scopeKey(scope) === stagedKey) ?? committed;
  const sites = useMemo(() => uniqueBy(choices, ({ scope }) => scope.siteId), [choices]);
  const environments = useMemo(
    () =>
      uniqueBy(
        choices.filter(({ scope }) => scope.siteId === staged.scope.siteId),
        ({ scope }) => scope.environmentId,
      ),
    [choices, staged.scope.siteId],
  );
  const locales = useMemo(
    () =>
      choices.filter(
        ({ scope }) =>
          scope.siteId === staged.scope.siteId &&
          scope.environmentId === staged.scope.environmentId,
      ),
    [choices, staged.scope.environmentId, staged.scope.siteId],
  );
  const selectable = context.selection.mode === 'configured' && choices.length > 1;
  const controlsDisabled = disabled || transitioning || !selectable;

  const stageFirst = (candidates: StudioScopeChoice[]) => {
    const next = candidates[0];
    if (next) setStagedKey(scopeKey(next.scope));
  };

  return (
    <fieldset className="studio-context-controls">
      <legend>Studio context</legend>
      <div className="studio-context-controls__layout">
        <span className="studio-context-controls__current" title="Committed Studio context">
          <span>Current</span>
          <strong>
            {committed.labels.site} / {committed.labels.environment} / {committed.labels.locale}
          </strong>
        </span>
        <div className="studio-context-controls__fields">
          <label>
            <span>Site</span>
            <select
              aria-label="Site"
              value={staged.scope.siteId}
              disabled={controlsDisabled}
              onChange={(event) =>
                stageFirst(choices.filter(({ scope }) => scope.siteId === event.target.value))
              }
            >
              {sites.map((choice) => (
                <option key={choice.scope.siteId} value={choice.scope.siteId}>
                  {choice.labels.site}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Environment</span>
            <select
              aria-label="Environment"
              value={staged.scope.environmentId}
              disabled={controlsDisabled}
              onChange={(event) =>
                stageFirst(
                  choices.filter(
                    ({ scope }) =>
                      scope.siteId === staged.scope.siteId &&
                      scope.environmentId === event.target.value,
                  ),
                )
              }
            >
              {environments.map((choice) => (
                <option key={choice.scope.environmentId} value={choice.scope.environmentId}>
                  {choice.labels.environment}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Locale</span>
            <select
              aria-label="Locale"
              value={staged.scope.locale}
              disabled={controlsDisabled}
              onChange={(event) =>
                stageFirst(locales.filter(({ scope }) => scope.locale === event.target.value))
              }
            >
              {locales.map((choice) => (
                <option key={choice.scope.locale} value={choice.scope.locale}>
                  {choice.labels.locale}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button--secondary button--compact studio-context-controls__apply"
            disabled={controlsDisabled || stagedKey === committedKey}
            onClick={() =>
              void onCommit({
                siteId: staged.scope.siteId,
                environmentId: staged.scope.environmentId,
                locale: staged.scope.locale,
              })
            }
          >
            {transitioning ? 'Switching…' : 'Apply'}
          </button>
        </div>
        {!selectable ? (
          <span className="studio-context-controls__notice">
            Additional contexts are not configured.
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}
