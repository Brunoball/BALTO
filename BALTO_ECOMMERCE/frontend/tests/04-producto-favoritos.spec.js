// Ficha de producto (catalogo_producto), imágenes (producto_imagen) y favoritos.
const { test, expect } = require('./soporte/test');
const { apiGet, directa, expectExito, expectError } = require('./soporte/api');
const { productos, elegir, disponibles } = require('./soporte/catalogo');
const { dinero } = require('./soporte/flujos');
const { ENV } = require('./soporte/entorno');

test.describe('Producto', () => {
  test('@smoke catalogo_producto: ficha completa y errores', async ({ request }) => {
    const ps = await productos(request);
    test.skip(!ps.length, 'Sin publicaciones.');
    const r = expectExito(await apiGet(request, 'catalogo_producto', { slug: ps[0].slug }));
    expect(r.producto).toMatchObject({ slug: ps[0].slug, nombre: ps[0].nombre, idPublicacion: ps[0].idPublicacion });
    expectError(await apiGet(request, 'catalogo_producto', { slug: 'no-existe-e2e' }), 404);
    const traversal = await apiGet(request, 'catalogo_producto', { slug: '../etc/passwd' });
    if (traversal.status === 403 && traversal.json === null) {
      // El firewall del hosting (ModSecurity de Hostinger) corta el pedido antes de llegar a PHP: también es un rechazo válido.
      test.info().annotations.push({ type: 'waf', description: 'catalogo_producto con ../ bloqueado por el firewall del hosting (403)' });
    } else {
      expectError(traversal, [400, 404], ['SLUG_INVALIDO', 'PRODUCTO_NO_DISPONIBLE', 'PRODUCTO_NO_ENCONTRADO']);
    }
  });

  test('la ficha muestra nombre, precio, código, descripción y disponibilidad', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple disponible.');
    await page.goto(`/producto/${p.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.nombre);
    await expect(page.locator('.product-pricing')).toContainText(dinero(p.precio));
    if (p.sku) await expect(page.locator('.product-sku')).toContainText(p.sku);
    if (p.descripcion) await expect(page.locator('.product-description')).toHaveText(p.descripcion);
    await expect(page.locator('.stock-status')).toContainText('Disponible');
    await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toContainText(p.nombre);
  });

  test('producto con variantes exige elegir una variante', async ({ page, request }) => {
    const p = elegir.variantes(await productos(request));
    test.skip(!p, 'No hay productos con variantes publicados.');
    await page.goto(`/producto/${p.slug}`);
    const add = page.getByTestId('add-to-cart');
    const vs = disponibles(p);
    if (p.variantes.length > 1) await expect(add).toBeDisabled();
    await page.locator('#variant-select').selectOption(String(vs[0].idVariante));
    await expect(add).toBeEnabled();
    await expect(page.locator('.product-pricing')).toContainText(dinero(vs[0].precio));
  });

  test('producto sin imagen muestra el placeholder', async ({ page, request }) => {
    const p = elegir.sinImagen(await productos(request));
    test.skip(!p, 'Todos los productos publicados tienen imagen.');
    await page.goto(`/producto/${p.slug}`);
    await expect(page.locator('.product-gallery-main .image-fallback')).toBeVisible();
  });

  test('producto inexistente o no publicado muestra error y vuelve al catálogo', async ({ page }) => {
    await page.goto('/producto/no-existe-e2e');
    await expect(page.getByText('No pudimos cargar este producto')).toBeVisible();
    await page.getByRole('link', { name: 'Volver al catálogo' }).click();
    await expect(page).toHaveURL(/\/catalogo$/);
  });

  test('producto_imagen: redirige a una URL prefirmada y rechaza pedidos inválidos', async ({ request }) => {
    const sinR2 = await directa(request, 'producto_imagen', { params: { slug: 'no-existe-e2e', archivo: 'portada' } });
    expectError(sinR2, 404, ['IMAGEN_NO_DISPONIBLE', 'IMAGENES_NO_CONFIGURADAS']);
    expectError(await directa(request, 'producto_imagen', { params: { slug: '../x', archivo: '1' } }), 404, 'IMAGEN_NO_DISPONIBLE');
    const p = elegir.conImagen(await productos(request));
    test.skip(!p, 'Ningún producto publicado tiene imagen servida por producto_imagen.');
    const u = new URL(p.imagen_url);
    expect(u.searchParams.get('action')).toBe('producto_imagen');
    const res = await request.fetch(p.imagen_url, { maxRedirects: 0, failOnStatusCode: false, headers: { Origin: ENV.origenTienda } });
    expect([301, 302, 303, 307]).toContain(res.status());
    expect(res.headers().location).toMatch(/^https:\/\//);
    expect(res.headers().location).not.toContain('r2://');
  });
});

test.describe('Favoritos', () => {
  test('guardar desde la ficha, listarlos y quitarlos', async ({ page, request }) => {
    const ps = await productos(request);
    test.skip(!ps.length, 'Sin publicaciones.');
    const p = ps[0];
    await page.goto(`/producto/${p.slug}`);
    await page.getByRole('button', { name: 'Guardar en favoritos' }).click();
    await expect(page.getByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: 'Mis favoritos (1)' })).toBeVisible();
    const guardados = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), `balto:ecommerce:favoritos:${ENV.tienda}`);
    expect(guardados).toEqual([p.slug]);

    await page.goto('/favoritos');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page.locator('.product-card')).toContainText(p.nombre);
    await page.getByRole('button', { name: `Quitar ${p.nombre} de favoritos` }).click();
    await expect(page.getByText('Todavía no guardaste favoritos')).toBeVisible();
  });

  test('un favorito que ya no está publicado no rompe la página', async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify(['no-existe-e2e'])), `balto:ecommerce:favoritos:${ENV.tienda}`);
    await page.goto('/favoritos');
    await expect(page.getByText(/ya no están disponibles|No se pudieron cargar/)).toBeVisible();
  });

  test('agregado rápido desde la tarjeta suma al carrito', async ({ page, request }) => {
    const p = elegir.simple(await productos(request, { limite: 12 }), 1);
    test.skip(!p, 'Se necesita un producto simple disponible en la primera página.');
    await page.goto('/catalogo');
    await page.getByRole('button', { name: `Agregar ${p.nombre} al carrito` }).click();
    const panel = page.getByRole('dialog', { name: /carrito/i });
    await expect(panel.getByTestId('cart-line')).toHaveCount(1);
    await expect(panel.getByTestId('cart-line')).toContainText(p.nombre);
    await expect(page.locator('.count-bubble')).toHaveText('1');
  });
});
