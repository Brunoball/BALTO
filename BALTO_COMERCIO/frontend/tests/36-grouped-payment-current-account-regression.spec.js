import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess, expectChequeState } from './support/api.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { uniqueChequeNumber, uniqueName, uniqueSku, todayISO } from './support/data.js';
import { requireMutations } from './support/ui.js';

function unwrapLists(body) {
  return body?.listas && typeof body.listas === 'object' ? body.listas : body;
}

async function getLists(page, context) {
  const body = expectApiSuccess(
    await authenticatedApi(page, 'global_obtener_listas', {
      query: { contexto: context, include_sin_stock: 1, _: Date.now() },
    }),
    `No se pudieron cargar listas globales (${context})`,
  );
  return unwrapLists(body);
}

function findCurrentAccountType(lists) {
  const rows = Array.isArray(lists?.tipos_venta) ? lists.tipos_venta : [];
  const row = rows.find((item) =>
    Number(item?.activo ?? 1) !== 0 && /CUENTA\s*CORRIENTE/i.test(String(item?.nombre || ''))
  );
  expect(row, 'Debe existir el tipo CUENTA CORRIENTE').toBeTruthy();
  return Number(row?.id_tipo_venta || row?.id || 0);
}

function findPaymentMethod(lists, kind = 'non-cheque') {
  const rows = Array.isArray(lists?.medios_pago) ? lists.medios_pago : [];
  const active = rows.filter((item) => Number(item?.activo ?? 1) !== 0);
  const isElectronic = (name) => /ECHEQ|E-CHEQ|E CHEQ|ELECTR[ÓO]NICO/i.test(name);
  const isCheque = (name) => /CHEQ/i.test(name);

  const row = kind === 'cheque'
    ? active.find((item) => isCheque(String(item?.nombre || '')) && !isElectronic(String(item?.nombre || '')))
    : active.find((item) => !isCheque(String(item?.nombre || '')));

  expect(row, `Debe existir un medio de pago activo (${kind})`).toBeTruthy();
  return Number(row?.id_medio_pago || row?.id || 0);
}

async function createParty(page, kind, name) {
  const provider = kind === 'provider';
  const action = provider ? 'cc_proveedor_crear' : 'cc_cliente_crear';
  const idKey = provider ? 'id_proveedor' : 'id_cliente';
  const normalized = String(name).trim().toUpperCase();
  const body = expectApiSuccess(
    await authenticatedApi(page, action, {
      method: 'POST',
      body: { nombre: normalized, activo: 1 },
    }),
    `No se pudo crear ${normalized}`,
  );
  const id = Number(body?.[idKey] ?? body?.data?.[idKey] ?? 0);
  expect(id, `${normalized} debe devolver ${idKey}`).toBeGreaterThan(0);
  return { id, name: normalized };
}

function productId(body) {
  const product = body?.producto || body?.data?.producto || body?.data || body || {};
  return Number(product?.id_stock_producto ?? product?.id_producto ?? product?.id ?? 0);
}

async function createStockFixture(page, label, { stock = 5, cost = 100, price = 180 } = {}) {
  const name = uniqueName(label, 100);
  const body = await createStockProductFixture(page, {
    name,
    sku: uniqueSku(label),
    stock,
    cost,
    price,
  });
  const id = productId(body);
  expect(id, `El producto ${name} debe devolver id_stock_producto`).toBeGreaterThan(0);
  return { id, name };
}

function movementId(body) {
  return Number(
    body?.id_movimiento ??
    body?.id_venta ??
    body?.id_compra ??
    body?.data?.id_movimiento ??
    body?.data?.id_venta ??
    body?.data?.id_compra ??
    (Array.isArray(body?.ids) ? body.ids[0] : 0) ??
    0
  );
}

