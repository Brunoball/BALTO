import { test, expect } from './support/test.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { waitForBusyToFinish } from './support/ui.js';

const routes = [
  { route: '/panel/dashboard', text: /Panel Contable/i },
  { route: '/panel/movimientos', text: /Movimientos/i },
  { route: '/panel/ventas', text: /Movs · Ventas/i },
  { route: '/panel/compras', text: /Movs · Compras/i },
  { route: '/panel/recibos', text: /Movs · Recibos/i },
  { route: '/panel/OrdenesPago', text: /Movs · Órdenes de Pago/i },
  { route: '/panel/Otrosingresos', text: /Movs · Otros Ingresos/i },
  { route: '/panel/Otrosegresos', text: /Movs · Otros Egresos/i },
  // Esta ruta histórica redirige al módulo actual de presupuestos.
  { route: '/panel/documentos_comerciales', finalRoute: '/panel/presupuesto', text: /Presupuestos/i },
  { route: '/panel/presupuesto', text: /Presupuestos/i },
  { route: '/panel/facturacion', text: /Facturas/i },
  { route: '/panel/remitos', text: /Remitos/i },
  { route: '/panel/flujo-de-caja', text: /Flujo de Caja/i },
  { route: '/panel/cuentas-corrientes/clientes', text: /Clientes/i },
  { route: '/panel/cuentas-corrientes/proveedores', text: /Proveedores/i },
  { route: '/panel/stock', text: /Stock · Productos/i },
  { route: '/panel/contabilidad', text: /IVA Ventas/i },
  { route: '/panel/contabilidad/iva-ventas', text: /IVA Ventas/i },
  { route: '/panel/contabilidad/iva-compras', text: /IVA Compras/i },
  { route: '/panel/cheques/cartera', text: /Cheques en Cartera/i },
  { route: '/panel/cheques/flujo', text: /Flujo de Cheques/i },
  { route: '/panel/cheques/echeqs-cartera', text: /Echeqs(?: ·| en) Cartera/i },
  { route: '/panel/cheques/flujo-echeqs', text: /Flujo de E-?Cheqs/i },
  { route: '/panel/analisis-financiero', text: /Análisis Financiero/i },
  { route: '/panel/configuracion', text: /Tienda Nube|Usuarios del sistema|Datos legales/i },
  { route: '/panel/configuracion/tiendanube', text: /Configuración de Tienda Nube/i },
  { route: '/panel/configuracion/calendario', text: /Calendario global/i },
  { route: '/panel/configuracion/usuarios', text: /Usuarios del sistema/i },
  { route: '/panel/configuracion/datos-legales', text: /Datos legales/i },
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const { route, finalRoute = route, text } of routes) {
  test(`@smoke abre ${route}`, async ({ page }, testInfo) => {
    const diagnostics = installDiagnostics(page);
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(escapeRegex(finalRoute), 'i'));
    await waitForBusyToFinish(page);
    await expect(page.locator('body')).toContainText(text);
    await assertNoCriticalErrors(diagnostics, testInfo, {
      allowConsole: [/Tienda Nube/i, /imagen/i],
    });
  });
}
