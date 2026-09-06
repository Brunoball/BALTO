import { test, expect } from './support/test.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { waitForBusyToFinish } from './support/ui.js';

const readOnlyPages = [
  ['/panel/flujo-de-caja', /Flujo de Caja/i],
  ['/panel/cuentas-corrientes/clientes', /Clientes/i],
  ['/panel/cuentas-corrientes/proveedores', /Proveedores/i],
  ['/panel/contabilidad/iva-ventas', /IVA Ventas/i],
  ['/panel/contabilidad/iva-compras', /IVA Compras/i],
  ['/panel/analisis-financiero', /Análisis Financiero/i],
  ['/panel/configuracion', /Usuarios del sistema|Datos legales|Listas y categorías|Saldos iniciales/i],
  ['/panel/configuracion/calendario', /Calendario global/i],
  ['/panel/configuracion/usuarios', /Usuarios del sistema/i],
  ['/panel/configuracion/datos-legales', /Datos legales/i],
  ['/panel/configuracion/listas-categorias', /Listas y categorías/i],
  ['/panel/configuracion/saldos-iniciales', /Saldos iniciales/i],
];

for (const [route, title] of readOnlyPages) {
  test(`@smoke lectura estable ${route}`, async ({ page }, testInfo) => {
    const diagnostics = installDiagnostics(page);
    await page.goto(route);
    await waitForBusyToFinish(page);
    await expect(page.locator('body')).toContainText(title);
    await expect(page.locator('body')).not.toContainText(/HTTP 5\d\d|Error interno|Fatal error/i);
    await assertNoCriticalErrors(diagnostics, testInfo, {
      allowConsole: [/cotizaci/i, /imagen/i],
    });
  });
}

test('@smoke configuración: los modales sensibles abren y cancelan sin guardar', async ({ page }) => {
  await page.goto('/panel/configuracion/usuarios');
  await page.getByRole('button', { name: /Agregar usuario/i }).click();
  const userDialog = page.getByRole('dialog').last();
  await expect(userDialog).toBeVisible();
  const cancelUser = userDialog.getByRole('button', { name: /Cancelar/i });
  if (await cancelUser.isVisible().catch(() => false)) await cancelUser.click();
  else await userDialog.getByRole('button', { name: /Cerrar/i }).click();

  await page.goto('/panel/configuracion/listas-categorias');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Agregar detalle/i }).click();
  const detailDialog = page.getByRole('dialog').filter({ hasText: /Agregar detalle/i }).last();
  await expect(detailDialog).toBeVisible();
  await detailDialog.getByRole('button', { name: /Cancelar/i }).click();
  await expect(detailDialog).toBeHidden();

});
