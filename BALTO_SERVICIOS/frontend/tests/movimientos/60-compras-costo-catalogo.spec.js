import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { uniqueName, todayISO } from '../support/data.js';
import { requireMutations } from '../support/ui.js';
import { planCan } from '../support/plan.js';
import {
  createServiceArticleFixture,
  getAnyServiceArticleByName,
  updateServiceArticleFixture,
} from '../support/services.js';

function movementId(response) {
  return Number(response?.id_movimiento ?? response?.id_compra ?? response?.data?.id_movimiento ?? response?.data?.id_compra ?? 0);
}

async function costAndSalePrice(page, name) {
  const item = await getAnyServiceArticleByName(page, name, { activo: 'todos' });
  expect(item, `Debe existir el artículo ${name}`).toBeTruthy();
  return { cost: Number(item.costo_unitario), sale: Number(item.precio_venta), stock: Number(item.stock_actual || 0) };
}

async function purchaseConfig(page) {
  const listsResponse = expectApiSuccess(await authenticatedApi(page, 'global_obtener_listas', {
    query: { contexto: 'compras', include_sin_stock: 1 },
  }));
  const lists = listsResponse?.listas || listsResponse;
  const provider = (lists.proveedores || []).find((p) => Number(p.activo ?? 1) !== 0);
  const credit = (lists.tipos_venta || []).find((t) => /CUENTA\s*CORRIENTE/i.test(String(t.nombre || '')));
  expect(provider, 'El fixture de compra necesita un proveedor activo').toBeTruthy();
  expect(credit, 'El fixture de compra necesita la forma CUENTA CORRIENTE').toBeTruthy();
  return {
    fecha: todayISO(),
    id_proveedor: Number(provider.id_proveedor || provider.id),
    id_tipo_venta: Number(credit.id_tipo_venta || credit.id),
  };
}

function purchaseRow(idArticulo, precio, cantidad = 2, idItem = null) {
  return {
    ...(idItem ? { id_item: idItem } : {}),
    tipo_item: 'ARTICULO',
    id_articulo: idArticulo,
    id_stock_producto: idArticulo,
    cantidad,
    precio,
    iva_pct: 0,
  };
}

async function readPurchase(page, id) {
  const body = expectApiSuccess(await authenticatedApi(page, 'compras_obtener', { query: { id_movimiento: id } }));
  const purchase = body.compra || body.data?.compra;
  expect(purchase).toBeTruthy();
  return purchase;
}

// Prueba con escrituras REALES sólo en el tenant E2E aislado (requireMutations).
// La limpieza automática se encarga del prefijo PW-* de los artículos y compras.
test('@compras @costos @mutations compra y edición actualizan costo sin sobrescribir cambios posteriores del catálogo', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await requireMutations(test, page);
  test.skip(!(await planCan(page, 'resources.manage')), 'Este plan no gestiona materiales/insumos.');

  const config = await purchaseConfig(page);
  const types = ['MATERIAL', 'INSUMO'];
  if (await planCan(page, 'products.manage')) types.push('PRODUCTO');

  for (const type of types) {
    const name = uniqueName(`COMPRA-COSTO-${type}`);
    const article = await createServiceArticleFixture(page, {
      type, name, cost: 100, price: 190, stock: 8, ivaPct: 0,
    });
    const idArticulo = Number(article.id_articulo);
    expect(await costAndSalePrice(page, name)).toMatchObject({ cost: 100, sale: 190 });

    const created = expectApiSuccess(await authenticatedApi(page, 'compras_crear_batch', {
      method: 'POST',
      body: { ...config, items: [purchaseRow(idArticulo, 125)] },
    }));
    const idCompra = movementId(created);
    expect(idCompra, 'La creación debe devolver ID de compra').toBeGreaterThan(0);
    expect(await costAndSalePrice(page, name)).toMatchObject({ cost: 125, sale: 190 });

    const original = await readPurchase(page, idCompra);
    const originalItem = original.items_detalle[0];
    expect(Number(originalItem.precio)).toBeCloseTo(125, 2);
    expect(Number(originalItem.costo_unitario_snapshot), 'La compra nueva debe congelar el costo nuevo').toBeCloseTo(125, 2);

    // Otra operación de catálogo actualizó el costo después de la compra.
    await updateServiceArticleFixture(page, name, { cost: 145 });
    expect(await costAndSalePrice(page, name)).toMatchObject({ cost: 145, sale: 190 });

    // Editar sólo la CANTIDAD de la compra vieja NO debe pisar el costo 145.
    expectApiSuccess(await authenticatedApi(page, 'compras_actualizar', {
      method: 'POST',
      body: {
        ...config, id_movimiento: idCompra,
        ids_items_originales: [Number(originalItem.id_item)], ids_items_eliminados: [],
        items: [purchaseRow(idArticulo, 125, 3, Number(originalItem.id_item))],
      },
    }));
    expect(await costAndSalePrice(page, name)).toMatchObject({ cost: 145, sale: 190 });

    // Cambiar el precio unitario de esa compra SÍ debe actualizar el costo vigente.
    const itemEditado = (await readPurchase(page, idCompra)).items_detalle[0];
    expectApiSuccess(await authenticatedApi(page, 'compras_actualizar', {
      method: 'POST',
      body: {
        ...config, id_movimiento: idCompra,
        ids_items_originales: [Number(itemEditado.id_item)], ids_items_eliminados: [],
        items: [purchaseRow(idArticulo, 115, 3, Number(itemEditado.id_item))],
      },
    }));
    expect(await costAndSalePrice(page, name)).toMatchObject({ cost: 115, sale: 190 });

    const historyResponse = expectApiSuccess(await authenticatedApi(page, 'servicios_articulo_historial_precios', {
      query: { id_articulo: idArticulo },
    }));
    const history = historyResponse.historial || historyResponse.data?.historial || [];
    expect(history.some((h) => Math.abs(Number(h.costo_unitario) - 115) < 0.01),
      `El historial de ${type} debe registrar el costo actualizado`).toBeTruthy();
  }
});
