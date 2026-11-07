// Playwright de BALTO eCommerce. Se ejecuta desde la raíz del frontend:
//   npx playwright test --project=chromium --workers=1 --reporter=list
// Toda la configuración sale de .env.playwright y de los .env del frontend (tests/soporte/entorno.js).
const { defineConfig, devices } = require('@playwright/test');
const { ENV } = require('./tests/soporte/entorno');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /\d{2}-.*\.spec\.js$/,
  fullyParallel: false,
  workers: Number(process.env.PW_WORKERS || 1),
  retries: 0,
  timeout: ENV.timeoutMs,
  expect: { timeout: ENV.expectTimeoutMs },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: ENV.baseURL,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // `npm start` levanta CRA con el proxy /ecom-api (src/setupProxy.js) hacia PW_API_URL.
  // Si ya está corriendo en el puerto, se reutiliza.
  webServer: ENV.arrancarFrontend ? {
    command: ENV.startCommand,
    url: ENV.baseURL,
    reuseExistingServer: true,
    timeout: 240_000,
    env: { BROWSER: 'none' },
  } : undefined,
});
