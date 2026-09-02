import { test, expect } from './support/test.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { waitForBusyToFinish } from './support/ui.js';

const routes = [
  ['/panel/dashboard', /Panel Contable/i],
  ['/panel/movimientos', /Movimientos/i],
  ['/panel/ventas', /Movs · Ventas/i],
  ['/panel/compras', /Movs · Compras/i],
  ['/panel/recibos', /Movs · Recibos/i],
  ['/panel/OrdenesPago', /Movs · Órdenes de Pago/i],
  ['/panel/Otrosingresos', /Movs · Otros Ingresos/i],
  ['/panel/Otrosegresos', /Movs · Otros Egresos/i],
  ['/panel/presupuesto', /Presupuestos/i],
  ['/panel/remitos', /Remitos/i],
  ['/panel/flujo-de-caja', /Flujo de Caja/i],
  ['/panel/cuentas-corrientes/clientes', /Clientes/i],
  ['/panel/cuentas-corrientes/proveedores', /Proveedores/i],
  ['/panel/stock', /Stock · Productos/i],
  ['/panel/contabilidad/iva-ventas', /IVA Ventas/i],
  ['/panel/contabilidad/iva-compras', /IVA Compras/i],
  ['/panel/cheques/cartera', /Cheques en Cartera/i],
  ['/panel/cheques/flujo', /Flujo de Cheques/i],
  ['/panel/cheques/echeqs-cartera', /Echeqs(?: ·| en) Cartera/i],
  ['/panel/cheques/flujo-echeqs', /Flujo de E-?Cheqs/i],
  ['/panel/analisis-financiero', /Análisis Financiero/i],
  ['/panel/configuracion/calendario', /Calendario global/i],
  ['/panel/configuracion/usuarios', /Usuarios del sistema/i],
];

for (const [route, text] of routes) {
  test(`@navegacion @smoke-interno abre ${route}`, async ({ page }, testInfo) => {
    const diagnostics = installDiagnostics(page);
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
    await expect(page.locator('body')).toContainText(text);
    await expect(page.locator('body')).not.toContainText(/HTTP 5\d\d|Fatal error|Error interno/i);
    await assertNoCriticalErrors(diagnostics, testInfo, {
      allowConsole: [/imagen/i, /cotizaci/i],
    });
  });
}
