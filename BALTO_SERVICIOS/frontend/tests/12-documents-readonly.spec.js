import { test, expect } from './support/test.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { waitForBusyToFinish } from './support/ui.js';

const pages = [
  ['/panel/presupuesto', /Presupuestos/i, /Buscar por descripción/i],
  ['/panel/facturacion', /Facturas/i, /Buscar/i],
  ['/panel/remitos', /Remitos/i, /Buscar/i],
];

for (const [route, title, searchPattern] of pages) {
  test(`@smoke documentos comerciales: carga y filtra ${route}`, async ({ page }, testInfo) => {
    const diagnostics = installDiagnostics(page);
    await page.goto(route);
    await waitForBusyToFinish(page);
    await expect(page.locator('body')).toContainText(title);

    const search = page.getByPlaceholder(searchPattern).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill('PW-DOCUMENTO-INEXISTENTE');
      await search.press('Enter');
      await waitForBusyToFinish(page);
    }

    await assertNoCriticalErrors(diagnostics, testInfo, {
      allowConsole: [/PDF/i, /imagen/i, /comprobante/i],
    });
  });
}

test('@smoke presupuesto: abre detalle y modelos sin guardar cambios', async ({ page }) => {
  await page.goto('/panel/presupuesto');
  await waitForBusyToFinish(page);

  const models = page.getByTitle('Ver y administrar modelos de presupuesto');
  if (await models.isVisible().catch(() => false)) {
    await models.click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole('button', { name: /Cerrar|Cancelar/i }).last();
    if (await cancel.isVisible().catch(() => false)) await cancel.click();
    else await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});
