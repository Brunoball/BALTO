// Fixture de toda la suite (equivalente a support/test.js de Comercio).
// TODOS los specs importan { test, expect } desde acá.
//  - Cada test arranca con un contexto nuevo: almacenamiento limpio (carrito, favoritos, borradores).
//  - Bloquea Google Identity Services real (la sesión se prueba con soporte/sesion.js).
//  - Diagnóstico automático: si la página tiene errores JS o la API devuelve 5xx, el test falla.
//    Para un test que provoca errores a propósito: test.use({ diagnosticoEstricto: false }).
const base = require('@playwright/test');
const { ENV } = require('./entorno');
const { instalarDiagnostico, problemasCriticos } = require('./diagnostico');

const test = base.test.extend({
  diagnosticoEstricto: [true, { option: true }],
  bloquearGoogle: [true, { option: true }],
  diagnostico: [async ({ page, diagnosticoEstricto }, use, testInfo) => {
    const d = instalarDiagnostico(page);
    await use(d);
    if (!diagnosticoEstricto || testInfo.status !== testInfo.expectedStatus) return;
    const p = problemasCriticos(d);
    if (p.length) {
      await testInfo.attach('diagnostico', { body: p.join('\n'), contentType: 'text/plain' });
      throw new Error(`[Diagnóstico] ${p.join(' || ')}`);
    }
  }, { auto: true }],
  _preparacion: [async ({ page, context, bloquearGoogle }, use) => {
    // Cada test usa un contexto nuevo de Playwright: carrito, favoritos y sesión arrancan vacíos.
    if (bloquearGoogle) await context.route(/accounts\.google\.com\/gsi\//, (r) => r.abort());
    await use();
    // La web puede dejar pedidos en vuelo (ej. revalidación del carrito a los 450 ms). Si un
    // interceptor de la API simulada sigue corriendo cuando el test termina, Playwright lo
    // reporta como error del test SIGUIENTE y saltea el resto del archivo. Se cierran acá.
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  }, { auto: true }],
});

const expect = base.expect;
module.exports = { test, expect, ENV };
