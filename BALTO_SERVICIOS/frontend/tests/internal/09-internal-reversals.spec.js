import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { uniqueName } from '../support/data.js';
import { createServiceArticleFixture, getServiceStock } from '../support/services.js';
import { createPurchaseFixtureViaApi } from '../support/flows.js';
import {
  createManualCreditSale,
  createParty,
  deletePurchase,
  deleteSale,
  extractMovementId,
  getCurrentAccount,
  getProviderCurrentAccount,
  internalIntegrity,
} from './support/internal-api.js';

test('@internal @reversal venta: eliminar restaura stock y elimina su impacto neto de cuenta corriente', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-REV-SALE-CLI', 120));
  const name = uniqueName('INT-REV-SALE-PROD', 120);
  const article = await createServiceArticleFixture(page, { type: 'PRODUCTO', name, stock: 10, cost: 20, price: 50, ivaPct: 21 });

  const sale = await createManualCreditSale(page, {
    clientId: client.id, articleId: article.id_articulo, quantity: 3, price: 50, ivaPct: 21, description: name,
  });
  expect(await getServiceStock(page, name)).toBeCloseTo(7, 6);
  let account = await getCurrentAccount(page, client.id);
  expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(sale.amounts.total, 2);

  const removed = await deleteSale(page, sale.id);
  expect(removed.status, removed.text).toBeLessThan(400);
  expect(await getServiceStock(page, name)).toBeCloseTo(10, 6);

  account = await getCurrentAccount(page, client.id);
  expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(0, 2);
  const audit = await internalIntegrity(page, 'prefix');
  expect(audit.integridad_ok, JSON.stringify(audit.checks_fallidos || [])).toBe(true);
});

test('@internal @reversal compra: eliminar restaura stock y elimina su impacto neto de cuenta corriente proveedor', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const provider = await createParty(page, 'provider', uniqueName('INT-REV-PUR-PROV', 120));
  const name = uniqueName('INT-REV-PUR-PROD', 120);
  await createServiceArticleFixture(page, { type: 'PRODUCTO', name, stock: 2, cost: 30, price: 60, ivaPct: 21 });

  const purchaseBody = await createPurchaseFixtureViaApi(page, {
    providerName: provider.name, productName: name, quantity: 3, price: 30, ivaPct: 21,
  }, { mode: 'CUENTA_CORRIENTE' });
  const purchaseId = extractMovementId(purchaseBody);
  expect(purchaseId).toBeGreaterThan(0);
  expect(await getServiceStock(page, name)).toBeCloseTo(5, 6);

  let account = await getProviderCurrentAccount(page, provider.id);
  expect(Number(account?.totales?.saldo || 0)).toBeGreaterThan(0);

  const removed = await deletePurchase(page, purchaseId);
  expect(removed.status, removed.text).toBeLessThan(400);
  expect(await getServiceStock(page, name)).toBeCloseTo(2, 6);

  account = await getProviderCurrentAccount(page, provider.id);
  expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(0, 2);
});
