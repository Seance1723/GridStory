import { expect, test } from '@playwright/test';
import type { StudioContext, StudioOperation } from '@gridstory/schema';

test('switches only an allowed complete context after discard and preview cleanup', async ({
  page,
}) => {
  const contextHeaders: string[] = [];
  await page.route('**/api/v1/studio/context', async (route) => {
    const response = await route.fetch();
    const value = (await response.json()) as StudioContext;
    contextHeaders.push(route.request().headers()['x-gridstory-site'] ?? '');
    const current = {
      ...value.scope,
      siteId: 'default',
      environmentId: 'development',
      locale: 'en',
    };
    const campaign = {
      ...value.scope,
      siteId: 'campaign',
      environmentId: 'preview',
      locale: 'fr',
    };
    await route.fulfill({
      response,
      json: {
        ...value,
        selection: {
          mode: 'configured',
          choices: [
            {
              scope: current,
              labels: { site: 'Default site', environment: 'Development', locale: 'English' },
            },
            {
              scope: campaign,
              labels: { site: 'Campaign site', environment: 'Preview', locale: 'French' },
            },
          ],
        },
      } satisfies StudioContext,
    });
  });
  await page.goto('/');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeEnabled();
  const popupEvent = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open live preview in new window' }).click();
  const popup = await popupEvent;
  await expect(popup.locator('[data-gridstory-node]').first()).toBeVisible();
  await title.fill('Old context private draft');
  await page.getByLabel('Site', { exact: true }).selectOption('campaign');
  await expect(page.getByLabel('Environment', { exact: true })).toHaveValue('preview');
  await expect(page.getByLabel('Locale', { exact: true })).toHaveValue('fr');

  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(title).toHaveValue('Old context private draft');
  await expect(page.getByTitle('Committed Studio context')).toContainText('Default site');
  expect(popup.isClosed()).toBe(false);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTitle('Committed Studio context')).toContainText('Campaign site');
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page).toHaveURL(/#\/pages$/);
  await expect(page.getByText('Old context private draft')).toHaveCount(0);
  expect(contextHeaders).toContain('campaign');
  const browserState = await page.evaluate(() => ({
    url: window.location.href,
    history: JSON.stringify(window.history.state),
    storage: JSON.stringify(window.localStorage),
  }));
  expect(JSON.stringify(browserState)).not.toMatch(/gsp_|campaign|preview-session/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Site', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('real viewer context gates every permitted screen and operation without denied requests', async ({
  page,
}) => {
  const requests: Array<{ path: string; method: string }> = [];
  const failed: number[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    requests.push({ path: new URL(request.url()).pathname, method: request.method() });
    await route.continue({ headers: { ...request.headers(), 'x-gridstory-roles': 'viewer' } });
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 400)
      failed.push(response.status());
  });
  const contextResponse = page.waitForResponse('**/api/v1/studio/context');
  await page.goto('/');
  const context = (await (await contextResponse).json()) as StudioContext;
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeDisabled();
  await expect(page.getByText(/Read-only page/)).toBeVisible();
  expect(requests[0]?.path).toBe('/api/v1/studio/context');
  const permitted = Object.entries(context.capabilities.screens)
    .filter(([, allowed]) => allowed)
    .map(([id]) => id);
  expect(permitted.length).toBeGreaterThan(10);
  expect(context.capabilities.screens.identity).toBe(false);
  expect(context.capabilities.screens.operations).toBe(false);
  await expect(page.locator('[data-destination]')).toHaveCount(permitted.length);
  for (const destination of permitted) {
    const leaf = page.locator(`[data-destination="${destination}"]`);
    if (!(await leaf.isVisible())) {
      await leaf
        .locator('xpath=ancestor::li[contains(@class,"studio-navigation__group")]')
        .getByRole('button', { expanded: false })
        .click();
    }
    await leaf.click();
    await expect(leaf).toHaveAttribute('aria-current', 'page');
    if (destination === 'pages') await expect(page.locator('.studio-workspace')).toBeVisible();
    else await expect(page.locator('.studio-page > section')).toBeVisible();
    const controls = await page.locator('[data-required-operations]').evaluateAll((elements) =>
      elements.map((element) => ({
        operations: element.getAttribute('data-required-operations')?.split(' ') ?? [],
        disabled: element.matches(':disabled'),
      })),
    );
    for (const control of controls) {
      if (
        control.operations.some(
          (operation) => !context.capabilities.operations[operation as StudioOperation],
        )
      )
        expect(control.disabled, `${destination}: ${control.operations.join(', ')}`).toBe(true);
    }
  }
  expect(requests.filter(({ method }) => method !== 'GET')).toEqual([
    { method: 'POST', path: '/api/v1/search' },
  ]);
  expect(failed).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('real delivery-only identity gets no private Studio screens or loaders', async ({ page }) => {
  const paths: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    paths.push(new URL(route.request().url()).pathname);
    await route.continue({
      headers: { ...route.request().headers(), 'x-gridstory-roles': 'delivery' },
    });
  });
  await page.goto('/#/identity');
  await expect(page.getByRole('heading', { name: 'No Studio access' })).toBeVisible();
  await expect(page.locator('[data-destination]')).toHaveCount(0);
  await expect(page.locator('.studio-workspace')).toHaveCount(0);
  expect(paths).toEqual(['/api/v1/studio/context']);
});

test('unsupported context fails closed and can retry without legacy identity fallback', async ({
  page,
}) => {
  const paths: string[] = [];
  let unsupported = true;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (path.endsWith('/studio/context') && unsupported)
      await route.fulfill({ json: { version: 99 } });
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Retry access' })).toBeVisible();
  await expect(page.locator('.studio-shell')).toHaveCount(0);
  expect(paths).toEqual(['/api/v1/studio/context']);
  unsupported = false;
  await page.getByRole('button', { name: 'Retry access' }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeEnabled();
  expect(paths).not.toContain('/api/v1/context');
});

test('observed session loss closes the preview and removes unsaved private output', async ({
  page,
}) => {
  await page.goto('/');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeEnabled();
  const popupEvent = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open live preview in new window' }).click();
  const popup = await popupEvent;
  await expect(popup.locator('[data-gridstory-node]').first()).toBeVisible();
  await title.fill('Private draft that must be evicted');
  await page.route('**/api/v1/content/*/draft', (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Session ended' } } }),
  );
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
  await expect(page.locator('.studio-shell')).toHaveCount(0);
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(await page.locator('body').textContent()).not.toContain(
    'Private draft that must be evicted',
  );
});
