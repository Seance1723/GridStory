import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo, test } from '@playwright/test';

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const studioManagementPanels = [
  ['Identity', 'Enterprise identity administration'],
  ['Data governance', 'Data governance administration'],
  ['Migrations', 'CMS migration workbench'],
  ['Marketplace', 'Plugin marketplace workbench'],
  ['Targeting', 'Personalization targeting workbench'],
  ['Experiments', 'Content experiments workbench'],
  ['AI gateway', 'Governed AI gateway workbench'],
  ['Knowledge', 'Knowledge graph and reviewed agents'],
  ['Federation', 'Content federation and syndication'],
  ['Fleet', 'Self-hosted fleet observations'],
  ['Regions', 'Regional delivery and failover controls'],
  ['Workflows', 'Workflow action designer'],
  ['Releases', 'Release manager'],
  ['Search', 'Search and discovery'],
  ['Operations', 'Administrator operations'],
  ['Components', 'Component governance'],
  ['Assets', 'Asset library'],
  ['Quality', 'Content quality report'],
] as const;

async function openMobileStudioNavigation(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) > 900) return;
  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  const navigation = page.getByRole('complementary', { name: 'Primary Studio navigation' });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(navigation).toHaveClass(/studio-navigation--open/);
  await expect
    .poll(() => navigation.evaluate((element) => getComputedStyle(element).transform))
    .toBe('matrix(1, 0, 0, 1, 0, 0)');
}

async function selectStudioPanel(
  page: Page,
  buttonName: (typeof studioManagementPanels)[number][0],
  regionName: (typeof studioManagementPanels)[number][1],
  previousRegionName?: string,
): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Studio sections' });
  const button = navigation.getByRole('button', { name: buttonName, exact: true });
  if ((await button.getAttribute('aria-current')) !== 'page') {
    await openMobileStudioNavigation(page);
    await expect(button).toBeVisible();
    await button.scrollIntoViewIfNeeded();
    await button.click();
  }
  await expect(page.getByRole('region', { name: regionName })).toBeVisible();
  await expect(page.locator('.studio-navigation__item[aria-current="page"]')).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.studio-page > section')).toHaveCount(1);
  await expect(page.locator('.studio-workspace')).toHaveCount(0);
  if (previousRegionName && previousRegionName !== regionName) {
    await expect(page.getByRole('region', { name: previousRegionName })).toHaveCount(0);
  }
}

async function selectStudioPages(page: Page, previousRegionName?: string): Promise<void> {
  const button = page
    .getByRole('navigation', { name: 'Studio sections' })
    .getByRole('button', { name: 'Pages', exact: true });
  if ((await button.getAttribute('aria-current')) !== 'page') {
    await openMobileStudioNavigation(page);
    await expect(button).toBeVisible();
    await button.scrollIntoViewIfNeeded();
    await button.click();
  }
  await expect(page.locator('.studio-workspace')).toBeVisible();
  await expect(page.locator('.studio-navigation__item[aria-current="page"]')).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.studio-page > section')).toHaveCount(0);
  if (previousRegionName) {
    await expect(page.getByRole('region', { name: previousRegionName })).toHaveCount(0);
  }
}

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

test('Studio shell follows the reference navigation, card, theme, and mobile drawer system', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();

  const shell = page.locator('.studio-shell');
  const navigation = page.getByRole('complementary', { name: 'Primary Studio navigation' });
  const header = page.locator('.studio-header');
  const activePage = page.getByRole('button', { name: 'Pages', exact: true });
  await expect(navigation).toHaveCSS('width', '270px');
  await expect(navigation).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(header).toHaveCSS('height', '70px');
  await expect(page.locator('.studio-page')).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(activePage).toHaveCSS('background-color', 'rgb(22, 90, 80)');
  await expect(activePage.locator('.studio-navigation__icon')).toHaveCSS(
    'color',
    'rgb(194, 253, 117)',
  );
  await expect(page.getByRole('search')).toHaveCSS('width', '248px');
  await expect(page.getByRole('search').locator('svg')).toHaveCSS('fill', 'none');
  await expect(page.getByRole('search').locator('svg')).toHaveCSS('stroke', 'rgb(104, 110, 107)');

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await expect(navigation).toHaveCSS('background-color', 'rgb(3, 14, 9)');
  await expect(page.locator('.studio-page')).toHaveCSS('background-color', 'rgb(20, 26, 24)');
  await expect(header).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const navigationToggle = page.getByRole('button', { name: 'Toggle navigation' });
  await expect(navigationToggle).toHaveAttribute('aria-expanded', 'false');
  await navigationToggle.click();
  await expect(navigationToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation).toBeVisible();
  await expect(page.locator('.studio-navigation-backdrop')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(navigationToggle).toHaveAttribute('aria-expanded', 'false');
});

