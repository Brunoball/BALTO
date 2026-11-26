import { test, expect } from '../support/test.js';
import { uniqueName, uniqueSku, todayISO } from '../support/data.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { requireMutations, waitForBusyToFinish } from '../support/ui.js';
import { deleteMovement, getLists, medioPago, movementId } from '../support/financial-api.js';
import { createStockProductFixture } from '../support/stock-fixtures.js';
import { getStockProductBySku } from '../support/stock-units.js';
import { deleteUnusedStockProduct } from '../support/flows.js';
import { trackRetiredPriceRequests } from '../support/stock-editor.js';

// ===== 57-stock-sin-revision-automatica-precios.spec.js =====
// (antes 57-revision-precios-sin-coeficiente.spec.js)
//
// El coeficiente ponderado y la revisión automática de precios fueron retirados
// (26/11/2026). Stock ya no muestra el aviso flotante "Revisión pendiente de
// precios", no consulta revisiones cada 30 segundos ni al recuperar el foco, y la
// campanita sólo informa vencimientos. Los egresos (COSTO FIJO / VARIABLE) no
// modifican precios de productos.
//
// Las pruebas de UI no escriben datos (las alertas de vencimiento se simulan).
// La prueba de API escribe sólo con PW_ALLOW_MUTATIONS=1 y limpia por ID.

const NOTICE = '[aria-label="Revisión pendiente de precios de Stock"], [aria-label="Abrir Revisión pendiente de precios de Stock"]';
const amount = (v) => Number(v || 0);

async function simularVencimientos(page, alertas = []) {
  await page.route('**/api.php?*', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'stock_vencimientos_alertas') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exito: true, alertas }) });
      return;
    }
    await route.continue();
  });
}

test('@stock @pricing @notificaciones-ui Stock no muestra revisión automática ni consulta endpoints retirados', async ({ page }) => {
  const retiradas = trackRetiredPriceRequests(page);
  await simularVencimientos(page, []);
  await page.goto('/panel/stock', { waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);

  // Antes el aviso consultaba cada 30 s y al volver el foco / la visibilidad.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(3_000);

  await expect(page.locator(NOTICE)).toHaveCount(0);
  await expect(page.getByText(/Hay cambios pendientes en tus precios|coeficiente ponderado/i)).toHaveCount(0);
  expect(retiradas, 'No deben existir peticiones a endpoints del coeficiente').toEqual([]);
  const sesion = await page.evaluate(() => Object.keys(window.sessionStorage).filter((k) => k.includes('revision-precios')));
  expect(sesion, 'Sin estados de sessionStorage del aviso retirado').toEqual([]);
});

test('@stock @notificaciones-ui la campanita sigue mostrando vencimientos y no cuenta revisiones de precios', async ({ page }) => {
  const retiradas = trackRetiredPriceRequests(page);
  await simularVencimientos(page, [{
    id_vencimiento: 990057,
    id_stock_producto: 990057,
    producto_nombre: 'VENCIMIENTO E2E SIMULADO',
    fecha_vencimiento: todayISO(),
    dias_restantes: 0,
    cantidad_disponible: 2,
  }]);
  await page.goto('/panel/stock', { waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);

  const bell = page.getByRole('button', { name: /^Notificaciones de Stock/ }).first();
  await expect(bell).toBeVisible();
  await expect(bell).toHaveAttribute('aria-label', 'Notificaciones de Stock: 1');

  const dialogo = page.getByRole('dialog', { name: /Notificaciones de Stock/i });
  if (!(await dialogo.isVisible().catch(() => false))) await bell.click();
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText('VENCIMIENTO E2E SIMULADO')).toBeVisible();
  await expect(dialogo.getByText(/Vencidos/)).toBeVisible();
  await expect(dialogo.getByText(/Próximos a vencer/)).toBeVisible();
  await expect(dialogo.getByText(/Revisión de precios|Coeficiente anterior|Coeficiente actual|Cambió el coeficiente/i)).toHaveCount(0);
  await expect(dialogo.locator('.sv-alert-stat--pricing, .sv-alert-entry--pricing')).toHaveCount(0);
  await dialogo.getByRole('button', { name: /^Cerrar$/ }).click();
  expect(retiradas).toEqual([]);
});

test('@stock @pricing @mutations egresos COSTO FIJO / VARIABLE no modifican precios ni crean revisiones', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const sku = uniqueSku('EGRESOPREC');
  const name = uniqueName('EGRESO-SIN-PRECIOS', 70).toUpperCase();
  await createStockProductFixture(page, { name, sku, stock: 0, cost: 7372.73, price: 14000 });
  const prod = await getStockProductBySku(page, sku);
  const idProducto = Number(prod.id_stock_producto);
  const snapshot = async () => {
    const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_obtener', {
      query: { id_stock_producto: idProducto, _: Date.now() },
    }));
    return (body?.precios || body?.data?.precios || [])
      .map((p) => `${p.id_tipo_precio_stock}:${amount(p.monto).toFixed(2)}`).sort().join('|');
  };
  const antes = await snapshot();

  const lists = await getLists(page, 'ventas');
  const clasificaciones = lists?.clasificaciones || [];
  const medio = medioPago(lists);
  const ids = [];
  try {
    for (const nombre of ['COSTO FIJO', 'COSTO VARIABLE']) {
      const clas = clasificaciones.find((c) => String(c?.nombre || '').trim().toUpperCase() === nombre);
      if (!clas) continue;
      const total = 157;
      const id = movementId(expectApiSuccess(await authenticatedApi(page, 'otros_egresos_crear', {
        method: 'POST',
        body: {
          fecha: todayISO(),
          id_clasificacion: Number(clas.id ?? clas.id_clasificacion),
          items: [{ detalle: uniqueName('EGR-SIN-PRECIO'), cantidad: 1, precio: total, iva_pct: 0, total }],
          medios_pago: [{ id_medio_pago: medio.id, monto: total }],
        },
      }), `No se pudo crear el egreso ${nombre}`));
      ids.push(id);
      // La clasificación contable se conserva tal cual.
      const egreso = expectApiSuccess(await authenticatedApi(page, 'otros_egresos_obtener', { query: { id_movimiento: id } }));
      const detalle = egreso?.egreso || egreso?.data?.egreso || egreso?.data || egreso;
      expect(Number(detalle?.id_clasificacion)).toBe(Number(clas.id ?? clas.id_clasificacion));
    }
    expect(ids.length, 'Debe existir al menos COSTO FIJO o COSTO VARIABLE').toBeGreaterThan(0);
    expect(await snapshot(), 'Los egresos no modifican ningún precio del producto').toBe(antes);

    const retirada = await authenticatedApi(page, 'stock_precios_revision_pendiente', { query: { _: Date.now() } });
    expect(retirada.status, 'La consulta de revisiones fue retirada').toBeGreaterThanOrEqual(400);
  } finally {
    for (const id of ids) await deleteMovement(page, 'otros_egresos_eliminar', id);
    expect(await snapshot(), 'Eliminar los egresos tampoco modifica precios').toBe(antes);
    await deleteUnusedStockProduct(page, name).catch(() => null);
  }
});