async function createCreditSale(page, clientId, amount, label) {
  const product = await createStockFixture(page, `${label}-PROD`, { stock: 5, cost: amount / 2, price: amount });
  const lists = await getLists(page, 'ventas');
  const typeId = findCurrentAccountType(lists);
  const date = todayISO();
  const body = expectApiSuccess(
    await authenticatedApi(page, 'ventas_crear_batch', {
      method: 'POST',
      body: {
        fecha: date,
        id_tipo_venta: typeId,
        id_cliente: Number(clientId),
        items: [{
          fecha: date,
          id_tipo_venta: typeId,
          id_cliente: Number(clientId),
          id_stock_producto: product.id,
          cantidad: 1,
          precio: Number(amount),
          iva_pct: 0,
          total: Number(amount),
        }],
        medios_pago: [],
      },
    }),
    `No se pudo crear la venta CC ${label}`,
  );
  const id = movementId(body);
  expect(id, `La venta ${label} debe devolver id_movimiento`).toBeGreaterThan(0);
  return { id, body, product };
}

async function createCreditPurchase(page, providerId, amount, label) {
  const product = await createStockFixture(page, `${label}-PROD`, { stock: 0, cost: amount, price: amount * 1.4 });
  const lists = await getLists(page, 'compras');
  const typeId = findCurrentAccountType(lists);
  const date = todayISO();
  const body = expectApiSuccess(
    await authenticatedApi(page, 'compras_crear_batch', {
      method: 'POST',
      body: {
        fecha: date,
        id_tipo_venta: typeId,
        id_proveedor: Number(providerId),
        items: [{
          fecha: date,
          id_tipo_venta: typeId,
          id_proveedor: Number(providerId),
          id_stock_producto: product.id,
          cantidad: 1,
          precio: Number(amount),
          iva_pct: 0,
          total: Number(amount),
        }],
        medios_pago: [],
      },
    }),
    `No se pudo crear la compra CC ${label}`,
  );
  const id = movementId(body);
  expect(id, `La compra ${label} debe devolver id_movimiento`).toBeGreaterThan(0);
  return { id, body, product };
}

async function currentAccount(page, kind, partyId) {
  const provider = kind === 'provider';
  const action = provider ? 'cc_historial_proveedor' : 'cc_historial_cliente';
  const queryKey = provider ? 'id_proveedor' : 'id_cliente';
  return expectApiSuccess(
    await authenticatedApi(page, action, {
      query: { [queryKey]: Number(partyId), _: Date.now() },
    }),
    `No se pudo consultar la cuenta corriente ${kind} #${partyId}`,
  );
}

function groupedPaymentRows(account, idMovimiento) {
  return (Array.isArray(account?.rows) ? account.rows : []).filter((row) => {
    if (String(row?.tipo_registro || '').toLowerCase() !== 'cobro') return false;
    const ids = Array.isArray(row?.ids_movimiento)
      ? row.ids_movimiento.map(Number)
      : [Number(row?.id_movimiento || 0)];
    return ids.includes(Number(idMovimiento));
  });
}

function originalMovementRow(account, idMovimiento) {
  return (Array.isArray(account?.rows) ? account.rows : []).find(
    (row) => String(row?.tipo_registro || '').toLowerCase() === 'movimiento'
      && Number(row?.id_movimiento || 0) === Number(idMovimiento),
  );
}

function assertGroupedRow(row, { amount, operationId, label }) {
  expect(row, `Debe existir una única fila agrupada para ${label}`).toBeTruthy();
  expect(Number(row?.credito || 0), `${label}: el crédito debe sumar todos los medios`).toBeCloseTo(amount, 2);
  expect(String(row?.operacion_pago_id || ''), `${label}: debe conservar la identidad financiera`).toBe(operationId);

  const ids = Array.isArray(row?.ids_cobro) ? row.ids_cobro.map(Number).filter(Boolean) : [];
  expect(ids, `${label}: deben existir dos aplicaciones internas`).toHaveLength(2);
  expect(Number(row?.cantidad_aplicaciones || 0), `${label}: cantidad_aplicaciones incorrecta`).toBe(2);
  expect(Array.isArray(row?.medios_pago_detalle) ? row.medios_pago_detalle : [], `${label}: deben exponerse los dos medios`).toHaveLength(2);
  return ids.sort((a, b) => a - b);
}

