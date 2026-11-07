// Móvil: sin scroll horizontal en todas las pantallas y menú desplegable.
const { devices } = require('@playwright/test');
const { test, expect } = require('./soporte/test');
const { productos, elegir } = require('./soporte/catalogo');
const { agregarDesdeFicha } = require('./soporte/flujos');
const { simularApi } = require('./soporte/simulador');

const { defaultBrowserType, ...movil } = devices['Pixel 7'];
test.use(movil);

const desborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('@mobile Móvil', () => {
  test('ninguna pantalla pública tiene scroll horizontal', async ({ page, request }) => {
    const ps = await productos(request);
    for (const ruta of ['/', '/catalogo', ...(ps[0] ? [`/producto/${ps[0].slug}`] : []), '/favoritos', '/contacto', '/carrito', '/iniciar-sesion', '/no-existe']) {
      await page.goto(ruta);
      await expect(page.locator('main')).toBeVisible();
      expect(await desborde(page), `Desborde horizontal en ${ruta}`).toBeLessThanOrEqual(1);
    }
  });

  test('carrito y checkout usables en móvil', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    await simularApi(page, { tienda: { checkout: true, pagos: true, cuentas: false, entregas: ['RETIRO', 'ENVIO'] } });
    await agregarDesdeFicha(page, p);
    expect(await desborde(page)).toBeLessThanOrEqual(1);
    await page.goto('/carrito');
    await expect(page.getByTestId('cart-line')).toBeVisible();
    expect(await desborde(page)).toBeLessThanOrEqual(1);
    await page.goto('/checkout');
    await page.locator('input[name="modalidad_entrega"][value="ENVIO"]').check();
    await expect(page.locator('#entrega-calle')).toBeVisible();
    expect(await desborde(page)).toBeLessThanOrEqual(1);
  });

  test('menú: abre, navega, se cierra con Escape', async ({ page }) => {
    await page.goto('/');
    const boton = page.getByRole('button', { name: 'Abrir menú' });
    await boton.click();
    await expect(page.getByRole('button', { name: 'Cerrar menú' })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Contacto' }).click();
    await expect(page).toHaveURL(/\/contacto$/);
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute('aria-expanded', 'false');
  });
});
