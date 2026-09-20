import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { uniqueName } from '../support/data.js';
import {
  createServiceArticleFixture,
  getServiceStock,
  serviciosApi,
} from '../support/services.js';
import { expectApiSuccess } from '../support/api.js';
import {
  createMultiItemCreditSale,
  createParty,
  internalIntegrity,
} from './support/internal-api.js';

async function history(page, id) {
  const body = expectApiSuccess(
    await serviciosApi(page, 'servicios_stock_historial', { query: { id_articulo: Number(id), limit: 500 } }),
    `No se pudo leer historial de stock #${id}`,
  );
  return Array.isArray(body?.historial) ? body.historial : [];
}

test('@internal @transactions rollback: si el segundo artículo falla por stock, no queda ni movimiento ni impacto parcial del primero', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);

  const client = await createParty(page, 'client', uniqueName('INT-ROLLBACK-CLIENT', 120));
  const firstName = uniqueName('INT-RB-STOCK-OK', 120);
  const secondName = uniqueName('INT-RB-STOCK-FAIL', 120);
  const first = await createServiceArticleFixture(page, { type: 'PRODUCTO', name: firstName, stock: 10, cost: 10, price: 20, ivaPct: 0 });
  const second = await createServiceArticleFixture(page, { type: 'PRODUCTO', name: secondName, stock: 1, cost: 10, price: 20, ivaPct: 0 });

  const beforeFirstHistory = await history(page, first.id_articulo);
  const beforeSecondHistory = await history(page, second.id_articulo);

  const failed = await createMultiItemCreditSale(page, {
    clientId: client.id,
    items: [
      { articleId: first.id_articulo, description: firstName, quantity: 2, price: 20, ivaPct: 0 },
      { articleId: second.id_articulo, description: secondName, quantity: 5, price: 20, ivaPct: 0 },
    ],
  });

  expect(failed.status, failed.text).toBeGreaterThanOrEqual(400);
  expect(String(failed.body?.mensaje || failed.body?.message || '')).toMatch(/stock insuficiente|disponible/i);

  expect(await getServiceStock(page, firstName)).toBeCloseTo(10, 6);
  expect(await getServiceStock(page, secondName)).toBeCloseTo(1, 6);
  expect(await history(page, first.id_articulo)).toHaveLength(beforeFirstHistory.length);
  expect(await history(page, second.id_articulo)).toHaveLength(beforeSecondHistory.length);

  const audit = await internalIntegrity(page, 'prefix');
  expect(audit.integridad_ok, JSON.stringify(audit.checks_fallidos || [])).toBe(true);
});
