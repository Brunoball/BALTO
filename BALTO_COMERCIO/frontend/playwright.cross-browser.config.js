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
  testMatch: [
    '**/example.spec.js',
    '**/00-preflight.spec.js',
    '**/01-auth.spec.js',
    '**/02-navigation-smoke.spec.js',
    '**/09-cheques-smoke.spec.js',
    '**/10-config-accounting.spec.js',
    '**/11-global-guards.spec.js',
    '**/12-documents-readonly.spec.js',
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: ENV.timeoutMs,
  expect: { timeout: ENV.expectTimeoutMs },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-cross-browser', open: 'never' }],
  ],
  webServer,
  use: {
    baseURL: ENV.baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Cordoba',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.js/ },
    {
      name: 'chromium-smoke',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
      testIgnore: /.*\.setup\.js/,
    },
    {
      name: 'firefox-smoke',
      use: { ...devices['Desktop Firefox'], storageState: AUTH_FILE },
      dependencies: ['setup'],
      testIgnore: /.*\.setup\.js/,
    },
    {
      name: 'webkit-smoke',
      use: { ...devices['Desktop Safari'], storageState: AUTH_FILE },
      dependencies: ['setup'],
      testIgnore: /.*\.setup\.js/,
    },
  ],
});
