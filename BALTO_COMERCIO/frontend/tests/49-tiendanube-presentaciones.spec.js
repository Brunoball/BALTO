import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { requireMutations } from './support/ui.js';
import { listStockUnits } from './support/stock-units.js';

// Requiere migración de presentaciones en DB tenant. No llama Tienda Nube real:
// fixture persistido PW- es detectado por el backend y jamás publicado.
test('@stock @tiendanube @presentaciones @critical configurar 500 g conserva stock en kg y calcula paquetes enteros', async ({ page }) => {
  await requireMutations(test, page);
  const units = await listStockUnits(page, 'todos');
  const kg = units.find(u => String(u.nombre).toUpperCase() === 'KILOGRAMO');
  expect(kg).toBeTruthy();
  const name = uniqueName('TN-PAQUETES');
  let created = false;
  try {
    const body = await createStockProductFixture(page, { name, sku: uniqueSku('TPRES'), stock: 2.75, cost: 100, price: 200, unitId: Number(kg.id_stock_unidad) });
    created = true;
    const id = Number(body?.producto?.id_stock_producto ?? body?.data?.producto?.id_stock_producto ?? 0);
    expect(id).toBeGreaterThan(0);
    const before = expectApiSuccess(await authenticatedApi(page, 'stock_tn_presentaciones_consultar', { query: { id_stock_producto: id } }));
    expect(Number(before?.presentaciones?.[0]?.cantidad_local_por_unidad_tn)).toBe(1);
    expect(Number(before?.presentaciones?.[0]?.stock_publicable_tn)).toBe(2);

    const saved = expectApiSuccess(await authenticatedApi(page, 'stock_tn_presentaciones_guardar', {
      method: 'POST', body: { id_stock_producto: id, id_stock_variante: 0, cantidad_local: 0.5 },
    }));
    expect(Number(saved?.presentaciones?.[0]?.cantidad_local_por_unidad_tn)).toBeCloseTo(0.5, 3);
    expect(Number(saved?.presentaciones?.[0]?.stock_publicable_tn)).toBe(5);
    expect(Number(saved?.tiendanube_sync?.encolados || 0)).toBe(0);

    const invalid = await authenticatedApi(page, 'stock_tn_presentaciones_guardar', {
      method: 'POST', body: { id_stock_producto: id, id_stock_variante: 0, cantidad_local: 0 },
    });
    expect(invalid.status).toBeGreaterThanOrEqual(400);

    const afterProduct = expectApiSuccess(await authenticatedApi(page, 'stock_producto_obtener', { query: { id_stock_producto: id } }));
    expect(Number(afterProduct?.producto?.stock ?? afterProduct?.data?.producto?.stock)).toBeCloseTo(2.75, 3);
    expect(Number(afterProduct?.producto?.id_stock_unidad ?? afterProduct?.data?.producto?.id_stock_unidad)).toBe(Number(kg.id_stock_unidad));
  } finally {
    if (created) await deleteUnusedStockProduct(page, name);
  }
});
