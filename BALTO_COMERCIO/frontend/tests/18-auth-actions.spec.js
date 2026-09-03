import { test, expect } from './support/test.js';
import { ENV } from './support/env.js';

function createPublicContext(browser) {
  return browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
}

const CENTRAL_LOGIN_ORIGIN = new URL(
  String(
    process.env.PW_BALTO_LOGIN_URL ||
      process.env.REACT_APP_BALTO_LOGIN_URL ||
      'https://balto.3devsnet.com/',
  ).trim(),
).origin;

async function expectCentralLogin(page, expectedReturnPath) {
  await expect
    .poll(
      () => {
        try {
          const current = new URL(page.url());
          const returnTo = current.searchParams.get('balto_dev_return');
          const returnUrl = returnTo ? new URL(returnTo) : null;

          return (
            current.origin === CENTRAL_LOGIN_ORIGIN &&
            current.pathname === '/' &&
            current.searchParams.get('balto_dev_system') === 'COMERCIO' &&
            Boolean(current.searchParams.get('balto_bridge')) &&
            returnUrl?.origin === new URL(ENV.baseURL).origin &&
            returnUrl?.pathname === expectedReturnPath
          );
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await expect(page.getByPlaceholder('Usuario')).toBeVisible();
  await expect(page.getByPlaceholder('Contraseña')).toBeVisible();
}

async function loginFromPublicPage(page) {
  await page.goto('/');
  await page.getByPlaceholder('Usuario').fill(ENV.user);
  await page.getByPlaceholder('Contraseña').fill(ENV.password);
  await page.getByRole('button', { name: /ACCEDER/i }).click();
  await expect(page).toHaveURL(/\/panel(?:\/dashboard)?/);
}

test('@auth @smoke protege una ruta privada sin sesión', async ({ browser }) => {
  const context = await createPublicContext(browser);
  const page = await context.newPage();

  await page.goto('/panel/stock');
  await expectCentralLogin(page, '/panel/stock');

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
  await expectCentralLogin(page, '/panel/dashboard');

  await page.goto('/panel/dashboard');
  await expectCentralLogin(page, '/panel/dashboard');

  await context.close();
});
