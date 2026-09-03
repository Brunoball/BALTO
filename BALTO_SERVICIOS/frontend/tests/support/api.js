import { expect } from '@playwright/test';
import { ENV } from './env.js';
import { RUN_PREFIX } from './data.js';

function apiUrl(action, query = {}) {
  const base = ENV.apiURL.replace(/\/$/, '');
  const url = new URL(`${base}/api.php`);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function authenticatedApi(page, action, options = {}) {
  const method = String(options.method || (options.body ? 'POST' : 'GET')).toUpperCase();
  const query = { ...(options.query || {}) };
  if (ENV.allowMutations && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    query.e2e_run = RUN_PREFIX;
  }
  const url = apiUrl(action, query);

  return page.evaluate(async ({ requestUrl, requestMethod, requestBody }) => {
    const sessionKey =
      localStorage.getItem('session_key') ||
      localStorage.getItem('sessionKey') ||
      localStorage.getItem('X-Session') ||
      localStorage.getItem('x_session') ||
      '';
    const token = localStorage.getItem('token') || localStorage.getItem('auth_token') || '';
    const headers = { Accept: 'application/json' };
    if (sessionKey) headers['X-Session'] = sessionKey;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (requestBody !== null) headers['Content-Type'] = 'application/json';

    const response = await fetch(requestUrl, {
      method: requestMethod,
      headers,
      body: requestBody === null ? undefined : JSON.stringify(requestBody),
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { status: response.status, ok: response.ok, body, text };
  }, {
    requestUrl: url,
    requestMethod: method,
    requestBody: options.body ?? null,
  });
}

export function expectApiSuccess(result, message = 'La operación del backend debe finalizar correctamente') {
  expect(result.status, `${message}: HTTP ${result.status} ${result.text || ''}`).toBeLessThan(400);
  expect(
    result.body?.exito !== false && result.body?.success !== false,
    result.body?.mensaje || result.body?.message || message,
  ).toBeTruthy();
  return result.body;
}

function chequeConfig(tipo) {
  const isEcheq = String(tipo || '').toUpperCase() === 'ECHEQ';
  return isEcheq
    ? {
        carteraAction: 'echeq_cartera_listar',
        carteraKey: 'echeqs',
        flujoAction: 'flujos_echeq_listar',
      }
    : {
        carteraAction: 'cheques_cartera_listar',
        carteraKey: 'cheques',
        flujoAction: 'flujo_cheques_listar',
      };
}

function exactCheque(rows, numero) {
  return (Array.isArray(rows) ? rows : []).find(
    (row) => String(row?.numero_cheque || '').trim() === String(numero).trim(),
  ) || null;
}

export async function getChequeSnapshot(page, numero, tipo = 'CHEQUE') {
  const config = chequeConfig(tipo);
  const [carteraResponse, flujoResponse] = await Promise.all([
    authenticatedApi(page, config.carteraAction, {
      query: { q: numero, limit: 200, offset: 0, _: Date.now() },
    }),
    authenticatedApi(page, config.flujoAction, {
      query: { q: numero, limit: 500, offset: 0, _: Date.now() },
    }),
  ]);

  expectApiSuccess(carteraResponse, `No se pudo consultar la cartera para el cheque ${numero}`);
  expectApiSuccess(flujoResponse, `No se pudo consultar el flujo para el cheque ${numero}`);

  const cartera = exactCheque(carteraResponse.body?.[config.carteraKey], numero);
  const flujo = (Array.isArray(flujoResponse.body?.flujo) ? flujoResponse.body.flujo : [])
    .filter((row) => String(row?.numero_cheque || '').trim() === String(numero).trim());
  const current = flujo[0] || cartera;

  return {
    numero: String(numero),
    tipo: String(tipo).toUpperCase(),
    idCheque: Number(current?.id_cheque || cartera?.id_cheque || 0),
    estado: String(current?.estado || (cartera ? 'EN_CARTERA' : '')).trim().toUpperCase(),
    enCartera: Boolean(cartera),
    cartera,
    flujo,
    eventos: flujo.map((row) => String(row?.evento || '').trim().toUpperCase()),
  };
}

export async function expectChequeState(page, numero, estado, tipo = 'CHEQUE') {
  const expected = String(estado).toUpperCase();
  let lastSnapshot = null;

  await expect.poll(async () => {
    lastSnapshot = await getChequeSnapshot(page, numero, tipo);
    return lastSnapshot.estado;
  }, {
    timeout: 45_000,
    intervals: [400, 800, 1_500, 2_500],
    message: `El cheque ${numero} debe quedar en estado ${expected}`,
  }).toBe(expected);

  if (expected === 'EN_CARTERA') {
    expect(lastSnapshot.enCartera, `El cheque ${numero} debe figurar en la cartera activa`).toBe(true);
  } else {
    expect(lastSnapshot.enCartera, `El cheque ${numero} no debe figurar en cartera mientras está ${expected}`).toBe(false);
  }

  return lastSnapshot;
}

export async function expectChequeEvents(page, numero, expectedEvents, tipo = 'CHEQUE') {
  let snapshot = null;
  const wanted = expectedEvents.map((event) => String(event).toUpperCase());

  await expect.poll(async () => {
    snapshot = await getChequeSnapshot(page, numero, tipo);
    return wanted.every((event) => snapshot.eventos.includes(event));
  }, {
    timeout: 45_000,
    intervals: [500, 1_000, 2_000],
    message: `El flujo del cheque ${numero} debe contener ${wanted.join(', ')}`,
  }).toBe(true);

  return snapshot;
}

export async function deleteCurrentAccountPayment(page, idCobro) {
  const result = await authenticatedApi(page, 'cc_eliminar_cobro', {
    method: 'POST',
    body: { id_cobro: Number(idCobro) },
  });
  expectApiSuccess(result, `No se pudo eliminar el pago de cuenta corriente #${idCobro}`);
  return result.body;
}
