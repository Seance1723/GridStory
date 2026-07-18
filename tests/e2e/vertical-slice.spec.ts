import { expect, test } from '@playwright/test';

test('edits, protects, saves, publishes, and delivers React content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to GridStory' })).toBeVisible();

  const heroHeading = page.locator('.block-editor').first().getByLabel('Heading');
  await heroHeading.fill('Published from the browser walkthrough');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Create page' }).click();
  await expect(heroHeading).toHaveValue('Published from the browser walkthrough');

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved as a new immutable revision.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    page.getByText('Published revision is now available to React applications.'),
  ).toBeVisible();

  await page.goto('http://127.0.0.1:44174');
  await expect(
    page.getByRole('heading', { name: 'Published from the browser walkthrough' }),
  ).toBeVisible();
});
