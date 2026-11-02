import { expect } from '@playwright/test';
import { authenticatedApi, expectApiSuccess } from './api.js';
import { uniqueName } from './data.js';

// BALTO Servicios · helpers por API para verificar la política única de fechas sin depender de la UI.
// En Servicios los renglones de prueba son conceptos MANUALES: no crean artículos
// ni mueven stock, así las pruebas financieras no dependen del catálogo.
// Todos los nombres llevan el RUN_PREFIX de uniqueName(): el limpiador E2E los reconoce.

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

export function tipoVentaId(lists, nombre) {
  const rows = Array.isArray(lists?.tipos_venta) ? lists.tipos_venta : [];
  const pattern = nombre === 'CONTADO' ? /^CONTADO$/i : /CUENTA\s*CORRIENTE/i;
  const row = rows.find((r) => Number(r?.activo ?? 1) !== 0 && pattern.test(String(r?.nombre || '').trim()));
  expect(row, `Debe existir el tipo de venta ${nombre}`).toBeTruthy();
  return Number(row?.id_tipo_venta || row?.id || 0);
}

/** kind: 'monetario' (no cheque) | 'cheque' (cheque físico, no eCheq) */
export function medioPago(lists, kind = 'monetario') {
  const rows = (Array.isArray(lists?.medios_pago) ? lists.medios_pago : [])
    .filter((r) => Number(r?.activo ?? 1) !== 0)
    .map((r) => ({ id: Number(r?.id_medio_pago || r?.id || 0), nombre: String(r?.nombre || '') }))
    .filter((r) => r.id > 0);
  const row = kind === 'cheque'
    ? rows.find((r) => /CHEQ/i.test(r.nombre) && !/ECHEQ|E-CHEQ|E CHEQ/i.test(r.nombre))
    : (rows.find((r) => /EFECTIVO/i.test(r.nombre)) || rows.find((r) => !/CHEQ/i.test(r.nombre)));
  expect(row, `Debe existir un medio de pago activo (${kind})`).toBeTruthy();
  return row;
}

export async function createParty(page, kind, label) {
  const provider = kind === 'provider';
  const name = uniqueName(label, 100).toUpperCase();
  const body = expectApiSuccess(
    await authenticatedApi(page, provider ? 'cc_proveedor_crear' : 'cc_cliente_crear', {
      method: 'POST',
      body: { nombre: name, activo: 1 },
    }),
    `No se pudo crear ${name}`,
  );
  const key = provider ? 'id_proveedor' : 'id_cliente';
  const id = Number(body?.[key] ?? body?.data?.[key] ?? 0);
  expect(id, `${name} debe devolver ${key}`).toBeGreaterThan(0);
  return { id, name };
}

/**
 * Concepto de prueba. En Servicios no se crea un artículo: el renglón se envía
 * como detalle MANUAL con descripción única (el RUN_PREFIX la identifica).
 */
export async function createProduct(_page, label) {
  return { id: 0, name: uniqueName(label, 100).toUpperCase() };
}

export function movementId(body) {
  return Number(
    body?.id_movimiento ?? body?.id_venta ?? body?.id_compra ??
    body?.data?.id_movimiento ?? body?.data?.id_venta ?? body?.data?.id_compra ??
    (Array.isArray(body?.ids) ? body.ids[0] : 0) ?? 0,
  );
}

export function manualItem(descripcion, amount) {
  return { tipo_item: 'MANUAL', descripcion, cantidad: 1, precio: Number(amount), iva_pct: 0, total: Number(amount) };
}

function movementBody({ fecha, typeId, partyKey, partyId, productName, amount, medios }) {
  const item = {
    fecha, id_tipo_venta: typeId, [partyKey]: Number(partyId),
    ...manualItem(productName || uniqueName('CONCEPTO-FIN', 100).toUpperCase(), amount),
  };
  return { fecha, id_tipo_venta: typeId, [partyKey]: Number(partyId), items: [item], medios_pago: medios };
}

/** Venta por API. medios: [] para cuenta corriente. */
export async function createSale(page, { fecha, typeId, clientId, productName, amount, medios = [] }) {
  const res = await authenticatedApi(page, 'ventas_crear_batch', {
    method: 'POST',
    body: movementBody({ fecha, typeId, partyKey: 'id_cliente', partyId: clientId, productName, amount, medios }),
  });
  return res;
}

export async function createPurchase(page, { fecha, typeId, providerId, productName, amount, medios = [] }) {
  return authenticatedApi(page, 'compras_crear_batch', {
    method: 'POST',
    body: movementBody({ fecha, typeId, partyKey: 'id_proveedor', partyId: providerId, productName, amount, medios }),
  });
}

/** Devuelve las fechas de los medios de pago registrados del movimiento. */
export async function paymentDates(page, action, key, id) {
  const body = expectApiSuccess(
    await authenticatedApi(page, action, { query: { id_movimiento: id, _: Date.now() } }),
    `No se pudo leer ${action} #${id}`,
  );
  const mov = body?.[key] || body?.data?.[key] || {};
  const medios = mov?.medios_pago_detalle_original || mov?.medios_pago_detalle || [];
  return { mov, fechas: medios.map((m) => String(m?.fecha_pago || '').slice(0, 10)) };
}

/** Fila de Flujo de Caja de un día: ingresos, egresos y saldo de cierre. */
export async function cashFlowDay(page, dia) {
  const data = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_resumen', {
    query: { fecha_desde: dia, fecha_hasta: dia, _: Date.now() },
  }), `Flujo de Caja debe responder para ${dia}`);
  const row = (data?.tiendas?.[0]?.rows || []).find((r) => r.fecha === dia);
  expect(row, `Flujo de Caja debe incluir ${dia}`).toBeTruthy();
  return {
    ingresos: Number(row.ingresos || 0),
    egresos: Number(row.egresos || 0),
    saldo: Number(row.saldo || 0),
    medios: Array.isArray(row.medios_pago) ? row.medios_pago : [],
  };
}

export async function financialAnalysis(page, desde, hasta) {
  return expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', {
    query: { fecha_desde: desde, fecha_hasta: hasta, _: Date.now() },
  }), 'Análisis Financiero debe responder');
}

export function expectRejected(res, pattern) {
  const failed = res.status >= 400 || res.body?.exito === false;
  expect(failed, `Se esperaba un rechazo: HTTP ${res.status} ${res.text}`).toBeTruthy();
  if (pattern) expect(String(res.body?.mensaje || res.body?.message || res.text)).toMatch(pattern);
}

/** Borrado best-effort: si falla, el limpiador E2E del worker lo elimina por RUN_PREFIX. */
export async function deleteMovement(page, action, id) {
  if (!(Number(id) > 0)) return;
  await authenticatedApi(page, action, { method: 'POST', body: { id_movimiento: Number(id) } }).catch(() => null);
}
