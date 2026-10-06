import { test as setup, expect } from '@playwright/test';
import { AUTH_FILE, ENV, patchPageNavigation } from '../support/env.js';
import { cleanupE2EWithPage } from '../support/cleanup.js';
import { RUN_PREFIX } from '../support/data.js';

const EXPECTED_SYSTEM = ENV.expectedSystem;

function normalizeBase(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

function loginApiURL() {
  return normalizeBase(ENV.loginApiURL, '');
}

function loginEndpoint() {
  return `${loginApiURL()}/api.php?action=inicio`;
}

function commerceSessionEndpoint() {
  const base = normalizeBase(ENV.apiURL, '');
  return `${base}/api.php?action=auth_session_check`;
}

function e2eGuardEndpoint() {
  const base = normalizeBase(ENV.apiURL, '');
  const url = new URL(`${base}/api.php`);
  url.searchParams.set('action', 'config_testing_e2e_guard');
  url.searchParams.set('e2e_run', RUN_PREFIX);
  return url.toString();
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

async function validateE2EGuardWithRetry(request, sessionKey) {
  const attempts = 4;
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request.get(e2eGuardEndpoint(), {
        headers: {
          'X-Session': sessionKey,
          Authorization: `Bearer ${sessionKey}`,
          Accept: 'application/json',
          Connection: 'close',
        },
        timeout: 25_000,
        failOnStatusCode: false,
      });

      if (!retryableStatuses.has(response.status()) || attempt === attempts) {
        return response;
      }
      lastError = new Error(
        `Guard E2E respondió HTTP ${response.status()} (intento ${attempt}/${attempts}).`,
      );
      await response.dispose().catch(() => null);
    } catch (error) {
      lastError = error;
      if (!isRetryableTransportError(error) || attempt === attempts) throw error;
    }

    await sleep(500 * (2 ** (attempt - 1)));
  }

  throw lastError || new Error('No se pudo validar el guard E2E de BALTO_COMERCIO.');
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
  // En producción la limpieza inicial puede tardar bastante más que un request
  // normal. No compartimos el timeout corto de los tests funcionales.
  setup.setTimeout(Math.max(6 * 60_000, ENV.cleanupTimeoutMs + 180_000));
  patchPageNavigation(page);

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

  // localhost/127.0.0.1 es otro origin distinto del backend remoto seleccionado.
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

  // Antes de cualquier cleanup o test mutable comprobamos el mismo cerrojo
  // server-side que bloquea TODA escritura saliente de Balto hacia Tienda Nube.
  // En producción, además, el backend debe tener BALTO_E2E_ALLOW_PRODUCTION=1.
  if (ENV.allowMutations) {
    const guardResponse = await validateE2EGuardWithRetry(request, sessionKey);
    const guardText = await guardResponse.text();
    let guardData = {};
    try {
      guardData = guardText ? JSON.parse(guardText) : {};
    } catch {
      guardData = { raw: guardText };
    }

    expect(
      guardResponse.status(),
      `Guard E2E no disponible: HTTP ${guardResponse.status()} ${guardData?.mensaje || guardText}. ` +
      (ENV.environment === 'production'
        ? 'Producción requiere BALTO_E2E_TOOLS_ENABLED=1 y BALTO_E2E_ALLOW_PRODUCTION=1.'
        : 'Staging requiere BALTO_E2E_TOOLS_ENABLED=1.'),
    ).toBeLessThan(400);
    expect(
      guardData?.e2e_tools_enabled,
      'El backend seleccionado no tiene habilitadas las herramientas E2E seguras.',
    ).toBe(true);
    expect(
      guardData?.tiendanube_isolation_active,
      'Playwright abortó antes de tocar datos: el backend no confirmó el aislamiento E2E de Tienda Nube.',
    ).toBe(true);
    expect(String(guardData?.run || '').toUpperCase()).toBe(RUN_PREFIX);
  }

  await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/panel(?:\/|$)/, { timeout: 20_000 });
  await page.context().storageState({ path: AUTH_FILE });

  // Levanta residuos de cualquier corrida anterior interrumpida. La limpieza
  // sigue siendo segura: el backend sólo acepta entidades con huella PW-/PWMS
  // y además exige sesión ADMIN + confirmación E2E literal.
  await cleanupE2EWithPage(page, { scope: 'all', phase: 'inicio de corrida' });
});
