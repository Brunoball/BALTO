import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { todayISO, uniqueName, uniqueSku } from '../support/data.js';
import { requireMutations, searchRow, waitDialog, waitForBusyToFinish } from '../support/ui.js';
import { createStockProductFixture } from '../support/stock-fixtures.js';
import { getDefaultStockUnit, getStockProductBySku, waitStockEditorUnitsReady } from '../support/stock-units.js';
import { deleteUnusedStockProduct } from '../support/flows.js';
import {
  expectStockProfitability,
  openStockEditorTab,
  stockProfitability,
  trackRetiredPriceRequests,
} from '../support/stock-editor.js';

/**
 * BALTO Comercio · Compra con nuevo costo (retiro del coeficiente ponderado).
 *
 * Regla: una compra SÓLO actualiza el PRECIO DE COSTO del producto/variante
 * comprado (StockPurchaseCostService). Venta, promoción y tipos adicionales
 * quedan exactamente iguales; la rentabilidad se recalcula con el costo nuevo.
 * No se genera ninguna revisión automática de precios.
 *
 * Mutaciones reales SÓLO en el tenant E2E (requireMutations). Limpia la compra y
 * el producto PW-* al final.
 */

const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);

async function precios(page, idProducto, idVariante = null) {
  const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_obtener', {
    query: { id_stock_producto: idProducto, ...(idVariante ? { id_stock_variante: idVariante } : {}), _: Date.now() },
  }));
  return body?.precios || body?.data?.precios || [];
}

const porTipo = (filas, idTipo) => filas.find((p) => Number(p.id_tipo_precio_stock) === Number(idTipo)) || null;
const firmaSinCosto = (filas) => filas
  .filter((p) => Number(p.id_tipo_precio_stock) !== 1)
  .map((p) => `${p.id_tipo_precio_stock}:${amount(p.monto).toFixed(2)}`).sort().join('|');

async function tipoCuentaCorriente(page) {
  const body = expectApiSuccess(await authenticatedApi(page, 'global_obtener_listas', { query: { contexto: 'compras' } }));
  const l = body?.listas || body?.data || body;
  const cc = (l.tipos_venta || []).find((t) => /CUENTA\s*CORRIENTE/i.test(String(t.nombre || '')));
  expect(cc, 'Se necesita la forma CUENTA CORRIENTE').toBeTruthy();
  return Number(cc.id_tipo_venta || cc.id);
}

/** Primer tipo de precio adicional EXISTENTE (no se crean tipos en el tenant). */
async function tipoAdicionalExistente(page) {
  const body = expectApiSuccess(await authenticatedApi(page, 'stock_tipos_precio_listar', { query: { _: Date.now() } }));
  const tipos = body?.tipos_precio || body?.stock_tipos_precio || body?.data?.tipos_precio || [];
  return tipos.find((t) => Number(t.id_tipo_precio_stock) > 3 && Number(t.activo ?? 1) === 1) || null;
}

