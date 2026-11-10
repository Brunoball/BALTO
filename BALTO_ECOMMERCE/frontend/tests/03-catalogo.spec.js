// Catálogo: catalogo_productos (API y UI). Búsqueda, categorías, precio, disponibilidad y orden
// se aplican en el SERVIDOR sobre todo el catálogo y quedan en la URL.
const { test, expect } = require('./soporte/test');
const { apiGet, expectExito } = require('./soporte/api');
const { dinero } = require('./soporte/flujos');

const listar = async (request, params = {}) => expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 40, ...params }));

test.describe('Catálogo', () => {
  test('@smoke catalogo_productos: contrato, límites y sin claves internas', async ({ request }) => {
    const r = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 12 }));
    expect(r.pagina).toBe(1);
    expect(r.limite).toBe(12);
    expect(typeof r.siguiente_pagina_posible).toBe('boolean');
    expect(Number.isInteger(r.total)).toBe(true);
    expect(r.total_paginas).toBe(Math.max(1, Math.ceil(r.total / 12)));
    expect(Array.isArray(r.categorias)).toBe(true);
    for (const p of r.productos) {
      expect(p).toEqual(expect.objectContaining({ idPublicacion: expect.any(Number), slug: expect.any(String), nombre: expect.any(String), disponible: expect.any(Boolean) }));
      expect(Number(p.precio), `${p.nombre} debe tener precio de venta`).toBeGreaterThan(0);
      for (const interno of ['_pos', '_ruta', '_nombre', '_busqueda', '_lista_precios']) expect(p).not.toHaveProperty(interno);
    }
    expect(JSON.stringify(r)).not.toContain('r2://');
    const grande = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 1, limite: 500 }));
    expect(grande.limite, 'El servidor limita la página a 40').toBe(40);
    const rara = expectExito(await apiGet(request, 'catalogo_productos', { pagina: 'abc', limite: 'x', orden: 'hackeo', precio_min: 'abc' }));
    expect([rara.pagina, rara.limite, rara.filtros.orden]).toEqual([1, 12, 'destacados']);
    expect(rara.total).toBe(r.total);
  });

  test('@smoke API: los filtros se aplican a TODO el catálogo, no a una página', async ({ request }) => {
    const todo = await listar(request);
    test.skip(todo.total < 2, 'Se necesitan al menos 2 productos publicados.');
    // Buscar un producto que NO esté en la primera página de 1 producto.
    const objetivo = (await listar(request, { limite: 1, pagina: todo.total })).productos[0];
    const r = await listar(request, { q: objetivo.nombre, limite: 1 });
    expect(r.productos[0]?.slug, 'el más relevante va primero aunque estuviera en la última página').toBe(objetivo.slug);
    expect(r.total).toBeGreaterThanOrEqual(1);

    const asc = await listar(request, { orden: 'precio-asc' });
    const precios = asc.productos.map((p) => Number(p.precio));
    expect(precios).toEqual([...precios].sort((a, b) => a - b));

    const disp = await listar(request, { solo_disponibles: '1' });
    expect(disp.productos.every((p) => p.disponible)).toBe(true);
    expect(disp.total).toBeLessThanOrEqual(todo.total);
    if (todo.total <= 40) expect(disp.total).toBe(todo.productos.filter((p) => p.disponible).length);

    const cat = todo.categorias[0];
    if (cat) {
      const porCat = await listar(request, { categoria: String(cat.id) });
      expect(porCat.total).toBe(cat.cantidad);
    }
    if (todo.precio_rango) {
      const min = Math.ceil(Number(todo.precio_rango.min));
      const enRango = await listar(request, { precio_min: String(min) });
      expect(enRango.productos.every((p) => Number(p.precio) >= min)).toBe(true);
    }
  });

  test('@smoke muestra los productos publicados con precios de Comercio', async ({ page, request }) => {
    const r = await listar(request, { limite: 20 });
    test.skip(r.productos.length === 0, 'La tienda no tiene publicaciones visibles.');
    await page.goto('/catalogo');
    const cards = page.locator('.product-card:not(.is-skeleton)');
    await expect(cards.first()).toBeVisible();
    await expect(cards).toHaveCount(r.productos.length);
    await expect(page.locator('.catalog-count')).toHaveText(`${r.total} ${r.total === 1 ? 'producto' : 'productos'}`);
    for (const p of r.productos) await expect(cards.filter({ hasText: p.nombre }).first()).toBeVisible();
    const simple = r.productos.find((p) => !(p.tiene_variantes && p.variantes?.length > 1)) || r.productos[0];
    await expect(cards.filter({ hasText: simple.nombre }).first()).toContainText(dinero(simple.precio));
    expect(await page.content()).not.toContain('r2://');
  });

  test('paginación: "Siguiente" y los números de página usan la API y quedan en la URL', async ({ page, request }) => {
    const p1 = await listar(request, { limite: 20 });
    test.skip(p1.total_paginas < 2, 'La tienda tiene una sola página de productos.');
    const p2 = await listar(request, { limite: 20, pagina: 2 });
    await page.goto('/catalogo');
    await expect(page.locator('.product-card:not(.is-skeleton)').first()).toBeVisible();
    await page.getByRole('button', { name: /Siguiente/ }).click();
    await expect(page).toHaveURL(/[?&]pagina=2/);
    await expect(page.getByText(`Página 2 de ${p1.total_paginas}`)).toBeVisible();
    await expect(page.locator('.product-card').filter({ hasText: p2.productos[0].nombre }).first()).toBeVisible();
    await page.goBack();
    await expect(page.getByText(`Página 1 de ${p1.total_paginas}`)).toBeVisible();
  });

  test('búsqueda: encuentra productos de cualquier página y se puede limpiar', async ({ page, request }) => {
    const todo = await listar(request);
    test.skip(todo.total < 2, 'Se necesitan al menos 2 productos publicados.');
    const objetivo = todo.productos[todo.productos.length - 1];
    await page.goto('/catalogo');
    const cards = page.locator('.product-card:not(.is-skeleton)');
    await expect(cards.first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar productos' }).fill(objetivo.nombre);
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(cards.filter({ hasText: objetivo.nombre }).first()).toBeVisible();
    const esperado = await listar(request, { q: objetivo.nombre, limite: 20 });
    await expect(page.locator('.catalog-count')).toHaveText(`${esperado.total} ${esperado.total === 1 ? 'producto' : 'productos'}`);

    await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('zzz-sin-coincidencias-e2e');
    await expect(page.getByText('No encontramos coincidencias')).toBeVisible();
    await page.getByRole('button', { name: /Limpiar filtros/ }).first().click();
    await expect(page).toHaveURL(/\/catalogo$/);
    await expect(cards.first()).toBeVisible();
  });

  test('solo disponibles y orden por precio (todo el catálogo)', async ({ page, request }) => {
    const todo = await listar(request, { limite: 20 });
    test.skip(todo.total < 2, 'Se necesitan al menos 2 productos publicados.');
    await page.goto('/catalogo');
    const cards = page.locator('.product-card:not(.is-skeleton)');
    await expect(cards.first()).toBeVisible();

    await page.getByLabel('Solo disponibles').check({ force: true });
    await expect(page).toHaveURL(/[?&]disponibles=1/);
    const disp = await listar(request, { solo_disponibles: '1', limite: 20 });
    await expect(page.locator('.catalog-count')).toHaveText(`${disp.total} ${disp.total === 1 ? 'producto' : 'productos'}`);
    await page.getByLabel('Solo disponibles').uncheck({ force: true });

    await page.getByRole('radio', { name: 'Precio: menor a mayor' }).click();
    await expect(page).toHaveURL(/[?&]orden=precio-asc/);
    const asc = await listar(request, { orden: 'precio-asc', limite: 20 });
    await expect(cards.first()).toContainText(asc.productos[0].nombre);
    const precios = await cards.locator('.product-price').allTextContents();
    const numeros = precios.map((t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.')));
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
  });

  test('categorías: se listan las del catálogo completo con su cantidad y filtran', async ({ page, request }) => {
    const todo = await listar(request, { limite: 20 });
    const cat = todo.categorias.find((c) => c.cantidad > 0);
    test.skip(!cat, 'Los productos no tienen categoría.');
    await page.goto('/catalogo');
    const boton = page.locator('.filter-categories button').filter({ hasText: cat.nombre }).first();
    await expect(boton).toContainText(String(cat.cantidad));
    await boton.click();
    await expect(page).toHaveURL(new RegExp(`[?&]categoria=${cat.id}(&|$)`));
    await expect(page.locator('.filter-categories button.selected')).toContainText(cat.nombre);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(cat.nombre);
    await expect(page.locator('.catalog-count')).toHaveText(`${cat.cantidad} ${cat.cantidad === 1 ? 'producto' : 'productos'}`);
  });

  test('un enlace con filtros en la URL abre el catálogo ya filtrado', async ({ page, request }) => {
    const todo = await listar(request);
    test.skip(!todo.productos.length, 'Sin publicaciones.');
    const nombre = todo.productos[0].nombre;
    await page.goto(`/catalogo?q=${encodeURIComponent(nombre)}&orden=nombre`);
    await expect(page.getByRole('searchbox', { name: 'Buscar productos' })).toHaveValue(nombre);
    await expect(page.getByRole('radio', { name: 'Nombre A–Z' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.product-card').filter({ hasText: nombre }).first()).toBeVisible();
  });

  test('el inicio muestra hasta 8 productos y el destacado', async ({ page, request }) => {
    const productos = (await listar(request, { limite: 8 })).productos;
    test.skip(productos.length === 0, 'Sin publicaciones.');
    await page.goto('/');
    await expect(page.locator('.home-products .product-card:not(.is-skeleton)')).toHaveCount(Math.min(8, productos.length));
    const lead = productos.find((p) => p.destacado) || productos[0];
    await expect(page.locator('.hero-product')).toContainText(lead.nombre);
  });
});
