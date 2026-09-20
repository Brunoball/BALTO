import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { uniqueName } from '../support/data.js';
import { createServiceArticleFixture } from '../support/services.js';
import { createPurchaseFixtureViaApi } from '../support/flows.js';
import {
  calculateAmounts,
  createParty,
  extractMovementId,
  getProviderCurrentAccount,
  internalIntegrity,
  payCreditPurchase,
} from './support/internal-api.js';

test('@internal @accounting proveedor: compra CC y pago parcial coinciden con modelo matemático independiente', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);

  const provider = await createParty(page, 'provider', uniqueName('INT-PROV-LEDGER', 120));
  const productName = uniqueName('INT-PROV-PROD', 120);
  await createServiceArticleFixture(page, {
    type: 'PRODUCTO', name: productName, stock: 0, cost: 99.99, price: 180, ivaPct: 10.5,
  });

  const purchaseBody = await createPurchaseFixtureViaApi(page, {
    providerName: provider.name,
    productName,
    quantity: 2,
    price: 99.99,
    ivaPct: 10.5,
  }, { mode: 'CUENTA_CORRIENTE' });
  const purchaseId = extractMovementId(purchaseBody);
  expect(purchaseId).toBeGreaterThan(0);

  const expected = calculateAmounts(2, 99.99, 10.5).total;
  await payCreditPurchase(page, { purchaseId, providerId: provider.id, amount: 50 });

  const account = await getProviderCurrentAccount(page, provider.id);
  expect(Number(account?.totales?.debito || 0)).toBeCloseTo(expected, 2);
  expect(Number(account?.totales?.credito || 0)).toBeCloseTo(50, 2);
  expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(expected - 50, 2);

  const recomputed = (account?.rows || []).reduce(
    (sum, row) => sum + Number(row?.debito || 0) - Number(row?.credito || 0),
    0,
  );
  expect(Number(recomputed.toFixed(2))).toBeCloseTo(expected - 50, 2);
});

test('@internal @accounting proveedor: varias compras y órdenes de pago preservan el saldo acumulado exacto', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);

  const provider = await createParty(page, 'provider', uniqueName('INT-PROV-SEQUENCE', 120));
  const productName = uniqueName('INT-PROV-SEQUENCE-PROD', 120);
  await createServiceArticleFixture(page, {
    type: 'PRODUCTO', name: productName, stock: 0, cost: 10, price: 20, ivaPct: 0,
  });

  const cases = [
    { q: 1, price: 120.15, iva: 21 },
    { q: 2, price: 49.99, iva: 10.5 },
    { q: 3, price: 17.35, iva: 0 },
  ];
  const purchases = [];
  let debit = 0;
  for (const item of cases) {
    const body = await createPurchaseFixtureViaApi(page, {
      providerName: provider.name,
      productName,
      quantity: item.q,
      price: item.price,
      ivaPct: item.iva,
    }, { mode: 'CUENTA_CORRIENTE' });
    purchases.push(extractMovementId(body));
    debit += calculateAmounts(item.q, item.price, item.iva).total;
  }

  const payments = [35.25, 100, 20.10];
  for (let i = 0; i < payments.length; i += 1) {
    await payCreditPurchase(page, {
      purchaseId: purchases[i],
      providerId: provider.id,
      amount: payments[i],
    });
  }

  debit = Number(debit.toFixed(2));
  const credit = Number(payments.reduce((a, b) => a + b, 0).toFixed(2));
  const expectedBalance = Number((debit - credit).toFixed(2));
  const account = await getProviderCurrentAccount(page, provider.id);
  expect(Number(account?.totales?.debito || 0)).toBeCloseTo(debit, 2);
  expect(Number(account?.totales?.credito || 0)).toBeCloseTo(credit, 2);
  expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(expectedBalance, 2);

  const audit = await internalIntegrity(page, 'prefix');
  expect(audit.integridad_ok, JSON.stringify(audit.checks_fallidos || [])).toBe(true);
});
