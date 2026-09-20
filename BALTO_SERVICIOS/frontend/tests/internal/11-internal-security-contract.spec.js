import { test, expect } from '../support/test.js';
import { ENV } from '../support/env.js';
import { authenticatedApi } from '../support/api.js';

function url(action, query = {}) {
  const target = new URL(`${ENV.apiURL.replace(/\/+$/, '')}/api.php`);
  target.searchParams.set('action', action);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
  return target.toString();
}

async function json(response) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: response.status(), body, text };
}

test('@internal @security herramientas internas nunca aceptan una request anónima', async ({ page }) => {
  const response = await page.context().request.get(
    url('config_testing_e2e_integrity', { scope: 'all' }),
    { headers: { Accept: 'application/json' }, failOnStatusCode: false },
  );
  const result = await json(response);
  expect([401, 403], result.text).toContain(result.status);
  expect(result.body?.exito === true || result.body?.success === true).toBe(false);
});

test('@internal @security auditoría interna rechaza prefijos fuera de la huella PW reservada', async ({ page }) => {
  const result = await authenticatedApi(page, 'config_testing_e2e_integrity', {
    query: { scope: 'prefix', prefix: 'CLIENTE-REAL' },
  });
  expect(result.status, result.text).toBe(400);
  expect(String(result.body?.mensaje || result.body?.message || '')).toMatch(/prefijo.*inv[aá]lido/i);
});
