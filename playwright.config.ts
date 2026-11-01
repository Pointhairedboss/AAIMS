import { defineConfig, devices } from '@playwright/test';

/**
 * AAIMS Master Playwright Configuration
 * Self-contained stack startup (real local BitBopCoordinator + AAIMS Express + Vite)
 * using Google Chrome channel for E2E verification.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: process.env.APP_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx tests/helpers/start_playwright_stack.ts',
    url: 'http://localhost:5173',
    reuseExistingServer: process.env.REUSE_SERVER === '1',
    timeout: 60000,
  },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: {
        baseURL: process.env.API_URL || 'http://localhost:4000',
      },
    },
    {
      name: 'chrome',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        headless: true,
        baseURL: process.env.APP_URL || 'http://localhost:5173',
      },
    },
  ],
});