test('Studio critical authoring states have no detectable WCAG 2.2 A/AA violations', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
  await expect(page.locator('.studio-navigation__item[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('.studio-page > section')).toHaveCount(0);
  await expect(page.locator('.studio-workspace')).toBeVisible();
  await expectNoDetectableWcagViolations(page, testInfo, 'studio-default');

  let previousRegionName: string | undefined;
  for (const [buttonName, regionName] of studioManagementPanels) {
    await selectStudioPanel(page, buttonName, regionName, previousRegionName);
    const panel = page.getByRole('region', { name: regionName });

    if (buttonName === 'AI gateway') {
      await expect(panel.getByLabel('Authoring policy JSON')).toBeVisible();
      await expect(
        panel.getByRole('button', { name: 'Generate evaluated proposal' }),
      ).toBeDisabled();
      await expect(panel.getByLabel('Bounded semantic query')).toBeVisible();
      await expect(panel.getByText(/semantic disabled/i)).toBeVisible();
      await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel.locator('.section-heading p')).toHaveCSS('color', 'rgb(104, 110, 107)');
      await expect(panel.getByLabel('Authoring policy JSON')).toHaveCSS('color', 'rgb(3, 14, 9)');
      await expect(panel.locator('fieldset').first()).toHaveCSS(
        'border-color',
        'rgb(229, 230, 230)',
      );
      await expect(panel.getByRole('note')).toHaveCSS('color', 'rgb(154, 52, 18)');
    }
    if (buttonName === 'Knowledge') {
      await expect(panel.getByLabel('Policy JSON')).toBeVisible();
      await expect(
        panel.getByRole('button', { name: 'Create reviewable draft plan' }),
      ).toBeDisabled();
      await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel.locator('.section-heading p')).toHaveCSS('color', 'rgb(104, 110, 107)');
      await expect(panel.getByLabel('Policy JSON')).toHaveCSS('color', 'rgb(3, 14, 9)');
      await expect(panel.locator('fieldset').first()).toHaveCSS(
        'border-color',
        'rgb(229, 230, 230)',
      );
      await expect(panel.getByRole('note')).toHaveCSS('color', 'rgb(124, 45, 18)');
    }
    if (buttonName === 'Federation') {
      await expect(panel.getByLabel('Offer JSON')).toBeVisible();
      await expect(panel.getByLabel('Agreement JSON')).toBeVisible();
      await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel.locator('.section-heading p')).toHaveCSS('color', 'rgb(104, 110, 107)');
      await expect(panel.getByLabel('Offer JSON')).toHaveCSS('color', 'rgb(3, 14, 9)');
      await expect(panel.locator('fieldset').first()).toHaveCSS(
        'border-color',
        'rgb(229, 230, 230)',
      );
      await expect(panel.getByRole('note')).toHaveCSS('color', 'rgb(124, 45, 18)');
    }
    if (buttonName === 'Fleet') {
      await expect(panel.getByLabel('Configured adapter ID')).toBeVisible();
      await expect(panel.getByLabel('Expected instance ID')).toBeVisible();
      await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel.locator('.section-heading p')).toHaveCSS('color', 'rgb(104, 110, 107)');
      await expect(panel.getByLabel('Configured adapter ID')).toHaveCSS('color', 'rgb(3, 14, 9)');
      await expect(panel.locator('fieldset').first()).toHaveCSS(
        'border-color',
        'rgb(229, 230, 230)',
      );
      await expect(panel.getByRole('note')).toHaveCSS('color', 'rgb(124, 45, 18)');
    }
    if (buttonName === 'Regions') {
      await expect(panel.getByLabel('Policy JSON')).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Record provider preflight' })).toBeDisabled();
      await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(panel.locator('.section-heading p')).toHaveCSS('color', 'rgb(104, 110, 107)');
      await expect(panel.getByLabel('Policy JSON')).toHaveCSS('color', 'rgb(3, 14, 9)');
      await expect(panel.getByRole('note')).toHaveCSS('color', 'rgb(124, 45, 18)');
    }

    await expectNoDetectableWcagViolations(
      page,
      testInfo,
      `studio-${buttonName.toLowerCase().replaceAll(' ', '-')}`,
    );
    previousRegionName = regionName;
  }

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await selectStudioPanel(page, 'AI gateway', 'Governed AI gateway workbench', previousRegionName);
  const aiWorkbench = page.getByRole('region', { name: 'Governed AI gateway workbench' });
  await expect(aiWorkbench).toHaveCSS('background-color', 'rgb(3, 14, 9)');
  await expect(aiWorkbench.locator('.section-heading p')).toHaveCSS('color', 'rgb(166, 172, 169)');
  await expect(aiWorkbench.getByLabel('Authoring policy JSON')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  await expect(aiWorkbench.locator('fieldset').first()).toHaveCSS(
    'border-color',
    'rgb(28, 38, 34)',
  );
  await expectNoDetectableWcagViolations(page, testInfo, 'studio-ai-gateway-dark');
  await selectStudioPages(page, 'Governed AI gateway workbench');
  await expectNoDetectableWcagViolations(page, testInfo, 'studio-pages-dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
});

