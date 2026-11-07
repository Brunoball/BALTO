// Carrito: carrito_validar (API) y todo el comportamiento del panel y de /carrito.
const { test, expect } = require('./soporte/test');
const { ENV } = require('./soporte/entorno');
const { apiPost, directa, expectExito, expectError } = require('./soporte/api');
const { productos, elegir, disponibles } = require('./soporte/catalogo');
const { agregarDesdeFicha, cerrarCarrito, panelCarrito, dinero, esperarCarritoGuardado, modificarCarritoGuardado } = require('./soporte/flujos');

const CLAVE = () => `balto:ecommerce:v2:${ENV.tienda}`;

test.describe('Carrito · API carrito_validar', () => {
  test('@smoke recalcula precio y stock con los datos del servidor', async ({ request }) => {
    const p = elegir.simple(await productos(request), 2);
    test.skip(!p, 'Se necesita un producto simple con stock >= 2.');
    const r = expectExito(await apiPost(request, 'carrito_validar', { items: [{ idPublicacion: p.idPublicacion, cantidad: 2, precio: '0.01' }] }));
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({ idPublicacion: p.idPublicacion, estado: 'OK', comprable: true });
    expect(Number(r.lineas[0].precio_unitario)).toBe(Number(p.precio));
    expect(Number(r.resumen.subtotal)).toBeCloseTo(Number(p.precio) * 2, 2);
  });

  test('rechaza carrito vacío, publicaciones inexistentes y GET', async ({ request }) => {
    expectError(await apiPost(request, 'carrito_validar', { items: [] }), 422, 'CARRITO_VACIO');
    const r = await apiPost(request, 'carrito_validar', { items: [{ idPublicacion: 999999999, cantidad: 1 }] });
    if (r.status === 200) expect(r.json.lineas[0].comprable).toBe(false);
    else expect(r.json.exito).toBe(false);
    expectError(await directa(request, 'carrito_validar'), 405, 'METODO_NO_PERMITIDO');
  });
});

test.describe('Carrito · interfaz', () => {
  test('@smoke agregar, sumar, cambiar cantidades, eliminar y vaciar', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 3);
    test.skip(!p, 'Se necesita un producto simple con stock >= 3.');
    await agregarDesdeFicha(page, p);
    const panel = panelCarrito(page);
    await expect(panel.getByTestId('cart-line')).toHaveCount(1);
    await cerrarCarrito(page);
    await agregarDesdeFicha(page, p); // mismo producto: misma línea
    await expect(panel.getByTestId('cart-line')).toHaveCount(1);
    const cantidad = panel.getByLabel(/^Cantidad de .* \(u\)$/);
    await expect(cantidad).toHaveValue('2');
    await panel.getByRole('button', { name: 'Aumentar cantidad' }).click();
    await expect(cantidad).toHaveValue('3');
    await panel.getByRole('button', { name: 'Disminuir cantidad' }).click();
    await expect(cantidad).toHaveValue('2');
    await expect(panel.getByTestId('drawer-subtotal')).toHaveText(dinero(Number(p.precio) * 2));
    await panel.getByRole('button', { name: new RegExp(`^Quitar ${p.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click();
    await expect(panel.getByText('Tu carrito está vacío')).toBeVisible();
    await cerrarCarrito(page);
    await agregarDesdeFicha(page, p);
    await panel.getByRole('button', { name: 'Vaciar carrito' }).click();
    await panel.getByRole('button', { name: 'Sí, vaciar' }).click();
    await expect(panel.getByText('Tu carrito está vacío')).toBeVisible();
  });

  test('valida cantidades inválidas', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    await agregarDesdeFicha(page, p);
    const qty = panelCarrito(page).getByRole('textbox', { name: /^Cantidad de / });
    for (const malo of ['0', '1,5']) {
      await qty.fill(malo);
      await qty.press('Enter');
      await expect(panelCarrito(page).getByRole('alert')).toBeVisible();
      await expect(qty).toHaveValue('1');
    }
    await qty.fill('99999');
    await qty.press('Enter');
    await expect(qty).toHaveValue(String(Math.min(Math.trunc(Number(p.cantidad_maxima)), 999)));
  });

  test('variantes distintas quedan como líneas independientes', async ({ page, request }) => {
    const p = elegir.dosVariantes(await productos(request));
    test.skip(!p, 'No hay un producto con dos variantes disponibles.');
    const [a, b] = disponibles(p);
    await agregarDesdeFicha(page, p, { variante: a });
    await cerrarCarrito(page);
    await agregarDesdeFicha(page, p, { variante: b });
    await expect(panelCarrito(page).getByTestId('cart-line')).toHaveCount(2);
  });

  test('producto fraccionado acepta decimales', async ({ page, request }) => {
    const p = elegir.decimal(await productos(request));
    test.skip(!p, 'No hay productos con unidad decimal publicados.');
    await agregarDesdeFicha(page, p, { cantidad: 1.5 });
    await expect(panelCarrito(page).getByRole('textbox', { name: /^Cantidad de / })).toHaveValue('1,5');
  });

  test('persiste al recargar, aislado por dominio, y toma el precio del servidor', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    await agregarDesdeFicha(page, p);
    // Precio viejo guardado en el navegador: el servidor lo corrige y la web avisa.
    await modificarCarritoGuardado(page, CLAVE(), "v[0].precio = '1.00';");
    await page.goto('/carrito');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByText('Actualizamos precios con los valores vigentes')).toBeVisible();
    await expect(page.getByTestId('summary-total')).toHaveText(dinero(p.precio));
    const despues = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), CLAVE());
    expect(Number(despues[0].precio)).toBe(Number(p.precio));
  });

  test('si el stock no alcanza, bloquea la línea y permite ajustar al máximo', async ({ page, request }) => {
    const p = elegir.simpleConTope(await productos(request));
    test.skip(!p, 'Se necesita un producto simple con stock menor a 999.');
    await agregarDesdeFicha(page, p);
    // Carrito guardado cuando había más stock que ahora en Comercio.
    await modificarCarritoGuardado(page, CLAVE(), 'v[0].cantidad = a; v[0].cantidad_maxima = null;', Math.trunc(Number(p.cantidad_maxima)) + 1);
    await page.goto('/carrito');
    await expect(page.getByText(/La cantidad supera lo disponible/)).toBeVisible();
    await page.getByRole('button', { name: /^Ajustar a / }).click();
    await expect(page.getByText(/La cantidad supera lo disponible/)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /^Cantidad de / })).toHaveValue(String(Math.trunc(Number(p.cantidad_maxima))));
  });

  test('la página /carrito muestra resumen y lleva al checkout cuando está habilitado', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    const cfg = (await apiPost(request, 'carrito_validar', { items: [{ idPublicacion: p.idPublicacion, cantidad: 1 }] })).json;
    await agregarDesdeFicha(page, p);
    await page.goto('/carrito');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Carrito/);
    await expect(page.getByTestId('summary-subtotal')).toHaveText(dinero(p.precio));
    if (cfg?.checkout_habilitado) {
      await page.getByTestId('go-checkout').click();
      await expect(page).toHaveURL(/\/checkout$/);
    } else {
      await expect(page.getByTestId('checkout-off')).toBeVisible();
    }
  });
});
