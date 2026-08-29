// @vitest-environment jsdom

import type { EditorialOverview } from '@gridstory/client';
import type { ContentSchemaDefinition } from '@gridstory/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorialHome } from '../src/editorial-home.js';

const pageSchema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  collection: 'pages',
  titleField: 'title',
  fields: [{ id: 'page.title', name: 'title', label: 'Title', type: 'text', required: true }],
};

const overview: EditorialOverview = {
  version: 1,
  scope: {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
  },
  generatedAt: '2026-08-29T00:00:00.000Z',
  widgets: {
    content: {
      availability: 'available',
      coverage: 'all-registered',
      exact: true,
      bounds: { totalCount: 6, displayedCount: 1, limit: 5, hasMore: true },
      states: { draft: 2, changed: 1, published: 3 },
      recent: [
        {
          id: 'entry-1',
          contentType: 'page',
          title: 'Current campaign',
          status: 'changed',
          updatedAt: '2026-08-29T00:00:00.000Z',
          destination: 'pages',
        },
      ],
    },
    reviews: {
      availability: 'available',
      coverage: 'all-registered',
      exact: true,
      bounds: { totalCount: 0, displayedCount: 0, limit: 5, hasMore: false },
      items: [],
    },
    releases: { availability: 'error', reason: 'source-unavailable' },
    operations: { availability: 'unavailable' },
  },
};

afterEach(cleanup);

describe('Editorial Home', () => {
  it('states exact bounded coverage and keeps card recovery and unavailable states independent', () => {
    const retry = vi.fn();
    const openEntry = vi.fn();
    const create = vi.fn();
    render(
      <EditorialHome
        overview={overview}
        loading={false}
        error={false}
        schemas={[pageSchema]}
        busy={false}
        canCreate={() => true}
        canOpenEntry={() => true}
        canNavigate={() => true}
        onCreate={create}
        onOpenEntry={openEntry}
        onNavigate={vi.fn()}
        onRetry={retry}
      />,
    );

    expect(screen.getByText('Showing 1 of 6 exact scoped items.')).toBeTruthy();
    expect(screen.getByText('No eligible approvals are pending.')).toBeTruthy();
    expect(
      screen.getByText('This information is unavailable with your current access.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry release summary' }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Current campaign/ }));
    expect(openEntry).toHaveBeenCalledWith(
      overview.widgets.content.availability === 'available'
        ? overview.widgets.content.recent[0]
        : undefined,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Page' }));
    expect(create).toHaveBeenCalledWith(pageSchema);
  });

  it('renders a loading state in every card before the private overview settles', () => {
    render(
      <EditorialHome
        overview={null}
        loading
        error={false}
        schemas={[]}
        busy={false}
        canCreate={() => false}
        canOpenEntry={() => false}
        canNavigate={() => false}
        onCreate={vi.fn()}
        onOpenEntry={vi.fn()}
        onNavigate={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('status')).toHaveLength(4);
  });
});
