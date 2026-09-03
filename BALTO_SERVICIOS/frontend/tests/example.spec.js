import { test, expect } from './support/test.js';

// Reemplaza el ejemplo de playwright.dev por una comprobación real de Balto.
test('@smoke Balto abre el panel autenticado', async ({ page }) => {
  await page.goto('/panel/dashboard');
  await expect(page).toHaveURL(/\/panel\/dashboard/);
  await expect(page.getByText('Panel Contable', { exact: false }).first()).toBeVisible();
});
