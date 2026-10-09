import { test, expect } from './support/test.js';
import { expectApiSuccess } from './support/api.js';
import { todayISO, uniqueName } from './support/data.js';
import { requireMutations, waitDialog, waitForBusyToFinish } from './support/ui.js';
import { createServiceArticleFixture, getServiceStock } from './support/services.js';
import {
  calculateAmounts,
  createParty,
  deletePurchase,
  deleteSale,
  directAuthenticatedApi,
  extractMovementId,
  findAccountCurrentType,
  getLists,
  getPurchaseDetail,
  getSaleDetail,
} from './internal/support/internal-api.js';

function businessItems(movement) {
  return (movement?.items_detalle || movement?.items || []).filter((row) =>
    String(row?.tipo_item_db || row?.tipo_item || '').toUpperCase() !== 'CONSUMO_ARTICULO'
  );
}

/**
 * Regresión integral: el detalle manual es un renglón contable, NO mueve stock.
 * Incluye compra mixta, edición, venta mixta, IVA y rechazo de descripción vacía.
 */
test('@critical @internal detalles manuales: compras y ventas mixtas conservan stock, IVA y descripción', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const proveedor = await createParty(page, 'provider', uniqueName('INT-MANUAL-PROV', 120));
  const cliente = await createParty(page, 'client', uniqueName('INT-MANUAL-CLI', 120));
  const articuloNombre = uniqueName('INT-MANUAL-MATERIAL', 120);
  const articulo = await createServiceArticleFixture(page, {
    type: 'MATERIAL', name: articuloNombre, stock: 10, cost: 30, price: 90,
  });
  const accountType = findAccountCurrentType(await getLists(page, 'compras'));
  const date = todayISO();
  let idCompra = 0;
  let idVenta = 0;

  try {
    const compraManual = calculateAmounts(2, 150, 21);
    const compraArticulo = calculateAmounts(3, 30, 10.5);
    const crearCompra = await directAuthenticatedApi(page, 'compras_crear_batch', {
      method: 'POST',
      body: {
        fecha: date, id_proveedor: proveedor.id, id_tipo_venta: accountType,
        items: [
          { tipo_item: 'MANUAL', descripcion: 'INSTALACIÓN MANUAL', cantidad: 2, precio: 150, iva_pct: 21, total: compraManual.total },
          { tipo_item: 'ARTICULO', id_articulo: articulo.id_articulo, id_stock_producto: articulo.id_articulo,
            descripcion: articuloNombre, cantidad: 3, precio: 30, iva_pct: 10.5, total: compraArticulo.total },
        ], medios_pago: [],
      },
    });
    idCompra = extractMovementId(expectApiSuccess(crearCompra, 'Falló la compra manual + material'));
    expect(idCompra).toBeGreaterThan(0);
    const compra = await getPurchaseDetail(page, idCompra);
    const compraItems = businessItems(compra);
    expect(compraItems).toHaveLength(2);
    expect(compraItems[0].tipo_item_db).toBe('MANUAL');
    expect(Number(compraItems[0].id_articulo || 0)).toBe(0);
    expect(compraItems[0].descripcion).toBe('INSTALACIÓN MANUAL');
    expect(Number(compraItems[0].total)).toBeCloseTo(compraManual.total, 2);
    expect(Number(compraItems[1].total)).toBeCloseTo(compraArticulo.total, 2);
    expect(await getServiceStock(page, articuloNombre)).toBeCloseTo(13, 6);

    const editarCompra = await directAuthenticatedApi(page, 'compras_actualizar', {
      method: 'POST',
      body: {
        id_movimiento: idCompra, fecha: date, id_proveedor: proveedor.id, id_tipo_venta: accountType,
        ids_items_originales: compraItems.map((it) => Number(it.id_item)),
        ids_items_eliminados: [], medios_pago: [],
        items: [
          { id_item: Number(compraItems[0].id_item), tipo_item: 'MANUAL', descripcion: 'FLETE MANUAL ACTUALIZADO', cantidad: 2, precio: 150, iva_pct: 21 },
          { id_item: Number(compraItems[1].id_item), tipo_item: 'ARTICULO', id_articulo: articulo.id_articulo,
            id_stock_producto: articulo.id_articulo, descripcion: articuloNombre, cantidad: 3, precio: 30, iva_pct: 10.5 },
        ],
      },
    });
    expectApiSuccess(editarCompra, 'Falló edición de compra mixta');
    const compraEditada = businessItems(await getPurchaseDetail(page, idCompra));
    expect(compraEditada).toHaveLength(2);
    expect(compraEditada[0].tipo_item_db).toBe('MANUAL');
    expect(compraEditada[0].descripcion).toBe('FLETE MANUAL ACTUALIZADO');
    expect(await getServiceStock(page, articuloNombre)).toBeCloseTo(13, 6);

    const ventaManual = calculateAmounts(1, 500, 21);
    const ventaArticulo = calculateAmounts(2, 90, 0);
    const crearVenta = await directAuthenticatedApi(page, 'ventas_crear_batch', {
      method: 'POST',
      body: {
        fecha: date, id_tipo_venta: accountType, id_cliente: cliente.id,
        items: [
          { tipo_item: 'MANUAL', descripcion: 'SERVICIO PERSONALIZADO', cantidad: 1, precio: 500, iva_pct: 21, total: ventaManual.total },
          { tipo_item: 'ARTICULO', id_articulo: articulo.id_articulo, id_stock_producto: articulo.id_articulo,
            descripcion: articuloNombre, cantidad: 2, precio: 90, iva_pct: 0, total: ventaArticulo.total },
        ], medios_pago: [],
      },
    });
    idVenta = extractMovementId(expectApiSuccess(crearVenta, 'Falló venta manual + material'));
    expect(idVenta).toBeGreaterThan(0);
    const ventaItems = businessItems(await getSaleDetail(page, idVenta));
    expect(ventaItems).toHaveLength(2);
    expect(ventaItems[0].tipo_item_db).toBe('MANUAL');
    expect(ventaItems[0].descripcion).toBe('SERVICIO PERSONALIZADO');
    expect(Number(ventaItems[0].total)).toBeCloseTo(ventaManual.total, 2);
    expect(Number(ventaItems[1].total)).toBeCloseTo(ventaArticulo.total, 2);
    expect(await getServiceStock(page, articuloNombre)).toBeCloseTo(11, 6);

    const vacia = await directAuthenticatedApi(page, 'compras_crear_batch', {
      method: 'POST',
      body: {
        fecha: date, id_proveedor: proveedor.id, id_tipo_venta: accountType, medios_pago: [],
        items: [{ tipo_item: 'MANUAL', descripcion: ' ', cantidad: 1, precio: 100, iva_pct: 0, total: 100 }],
      },
    });
    expect(vacia.body?.exito, 'No puede persistirse un detalle manual sin descripción').toBe(false);
  } finally {
    if (idVenta) expectApiSuccess(await deleteSale(page, idVenta), 'No se pudo limpiar venta de prueba');
    if (idCompra) expectApiSuccess(await deletePurchase(page, idCompra), 'No se pudo limpiar compra de prueba');
  }
  expect(await getServiceStock(page, articuloNombre)).toBeCloseTo(10, 6);
});

// Smoke sin mutaciones: accesibilidad del modo manual en ambos formularios.
test('@smoke formularios de compras y ventas ofrecen modo Detalle manual', async ({ page }) => {
  for (const cfg of [
    { path: '/panel/compras', button: /Nueva Compra/i, title: 'Nueva Compra', aria: 'Tipo de ítem de compra' },
    { path: '/panel/ventas', button: /Nueva Venta/i, title: 'Nueva Venta', aria: 'Tipo de ítem fila 1' },
  ]) {
    await page.goto(cfg.path);
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: cfg.button }).click();
    const dialog = await waitDialog(page, cfg.title);
    const selector = dialog.getByRole('combobox', { name: cfg.aria }).first();
    await expect(selector.locator('option[value="MANUAL"]')).toHaveText('Detalle manual');
    await selector.selectOption('MANUAL');
    await expect(dialog.getByPlaceholder('Escribí un detalle manual…').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Cerrar' }).first().click();
    await expect(dialog).toBeHidden();
  }
});
