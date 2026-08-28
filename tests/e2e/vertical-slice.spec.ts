import { expect, test } from '@playwright/test';

const contentApi = 'http://127.0.0.1:44000/api/v1';
const adminHeaders = {
  'x-gridstory-tenant': 'default',
  'x-gridstory-actor': 'studio-content-list-test',
  'x-gridstory-roles': 'admin,editor,publisher',
};

test('filters, saves, and paginates a responsive content list without replacing the editor', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const titlePrefix = `List ${testInfo.project.name}`;
  const seedResponse = await request.get(
    `${contentApi}/content?contentType=page&perspective=draft`,
    { headers: adminHeaders },
  );
  expect(seedResponse.ok()).toBe(true);
  const seed = (await seedResponse.json()) as Array<{ data: Record<string, unknown> }>;
  for (let index = 1; index <= 11; index += 1) {
    const response = await request.post(`${contentApi}/content`, {
      headers: adminHeaders,
      data: {
        contentType: 'page',
        data: {
          ...seed[0]?.data,
          title: `${titlePrefix} ${String(index).padStart(2, '0')}`,
          slug: `list-view-${index}-${crypto.randomUUID()}`,
        },
      },
    });
    expect(response.ok()).toBe(true);
  }

  await page.goto('/');
  const title = page.getByLabel('Title', { exact: true });
  await expect(title).toBeVisible();
  const selectedTitle = await title.inputValue();
  await page.getByLabel('Search title or slug').fill(titlePrefix);
  await page.getByLabel('Status').selectOption('draft');
  await page.getByLabel('Sort').selectOption('title-asc');
  await page.getByRole('button', { name: 'Apply list view' }).click();
  await expect(page.getByText('Showing 10 of 11')).toBeVisible();
  await expect(title).toHaveValue(selectedTitle);

  const results = page.getByRole('region', { name: 'Content results' });
  const firstResult = results.getByRole('button', { name: new RegExp(`${titlePrefix} 01`) });
  await firstResult.focus();
  await expect(firstResult).toBeFocused();
  await page.getByText('Local saved views (0)').click();
  await page.getByLabel('View name').fill('Draft list views');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByRole('button', { name: 'Draft list views', exact: true })).toBeVisible();
  const localPreference = await page.evaluate(() =>
    localStorage.getItem('gridstory-content-list-views.v1'),
  );
  expect(localPreference).toContain('Draft list views');
  expect(localPreference).not.toMatch(/revisionId|sections|gsp_|bearer|credential/i);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Showing 1 of 11')).toBeVisible();
  await expect(
    results.getByRole('button', { name: new RegExp(`${titlePrefix} 11`) }),
  ).toBeVisible();
  await expect(title).toHaveValue(selectedTitle);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Previous' })).toBeVisible();
  const bounds = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
});

