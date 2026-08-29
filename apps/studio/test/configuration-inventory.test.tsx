// @vitest-environment jsdom

import type { ConfigurationInventory } from '@gridstory/client';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationInventoryView } from '../src/configuration-inventory.js';

const readOnlyOperator = { ownership: 'operator' as const, mutable: false as const };
const inventory: ConfigurationInventory = {
  version: 1,
  scope: {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
  },
  sections: {
    localesAndEnvironments: {
      availability: 'available',
      ...readOnlyOperator,
      coverage: 'current-only',
      current: {
        site: { ...readOnlyOperator, id: 'default', label: 'Default site' },
        environment: {
          ...readOnlyOperator,
          id: 'development',
          label: 'Development',
          kind: 'not-declared',
        },
        locale: {
          ...readOnlyOperator,
          code: 'en',
          label: 'English',
          default: true,
          required: true,
          routePrefix: '',
          fallbackLocales: [],
        },
      },
      environments: [
        {
          ...readOnlyOperator,
          id: 'development',
          label: 'Development',
          kind: 'not-declared',
        },
      ],
      locales: [
        {
          ...readOnlyOperator,
          code: 'en',
          label: 'English',
          default: true,
          required: true,
          routePrefix: '',
          fallbackLocales: [],
        },
      ],
    },
    modelsAndRoutes: {
      availability: 'available',
      ownership: 'code',
      mutable: false,
      models: [
        {
          ownership: 'code',
          mutable: false,
          id: 'page',
          name: 'Page',
          version: 1,
          collection: 'pages',
          route: { pattern: '/:slug', slugField: 'slug' },
          localizedFields: ['title', 'slug'],
        },
      ],
    },
    mediaPolicyAndProviders: {
      availability: 'available',
      ownership: 'code',
      mutable: false,
      policy: {
        ownership: 'code',
        mutable: false,
        supportedKinds: ['image', 'video', 'file'],
        maximumUploadBytes: 100_000_000,
        uploadPartBytes: 5_242_880,
        maximumDimensionPixels: 16_384,
        maximumParts: 1_000,
        deliveryRequiresVerified: true,
        renditionsRequireVerified: true,
      },
      providers: [
        { ...readOnlyOperator, kind: 'storage', mode: 'built-in-local' },
        { ...readOnlyOperator, kind: 'content-inspection', mode: 'built-in' },
        { ...readOnlyOperator, kind: 'rendition', mode: 'unavailable' },
        { ...readOnlyOperator, kind: 'malware-scanning', mode: 'unavailable' },
      ],
    },
  },
};

afterEach(cleanup);

describe('Configuration inventory', () => {
  it('renders truthful ownership, bounds and optional authorized destinations without editors', () => {
    const navigate = vi.fn();
    render(
      <ConfigurationInventoryView
        inventory={inventory}
        loading={false}
        error={null}
        canNavigate={(destination) => destination === 'schemas' || destination === 'assets'}
        onNavigate={navigate}
        onRetry={vi.fn()}
      />,
    );
    const view = screen.getByRole('region', { name: 'Configuration inventory' });
    expect(within(view).getByText(/Current-only coverage/)).toBeTruthy();
    expect(within(view).getByText('not declared')).toBeTruthy();
    expect(within(view).getByText('/:slug')).toBeTruthy();
    expect(within(view).getByText('100,000,000 bytes')).toBeTruthy();
    expect(within(view).getAllByText('Operator-owned · read-only').length).toBeGreaterThan(1);
    expect(within(view).queryByRole('textbox')).toBeNull();
    expect(view.querySelector('input, select, textarea')).toBeNull();
    expect(within(view).queryByRole('button', { name: /save|edit|deploy|configure/i })).toBeNull();
    fireEvent.click(within(view).getByRole('button', { name: 'Inspect schemas & taxonomies' }));
    fireEvent.click(within(view).getByRole('button', { name: 'Open Media library' }));
    expect(navigate).toHaveBeenNthCalledWith(1, 'schemas');
    expect(navigate).toHaveBeenNthCalledWith(2, 'assets');
  });

  it('isolates denied sections and retryable load errors', () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const denied: ConfigurationInventory = {
      ...inventory,
      sections: {
        localesAndEnvironments: { availability: 'unavailable', reason: 'not-authorized' },
        modelsAndRoutes: inventory.sections.modelsAndRoutes,
        mediaPolicyAndProviders: { availability: 'unavailable', reason: 'not-authorized' },
      },
    };
    const { rerender } = render(
      <ConfigurationInventoryView
        inventory={denied}
        loading={false}
        error={null}
        canNavigate={() => false}
        onNavigate={vi.fn()}
        onRetry={retry}
      />,
    );
    expect(screen.getAllByText('Unavailable with current access')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /schemas|media/i })).toBeNull();

    rerender(
      <ConfigurationInventoryView
        inventory={null}
        loading={false}
        error="Safe inventory request failed."
        canNavigate={() => false}
        onNavigate={vi.fn()}
        onRetry={retry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry configuration' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
