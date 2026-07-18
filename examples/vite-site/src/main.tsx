import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createGridStoryClient, type ContentEntry } from '@gridstory/client';
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

function Site(): ReactNode {
  const [entry, setEntry] = useState<ContentEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  if (error)
    return (
      <main className="site-state">
        <h1>Content unavailable</h1>
        <p>{error}</p>
      </main>
    );
  if (!entry)
    return (
      <main className="site-state">
        <p>Loading published GridStory content…</p>
      </main>
    );
  const page = entry.data as PageContent;
  return (
    <main>
      <GridStoryRenderer
        nodes={page.blocks}
        registry={exampleComponentRegistry}
        designSystem={exampleDesignSystem}
      />
      <footer>
        <strong>GridStory</strong>
        <span>Content delivered to an ordinary Vite + React application.</span>
      </footer>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Example application root was not found.');
createRoot(root).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
