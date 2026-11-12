import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { todayISO, uniqueName, uniqueSku } from './support/data.js';
import { requireMutations } from './support/ui.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { getStockProductBySku, getDefaultStockUnit } from './support/stock-units.js';

/**
 * BALTO Comercio · Compras → PRECIO DE COSTO (política "última compra cronológica").
 *
 * Adaptación del test 60 de BALTO Servicios a productos y variantes de Comercio.
 * Regla vigente de Comercio (StockPriceReviewService::sincronizarCostosUltimaCompra):
 * el PRECIO DE COSTO de cada producto/variante es el precio unitario de su compra
 * más reciente por fecha comercial. Mejora incorporada: el costo sólo se reescribe
 * cuando la operación cambia CUÁL es la última compra o SU precio; así un costo
 * cargado a mano después no se pisa al editar cantidades, registrar compras
 * retroactivas o tocar compras anteriores.
 *
 * Mutaciones reales SÓLO en el tenant E2E (requireMutations). El proveedor lleva el
 * RUN_PREFIX: el limpiador E2E elimina sus compras y los productos PW-*.
 */

const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function listas(page) {
  const body = expectApiSuccess(await authenticatedApi(page, 'global_obtener_listas', { query: { contexto: 'compras' } }));
  return body?.listas || body?.data || body;
}

async function precios(page, idProducto, idVariante = null) {
  const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_obtener', {
    query: { id_stock_producto: idProducto, ...(idVariante ? { id_stock_variante: idVariante } : {}), _: Date.now() },
  }));
  return body?.precios || body?.data?.precios || [];
}

async function costo(page, idProducto, idVariante = null) {
  const fila = (await precios(page, idProducto, idVariante)).find((p) => /COSTO/i.test(String(p.tipo_nombre || p.nombre || '')));
  return fila ? amount(fila.monto) : null;
}

async function precioVenta(page, idProducto, idVariante = null) {
  const filas = (await precios(page, idProducto, idVariante)).filter((p) => !/COSTO/i.test(String(p.tipo_nombre || p.nombre || '')));
  return filas.map((p) => `${p.id_tipo_precio_stock}:${amount(p.monto).toFixed(2)}`).sort().join('|');
}

/** Cambio manual del PRECIO DE COSTO, igual que el editor de precios de Stock. */
async function costoManual(page, idProducto, monto) {
  const propios = (await precios(page, idProducto)).filter((p) => !Number(p.heredado));
  const payload = propios.map((p) => ({
    id_tipo_precio_stock: p.id_tipo_precio_stock,
    monto: /COSTO/i.test(String(p.tipo_nombre || '')) ? Number(monto).toFixed(2) : amount(p.monto).toFixed(2),
    margen_porcentaje: p.margen_porcentaje,
    margen_valor: p.margen_valor,
  }));
  expectApiSuccess(await authenticatedApi(page, 'stock_precio_guardar', {
    method: 'POST',
    body: { id_stock_producto: idProducto, precios: JSON.stringify(payload) },
  }), 'No se pudo guardar el costo manual');
}

async function stockProducto(page, sku) {
  const p = await getStockProductBySku(page, sku);
  return amount(p.stock ?? p.stock_actual);
}

function fila(idProducto, precio, cantidad = 1, idVariante = null) {
  return { id_stock_producto: idProducto, ...(idVariante ? { id_stock_variante: idVariante } : {}), cantidad, precio, iva_pct: 0 };
}

