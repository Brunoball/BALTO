import { expect } from '@playwright/test';
import { ENV, assertSafeMutationConfiguration } from './env.js';

function endpoint(action) {
  const base = String(ENV.apiURL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('[Playwright fixture] Falta PW_API_URL / ENV.apiURL.');
  }

  const url = /\/api\.php$/i.test(base)
    ? new URL(base)
    : new URL(`${base}/api.php`);
  url.searchParams.set('action', action);
  return url.toString();
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

  for (const origin of origins) {
    const values = new Map(
      (origin.localStorage || []).map((entry) => [entry.name, entry.value]),
    );
    const sessionKey =
      values.get('session_key') ||
      values.get('sessionKey') ||
      values.get('X-Session') ||
      values.get('x_session') ||
      '';
    const token = values.get('token') || values.get('auth_token') || '';
    const usuario = values.get('usuario') || '';
    if (sessionKey || token) return { sessionKey, token, usuario };
  }

  throw new Error(
    '[Playwright fixture] No se encontró session_key/token en el storageState autenticado.',
  );
}

async function installFrontendAuthBridge(page, auth) {
  // BALTO_LOGIN y BALTO_COMERCIO comparten localStorage en Hostinger porque
  // viven bajo el mismo origen. Durante Playwright, en cambio, el frontend se
  // ejecuta en http://localhost:3000: ese origen NO comparte localStorage con
  // https://balto.3devsnet.com. Copiamos únicamente la sesión ya autenticada
  // al origen de desarrollo antes de cualquier page.goto('/panel/...').
  // No crea una sesión nueva y no debilita producción: el backend sigue
  // validando X-Session contra MASTER en cada request.
  await page.addInitScript(
    ({ sessionKey, token, usuario }) => {
      try {
        if (sessionKey) localStorage.setItem('session_key', sessionKey);
        if (token) localStorage.setItem('token', token);
        if (usuario) localStorage.setItem('usuario', usuario);
      } catch {
        // El script también puede ejecutarse en documentos/orígenes donde
        // localStorage no esté disponible. El documento principal local sí lo
        // tendrá y recibirá estos valores al navegar.
      }
    },
    {
      sessionKey: String(auth?.sessionKey || ''),
      token: String(auth?.token || ''),
      usuario: String(auth?.usuario || ''),
    },
  );
}

function money(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : fallback;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : String(fallback);
}

function normalizeBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

/**
 * Crea el producto de preparación E2E directamente por la API real de Stock.
 *
 * El test 04 valida Compras/Notas de crédito, no el botón de alta de Stock.
 * Usar la API para el fixture evita que un cambio de layout/permisos de Stock
 * rompa toda la suite de NC antes de llegar a la funcionalidad que se quiere
 * probar. El CRUD visual de Stock sigue cubierto por sus specs específicos.
 */
export async function createStockProductFixture(page, product) {
  assertSafeMutationConfiguration();

  const state = await page.context().storageState();
  const auth = authFromStorageState(state);
  const { sessionKey, token } = auth;

  // El fixture se ejecuta antes del primer flujo visual del test 04. Dejamos
  // preparado el origen localhost para que /panel/compras vea exactamente la
  // misma session_key/usuario que obtuvo el setup global.
  await installFrontendAuthBridge(page, auth);

  const headers = {
    Accept: 'application/json',
    ...(sessionKey ? { 'X-Session': sessionKey } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const name = String(product?.name || '').trim().toUpperCase();
  const sku = String(product?.sku || '').trim().toUpperCase();
  expect(name, 'El fixture de Stock necesita nombre').not.toBe('');
  expect(sku, 'El fixture de Stock necesita SKU').not.toBe('');

  const payload = {
    nombre: name,
    sku,
    precio_costo: money(product?.cost, '0.00'),
    precio: money(product?.price, '0.00'),
    margen_venta_porcentaje: '',
    margen_venta_valor: '',
    precio_promo: '',
    margen_promo_porcentaje: '',
    margen_promo_valor: '',
    stock: integer(product?.stock, 0),
    descripcion: 'PLAYWRIGHT E2E',
    categorias_ids: '[]',
    variantes: '[]',
    tipos_precio: '[]',
    diferir_sync: '1',
    origen_sync: 'playwright_e2e',
  };

  const response = await page.request.post(endpoint('stock_productos_crear'), {
    headers,
    form: payload,
    timeout: 60_000,
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = normalizeBody(text);

  expect(
    response.status(),
    `El alta fixture de ${name} respondió HTTP ${response.status()}: ${text}`,
  ).toBeLessThan(400);
  expect(
    body?.exito !== false && body?.success !== false,
    body?.mensaje || body?.message || `No se pudo crear el fixture ${name}`,
  ).toBeTruthy();

  return body;
}
