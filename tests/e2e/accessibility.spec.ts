import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo, test } from '@playwright/test';

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoDetectableWcagViolations(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  await testInfo.attach(`${name}-axe-results`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  expect(
    results.violations,
    results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help}\n${violation.nodes
            .map((node) => `  ${node.target.join(' ')}: ${node.failureSummary ?? ''}`)
            .join('\n')}`,
      )
      .join('\n'),
  ).toEqual([]);
}

test('Studio critical authoring states have no detectable WCAG 2.2 A/AA violations', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
  await expectNoDetectableWcagViolations(page, testInfo, 'studio-default');

  const panels = [
    ['Identity', 'Enterprise identity administration'],
    ['Data governance', 'Data governance administration'],
    ['Migrations', 'CMS migration workbench'],
    ['Marketplace', 'Plugin marketplace workbench'],
    ['Experiments', 'Content experiments workbench'],
    ['AI gateway', 'Governed AI gateway workbench'],
    ['Regions', 'Regional delivery and failover controls'],
    ['Workflows', 'Workflow action designer'],
    ['Releases', 'Release manager'],
    ['Search', 'Search and discovery'],
    ['Operations', 'Administrator operations'],
    ['Components', 'Component governance'],
    ['Assets', 'Asset library'],
    ['Quality', 'Content quality report'],
  ] as const;

  for (const [buttonName, regionName] of panels) {
    await page.getByRole('button', { name: buttonName, exact: true }).click();
    await expect(page.getByRole('region', { name: regionName })).toBeVisible();
  }

  const aiWorkbench = page.getByRole('region', { name: 'Governed AI gateway workbench' });
  await expect(aiWorkbench.getByLabel('Authoring policy JSON')).toBeVisible();
  await expect(
    aiWorkbench.getByRole('button', { name: 'Generate evaluated proposal' }),
  ).toBeDisabled();
  await expect(aiWorkbench.getByLabel('Bounded semantic query')).toBeVisible();
  await expect(aiWorkbench.getByText(/semantic disabled/i)).toBeVisible();
  await expect(aiWorkbench).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await expect(aiWorkbench.locator('.section-heading p')).toHaveCSS('color', 'rgb(71, 85, 105)');
  await expect(aiWorkbench.getByLabel('Authoring policy JSON')).toHaveCSS(
    'color',
    'rgb(24, 33, 47)',
  );
  await expect(aiWorkbench.locator('fieldset').first()).toHaveCSS(
    'border-color',
    'rgb(203, 213, 225)',
  );
  await expect(aiWorkbench.getByRole('note')).toHaveCSS('color', 'rgb(154, 52, 18)');

  const regionalControls = page.getByRole('region', {
    name: 'Regional delivery and failover controls',
  });
  await expect(regionalControls.getByLabel('Policy JSON')).toBeVisible();
  await expect(
    regionalControls.getByRole('button', { name: 'Record provider preflight' }),
  ).toBeDisabled();
  await expect(regionalControls).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await expect(regionalControls.locator('.section-heading p')).toHaveCSS(
    'color',
    'rgb(71, 85, 105)',
  );
  await expect(regionalControls.getByLabel('Policy JSON')).toHaveCSS('color', 'rgb(24, 33, 47)');
  await expect(regionalControls.getByRole('note')).toHaveCSS('color', 'rgb(124, 45, 18)');

  await expectNoDetectableWcagViolations(page, testInfo, 'studio-expanded-panels');
});

test('critical authoring remains keyboard-operable and adapts at 200% zoom', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();

  // Start keyboard traversal inside the document rather than browser chrome.
  await page.locator('body').press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to page editor' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#studio-editor')).toBeFocused();

  const heroLayer = page.getByRole('button', { name: /Hero.*welcome-hero/ });
  await heroLayer.focus();
  await heroLayer.press('ArrowDown');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  const identityButton = page.getByRole('button', { name: 'Identity', exact: true });
  await identityButton.focus();
  await identityButton.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Enterprise identity administration' }),
  ).toBeVisible();
  await expect(identityButton).toHaveAttribute('aria-expanded', 'true');

  const undersizedTargets = await page
    .locator('a[href], button, input:not([type="hidden"]), select, textarea')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const control = element as HTMLElement;
        if (control.matches(':disabled') || control.getClientRects().length === 0) return [];
        const input = control instanceof HTMLInputElement ? control : null;
        const target =
          input && ['checkbox', 'radio', 'file'].includes(input.type) && input.labels?.[0]
            ? input.labels[0]
            : control;
        const rectangle = target.getBoundingClientRect();
        return rectangle.width >= 24 && rectangle.height >= 24
          ? []
          : [
              `${control.tagName.toLowerCase()} ${control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.getAttribute('type') ?? ''} (${rectangle.width.toFixed(1)}x${rectangle.height.toFixed(1)})`,
            ];
      }),
    );
  expect(undersizedTargets).toEqual([]);

  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  const movingElements = await page.locator('*').evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const style = getComputedStyle(element);
        return style.animationDuration !== '0s' || style.transitionDuration !== '0s';
      }).length,
  );
  expect(movingElements).toBe(0);
  await expectNoDetectableWcagViolations(page, testInfo, 'studio-adapted');
});

test('published Vite rendering has no detectable WCAG 2.2 A/AA violations', async ({
  page,
}, testInfo) => {
  await page.goto('http://127.0.0.1:44174');
  await expect(page.locator('main h1')).toBeVisible();
  await expectNoDetectableWcagViolations(page, testInfo, 'vite-published');
});
