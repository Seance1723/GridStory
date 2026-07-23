// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGridStoryClient, type ContentEntry } from '@gridstory/client';
import { componentManifests } from '@gridstory/example-kit/manifests';
import { exampleDesignSystem } from '@gridstory/example-kit/design-system';
import type { ContentSchemaDefinition } from '@gridstory/schema';
import { App } from '../src/App.js';

const schema: ContentSchemaDefinition = {
  id: 'page',
  version: 1,
  name: 'Page',
  collection: 'pages',
  titleField: 'headline',
  fields: [
    {
      id: 'page.headline',
      name: 'headline',
      label: 'Headline',
      type: 'text',
      required: true,
    },
    {
      id: 'page.path',
      name: 'path',
      label: 'Path',
      type: 'slug',
      required: true,
    },
    {
      id: 'page.sections',
      name: 'sections',
      label: 'Sections',
      type: 'component-tree',
      required: true,
      minimum: 1,
    },
  ],
};

const now = '2026-07-17T00:00:00.000Z';

function entry(id: string, headline: string, path: string): ContentEntry {
  return {
    id,
    tenantId: 'default',
    contentType: 'page',
    status: 'draft',
    draftRevisionId: `${id}-revision-1`,
    createdAt: now,
    updatedAt: now,
    data: {
      headline,
      path,
      sections: [
        {
          id: `${id}-hero-a`,
          component: 'gridstory.hero',
          version: 1,
          props: { eyebrow: 'One', heading: 'First hero', body: 'Body', tone: 'indigo' },
        },
        {
          id: `${id}-hero-b`,
          component: 'gridstory.hero',
          version: 1,
          props: { eyebrow: 'Two', heading: 'Second hero', body: 'Body', tone: 'forest' },
        },
      ],
    },
  };
}

const entries = [entry('one', 'First page', 'first'), entry('two', 'Second page', 'second')];
const componentTreeField = schema.fields.find((field) => field.type === 'component-tree');
if (!componentTreeField) throw new Error('Test schema must include a component tree.');

const authoringSchema: ContentSchemaDefinition = {
  ...schema,
  fields: [
    ...schema.fields.slice(0, 2),
    {
      id: 'page.story',
      name: 'story',
      label: 'Editorial story',
      type: 'rich-text',
      allowedBlocks: ['paragraph', 'heading', 'list', 'quote', 'code', 'table'],
    },
    {
      id: 'page.social-image',
      name: 'socialImage',
      label: 'Social image',
      type: 'asset',
      accepts: ['image'],
      requiredAlt: true,
    },
    {
      id: 'page.related-pages',
      name: 'relatedPages',
      label: 'Related pages',
      type: 'relation',
      targets: ['page'],
      multiple: true,
      maximum: 2,
    },
    componentTreeField,
  ],
};