async function deleteGroupedPayment(page, row) {
  return expectApiSuccess(
    await authenticatedApi(page, 'cc_eliminar_cobro', {
      method: 'POST',
      // Importante: no enviamos id_comprobante. La operación debe poder resolverse
      // sólo por operacion_pago_id, incluso si el usuario aún no guardó el PDF.
      body: { id_cobro: Number(row?.id_cobro || 0) },
    }),
    'No se pudo eliminar la operación agrupada de cuenta corriente',
  );
}

async function createIncomingCheque(page, clientId, amount, chequeNumber) {
  const sale = await createCreditSale(page, clientId, amount, 'CC-GROUP-CHQ-SOURCE');
  const lists = await getLists(page, 'recibos');
  const chequeMethodId = findPaymentMethod(lists, 'cheque');
  const date = todayISO();
  const body = expectApiSuccess(
    await authenticatedApi(page, 'recibos_confirmar_pago', {
      method: 'POST',
      body: {
        ids_movimiento: [sale.id],
        id_cliente: Number(clientId),
        fecha_pago: date,
        medios_pago: [{
          id_medio_pago: chequeMethodId,
          monto: Number(amount),
          frontend_row_uid: `PW-GROUP-CHQ-${Date.now()}`,
          cheque: {
            emisor: uniqueName('BANCO-GROUP', 50).replace(/[^A-Z0-9]/g, ''),
            numero_cheque: chequeNumber,
            numero: chequeNumber,
            importe: Number(amount),
            fecha_emision: date,
            fecha_pago: date,
            fecha_evento: date,
          },
        }],
      },
    }),
    'No se pudo ingresar el cheque de prueba',
  );
  const chequeId = Number(body?.cheques_creados?.[0]?.id_cheque || 0);
  expect(chequeId, 'El recibo de origen debe devolver id_cheque').toBeGreaterThan(0);
  return { sale, body, chequeId, chequeMethodId };
}

