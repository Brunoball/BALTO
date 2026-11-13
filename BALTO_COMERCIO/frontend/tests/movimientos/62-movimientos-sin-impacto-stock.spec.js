import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { todayISO, uniqueName, uniqueSku } from '../support/data.js';
import {
  requireMutations,
  gotoPanelReady,
  waitDialog,
  selectProduct,
  selectFirstAutocomplete,
  selectMovementMode,
  clickSaveAndWait,
} from '../support/ui.js';
import { createStockProductFixture } from '../support/stock-fixtures.js';
import { getStockProductBySku } from '../support/stock-units.js';
import {
  getLists,
  tipoVentaId,
  medioPago,
  createParty,
  movementId,
  deleteMovement,
  expectRejected,
} from '../support/financial-api.js';

/**
 * BALTO Comercio · TIPO DE MOVIMIENTO por renglón: "MUEVE STOCK" / "NO MUEVE STOCK".
 *
 * Ambos tipos usan la MISMA lista de productos del stock. La única diferencia:
 * - MUEVE STOCK: funcionamiento normal (la compra suma, la venta resta).
 * - NO MUEVE STOCK: el renglón registra producto, cantidad, precio e IVA, pero
 *   no suma ni resta existencias, no define el costo de última compra, no suma
 *   al coeficiente y una nota de crédito sobre él no devuelve stock.
 *
 * Contrato de payload por ítem: `tipo_movimiento_stock` (MUEVE_STOCK |
 * NO_MUEVE_STOCK) y `mueve_stock` (1 | 0). Sin esos campos el backend conserva
 * exactamente el comportamiento anterior.
 *
 * Requiere las migraciones 2026_11_12 (movimientos_items.mueve_stock y
 * presupuestos_modelos_items.mueve_stock) en el tenant E2E.
 * Mutaciones reales SÓLO en el tenant E2E (requireMutations).
 */

const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);
const MUEVE = 'MUEVE_STOCK';
const NO_MUEVE = 'NO_MUEVE_STOCK';

function mueve(idProducto, cantidad, precio, extra = {}) {
  return { tipo_movimiento_stock: MUEVE, mueve_stock: 1, id_stock_producto: idProducto, cantidad, precio, iva_pct: 0, ...extra };
}
function noMueve(idProducto, cantidad, precio, extra = {}) {
  return { tipo_movimiento_stock: NO_MUEVE, mueve_stock: 0, id_stock_producto: idProducto, cantidad, precio, iva_pct: 0, ...extra };
}

async function producto(page, label, { stock = 0, cost = 100, price = 180 } = {}) {
  const sku = uniqueSku(label);
  const name = uniqueName(label, 90);
  await createStockProductFixture(page, { name, sku, stock, cost, price });
  const row = await getStockProductBySku(page, sku);
  return { id: Number(row.id_stock_producto), sku, name: String(row.nombre || name) };
}
async function stockDe(page, sku) {
  const p = await getStockProductBySku(page, sku);
  return amount(p.stock ?? p.stock_actual);
}
async function costo(page, idProducto) {
  const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_obtener', { query: { id_stock_producto: idProducto, _: Date.now() } }));
  const filas = body?.precios || body?.data?.precios || [];
  const fila = filas.find((p) => /COSTO/i.test(String(p.tipo_nombre || p.nombre || '')));
  return fila ? amount(fila.monto) : null;
}
async function compraCrear(page, body, message = 'No se pudo crear la compra') {
  return movementId(expectApiSuccess(await authenticatedApi(page, 'compras_crear_batch', { method: 'POST', body }), message));
}
async function compraObtener(page, id) {
  const body = expectApiSuccess(await authenticatedApi(page, 'compras_obtener', { query: { id_movimiento: id, _: Date.now() } }));
  return body?.compra || body?.data?.compra;
}
async function ventaCrear(page, body, message = 'No se pudo crear la venta') {
  return expectApiSuccess(await authenticatedApi(page, 'ventas_crear_batch', { method: 'POST', body }), message);
}
async function ventaObtener(page, id) {
  const body = expectApiSuccess(await authenticatedApi(page, 'ventas_obtener', { query: { id_movimiento: id, _: Date.now() } }));
  return body?.venta || body?.data?.venta;
}
const tipos = (items) => (items || []).map((i) => String(i.tipo_movimiento_stock || ''));
const productos = (items) => (items || []).map((i) => Number(i.id_stock_producto || 0));

