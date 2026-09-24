import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess, expectChequeState } from './support/api.js';
import { uniqueChequeNumber, uniqueName, todayISO } from './support/data.js';
import { requireMutations } from './support/ui.js';
import { createServiceArticleFixture } from './support/services.js';
import { createPurchaseFixtureViaApi } from './support/flows.js';
import {
  createIncomingChequeFromSale,
  createManualCreditSale,
  createParty,
  directAuthenticatedApi,
  extractMovementId,
  findPaymentMethod,
  getCurrentAccount,
  getLists,
  getProviderCurrentAccount,
} from './internal/support/internal-api.js';

function groupedPaymentRows(account, movementId) {
  return (Array.isArray(account?.rows) ? account.rows : []).filter((row) => {
    if (String(row?.tipo_registro || '').toLowerCase() !== 'cobro') return false;
    const ids = Array.isArray(row?.ids_movimiento)
      ? row.ids_movimiento.map((id) => Number(id))
      : [Number(row?.id_movimiento || 0)];
    return ids.includes(Number(movementId));
  });
}

function originalMovementRow(account, movementId) {
  return (Array.isArray(account?.rows) ? account.rows : []).find(
    (row) => String(row?.tipo_registro || '').toLowerCase() === 'movimiento'
      && Number(row?.id_movimiento || 0) === Number(movementId),
  );
}

function assertOperationId(operationId, prefix, label) {
  const value = String(operationId || '').trim();
  expect(value, `${label}: el backend debe devolver operacion_pago_id`).not.toBe('');
  expect(value, `${label}: operacion_pago_id debe usar el prefijo esperado`).toMatch(
    new RegExp(`^${prefix}-[a-f0-9]{32,}$`, 'i'),
  );
  expect(value.length, `${label}: operacion_pago_id debe caber en VARCHAR(64)`).toBeLessThanOrEqual(64);
  return value;
}

function assertApplicationsShareOperation(body, operationId, label) {
  const applications = Array.isArray(body?.aplicaciones) ? body.aplicaciones : [];
  expect(applications, `${label}: deben persistirse las dos aplicaciones internas`).toHaveLength(2);
  for (const application of applications) {
    expect(
      String(application?.operacion_pago_id || '').trim(),
      `${label}: todas las aplicaciones deben compartir la identidad financiera`,
    ).toBe(operationId);
  }
}

async function deleteGroupedPayment(page, row) {
  const result = await authenticatedApi(page, 'cc_eliminar_cobro', {
    method: 'POST',
    // Contrato nuevo: id_cobro alcanza para resolver operacion_pago_id en backend.
    // No se envía id_comprobante: el PDF ya no define la identidad financiera.
    body: { id_cobro: Number(row?.id_cobro || 0) },
  });
  return expectApiSuccess(result, 'No se pudo eliminar la operación agrupada de cuenta corriente');
}

function assertGroupedRow(row, { amount, label, operationId }) {
  expect(row, `Debe existir una única fila agrupada para ${label}`).toBeTruthy();
  expect(Number(row?.credito || 0), `${label}: el crédito debe sumar todos los medios`).toBeCloseTo(amount, 2);
  // La agrupación tiene que existir ANTES de generar cualquier PDF. Si esto vuelve a
  // ser > 0, el test detecta una dependencia accidental del comprobante.
  expect(Number(row?.id_comprobante || row?.id_archivo || 0), `${label}: la agrupación no debe depender de un PDF`).toBe(0);
  expect(String(row?.operacion_pago_id || '').trim(), `${label}: la fila agrupada debe exponer operacion_pago_id`).toBe(operationId);

  const ids = Array.isArray(row?.ids_cobro) ? row.ids_cobro.map(Number).filter(Boolean) : [];
  expect(ids, `${label}: deben existir dos aplicaciones internas`).toHaveLength(2);
  expect(Number(row?.cantidad_aplicaciones || ids.length), `${label}: cantidad_aplicaciones incorrecta`).toBe(2);
  expect(
    Array.isArray(row?.medios_pago_detalle) ? row.medios_pago_detalle : [],
    `${label}: deben exponerse los dos medios de pago`,
  ).toHaveLength(2);

  for (const payment of row?.medios_pago_detalle || []) {
    expect(String(payment?.operacion_pago_id || '').trim(), `${label}: cada pata debe conservar operacion_pago_id`).toBe(operationId);
  }

  return ids.sort((a, b) => a - b);
}

