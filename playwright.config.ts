import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/playwright',
  use: {
    ...(process.env.CI
      ? devices['Desktop Chrome']
      : { ...devices['Desktop Edge'], channel: 'msedge' }),
    baseURL: 'http://127.0.0.1:44173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/index.js',
      url: 'http://127.0.0.1:44000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        GRIDSTORY_HOST: '127.0.0.1',
        GRIDSTORY_PORT: '44000',
        GRIDSTORY_DATABASE_PATH: ':memory:',
        GRIDSTORY_ALLOWED_ORIGINS: 'http://127.0.0.1:44173,http://127.0.0.1:44174',
        GRIDSTORY_PREVIEW_ALLOWED_ORIGINS: 'http://127.0.0.1:44174',
        GRIDSTORY_PREVIEW_SIGNING_SECRET: 'gridstory-e2e-preview-signing-secret-change-me',
      },
    },
    {
      command:
        'node node_modules/vite/bin/vite.js preview apps/studio --host 127.0.0.1 --port 44173 --strictPort',
      url: 'http://127.0.0.1:44173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        'node node_modules/vite/bin/vite.js preview examples/vite-site --host 127.0.0.1 --port 44174 --strictPort',
      url: 'http://127.0.0.1:44174',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
