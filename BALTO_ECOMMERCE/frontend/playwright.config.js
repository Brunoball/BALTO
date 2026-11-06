// Playwright de BALTO eCommerce. Prueba la tienda real servida por `npm start`
// (CRA en http://localhost:3002, API a traves del proxy /ecom-api de setupProxy.js).
// Ejecutar: BALTO_CONFIG\TEST_ECOMMERCE.bat  o  npx playwright test
const fs = require('fs');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

// .env.playwright lo genera BALTO_CONFIG/sync-env.cjs (PW_ECOMMERCE_TIENDA, PW_API_URL).
const envFile = path.join(__dirname, '.env.playwright');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3002';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'es-AR' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_NO_SERVER ? undefined : {
    command: 'npm start',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180000,
    env: { BROWSER: 'none', PORT: new URL(baseURL).port || '3002' },
  },
});
