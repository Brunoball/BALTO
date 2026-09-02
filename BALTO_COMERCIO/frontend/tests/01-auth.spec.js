import { test, expect } from './support/test.js';

// BALTO_COMERCIO ya no posee login local.
// El proyecto Playwright llega a este test con el storageState generado por
// tests/setup/auth.setup.js, que contiene la sesión global de BALTO_LOGIN.
// Este smoke verifica que Comercio acepte esa sesión y permita entrar al panel.
test('@smoke sesión global válida permite entrar a Comercio', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/panel(?:\/dashboard)?/, { timeout: 30_000 });

  const sessionKey = await page.evaluate(() => localStorage.getItem('session_key'));
  expect(sessionKey, 'Debe existir la session_key creada por BALTO_LOGIN').toBeTruthy();

  // Comercio no debe volver a mostrar ni solicitar sus credenciales locales.
  await expect(page.getByPlaceholder('Usuario')).toHaveCount(0);
  await expect(page.getByPlaceholder('Contraseña')).toHaveCount(0);
});
