// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridStoryClient } from '@gridstory/client';
import type { ContentEntry, ContentSchemaDefinition } from '@gridstory/schema';
import { NavigationMenus } from '../src/navigation-menus.js';

const scope = {
  organizationId: 'local',
  tenantId: 'default',
  workspaceId: 'default',
  siteId: 'default',
  environmentId: 'development',
  locale: 'en',
};
const schemas: ContentSchemaDefinition[] = [
  {
    id: 'navigation-menu',
    version: 1,
    name: 'Navigation menu',
    description: '',
    collection: 'navigation-menus',
    titleField: 'name',
    fields: [],
  },
  {
    id: 'page',
    version: 1,
    name: 'Page',
    description: '',
    collection: 'pages',
    titleField: 'title',
    route: { pattern: '/:slug', slugField: 'slug' },
    fields: [],
  },
];
const page: ContentEntry = {
  ...scope,
  id: 'page-1',
  contentType: 'page',
  status: 'published',
  draftRevisionId: 'page-revision-1',
  publishedRevisionId: 'page-revision-1',
  data: { title: 'Home page', slug: 'home' },
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
};

function menuEntry(data = { key: 'header', name: 'Header navigation', items: [] }): ContentEntry {
  return {
    ...scope,
    id: 'navigation-menu:header',
    contentType: 'navigation-menu',
    status: 'draft',
    draftRevisionId: 'menu-revision-1',
    data,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
  };
}

describe('NavigationMenus', () => {
  afterEach(() => cleanup());

  it('loads lazily, saves typed links, previews resolved routes and publishes through existing calls', async () => {
    const user = userEvent.setup();
    let menu = menuEntry();
    const listContent = vi.fn(async ({ contentType }: { contentType?: string }) =>
      contentType === 'navigation-menu' ? [menu] : [page],
    );
    const saveDraft = vi.fn(
      async (_id: string, _revision: string, data: Record<string, unknown>) => {
        menu = { ...menu, draftRevisionId: 'menu-revision-2', data };
        return menu;
      },
    );
    const publish = vi.fn(async () => ({
      ...menu,
      status: 'published' as const,
      publishedRevisionId: menu.draftRevisionId,
    }));
    const client = {
      listContent,
      listRevisions: vi.fn(async () => []),
      getContentWorkflow: vi.fn(async () => ({
        ...scope,
        entryId: menu.id,
        contentType: 'navigation-menu',
        workflowId: 'navigation-menu-editorial',
        workflowVersion: 1,
        stateId: 'approved',
        revisionId: menu.draftRevisionId,
        schedules: [],
        notifications: [],
        history: [],
        createdAt: '2026-08-31T00:00:00.000Z',
        updatedAt: '2026-08-31T00:00:00.000Z',
      })),
      listWorkflows: vi.fn(async () => [
        {
          ...scope,
          id: 'navigation-menu-editorial',
          name: 'Navigation editorial review',
          contentType: 'navigation-menu',
          version: 1,
          initialStateId: 'draft',
          states: [
            { id: 'draft', label: 'Draft', kind: 'draft' },
            { id: 'approved', label: 'Approved', kind: 'approved' },
            { id: 'published', label: 'Published', kind: 'published' },
          ],
          transitions: [
            {
              id: 'publish',
              label: 'Publish',
              from: 'approved',
              to: 'published',
              allowedRoles: ['admin'],
            },
          ],
          createdAt: '2026-08-31T00:00:00.000Z',
          updatedAt: '2026-08-31T00:00:00.000Z',
        },
      ]),
      getTranslationCompleteness: vi.fn(async () => ({
        translationGroupId: menu.id,
        sourceEntryId: menu.id,
        contentType: 'navigation-menu',
        localizedFields: ['items'],
        requiredLocales: ['en'],
        translatedFields: 1,
        totalFields: 1,
        percentage: 100,
        publicationComplete: false,
        locales: [],
      })),
      saveDraft,
      getNavigationMenuDraft: vi.fn(async () => ({
        schemaVersion: 1,
        scope,
        entryId: menu.id,
        key: 'header',
        name: 'Updated header',
        requestedLocale: 'en',
        resolvedLocale: 'en',
        perspective: 'draft',
        revisionId: menu.draftRevisionId,
        items: [
          {
            id: 'item-1',
            label: 'New link',
            kind: 'internal',
            target: { id: page.id, contentType: page.contentType },
            href: '/home',
          },
        ],
      })),
      publish,
      createNavigationMenu: vi.fn(),
      requestWorkflowTransition: vi.fn(),
      decideWorkflowApproval: vi.fn(),
      createTranslation: vi.fn(),
    } as unknown as GridStoryClient;
    const onDirtyChange = vi.fn();

    render(
      <NavigationMenus
        client={client}
        schemas={schemas}
        can={() => true}
        onDirtyChange={onDirtyChange}
        onNotice={vi.fn()}
      />,
    );

    await screen.findByRole('heading', { name: 'Header navigation' });
    expect(await screen.findByText('Approved', { selector: '.workflow-state' })).toBeTruthy();
    await waitFor(() => expect(listContent).toHaveBeenCalledTimes(2));
    expect(listContent).toHaveBeenCalledWith({ contentType: 'navigation-menu' });
    await user.clear(screen.getByLabelText('Menu name'));
    await user.type(screen.getByLabelText('Menu name'), 'Updated header');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.selectOptions(screen.getByLabelText('Link kind'), 'internal');
    await user.selectOptions(screen.getByLabelText('Content target'), 'page:page-1');
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(saveDraft.mock.calls[0]?.[2]).toMatchObject({
      name: 'Updated header',
      items: [
        {
          id: 'item-1',
          kind: 'internal',
          target: { id: page.id, contentType: 'page' },
        },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Preview resolved links' }));
    expect((await screen.findByRole('link', { name: 'New link' })).getAttribute('href')).toBe(
      '/home',
    );
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publish).toHaveBeenCalledWith(menu.id, 'menu-revision-2'));
  });
});
