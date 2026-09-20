import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { uniqueChequeNumber, uniqueName, todayISO } from '../support/data.js';
import { authenticatedApi, expectApiSuccess, expectChequeEvents, getChequeSnapshot } from '../support/api.js';
import { createServiceArticleFixture } from '../support/services.js';
import { createPurchaseFixtureViaApi } from '../support/flows.js';
import {
  attemptIncomingChequePayment,
  createIncomingChequeFromSale,
  createManualCreditSale,
  createParty,
  extractMovementId,
  findPaymentMethod,
  getLists,
  internalIntegrity,
} from './support/internal-api.js';

test('@internal @cheques eCheq: ingreso, egreso por OP y reversión vuelven exactamente a EN_CARTERA', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);

  const client = await createParty(page, 'client', uniqueName('INT-ECHQ-CLI', 120));
  const provider = await createParty(page, 'provider', uniqueName('INT-ECHQ-PROV', 120));
  const amount = 175;
  const number = uniqueChequeNumber();
  const incoming = await createIncomingChequeFromSale(page, {
    clientId: client.id, amount, number, issuer: uniqueName('INT-ECHQ-BANK', 120), type: 'ECHEQ',
  });

  let snapshot = await getChequeSnapshot(page, number, 'ECHEQ');
  expect(snapshot.estado).toBe('EN_CARTERA');
  await expectChequeEvents(page, number, ['INGRESO_CARTERA'], 'ECHEQ');

  const productName = uniqueName('INT-ECHQ-PROD', 120);
  await createServiceArticleFixture(page, { type: 'PRODUCTO', name: productName, stock: 0, cost: amount, price: amount, ivaPct: 0 });
  const purchaseBody = await createPurchaseFixtureViaApi(page, {
    providerName: provider.name, productName, quantity: 1, price: amount, ivaPct: 0,
  }, { mode: 'CUENTA_CORRIENTE' });
  const purchaseId = extractMovementId(purchaseBody);
  expect(purchaseId).toBeGreaterThan(0);

  const lists = await getLists(page, 'compras');
  const methodId = findPaymentMethod(lists, 'echeq');
  const payment = expectApiSuccess(
    await authenticatedApi(page, 'ordenes_pago_confirmar_pago', {
      method: 'POST',
      body: {
        ids_movimiento: [purchaseId],
        id_proveedor: provider.id,
        fecha_pago: todayISO(),
        medios_pago: [{ id_medio_pago: methodId, monto: amount, id_cheque: incoming.chequeId }],
      },
    }),
    'No se pudo egresar el eCheq interno',
  );

  snapshot = await getChequeSnapshot(page, number, 'ECHEQ');
  expect(snapshot.estado).toBe('EGRESADO_CARTERA');
  expect(snapshot.enCartera).toBe(false);
  await expectChequeEvents(page, number, ['INGRESO_CARTERA', 'EGRESO_CARTERA'], 'ECHEQ');

  const paymentIds = (Array.isArray(payment?.ids_pago) ? payment.ids_pago : [payment?.id_pago]).map(Number).filter(Boolean);
  expect(paymentIds.length).toBeGreaterThan(0);
  expectApiSuccess(
    await authenticatedApi(page, 'ordenes_pago_eliminar_pago', {
      method: 'POST', body: { ids_pago: paymentIds, fecha_evento: todayISO() },
    }),
    'No se pudo revertir el egreso del eCheq',
  );

  snapshot = await getChequeSnapshot(page, number, 'ECHEQ');
  expect(snapshot.estado).toBe('EN_CARTERA');
  expect(snapshot.enCartera).toBe(true);
});

test('@internal @cheques unicidad: el mismo número de cheque no puede ingresarse dos veces', async ({ page }) => {
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-DUP-CHQ-CLI', 120));
  const number = uniqueChequeNumber();
  const amount = 90;

  await createIncomingChequeFromSale(page, {
    clientId: client.id, amount, number, issuer: uniqueName('INT-DUP-CHQ-BANK-A', 120), type: 'CHEQUE',
  });

  const secondSale = await createManualCreditSale(page, {
    clientId: client.id, quantity: 1, price: amount, ivaPct: 0,
    description: uniqueName('INT-DUP-CHQ-SALE-B', 120),
  });
  const attempt = await attemptIncomingChequePayment(page, {
    saleId: secondSale.id,
    clientId: client.id,
    amount,
    number,
    issuer: uniqueName('INT-DUP-CHQ-BANK-B', 120),
    type: 'CHEQUE',
  });

  expect(attempt.result.status).toBeGreaterThanOrEqual(400);
  expect(String(attempt.result.body?.mensaje || attempt.result.body?.message || '')).toMatch(/cheque|n[uú]mero|duplic|exist/i);

  const snapshot = await getChequeSnapshot(page, number, 'CHEQUE');
  expect(snapshot.idCheque).toBeGreaterThan(0);
  expect(snapshot.estado).toBe('EN_CARTERA');
});

test('@internal @cheques integridad: cartera y flujo permanecen coherentes después de ingreso y reversión', async ({ page }) => {
  await requireMutations(test, page);
  const client = await createParty(page, 'client', uniqueName('INT-CHQ-AUDIT-CLI', 120));
  const number = uniqueChequeNumber();
  await createIncomingChequeFromSale(page, {
    clientId: client.id, amount: 123.45, number, issuer: uniqueName('INT-CHQ-AUDIT-BANK', 120), type: 'CHEQUE',
  });

  const snapshot = await getChequeSnapshot(page, number, 'CHEQUE');
  expect(snapshot.estado).toBe('EN_CARTERA');
  expect(snapshot.enCartera).toBe(true);
  expect(snapshot.flujo.length).toBeGreaterThan(0);

  const audit = await internalIntegrity(page, 'prefix');
  expect(audit.integridad_ok, JSON.stringify(audit.checks_fallidos || [])).toBe(true);
});
