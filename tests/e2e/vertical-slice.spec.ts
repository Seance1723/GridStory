import { expect, test } from '@playwright/test';

test('edits, protects, governs, publishes, and delivers React content', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to GridStory' })).toBeVisible();
  const heroHeading = page.locator('.block-editor').first().getByLabel('Heading');
  await page.getByRole('button', { name: 'App iframe' }).click();
  const applicationFrame = page.frameLocator('iframe[title="Application draft preview"]');
  await expect(
    applicationFrame.getByRole('heading', { name: 'Your application stays yours.' }),
  ).toBeVisible();
  await expect(page.locator('.preview-browser-bar div')).toHaveText('/welcome');

  await heroHeading.fill('Live through the secure preview bridge');
  await expect(
    applicationFrame.getByRole('heading', { name: 'Live through the secure preview bridge' }),
  ).toBeVisible();
  await applicationFrame.locator('[data-gridstory-node]').first().click();
  await expect(
    page
      .getByRole('region', { name: 'Selected component inspector' })
      .getByRole('heading', { name: 'Hero' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close app preview' }).click();
  await expect(page.getByTitle('Application draft preview')).toHaveCount(0);

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Standalone' }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole('heading', { name: 'Live through the secure preview bridge' }),
  ).toBeVisible();
  await heroHeading.fill('Published from the browser walkthrough');
  await expect(
    popup.getByRole('heading', { name: 'Published from the browser walkthrough' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close app preview' }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
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
