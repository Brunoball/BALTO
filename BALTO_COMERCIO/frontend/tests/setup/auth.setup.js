import { test as setup, expect } from '@playwright/test';
import { AUTH_FILE, ENV } from '../support/env.js';

const DEFAULT_LOGIN_API = 'https://balto.3devsnet.com/BALTO_LOGIN/api/routes';
const EXPECTED_SYSTEM = String(process.env.PW_EXPECTED_SYSTEM || 'COMERCIO').trim().toUpperCase();

function normalizeBase(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

function loginApiURL() {
  return normalizeBase(process.env.PW_LOGIN_API_URL, DEFAULT_LOGIN_API);
}

function loginEndpoint() {
  return `${loginApiURL()}/api.php?action=inicio`;
}

function commerceSessionEndpoint() {
  const base = normalizeBase(ENV.apiURL, 'https://balto.3devsnet.com/BALTO_COMERCIO/api/routes');
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

function assertsCommerceLogin(data) {
  const redirect = String(data?.redirect_url || '').toUpperCase();
  const system = responseSystem(data);
  const matchesSystem = system === EXPECTED_SYSTEM || system.includes(EXPECTED_SYSTEM);
  const matchesRedirect = redirect.includes('/BALTO_COMERCIO/');

  if (!matchesSystem && !matchesRedirect) {
    throw new Error(
      `La cuenta de Playwright no pertenece a BALTO_COMERCIO. ` +
      `Sistema recibido=${system || '(sin sistema)'}; redirect=${data?.redirect_url || '(sin redirect)'}. ` +
      `Revisá PW_USER/PW_PASSWORD: para Comercio debe usarse la cuenta del tenant COMERCIO, no la de SERVICIOS.`,
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

async function loginWithRetry(request, user, password) {
  const attempts = 4;
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request.post(loginEndpoint(), {
        data: {
          nombre: user,
          contrasena: password,
        },
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          // Hostinger puede cortar conexiones keep-alive antes de responder.
          Connection: 'close',
        },
        timeout: 25_000,
        failOnStatusCode: false,
      });

      // 400/401/403 son respuestas funcionales y deben fallar sin reintentos:
      // nunca ocultamos credenciales inválidas detrás de una recuperación de red.
      if (!retryableStatuses.has(response.status()) || attempt === attempts) {
        return response;
      }

      lastError = new Error(
        `BALTO_LOGIN respondió HTTP ${response.status()} ` +
        `(intento ${attempt}/${attempts}).`,
      );
      await response.dispose().catch(() => null);
    } catch (error) {
      lastError = error;
      if (!isRetryableTransportError(error) || attempt === attempts) {
        throw error;
      }
    }

    await sleep(600 * (2 ** (attempt - 1)));
  }

  throw lastError || new Error('No se pudo iniciar sesión en BALTO_LOGIN.');
}

async function validateCommerceSessionWithRetry(request, sessionKey) {
  const attempts = 4;
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request.get(commerceSessionEndpoint(), {
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
        `BALTO_COMERCIO respondió HTTP ${response.status()} en la validación de sesión ` +
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

  throw lastError || new Error('No se pudo validar la sesión de BALTO_COMERCIO.');
}

setup('autenticar administrador de Balto', async ({ page, request }) => {
  setup.setTimeout(2 * 60_000);

  const user = String(ENV.user || process.env.PW_USER || '').trim();
  const password = String(ENV.password || process.env.PW_PASSWORD || '');

  expect(user, 'PW_USER es obligatorio para Playwright.').not.toBe('');
  expect(password, 'PW_PASSWORD es obligatorio para Playwright.').not.toBe('');

  const loginResponse = await loginWithRetry(request, user, password);

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

  assertsCommerceLogin(loginData);

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

  // Primero validamos la sesión contra COMERCIO y recién después cargamos React.
  // Así evitamos disparar DOS auth_session_check simultáneos (uno del frontend
  // y otro de APIRequestContext), algo que en Hostinger puede terminar en
  // ECONNRESET aunque la sesión sea válida.
  const commerceCheck = await validateCommerceSessionWithRetry(request, sessionKey);

  const commerceText = await commerceCheck.text();
  let commerceData = {};
  try {
    commerceData = commerceText ? JSON.parse(commerceText) : {};
  } catch {
    commerceData = { raw: commerceText };
  }

  expect(
    commerceCheck.status(),
    `La sesión creada por BALTO_LOGIN no fue aceptada por BALTO_COMERCIO: HTTP ${commerceCheck.status()} ${commerceData?.mensaje || commerceText}`,
  ).toBeLessThan(400);
  expect(
    commerceData?.exito !== false && commerceData?.success !== false,
    commerceData?.mensaje || commerceData?.message || 'BALTO_COMERCIO rechazó la sesión global.',
  ).toBe(true);

  await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/panel(?:\/|$)/, { timeout: 20_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
