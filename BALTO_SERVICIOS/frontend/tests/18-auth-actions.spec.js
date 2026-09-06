import { test, expect } from './support/test.js';
import { ENV } from './support/env.js';

function createPublicContext(browser) {
  return browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
}

async function loginFromPublicPage(page) {
  await page.goto('/');
  await page.getByPlaceholder('Usuario').fill(ENV.user);
  await page.getByPlaceholder('Contraseña').fill(ENV.password);
  await page.getByRole('button', { name: /ACCEDER/i }).click();
  await expect(page).toHaveURL(/\/panel(?:\/dashboard)?/);
}

async function expectCentralServicesBridge(page, expectedReturnPath) {
  await expect.poll(
    () => page.url(),
    { timeout: 30_000, message: 'La sesión ausente debe redirigir al acceso central de BALTO' },
  ).toMatch(/[?&]balto_dev_system=SERVICIOS(?:&|$)/i);

  const current = new URL(page.url());
  expect(current.searchParams.get('balto_dev_system')).toBe('SERVICIOS');
  expect(current.searchParams.get('balto_bridge')).toMatch(/^2026\d+_v\d+$/i);

  const returnTo = current.searchParams.get('balto_dev_return') || '';
  expect(returnTo, 'El bridge debe conservar el retorno al frontend local').toBeTruthy();
  const returnUrl = new URL(returnTo);
  expect(returnUrl.pathname + returnUrl.search).toBe(expectedReturnPath);
}

test('@auth @smoke protege una ruta privada sin sesión', async ({ browser }) => {
  const context = await createPublicContext(browser);
  const page = await context.newPage();

  await page.goto('/panel/servicios?seccion=inventario');
  await expectCentralServicesBridge(page, '/panel/servicios?seccion=inventario');

  await context.close();
});

test('@auth rechazo de credenciales incorrectas', async ({ browser }) => {
  const context = await createPublicContext(browser);
  const page = await context.newPage();

  await page.goto('/');
  await page.getByPlaceholder('Usuario').fill(`PW-USUARIO-INEXISTENTE-${Date.now()}`);
  await page.getByPlaceholder('Contraseña').fill('PW-CONTRASENA-INCORRECTA');
  await page.getByRole('button', { name: /ACCEDER/i }).click();

  await expect(page).not.toHaveURL(/\/panel/i);
  await expect(page.locator('body')).toContainText(/incorrect|inválid|no existe|no autorizado|credenciales/i);

  await context.close();
});

test('@auth impide enviar campos vacíos', async ({ browser }) => {
  const context = await createPublicContext(browser);
  const page = await context.newPage();

  await page.goto('/');
  const usuario = page.getByPlaceholder('Usuario');
  const contrasena = page.getByPlaceholder('Contraseña');
  await expect(usuario).toHaveAttribute('required', '');
  await expect(contrasena).toHaveAttribute('required', '');

  await page.getByRole('button', { name: /ACCEDER/i }).click();
  await expect(page).not.toHaveURL(/\/panel/i);
  await expect(page.locator('body')).toContainText(/Por favor complete todos los campos/i);

  await context.close();
});

test('@auth mostrar contraseña y cerrar sesión', async ({ browser }) => {
  const context = await createPublicContext(browser);
  const page = await context.newPage();

  await page.goto('/');
  const password = page.getByPlaceholder('Contraseña');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: /Mostrar contraseña/i }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: /Ocultar contraseña/i }).click();
  await expect(password).toHaveAttribute('type', 'password');

  await loginFromPublicPage(page);
  await page.getByRole('button', { name: /Cerrar sesión/i }).click();
  const logoutDialog = page.getByRole('dialog').filter({ hasText: /Confirmar cierre de sesión/i }).last();
  await expect(logoutDialog).toBeVisible();
  await logoutDialog.getByRole('button', { name: /^Confirmar$/i }).click();
  await expectCentralServicesBridge(page, '/panel/dashboard');

  // Sin iniciar sesión de nuevo, cualquier intento de volver al panel local debe
  // enviarnos otra vez al Login Global, no a un /login interno de Servicios.
  await page.goto('/panel/dashboard');
  await expectCentralServicesBridge(page, '/panel/dashboard');

  await context.close();
});
