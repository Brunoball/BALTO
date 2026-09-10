import { test, expect } from './support/test.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

test('@smoke preflight: todos los specs usan el wrapper con cleanup automático', async () => {
  const testsDir = path.dirname(fileURLToPath(import.meta.url));
  const specs = fs.readdirSync(testsDir).filter((name) => name.endsWith('.spec.js'));
  const bypass = [];

  for (const name of specs) {
    const source = fs.readFileSync(path.join(testsDir, name), 'utf8');
    if (!source.includes("from './support/test.js'") && !source.includes('from "./support/test.js"')) {
      bypass.push(name);
    }
  }

  expect(
    bypass,
    'Todo *.spec.js debe importar test/expect desde ./support/test.js para que el teardown automático siempre se ejecute.',
  ).toEqual([]);

  if (ENV.allowMutations) {
    expect(
      ENV.cleanup,
      'PW_CLEANUP debe quedar habilitado cuando la suite permite mutaciones; de lo contrario podrían quedar registros/archivos PW-*.',
    ).toBe(true);
  }
});

