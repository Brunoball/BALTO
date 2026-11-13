import { expect } from '@playwright/test';
import { authenticatedApi, expectApiSuccess } from './api.js';
import { AUTH_FILE, ENV, patchContextNavigation, patchPageNavigation } from './env.js';
import authGateway from './auth-gateway.cjs';

const { readAuthResponse, requireJson, authHttpError } = authGateway;

// Antes se renovaba el login por antigüedad del archivo (.auth/user.json).
// Ese archivo no indica caducidad real y multiplicaba solicitudes a Hostinger.
// Se confirma el token con la API como máximo una vez cada 5 minutos por worker.
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_INVALID_CODES = new Set([
  'SESSION_REQUIRED', 'SESSION_INVALID', 'SESSION_REVOKED', 'SESSION_EXPIRED',
]);
let validatedKey = '';
let validatedAt = 0;

function loginEndpoint() {
  const base = String(ENV.loginApiURL || '').trim().replace(/\/+$/, '');
  return `${base}/api.php?action=inicio`;
}

function commerceSessionEndpoint() {
  const base = String(ENV.apiURL || '').trim().replace(/\/+$/, '');
  return `${base}/api.php?action=auth_session_check`;
}

function storageAuth(state) {
  let preferredOrigin = '';
  try {
    preferredOrigin = new URL(ENV.baseURL).origin;
  } catch {}

  const origins = [...(state?.origins || [])].sort((a, b) => {
    if (a.origin === preferredOrigin) return -1;
    if (b.origin === preferredOrigin) return 1;
    return 0;
  });

  for (const origin of origins) {
    const values = new Map((origin.localStorage || []).map((item) => [item.name, item.value]));
    const sessionKey = String(
      values.get('session_key') || values.get('sessionKey') || values.get('X-Session') || '',
    ).trim();
    if (sessionKey) return sessionKey;
  }

  return '';
}

function isRetryableLoginStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTransportError(error) {
  const text = String(error?.message || error || '').toUpperCase();
  return (
    text.includes('ECONNRESET') ||
    text.includes('ETIMEDOUT') ||
    text.includes('ECONNREFUSED') ||
    text.includes('EPIPE') ||
    text.includes('SOCKET HANG UP') ||
    text.includes('FETCH FAILED')
  );
}

async function validateCommerceSessionWithRetry(request, sessionKey) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request.get(commerceSessionEndpoint(), {
        headers: {
          'X-Session': sessionKey,
          Authorization: `Bearer ${sessionKey}`,
          Accept: 'application/json',
          Connection: 'close',
        },
        timeout: 30_000,
        failOnStatusCode: false,
      });
      const info = await readAuthResponse(response, 'BALTO_COMERCIO auth_session_check');
      await response.dispose().catch(() => null);

      // Sólo reintentamos errores de infraestructura transitorios. Un reto
      // Hostinger lanza HOSTINGER_CDN_CHALLENGE antes de entrar en este bloque.
      if (isRetryableLoginStatus(info.status) && attempt < attempts) {
        await sleep(Math.min(4_000, 700 * (2 ** (attempt - 1))));
        continue;
      }

      const body = requireJson(info, 'BALTO_COMERCIO auth_session_check');
      if (info.status === 401 && SESSION_INVALID_CODES.has(String(body?.codigo || ''))) {
        return false; // La API confirmó que la sesión ya no es válida.
      }
      if (info.status !== 200 || body?.exito !== true || body?.sesion_valida === false) {
        throw authHttpError('BALTO_COMERCIO auth_session_check', info);
      }
      return true;
    } catch (error) {
      // Un 403 de CDN, error real de permisos o JSON inválido nunca debe
      // convertirse en un login nuevo (ni provocar una cadena de reintentos).
      if (error?.code === 'HOSTINGER_CDN_CHALLENGE' ||
          !isRetryableTransportError(error) || attempt === attempts) {
        throw error;
      }
      await sleep(Math.min(4_000, 700 * (2 ** (attempt - 1))));
    }
  }
  throw new Error('No se pudo comprobar la sesión de BALTO_COMERCIO.');
}

async function loginWithRetry(request, username, password) {
  const attempts = 4;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request.post(loginEndpoint(), {
        data: { nombre: username, contrasena: password },
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Connection: 'close',
        },
        timeout: 30_000,
        failOnStatusCode: false,
      });
      const info = await readAuthResponse(response, 'BALTO_LOGIN inicio');
      await response.dispose().catch(() => null);

      if (isRetryableLoginStatus(info.status) && attempt < attempts) {
        await sleep(Math.min(4_000, 700 * (2 ** (attempt - 1))));
        continue;
      }
      const body = requireJson(info, 'BALTO_LOGIN inicio');
      if (info.status >= 400 || body?.exito !== true) {
        throw authHttpError('BALTO_LOGIN inicio', info);
      }
      const sessionKey = String(body?.session_key || '').trim();
      expect(sessionKey, 'BALTO_LOGIN no devolvió session_key.').not.toBe('');
      return {
        sessionKey,
        usuario: body?.usuario && typeof body.usuario === 'object'
          ? body.usuario
          : { usuario: username },
      };
    } catch (error) {
      if (error?.code === 'HOSTINGER_CDN_CHALLENGE' ||
          !isRetryableTransportError(error) || attempt === attempts) {
        throw error;
      }
      await sleep(Math.min(4_000, 700 * (2 ** (attempt - 1))));
    }
  }
  throw new Error('No se pudo iniciar sesión en BALTO_LOGIN.');
}

