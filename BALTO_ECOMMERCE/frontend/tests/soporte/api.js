// Acceso a la API desde los tests.
//  - api*(): pasa por el proxy /ecom-api del servidor de desarrollo (igual que la web).
//  - directa*(): pega directo a PW_API_URL con Origin explícito (contrato, CORS, métodos).
const { expect } = require('@playwright/test');
const { ENV } = require('./entorno');

const consulta = (action, params = {}) => new URLSearchParams({ action, tienda: ENV.tienda, ...params }).toString();

async function json(res) {
  try { return await res.json(); } catch (_) { return null; }
}

/** GET/POST por el proxy local. Devuelve { status, json, headers }. */
async function api(request, action, { metodo = 'GET', params = {}, body, headers = {} } = {}) {
  const opts = { headers: { Accept: 'application/json', ...headers }, failOnStatusCode: false, maxRedirects: 0 };
  if (body !== undefined) opts.data = body;
  // 429 = límite de solicitudes del servidor (protección real, ej. carrito_validar 60/min por IP):
  // se espera y se reintenta, igual que Comercio con los errores transitorios.
  for (let intento = 1; ; intento++) {
    const res = await request.fetch(`/ecom-api?${consulta(action, params)}`, { method: metodo, ...opts });
    if (res.status() !== 429 || intento >= 3) return { status: res.status(), json: await json(res), headers: res.headers() };
    await new Promise((r) => setTimeout(r, 20_000));
  }
}
const apiGet = (request, action, params = {}, extra = {}) => api(request, action, { params, ...extra });
const apiPost = (request, action, body = {}, extra = {}) => api(request, action, { metodo: 'POST', body, ...extra });

/** Pedido directo a PW_API_URL (sin proxy). Origin por defecto: el de la tienda. */
async function directa(request, action, { metodo = 'GET', params = {}, body, headers = {}, origin = ENV.origenTienda, sinTienda = false } = {}) {
  const q = sinTienda ? new URLSearchParams({ action, ...params }).toString() : consulta(action, params);
  const h = { Accept: 'application/json', ...headers };
  if (origin) h.Origin = origin;
  const opts = { method: metodo, headers: h, failOnStatusCode: false, maxRedirects: 0 };
  if (body !== undefined) opts.data = body;
  const res = await request.fetch(`${ENV.apiURL}?${q}`, opts);
  return { status: res.status(), json: await json(res), headers: res.headers() };
}

function expectExito(r, mensaje = 'La API debe responder exito=true') {
  expect(r.status, `${mensaje} (HTTP ${r.status} ${r.json?.codigo || ''} ${r.json?.mensaje || ''})`).toBeLessThan(400);
  expect(r.json?.exito, mensaje).toBe(true);
  return r.json;
}

function expectError(r, status, codigos) {
  const lista = [].concat(codigos || []);
  expect([].concat(status), `HTTP esperado ${status}, recibido ${r.status} ${r.json?.codigo || ''}`).toContain(r.status);
  expect(r.json?.exito).toBe(false);
  if (lista.length) expect(lista, `Código recibido: ${r.json?.codigo}`).toContain(r.json?.codigo);
  return r.json;
}

/** Config real de la tienda (por proxy). */
async function configuracionTienda(request) {
  const r = await apiGet(request, 'tienda_configuracion');
  return expectExito(r, 'tienda_configuracion debe responder').configuracion;
}

module.exports = { api, apiGet, apiPost, directa, expectExito, expectError, configuracionTienda, consulta };