test.describe('@compras @costos @mutations compras actualizan el PRECIO DE COSTO sin pisar cambios manuales', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(6 * 60_000);

  test('producto simple: alta, cantidad, retroactiva, histórica, eliminación e historial', async ({ page }) => {
    await requireMutations(test, page);
    const l = await listas(page);
    const cc = (l.tipos_venta || []).find((t) => /CUENTA\s*CORRIENTE/i.test(String(t.nombre || '')));
    expect(cc, 'Se necesita la forma CUENTA CORRIENTE').toBeTruthy();
    const idTipoVenta = Number(cc.id_tipo_venta || cc.id);
    const proveedorNombre = uniqueName('PROV-COSTO', 60);

    const sku = uniqueSku('COSTO');
    await createStockProductFixture(page, { name: uniqueName('COSTO-ULTIMA-COMPRA'), sku, stock: 0, cost: 100, price: 190 });
    const prod = await getStockProductBySku(page, sku);
    const id = Number(prod.id_stock_producto);
    const ventaInicial = await precioVenta(page, id);
    close(await costo(page, id), 100, 'Costo inicial del fixture');

    const hoy = todayISO();
    const ayer = addDaysISO(hoy, -1);
    const hace10 = addDaysISO(hoy, -10);
    let idProveedor = null;
    const crear = async (fecha, items) => {
      const body = expectApiSuccess(await authenticatedApi(page, 'compras_crear_batch', {
        method: 'POST',
        body: { fecha, id_tipo_venta: idTipoVenta, ...(idProveedor ? { id_proveedor: idProveedor } : { proveedor_nombre: proveedorNombre }), items },
      }));
      const idMov = Number(body.id_movimiento || body.id_compra || body.data?.id_movimiento);
      if (!idProveedor) {
        const compra = expectApiSuccess(await authenticatedApi(page, 'compras_obtener', { query: { id_movimiento: idMov } }));
        idProveedor = Number((compra.compra || compra.data?.compra).id_proveedor);
      }
      return idMov;
    };
    const editar = async (idMov, fecha, items) => expectApiSuccess(await authenticatedApi(page, 'compras_actualizar', {
      method: 'POST', body: { id_movimiento: idMov, fecha, id_tipo_venta: idTipoVenta, id_proveedor: idProveedor, items },
    }));
    const eliminar = async (idMov) => expectApiSuccess(await authenticatedApi(page, 'compras_eliminar', { method: 'POST', body: { id_movimiento: idMov } }));

    // 1-2 · compra con costo distinto → costo = precio unitario; stock y venta.
    const a = await crear(ayer, [fila(id, 125, 2)]);
    close(await costo(page, id), 125, '1 · la compra actualiza el costo');
    close(await stockProducto(page, sku), 2, '1 · la compra suma stock');
    expect(await precioVenta(page, id), '10 · precio de venta intacto').toBe(ventaInicial);

    // 9 · historial de costo.
    const hist = expectApiSuccess(await authenticatedApi(page, 'stock_precios_historial_producto', { query: { id_stock_producto: id } }));
    const items = hist.items || hist.data?.items || [];
    expect(items.some((h) => Math.abs(amount(h.precio_nuevo) - 125) < 0.01 && /COSTO/i.test(String(h.tipo_precio_nombre || h.tipo_nombre || 'COSTO'))), '9 · historial registra 125').toBeTruthy();

    // 6 · cambio manual posterior.
    await costoManual(page, id, 145);
    close(await costo(page, id), 145, 'Costo manual guardado');

    // 5 · editar sólo la cantidad: conserva el costo manual; el stock se ajusta.
    await editar(a, ayer, [fila(id, 125, 3)]);
    close(await costo(page, id), 145, '5 · editar sólo la cantidad no pisa el costo manual');
    close(await stockProducto(page, sku), 3, '5 · stock ajustado');

    // 7 · compra con fecha anterior a la última: no pisa el costo vigente.
    const b = await crear(hace10, [fila(id, 90, 1)]);
    close(await costo(page, id), 145, '7 · compra retroactiva no pisa el costo vigente');
    // 7 · editar el precio de esa compra histórica tampoco.
    await editar(b, hace10, [fila(id, 95, 1)]);
    close(await costo(page, id), 145, '7 · editar una compra histórica no pisa el costo vigente');
    // 8 · eliminar una compra anterior: conserva el costo.
    await eliminar(b);
    close(await costo(page, id), 145, '8 · eliminar una compra anterior conserva el costo');
    close(await stockProducto(page, sku), 3, '8 · eliminar revierte sólo su stock');

    // 4 · cambiar realmente el precio unitario de la última compra: actualiza.
    await editar(a, ayer, [fila(id, 130, 3)]);
    close(await costo(page, id), 130, '4 · cambiar el precio de la última compra actualiza el costo');

    // 8 · eliminar la última compra: se recalcula con la anterior (regla vigente).
    const c = await crear(hoy, [fila(id, 140, 1)]);
    close(await costo(page, id), 140, 'Compra más reciente');
    await eliminar(c);
    close(await costo(page, id), 130, '8 · eliminar la última compra vuelve al costo de la compra anterior');
    expect(await precioVenta(page, id), '10 · precio de venta intacto al final').toBe(ventaInicial);
    await eliminar(a);
  });

  test('variantes: la compra de una variante no cambia otra variante ni el producto', async ({ page }) => {
    await requireMutations(test, page);
    const l = await listas(page);
    const cc = (l.tipos_venta || []).find((t) => /CUENTA\s*CORRIENTE/i.test(String(t.nombre || '')));
    const idTipoVenta = Number(cc.id_tipo_venta || cc.id);
    const unit = await getDefaultStockUnit(page);
    const sku = uniqueSku('COSTOVAR');
    await createStockProductFixture(page, {
      name: uniqueName('COSTO-VARIANTES'), sku, stock: 0, cost: 50, price: 99, unitId: Number(unit.id_stock_unidad),
      variants: [
        { nombre_variante: 'ROJA', sku: `${sku}R`, stock: 0, unitId: Number(unit.id_stock_unidad), atributos: [{ atributo: 'COLOR', valor: 'ROJA' }] },
        { nombre_variante: 'AZUL', sku: `${sku}A`, stock: 0, unitId: Number(unit.id_stock_unidad), atributos: [{ atributo: 'COLOR', valor: 'AZUL' }] },
      ],
    });
    const prod = await getStockProductBySku(page, sku);
    const id = Number(prod.id_stock_producto);
    const vars = expectApiSuccess(await authenticatedApi(page, 'stock_variantes_listar', { query: { id_stock_producto: id, activo: 'todos' } }));
    const variantes = vars.variantes || vars.data?.variantes || [];
    const roja = variantes.find((v) => String(v.sku) === `${sku}R`);
    const azul = variantes.find((v) => String(v.sku) === `${sku}A`);
    expect(roja && azul, 'Variantes creadas').toBeTruthy();

    const costoAzulAntes = await costo(page, id, azul.id_stock_variante);
    const costoBaseAntes = await costo(page, id);
    const ventaAntes = await precioVenta(page, id);

    const res = expectApiSuccess(await authenticatedApi(page, 'compras_crear_batch', {
      method: 'POST',
      body: { fecha: todayISO(), id_tipo_venta: idTipoVenta, proveedor_nombre: uniqueName('PROV-COSTO-VAR', 60), items: [fila(id, 60, 2, Number(roja.id_stock_variante))] },
    }));
    const idMov = Number(res.id_movimiento || res.id_compra);
    close(await costo(page, id, roja.id_stock_variante), 60, '3 · costo de la variante comprada');
    close(await costo(page, id, azul.id_stock_variante), costoAzulAntes, '3 · otra variante conserva su costo');
    close(await costo(page, id), costoBaseAntes, '3 · el costo base del producto no cambia');
    expect(await precioVenta(page, id), '10 · precio de venta del producto intacto').toBe(ventaAntes);
    const varsDespues = expectApiSuccess(await authenticatedApi(page, 'stock_variantes_listar', { query: { id_stock_producto: id, activo: 'todos' } }));
    const vd = varsDespues.variantes || varsDespues.data?.variantes || [];
    close(vd.find((v) => v.id_stock_variante === roja.id_stock_variante)?.stock, 2, '10 · stock sólo en la variante comprada');
    close(vd.find((v) => v.id_stock_variante === azul.id_stock_variante)?.stock, 0, '10 · la otra variante no suma stock');
    await authenticatedApi(page, 'compras_eliminar', { method: 'POST', body: { id_movimiento: idMov } });
  });
});
