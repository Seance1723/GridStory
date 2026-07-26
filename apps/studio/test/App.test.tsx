// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGridStoryClient,
  type AssetRecord,
  type AssetUploadSession,
  type ContentEntry,
} from '@gridstory/client';
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
  options: {
    schema?: ContentSchemaDefinition;
    entries?: ContentEntry[];
    assets?: AssetRecord[];
  } = {},
) {
  const testSchema = options.schema ?? schema;
  const testEntries = options.entries ?? entries;
  const testAssets = options.assets ?? [];
  const threads: Array<Record<string, unknown>> = [];
  const presence = [{ actorId: 'local-admin', displayName: 'Studio editor', lastSeenAt: now }];
  const workflowDefinition = {
    organizationId: 'local',
    tenantId: 'default',
    workspaceId: 'default',
    siteId: 'default',
    environmentId: 'development',
    locale: 'en',
    id: 'page-editorial',
    name: 'Editorial review',
    contentType: 'page',
    version: 1,
    initialStateId: 'draft',
    states: [
      { id: 'draft', label: 'Draft', kind: 'draft', terminal: false },
      { id: 'in-review', label: 'In review', kind: 'review', terminal: false },
      { id: 'approved', label: 'Approved', kind: 'approved', terminal: false },
      { id: 'published', label: 'Published', kind: 'published', terminal: false },
    ],
    transitions: [
      {
        id: 'submit-review',
        label: 'Submit for review',
        from: 'draft',
        to: 'in-review',
        allowedRoles: ['admin'],
      },
      {
        id: 'approve',
        label: 'Request approval',
        from: 'in-review',
        to: 'approved',
        allowedRoles: ['admin'],
        approval: {
          minimumApprovals: 1,
          allowedRoles: ['admin'],
          separationOfDuties: true,
          escalateToRoles: ['admin'],
          fields: [],
          locales: [],
        },
      },
      {
        id: 'publish',
        label: 'Publish',
        from: 'approved',
        to: 'published',
        allowedRoles: ['admin'],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const workflowInstances = new Map(
    testEntries.map((candidate) => [
      candidate.id,
      {
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        entryId: candidate.id,
        contentType: 'page',
        workflowId: 'page-editorial',
        workflowVersion: 1,
        stateId: 'draft',
        revisionId: candidate.draftRevisionId,
        schedules: [],
        notifications: [],
        history: [],
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/schemas') return json([testSchema]);
    if (url.pathname === '/api/v1/components') return json(componentManifests);
    if (url.pathname === '/api/v1/design-system') return json(exampleDesignSystem);
    if (url.pathname === '/api/v1/workflows') return json([workflowDefinition]);
    const workflowMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/workflow$/);
    if (workflowMatch) return json(workflowInstances.get(workflowMatch[1] ?? '') ?? {});
    const workflowTransitionMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/workflow\/transitions\/([^/]+)$/,
    );
    if (workflowTransitionMatch) {
      const instance = workflowInstances.get(workflowTransitionMatch[1] ?? '');
      if (!instance) return json({ error: { message: 'Not found.' } }, 404);
      const transitionId = workflowTransitionMatch[2];
      if (transitionId === 'submit-review') instance.stateId = 'in-review';
      if (transitionId === 'approve') {
        Object.assign(instance, {
          pendingApproval: {
            id: 'approval-1',
            transitionId: 'approve',
            revisionId: instance.revisionId,
            requestedBy: 'local-admin',
            requestedByRoles: ['admin'],
            requestedAt: now,
            changedFields: ['headline'],
            decisions: [],
          },
        });
      }
      return json(instance);
    }
    const workflowApprovalMatch = url.pathname.match(
      /^\/api\/v1\/content\/([^/]+)\/workflow\/approvals\/([^/]+)$/,
    );
    if (workflowApprovalMatch) {
      const instance = workflowInstances.get(workflowApprovalMatch[1] ?? '');
      if (!instance) return json({ error: { message: 'Not found.' } }, 404);
      instance.stateId = 'approved';
      delete (instance as typeof instance & { pendingApproval?: unknown }).pendingApproval;
      return json(instance);
    }
    const assetUsageMatch = url.pathname.match(/^\/api\/v1\/assets\/([^/]+)\/usage$/);
    if (assetUsageMatch) {
      return json({
        assetId: assetUsageMatch[1],
        totalReferences: 2,
        entries: 1,
        byPerspective: { draft: 1, published: 1 },
        locations: [],
      });
    }
    if (url.pathname === '/api/v1/assets') return json(testAssets);
    if (url.pathname === '/api/v1/components/gridstory.hero/migration') {
      return json({
        id: 'component_migration_test',
        component: componentManifests[0],
        usage: {
          componentId: 'gridstory.hero',
          currentVersion: 1,
          totalInstances: 4,
          entries: 2,
          byPerspective: { draft: 4, published: 0 },
          byVersion: { '1': 4 },
          locations: [],
        },
        outdatedInstances: 0,
        unmigratableVersions: [],
        ready: true,
      });
    }
    if (url.pathname === '/api/v1/components/gridstory.hero/visual-regression') {
      return json({
        id: 'visual_regression_test',
        componentId: 'gridstory.hero',
        version: 1,
        scenarios: componentManifests[0]?.visualRegression.scenarios ?? [],
        usageHooks: [],
        selector: '[data-gridstory-component="gridstory.hero"][data-gridstory-version="1"]',
      });
    }
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
    const qualityMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/quality$/);
    if (qualityMatch) {
      return json({
        organizationId: 'local',
        tenantId: 'default',
        workspaceId: 'default',
        siteId: 'default',
        environmentId: 'development',
        locale: 'en',
        entryId: qualityMatch[1],
        revisionId: `${qualityMatch[1]}-revision-1`,
        contentType: 'page',
        channel: 'web',
        policyId: 'page-web-quality-v1',
        score: 84,
        passed: false,
        bypassed: false,
        summary: { info: 0, warning: 1, error: 1 },
        findings: [
          {
            id: 'finding-alt',
            category: 'accessibility',
            code: 'image_alt_missing',
            severity: 'error',
            path: ['socialImage', 'alt'],
            message: 'Image alternative text is missing.',
            remediation: 'Describe the image purpose.',
            deduction: 15,
          },
        ],
      });
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

  it('runs candidate quality checks and links findings to responsible fields', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Quality' }));

    const panel = await screen.findByRole('region', { name: 'Content quality report' });
    expect(panel.textContent).toContain('84');
    expect(panel.textContent).toContain('Gate blocked');
    expect(panel.textContent).toContain('Image alternative text is missing.');
    expect(panel.textContent).toContain('socialImage.alt');
    expect(screen.getByRole('button', { name: 'Re-run checks' })).toBeTruthy();
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

  it('shows scoped component usage and visual regression hooks in governance', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Components' }));
    const governance = await screen.findByRole('region', { name: 'Component governance' });
    expect(governance.textContent).toContain('4 scoped usages across 2 entries');
    expect(governance.textContent).toContain('1 code-owned scenarios');
    expect(governance.textContent).toContain('data-gridstory-version');
  });

  it('loads managed assets into the responsive library and field picker', async () => {
    const user = userEvent.setup();
    const managedAsset: AssetRecord = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      id: 'managed-hero',
      kind: 'image',
      currentRevisionId: 'managed-hero-v1',
      revisions: [
        {
          id: 'managed-hero-v1',
          version: 1,
          original: {
            objectKey: 'assets/managed-hero.jpg',
            url: 'https://cdn.example.test/managed-hero.jpg',
            filename: 'managed-hero.jpg',
            mediaType: 'image/jpeg',
            size: 4096,
            checksum: 'managed-checksum',
            width: 1200,
            height: 800,
          },
          metadata: {
            title: 'Managed hero',
            alt: 'Managed alt',
            tags: ['homepage'],
            collections: [],
            custom: {},
          },
          focalPoint: { x: 0.25, y: 0.75 },
          createdAt: now,
          security: {
            status: 'verified',
            declaredMediaType: 'image/jpeg',
            detectedMediaType: 'image/jpeg',
            sanitized: false,
            inspectedAt: now,
            malware: { status: 'clean', provider: 'test-scanner', checkedAt: now },
            findings: [],
          },
          actorId: 'asset-author',
        },
      ],
      renditions: [],
      createdAt: now,
      updatedAt: now,
    };
    render(
      <App
        client={createTestClient({
          schema: authoringSchema,
          entries: authoringEntries,
          assets: [managedAsset],
        })}
      />,
    );

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Assets' }));
    expect(screen.getByRole('heading', { name: 'Asset library' })).toBeTruthy();
    expect(screen.getByText('Focal point 0.25, 0.75')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText(/malware clean/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Inspect usage' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      '2 references across 1 entries',
    );

    const picker = screen.getByRole('region', { name: 'Social image' });
    await user.click(within(picker).getByRole('button', { name: /Managed hero/ }));
    expect((within(picker).getByLabelText('Alternative text') as HTMLInputElement).value).toBe(
      'Managed alt',
    );
  });

  it('chunks browser files by the resumable upload part size', async () => {
    const user = userEvent.setup();
    const client = createTestClient();
    const uploadSession: AssetUploadSession = {
      organizationId: 'local',
      tenantId: 'default',
      workspaceId: 'default',
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
      id: 'upload-1',
      storageUploadId: 'storage-upload-1',
      filename: 'ten-bytes.bin',
      mediaType: 'application/octet-stream',
      size: 10,
      kind: 'file',
      state: 'pending',
      partSize: 4,
      parts: [],
      createdAt: now,
      expiresAt: '2026-07-25T00:00:00.000Z',
    };
    vi.spyOn(client, 'startAssetUpload').mockResolvedValue(uploadSession);
    const uploadPart = vi
      .spyOn(client, 'uploadAssetPart')
      .mockImplementation(async (_uploadId, partNumber, body) => ({
        partNumber,
        etag: `etag-${partNumber}`,
        size: body.byteLength,
      }));
    const complete = vi.spyOn(client, 'completeAssetUpload').mockResolvedValue(undefined as never);
    render(<App client={client} />);

    await screen.findByLabelText('Headline');
    await user.click(screen.getByRole('button', { name: 'Assets' }));
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const file = new File([bytes], 'ten-bytes.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    fireEvent.change(screen.getByLabelText('Upload asset'), { target: { files: [file] } });

    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(uploadPart).toHaveBeenCalledTimes(3);
    expect(uploadPart.mock.calls.map((call) => call[2].byteLength)).toEqual([4, 4, 2]);
    expect(complete.mock.calls[0]?.[1].map((part) => part.size)).toEqual([4, 4, 2]);
  });
  it('shows configured workflow state and requests governed review without exposing publish early', async () => {
    const user = userEvent.setup();
    render(<App client={createTestClient()} />);

    const panel = await screen.findByRole('region', { name: 'Editorial workflow' });
    expect(panel.textContent).toContain('Editorial review');
    expect(panel.textContent).toContain('Draft');
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.click(within(panel).getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(panel.textContent).toContain('In review'));
    await user.click(within(panel).getByRole('button', { name: 'Request approval' }));
    await waitFor(() => expect(panel.textContent).toContain('Approval pending'));
    expect(within(panel).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
