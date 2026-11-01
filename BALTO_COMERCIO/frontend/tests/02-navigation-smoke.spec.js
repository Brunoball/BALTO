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
  { route: '/panel/configuracion', text: /Manual funcional/i },
  { route: '/panel/configuracion/tiendanube', text: /Configuración de Tienda Nube/i },
  { route: '/panel/configuracion/calendario', text: /Calendario global/i },
  { route: '/panel/configuracion/usuarios', text: /Usuarios del sistema/i },
  { route: '/panel/configuracion/datos-legales', text: /Datos legales/i },
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * El gate global puede mostrar una pantalla de error cuando se interrumpe
 * momentáneamente la validación HTTPS de sesión. Sólo reintentamos si aparece
 * ESA pantalla, usando su botón real; un error de navegación o de la API
 * persistente debe seguir fallando. El documento comercial puede renderizar
 * más de un <main>: se comprueba el principal visible sin strict-mode violation.
 */
async function awaitRouteWithSessionRecovery(page, route, expectedText) {
  const sessionFailure = page.getByRole('heading', { name: 'No se pudo validar la sesión' });

  for (let attempt = 0; attempt <= 2; attempt += 1) {
    let state = 'loading';
    await expect.poll(async () => {
      if (await sessionFailure.isVisible().catch(() => false)) {
        state = 'session-error';
      } else if (route === '/panel/analisis-financiero') {
        // Esta página titula el contenido «Movimientos de dinero». «Análisis
        // Financiero» se muestra en el encabezado global, no dentro de main.
        // Comprobamos su navegación funcional real, no un título inexistente.
        if (await page.getByRole('tablist', { name: 'Secciones del análisis financiero' }).isVisible().catch(() => false)
          && await page.getByRole('tab', { name: 'Disponibilidad', selected: true }).isVisible().catch(() => false)) {
          state = 'ready';
        }
      } else if (await page.locator('main:visible').filter({ hasText: expectedText }).first().isVisible().catch(() => false)) {
        state = 'ready';
      } else {
        state = 'loading';
      }
      return state;
    }, {
      message: 'La ruta debe cargar o informar explícitamente un error de validación de sesión',
      timeout: 20_000,
      intervals: [150, 400, 800],
    }).toMatch(/^(ready|session-error)$/);

    if (state === 'ready') return;
    if (attempt === 2) {
      throw new Error('La sesión no pudo validarse después de dos reintentos reales desde el gate.');
    }

    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await waitForBusyToFinish(page);
  }
}

for (const { route, finalRoute = route, text } of routes) {
  test(`@smoke abre ${route}`, async ({ page }, testInfo) => {
    const diagnostics = installDiagnostics(page);
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(escapeRegex(finalRoute), 'i'));
    await waitForBusyToFinish(page);
    await awaitRouteWithSessionRecovery(page, route, text);
    await expect(page.locator('body')).toContainText(text);
    // Facturas y Remitos comparten pantalla y renderizan dos <main>. Además
    // del texto y la URL, exigimos que esté seleccionada la pestaña correcta.
    if (route === '/panel/facturacion' || route === '/panel/remitos') {
      await expect(page.getByRole('tab', {
        name: route === '/panel/facturacion' ? 'Facturas' : 'Remitos',
        selected: true,
      })).toBeVisible();
    }
    // Chromium puede perder ocasionalmente el logo opcional del tenant por
    // QUIC. Sólo se tolera ese console.error si todas las requests QUIC fallidas
    // corresponden exactamente a tenant_logo_ver: no se ocultan errores de
    // endpoints contables, sesión, productos ni respuestas HTTP 5xx.
    const quicFailures = diagnostics.failedRequests.filter((entry) =>
      /ERR_QUIC_PROTOCOL_ERROR\.QUIC_TOO_MANY_RTOS/i.test(entry)
    );
    const onlyOptionalLogoFailed = quicFailures.length > 0 && quicFailures.every((entry) =>
      /action=tenant_logo_ver(?:&|$)/i.test(entry)
    );
    await assertNoCriticalErrors(diagnostics, testInfo, {
      allowConsole: [
        /Tienda Nube/i,
        /imagen/i,
        ...(onlyOptionalLogoFailed
          ? [/^Failed to load resource: net::ERR_QUIC_PROTOCOL_ERROR\.QUIC_TOO_MANY_RTOS$/i]
          : []),
      ],
    });
  });
}
