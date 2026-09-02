import { expect } from '@playwright/test';
import fs from 'node:fs';
import { authenticatedApi, expectApiSuccess } from './api.js';
import { AUTH_FILE, ENV } from './env.js';

const DEFAULT_LOGIN_API = 'https://balto.3devsnet.com/BALTO_LOGIN/api/routes';
const SESSION_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

function loginEndpoint() {
  const base = String(process.env.PW_LOGIN_API_URL || DEFAULT_LOGIN_API).trim().replace(/\/+$/, '');
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

function authFileNeedsRefresh() {
  try {
    return Date.now() - fs.statSync(AUTH_FILE).mtimeMs >= SESSION_REFRESH_INTERVAL_MS;
  } catch {
    return true;
  }
}

function isRetryableLoginStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

async function loginWithRetry(request, username, password) {
  let last = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await request.post(loginEndpoint(), {
        data: { nombre: username, contrasena: password },
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        timeout: 30_000,
        failOnStatusCode: false,
      });
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }

      last = { status: response.status(), body, text };
      if (!isRetryableLoginStatus(last.status) || attempt === 5) break;
    } catch (error) {
      last = { status: 0, body: {}, text: String(error?.message || error) };
      if (attempt === 5) break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
  }

  expect(
    last?.status || 0,
    `BALTO_LOGIN no pudo autenticar a ${username}: HTTP ${last?.status || 0} ${last?.body?.mensaje || last?.text || ''}`,
  ).toBeLessThan(400);
  expect(last?.body?.exito, last?.body?.mensaje || 'BALTO_LOGIN no confirmó el acceso.').toBe(true);

  const sessionKey = String(last?.body?.session_key || '').trim();
  expect(sessionKey, 'BALTO_LOGIN no devolvió session_key.').not.toBe('');

  return {
    sessionKey,
    usuario: last?.body?.usuario && typeof last.body.usuario === 'object'
      ? last.body.usuario
      : { usuario: username },
  };
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

  await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
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
  let mustRefresh = !currentKey;

  if (currentKey) {
    const response = await page.context().request.get(commerceSessionEndpoint(), {
      headers: { 'X-Session': currentKey, Accept: 'application/json', Connection: 'close' },
      timeout: 30_000,
      failOnStatusCode: false,
    });
    const body = await response.json().catch(() => ({}));
    mustRefresh = response.status() >= 400
      || body?.exito === false
      || authFileNeedsRefresh();
  }

  if (!mustRefresh) return;

  const auth = await loginWithRetry(page.context().request, ENV.user, ENV.password);
  await installSession(page, auth, { persist: true });
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
  const page = await context.newPage();

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
