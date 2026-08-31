import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createGridStoryClient,
  type ContentEntry,
  type NavigationMenuProjection,
} from '@gridstory/client';
import { createGridStoryPreviewRuntime, type PreviewPatchMessage } from '@gridstory/client/preview';
import { exampleComponentRegistry } from '@gridstory/example-kit/react';
import { exampleDesignSystem } from '@gridstory/example-kit/design-system';
import '@gridstory/example-kit/styles.css';
import { GridStoryRenderer } from '@gridstory/react';
import type { PageContent } from '@gridstory/example-kit/manifests';
import './site.css';

const client = createGridStoryClient({
  baseUrl: import.meta.env.VITE_GRIDSTORY_API_URL ?? 'http://localhost:4000',
  tenantId: import.meta.env.VITE_GRIDSTORY_TENANT ?? 'default',
  actorId: 'vite-example',
});
const isPreviewHost = window.parent !== window || window.opener !== null;

function VisitorMenu({
  label,
  menu,
}: {
  label: string;
  menu: NavigationMenuProjection;
}): ReactNode {
  const renderItems = (parentId?: string): ReactNode => {
    const items = menu.items.filter((item) => item.parentId === parentId);
    if (items.length === 0) return null;
    return (
      <ul>
        {items.map((item: NavigationMenuProjection['items'][number]) => (
          <li key={item.id}>
            <a
              href={item.href}
              {...(item.kind === 'external' ? { rel: 'noopener noreferrer' } : {})}
            >
              {item.label}
            </a>
            {renderItems(item.id)}
          </li>
        ))}
      </ul>
    );
  };

  return <nav aria-label={label}>{renderItems()}</nav>;
}

function Site(): ReactNode {
  const [entry, setEntry] = useState<ContentEntry | null>(null);
  const [headerMenu, setHeaderMenu] = useState<NavigationMenuProjection | null>(null);
  const [footerMenu, setFooterMenu] = useState<NavigationMenuProjection | null>(null);
  const [previewPatch, setPreviewPatch] = useState<PreviewPatchMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isPreviewHost) return;
    const controller = new AbortController();
    client
      .getPublishedBySlug('page', 'welcome', controller.signal)
      .then(setEntry)
      .catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== 'AbortError') {
          setError(reason instanceof Error ? reason.message : 'Unable to load GridStory content.');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      client.getPublishedNavigationMenu('header', controller.signal).then(setHeaderMenu),
      client.getPublishedNavigationMenu('footer', controller.signal).then(setFooterMenu),
    ]);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const runtime = createGridStoryPreviewRuntime({
      client,
      controllerOrigin: import.meta.env.VITE_GRIDSTORY_STUDIO_ORIGIN ?? 'http://localhost:5173',
      onPatch: setPreviewPatch,
      onError: (reason) =>
        setError(reason instanceof Error ? reason.message : 'The preview session failed.'),
    });
    runtime.start();
    return () => runtime.dispose();
  }, []);

  if (error && !previewPatch)
    return (
      <main className="site-state">
        <h1>Content unavailable</h1>
        <p>{error}</p>
      </main>
    );
  if (!entry && !previewPatch)
    return (
      <main className="site-state">
        <p>Loading published GridStory content…</p>
      </main>
    );
  const page = (previewPatch?.payload.data ?? entry?.data) as PageContent;
  return (
    <>
      {headerMenu ? (
        <header className="site-header">
          <a className="site-brand" href="/">
            GridStory
          </a>
          <VisitorMenu label="Header navigation" menu={headerMenu} />
        </header>
      ) : null}
      <main>
        <GridStoryRenderer
          nodes={page.blocks}
          registry={exampleComponentRegistry}
          designSystem={exampleDesignSystem}
          preview={previewPatch !== null}
        />
      </main>
      <footer className="site-footer">
        <div className="site-footer__summary">
          <strong>GridStory</strong>
          <span>
            {previewPatch
              ? 'Secure live preview session'
              : 'Content delivered to an ordinary Vite + React application.'}
          </span>
        </div>
        {footerMenu ? <VisitorMenu label="Footer navigation" menu={footerMenu} /> : null}
      </footer>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Example application root was not found.');
createRoot(root).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