test('edits, protects, governs, publishes, and delivers React content', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
  await page.getByLabel('Search title or slug').fill('Welcome to GridStory');
  await page.getByRole('button', { name: 'Apply list view' }).click();
  await page
    .getByRole('complementary', { name: 'Content entries' })
    .getByRole('button', { name: /Welcome to GridStory/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Welcome to GridStory' })).toBeVisible();
  const heroHeading = page.locator('.block-editor').first().getByLabel('Heading');
  await expect(page.locator('.preview-panel')).toHaveCount(0);
  const previewButton = page.getByRole('button', { name: 'Open live preview in new window' });
  await expect(previewButton).toBeVisible();
  await expect(previewButton).toHaveAttribute('aria-pressed', 'false');
  const popupPromise = page.waitForEvent('popup');
  await previewButton.click();
  const popup = await popupPromise;
  await expect(popup.locator('[data-gridstory-node]').first()).toBeVisible();
  await expect(popup.getByText('Secure live preview session')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close live preview window' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await heroHeading.fill('Live through the secure preview bridge');
  await expect(
    popup.getByRole('heading', { name: 'Live through the secure preview bridge' }),
  ).toBeVisible();
  await popup.locator('[data-gridstory-node]').first().click();
  await expect(
    page
      .getByRole('region', { name: 'Selected component inspector' })
      .getByRole('heading', { name: 'Hero' }),
  ).toBeVisible();
  await expect(
    popup.getByRole('heading', { name: 'Live through the secure preview bridge' }),
  ).toBeVisible();
  await expect(
    popup.locator('.studio-shell, .studio-navigation, .studio-header, .preview-panel'),
  ).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  await heroHeading.fill('Published from the browser walkthrough');
  await expect(
    popup.getByRole('heading', { name: 'Published from the browser walkthrough' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close live preview window' }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(
    page.getByRole('button', { name: 'Open live preview in new window' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Create page' }).click();
  await expect(heroHeading).toHaveValue('Published from the browser walkthrough');

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved as a new immutable revision.')).toBeVisible();
  const workflowPanel = page.getByRole('region', { name: 'Editorial workflow' });
  await workflowPanel.getByRole('button', { name: 'Submit for review' }).click();
  await expect(workflowPanel.getByText('In review', { exact: true })).toBeVisible();

  const approvalResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/workflow/transitions/approve'),
  );
  await workflowPanel.getByRole('button', { name: 'Request approval' }).click();
  const approvalResponse = await approvalResponsePromise;
  expect(approvalResponse.ok()).toBe(true);
  const approvalInstance = (await approvalResponse.json()) as {
    entryId: string;
    pendingApproval: { id: string };
  };
  await expect(workflowPanel.getByText('Approval pending')).toBeVisible();

  const reviewerResponse = await request.post(
    `http://127.0.0.1:44000/api/v1/content/${encodeURIComponent(approvalInstance.entryId)}/workflow/approvals/${encodeURIComponent(approvalInstance.pendingApproval.id)}`,
    {
      headers: {
        'x-gridstory-tenant': 'default',
        'x-gridstory-actor': 'e2e-distinct-reviewer',
        'x-gridstory-roles': 'publisher',
      },
      data: { decision: 'approved', comment: 'Approved by the distinct E2E reviewer.' },
    },
  );
  expect(reviewerResponse.ok()).toBe(true);

  await page.reload();
  await expect(workflowPanel.getByText('Approved', { exact: true })).toBeVisible();
  const publishButton = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(
    page.getByText('Published revision is now available to React applications.'),
  ).toBeVisible();

  await page.goto('http://127.0.0.1:44174');
  await expect(
    page.getByRole('heading', { name: 'Published from the browser walkthrough' }),
  ).toBeVisible();
});

test('creates and revises a registered article without page-only composition or preview', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Studio sections' })
    .getByRole('button', { name: 'Collections', exact: true })
    .click();

  await expect(page.getByRole('heading', { name: 'Articles', exact: true })).toBeVisible();
  await expect(page.getByLabel('Content type')).toHaveValue('article');
  await expect(page.getByLabel('Headline', { exact: true })).toBeVisible();
  await expect(page.getByText('Composition', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open live preview in new window' })).toHaveCount(
    0,
  );

  const relations = page.getByRole('region', { name: 'Related pages' });
  const relationOptions = relations.locator('.button--option-card');
  await expect(relationOptions.first()).toBeVisible();
  await expect(relationOptions.first()).toContainText('page');

  await page.getByRole('button', { name: 'Create article' }).click();
  await expect(page.getByText('Draft article created.')).toBeVisible();
  await expect(page).toHaveURL(/#\/collections\?entry=[^&]+&type=article$/);
  await page.getByLabel('Headline', { exact: true }).fill('Browser-authored article');
  await relationOptions.first().click();
  await expect(relations.getByText('1 selected / 3')).toBeVisible();

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved as a new immutable revision.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browser-authored article' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Immutable revisions' })).toBeVisible();
  await expect(page.getByText('Revision 2')).toBeVisible();
});
