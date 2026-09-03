import { test, expect } from './support/test.js';
import { ENV, assertExpectedTenant, assertSafeMutationConfiguration } from './support/env.js';
import { assertFrontendUsesConfiguredBackend } from './support/ui.js';

test('@smoke preflight: entorno, sesión y seguridad', async ({ page }) => {
  if (ENV.allowMutations) assertSafeMutationConfiguration();

  await page.goto('/panel/dashboard');
  await expect(page).toHaveURL(/\/panel\/dashboard/);

  const auth = await page.evaluate(() => ({
    sessionKey: localStorage.getItem('session_key'),
    usuario: JSON.parse(localStorage.getItem('usuario') || 'null'),
  }));

  expect(auth.sessionKey, 'Debe existir una sesión autenticada').toBeTruthy();
  expect(auth.usuario, 'Debe existir el usuario autenticado').toBeTruthy();
  expect(String(auth.usuario?.usuario || auth.usuario?.username || auth.usuario?.nombre || '')).not.toBe('');

  await assertExpectedTenant(page);
  await assertFrontendUsesConfiguredBackend(page);
});

test('@smoke preflight: las mutaciones no apuntan accidentalmente a producción', async () => {
  const host = new URL(ENV.apiURL).hostname.toLowerCase();
  if (ENV.allowMutations && !ENV.allowProduction) {
    expect(host).not.toBe('app.balto.com.ar');
    expect(host).not.toBe('www.app.balto.com.ar');
  }
});
