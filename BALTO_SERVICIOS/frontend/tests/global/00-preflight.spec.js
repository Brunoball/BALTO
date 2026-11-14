import { test, expect } from '../support/test.js';
import fs from 'node:fs';
import path from 'node:path';
import { ENV, assertExpectedTenant, assertSafeMutationConfiguration } from '../support/env.js';
import { assertFrontendUsesConfiguredBackend } from '../support/ui.js';

test('@smoke preflight: entorno, sesión y seguridad', async ({ page }) => {
  if (ENV.allowMutations) assertSafeMutationConfiguration();

  await page.goto('/panel/dashboard');
  await expect(page).toHaveURL(/\/panel\/dashboard/);

  const auth = await page.evaluate(() => ({
    sessionKey: localStorage.getItem('session_key'),
    usuario: JSON.parse(localStorage.getItem('usuario') || 'null'),
    legacy: {
      token: localStorage.getItem('token'),
      authToken: localStorage.getItem('auth_token'),
      sessionKeyAlias: localStorage.getItem('sessionKey'),
      xSessionAlias: localStorage.getItem('X-Session'),
      xSessionLegacy: localStorage.getItem('x_session'),
    },
  }));

  expect(auth.sessionKey, 'Debe existir una sesión autenticada').toBeTruthy();
  expect(auth.usuario, 'Debe existir el usuario autenticado').toBeTruthy();
  expect(
    Object.values(auth.legacy).filter(Boolean),
    'La sesión operativa debe quedar únicamente en localStorage.session_key; los aliases/tokens legacy deben limpiarse.',
  ).toEqual([]);
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
  // Desde la organización por módulos los specs viven en subcarpetas de tests/:
  // se recorre todo el árbol, no sólo la carpeta de este archivo.
  const testsDir = path.resolve(__dirname, '..');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : walk(full);
    return entry.name.endsWith('.spec.js') ? [full] : [];
  });
  const specs = walk(testsDir);
  // navigation-smoke.js registra sus tests con el mismo wrapper de support/test.js.
  const wrapperImport = /from\s+['"](?:\.\.?\/)+support\/(?:test|navigation-smoke)\.js['"]/;
  const bypass = [];

  expect(specs.length, 'Debe encontrar los specs de todos los módulos').toBeGreaterThan(1);
  for (const file of specs) {
    const source = fs.readFileSync(file, 'utf8');
    if (!wrapperImport.test(source)) {
      bypass.push(path.relative(testsDir, file).split(path.sep).join('/'));
    }
  }

  expect(
    bypass,
    'Todo *.spec.js debe importar test/expect desde support/test.js para que el teardown automático siempre se ejecute.',
  ).toEqual([]);

  if (ENV.allowMutations) {
    expect(
      ENV.cleanup,
      'PW_CLEANUP debe quedar habilitado cuando la suite permite mutaciones; de lo contrario podrían quedar registros/archivos PW-*.',
    ).toBe(true);
  }
});

