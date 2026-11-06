const { test, expect } = require('@playwright/test');
const { catalogo, pick, limpiar, agregarDesdeFicha, tienda, money } = require('./helpers');

test.describe('Carrito', () => {
  test.beforeEach(async ({ page }) => { await limpiar(page); });

  test('agregar, sumar, cambiar cantidades, eliminar y vaciar', async ({ page, request }) => {
    const p = pick.simple(await catalogo(request));
    test.skip(!p, 'Se necesita un producto simple con stock >= 3');
    await agregarDesdeFicha(page, p);
    const drawer = page.getByRole('dialog', { name: /carrito/i });
    await expect(drawer.getByTestId('cart-line')).toHaveCount(1);
    await drawer.getByRole('button', { name: 'Cerrar carrito' }).first().click();
    await agregarDesdeFicha(page, p); // mismo producto: misma línea
    await expect(drawer.getByTestId('cart-line')).toHaveCount(1);
    await expect(drawer.getByLabel(/^Cantidad de .* \(u\)$/)).toHaveValue('2');
    await drawer.getByRole('button', { name: 'Aumentar cantidad' }).click();
    await expect(drawer.getByLabel(/^Cantidad de .* \(u\)$/)).toHaveValue('3');
    await drawer.getByRole('button', { name: 'Disminuir cantidad' }).click();
    await expect(drawer.getByLabel(/^Cantidad de .* \(u\)$/)).toHaveValue('2');
    await expect(drawer.getByTestId('drawer-subtotal')).toHaveText(money(Number(p.precio) * 2));
    await drawer.getByRole('button', { name: new RegExp(`^Quitar ${p.nombre}`) }).click();
    await expect(drawer.getByText('Tu carrito está vacío')).toBeVisible();
    await drawer.getByRole('button', { name: 'Cerrar carrito' }).first().click();
    await agregarDesdeFicha(page, p);
    await drawer.getByRole('button', { name: 'Vaciar carrito' }).click();
    await drawer.getByRole('button', { name: 'Sí, vaciar' }).click();
    await expect(drawer.getByText('Tu carrito está vacío')).toBeVisible();
  });

  test('valida cantidades inválidas', async ({ page, request }) => {
    const p = pick.simple(await catalogo(request));
    test.skip(!p, 'Se necesita un producto simple');
    await agregarDesdeFicha(page, p);
    const qty = page.getByRole('dialog').getByRole('textbox', { name: /^Cantidad de / });
    for (const malo of ['0', '1,5']) {
      await qty.fill(malo);
      await qty.press('Enter');
      await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
      await expect(qty).toHaveValue('1');
    }
    await qty.fill('99999');
    await qty.press('Enter');
    await expect(qty).toHaveValue(String(Math.min(Math.trunc(Number(p.cantidad_maxima)), 999)));
  });

  test('variantes distintas quedan como líneas independientes', async ({ page, request }) => {
    const p = pick.dosVariantes(await catalogo(request));
    test.skip(!p, 'No hay un producto con dos variantes disponibles publicadas');
    const [a, b] = p.variantes.filter((v) => v.disponible);
    await agregarDesdeFicha(page, p, { variante: a });
    await page.getByRole('button', { name: 'Cerrar carrito' }).first().click();
    await agregarDesdeFicha(page, p, { variante: b });
    await expect(page.getByRole('dialog').getByTestId('cart-line')).toHaveCount(2);
  });

  test('producto fraccionado acepta decimales', async ({ page, request }) => {
    const p = pick.decimal(await catalogo(request));
    test.skip(!p, 'No hay productos con unidad decimal publicados');
    await agregarDesdeFicha(page, p, { cantidad: 1.5 });
    await expect(page.getByRole('dialog').getByRole('textbox', { name: /^Cantidad de / })).toHaveValue('1,5');
  });

  test('persiste al recargar, aislado por dominio, y se actualiza con el precio del servidor', async ({ page, request }) => {
    const p = pick.simple(await catalogo(request));
    test.skip(!p, 'Se necesita un producto simple');
    await agregarDesdeFicha(page, p);
    const key = `balto:ecommerce:v2:${tienda()}`;
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
    expect(saved).toHaveLength(1);
    // Simula un precio viejo guardado en el navegador: el servidor debe corregirlo y avisar.
    await page.evaluate((k) => { const v = JSON.parse(localStorage.getItem(k)); v[0].precio = '1.00'; localStorage.setItem(k, JSON.stringify(v)); }, key);
    await page.goto('/carrito');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByText('Actualizamos precios con los valores vigentes')).toBeVisible();
    await expect(page.getByTestId('summary-total')).toHaveText(money(p.precio));
    const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
    expect(Number(after[0].precio)).toBe(Number(p.precio));
  });

  test('si el stock no alcanza, bloquea la línea y permite ajustar al máximo', async ({ page, request }) => {
    const p = pick.simple(await catalogo(request));
    test.skip(!p || Number(p.cantidad_maxima) >= 999, 'Se necesita un producto simple con stock menor a 999');
    await agregarDesdeFicha(page, p);
    const key = `balto:ecommerce:v2:${tienda()}`;
    const exceso = Math.trunc(Number(p.cantidad_maxima)) + 1;
    // Simula un carrito guardado cuando habia mas stock que ahora en Comercio.
    await page.evaluate(([k, q]) => { const v = JSON.parse(localStorage.getItem(k)); v[0].cantidad = q; v[0].cantidad_maxima = null; localStorage.setItem(k, JSON.stringify(v)); }, [key, exceso]);
    await page.goto('/carrito');
    await expect(page.getByText(/La cantidad supera lo disponible/)).toBeVisible();
    await page.getByRole('button', { name: /^Ajustar a / }).click();
    await expect(page.getByText(/La cantidad supera lo disponible/)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /^Cantidad de / })).toHaveValue(String(Math.trunc(Number(p.cantidad_maxima))));
  });

  test('carrito usable en móvil sin scroll horizontal @mobile', async ({ page, request }) => {
    const p = pick.simple(await catalogo(request));
    test.skip(!p, 'Se necesita un producto simple');
    await agregarDesdeFicha(page, p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.goto('/carrito');
    await expect(page.getByTestId('cart-line')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
});