async function installSession(page, auth, { persist = false } = {}) {
  const userJson = JSON.stringify(auth.usuario || {});

  await page.addInitScript(
    ({ key, usuario }) => {
      localStorage.setItem('session_key', key);
      localStorage.setItem('usuario', usuario);
      localStorage.removeItem('token');
    },
    { key: auth.sessionKey, usuario: userJson },
  );

  // La renovación automática puede ocurrir en mitad de una corrida larga.
  // Esperamos a que la carga inicial del Dashboard quede completamente estable
  // antes de devolver la página al test siguiente. Así no queda un
  // dashboard_resumen anterior en vuelo que el test de single-flight pueda
  // interpretar como una petición duplicada de la navegación que él mismo hace.
  await page.goto('/panel/dashboard', { waitUntil: 'networkidle', timeout: 45_000 });
  await page.evaluate(
    ({ key, usuario }) => {
      localStorage.setItem('session_key', key);
      localStorage.setItem('usuario', usuario);
      localStorage.removeItem('token');
    },
    { key: auth.sessionKey, usuario: userJson },
  );

  if (persist) {
    await page.context().storageState({ path: AUTH_FILE });
  }
}

export async function ensureAdministratorSession(page) {
  const state = await page.context().storageState();
  const currentKey = storageAuth(state);
  const now = Date.now();

  // Cada test dispone de su propio contexto, cargado desde el storageState del
  // setup. Evitamos una consulta remota por test sin dejar de verificar el
  // backend periódicamente (y en cada worker nuevo).
  if (currentKey && currentKey === validatedKey &&
      now - validatedAt < SESSION_CHECK_INTERVAL_MS) return;

  if (currentKey) {
    const isValid = await validateCommerceSessionWithRetry(page.context().request, currentKey);
    if (isValid) {
      validatedKey = currentKey;
      validatedAt = Date.now();
      return;
    }
  }

  // Sólo se inicia sesión si faltaba token o si la API respondió explícitamente
  // 401 con un código SESSION_* admitido. No renovamos por TTL del archivo,
  // fallos de red ni por desafíos del CDN.
  const auth = await loginWithRetry(page.context().request, ENV.user, ENV.password);
  await installSession(page, auth, { persist: true });
  validatedKey = auth.sessionKey;
  validatedAt = Date.now();
}

export async function createEmployeeTestUser(page, username, password) {
  // authenticatedApi lee la sesión desde localStorage. Un Page recién creado puede
  // seguir en about:blank, donde Chromium bloquea localStorage con SecurityError.
  // Entramos primero al origen de Balto para usar la sesión del storageState.
  if (!/^https?:/i.test(String(page.url() || ''))) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  const list = await authenticatedApi(page, 'configuracion_usuarios_listar');
  const body = expectApiSuccess(list, 'No se pudieron listar roles para crear el empleado E2E');
  const employeeRole = (Array.isArray(body?.roles) ? body.roles : []).find(
    (role) => String(role?.tipo_rol || '').toLowerCase() === 'empleado_basico',
  );
  const roleId = Number(employeeRole?.id_rol || 0);
  expect(roleId, 'Debe existir el rol empleado_basico').toBeGreaterThan(0);

  const create = await authenticatedApi(page, 'configuracion_usuarios_guardar', {
    method: 'POST',
    body: {
      usuario: username,
      email_recuperacion: `${String(username).toLowerCase()}@example.test`,
      id_rol: roleId,
      idRolMaster: roleId,
      tema: 'claro',
      activo: 1,
      contrasena: password,
    },
  });
  expectApiSuccess(create, 'No se pudo crear el empleado E2E');
  return create.body;
}

export async function cleanupTestUser(page, username) {
  try {
    const list = await authenticatedApi(page, 'configuracion_usuarios_listar');
    if (!list.ok || list.body?.exito === false) return;
    const user = (Array.isArray(list.body?.usuarios) ? list.body.usuarios : []).find(
      (row) => String(row?.usuario || '').trim().toUpperCase() === String(username).trim().toUpperCase(),
    );
    const id = Number(user?.idUsuarioMaster || user?.id_usuario_master || 0);
    if (!id) return;
    await authenticatedApi(page, 'configuracion_usuarios_eliminar', {
      method: 'POST',
      body: { idUsuarioMaster: id },
    });
  } catch {
    // El cleanup global PW también identifica y elimina usuarios de prueba.
  }
}

export async function loginTestUserInNewContext(browser, username, password) {
  const context = await browser.newContext({
    baseURL: ENV.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  patchContextNavigation(context);
  const page = await context.newPage();
  patchPageNavigation(page);

  try {
    const auth = await loginWithRetry(page.context().request, username, password);
    await installSession(page, auth);
    await expect(page).toHaveURL(/\/panel(?:\/|$)/, { timeout: 30_000 });
    return { context, page };
  } catch (error) {
    await context.close().catch(() => null);
    throw error;
  }
}
