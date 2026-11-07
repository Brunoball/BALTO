// Preflight: entorno, proxy, tienda y protecciones. Si esto falla, el resto no tiene sentido.
const { test, expect } = require('./soporte/test');
const { ENV, problemasDeConfiguracion, assertMutacionSegura } = require('./soporte/entorno');
const { apiGet, expectExito } = require('./soporte/api');

test('@smoke preflight: configuración de .env.playwright y del frontend', async () => {
  expect(problemasDeConfiguracion(), 'Revisá .env.playwright').toEqual([]);
  expect(ENV.apiFrontend, 'El frontend de desarrollo debe usar el proxy /ecom-api (REACT_APP_API_URL)').toBe('/ecom-api');
  if (ENV.entorno !== 'local') {
    expect(ENV.proxyOrigin, 'REACT_APP_BALTO_ORIGIN (proxy) y PW_API_URL deben apuntar al mismo servidor').toBe(new URL(ENV.apiURL).origin);
  }
});

test('@smoke preflight: el proxy /ecom-api llega a la API y resuelve la tienda', async ({ request }) => {
  const ping = await apiGet(request, 'ping');
  expect(expectExito(ping).servicio).toBe('BALTO_ECOMMERCE');
  const cfg = expectExito(await apiGet(request, 'tienda_configuracion'), `La tienda ${ENV.tienda} debe estar habilitada en MASTER`);
  expect(cfg.tienda.dominio).toBe(ENV.tienda);
  test.info().annotations.push(
    { type: 'entorno', description: `${ENV.entorno} · ${ENV.apiURL}` },
    { type: 'tienda', description: `${cfg.tienda.dominio} (id ${cfg.tienda.idTienda})` },
    { type: 'checkout', description: `${cfg.configuracion.checkout_habilitado ? cfg.configuracion.checkout_modo : 'deshabilitado'}` },
    { type: 'sesion', description: ENV.sesionComprador ? 'real (PW_SESION_COMPRADOR)' : 'simulada' },
    { type: 'mutaciones', description: ENV.allowMutations ? 'habilitadas' : 'no' },
  );
});

test('@smoke preflight: la web usa el proxy local con el dominio de la tienda', async ({ page }) => {
  const pedido = page.waitForRequest((r) => r.url().includes('/ecom-api?') && r.url().includes('action=tienda_configuracion'));
  await page.goto('/');
  const url = new URL((await pedido).url());
  expect(url.origin).toBe(new URL(ENV.baseURL).origin);
  expect(url.searchParams.get('tienda')).toBe(ENV.tienda);
  await expect(page.locator('.site-header')).toBeVisible();
});

test('@smoke preflight: las escrituras nunca apuntan a producción sin permiso explícito', async () => {
  if (ENV.allowMutations && ENV.entorno === 'produccion' && !ENV.allowProduction) {
    expect(() => assertMutacionSegura()).toThrow(/PRODUCCI/);
  } else if (ENV.allowMutations) {
    expect(() => assertMutacionSegura()).not.toThrow();
  } else {
    expect(() => assertMutacionSegura()).toThrow(/PW_ALLOW_MUTATIONS/);
  }
});
