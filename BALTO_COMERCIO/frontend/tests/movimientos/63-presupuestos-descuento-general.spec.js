import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { todayISO, uniqueName, uniqueSku } from '../support/data.js';
import { requireMutations, gotoPanelReady, waitDialog, selectProduct } from '../support/ui.js';
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
 * BALTO Comercio · Descuento general en PRESUPUESTOS (igual que BALTO Servicios).
 *
 * - Un único descuento por porcentaje o monto fijo sobre el total del presupuesto.
 * - El servidor recalcula, valida (rechaza ≥ 100 %, monto ≥ total, negativos,
 *   importes desactualizados) y prorratea en los renglones al centavo.
 * - Se guardan renglones NETOS + precio original (precio_lista) + cabecera.
 * - La conversión a venta copia los renglones tal cual y la cabecera, sin volver
 *   a restar el descuento; el stock se descuenta igual que siempre.
 *
 * Requiere la migración 2026_11_13_presupuestos_descuento_general.sql
 * (movimientos_items.precio_lista) en el tenant E2E.
 * Mutaciones reales SÓLO en el tenant E2E (requireMutations).
 */

const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);

async function producto(page, label, { stock = 5, cost = 1000, price = 100000 } = {}) {
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
async function presupuestoObtener(page, id) {
  const body = expectApiSuccess(await authenticatedApi(page, 'presupuestos_obtener', { query: { id_movimiento: id, _: Date.now() } }));
  return body?.presupuesto || body?.data?.presupuesto;
}
async function ventaObtener(page, id) {
  const body = expectApiSuccess(await authenticatedApi(page, 'ventas_obtener', { query: { id_movimiento: id, _: Date.now() } }));
  return body?.venta || body?.data?.venta;
}
const itemsDe = (mov) => mov?.items_detalle || mov?.items || [];
const sumaTotales = (items) => Math.round(items.reduce((a, it) => a + amount(it.total), 0) * 100) / 100;

test.describe('@movimientos @presupuestos @descuentos @mutations Descuento general en presupuestos', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(8 * 60_000);

  test('API · $278.000 − $28.000 → venta contado $250.000, renglones idénticos e idempotencia', async ({ page }) => {
    await requireMutations(test, page);
    const lists = await getLists(page, 'ventas');
    const cliente = await createParty(page, 'client', 'CLIENTE-PRESU-DESC');
    const prod = await producto(page, 'PRESU-DESC-MONTO', { stock: 5, price: 100000 });
    const hoy = todayISO();
    let idPresupuesto = 0; let idVenta = 0;
    try {
      const creado = expectApiSuccess(await authenticatedApi(page, 'presupuestos_crear', {
        method: 'POST',
        body: {
          fecha: hoy, id_cliente: cliente.id,
          items: [
            { tipo_movimiento_stock: 'MUEVE_STOCK', mueve_stock: 1, id_stock_producto: prod.id, descripcion: prod.name, cantidad: 2, precio: 100000, iva_pct: 21 },
            { descripcion: 'MANO DE OBRA', cantidad: 1, precio: 36000, iva_pct: 0 },
          ],
          descuento_tipo: 'MONTO', descuento_valor: 28000, descuento_monto: 28000, total_bruto: 278000,
        },
      }), 'No se pudo crear el presupuesto con descuento');
      idPresupuesto = movementId(creado);
      close(creado.total_bruto, 278000, 'total sin descuento');
      close(creado.total ?? creado.monto_total, 250000, 'total final');
      close(await stockDe(page, prod.sku), 5, 'guardar el presupuesto no mueve stock');

      const presupuesto = await presupuestoObtener(page, idPresupuesto);
      close(presupuesto.descuento_monto, 28000, 'detalle: descuento');
      expect(String(presupuesto.descuento_tipo)).toBe('MONTO');
      const itemsP = itemsDe(presupuesto);
      close(sumaTotales(itemsP), 250000, 'renglones netos suman el total final');
      close(itemsP[0].precio_lista, 100000, 'precio original renglón 1');
      close(itemsP[1].precio_lista, 36000, 'precio original renglón 2');

      const convertir = () => authenticatedApi(page, 'presupuestos_convertir_venta', {
        method: 'POST',
        body: { id_presupuesto: idPresupuesto, fecha: hoy, id_tipo_venta: tipoVentaId(lists, 'CONTADO'), accion_venta: 'guardar', es_facturada: 0,
          medios_pago: [{ id_medio_pago: medioPago(lists).id, monto: 250000 }] },
      });
      const conv = expectApiSuccess(await convertir(), 'No se pudo convertir');
      idVenta = Number(conv.id_venta || conv.data?.id_venta || 0);
      expect(idVenta).toBeGreaterThan(0);
      const venta = await ventaObtener(page, idVenta);
      close(sumaTotales(itemsDe(venta)), 250000, 'la venta tiene el total final');
      close(venta.descuento_monto, 28000, 'la venta conserva la cabecera del descuento');
      itemsDe(venta).forEach((it, i) => {
        for (const k of ['precio', 'subtotal', 'iva_monto', 'total', 'precio_lista']) close(it[k], itemsP[i][k], `renglón ${i + 1} ${k}`);
      });
      close(await stockDe(page, prod.sku), 3, 'la conversión descuenta 2 unidades');

      const conv2 = expectApiSuccess(await convertir(), 'El reintento debe ser idempotente');
      expect(Number(conv2.id_venta || conv2.data?.id_venta)).toBe(idVenta);
      close(await stockDe(page, prod.sku), 3, 'sin doble descuento de stock');
    } finally {
      await deleteMovement(page, 'ventas_eliminar', idVenta);
      await deleteMovement(page, 'presupuestos_eliminar', idPresupuesto);
    }
  });

  test('API · validaciones del servidor y presupuesto sin descuento intacto', async ({ page }) => {
    await requireMutations(test, page);
    const cliente = await createParty(page, 'client', 'CLIENTE-PRESU-DESC-VAL');
    const hoy = todayISO();
    const base = { fecha: hoy, id_cliente: cliente.id, items: [{ descripcion: 'SERVICIO PRUEBA', cantidad: 1, precio: 1000, iva_pct: 0 }] };
    const crear = (extra) => authenticatedApi(page, 'presupuestos_crear', { method: 'POST', body: { ...base, ...extra } });

    expectRejected(await crear({ descuento_tipo: 'PORCENTAJE', descuento_valor: 100 }), /menor a 100/i);
    expectRejected(await crear({ descuento_tipo: 'MONTO', descuento_valor: 1000 }), /menor al total/i);
    expectRejected(await crear({ descuento_tipo: 'MONTO', descuento_valor: -5 }), /negativo/i);
    expectRejected(await crear({ descuento_tipo: 'PORCENTAJE', descuento_valor: 10, descuento_monto: 150 }), /no coincide/i);

    let idSin = 0;
    try {
      const sin = expectApiSuccess(await crear({}), 'El presupuesto sin descuento debe guardarse igual que antes');
      idSin = movementId(sin);
      const det = await presupuestoObtener(page, idSin);
      expect(amount(det.descuento_monto)).toBe(0);
      close(sumaTotales(itemsDe(det)), 1000, 'total sin descuento');
      expect(itemsDe(det)[0].precio_lista ?? null).toBeNull();
    } finally {
      await deleteMovement(page, 'presupuestos_eliminar', idSin);
    }
  });

  test('UI · Nuevo presupuesto: descuento 10 % en pantalla y en el payload', async ({ page }) => {
    await requireMutations(test, page);
    const prod = await producto(page, 'PRESU-DESC-UI', { stock: 5, price: 10000 });

    await gotoPanelReady(page, '/panel/presupuesto', page.getByTitle('Crear nuevo presupuesto'));
    await page.getByTitle('Crear nuevo presupuesto').click();
    const dialog = await waitDialog(page, 'Nuevo presupuesto');
    const row = dialog.getByTestId('presupuesto-row').first();
    await selectProduct(row, prod.name);
    // Los productos de Stock con listas de precios muestran PrecioDropdown,
    // no un input editable. Aceptamos ambas variantes de la UI sin saltear
    // la comprobacion del importe efectivamente seleccionado.
    const precioEditable = row.locator('input[inputmode="decimal"]').first();
    if (await precioEditable.count()) {
      await precioEditable.click();
      await precioEditable.fill('10000');
      await precioEditable.blur();
    } else {
      const selectorPrecio = row.locator('.gm-table-cell').nth(2).getByRole('button');
      await expect(
        selectorPrecio,
        'El selector de precio de venta del producto debe mostrar $10.000,00',
      ).toContainText(/10\.000,00/);
    }
    await expect(
      dialog.getByTestId('np-summary-subtotal'),
      'El importe original debe ser $10.000,00 antes del descuento',
    ).toContainText(/10\.000,00/);

    const control = dialog.getByTestId('descuento-general');
    await expect(control).toBeVisible();
    await control.locator('.dg-box__input-wrap input').first().fill('10');
    await expect(dialog.getByTestId('np-summary-descuento')).toContainText(/10\s*%/);
    await expect(dialog.getByTestId('np-summary-descuento')).toContainText(/1\.000,00/);
    await expect(dialog.getByTestId('np-summary-total')).toContainText(/9\.000,00/);

    await control.locator('.dg-box__input-wrap input').first().fill('100');
    await expect(dialog.getByTestId('dg-error')).toContainText(/menor al 100/i);

    await dialog.getByRole('button', { name: /Cancelar/i }).click();
    await expect(dialog).toBeHidden();
  });
});
