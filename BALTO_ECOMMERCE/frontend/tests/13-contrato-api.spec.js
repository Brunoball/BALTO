// Contrato de la API (directo a PW_API_URL, sin proxy) para TODAS las acciones:
// métodos permitidos, preflight CORS, orígenes no autorizados, credenciales y sesión.
const { test, expect } = require('./soporte/test');
const { ENV } = require('./soporte/entorno');
const { directa, expectError } = require('./soporte/api');
const { ACCIONES } = require('./soporte/acciones');
const { instalarCookieReal, sesionActual } = require('./soporte/sesion');

const MALICIOSO = 'https://sitio-malicioso.example.com';

test.describe('Contrato de la API', () => {
  for (const [accion, def] of Object.entries(ACCIONES)) {
    test(`${accion} (${def.metodo}, ${def.tipo})`, async ({ request }) => {
      // 1) Método incorrecto -> 405 con Allow.
      const otro = def.metodo === 'GET' ? 'POST' : 'GET';
      const mal = await directa(request, accion, { metodo: otro, body: otro === 'POST' ? {} : undefined });
      expectError(mal, 405, 'METODO_NO_PERMITIDO');
      expect(mal.headers.allow).toContain(def.metodo);

      if (accion === 'ping') {
        const ping = await directa(request, 'ping', { sinTienda: true, origin: null });
        expect(ping.json).toMatchObject({ exito: true, servicio: 'BALTO_ECOMMERCE' });
        return;
      }

      // 2) Preflight desde la tienda: permitido; credenciales SOLO en las acciones con sesión.
      const pre = await directa(request, accion, { metodo: 'OPTIONS', headers: { 'Access-Control-Request-Method': def.metodo } });
      expect(pre.status, 'preflight desde el dominio de la tienda').toBe(204);
      expect(pre.headers['access-control-allow-origin']).toBe(ENV.origenTienda);
      if (def.credenciales) expect(pre.headers['access-control-allow-credentials']).toBe('true');
      else expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
      const preMal = await directa(request, accion, { metodo: 'OPTIONS', headers: { 'Access-Control-Request-Method': otro } });
      expect(preMal.status, 'preflight con un método no permitido').toBe(405);

      // 3) Origen ajeno: nunca se habilita CORS.
      const ajeno = await directa(request, accion, { metodo: 'OPTIONS', origin: MALICIOSO, headers: { 'Access-Control-Request-Method': def.metodo } });
      expect(ajeno.status).toBe(403);
      expect(ajeno.headers['access-control-allow-origin']).toBeUndefined();

      // 4) Acciones privadas sin cookie -> 401 (o 503 si la tienda no tiene cuentas).
      if (def.tipo === 'privada') {
        const anon = await directa(request, accion, { metodo: def.metodo, body: def.metodo === 'POST' ? {} : undefined });
        expectError(anon, [401, 503], ['SESION_REQUERIDA', 'CUENTAS_NO_DISPONIBLES']);
      }

      // 5) Cabeceras de seguridad y trazabilidad en toda respuesta.
      expect(mal.headers['x-content-type-options']).toBe('nosniff');
      expect(mal.headers['cache-control'] || '').toMatch(/no-store/);
    });
  }

  test('acción inexistente, método no soportado y tienda desconocida', async ({ request }) => {
    expectError(await directa(request, 'accion_que_no_existe'), 404, 'ACCION_NO_ENCONTRADA');
    expectError(await directa(request, 'ping', { metodo: 'PUT', sinTienda: true }), 405, 'METODO_NO_PERMITIDO');
    expectError(await directa(request, 'catalogo_productos', { params: { tienda: 'no-existe-e2e.example.com' }, origin: 'https://no-existe-e2e.example.com' }), 404, 'TIENDA_NO_DISPONIBLE');
  });

  test('las respuestas de error no exponen rutas, SQL ni trazas', async ({ request }) => {
    for (const r of [
      await directa(request, 'catalogo_producto', { params: { slug: "' OR 1=1 --" } }),
      await directa(request, 'carrito_validar', { metodo: 'POST', body: { items: 'no-es-lista' } }),
      await directa(request, 'geografia_localidades', { params: { q: '<script>' } }),
    ]) {
      // 403 sin JSON = el firewall del hosting (ModSecurity) cortó el ataque antes de llegar a PHP.
      if (r.status === 403 && r.json === null) continue;
      expect(r.json?.exito).toBe(false);
      expect(JSON.stringify(r.json)).not.toMatch(/SQLSTATE|PDO|\.php|Stack trace|#0 /i);
    }
  });

  test('sesión REAL: un POST privado sin X-CSRF-Token se rechaza con 403', async ({ page }) => {
    test.skip(!ENV.sesionComprador, 'Sin PW_SESION_COMPRADOR.');
    await instalarCookieReal(page.context(), page.request);
    const s = await sesionActual(page);
    expect(s.autenticado).toBe(true);
    const r = await page.request.post(`/ecom-api?action=cliente_actualizar&tienda=${encodeURIComponent(ENV.tienda)}`, { data: { nombre: 'NoDebeGuardarse', apellido: 'Csrf' }, failOnStatusCode: false });
    expect(r.status()).toBe(403);
    expect((await r.json()).codigo).toBe('CSRF_INVALIDO');
  });
});