function deletedPaymentIds(deletion) {
  return (Array.isArray(deletion?.ids_pago_eliminados)
    ? deletion.ids_pago_eliminados
    : (Array.isArray(deletion?.ids_cobro) ? deletion.ids_cobro : []))
    .map(Number)
    .filter(Boolean)
    .sort((a, b) => a - b);
}

test.describe.serial('@crud @critical regresión CC: Recibo/Orden de pago multimétodo por operacion_pago_id', () => {
  test('recibo: agrupa dos medios sin depender del PDF y revierte toda la operación', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);

    const client = await createParty(page, 'client', uniqueName('CC-GROUP-RECIBO', 120));
    const sale = await createManualCreditSale(page, {
      clientId: client.id,
      description: uniqueName('CC-GROUP-VENTA', 120),
      quantity: 1,
      price: 180,
      ivaPct: 0,
    });

    const lists = await getLists(page, 'recibos');
    const chequeMethodId = findPaymentMethod(lists, 'cheque');
    const otherMethodId = findPaymentMethod(lists, 'non-cheque');
    const date = todayISO();
    const chequeNumber = uniqueChequeNumber();

    const receipt = expectApiSuccess(
      await directAuthenticatedApi(page, 'recibos_confirmar_pago', {
        method: 'POST',
        body: {
          ids_movimiento: [sale.id],
          id_cliente: client.id,
          fecha_pago: date,
          medios_pago: [
            {
              id_medio_pago: chequeMethodId,
              monto: 100,
              frontend_row_uid: `PW-GROUP-REC-${Date.now()}`,
              cheque: {
                emisor: uniqueName('BANCO-GROUP-REC', 60).replace(/[^A-Z0-9]/g, ''),
                numero_cheque: chequeNumber,
                numero: chequeNumber,
                importe: 100,
                fecha_emision: date,
                fecha_pago: date,
                fecha_evento: date,
              },
            },
            { id_medio_pago: otherMethodId, monto: 80 },
          ],
        },
      }),
      'No se pudo crear el recibo agrupado de prueba',
    );

    const operationId = assertOperationId(receipt?.operacion_pago_id, 'RECIBO', 'Recibo');
    assertApplicationsShareOperation(receipt, operationId, 'Recibo');

    const createdChequeId = Number(receipt?.cheques_creados?.[0]?.id_cheque || 0);
    expect(createdChequeId, 'El recibo debe crear el cheque de $100').toBeGreaterThan(0);
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');

    const account = await getCurrentAccount(page, client.id);
    const paymentRows = groupedPaymentRows(account, sale.id);
    expect(paymentRows, 'El recibo con dos medios debe renderizar una sola fila aun sin PDF').toHaveLength(1);
    const row = paymentRows[0];
    const idsBefore = assertGroupedRow(row, {
      amount: 180,
      label: 'Recibo',
      operationId,
    });

    expect(Number(account?.totales?.debito || 0)).toBeCloseTo(180, 2);
    expect(Number(account?.totales?.credito || 0)).toBeCloseTo(180, 2);
    expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(0, 2);

    const deletion = await deleteGroupedPayment(page, row);
    expect(String(deletion?.operacion_pago_id || '').trim()).toBe(operationId);
    expect(Number(deletion?.medios_pago_eliminados || 0)).toBe(2);
    expect(deletion?.comprobante_eliminado, 'Sin PDF no debe inventarse una eliminación de comprobante').toBe(false);
    expect(deletedPaymentIds(deletion)).toEqual(idsBefore);

    const after = await getCurrentAccount(page, client.id);
    expect(groupedPaymentRows(after, sale.id), 'No debe sobrevivir ninguna pata del recibo').toHaveLength(0);
    const movement = originalMovementRow(after, sale.id);
    expect(movement, 'La venta original debe seguir existiendo').toBeTruthy();
    expect(Number(movement?.total_pagado || 0)).toBeCloseTo(0, 2);
    expect(String(movement?.estado_pago || movement?.estado || '')).toMatch(/PENDIENTE/i);
    expect(Number(after?.totales?.credito || 0)).toBeCloseTo(0, 2);
    expect(Number(after?.totales?.saldo || 0)).toBeCloseTo(180, 2);

    // El cheque recibido no desaparece al eliminar el recibo: su alta en cartera es
    // un hecho independiente del pago aplicado a la cuenta corriente.
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');
  });

  test('orden de pago: cheque + otro medio forman una operación y el cheque vuelve a cartera al revertirla', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    await requireMutations(test, page);

    const sourceClient = await createParty(page, 'client', uniqueName('CC-GROUP-CHQ-CLI', 120));
    const chequeNumber = uniqueChequeNumber();
    const incoming = await createIncomingChequeFromSale(page, {
      clientId: sourceClient.id,
      amount: 100,
      number: chequeNumber,
      issuer: uniqueName('BANCO-GROUP-OP', 60).replace(/[^A-Z0-9]/g, ''),
      description: uniqueName('CC-GROUP-CHQ-ORIGEN', 120),
      type: 'CHEQUE',
    });
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');

    const provider = await createParty(page, 'provider', uniqueName('CC-GROUP-PROV', 120));
    const productName = uniqueName('CC-GROUP-PROD', 120);
    await createServiceArticleFixture(page, {
      type: 'PRODUCTO',
      name: productName,
      stock: 0,
      cost: 180,
      price: 250,
      ivaPct: 0,
    });

    const purchaseBody = await createPurchaseFixtureViaApi(page, {
      providerName: provider.name,
      productName,
      quantity: 1,
      price: 180,
      ivaPct: 0,
    }, { mode: 'CUENTA_CORRIENTE' });
    const purchaseId = extractMovementId(purchaseBody);
    expect(purchaseId, 'La compra debe devolver id_movimiento').toBeGreaterThan(0);

    const lists = await getLists(page, 'compras');
    const otherMethodId = findPaymentMethod(lists, 'non-cheque');
    const date = todayISO();
    const payment = expectApiSuccess(
      await directAuthenticatedApi(page, 'ordenes_pago_confirmar_pago', {
        method: 'POST',
        body: {
          ids_movimiento: [purchaseId],
          id_proveedor: provider.id,
          fecha_pago: date,
          medios_pago: [
            {
              id_medio_pago: incoming.paymentMethodId,
              monto: 100,
              id_cheque: incoming.chequeId,
            },
            { id_medio_pago: otherMethodId, monto: 80 },
          ],
        },
      }),
      'No se pudo crear la orden de pago agrupada de prueba',
    );

    const operationId = assertOperationId(payment?.operacion_pago_id, 'ORDEN_PAGO', 'Orden de pago');
    assertApplicationsShareOperation(payment, operationId, 'Orden de pago');
    await expectChequeState(page, chequeNumber, 'EGRESADO_CARTERA');

    const account = await getProviderCurrentAccount(page, provider.id);
    const paymentRows = groupedPaymentRows(account, purchaseId);
    expect(paymentRows, 'La orden con dos medios debe renderizar una sola fila aun sin PDF').toHaveLength(1);
    const row = paymentRows[0];
    const idsBefore = assertGroupedRow(row, {
      amount: 180,
      label: 'Orden de pago',
      operationId,
    });

    expect(Number(account?.totales?.debito || 0)).toBeCloseTo(180, 2);
    expect(Number(account?.totales?.credito || 0)).toBeCloseTo(180, 2);
    expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(0, 2);

    // La ruta propia de Órdenes de pago recibe UNA sola pata y debe expandirla
    // al grupo completo por operacion_pago_id, sin necesitar PDF compartido.
    const deletion = expectApiSuccess(
      await authenticatedApi(page, 'ordenes_pago_eliminar_pago', {
        method: 'POST',
        body: { id_pago: Number(row?.id_cobro || 0), fecha_evento: date },
      }),
      'No se pudo revertir la orden de pago agrupada por operacion_pago_id',
    );
    expect(deletedPaymentIds(deletion)).toEqual(idsBefore);
    expect(Number(deletion?.borrados || 0)).toBe(2);
    expect(
      Array.isArray(deletion?.operaciones_pago_eliminadas) ? deletion.operaciones_pago_eliminadas : [],
      'La reversión debe informar la operación financiera eliminada',
    ).toContain(operationId);
    expect(
      Array.isArray(deletion?.archivos_eliminados) ? deletion.archivos_eliminados : [],
      'Sin PDF no debe inventarse una eliminación de comprobante',
    ).toHaveLength(0);

    await expectChequeState(page, chequeNumber, 'EN_CARTERA');

    const after = await getProviderCurrentAccount(page, provider.id);
    expect(groupedPaymentRows(after, purchaseId), 'No debe sobrevivir ninguna pata de la orden de pago').toHaveLength(0);
    const movement = originalMovementRow(after, purchaseId);
    expect(movement, 'La compra original debe seguir existiendo').toBeTruthy();
    expect(Number(movement?.total_pagado || 0)).toBeCloseTo(0, 2);
    expect(String(movement?.estado_pago || movement?.estado || '')).toMatch(/PENDIENTE/i);
    expect(Number(after?.totales?.credito || 0)).toBeCloseTo(0, 2);
    expect(Number(after?.totales?.saldo || 0)).toBeCloseTo(180, 2);
  });
});