test.describe('@movimientos @sin-impacto-stock @mutations TIPO DE MOVIMIENTO por renglón', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(8 * 60_000);

  test('Compras · NO MUEVE STOCK registra el producto sin sumar stock ni cambiar costo', async ({ page }) => {
    await requireMutations(test, page);
    const lists = await getLists(page, 'compras');
    const cc = tipoVentaId(lists, 'CUENTA CORRIENTE');
    const contado = tipoVentaId(lists, 'CONTADO');
    const medio = medioPago(lists);
    const proveedor = await createParty(page, 'provider', 'PROV-TIPO-MOV');
    const prod = await producto(page, 'TIPO-MOV-COMPRA', { stock: 0, cost: 4000, price: 7000 });
    const hoy = todayISO();
    const ids = [];
    try {
      // MUEVE STOCK: suma y define el costo.
      ids.push(await compraCrear(page, { fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items: [mueve(prod.id, 10, 5000)] }));
      close(await stockDe(page, prod.sku), 10, 'MUEVE STOCK suma 10');
      close(await costo(page, prod.id), 5000, 'MUEVE STOCK actualiza el costo');

      // NO MUEVE STOCK con el mismo producto, a cuenta corriente.
      const c2 = await compraCrear(page, { fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items: [noMueve(prod.id, 100, 150)] });
      ids.push(c2);
      let compra2 = await compraObtener(page, c2);
      close(compra2.total, 15000, 'total 15.000');
      close(compra2.saldo, 15000, 'deuda del proveedor 15.000');
      expect(productos(compra2.items_detalle), 'conserva el producto').toEqual([prod.id]);
      expect(tipos(compra2.items_detalle), 'tipo recuperado').toEqual([NO_MUEVE]);
      close(await stockDe(page, prod.sku), 10, 'NO MUEVE STOCK no suma');
      close(await costo(page, prod.id), 5000, 'NO MUEVE STOCK no cambia el costo');

      // Edición: pasar a MUEVE STOCK suma; volver a NO MUEVE STOCK lo retira.
      const editar = (items) => authenticatedApi(page, 'compras_actualizar', {
        method: 'POST', body: { id_movimiento: c2, fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items },
      });
      expectApiSuccess(await editar([mueve(prod.id, 100, 150)]), 'No se pudo editar a MUEVE STOCK');
      close(await stockDe(page, prod.sku), 110, 'pasar a MUEVE STOCK suma 100');
      expectApiSuccess(await editar([noMueve(prod.id, 100, 150)]), 'No se pudo editar a NO MUEVE STOCK');
      close(await stockDe(page, prod.sku), 10, 'volver a NO MUEVE STOCK retira 100');
      close(await costo(page, prod.id), 5000, 'el costo vuelve a la última compra que mueve stock');

      // Mixta: un renglón de cada tipo, mismo producto.
      const c3 = await compraCrear(page, { fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items: [mueve(prod.id, 5, 5000), noMueve(prod.id, 7, 150)] });
      ids.push(c3);
      const compra3 = await compraObtener(page, c3);
      expect(tipos(compra3.items_detalle)).toEqual([MUEVE, NO_MUEVE]);
      close(await stockDe(page, prod.sku), 15, 'mixta: sólo suma el renglón MUEVE STOCK');

      // Contado.
      const c4 = await compraCrear(page, {
        fecha: hoy, id_tipo_venta: contado, id_proveedor: proveedor.id,
        items: [noMueve(prod.id, 1, 10000)], medios_pago: [{ id_medio_pago: medio.id, monto: 10000 }],
      });
      ids.push(c4);
      expect(String((await compraObtener(page, c4)).estado_pago)).toMatch(/PAGADO/i);
      close(await stockDe(page, prod.sku), 15, 'contado NO MUEVE STOCK no suma');

      // Eliminar: sólo revierte lo que movió stock.
      expectApiSuccess(await authenticatedApi(page, 'compras_eliminar', { method: 'POST', body: { id_movimiento: c3 } }));
      ids.splice(ids.indexOf(c3), 1);
      close(await stockDe(page, prod.sku), 10, 'eliminar la mixta revierte sólo 5');

      // Validaciones del servidor.
      expectRejected(await authenticatedApi(page, 'compras_crear_batch', {
        method: 'POST', body: { fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items: [{ tipo_movimiento_stock: NO_MUEVE, descripcion: 'TEXTO LIBRE', cantidad: 1, precio: 10 }] },
      }), /producto/i);
      expectRejected(await authenticatedApi(page, 'compras_crear_batch', {
        method: 'POST', body: { fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items: [{ ...noMueve(prod.id, 1, 10), tipo_movimiento_stock: 'OTRO' }] },
      }));

      // Payload histórico (sin el campo nuevo): igual que antes.
      ids.push(await compraCrear(page, { fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items: [{ id_stock_producto: prod.id, cantidad: 2, precio: 5000, iva_pct: 0 }] }));
      close(await stockDe(page, prod.sku), 12, 'payload histórico sigue sumando');
    } finally {
      for (const id of ids.reverse()) await deleteMovement(page, 'compras_eliminar', id);
    }
  });

  test('Ventas · NO MUEVE STOCK no descuenta ni se bloquea por existencias; NC no devuelve stock', async ({ page }) => {
    await requireMutations(test, page);
    const lists = await getLists(page, 'ventas');
    const cc = tipoVentaId(lists, 'CUENTA CORRIENTE');
    const cliente = await createParty(page, 'client', 'CLIENTE-TIPO-MOV');
    const prod = await producto(page, 'TIPO-MOV-VENTA', { stock: 5, cost: 8000, price: 15000 });
    const hoy = todayISO();
    const ids = [];
    try {
      const v1 = await ventaCrear(page, {
        fecha: hoy, id_tipo_venta: cc, id_cliente: cliente.id, medios_pago: [],
        items: [mueve(prod.id, 1, 15000, { precio_lista: 15000 }), noMueve(prod.id, 1, 5000, { precio_lista: 5000 })],
        descuento_tipo: 'PORCENTAJE', descuento_valor: 10, descuento_monto: 2000, total_bruto: 20000,
      });
      const idV1 = movementId(v1);
      ids.push(idV1);
      close(v1.total, 18000, 'descuento general sobre la venta mixta');
      close(await stockDe(page, prod.sku), 4, 'sólo MUEVE STOCK descuenta 1');
      const venta1 = await ventaObtener(page, idV1);
      expect(tipos(venta1.items_detalle)).toEqual([MUEVE, NO_MUEVE]);
      expect(productos(venta1.items_detalle)).toEqual([prod.id, prod.id]);

      // Más unidades que el stock disponible: NO MUEVE STOCK no se bloquea.
      const v2 = await ventaCrear(page, { fecha: hoy, id_tipo_venta: cc, id_cliente: cliente.id, medios_pago: [], items: [noMueve(prod.id, 50, 100)] });
      ids.push(movementId(v2));
      close(await stockDe(page, prod.sku), 4, 'NO MUEVE STOCK no descuenta');
      // MUEVE STOCK sigue validando existencias.
      expectRejected(await authenticatedApi(page, 'ventas_crear_batch', {
        method: 'POST', body: { fecha: hoy, id_tipo_venta: cc, id_cliente: cliente.id, items: [mueve(prod.id, 50, 100)] },
      }));

      // NC sobre el renglón NO MUEVE STOCK: acredita importe, no devuelve stock.
      const ctx = expectApiSuccess(await authenticatedApi(page, 'ventas_nota_credito_contexto', { query: { id_movimiento: idV1 } }));
      const items = (ctx.contexto || ctx.data?.contexto).items;
      const itemNoMueve = items.find((it) => String(it.mueve_stock) === '0');
      expect(itemNoMueve, 'el contexto informa el renglón NO MUEVE STOCK').toBeTruthy();
      expectApiSuccess(await authenticatedApi(page, 'ventas_nota_credito_crear', {
        method: 'POST',
        body: { id_movimiento_origen: idV1, fecha: hoy, motivo: 'DEVOLUCION_MERCADERIA', modalidad: 'INTERNA', items: [{ id_item_origen: itemNoMueve.id_item, cantidad: 1, afecta_stock: true }] },
      }), 'No se pudo emitir la nota de crédito');
      close(await stockDe(page, prod.sku), 4, 'la NC del renglón NO MUEVE STOCK no devuelve stock');
    } finally {
      for (const id of ids.reverse()) await deleteMovement(page, 'ventas_eliminar', id);
    }
  });

  test('Presupuestos · tipo por renglón, conversión, doble conversión y modelos', async ({ page }) => {
    await requireMutations(test, page);
    const lists = await getLists(page, 'ventas');
    const cc = tipoVentaId(lists, 'CUENTA CORRIENTE');
    const cliente = await createParty(page, 'client', 'CLIENTE-PRESU-TIPO');
    const prod = await producto(page, 'TIPO-MOV-PRESU', { stock: 4, cost: 10000, price: 25000 });
    const hoy = todayISO();
    let idPresupuesto = 0; let idVenta = 0; let idModelo = 0; let idPresupuesto2 = 0;
    try {
      const creado = expectApiSuccess(await authenticatedApi(page, 'presupuestos_crear', {
        method: 'POST',
        body: {
          fecha: hoy, id_cliente: cliente.id,
          items: [mueve(prod.id, 1, 25000, { descripcion: prod.name }), noMueve(prod.id, 1, 10000, { descripcion: prod.name })],
          guardar_como_modelo: 1, modelo_nombre: uniqueName('MODELO TIPO MOV', 120),
        },
      }), 'No se pudo crear el presupuesto');
      idPresupuesto = movementId(creado);
      idModelo = Number(creado.id_modelo_guardado || creado.modelo_guardado?.id_modelo || 0);
      close(await stockDe(page, prod.sku), 4, 'guardar el presupuesto no toca stock');
      const det = expectApiSuccess(await authenticatedApi(page, 'presupuestos_obtener', { query: { id_movimiento: idPresupuesto } }));
      expect(tipos(det.items)).toEqual([MUEVE, NO_MUEVE]);

      const convertir = () => authenticatedApi(page, 'presupuestos_convertir_venta', {
        method: 'POST', body: { id_presupuesto: idPresupuesto, fecha: hoy, id_tipo_venta: cc, accion_venta: 'guardar', es_facturada: 0, medios_pago: [] },
      });
      const conv = expectApiSuccess(await convertir(), 'No se pudo convertir');
      idVenta = Number(conv.id_venta || conv.data?.id_venta || 0);
      const venta = await ventaObtener(page, idVenta);
      expect(tipos(venta.items_detalle), 'la venta conserva los tipos').toEqual([MUEVE, NO_MUEVE]);
      expect(productos(venta.items_detalle)).toEqual([prod.id, prod.id]);
      close(await stockDe(page, prod.sku), 3, 'la conversión descuenta sólo MUEVE STOCK');
      const conv2 = expectApiSuccess(await convertir());
      expect(Number(conv2.id_venta || conv2.data?.id_venta)).toBe(idVenta);
      close(await stockDe(page, prod.sku), 3, 'doble conversión sin doble impacto');

      expect(idModelo, 'se guardó el modelo').toBeGreaterThan(0);
      const modelo = expectApiSuccess(await authenticatedApi(page, 'presupuestos_modelos_obtener', { query: { id_modelo: idModelo } }));
      const itemsModelo = modelo.items || modelo.modelo?.items || [];
      expect(tipos(itemsModelo), 'el modelo conserva los tipos').toEqual([MUEVE, NO_MUEVE]);
      expect(productos(itemsModelo), 'el modelo conserva el producto').toEqual([prod.id, prod.id]);
      const reuso = expectApiSuccess(await authenticatedApi(page, 'presupuestos_crear', { method: 'POST', body: { fecha: hoy, id_cliente: cliente.id, items: itemsModelo } }));
      idPresupuesto2 = movementId(reuso);
      const det2 = expectApiSuccess(await authenticatedApi(page, 'presupuestos_obtener', { query: { id_movimiento: idPresupuesto2 } }));
      expect(tipos(det2.items)).toEqual([MUEVE, NO_MUEVE]);
    } finally {
      await deleteMovement(page, 'ventas_eliminar', idVenta);
      await deleteMovement(page, 'presupuestos_eliminar', idPresupuesto2);
      await deleteMovement(page, 'presupuestos_eliminar', idPresupuesto);
      if (idModelo) await authenticatedApi(page, 'presupuestos_modelos_eliminar', { method: 'POST', body: { id_modelo: idModelo } }).catch(() => null);
    }
  });

  test('UI · Nueva Compra: selector en mayúsculas y NO MUEVE STOCK con la misma lista de productos', async ({ page }) => {
    await requireMutations(test, page);
    const proveedor = await createParty(page, 'provider', 'PROV-UI-TIPO-MOV');
    const prod = await producto(page, 'TIPO-MOV-UI', { stock: 7, cost: 10, price: 20 });
    let idCompra = 0;
    try {
      await gotoPanelReady(page, '/panel/compras', page.getByTitle('Crear nueva compra'));
      await page.getByTitle('Crear nueva compra').click();
      const dialog = await waitDialog(page, 'Nueva Compra');
      const row = dialog.getByTestId('compra-row').first();
      const selector = row.getByTestId('tipo-movimiento-stock');

      await expect(row.getByText('TIPO DE MOVIMIENTO', { exact: false })).toBeVisible();
      await expect(selector).toHaveValue(MUEVE);
      await expect(selector.locator('option')).toHaveText(['MUEVE STOCK', 'NO MUEVE STOCK']);

      await selector.selectOption(NO_MUEVE);
      await expect(row.getByTestId('concepto-sin-stock')).toHaveCount(0);
      await expect(row).not.toContainText(/servicio|concepto/i);
      await selectProduct(row, prod.name);
      const qty = row.locator('input[type="number"]').first();
      await qty.fill('3');
      await qty.blur();
      const price = row.locator('input[inputmode="decimal"]').first();
      await price.click();
      await price.fill('150');
      await price.blur();

      await dialog.getByRole('button', { name: /Agregar fila/i }).click();
      const row2 = dialog.getByTestId('compra-row').nth(1);
      await expect(row2.getByTestId('tipo-movimiento-stock')).toHaveValue(MUEVE);
      await row2.locator('button[title="Eliminar fila"]').click();

      await selectFirstAutocomplete(dialog, 'Proveedor', proveedor.name);
      await selectMovementMode(dialog, 'Forma de compra', /CUENTA\s*CORRIENTE/i);

      const responsePromise = page.waitForResponse((r) => r.request().method() === 'POST'
        && new URL(r.url()).searchParams.get('action') === 'compras_crear_batch', { timeout: 60_000 });
      await clickSaveAndWait(dialog, /Guardar compra/i, { timeout: 60_000 });
      const response = await responsePromise;
      const payload = response.request().postDataJSON();
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({ tipo_movimiento_stock: NO_MUEVE, mueve_stock: 0, id_stock_producto: prod.id });
      idCompra = movementId(await response.json());

      const compra = await compraObtener(page, idCompra);
      close(compra.total, 450, 'compra de $450');
      expect(productos(compra.items_detalle)).toEqual([prod.id]);
      expect(tipos(compra.items_detalle)).toEqual([NO_MUEVE]);
      close(await stockDe(page, prod.sku), 7, 'el stock del producto no cambia');
    } finally {
      await deleteMovement(page, 'compras_eliminar', idCompra);
    }
  });

  test('UI · Nueva Venta y Nuevo Presupuesto muestran el selector por renglón', async ({ page }) => {
    await requireMutations(test, page);
    const prod = await producto(page, 'TIPO-MOV-UI-VENTA', { stock: 1, cost: 100, price: 200 });

    await gotoPanelReady(page, '/panel/ventas', page.getByRole('button', { name: /Nueva Venta/i }).first());
    await page.getByRole('button', { name: /Nueva Venta/i }).first().click();
    const venta = await waitDialog(page, 'Nueva Venta');
    const vRow = venta.getByTestId('venta-row').first();
    await expect(vRow.getByTestId('tipo-movimiento-stock')).toHaveValue(MUEVE);
    await expect(vRow.getByTestId('tipo-movimiento-stock').locator('option')).toHaveText(['MUEVE STOCK', 'NO MUEVE STOCK']);
    await vRow.getByTestId('tipo-movimiento-stock').selectOption(NO_MUEVE);
    await selectProduct(vRow, prod.name);
    // Stock 1: con NO MUEVE STOCK la cantidad no se limita a las existencias.
    const qty = vRow.locator('input[type="number"]').first();
    await qty.fill('4');
    await qty.blur();
    await expect(qty).toHaveValue('4');
    await venta.getByRole('button', { name: 'Cerrar' }).first().click();
    await expect(venta).toBeHidden();

    await gotoPanelReady(page, '/panel/presupuesto', page.getByTitle('Crear nuevo presupuesto'));
    await page.getByTitle('Crear nuevo presupuesto').click();
    const pres = await waitDialog(page, 'Nuevo presupuesto');
    const pRow = pres.getByTestId('presupuesto-row').first();
    await expect(pRow.getByTestId('tipo-movimiento-stock')).toHaveValue(MUEVE);
    await pRow.getByTestId('tipo-movimiento-stock').selectOption(NO_MUEVE);
    await selectProduct(pRow, prod.name);
    await expect(pRow.locator('input[placeholder*="producto" i]').first()).toHaveValue(new RegExp(prod.name.slice(0, 10)));
    await pres.getByRole('button', { name: /Cancelar/i }).click();
    await expect(pres).toBeHidden();
  });
});
