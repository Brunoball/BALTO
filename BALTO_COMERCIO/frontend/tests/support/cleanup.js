import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { AUTH_FILE, ENV, assertSafeMutationConfiguration } from './env.js';

const CONFIRMATION = 'BORRAR_SOLO_DATOS_PLAYWRIGHT';
const CLEANUP_ACTION = 'config_testing_e2e_cleanup';
const STATUS_ACTION = 'config_testing_e2e_status';

function endpoint(action) {
  const base = String(ENV.apiURL || '').replace(/\/+$/, '');
  const url = new URL(`${base}/api.php`);
  url.searchParams.set('action', action);
  return url.toString();
}

function normalizeResult(status, text) {
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status, ok: status >= 200 && status < 300, body, text };
}

function authFromStorageState(state) {
  let preferredOrigin = '';
  try {
    preferredOrigin = new URL(ENV.baseURL).origin;
  } catch {
    preferredOrigin = '';
  }

  const origins = [...(state?.origins || [])].sort((a, b) => {
    if (a.origin === preferredOrigin) return -1;
    if (b.origin === preferredOrigin) return 1;
    return 0;
  });

  let sessionKey = '';
  let token = '';
  for (const origin of origins) {
    const map = new Map((origin.localStorage || []).map((entry) => [entry.name, entry.value]));
    sessionKey =
      map.get('session_key') ||
      map.get('sessionKey') ||
      map.get('X-Session') ||
      map.get('x_session') ||
      '';
    token = map.get('token') || map.get('auth_token') || '';
    if (sessionKey || token) break;
  }

  if (!sessionKey && !token) {
    throw new Error(
      '[Playwright cleanup] No se encontró session_key/token en el storageState. ' +
      'No se ejecuta una limpieza mutante sin autenticación explícita.',
    );
  }

  return { sessionKey, token };
}

function authFromStorageFile() {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(`No existe el storageState de Playwright: ${AUTH_FILE}`);
  }

  const state = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  return authFromStorageState(state);
}

function rawHttpRequest(url, { method, headers, payload, timeoutMs = 120_000 }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const requestHeaders = {
      ...headers,
      Connection: 'close',
      ...(payload !== null
        ? { 'Content-Length': Buffer.byteLength(payload, 'utf8') }
        : {}),
    };

    const req = transport.request(
      url,
      {
        method,
        headers: requestHeaders,
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.setEncoding('utf8');
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: Number(res.statusCode || 0),
            text: chunks.join(''),
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(
          `[Playwright cleanup] El backend tardó más de ${Math.round(timeoutMs / 1000)} segundos en responder.`,
        ),
      );
    });
    req.on('error', reject);

    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function nodeApi(action, { method = 'GET', body = null, query = {}, auth = null } = {}) {
  const url = new URL(endpoint(action));
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const { sessionKey, token } = auth || authFromStorageFile();
  const headers = { Accept: 'application/json' };
  if (sessionKey) headers['X-Session'] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;

  const payload = body === null ? null : JSON.stringify(body);
  if (payload !== null) headers['Content-Type'] = 'application/json';

  // No usamos fetch/undici acá. En Windows hubo corridas donde, aun con todos
  // los tests finalizados y el cleanup completado, Node terminaba con
  // UV_HANDLE_CLOSING al cerrar handles internos de fetch. Una request HTTP(S)
  // corta, sin keep-alive y con Connection: close evita dejar esos handles
  // pendientes y mantiene la limpieza fuera del fetch interceptado por Balto.
  const result = await rawHttpRequest(url, {
    method,
    headers,
    payload,
    timeoutMs: 120_000,
  });

  return normalizeResult(result.status, result.text);
}

function isTransientCleanupStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

function cleanupSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nodeApiWithRetry(action, options = {}) {
  const attempts = 6;
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastResult = await nodeApi(action, options);
      lastError = null;
      if (!isTransientCleanupStatus(lastResult.status) || attempt === attempts) {
        return lastResult;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }

    await cleanupSleep(Math.min(8_000, 1_000 * (2 ** (attempt - 1))));
  }

  if (lastResult) return lastResult;
  throw lastError || new Error('[Playwright cleanup] No se pudo completar la limpieza.');
}

function assertCleanupResult(result, phase) {
  if (!result.ok || result.body?.exito === false) {
    throw new Error(
      `[Playwright cleanup] ${phase}: HTTP ${result.status}. ` +
      `${result.body?.mensaje || result.text || 'Falló la limpieza E2E.'}`,
    );
  }

  const remaining = Number(result.body?.restantes_total || 0);
  if (remaining !== 0) {
    throw new Error(
      `[Playwright cleanup] ${phase}: quedaron ${remaining} registro(s) E2E sin eliminar. ` +
      JSON.stringify(result.body?.restantes || {}),
    );
  }

  const storageErrors = Array.isArray(result.body?.archivos_storage_errores)
    ? result.body.archivos_storage_errores
    : [];
  if (storageErrors.length) {
    throw new Error(
      `[Playwright cleanup] ${phase}: la BD quedó limpia, pero ${storageErrors.length} ` +
      `archivo(s) físico(s) no pudieron borrarse. ` +
      JSON.stringify(storageErrors),
    );
  }

  const deleted = Number(result.body?.eliminados_total || 0);
  console.log(
    `[Playwright cleanup] ${phase}: ${deleted} registro(s)/archivo(s) E2E eliminados.`,
  );
  return result.body;
}

function shouldRunCleanup() {
  return Boolean(ENV.cleanup && ENV.allowMutations);
}

export async function cleanupE2EWithPage(
  page,
  { scope = 'all', prefix = '', phase = 'inicio' } = {},
) {
  if (!shouldRunCleanup()) return null;
  assertSafeMutationConfiguration();

  // IMPORTANTE: no usamos window.fetch de la aplicación. Balto envuelve ese
  // fetch con un timeout corto para requests de UI y podía abortar una limpieza
  // legítima antes de que el PHP terminara. Tomamos la autenticación del
  // storageState del contexto y hacemos la llamada directamente desde Node.
  const state = await page.context().storageState();
  const auth = authFromStorageState(state);
  const result = await nodeApiWithRetry(CLEANUP_ACTION, {
    method: 'POST',
    auth,
    body: {
      confirmacion: CONFIRMATION,
      scope,
      ...(prefix ? { prefix } : {}),
    },
  });
  return assertCleanupResult(result, phase);
}

export async function cleanupE2EFromStorage(
  { scope = 'prefix', prefix = '', phase = 'fin' } = {},
) {
  if (!shouldRunCleanup()) return null;
  assertSafeMutationConfiguration();

  const result = await nodeApiWithRetry(CLEANUP_ACTION, {
    method: 'POST',
    body: {
      confirmacion: CONFIRMATION,
      scope,
      ...(prefix ? { prefix } : {}),
    },
  });
  return assertCleanupResult(result, phase);
}

export async function e2eCleanupStatusFromStorage(
  { scope = 'prefix', prefix = '' } = {},
) {
  if (!shouldRunCleanup()) return null;
  assertSafeMutationConfiguration();

  const result = await nodeApiWithRetry(STATUS_ACTION, {
    query: { scope, ...(prefix ? { prefix } : {}) },
  });

  if (!result.ok || result.body?.exito === false) {
    throw new Error(
      `No se pudo consultar el estado de limpieza E2E: HTTP ${result.status}. ` +
      `${result.body?.mensaje || result.text || ''}`,
    );
  }

  return result.body;
}