test.describe.serial('@crud @critical regresión CC: Recibo/Orden de pago multimétodo por operacion_pago_id', () => {
  test('recibo: agrupa dos medios sin depender del PDF y revierte toda la operación', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);

    const client = await createParty(page, 'client', uniqueName('CC-GROUP-RECIBO', 100));
    const sale = await createCreditSale(page, client.id, 180, 'CC-GROUP-VENTA');
    const lists = await getLists(page, 'recibos');
    const chequeMethodId = findPaymentMethod(lists, 'cheque');
    const otherMethodId = findPaymentMethod(lists, 'non-cheque');
    const chequeNumber = uniqueChequeNumber();
    const date = todayISO();

    const receipt = expectApiSuccess(
      await authenticatedApi(page, 'recibos_confirmar_pago', {
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
                emisor: uniqueName('BANCO-GROUP-REC', 50).replace(/[^A-Z0-9]/g, ''),
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
      'No se pudo crear el recibo multimétodo',
    );

    const operationId = String(receipt?.operacion_pago_id || '').trim();
    expect(operationId, 'El recibo debe devolver operacion_pago_id').not.toBe('');
    expect((receipt?.ids_pago || receipt?.ids_cobro || []).map(Number).filter(Boolean)).toHaveLength(2);
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');

    const account = await currentAccount(page, 'client', client.id);
    const rows = groupedPaymentRows(account, sale.id);
    expect(rows, 'Dos medios del mismo recibo deben formar una sola fila lógica').toHaveLength(1);
    const idsBefore = assertGroupedRow(rows[0], { amount: 180, operationId, label: 'Recibo' });
    expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(0, 2);

    const deletion = await deleteGroupedPayment(page, rows[0]);
    expect(String(deletion?.operacion_pago_id || '')).toBe(operationId);
    expect(Number(deletion?.medios_pago_eliminados || 0)).toBe(2);
    expect((deletion?.ids_pago_eliminados || []).map(Number).sort((a, b) => a - b)).toEqual(idsBefore);

    const after = await currentAccount(page, 'client', client.id);
    expect(groupedPaymentRows(after, sale.id), 'No debe quedar ninguna pata del recibo').toHaveLength(0);
    const movement = originalMovementRow(after, sale.id);
    expect(movement, 'La venta original debe seguir existiendo').toBeTruthy();
    expect(Number(movement?.total_pagado || 0)).toBeCloseTo(0, 2);
    expect(Number(after?.totales?.saldo || 0)).toBeCloseTo(180, 2);
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');
  });

  test('orden de pago: cheque + otro medio forman una operación y el cheque vuelve a cartera al revertirla', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    await requireMutations(test, page);

    const sourceClient = await createParty(page, 'client', uniqueName('CC-GROUP-CHQ-CLI', 100));
    const chequeNumber = uniqueChequeNumber();
    const incoming = await createIncomingCheque(page, sourceClient.id, 100, chequeNumber);
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');

    const provider = await createParty(page, 'provider', uniqueName('CC-GROUP-PROV', 100));
    const purchase = await createCreditPurchase(page, provider.id, 180, 'CC-GROUP-COMPRA');
    const lists = await getLists(page, 'compras');
    const otherMethodId = findPaymentMethod(lists, 'non-cheque');

    const payment = expectApiSuccess(
      await authenticatedApi(page, 'ordenes_pago_confirmar_pago', {
        method: 'POST',
        body: {
          ids_movimiento: [purchase.id],
          id_proveedor: provider.id,
          fecha_pago: todayISO(),
          medios_pago: [
            {
              id_medio_pago: incoming.chequeMethodId,
              monto: 100,
              id_cheque: incoming.chequeId,
            },
            { id_medio_pago: otherMethodId, monto: 80 },
          ],
        },
      }),
      'No se pudo crear la orden de pago multimétodo',
    );

    const operationId = String(payment?.operacion_pago_id || '').trim();
    expect(operationId, 'La orden debe devolver operacion_pago_id').not.toBe('');
    expect((payment?.ids_pago || payment?.ids_cobro || []).map(Number).filter(Boolean)).toHaveLength(2);
    await expectChequeState(page, chequeNumber, 'EGRESADO_CARTERA');

    const account = await currentAccount(page, 'provider', provider.id);
    const rows = groupedPaymentRows(account, purchase.id);
    expect(rows, 'Dos medios de la misma OP deben formar una sola fila lógica').toHaveLength(1);
    const idsBefore = assertGroupedRow(rows[0], { amount: 180, operationId, label: 'Orden de pago' });
    expect(Number(account?.totales?.saldo || 0)).toBeCloseTo(0, 2);

    const deletion = await deleteGroupedPayment(page, rows[0]);
    expect(String(deletion?.operacion_pago_id || '')).toBe(operationId);
    expect(Number(deletion?.medios_pago_eliminados || 0)).toBe(2);
    expect((deletion?.ids_pago_eliminados || []).map(Number).sort((a, b) => a - b)).toEqual(idsBefore);
    await expectChequeState(page, chequeNumber, 'EN_CARTERA');

    const after = await currentAccount(page, 'provider', provider.id);
    expect(groupedPaymentRows(after, purchase.id), 'No debe quedar ninguna pata de la orden').toHaveLength(0);
    const movement = originalMovementRow(after, purchase.id);
    expect(movement, 'La compra original debe seguir existiendo').toBeTruthy();
    expect(Number(movement?.total_pagado || 0)).toBeCloseTo(0, 2);
    expect(Number(after?.totales?.saldo || 0)).toBeCloseTo(180, 2);
  });
});
