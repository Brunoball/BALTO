const { test, expect } = require('@playwright/test');
const { api, catalogo, pick, money } = require('./helpers');

// La web pide 12 publicaciones por pagina; el servidor omite las que no se pueden mostrar.

test.describe('Catálogo real', () => {
  test('la API resuelve la tienda configurada y rechaza una inexistente', async ({ request }) => {
    const ok = await api(request, 'tienda_configuracion');
    expect(ok.status).toBe(200);
    expect(ok.json.exito).toBe(true);
    const res = await request.get('/ecom-api?action=tienda_configuracion&tienda=no-existe-e2e.example.com');
    expect(res.status()).toBe(404);
  });

  test('muestra los productos publicados con precios de Comercio', async ({ page, request }) => {
    const productos = (await api(request, 'catalogo_productos', { pagina: 1, limite: 12 })).json.productos || [];
    test.skip(productos.length === 0, 'No hay publicaciones: ejecutar sql/001_publicar_productos_prueba.sql');
    await page.goto('/catalogo');
    const cards = page.locator('.product-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards).toHaveCount(productos.length);
    for (const p of productos) await expect(cards.filter({ hasText: p.nombre }).first()).toBeVisible();
    const primero = productos[0];
    const card = cards.filter({ hasText: primero.nombre }).first();
    await expect(card).toContainText(money(primero.precio));
    expect(await page.content()).not.toContain('r2://');
  });

  test('producto con variantes exige elegir una variante', async ({ page, request }) => {
    const p = pick.variantes(await catalogo(request));
    test.skip(!p, 'No hay productos con variantes publicados');
    await page.goto(`/producto/${p.slug}`);
    const add = page.getByTestId('add-to-cart');
    const disponibles = p.variantes.filter((v) => v.disponible);
    if (disponibles.length > 1) await expect(add).toBeDisabled();
    await page.locator('#variant-select').selectOption(String(disponibles[0].idVariante));
    await expect(add).toBeEnabled();
  });

  test('producto sin imagen muestra el placeholder', async ({ page, request }) => {
    const p = pick.sinImagen(await catalogo(request));
    test.skip(!p, 'Todos los productos publicados tienen imagen');
    await page.goto(`/producto/${p.slug}`);
    await expect(page.locator('.product-gallery-main .image-fallback')).toBeVisible();
  });

  test('producto inexistente o no publicado muestra error', async ({ page }) => {
    await page.goto('/producto/no-existe-e2e');
    await expect(page.getByText('No pudimos cargar este producto')).toBeVisible();
  });
});
