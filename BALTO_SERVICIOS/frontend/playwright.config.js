import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE, ENV } from './tests/support/env.js';

const webServer = ENV.skipWebServer
  ? undefined
  : {
      command: ENV.startCommand,
      url: ENV.baseURL,
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        ...process.env,
        BROWSER: 'none',
        REACT_APP_API_URL: ENV.apiURL,
      },
    };

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: ENV.timeoutMs,
  expect: { timeout: ENV.expectTimeoutMs },
  forbidOnly: Boolean(process.env.CI),
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  webServer,
  use: {
    baseURL: ENV.baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
    ignoreHTTPSErrors: false,
    launchOptions: ENV.slowMoMs > 0 ? { slowMo: ENV.slowMoMs } : undefined,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.js/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
      testIgnore: /.*\.setup\.js/,
    },
  ],
});
