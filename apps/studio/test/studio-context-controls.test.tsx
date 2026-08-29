// @vitest-environment jsdom

import type { StudioContext } from '@gridstory/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioContextControls } from '../src/studio-context-controls.js';

const baseScope = {
  organizationId: 'local',
  tenantId: 'default',
  workspaceId: 'default',
  siteId: 'main',
  environmentId: 'development',
  locale: 'en',
};

function context(): StudioContext {
  const choice = (siteId: string, environmentId: string, locale: string) => ({
    scope: { ...baseScope, siteId, environmentId, locale },
    labels: { site: `Site ${siteId}`, environment: environmentId, locale: locale.toUpperCase() },
  });
  return {
    version: 1,
    scope: baseScope,
    principalId: 'editor',
    capabilities: { screens: {} as never, operations: {} as never },
    selection: {
      mode: 'configured',
      choices: [
        choice('main', 'development', 'en'),
        choice('main', 'production', 'en'),
        choice('main', 'production', 'fr'),
        choice('campaign', 'preview', 'de'),
      ],
    },
  };
}

afterEach(cleanup);

describe('Studio context controls', () => {
  it('stages only complete permitted tuples and keeps the committed tuple visible', () => {
    const commit = vi.fn();
    render(<StudioContextControls context={context()} onCommit={commit} />);
    expect(screen.getByTitle('Committed Studio context').textContent).toContain(
      'Site main / development / EN',
    );
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'production' } });
    expect(screen.getByLabelText('Locale')).toHaveProperty('value', 'en');
    fireEvent.change(screen.getByLabelText('Locale'), { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(commit).toHaveBeenCalledWith({
      siteId: 'main',
      environmentId: 'production',
      locale: 'fr',
    });
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'campaign' } });
    expect(screen.getByLabelText('Environment')).toHaveProperty('value', 'preview');
    expect(screen.getByLabelText('Locale')).toHaveProperty('value', 'de');
  });

  it('renders a factual read-only current-context state without offering a switch', () => {
    const current = context();
    current.selection = { mode: 'current-only', choices: [] };
    render(<StudioContextControls context={current} onCommit={vi.fn()} />);
    expect(screen.getByText('Additional contexts are not configured.')).toBeTruthy();
    expect(screen.getByLabelText('Site')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
  });

  it('locks staging and preserves the committed label while a switch is pending', () => {
    render(<StudioContextControls context={context()} transitioning onCommit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Switching…' })).toHaveProperty('disabled', true);
    expect(screen.getByTitle('Committed Studio context').textContent).toContain('development');
    expect(screen.getByLabelText('Locale')).toHaveProperty('disabled', true);
  });
});
