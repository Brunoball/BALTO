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

function sessionKeyFromStorageState(state) {
  let preferredOrigin = '';
  try { preferredOrigin = new URL(ENV.baseURL).origin; } catch {}

  const origins = [...(state?.origins || [])].sort((a, b) => {
    if (a.origin === preferredOrigin) return -1;
    if (b.origin === preferredOrigin) return 1;
    return 0;
  });

  for (const origin of origins) {
    const session = (origin.localStorage || []).find((item) => item.name === 'session_key');
    const key = String(session?.value || '').trim();
    if (key) return key;
  }

  return '';
}

async function authenticatedSessionKey(page) {
  const state = await page.context().storageState();
  const sessionKey = sessionKeyFromStorageState(state);

  if (!sessionKey) {
    throw new Error(
      'No hay session_key disponible en el storageState del contexto Playwright. ' +
      'La fixture de autenticación debe instalar la sesión antes de llamar authenticatedApi().',
    );
  }

  return sessionKey;
}

const SAFE_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TRANSIENT_READ_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientTransportError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return [
    'socket hang up',
    'econnreset',
    'enetreset',
    'etimedout',
    'econnaborted',
    'econnrefused',
    'epipe',
    'fetch failed',
    'network socket disconnected',
    'client network socket disconnected',
  ].some((needle) => message.includes(needle));
}

async function fetchWithSafeReadRetry(request, url, requestOptions, method) {
  const safeRead = SAFE_READ_METHODS.has(method);
  const maxAttempts = safeRead ? 1 + TRANSIENT_READ_RETRIES : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const headers = { ...(requestOptions.headers || {}) };

      // Si una conexión keep-alive remota quedó inválida durante una suite larga,
      // el reintento abre una conexión nueva. El primer intento conserva el camino
      // normal para no penalizar todas las lecturas con un handshake adicional.
      if (attempt > 1) headers.Connection = 'close';

      return await request.fetch(url, {
        ...requestOptions,
        headers,
      });
    } catch (error) {
      lastError = error;

      // Nunca se reintentan mutaciones: un POST/PUT/PATCH/DELETE pudo haber llegado
      // al servidor aunque el socket se cortara antes de recibir la respuesta.
      if (!safeRead || !isTransientTransportError(error) || attempt === maxAttempts) {
        throw error;
      }

      const actionName = (() => {
        try { return new URL(url).searchParams.get('action') || url; } catch { return url; }
      })();
      console.warn(
        `[Playwright API retry] ${method} ${actionName}: corte transitorio de red; ` +
        `reintento ${attempt}/${maxAttempts - 1}. ${String(error?.message || error)}`,
      );
      await sleep(350 * attempt);
    }
  }

  throw lastError;
}

export async function authenticatedApi(page, action, options = {}) {
  const method = String(options.method || (options.body ? 'POST' : 'GET')).toUpperCase();
  const query = { ...(options.query || {}) };
  for (const forbidden of ['session_key', 'sessionKey', 'x_session', 'X-Session']) {
    if (Object.prototype.hasOwnProperty.call(query, forbidden)) {
      throw new Error(`El testing no permite credenciales de sesión en query string (${forbidden}). Usá X-Session.`);
    }
  }
  if (options.body && typeof options.body === 'object') {
    for (const forbidden of ['session_key', 'sessionKey', 'x_session', 'X-Session']) {
      if (Object.prototype.hasOwnProperty.call(options.body, forbidden)) {
        throw new Error(`El testing no permite credenciales de sesión en el body (${forbidden}). Usá X-Session.`);
      }
    }
  }
  if (ENV.allowMutations && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    query.e2e_run = RUN_PREFIX;
  }
  const url = apiUrl(action, query);
  const sessionKey = await authenticatedSessionKey(page);
  const headers = {
    Accept: 'application/json',
    'X-Session': sessionKey,
  };

  if (options.body !== undefined && options.body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  // Las llamadas auxiliares de la suite no deben depender del execution context
  // de React. Si la SPA navega o redirige al login mientras corre una llamada,
  // page.evaluate()/fetch puede destruirse a mitad de request. APIRequestContext
  // vive a nivel BrowserContext y conserva la llamada aunque cambie la página.
  const response = await fetchWithSafeReadRetry(page.context().request, url, {
    method,
    headers,
    data: options.body ?? undefined,
    failOnStatusCode: false,
    timeout: ENV.timeoutMs,
  }, method);

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  return {
    status: response.status(),
    ok: response.ok(),
    body,
    text,
  };
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
