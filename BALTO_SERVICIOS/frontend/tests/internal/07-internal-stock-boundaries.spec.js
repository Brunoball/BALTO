import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { uniqueName } from '../support/data.js';
import {
  adjustServiceStock,
  createServiceArticleFixture,
  getServiceStock,
  serviciosApi,
} from '../support/services.js';
import { expectApiSuccess } from '../support/api.js';
import {
  createManualCreditSale,
  createParty,
  deleteSale,
  internalIntegrity,
} from './support/internal-api.js';

test('@internal @stock límite exacto: vender toda la existencia deja cero y eliminar restaura exactamente el stock', async ({ page }) => {
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-STOCK-ZERO-CLI', 120));
  const name = uniqueName('INT-STOCK-ZERO', 120);
  const article = await createServiceArticleFixture(page, {
    type: 'PRODUCTO', name, stock: 5, cost: 10, price: 20, ivaPct: 0,
  });

  const sale = await createManualCreditSale(page, {
    clientId: client.id, articleId: article.id_articulo, quantity: 5, price: 20, ivaPct: 0,
    description: name,
  });
  expect(await getServiceStock(page, name)).toBeCloseTo(0, 6);

  const removed = await deleteSale(page, sale.id);
  expect(removed.status, removed.text).toBeLessThan(400);
  expect(await getServiceStock(page, name)).toBeCloseTo(5, 6);
});

test('@internal @stock límite negativo: una unidad por encima de la existencia se rechaza sin impacto parcial', async ({ page }) => {
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-STOCK-NEG-CLI', 120));
  const name = uniqueName('INT-STOCK-NEG', 120);
  const article = await createServiceArticleFixture(page, {
    type: 'PRODUCTO', name, stock: 5, cost: 10, price: 20, ivaPct: 0,
  });

  const attempt = await createManualCreditSale(page, {
    clientId: client.id, articleId: article.id_articulo, quantity: 6, price: 20, ivaPct: 0,
    description: name, expectFailure: true,
  });
  expect(attempt.result.status).toBeGreaterThanOrEqual(400);
  expect(String(attempt.result.body?.mensaje || attempt.result.body?.message || '')).toMatch(/stock insuficiente|disponible/i);
  expect(await getServiceStock(page, name)).toBeCloseTo(5, 6);
});

test('@internal @stock historial: SUMAR, RESTAR y ESTABLECER mantienen aritmética y continuidad fila por fila', async ({ page }) => {
  await requireMutations(test, page);
  const name = uniqueName('INT-STOCK-HISTORY', 120);
  const article = await createServiceArticleFixture(page, {
    type: 'PRODUCTO', name, stock: 10, cost: 10, price: 20, ivaPct: 0,
  });

  await adjustServiceStock(page, article.id_articulo, { operation: 'SUMAR', quantity: 3, reason: uniqueName('INT-SUMAR', 80) });
  await adjustServiceStock(page, article.id_articulo, { operation: 'RESTAR', quantity: 4, reason: uniqueName('INT-RESTAR', 80) });
  await adjustServiceStock(page, article.id_articulo, { operation: 'ESTABLECER', quantity: 12, reason: uniqueName('INT-ESTABLECER', 80) });
  expect(await getServiceStock(page, name)).toBeCloseTo(12, 6);

  const body = expectApiSuccess(
    await serviciosApi(page, 'servicios_stock_historial', { query: { id_articulo: article.id_articulo, limit: 200 } }),
    'No se pudo obtener historial interno de stock',
  );
  const rows = Array.isArray(body?.historial) ? body.historial : [];
  expect(rows.length).toBeGreaterThanOrEqual(4);

  for (const row of rows) {
    const previous = Number(row?.cantidad_anterior || 0);
    const delta = Number(row?.cantidad_movimiento || 0);
    const next = Number(row?.cantidad_nueva || 0);
    expect(previous + delta, `Historial #${row?.id_stock_movimiento}`).toBeCloseTo(next, 6);
  }

  const audit = await internalIntegrity(page, 'prefix');
  expect(audit.integridad_ok, JSON.stringify(audit.checks_fallidos || [])).toBe(true);
});
