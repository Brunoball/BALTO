import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { uniqueChequeNumber, uniqueName, todayISO } from '../support/data.js';
import { authenticatedApi, expectApiSuccess, getChequeSnapshot } from '../support/api.js';
import { createServiceArticleFixture } from '../support/services.js';
import { createPurchaseFixtureViaApi } from '../support/flows.js';
import {
  concurrentAuthenticatedApi,
  createIncomingChequeFromSale,
  createParty,
  expectExactlyOneSuccess,
  findPaymentMethod,
  getLists,
  internalIntegrity,
} from './support/internal-api.js';

test('@internal @concurrency cheque: dos órdenes simultáneas no pueden egresar el mismo cheque', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await requireMutations(test, page);

  const client = await createParty(page, 'client', uniqueName('INT-CHQ-CLIENT', 120));
  const provider = await createParty(page, 'provider', uniqueName('INT-CHQ-PROV', 120));
  const chequeAmount = 100;
  const cheque = await createIncomingChequeFromSale(page, {
    clientId: client.id,
    amount: chequeAmount,
    number: uniqueChequeNumber(),
    issuer: uniqueName('INT-CHQ-BANK', 120),
  });
  let snapshot = await getChequeSnapshot(page, cheque.cheque.numero, 'CHEQUE');
  expect(snapshot.estado).toBe('EN_CARTERA');

  const articleName = uniqueName('INT-CHQ-PRODUCT', 120);
  await createServiceArticleFixture(page, {
    type: 'PRODUCTO', name: articleName, stock: 0, cost: 50, price: 100, ivaPct: 0,
  });

  const purchaseAData = { providerName: provider.name, productName: articleName, quantity: 1, price: 100, ivaPct: 0 };
  const purchaseBData = { providerName: provider.name, productName: articleName, quantity: 1, price: 100, ivaPct: 0 };
  const purchaseA = await createPurchaseFixtureViaApi(page, purchaseAData, { mode: 'CUENTA_CORRIENTE' });
  const purchaseB = await createPurchaseFixtureViaApi(page, purchaseBData, { mode: 'CUENTA_CORRIENTE' });
  const idA = Number(purchaseA?.id_movimiento || purchaseA?.ids?.[0] || 0);
  const idB = Number(purchaseB?.id_movimiento || purchaseB?.ids?.[0] || 0);
  expect(idA).toBeGreaterThan(0);
  expect(idB).toBeGreaterThan(0);

  const lists = await getLists(page, 'compras');
  const chequeMethodId = findPaymentMethod(lists, 'cheque');
  const paymentBody = (id) => ({
    ids_movimiento: [id],
    id_proveedor: provider.id,
    fecha_pago: todayISO(),
    medios_pago: [{
      id_medio_pago: chequeMethodId,
      monto: chequeAmount,
      id_cheque: cheque.chequeId,
    }],
  });

  const results = await concurrentAuthenticatedApi(page, [
    { action: 'ordenes_pago_confirmar_pago', options: { method: 'POST', body: paymentBody(idA) } },
    { action: 'ordenes_pago_confirmar_pago', options: { method: 'POST', body: paymentBody(idB) } },
  ]);

  const { success, failure } = expectExactlyOneSuccess(results, 'concurrencia de cheque');
  expect(String(failure.body?.mensaje || failure.body?.message || '')).toMatch(/cheque|cartera|utilizado|estado|disponible|otra operación/i);

  snapshot = await getChequeSnapshot(page, cheque.cheque.numero, 'CHEQUE');
  expect(snapshot.estado).toBe('EGRESADO_CARTERA');
  expect(snapshot.enCartera).toBe(false);

  const idsPago = (Array.isArray(success.body?.ids_pago) ? success.body.ids_pago : [success.body?.id_pago])
    .map(Number).filter(Boolean);
  expect(idsPago.length).toBeGreaterThan(0);
  const undo = await authenticatedApi(page, 'ordenes_pago_eliminar_pago', {
    method: 'POST',
    body: { ids_pago: idsPago, fecha_evento: todayISO() },
  });
  expectApiSuccess(undo, 'No se pudo revertir el pago ganador de la carrera');

  snapshot = await getChequeSnapshot(page, cheque.cheque.numero, 'CHEQUE');
  expect(snapshot.estado).toBe('EN_CARTERA');

  const audit = await internalIntegrity(page, 'prefix');
  expect(audit.integridad_ok, JSON.stringify(audit.checks_fallidos || [])).toBe(true);
});