const authoringEntries = entries.map((candidate) => ({
  ...candidate,
  data: {
    ...candidate.data,
    story: { version: 1, blocks: [] },
    relatedPages: [],
  },
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createTestClient(
  options: { schema?: ContentSchemaDefinition; entries?: ContentEntry[] } = {},
) {
  const testSchema = options.schema ?? schema;
  const testEntries = options.entries ?? entries;
  const threads: Array<Record<string, unknown>> = [];
  const presence = [{ actorId: 'local-admin', displayName: 'Studio editor', lastSeenAt: now }];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/schemas') return json([testSchema]);
    if (url.pathname === '/api/v1/components') return json(componentManifests);
    if (url.pathname === '/api/v1/design-system') return json(exampleDesignSystem);
    if (url.pathname.startsWith('/api/v1/preview/sessions')) {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json(
        {
          token: 'gsp_test-token',
          sessionId: 'preview-session-1',
          previewUrl: 'http://localhost:5174/',
          origin: 'http://localhost:5174',
          protocolVersion: 1,
          expiresAt: '2026-07-23T12:00:00.000Z',
        },
        201,
      );
    }
    if (url.pathname === '/api/v1/content') return json(testEntries);
    if (url.pathname === '/api/v1/operations/summary') {
      return json({
        generatedAt: now,
        content: { total: 2, draft: 2, changed: 0, published: 0 },
        outbox: {
          total: 1,
          pending: 1,
          processing: 0,
          succeeded: 0,
          dead: 0,
          truncated: false,
        },
        jobs: {
          total: 1,
          pending: 0,
          processing: 0,
          succeeded: 0,
          dead: 1,
          truncated: false,
        },
        webhooks: { total: 1, active: 1 },
        audit: { valid: true, eventCount: 4, entryCount: 2, failures: [] },
        recentAudit: [],
      });
    }
    const collaborationMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/collaboration$/);
    if (collaborationMatch) return json({ threads, presence });
    const presenceMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/presence$/);
    if (presenceMatch) {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json(presence);
    }
    const commentMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/comments$/);
    if (commentMatch && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        target?: { field?: string; nodeId?: string };
        body: string;
        assigneeId?: string;
        dueAt?: string;
      };
      const thread = {
        id: `thread-${threads.length + 1}`,
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        target: { entryId: commentMatch[1], ...body.target },
        messages: [
          {
            id: 'message-1',
            actorId: 'local-admin',
            body: body.body,
            mentions: [...body.body.matchAll(/@([a-z0-9_-]+)/gi)].map((match) => match[1]),
            createdAt: now,
          },
        ],
        ...(body.assigneeId ? { assigneeId: body.assigneeId } : {}),
        ...(body.dueAt ? { dueAt: body.dueAt } : {}),
        createdAt: now,
        updatedAt: now,
      };
      threads.push(thread);
      return json(thread, 201);
    }
    const commentActionMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/comments\/([^/]+)(?:\/replies)?$/,
    );
    if (commentActionMatch) {
      const thread = threads.find((candidate) => candidate.id === commentActionMatch[2]);
      return thread ? json(thread) : json({ error: { message: 'Not found.' } }, 404);
    }
    const revisionMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/revisions$/);
    if (revisionMatch) return json([]);
    const contentMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)$/);
    if (contentMatch) {
      const selected = testEntries.find((candidate) => candidate.id === contentMatch[1]);
      if (url.searchParams.get('perspective') === 'published') {
        return json({ error: { code: 'not_found', message: 'Not published.' } }, 404);
      }
      return selected ? json(selected) : json({ error: { message: 'Not found.' } }, 404);
    }
    return json({ error: { message: `Unhandled test request: ${url.pathname}` } }, 500);
  });

  return createGridStoryClient({
    baseUrl: 'http://gridstory.test',
    tenantId: 'default',
    fetch: fetchMock as unknown as typeof fetch,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GridStory Studio', () => {
  it('derives content controls and composition storage from the active schema', async () => {
    render(<App client={createTestClient()} />);

    expect(((await screen.findByLabelText('Headline')) as HTMLInputElement).value).toBe(
      'First page',
    );
    expect((screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement).value).toBe('first');
    expect(screen.getByRole('heading', { name: 'Sections' })).toBeTruthy();

    const headings = screen.getAllByLabelText('Heading');
    expect(headings).toHaveLength(2);
    expect(headings[0]?.id).not.toBe(headings[1]?.id);
  });

  it('keeps dirty edits when entry navigation is cancelled', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App client={createTestClient()} />);

    const headline = await screen.findByLabelText('Headline');
    await user.clear(headline);
    await user.type(headline, 'Edited first page');
    await user.click(screen.getByRole('button', { name: /Second page/ }));

    expect(confirm).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('Edited first page');
  });

  it('shows the scoped administrator integrity and operations summary on demand', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Operations' }));

    const panel = await screen.findByRole('region', { name: 'Administrator operations' });
    expect(panel.textContent).toContain('Audit chain verified');
    expect(panel.textContent).toContain('Pending events');
    expect(panel.textContent).toContain('Dead jobs');
  });

  it('starts and revokes a secure application iframe preview', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'App iframe' }));
    const frame = await screen.findByTitle('Application draft preview');
    expect(frame.getAttribute('src')).toBe('http://localhost:5174/');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(screen.getByText(/iframe .*connecting/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close app preview' }));
    expect(screen.queryByTitle('Application draft preview')).toBeNull();
  });

  it('opens standalone preview before awaiting the scoped session grant', async () => {
    const user = userEvent.setup();
    const replace = vi.fn();
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace },
      postMessage: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Standalone' }));
    expect(open).toHaveBeenCalledWith(
      'about:blank',
      'gridstory-standalone-preview',
      'popup,width=1280,height=900',
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('http://localhost:5174/'));
    expect(screen.getByText(/standalone .*connecting/)).toBeTruthy();
  });
  it('edits nested compositions through layers, slots, keyboard movement, and history', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    const secondHeroLayer = screen.getByRole('button', { name: /Hero.*one-hero-b/ });
    await user.click(secondHeroLayer);
    await user.keyboard('{ArrowUp}');
    expect(
      screen
        .getAllByLabelText('Heading')
        .slice(0, 2)
        .map((control) => (control as HTMLInputElement).value),
    ).toEqual(['Second hero', 'First hero']);

    await user.click(screen.getByRole('button', { name: 'Undo composition change' }));
    expect(
      screen
        .getAllByLabelText('Heading')
        .slice(0, 2)
        .map((control) => (control as HTMLInputElement).value),
    ).toEqual(['First hero', 'Second hero']);

    await user.click(screen.getByRole('button', { name: '+ Stack' }));
    const stackInspector = screen.getByRole('region', {
      name: 'Selected component inspector',
    });
    expect(within(stackInspector).getByRole('heading', { name: 'Stack' })).toBeTruthy();

    fireEvent.dragStart(screen.getByRole('button', { name: /Hero.*one-hero-b/ }));
    fireEvent.drop(within(stackInspector).getByText('Drop a layer into Content · keyboard help'));
    expect(screen.getByRole('button', { name: /Hero.*content.*one-hero-b/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Undo composition change' }));
    expect(screen.getByRole('button', { name: /Hero.*one-hero-b/ }).textContent).not.toContain(
      'content',
    );
    await user.click(screen.getByRole('button', { name: 'Redo composition change' }));
    expect(screen.getByRole('button', { name: /Hero.*content.*one-hero-b/ })).toBeTruthy();
  });

  it('binds variants and tokens, previews responsive values, and inserts governed reuse', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: /Hero.*one-hero-b/ }));
    let inspector = screen.getByRole('region', { name: 'Selected component inspector' });
    await user.selectOptions(within(inspector).getByLabelText('Component variant'), 'hero.sunrise');
    const toneToken = within(inspector).getByLabelText('Tone token') as HTMLSelectElement;
    expect(Array.from(toneToken.options).map((option) => option.textContent)).not.toContain(
      'Section spacing',
    );
    await user.selectOptions(toneToken, 'tone.brand');

    const breakpointPicker = screen.getByRole('group', { name: 'Preview breakpoint' });
    await user.click(within(breakpointPicker).getByRole('button', { name: 'Mobile' }));
    const headingBinding = within(inspector)
      .getByLabelText('Heading token')
      .closest('.binding-row');
    expect(headingBinding).toBeTruthy();
    await user.click(
      within(headingBinding as HTMLElement).getByRole('button', { name: 'Capture for mobile' }),
    );
    const heading = within(inspector).getByLabelText('Heading');
    await user.clear(heading);
    await user.type(heading, 'Wide hero');
    expect(screen.getByRole('heading', { name: 'Second hero' })).toBeTruthy();
    await user.click(
      within(headingBinding as HTMLElement).getByRole('button', { name: 'Clear mobile' }),
    );
    expect(screen.getByRole('heading', { name: 'Wide hero' })).toBeTruthy();
    await user.click(within(breakpointPicker).getByRole('button', { name: 'Desktop' }));
    expect(screen.getByRole('heading', { name: 'Wide hero' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '+ Portability callout' }));
    inspector = screen.getByRole('region', { name: 'Selected component inspector' });
    expect(inspector.textContent).toContain('Linked to Portability callout');
    expect(within(inspector).queryByLabelText('Tone')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Apply Campaign page' }));
    expect(screen.getByText('6 components')).toBeTruthy();
  });
  it('authors rich text, assets, references, inline props, and scoped collaboration', async () => {
    const user = userEvent.setup();
    render(
      <App client={createTestClient({ schema: authoringSchema, entries: authoringEntries })} />,
    );

    await screen.findByLabelText('Headline');
    const story = screen.getByRole('region', { name: 'Editorial story' });
    await user.click(within(story).getByRole('button', { name: '+ heading' }));
    const headingBlock = within(story).getByLabelText('Editorial story heading block 1');
    fireEvent.change(headingBlock, { target: { value: 'A semantic story' } });

    const asset = screen.getByRole('region', { name: 'Social image' });
    await user.click(within(asset).getByRole('button', { name: /Campaign landscape/ }));
    expect(within(asset).getByLabelText('Alternative text')).toBeTruthy();

    const relations = screen.getByRole('region', { name: 'Related pages' });
    await user.click(within(relations).getByRole('button', { name: /Second page/ }));
    expect(relations.textContent).toContain('1 selected / 2');

    await user.click(screen.getByRole('button', { name: /Hero.*one-hero-a/ }));
    const inlineEditor = screen.getByRole('region', { name: 'Inline component editor' });
    const inlineHeading = within(inlineEditor).getByLabelText('Heading');
    fireEvent.change(inlineHeading, { target: { value: 'Edited directly in preview' } });
    expect(screen.getByRole('heading', { name: 'Edited directly in preview' })).toBeTruthy();

    await waitFor(() => expect(screen.getByText(/Studio editor/)).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Comment target'), 'story');
    fireEvent.change(screen.getByLabelText('New comment'), {
      target: { value: 'Please check this, @reviewer' },
    });
    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: 'reviewer' } });
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(screen.getByText('Mentioned: reviewer')).toBeTruthy());
    const thread = screen.getByText('Assigned to reviewer').closest('.comment-thread');
    expect(thread?.textContent).toContain('story');
    expect(thread?.textContent).not.toContain('one-hero-a');
  });
});
