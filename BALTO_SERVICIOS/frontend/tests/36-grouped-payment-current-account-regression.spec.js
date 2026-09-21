import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess, expectChequeState } from './support/api.js';
import { RUN_PREFIX, uniqueChequeNumber, uniqueName, todayISO } from './support/data.js';
import { ENV } from './support/env.js';
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



async function attachGroupedComprobante(page, { action, tipo, movementIds, paymentIds, title }) {
  const movements = (Array.isArray(movementIds) ? movementIds : [movementIds])
    .map(Number)
    .filter(Boolean);
  const payments = (Array.isArray(paymentIds) ? paymentIds : [paymentIds])
    .map(Number)
    .filter(Boolean);

  expect(movements, `${tipo}: debe haber al menos un movimiento para vincular el comprobante`).not.toHaveLength(0);
  expect(payments, `${tipo}: el pago con dos medios debe devolver sus dos ids internos`).toHaveLength(2);

  const base = ENV.apiURL.replace(/\/+$/, '');
  const url = new URL(`${base}/api.php`);
  url.searchParams.set('action', action);
  if (ENV.allowMutations) url.searchParams.set('e2e_run', RUN_PREFIX);

  const result = await page.evaluate(async ({ requestUrl, tipoArchivo, idsMovimientos, idsPagos, titulo }) => {
    const sessionKey = String(localStorage.getItem('session_key') || '').trim();
    if (!sessionKey) throw new Error('No hay session_key para guardar el comprobante E2E.');

    // PDF mínimo suficiente para atravesar exactamente el endpoint multipart que usa
    // "Finalizar" en Recibos/Órdenes de Pago. Lo importante de esta regresión no es
    // maquetar el PDF, sino persistir UNA identidad de comprobante común a ambas patas.
    const pdf = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
    ].join('\n');
    const file = new File([new TextEncoder().encode(pdf)], 'balto-e2e-operacion.pdf', {
      type: 'application/pdf',
    });

    const fd = new FormData();
    fd.append('tipo', tipoArchivo);
    fd.append('titulo', titulo);
    idsMovimientos.forEach((id) => fd.append('ids_movimiento[]', String(id)));
    idsPagos.forEach((id) => {
      fd.append('ids_pago[]', String(id));
      fd.append('ids_cobro[]', String(id));
      fd.append('ids_movimiento_medio_pago[]', String(id));
    });
    fd.append('id_movimiento', String(idsMovimientos[0]));
    fd.append('id_pago', String(idsPagos[0]));
    fd.append('id_cobro', String(idsPagos[0]));
    fd.append('archivo', file);

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Session': sessionKey },
      body: fd,
      timeoutMs: 70_000,
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { status: response.status, ok: response.ok, body, text };
  }, {
    requestUrl: url.toString(),
    tipoArchivo: tipo,
    idsMovimientos: movements,
    idsPagos: payments,
    titulo: title,
  });

  const body = expectApiSuccess(result, `${tipo}: no se pudo persistir el comprobante agrupado`);
  const idComprobante = Number(body?.id_comprobante || body?.id_archivo || body?.data?.id_comprobante || 0);
  expect(idComprobante, `${tipo}: Finalizar debe devolver un id_comprobante común`).toBeGreaterThan(0);

  const linked = (Array.isArray(body?.ids_pago_vinculados) ? body.ids_pago_vinculados : [])
    .map(Number)
    .filter(Boolean)
    .sort((a, b) => a - b);
  expect(linked, `${tipo}: el comprobante debe quedar vinculado a las dos aplicaciones`).toEqual(
    [...payments].sort((a, b) => a - b),
  );

  return idComprobante;
}

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

async function deleteGroupedPayment(page, row) {
  const result = await authenticatedApi(page, 'cc_eliminar_cobro', {
    method: 'POST',
    body: {
      id_cobro: Number(row?.id_cobro || 0),
      id_comprobante: Number(row?.id_comprobante || 0),
    },
  });
  return expectApiSuccess(result, 'No se pudo eliminar la operación agrupada de cuenta corriente');
}

function assertGroupedRow(row, { amount, label }) {
  expect(row, `Debe existir una única fila agrupada para ${label}`).toBeTruthy();
  expect(Number(row?.credito || 0), `${label}: el crédito debe sumar todos los medios`).toBeCloseTo(amount, 2);
  expect(Number(row?.id_comprobante || 0), `${label}: debe conservar el comprobante único`).toBeGreaterThan(0);

  const ids = Array.isArray(row?.ids_cobro) ? row.ids_cobro.map(Number).filter(Boolean) : [];
  expect(ids, `${label}: deben existir dos aplicaciones internas`).toHaveLength(2);
  expect(Number(row?.cantidad_aplicaciones || 0), `${label}: cantidad_aplicaciones incorrecta`).toBe(2);
  expect(Array.isArray(row?.medios_pago_detalle) ? row.medios_pago_detalle : [], `${label}: deben exponerse los dos medios de pago`).toHaveLength(2);
  return ids.sort((a, b) => a - b);
}