test('every Studio surface contains readable text and controls at each responsive width', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();

  const surfaces = page.locator('.studio-page > section, .studio-workspace');
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ];

  const collectContainmentIssues = () =>
    surfaces.evaluateAll((visibleSurfaces) =>
      visibleSurfaces.flatMap((surface) => {
        const surfaceElement = surface as HTMLElement;
        const surfaceName =
          surfaceElement.getAttribute('aria-label') ?? surfaceElement.className ?? 'surface';
        const issues: string[] = [];
        if (surfaceElement.scrollWidth > surfaceElement.clientWidth + 1) {
          const intrinsicContributors = [...surfaceElement.querySelectorAll<HTMLElement>('*')]
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .sort(
              (left, right) =>
                right.scrollWidth - right.clientWidth - (left.scrollWidth - left.clientWidth),
            )
            .slice(0, 4)
            .map(
              (element) =>
                `${element.tagName.toLowerCase()}.${element.className} ${element.clientWidth}/${element.scrollWidth}`,
            );
          issues.push(
            `${surfaceName}: surface ${surfaceElement.clientWidth}px / ${surfaceElement.scrollWidth}px (${intrinsicContributors.join(', ')})`,
          );
        }

        const controls = surfaceElement.querySelectorAll<HTMLElement>(
          'button, input:not([type="hidden"]), select, textarea',
        );
        for (const control of controls) {
          const style = getComputedStyle(control);
          const rectangle = control.getBoundingClientRect();
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            rectangle.width === 0 ||
            rectangle.height === 0 ||
            control.closest('.preview-page')
          ) {
            continue;
          }

          const boundary =
            control.closest<HTMLElement>('.editor-panel, .content-sidebar, .preview-panel') ??
            surfaceElement;
          let ancestor = control.parentElement;
          let intentionallyScrollable = false;
          while (ancestor && ancestor !== boundary) {
            const ancestorStyle = getComputedStyle(ancestor);
            if (['auto', 'scroll'].includes(ancestorStyle.overflowX)) {
              intentionallyScrollable = true;
              break;
            }
            ancestor = ancestor.parentElement;
          }
          if (!intentionallyScrollable) {
            const boundaryRectangle = boundary.getBoundingClientRect();
            if (
              rectangle.left < boundaryRectangle.left - 1 ||
              rectangle.right > boundaryRectangle.right + 1
            ) {
              issues.push(
                `${surfaceName}: ${control.tagName.toLowerCase()} ${control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.getAttribute('type') ?? ''} escapes ${boundary.className}`,
              );
            }
          }
          if (
            control instanceof HTMLButtonElement &&
            (rectangle.width < 24 || rectangle.height < 24)
          ) {
            issues.push(
              `${surfaceName}: button ${control.getAttribute('aria-label') ?? control.textContent?.trim() ?? ''} is ${rectangle.width.toFixed(1)}x${rectangle.height.toFixed(1)}`,
            );
          }
        }

        const textElements = surfaceElement.querySelectorAll<HTMLElement>(
          'h1, h2, h3, h4, p, small, strong, code, dt, dd, li, label, legend, span',
        );
        for (const textElement of textElements) {
          const style = getComputedStyle(textElement);
          const rectangle = textElement.getBoundingClientRect();
          if (
            rectangle.width <= 4 ||
            rectangle.height <= 4 ||
            textElement.closest('.preview-page') ||
            textElement.closest('.studio-navigation')
          ) {
            continue;
          }
          const clipsHorizontally =
            textElement.scrollWidth > textElement.clientWidth + 2 &&
            ['clip', 'hidden'].includes(style.overflowX);
          const clipsVertically =
            textElement.scrollHeight > textElement.clientHeight + 2 &&
            ['clip', 'hidden'].includes(style.overflowY);
          if (clipsHorizontally || clipsVertically) {
            issues.push(
              `${surfaceName}: clipped ${textElement.tagName.toLowerCase()} ${(textElement.textContent ?? '').trim().slice(0, 60)}`,
            );
          }
        }
        return issues;
      }),
    );

  const expectCurrentLayoutContained = async (context: string) => {
    const documentLayout = await page.evaluate(() => {
      const clientWidth = document.documentElement.clientWidth;
      const previousScroll = { x: window.scrollX, y: window.scrollY };
      window.scrollTo(100, previousScroll.y);
      const reachableScrollX = window.scrollX;
      window.scrollTo(previousScroll.x, previousScroll.y);
      return {
        clientWidth,
        reachableScrollX,
        scrollWidth: document.documentElement.scrollWidth,
        uncontainedOffenders: [...document.querySelectorAll<HTMLElement>('*')]
          .flatMap((element) => {
            const style = getComputedStyle(element);
            const rectangle = element.getBoundingClientRect();
            let ancestor = element.parentElement;
            let intentionallyScrollable = false;
            while (ancestor) {
              const ancestorStyle = getComputedStyle(ancestor);
              if (
                ['auto', 'scroll'].includes(ancestorStyle.overflowX) &&
                ancestor.scrollWidth > ancestor.clientWidth + 1
              ) {
                intentionallyScrollable = true;
                break;
              }
              ancestor = ancestor.parentElement;
            }
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              rectangle.width === 0 ||
              rectangle.height === 0 ||
              intentionallyScrollable ||
              element.closest('.studio-navigation, .preview-page') ||
              (rectangle.left >= -1 && rectangle.right <= clientWidth + 1)
            ) {
              return [];
            }
            return [
              {
                label: `${element.tagName.toLowerCase()}.${element.className} (${rectangle.left.toFixed(1)}..${rectangle.right.toFixed(1)}) ${(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48)}`,
                priority:
                  rectangle.right > clientWidth + 1
                    ? 10_000 + rectangle.right - clientWidth
                    : -rectangle.left,
              },
            ];
          })
          .sort((left, right) => right.priority - left.priority)
          .slice(0, 8)
          .map(({ label }) => label),
      };
    });
    expect(
      documentLayout.reachableScrollX,
      `${context} root width ${documentLayout.clientWidth}px / ${documentLayout.scrollWidth}px`,
    ).toBe(0);
    expect(documentLayout.uncontainedOffenders, `${context} uncontained elements`).toEqual([]);
    expect(await collectContainmentIssues(), `${context} containment`).toEqual([]);
  };

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await selectStudioPages(page);
    await expectCurrentLayoutContained(`${viewport.width}px Pages`);

    let previousRegionName: string | undefined;
    for (const [buttonName, regionName] of studioManagementPanels) {
      await selectStudioPanel(page, buttonName, regionName, previousRegionName);
      await expectCurrentLayoutContained(`${viewport.width}px ${buttonName}`);
      previousRegionName = regionName;
    }

    await selectStudioPages(page, previousRegionName);
    await expectCurrentLayoutContained(`${viewport.width}px Pages return`);
  }

  await selectStudioPanel(page, 'Search', 'Search and discovery');
  const searchResult = page
    .getByRole('region', { name: 'Search and discovery' })
    .getByRole('button', { name: 'Welcome to GridStory' });
  await expect(searchResult).toHaveCSS('min-height', '32px');
  await expect(searchResult).toHaveCSS('background-color', 'rgba(22, 90, 80, 0.12)');

  await selectStudioPages(page, 'Search and discovery');
  await expect(page.locator('.entry-card__title').first()).toHaveCSS('white-space', 'normal');
  expect(
    await page
      .locator('.comment-composer')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  await expect(page.locator('.section-heading').first()).toHaveCSS('flex-direction', 'column');

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expectCurrentLayoutContained('320px dark Pages');
  let previousDarkRegionName: string | undefined;
  for (const [buttonName, regionName] of studioManagementPanels) {
    await selectStudioPanel(page, buttonName, regionName, previousDarkRegionName);
    await expectCurrentLayoutContained(`320px dark ${buttonName}`);
    previousDarkRegionName = regionName;
  }
  await selectStudioPages(page, previousDarkRegionName);
  await expectCurrentLayoutContained('320px dark Pages return');
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
  await expect(identityButton).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.studio-navigation__item[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('.studio-workspace')).toHaveCount(0);

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
