import { type APIRequestContext, expect, test } from '@playwright/test';

const api = 'http://127.0.0.1:44000/api/v1';
const headers = {
  'x-gridstory-tenant': 'default',
  'x-gridstory-actor': 'studio-navigation-test',
  'x-gridstory-roles': 'admin,editor,publisher',
};

async function createPage(request: APIRequestContext, title: string) {
  const list = await request.get(`${api}/content?contentType=page&perspective=draft`, { headers });
  expect(list.ok()).toBe(true);
  const entries = await list.json();
  const response = await request.post(`${api}/content`, {
    headers,
    data: {
      contentType: 'page',
      data: { ...entries[0].data, title, slug: `navigation-${crypto.randomUUID()}` },
    },
  });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ id: string; data: { title: string; slug: string } }>;
}

const address = (destination: string, id: string) =>
  `#/${destination}?${new URLSearchParams({ entry: id, type: 'page' })}`;

test('deep links restore authorized entry context, reload, skip focus and mobile navigation', async ({
  page,
  context,
  request,
}) => {
  const entry = await createPage(request, 'Navigation deep link');
  await page.goto(`/${address('pages', entry.id)}`);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Navigation deep link');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Asset library' })).toBeVisible();
  const copied = page.url();
  expect(new URL(copied).hash).toBe(address('assets', entry.id));
  const shared = await context.newPage();
  await shared.goto(copied);
  await expect(shared.getByRole('region', { name: 'Asset library' })).toBeVisible();
  await shared.reload();
  await expect(shared.getByRole('region', { name: 'Asset library' })).toBeVisible();
  await shared.getByRole('link', { name: 'Skip to page editor' }).focus();
  await shared.keyboard.press('Enter');
  await expect(shared.locator('#studio-content')).toBeFocused();
  expect(shared.url()).toBe(copied);
  await shared.setViewportSize({ width: 390, height: 844 });
  await shared.getByRole('button', { name: 'Toggle navigation' }).click();
  await shared.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(shared.getByLabel('Title', { exact: true })).toHaveValue('Navigation deep link');
  await expect(shared.locator('.studio-navigation--open')).toHaveCount(0);
  await expect(shared.locator('[data-destination][aria-current="page"]')).toHaveCount(1);
  await shared.close();
});

test('entry and history guards preserve drafts and preview until accepted replacement', async ({
  page,
  request,
}) => {
  const first = await createPage(request, 'Navigation guarded first');
  const second = await createPage(request, 'Navigation guarded second');
  await page.goto(`/${address('pages', first.id)}`);
  const title = page.getByLabel('Title', { exact: true });
  await expect(title).toHaveValue('Navigation guarded first');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open live preview in new window' }).click();
  const popup = await popupPromise;
  await expect(popup.locator('[data-gridstory-node]').first()).toBeVisible();
  await title.fill('Private unsaved navigation draft');
  await expect(title).toHaveValue('Private unsaved navigation draft');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Asset library' })).toBeVisible();
  expect(popup.isClosed()).toBe(false);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(title).toHaveValue('Private unsaved navigation draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('complementary', { name: 'Content entries' })
    .getByRole('button', {
      name: `${second.data.title} /${second.data.slug} draft`,
      exact: true,
    })
    .click();
  await expect(title).toHaveValue('Private unsaved navigation draft');
  expect(new URL(page.url()).hash).toBe(address('pages', first.id));
  expect(popup.isClosed()).toBe(false);
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('complementary', { name: 'Content entries' })
    .getByRole('button', {
      name: `${second.data.title} /${second.data.slug} draft`,
      exact: true,
    })
    .click();
  await expect(title).toHaveValue('Navigation guarded second');
  await expect.poll(() => popup.isClosed()).toBe(true);
  await title.fill('Unsaved second navigation draft');
  await expect(title).toHaveValue('Unsaved second navigation draft');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${second.id}&type=page$`));
  await expect(title).toHaveValue('Unsaved second navigation draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.goBack();
  await expect(title).toHaveValue('Navigation guarded first');
  await page.goForward();
  await expect(title).toHaveValue('Navigation guarded second');
  const serialized = await page.evaluate(() =>
    JSON.stringify({ url: location.href, state: history.state }),
  );
  expect(serialized).not.toMatch(/Private unsaved|Unsaved second|token|sessionId|revisionId|data:/);
});

test('manual fragments, unavailable entries and denied destinations remain truthful and recoverable', async ({
  page,
  request,
}) => {
  const entry = await createPage(request, 'Navigation recovery');
  await page.goto(`/${address('pages', entry.id)}`);
  const title = page.getByLabel('Title', { exact: true });
  await expect(title).toHaveValue('Navigation recovery');
  await title.fill('Retained dirty page');
  await page.evaluate(() => {
    location.hash = '#/unknown?token=do-not-reflect';
  });
  await expect(page.getByText(/That Studio address was not recognized/)).toBeVisible();
  await expect(title).toHaveValue('Retained dirty page');
  expect(new URL(page.url()).hash).toBe(address('pages', entry.id));
  expect(await page.locator('body').textContent()).not.toContain('do-not-reflect');
  page.once('dialog', (dialog) => dialog.accept());
  await page.evaluate(() => {
    location.hash = '#/pages?entry=unavailable-page&type=page';
  });
  await expect(page.getByText(/This page could not be opened/)).toBeVisible();
  await expect(title).toHaveValue('Retained dirty page');
  expect(new URL(page.url()).hash).toBe(address('pages', entry.id));
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(title).toHaveValue('Navigation recovery');
  await page.goto('about:blank');
  await page.goto('/#/pages?entry=unavailable-page&type=page');
  await expect(page.getByText(/The requested page is unavailable/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Open live preview in new window' }),
  ).toBeDisabled();
  await page
    .getByRole('complementary', { name: 'Content entries' })
    .getByRole('button', {
      name: `${entry.data.title} /${entry.data.slug} draft`,
      exact: true,
    })
    .click();
  await expect(title).toHaveValue('Navigation recovery');
  let deniedIdentityRequests = 0;
  let contextRechecks = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/studio/context') contextRechecks += 1;
  });
  await page.route('**/api/v1/identity', (route) => {
    deniedIdentityRequests += 1;
    return route.fulfill({
      status: 403,
      json: { error: { code: 'forbidden', message: 'Identity administration unavailable.' } },
    });
  });
  await page.getByRole('button', { name: 'Identity providers' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The requested operation is unavailable. Permissions were rechecked; contact your administrator or retry when access changes.',
  );
  expect(deniedIdentityRequests).toBe(1);
  expect(contextRechecks).toBe(1);
  await expect(page.locator('.studio-shell')).toHaveCount(0);
  await expect(page.getByText('Identity administration unavailable.')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Enterprise identity administration' }),
  ).toHaveCount(0);
  await page.unroute('**/api/v1/identity');
  await page.getByRole('button', { name: 'Retry access' }).click();
  await expect(
    page.getByRole('region', { name: 'Enterprise identity administration' }),
  ).toBeVisible();
  await expect(page.locator('[data-destination="identity"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
});
