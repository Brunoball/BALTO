import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { uniqueName, todayISO } from '../support/data.js';
import { createServiceArticleFixture, getServiceStock } from '../support/services.js';
import {
  calculateAmounts,
  concurrentAuthenticatedApi,
  createParty,
  deleteSale,
  expectExactlyOneSuccess,
  findAccountCurrentType,
  getLists,
  internalIntegrity,
} from './support/internal-api.js';

test('@internal @concurrency stock: dos ventas simultáneas no pueden consumir dos veces la misma existencia', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);

  const client = await createParty(page, 'client', uniqueName('INT-CONC-CLIENT', 120));
  const productName = uniqueName('INT-CONC-STOCK', 120);
  const product = await createServiceArticleFixture(page, {
    type: 'PRODUCTO', name: productName, stock: 5, cost: 10, price: 25, ivaPct: 0,
  });
  const lists = await getLists(page, 'ventas');
  const typeId = findAccountCurrentType(lists);
  const amounts = calculateAmounts(4, 25, 0);
  const makeBody = (suffix) => ({
    fecha: todayISO(),
    id_tipo_venta: typeId,
    id_cliente: client.id,
    items: [{
      fecha: todayISO(),
      id_tipo_venta: typeId,
      id_cliente: client.id,
      id_articulo: Number(product.id_articulo),
      id_stock_producto: Number(product.id_articulo),
      descripcion: `${productName}-${suffix}`,
      cantidad: 4,
      precio: 25,
      iva_pct: 0,
      total: amounts.total,
    }],
    medios_pago: [],
  });

  const results = await concurrentAuthenticatedApi(page, [
    { action: 'ventas_crear_batch', options: { method: 'POST', body: makeBody('A') } },
    { action: 'ventas_crear_batch', options: { method: 'POST', body: makeBody('B') } },
  ]);

  const { success, failure } = expectExactlyOneSuccess(results, 'concurrencia de stock');
  expect(String(failure.body?.mensaje || failure.body?.message || '')).toMatch(/stock insuficiente|disponible|cambió|conflict/i);
  expect(await getServiceStock(page, productName)).toBeCloseTo(1, 6);

  const saleId = Number(success.body?.id_movimiento || success.body?.ids?.[0] || 0);
  expect(saleId).toBeGreaterThan(0);
  const removed = await deleteSale(page, saleId);
  expect(removed.status, removed.text).toBeLessThan(400);
  expect(await getServiceStock(page, productName)).toBeCloseTo(5, 6);

  const audit = await internalIntegrity(page, 'prefix');
  expect(audit.integridad_ok, JSON.stringify(audit.checks_fallidos || [])).toBe(true);
});