test.describe.serial('@crud @critical regresión CC: Recibo/Orden de pago con múltiples medios', () => {
  test('recibo: dos medios se muestran como una sola operación y al eliminarla no queda pago ni comprobante huérfano', async ({ page }) => {
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

    const createdChequeId = Number(receipt?.cheques_creados?.[0]?.id_cheque || 0);
    expect(createdChequeId, 'El recibo debe crear el cheque de $100').toBeGreaterThan(0);
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');

    const receiptPaymentIds = (Array.isArray(receipt?.ids_pago) ? receipt.ids_pago : receipt?.ids_cobro || [])
      .map(Number)
      .filter(Boolean);
    await attachGroupedComprobante(page, {
      action: 'recibos_comprobantes_subir',
      tipo: 'RECIBO',
      movementIds: [sale.id],
      paymentIds: receiptPaymentIds,
      title: `${RUN_PREFIX}-RECIBO-GROUP`,
    });

    const account = await getCurrentAccount(page, client.id);
    const paymentRows = groupedPaymentRows(account, sale.id);
    expect(paymentRows, 'El recibo con dos medios debe renderizar una sola fila de cuenta corriente').toHaveLength(1);
    const row = paymentRows[0];
    const idsBefore = assertGroupedRow(row, { amount: 180, label: 'Recibo' });

    expect(Number(account?.totales?.debito || 0)).toBeCloseTo(180, 2);
    expect(Number(account?.totales?.credito || 0)).toBeCloseTo(180, 2);
    expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(0, 2);

    const deletion = await deleteGroupedPayment(page, row);
    const deletedIds = (Array.isArray(deletion?.ids_cobro) ? deletion.ids_cobro : [])
      .map(Number)
      .filter(Boolean)
      .sort((a, b) => a - b);
    expect(deletion?.operacion_agrupada).toBe(true);
    expect(deletion?.comprobante_eliminado).toBe(true);
    expect(Number(deletion?.medios_pago_eliminados || 0)).toBe(2);
    expect(deletedIds).toEqual(idsBefore);

    const after = await getCurrentAccount(page, client.id);
    expect(groupedPaymentRows(after, sale.id), 'No debe sobrevivir ninguna pata del recibo').toHaveLength(0);
    const movement = originalMovementRow(after, sale.id);
    expect(movement, 'La venta original debe seguir existiendo').toBeTruthy();
    expect(Number(movement?.total_pagado || 0)).toBeCloseTo(0, 2);
    expect(String(movement?.estado_pago || movement?.estado || '')).toMatch(/PENDIENTE/i);
    expect(Number(after?.totales?.credito || 0)).toBeCloseTo(0, 2);
    expect(Number(after?.totales?.saldo || 0)).toBeCloseTo(180, 2);

    // El cheque recibido no debe desaparecer por eliminar el recibo: su alta en cartera
    // es un hecho independiente y esta conducta ya forma parte del contrato de Balto.
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');
  });

  test('orden de pago: cheque + otro medio se agrupan y al eliminar la orden completa el cheque vuelve a cartera', async ({ page }) => {
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

    await expectChequeState(page, chequeNumber, 'EGRESADO_CARTERA');

    const orderPaymentIds = (Array.isArray(payment?.ids_pago) ? payment.ids_pago : payment?.ids_cobro || [])
      .map(Number)
      .filter(Boolean);
    await attachGroupedComprobante(page, {
      action: 'ordenes_pago_comprobante_subir_y_vincular',
      tipo: 'ORDEN_PAGO',
      movementIds: [purchaseId],
      paymentIds: orderPaymentIds,
      title: `${RUN_PREFIX}-ORDEN-GROUP`,
    });

    const account = await getProviderCurrentAccount(page, provider.id);
    const paymentRows = groupedPaymentRows(account, purchaseId);
    expect(paymentRows, 'La orden con dos medios debe renderizar una sola fila de cuenta corriente').toHaveLength(1);
    const row = paymentRows[0];
    const idsBefore = assertGroupedRow(row, { amount: 180, label: 'Orden de pago' });

    expect(Number(account?.totales?.debito || 0)).toBeCloseTo(180, 2);
    expect(Number(account?.totales?.credito || 0)).toBeCloseTo(180, 2);
    expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(0, 2);

    const deletion = await deleteGroupedPayment(page, row);
    const deletedIds = (Array.isArray(deletion?.ids_cobro) ? deletion.ids_cobro : [])
      .map(Number)
      .filter(Boolean)
      .sort((a, b) => a - b);
    expect(deletion?.operacion_agrupada).toBe(true);
    expect(deletion?.comprobante_eliminado).toBe(true);
    expect(Number(deletion?.medios_pago_eliminados || 0)).toBe(2);
    expect(deletedIds).toEqual(idsBefore);

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
