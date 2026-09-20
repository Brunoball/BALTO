import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { uniqueName } from '../support/data.js';
import { expectApiSuccess } from '../support/api.js';
import { createServiceArticleFixture, getServiceStock } from '../support/services.js';
import {
  calculateAmounts,
  createManualCreditSale,
  createMultiItemCreditSale,
  createParty,
  extractMovementId,
  getCurrentAccount,
  getSaleDetail,
  internalIntegrity,
  payCreditSale,
} from './support/internal-api.js';

test('@internal @accounting multiítem: distintos IVA suman exactamente y cada stock descuenta su cantidad', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-MULTI-CLI', 120));

  const definitions = [
    { q: 1, price: 100.01, iva: 21 },
    { q: 2, price: 55.55, iva: 10.5 },
    { q: 3, price: 7.77, iva: 0 },
  ];
  const items = [];
  let expectedTotal = 0;
  for (let i = 0; i < definitions.length; i += 1) {
    const row = definitions[i];
    const name = uniqueName(`INT-MULTI-P${i + 1}`, 120);
    const article = await createServiceArticleFixture(page, { type: 'PRODUCTO', name, stock: 10, cost: 1, price: row.price, ivaPct: row.iva });
    items.push({ articleId: article.id_articulo, description: name, quantity: row.q, price: row.price, ivaPct: row.iva, name });
    expectedTotal += calculateAmounts(row.q, row.price, row.iva).total;
  }
  expectedTotal = Number(expectedTotal.toFixed(2));

  const result = await createMultiItemCreditSale(page, { clientId: client.id, items });
  const body = expectApiSuccess(result, 'No se pudo crear venta multiítem interna');
  const movementId = extractMovementId(body);
  expect(movementId).toBeGreaterThan(0);

  const detail = await getSaleDetail(page, movementId);
  const persisted = Array.isArray(detail?.items_detalle) ? detail.items_detalle : (Array.isArray(detail?.items) ? detail.items : []);
  const persistedTotal = Number(persisted.reduce((sum, row) => sum + Number(row?.total || 0), 0).toFixed(2));
  expect(persistedTotal).toBeCloseTo(expectedTotal, 2);

  for (const item of items) {
    expect(await getServiceStock(page, item.name)).toBeCloseTo(10 - item.quantity, 6);
  }

  const account = await getCurrentAccount(page, client.id);
  expect(Number(account?.totales?.debito || 0)).toBeCloseTo(expectedTotal, 2);
  expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(expectedTotal, 2);
});

test('@internal @stress secuencia determinista: muchas ventas y cobros mantienen el mismo saldo que un ledger independiente', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-STRESS-LEDGER-CLI', 120));
  const cases = [
    [1, 12.34, 21],
    [2, 18.75, 10.5],
    [3, 7.01, 0],
    [4, 11.11, 21],
    [1, 199.99, 10.5],
    [2, 33.33, 0],
  ];

  const sales = [];
  let debit = 0;
  for (let i = 0; i < cases.length; i += 1) {
    const [quantity, price, ivaPct] = cases[i];
    const sale = await createManualCreditSale(page, {
      clientId: client.id,
      quantity,
      price,
      ivaPct,
      description: uniqueName(`INT-STRESS-SALE-${i + 1}`, 120),
    });
    sales.push(sale);
    debit += sale.amounts.total;
  }

  const payments = [5, 12.50, 25.25, 50, 7.77];
  for (let i = 0; i < payments.length; i += 1) {
    await payCreditSale(page, { saleId: sales[i].id, clientId: client.id, amount: payments[i] });
  }

  debit = Number(debit.toFixed(2));
  const credit = Number(payments.reduce((a, b) => a + b, 0).toFixed(2));
  const expected = Number((debit - credit).toFixed(2));
  const account = await getCurrentAccount(page, client.id);
  expect(Number(account?.totales?.debito || 0)).toBeCloseTo(debit, 2);
  expect(Number(account?.totales?.credito || 0)).toBeCloseTo(credit, 2);
  expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(expected, 2);

  const rowModel = Number((account?.rows || []).reduce((sum, row) => sum + Number(row?.debito || 0) - Number(row?.credito || 0), 0).toFixed(2));
  expect(rowModel).toBeCloseTo(expected, 2);

  const audit = await internalIntegrity(page, 'prefix');
  expect(audit.integridad_ok, JSON.stringify(audit.checks_fallidos || [])).toBe(true);
});
