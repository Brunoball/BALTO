import { test as setup, expect } from '@playwright/test';
import { AUTH_FILE, ENV } from '../support/env.js';

const DEFAULT_LOGIN_API = 'https://balto.3devsnet.com/BALTO_LOGIN/api/routes';
const EXPECTED_SYSTEM = String(process.env.PW_EXPECTED_SYSTEM || 'SERVICIOS').trim().toUpperCase();

function normalizeBase(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

function loginApiURL() {
  return normalizeBase(process.env.PW_LOGIN_API_URL, DEFAULT_LOGIN_API);
}

function loginEndpoint() {
  return `${loginApiURL()}/api.php?action=inicio`;
}

function appSessionEndpoint() {
  const base = normalizeBase(ENV.apiURL, 'https://balto.3devsnet.com/BALTO_SERVICIOS/api/routes');
  return `${base}/api.php?action=auth_session_check`;
}

function responseSystem(data) {
  const candidates = [
    data?.sistema?.codigo,
    data?.sistema?.clave,
    data?.sistema?.slug,
    data?.sistema?.nombre,
    data?.sistema_codigo,
    data?.sistema_nombre,
  ];
  return String(candidates.find((v) => String(v || '').trim()) || '').trim().toUpperCase();
}

function assertsExpectedSystemLogin(data) {
  const redirect = String(data?.redirect_url || '').toUpperCase();
  const system = responseSystem(data);
  const matchesSystem = system === EXPECTED_SYSTEM || system.includes(EXPECTED_SYSTEM);
  const matchesRedirect = redirect.includes(`/BALTO_${EXPECTED_SYSTEM}/`);

  if (!matchesSystem && !matchesRedirect) {
    throw new Error(
      `La cuenta de Playwright no pertenece a BALTO_${EXPECTED_SYSTEM}. ` +
      `Sistema recibido=${system || '(sin sistema)'}; redirect=${data?.redirect_url || '(sin redirect)'}. ` +
      `Revisá PW_USER/PW_PASSWORD y PW_EXPECTED_SYSTEM para ejecutar sobre el tenant correcto.`,
    );
  }
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

async function validateAppSessionWithRetry(request, sessionKey) {
  const attempts = 4;
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request.get(appSessionEndpoint(), {
        headers: {
          'X-Session': sessionKey,
          Authorization: `Bearer ${sessionKey}`,
          Accept: 'application/json',
          // Hostinger/proxy a veces resetea conexiones keep-alive largas.
          // Forzamos cierre porque esta validación se hace una sola vez en setup.
          Connection: 'close',
        },
        timeout: 25_000,
        failOnStatusCode: false,
      });

      if (!retryableStatuses.has(response.status()) || attempt === attempts) {
        return response;
      }

      lastError = new Error(
        `BALTO_SERVICIOS respondió HTTP ${response.status()} en la validación de sesión ` +
        `(intento ${attempt}/${attempts}).`,
      );
    } catch (error) {
      lastError = error;

      // 401/403/etc. llegan como respuesta HTTP y NO entran acá.
      // Sólo reintentamos cortes de transporte reales.
      if (!isRetryableTransportError(error) || attempt === attempts) {
        throw error;
      }
    }

    await sleep(500 * (2 ** (attempt - 1)));
  }

  throw lastError || new Error('No se pudo validar la sesión de BALTO_SERVICIOS.');
}

setup('autenticar administrador de Balto', async ({ page, request }) => {
  const user = String(ENV.user || process.env.PW_USER || '').trim();
  const password = String(ENV.password || process.env.PW_PASSWORD || '');

  expect(user, 'PW_USER es obligatorio para Playwright.').not.toBe('');
  expect(password, 'PW_PASSWORD es obligatorio para Playwright.').not.toBe('');

  const loginResponse = await request.post(loginEndpoint(), {
    data: {
      nombre: user,
      contrasena: password,
    },
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  const loginText = await loginResponse.text();
  let loginData = {};
  try {
    loginData = loginText ? JSON.parse(loginText) : {};
  } catch {
    throw new Error(`BALTO_LOGIN devolvió una respuesta no JSON (HTTP ${loginResponse.status()}): ${loginText.slice(0, 500)}`);
  }

  expect(
    loginResponse.status(),
    `Falló BALTO_LOGIN: HTTP ${loginResponse.status()} ${loginData?.mensaje || loginText}`,
  ).toBeLessThan(400);
  expect(loginData?.exito, loginData?.mensaje || 'BALTO_LOGIN no confirmó el acceso.').toBe(true);

  const sessionKey = String(loginData?.session_key || '').trim();
  expect(sessionKey, 'BALTO_LOGIN no devolvió session_key.').not.toBe('');

  assertsExpectedSystemLogin(loginData);

  const usuario = loginData?.usuario && typeof loginData.usuario === 'object'
    ? loginData.usuario
    : { nombre: user };

  // localhost/127.0.0.1 es otro origin distinto de balto.3devsnet.com.
  // Sembramos la sesión global ANTES de que cargue React para que App.js no
  // redirija al login central al abrir las rutas internas durante Playwright.
  await page.addInitScript(
    ({ key, userJson }) => {
      localStorage.setItem('session_key', key);
      localStorage.setItem('usuario', userJson);
    },
    {
      key: sessionKey,
      userJson: JSON.stringify(usuario),
    },
  );

  // Primero validamos la sesión contra SERVICIOS y recién después cargamos React.
  // Así evitamos disparar DOS auth_session_check simultáneos (uno del frontend
  // y otro de APIRequestContext), algo que en Hostinger puede terminar en
  // ECONNRESET aunque la sesión sea válida.
  const appCheck = await validateAppSessionWithRetry(request, sessionKey);

  const appText = await appCheck.text();
  let appData = {};
  try {
    appData = appText ? JSON.parse(appText) : {};
  } catch {
    appData = { raw: appText };
  }

  expect(
    appCheck.status(),
    `La sesión creada por BALTO_LOGIN no fue aceptada por BALTO_SERVICIOS: HTTP ${appCheck.status()} ${appData?.mensaje || appText}`,
  ).toBeLessThan(400);
  expect(
    appData?.exito !== false && appData?.success !== false,
    appData?.mensaje || appData?.message || 'BALTO_SERVICIOS rechazó la sesión global.',
  ).toBe(true);

  await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/panel(?:\/|$)/, { timeout: 20_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
