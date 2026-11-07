// Tienda: tienda_configuracion, tienda_estado, identidad visual y pantalla de error.
const { test, expect } = require('./soporte/test');
const { ENV } = require('./soporte/entorno');
const { apiGet, directa, expectExito, expectError } = require('./soporte/api');
const { simularApi } = require('./soporte/simulador');

test.describe('Tienda', () => {
  test('@smoke tienda_configuracion: contrato de la configuración pública', async ({ request }) => {
    const r = expectExito(await apiGet(request, 'tienda_configuracion'));
    expect(r.tienda).toMatchObject({ dominio: ENV.tienda, sistema: 'COMERCIO' });
    const c = r.configuracion;
    for (const k of ['nombre', 'moneda', 'modo_catalogo', 'checkout_habilitado', 'entrega_modalidades', 'pagos', 'cuentas', 'limites']) {
      expect(c, `configuracion.${k}`).toHaveProperty(k);
    }
    expect(Array.isArray(c.entrega_modalidades)).toBe(true);
    expect(typeof c.cuentas.habilitadas).toBe('boolean');
    // Nunca se publican datos de conexión ni ids internos de Comercio.
    expect(JSON.stringify(r)).not.toMatch(/db_(host|name|user|pass)|idTenant/);
  });

  test('tienda_estado: conexiones MASTER, Comercio y eCommerce', async ({ request }) => {
    const r = expectExito(await apiGet(request, 'tienda_estado'));
    expect(r.conexiones).toEqual({ master: 'ok', comercio: 'ok', ecommerce: 'ok' });
    expect(typeof r.catalogo_habilitado).toBe('boolean');
  });

  test('una tienda inexistente o no habilitada responde 404', async ({ request }) => {
    const r = await directa(request, 'tienda_configuracion', { params: { tienda: 'no-existe-e2e.example.com' }, origin: 'https://no-existe-e2e.example.com' });
    expectError(r, 404, 'TIENDA_NO_DISPONIBLE');
  });

  test('la web aplica nombre, SEO y color de la tienda', async ({ page, request }) => {
    const c = expectExito(await apiGet(request, 'tienda_configuracion')).configuracion;
    await page.goto('/');
    await expect(page).toHaveTitle(c.seo_titulo || c.nombre || 'BALTO eCommerce');
    await expect(page.locator('.site-brand')).toContainText(c.nombre || 'Tienda online');
    if (/^#[\da-f]{6}$/i.test(String(c.color_primario || ''))) {
      const brand = await page.locator('.app-root').evaluate((el) => el.style.getPropertyValue('--brand'));
      expect(brand.toLowerCase()).toBe(c.color_primario.toLowerCase());
    }
  });

  test.describe('sin servidor', () => {
    test.use({ diagnosticoEstricto: false });
    test('si la API falla muestra "La tienda no está disponible" y permite reintentar', async ({ page }) => {
      let caida = true;
      await page.route(/\/ecom-api\?.*action=tienda_configuracion/, (route) => (caida
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ exito: false, codigo: 'ECOMMERCE_DB_NO_CONFIGURADA', mensaje: 'Falta configurar la DB eCommerce en MASTER.' }) })
        : route.fallback()));
      await page.goto('/');
      await expect(page.getByRole('alert')).toContainText('La tienda no está disponible');
      await expect(page.getByText('Referencia: ECOMMERCE_DB_NO_CONFIGURADA')).toBeVisible();
      caida = false;
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect(page.locator('.site-header')).toBeVisible();
    });

    test('con el catálogo deshabilitado no muestra productos', async ({ page }) => {
      await simularApi(page, { tienda: { config: { modo_catalogo: false } } });
      await page.goto('/catalogo');
      await expect(page.getByText('Catálogo no disponible')).toBeVisible();
      await expect(page.locator('.product-card')).toHaveCount(0);
    });
  });
});
