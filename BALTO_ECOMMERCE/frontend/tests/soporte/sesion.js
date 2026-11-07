// Sesión de comprador para los tests de cuenta.
//
// MODO REAL: si .env.playwright tiene PW_SESION_COMPRADOR (valor de la cookie de sesión del
//   comprador, ver README), se instala esa cookie y las pruebas usan el servidor real.
//   Las pruebas que ESCRIBEN además necesitan PW_ALLOW_MUTATIONS=1 y dejan todo como estaba.
// MODO SIMULADO: sin cookie (o sin permiso de escritura) la interfaz se prueba con la API
//   simulada (soporte/simulador.js), con el mismo formato de respuesta que el servidor.
//
// El login con Google no se puede automatizar contra Google real; 09-autenticacion lo prueba
// con Google simulado y el contrato real de auth_* se prueba por API.
const { expect } = require('@playwright/test');
const { ENV } = require('./entorno');
const { simularApi } = require('./simulador');
const { apiGet } = require('./api');

async function idTienda(request) {
  const r = await apiGet(request, 'tienda_configuracion');
  return Number(r.json?.tienda?.idTienda) || null;
}

/** Instala la cookie real del comprador (en desarrollo el proxy la renombra a balto_dev_ecs_<idTienda>). */
async function instalarCookieReal(context, request) {
  const id = await idTienda(request);
  if (!id) throw new Error('[E2E] No se pudo obtener idTienda de tienda_configuracion.');
  const url = new URL(ENV.baseURL);
  await context.addCookies([{ name: `balto_dev_ecs_${id}`, value: ENV.sesionComprador, domain: url.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

/** Consulta auth_sesion con la cookie del contexto; devuelve { autenticado, cliente, csrf }. */
async function sesionActual(page) {
  const r = await page.request.get(`/ecom-api?action=auth_sesion&tienda=${encodeURIComponent(ENV.tienda)}`, { failOnStatusCode: false });
  return r.json();
}

/**
 * Prepara una cuenta logueada para el test.
 * @returns {{ modo: 'real'|'simulado', sim?: object, csrf?: string, cliente: object }}
 */
async function prepararCuenta(page, { escribe = false, cuenta = {}, tienda = {} } = {}) {
  const real = Boolean(ENV.sesionComprador) && (!escribe || ENV.allowMutations) && !(ENV.entorno === 'produccion' && escribe && !ENV.allowProduction);
  if (real) {
    await instalarCookieReal(page.context(), page.request);
    const s = await sesionActual(page);
    expect(s?.autenticado, 'PW_SESION_COMPRADOR no es válida o venció: volvé a copiarla (ver tests/README.md).').toBe(true);
    if (Object.keys(tienda).length) await simularApi(page, { tienda });
    return { modo: 'real', csrf: s.csrf, cliente: s.cliente };
  }
  const sim = await simularApi(page, { tienda: { cuentas: true, ...tienda }, cuenta: { logueado: true, ...cuenta } });
  return { modo: 'simulado', sim, csrf: sim.csrf, cliente: sim.estado.cliente };
}

/** POST real con CSRF (para dejar datos como estaban en modo real). */
async function postReal(page, action, body, csrf) {
  const r = await page.request.post(`/ecom-api?action=${action}&tienda=${encodeURIComponent(ENV.tienda)}`, {
    data: body, headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, failOnStatusCode: false,
  });
  return { status: r.status(), json: await r.json().catch(() => null) };
}

module.exports = { prepararCuenta, instalarCookieReal, sesionActual, postReal, idTienda };
