import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { uniqueName } from '../support/data.js';
import {
  calculateAmounts,
  createManualCreditSale,
  createParty,
  getCurrentAccount,
  payCreditSale,
} from './support/internal-api.js';

test('@internal @accounting backend ignora totales manipulados y persiste subtotal/IVA/total matemáticamente correctos', async ({ page }) => {
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-MATH-CLIENT', 120));
  const sale = await createManualCreditSale(page, {
    clientId: client.id,
    description: uniqueName('INT-MATH-ROUND', 120),
    quantity: 3,
    price: 19.99,
    ivaPct: 21,
    // El navegador "miente". El backend debe ignorarlo y recalcular.
    fakeClientTotal: 999999.99,
  });

  expect(sale.amounts).toEqual(calculateAmounts(3, 19.99, 21));
  expect(sale.amounts.subtotal).toBeCloseTo(59.97, 2);
  expect(sale.amounts.ivaAmount).toBeCloseTo(12.59, 2);
  expect(sale.amounts.total).toBeCloseTo(72.56, 2);

  const detail = expectApiSuccess(
    await authenticatedApi(page, 'ventas_obtener', { query: { id_movimiento: sale.id, _: Date.now() } }),
    'No se pudo leer la venta matemática',
  );
  const venta = detail?.venta || detail?.data?.venta || {};
  const item = (venta?.items_detalle || venta?.items || [])[0];
  expect(item, 'La venta debe conservar el renglón persistido').toBeTruthy();
  expect(Number(item.subtotal)).toBeCloseTo(59.97, 2);
  expect(Number(item.iva_monto)).toBeCloseTo(12.59, 2);
  expect(Number(item.total)).toBeCloseTo(72.56, 2);
});

test('@internal @accounting cuenta corriente coincide con un modelo contable independiente incluyendo pago parcial y excedente', async ({ page }) => {
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-LEDGER-CLIENT', 120));

  const a = await createManualCreditSale(page, {
    clientId: client.id,
    description: uniqueName('INT-LEDGER-A', 120),
    quantity: 1,
    price: 100,
    ivaPct: 21,
  }); // 121.00
  const b = await createManualCreditSale(page, {
    clientId: client.id,
    description: uniqueName('INT-LEDGER-B', 120),
    quantity: 2,
    price: 99.99,
    ivaPct: 10.5,
  }); // 220.98
  const c = await createManualCreditSale(page, {
    clientId: client.id,
    description: uniqueName('INT-LEDGER-C', 120),
    quantity: 3,
    price: 10.01,
    ivaPct: 0,
  }); // 30.03

  await payCreditSale(page, { saleId: a.id, clientId: client.id, amount: 50 });
  await payCreditSale(page, { saleId: b.id, clientId: client.id, amount: b.amounts.total });
  await payCreditSale(page, { saleId: c.id, clientId: client.id, amount: 40 }); // excedente permitido

  const expectedDebit = Number((a.amounts.total + b.amounts.total + c.amounts.total).toFixed(2));
  const expectedCredit = Number((50 + b.amounts.total + 40).toFixed(2));
  const expectedBalance = Number((expectedDebit - expectedCredit).toFixed(2));
  expect(expectedDebit).toBeCloseTo(372.01, 2);
  expect(expectedCredit).toBeCloseTo(310.98, 2);
  expect(expectedBalance).toBeCloseTo(61.03, 2);

  const account = await getCurrentAccount(page, client.id);
  expect(Number(account?.totales?.debito || 0)).toBeCloseTo(expectedDebit, 2);
  expect(Number(account?.totales?.credito || 0)).toBeCloseTo(expectedCredit, 2);
  expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(expectedBalance, 2);

  const rows = Array.isArray(account?.rows) ? account.rows : [];
  const recomputed = rows.reduce((sum, row) => sum + Number(row?.debito || 0) - Number(row?.credito || 0), 0);
  expect(Number(recomputed.toFixed(2))).toBeCloseTo(expectedBalance, 2);
});
