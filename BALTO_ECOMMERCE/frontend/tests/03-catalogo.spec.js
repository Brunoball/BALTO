// Catálogo: catalogo_productos (API y UI), paginación, filtros locales, orden y categorías.
const { test, expect } = require('./soporte/test');
const { apiGet, expectExito } = require('./soporte/api');
const { dinero } = require('./soporte/flujos');

test.describe('Catálogo', () => {
  test('@smoke catalogo_productos: contrato, límites y sin claves internas', async ({ request }) => {
    const r = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 12 }));
    expect(r.pagina).toBe(1);
    expect(r.limite).toBe(12);
    expect(typeof r.siguiente_pagina_posible).toBe('boolean');
    for (const p of r.productos) {
      expect(p).toEqual(expect.objectContaining({ idPublicacion: expect.any(Number), slug: expect.any(String), nombre: expect.any(String), disponible: expect.any(Boolean) }));
      expect(Number(p.precio), `${p.nombre} debe tener precio de venta`).toBeGreaterThan(0);
    }
    expect(JSON.stringify(r)).not.toContain('r2://');
    const grande = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 500 }));
    expect(grande.limite, 'El servidor limita la página a 40').toBe(40);
    const rara = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 'abc', limite: 'x' }));
    expect([rara.pagina, rara.limite]).toEqual([1, 12]);
  });

  test('@smoke muestra los productos publicados con precios de Comercio', async ({ page, request }) => {
    const productos = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 12 })).productos;
    test.skip(productos.length === 0, 'La tienda no tiene publicaciones visibles.');
    await page.goto('/catalogo');
    const cards = page.locator('.product-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards).toHaveCount(productos.length);
    await expect(page.locator('.result-counter')).toHaveText(`${productos.length} productos en esta página`);
    for (const p of productos) await expect(cards.filter({ hasText: p.nombre }).first()).toBeVisible();
    const simple = productos.find((p) => !(p.tiene_variantes && p.variantes?.length > 1)) || productos[0];
    await expect(cards.filter({ hasText: simple.nombre }).first()).toContainText(dinero(simple.precio));
    expect(await page.content()).not.toContain('r2://');
  });

  test('paginación: "Siguiente" muestra la página 2 de la API', async ({ page, request }) => {
    const p1 = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 12 }));
    test.skip(!p1.siguiente_pagina_posible, 'La tienda tiene una sola página de productos.');
    const p2 = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 2, limite: 12 }));
    await page.goto('/catalogo');
    await expect(page.locator('.product-card').first()).toBeVisible();
    await page.getByRole('button', { name: /Siguiente/ }).click();
    await expect(page.getByText('Página 2')).toBeVisible();
    if (p2.productos.length) await expect(page.locator('.product-card').filter({ hasText: p2.productos[0].nombre }).first()).toBeVisible();
    await page.getByRole('button', { name: /Anterior/ }).click();
    await expect(page.getByText('Página 1')).toBeVisible();
  });

  test('filtros locales: búsqueda, solo disponibles, orden por precio y limpiar', async ({ page, request }) => {
    const productos = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 12 })).productos;
    test.skip(productos.length < 2, 'Se necesitan al menos 2 productos publicados.');
    await page.goto('/catalogo');
    const cards = page.locator('.product-card');
    await expect(cards).toHaveCount(productos.length);

    const objetivo = productos[1];
    await page.getByRole('textbox', { name: 'Buscar productos de esta página' }).fill(objetivo.nombre);
    await expect(cards.filter({ hasText: objetivo.nombre }).first()).toBeVisible();
    const esperados = productos.filter((p) => `${p.nombre} ${p.categoria || ''} ${p.sku || ''}`.toLocaleLowerCase('es-AR').includes(objetivo.nombre.toLocaleLowerCase('es-AR')));
    await expect(cards).toHaveCount(esperados.length);

    await page.getByRole('textbox', { name: 'Buscar productos de esta página' }).fill('zzz-sin-coincidencias-e2e');
    await expect(page.getByText('No encontramos coincidencias')).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(cards).toHaveCount(productos.length);

    await page.getByLabel('Solo disponibles').check();
    await expect(cards).toHaveCount(productos.filter((p) => p.disponible).length || 0);
    await page.getByLabel('Solo disponibles').uncheck();

    await page.locator('.filter-select select').selectOption('precio-asc');
    const precios = await cards.locator('.product-price').allTextContents();
    const numeros = precios.map((t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.')));
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
  });

  test('categorías: el enlace del inicio filtra el catálogo', async ({ page, request }) => {
    const productos = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 12 })).productos;
    const categoria = productos.find((p) => p.categoria)?.categoria;
    test.skip(!categoria, 'Los productos no tienen categoría.');
    await page.goto('/');
    await page.locator('.category-tile').filter({ hasText: categoria }).first().click();
    await expect(page).toHaveURL(new RegExp(`/catalogo\\?categoria=${encodeURIComponent(categoria).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(page.locator('.filter-categories button.selected')).toHaveText(categoria);
    const visibles = productos.filter((p) => p.categoria === categoria).length;
    await expect(page.locator('.product-card')).toHaveCount(visibles);
  });

  test('el inicio muestra hasta 8 productos y el destacado', async ({ page, request }) => {
    const productos = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 12 })).productos;
    test.skip(productos.length === 0, 'Sin publicaciones.');
    await page.goto('/');
    await expect(page.locator('.home-products .product-card')).toHaveCount(Math.min(8, productos.length));
    const lead = productos.find((p) => p.destacado) || productos[0];
    await expect(page.locator('.hero-product')).toContainText(lead.nombre);
  });
});
