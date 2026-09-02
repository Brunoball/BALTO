import { test, expect } from './support/test.js';
import { assertFrontendUsesConfiguredBackend, waitDialog } from './support/ui.js';

test('@smoke el frontend local usa el backend configurado', async ({ page }) => {
  await assertFrontendUsesConfiguredBackend(page);
});

test('@smoke los modales no se cierran al hacer clic fuera y sí con Escape', async ({ page }) => {
  await page.goto('/panel/ventas');
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const dialog = await waitDialog(page, 'Nueva Venta');

  const overlay = page.locator('.gm-modal-overlay').last();
  await overlay.click({ position: { x: 5, y: 5 }, force: true });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