test.describe('@compras @costos @pricing @mutations @critical compra con nuevo costo no cambia precios de venta', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(6 * 60_000);

  test('producto simple: costo 7.372,73 -> compra a 10.000; venta, promo y adicionales intactos', async ({ page }) => {
    await requireMutations(test, page);
    const retiradas = trackRetiredPriceRequests(page);
    const idTipoVenta = await tipoCuentaCorriente(page);
    const sku = uniqueSku('COMPRACOSTO');
    const name = uniqueName('COMPRA-NUEVO-COSTO', 70).toUpperCase();
    await createStockProductFixture(page, { name, sku, stock: 0, cost: 7372.73, price: 14000 });
    const id = Number((await getStockProductBySku(page, sku)).id_stock_producto);

    // Promoción y tipo adicional cargados manualmente (igual que el editor).
    const extra = await tipoAdicionalExistente(page);
    const lista = [
      { id_tipo_precio_stock: 1, monto: '7372.73' },
      { id_tipo_precio_stock: 2, monto: '14000.00' },
      { id_tipo_precio_stock: 3, monto: '12000.00' },
      ...(extra ? [{ id_tipo_precio_stock: Number(extra.id_tipo_precio_stock), monto: '13000.00' }] : []),
    ];
    expectApiSuccess(await authenticatedApi(page, 'stock_precio_guardar', {
      method: 'POST',
      body: { id_stock_producto: id, precios: JSON.stringify(lista) },
    }), 'No se pudieron cargar promoción y adicionales');

    const antes = await precios(page, id);
    const firmaAntes = firmaSinCosto(antes);
    close(porTipo(antes, 1)?.monto, 7372.73, 'costo inicial');

    let idCompra = 0;
    try {
      const res = expectApiSuccess(await authenticatedApi(page, 'compras_crear_batch', {
        method: 'POST',
        body: {
          fecha: todayISO(),
          id_tipo_venta: idTipoVenta,
          proveedor_nombre: uniqueName('PROV-NUEVO-COSTO', 60),
          items: [{ id_stock_producto: id, cantidad: 1, precio: 10000, iva_pct: 0 }],
        },
      }), 'No se pudo registrar la compra');
      idCompra = Number(res.id_movimiento || res.id_compra || res.data?.id_movimiento);

      const despues = await precios(page, id);
      close(porTipo(despues, 1)?.monto, 10000, '4 · la compra actualiza el costo');
      close(porTipo(despues, 2)?.monto, 14000, '5 · la venta sigue en 14.000');
      close(porTipo(despues, 3)?.monto, 12000, '6 · la promoción no cambia');
      expect(firmaSinCosto(despues), '6 · venta, promoción y adicionales idénticos').toBe(firmaAntes);
      // Márgenes persistidos recalculados con el costo nuevo (monto intacto).
      close(porTipo(despues, 2)?.margen_valor, 4000, 'margen $ persistido de la venta');
      close(porTipo(despues, 2)?.margen_porcentaje, 28.57, 'margen % persistido de la venta');

      // 11 · historial compra_costo.
      const hist = expectApiSuccess(await authenticatedApi(page, 'stock_precios_historial_producto', { query: { id_stock_producto: id } }));
      const items = hist.items || hist.data?.items || [];
      expect(items.some((h) => Math.abs(amount(h.precio_nuevo) - 10000) < 0.01), '11 · historial del costo').toBeTruthy();
      const ajustes = expectApiSuccess(await authenticatedApi(page, 'stock_precios_ajustes_historial', { query: { limit: 20, _: Date.now() } }));
      const filas = ajustes?.ajustes || ajustes?.data?.ajustes || [];
      expect(filas.some((a) => String(a.tipo_ajuste) === 'compra_costo'), '11 · ajuste tipo compra_costo').toBeTruthy();
      expect(filas.some((a) => String(a.tipo_ajuste) === 'coeficiente' && new Date(a.created_at) > new Date(Date.now() - 10 * 60_000)),
        '12 · no se crean ajustes por coeficiente').toBeFalsy();

      // 7-10 · pestaña Precios: rentabilidad con el costo vigente.
      await page.goto('/panel/stock');
      await waitForBusyToFinish(page);
      const row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
      await row.locator('button[title="Editar"]').click();
      const dialog = await waitDialog(page, 'Editar producto');
      await waitStockEditorUnitsReady(page, dialog);
      await openStockEditorTab(dialog, 'prices');
      await expectStockProfitability(dialog, { profit: '$ 4.000,00', margin: '28,57%', markup: '40,00%' });
      const r = stockProfitability(dialog);
      await expect(r.promoProfit).toHaveText('$ 2.000,00');
      await expect(r.promoMargin).toHaveText('16,67%');
      await dialog.getByRole('button', { name: /Cancelar/i }).last().click();
      await expect(dialog).toBeHidden();

      // 12 · ninguna revisión automática.
      expect(retiradas, 'Sin peticiones al coeficiente').toEqual([]);
      const retirada = await authenticatedApi(page, 'stock_precios_revision_pendiente', { query: { _: Date.now() } });
      expect(retirada.status, 'La revisión automática fue retirada').toBeGreaterThanOrEqual(400);

      // Eliminar la única compra: el costo NO se borra (podría ser manual) y la venta sigue igual.
      expectApiSuccess(await authenticatedApi(page, 'compras_eliminar', { method: 'POST', body: { id_movimiento: idCompra } }));
      idCompra = 0;
      const final = await precios(page, id);
      close(porTipo(final, 1)?.monto, 10000, 'sin compra anterior válida se conserva el costo');
      expect(firmaSinCosto(final), 'eliminar la compra no cambia precios de venta').toBe(firmaAntes);
    } finally {
      if (idCompra) await authenticatedApi(page, 'compras_eliminar', { method: 'POST', body: { id_movimiento: idCompra } }).catch(() => null);
      await deleteUnusedStockProduct(page, name).catch(() => null);
    }
  });

  test('variante: la compra sólo cambia el costo de la variante comprada', async ({ page }) => {
    await requireMutations(test, page);
    const idTipoVenta = await tipoCuentaCorriente(page);
    const unit = await getDefaultStockUnit(page);
    const sku = uniqueSku('COMPRAVAR');
    const name = uniqueName('COMPRA-COSTO-VAR', 70).toUpperCase();
    await createStockProductFixture(page, {
      name, sku, stock: 0, cost: 50, price: 99, unitId: Number(unit.id_stock_unidad),
      variants: [
        { nombre_variante: 'ROJA', sku: `${sku}R`, stock: 0, unitId: Number(unit.id_stock_unidad), atributos: [{ atributo: 'COLOR', valor: 'ROJA' }] },
        { nombre_variante: 'AZUL', sku: `${sku}A`, stock: 0, unitId: Number(unit.id_stock_unidad), atributos: [{ atributo: 'COLOR', valor: 'AZUL' }] },
      ],
    });
    const id = Number((await getStockProductBySku(page, sku)).id_stock_producto);
    const vars = expectApiSuccess(await authenticatedApi(page, 'stock_variantes_listar', { query: { id_stock_producto: id, activo: 'todos' } }));
    const variantes = vars.variantes || vars.data?.variantes || [];
    const roja = variantes.find((v) => String(v.sku) === `${sku}R`);
    const azul = variantes.find((v) => String(v.sku) === `${sku}A`);
    expect(roja && azul, 'Variantes creadas').toBeTruthy();

    const ventaBase = firmaSinCosto(await precios(page, id));
    const ventaRoja = firmaSinCosto(await precios(page, id, roja.id_stock_variante));
    const ventaAzul = firmaSinCosto(await precios(page, id, azul.id_stock_variante));
    let idCompra = 0;
    try {
      const res = expectApiSuccess(await authenticatedApi(page, 'compras_crear_batch', {
        method: 'POST',
        body: {
          fecha: todayISO(), id_tipo_venta: idTipoVenta, proveedor_nombre: uniqueName('PROV-COSTO-VAR', 60),
          items: [{ id_stock_producto: id, id_stock_variante: Number(roja.id_stock_variante), cantidad: 1, precio: 75, iva_pct: 0 }],
        },
      }));
      idCompra = Number(res.id_movimiento || res.id_compra);
      close(porTipo(await precios(page, id, roja.id_stock_variante), 1)?.monto, 75, 'costo de la variante comprada');
      expect(firmaSinCosto(await precios(page, id, roja.id_stock_variante)), 'venta de la variante comprada intacta').toBe(ventaRoja);
      expect(firmaSinCosto(await precios(page, id, azul.id_stock_variante)), 'otra variante intacta').toBe(ventaAzul);
      expect(firmaSinCosto(await precios(page, id)), 'precios del producto intactos').toBe(ventaBase);
    } finally {
      if (idCompra) await authenticatedApi(page, 'compras_eliminar', { method: 'POST', body: { id_movimiento: idCompra } }).catch(() => null);
      await deleteUnusedStockProduct(page, name).catch(() => null);
    }
  });
});
