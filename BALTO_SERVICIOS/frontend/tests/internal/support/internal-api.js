import { expect } from '@playwright/test';
import { ENV } from '../../support/env.js';
import { RUN_PREFIX, todayISO, uniqueName } from '../../support/data.js';
import { authenticatedApi, expectApiSuccess } from '../../support/api.js';

function apiUrl(action, query = {}) {
  const base = ENV.apiURL.replace(/\/+$/, '');
  const url = new URL(`${base}/api.php`);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function sessionKey(page) {
  let currentOrigin = '';
  let expectedOrigin = '';
  try { currentOrigin = new URL(String(page.url() || '')).origin; } catch {}
  try { expectedOrigin = new URL(ENV.baseURL).origin; } catch {}

  if (!currentOrigin || !expectedOrigin || currentOrigin !== expectedOrigin) {
    await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
  }

  const key = await page.evaluate(() => String(localStorage.getItem('session_key') || '').trim());
  expect(key, 'La suite interna necesita una sesión ADMIN válida en X-Session').not.toBe('');
  return key;
}

async function requestWithSession(page, key, action, options = {}) {
  const method = String(options.method || (options.body ? 'POST' : 'GET')).toUpperCase();
  const query = { ...(options.query || {}) };
  if (ENV.allowMutations && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    query.e2e_run = RUN_PREFIX;
  }

  const headers = {
    Accept: 'application/json',
    'X-Session': key,
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };

  const response = await page.context().request.fetch(apiUrl(action, query), {
    method,
    headers,
    data: options.body,
    failOnStatusCode: false,
    timeout: options.timeout ?? 120_000,
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: response.status(), ok: response.ok(), body, text };
}

export async function directAuthenticatedApi(page, action, options = {}) {
  return requestWithSession(page, await sessionKey(page), action, options);
}

export async function concurrentAuthenticatedApi(page, requests) {
  const key = await sessionKey(page);
  return Promise.all(requests.map((request) =>
    requestWithSession(page, key, request.action, request.options || {})
  ));
}

function unwrapLists(body) {
  return body?.listas && typeof body.listas === 'object' ? body.listas : body;
}

export async function getLists(page, context = 'ventas') {
  const body = expectApiSuccess(
    await authenticatedApi(page, 'global_obtener_listas', {
      query: { contexto: context, include_sin_stock: 1, _: Date.now() },
    }),
    `No se pudieron cargar listas globales (${context})`,
  );
  return unwrapLists(body);
}

export function findAccountCurrentType(lists) {
  const rows = Array.isArray(lists?.tipos_venta) ? lists.tipos_venta : [];
  const row = rows.find((item) =>
    Number(item?.activo ?? 1) !== 0 && /CUENTA\s*CORRIENTE/i.test(String(item?.nombre || ''))
  );
  expect(row, 'Debe existir el tipo CUENTA CORRIENTE').toBeTruthy();
  return Number(row?.id_tipo_venta || row?.id || 0);
}

export function findPaymentMethod(lists, kind = 'non-cheque') {
  const rows = Array.isArray(lists?.medios_pago) ? lists.medios_pago : [];
  const active = rows.filter((item) => Number(item?.activo ?? 1) !== 0);
  const isElectronic = (name) => /ECHEQ|E-CHEQ|E CHEQ|ELECTR[ÓO]NICO/i.test(name);
  const isCheque = (name) => /CHEQ/i.test(name);

  let row = null;
  if (kind === 'cheque') {
    row = active.find((item) => isCheque(String(item?.nombre || '')) && !isElectronic(String(item?.nombre || '')));
  } else if (kind === 'echeq') {
    row = active.find((item) => isElectronic(String(item?.nombre || '')));
  } else {
    row = active.find((item) => !isCheque(String(item?.nombre || '')));
  }

  expect(row, `Debe existir un medio de pago activo (${kind})`).toBeTruthy();
  return Number(row?.id_medio_pago || row?.id || 0);
}

export function calculateAmounts(quantity, price, ivaPct) {
  const q = Number(quantity);
  const p = Math.round(Number(price) * 100) / 100;
  const iva = Math.round(Number(ivaPct) * 100) / 100;
  const subtotal = Math.round((q * p + Number.EPSILON) * 100) / 100;
  const ivaAmount = Math.round((subtotal * iva / 100 + Number.EPSILON) * 100) / 100;
  const total = Math.round((subtotal + ivaAmount + Number.EPSILON) * 100) / 100;
  return { subtotal, ivaAmount, total };
}

export async function createParty(page, kind, name = uniqueName(kind === 'provider' ? 'INT-PROV' : 'INT-CLI', 120)) {
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

export async function createManualCreditSale(page, options = {}) {
  const lists = await getLists(page, 'ventas');
  const typeId = findAccountCurrentType(lists);
  const date = options.date || todayISO();
  const quantity = Number(options.quantity ?? 1);
  const price = Number(options.price ?? 100);
  const ivaPct = Number(options.ivaPct ?? 0);
  const amounts = calculateAmounts(quantity, price, ivaPct);
  const description = String(options.description || uniqueName('INT-VENTA', 120));

  const item = {
    fecha: date,
    id_tipo_venta: typeId,
    id_cliente: Number(options.clientId),
    descripcion: description,
    cantidad: quantity,
    precio: price,
    iva_pct: ivaPct,
    // El validator exige total > 0 en el payload, pero el backend recalcula y
    // persiste sus propios subtotal/IVA/total.
    total: Number(options.fakeClientTotal ?? amounts.total),
  };
  if (options.articleId) {
    item.id_articulo = Number(options.articleId);
    item.id_stock_producto = Number(options.articleId);
  }

  const result = await directAuthenticatedApi(page, 'ventas_crear_batch', {
    method: 'POST',
    body: {
      fecha: date,
      id_tipo_venta: typeId,
      id_cliente: Number(options.clientId),
      items: [item],
      medios_pago: [],
    },
  });

  if (options.expectFailure) return { result, amounts, description, typeId };
  const body = expectApiSuccess(result, `No se pudo crear venta interna ${description}`);
  const id = Number(body?.id_movimiento || body?.id_venta || body?.ids?.[0] || 0);
  expect(id, `La venta ${description} debe devolver id_movimiento`).toBeGreaterThan(0);
  return { result, body, id, amounts, description, typeId };
}

export async function createMultiItemCreditSale(page, options = {}) {
  const lists = await getLists(page, 'ventas');
  const typeId = findAccountCurrentType(lists);
  const date = options.date || todayISO();
  const items = (options.items || []).map((item) => {
    const amounts = calculateAmounts(item.quantity, item.price, item.ivaPct ?? 0);
    return {
      fecha: date,
      id_tipo_venta: typeId,
      id_cliente: Number(options.clientId),
      id_articulo: Number(item.articleId),
      id_stock_producto: Number(item.articleId),
      descripcion: String(item.description || uniqueName('INT-ITEM', 120)),
      cantidad: Number(item.quantity),
      precio: Number(item.price),
      iva_pct: Number(item.ivaPct ?? 0),
      total: amounts.total,
    };
  });
  return directAuthenticatedApi(page, 'ventas_crear_batch', {
    method: 'POST',
    body: {
      fecha: date,
      id_tipo_venta: typeId,
      id_cliente: Number(options.clientId),
      items,
      medios_pago: [],
    },
  });
}

export async function payCreditSale(page, options = {}) {
  const lists = await getLists(page, 'recibos');
  const paymentMethodId = Number(options.paymentMethodId || findPaymentMethod(lists, 'non-cheque'));
  const result = await directAuthenticatedApi(page, 'recibos_confirmar_pago', {
    method: 'POST',
    body: {
      ids_movimiento: [Number(options.saleId)],
      id_cliente: Number(options.clientId),
      fecha_pago: options.date || todayISO(),
      medios_pago: [{
        id_medio_pago: paymentMethodId,
        monto: Number(options.amount),
      }],
    },
  });
  const body = expectApiSuccess(result, `No se pudo registrar cobro interno de ${options.amount}`);
  return { result, body, paymentMethodId };
}

export async function createIncomingChequeFromSale(page, options = {}) {
  const sale = await createManualCreditSale(page, {
    clientId: options.clientId,
    description: options.description || uniqueName('INT-ORIGEN-CHQ', 120),
    quantity: 1,
    price: Number(options.amount),
    ivaPct: 0,
  });
  const lists = await getLists(page, 'recibos');
  const paymentMethodId = findPaymentMethod(lists, options.type === 'ECHEQ' ? 'echeq' : 'cheque');
  const date = options.date || todayISO();
  const cheque = {
    emisor: String(options.issuer || uniqueName('INT-BANCO', 120)),
    numero_cheque: String(options.number),
    numero: String(options.number),
    importe: Number(options.amount),
    fecha_emision: date,
    fecha_pago: date,
    fecha_evento: date,
  };
  const result = await directAuthenticatedApi(page, 'recibos_confirmar_pago', {
    method: 'POST',
    body: {
      ids_movimiento: [sale.id],
      id_cliente: Number(options.clientId),
      fecha_pago: date,
      medios_pago: [{
        id_medio_pago: paymentMethodId,
        monto: Number(options.amount),
        frontend_row_uid: `${RUN_PREFIX}-CHQ`,
        cheque,
      }],
    },
  });
  const body = expectApiSuccess(result, 'No se pudo ingresar el cheque de la prueba interna');
  const created = Array.isArray(body?.cheques_creados) ? body.cheques_creados[0] : null;
  const chequeId = Number(created?.id_cheque || 0);
  expect(chequeId, 'El recibo debe devolver el cheque recién creado').toBeGreaterThan(0);
  return { sale, result, body, chequeId, cheque, paymentMethodId };
}

export async function getCurrentAccount(page, clientId) {
  const body = expectApiSuccess(
    await authenticatedApi(page, 'cc_historial_cliente', {
      query: { id_cliente: Number(clientId), _: Date.now() },
    }),
    `No se pudo consultar cuenta corriente del cliente #${clientId}`,
  );
  return body;
}

export async function deleteSale(page, id) {
  if (!Number(id)) return null;
  return directAuthenticatedApi(page, 'ventas_eliminar', {
    method: 'POST',
    body: { id_movimiento: Number(id) },
  });
}

export async function deletePurchase(page, id) {
  if (!Number(id)) return null;
  return directAuthenticatedApi(page, 'compras_eliminar', {
    method: 'POST',
    body: { id_movimiento: Number(id) },
  });
}

export async function internalIntegrity(page, scope = 'prefix') {
  const query = { scope };
  if (scope === 'prefix') query.prefix = RUN_PREFIX;
  const body = expectApiSuccess(
    await authenticatedApi(page, 'config_testing_e2e_integrity', { query }),
    'No se pudo ejecutar la auditoría interna E2E',
  );
  return body;
}

export function expectExactlyOneSuccess(results, label) {
  const successes = results.filter((result) => result.status < 400 && result.body?.exito !== false && result.body?.success !== false);
  const failures = results.filter((result) => !successes.includes(result));
  expect(successes, `${label}: exactamente una request debe confirmar`).toHaveLength(1);
  expect(failures, `${label}: exactamente una request debe ser rechazada`).toHaveLength(1);
  expect(failures[0].status, `${label}: el rechazo debe ser HTTP >= 400`).toBeGreaterThanOrEqual(400);
  return { success: successes[0], failure: failures[0] };
}

export function extractMovementId(body = {}) {
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

export async function getProviderCurrentAccount(page, providerId) {
  const body = expectApiSuccess(
    await authenticatedApi(page, 'cc_historial_proveedor', {
      query: { id_proveedor: Number(providerId), _: Date.now() },
    }),
    `No se pudo consultar cuenta corriente del proveedor #${providerId}`,
  );
  return body;
}

export async function payCreditPurchase(page, options = {}) {
  const lists = await getLists(page, 'compras');
  const paymentMethodId = Number(options.paymentMethodId || findPaymentMethod(lists, 'non-cheque'));
  const result = await directAuthenticatedApi(page, 'ordenes_pago_confirmar_pago', {
    method: 'POST',
    body: {
      ids_movimiento: [Number(options.purchaseId)],
      id_proveedor: Number(options.providerId),
      fecha_pago: options.date || todayISO(),
      medios_pago: [{
        id_medio_pago: paymentMethodId,
        monto: Number(options.amount),
      }],
    },
  });
  const body = expectApiSuccess(result, `No se pudo registrar orden de pago interna de ${options.amount}`);
  return { result, body, paymentMethodId };
}

export async function getSaleDetail(page, movementId) {
  const body = expectApiSuccess(
    await authenticatedApi(page, 'ventas_obtener', {
      query: { id_movimiento: Number(movementId), _: Date.now() },
    }),
    `No se pudo obtener la venta #${movementId}`,
  );
  return body?.venta || body?.data?.venta || body;
}

export async function getPurchaseDetail(page, movementId) {
  const body = expectApiSuccess(
    await authenticatedApi(page, 'compras_obtener', {
      query: { id_movimiento: Number(movementId), _: Date.now() },
    }),
    `No se pudo obtener la compra #${movementId}`,
  );
  return body?.compra || body?.data?.compra || body;
}

export async function attemptIncomingChequePayment(page, options = {}) {
  const lists = await getLists(page, 'recibos');
  const type = String(options.type || 'CHEQUE').toUpperCase();
  const paymentMethodId = Number(options.paymentMethodId || findPaymentMethod(lists, type === 'ECHEQ' ? 'echeq' : 'cheque'));
  const date = options.date || todayISO();
  const numero = String(options.number || '');
  const cheque = {
    emisor: String(options.issuer || uniqueName('INT-BANCO', 120)),
    numero_cheque: numero,
    numero,
    importe: Number(options.amount),
    fecha_emision: date,
    fecha_pago: date,
    fecha_evento: date,
  };
  const result = await directAuthenticatedApi(page, 'recibos_confirmar_pago', {
    method: 'POST',
    body: {
      ids_movimiento: [Number(options.saleId)],
      id_cliente: Number(options.clientId),
      fecha_pago: date,
      medios_pago: [{
        id_medio_pago: paymentMethodId,
        monto: Number(options.amount),
        frontend_row_uid: `${RUN_PREFIX}-CHQ-${Date.now().toString(36)}`,
        cheque,
      }],
    },
  });
  return { result, paymentMethodId, cheque };
}
