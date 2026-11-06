const { test, expect } = require('@playwright/test');
const { catalogo, configuracion, pick, limpiar, agregarDesdeFicha } = require('./helpers');

test.describe('Checkout', () => {
  test.beforeEach(async ({ page }) => { await limpiar(page); });

  test('con checkout deshabilitado no se puede confirmar', async ({ page, request }) => {
    const cfg = await configuracion(request);
    test.skip(cfg.checkout_habilitado === true, 'El checkout está habilitado (modo prueba o público)');
    const p = pick.simple(await catalogo(request));
    test.skip(!p, 'Se necesita un producto simple');
    await agregarDesdeFicha(page, p);
    await page.goto('/carrito');
    await expect(page.getByTestId('checkout-off')).toBeVisible();
    await page.goto('/checkout');
    await expect(page.getByTestId('checkout-disabled')).toBeVisible();
    await expect(page.getByTestId('checkout-submit')).toBeDisabled();
  });

  // Crea un pedido REAL en la base eCommerce. Solo con el modo prueba autorizado
  // (token en el proxy local) y E2E_CHECKOUT_PRUEBA=1. Ver README_ECOMMERCE.md.
  test('pedido de prueba autorizado: validaciones, doble clic y confirmación', async ({ page, request }) => {
    test.skip(process.env.E2E_CHECKOUT_PRUEBA !== '1', 'Definir E2E_CHECKOUT_PRUEBA=1 para crear un pedido de prueba');
    const cfg = await configuracion(request);
    test.skip(cfg.checkout_modo !== 'PRUEBA', 'El proxy local no tiene el token de checkout de prueba');
    const p = pick.simple(await catalogo(request));
    test.skip(!p, 'Se necesita un producto simple');
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await expect(page.getByText('Modo prueba autorizado.')).toBeVisible();
    const submit = page.getByTestId('checkout-submit');
    await expect(submit).toBeEnabled();
    await page.getByLabel(/^Nombre/).fill('Prueba');
    await page.getByLabel(/^Apellido/).fill('Automatizada');
    await page.getByLabel(/^Email/).fill('no-es-email');
    await page.getByLabel(/^Teléfono/).fill('351 555 0000');
    await submit.click();
    await expect(page.getByText('Ingresá un email válido.')).toBeVisible();
    await page.getByLabel(/^Email/).fill(process.env.E2E_CHECKOUT_EMAIL || 'pedido.prueba@example.com');
    await page.getByLabel(/^Observaciones/).fill('PEDIDO DE PRUEBA AUTOMATIZADO - NO PREPARAR');
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('action=checkout_crear')) posts.push(r); });
    await submit.dblclick();
    await expect(page).toHaveURL(/\/pedido\/confirmado$/);
    await expect(page.getByTestId('order-number')).toHaveText(/^T-\d{6}-[A-Z2-9]{8}$/);
    expect(posts).toHaveLength(1);
    await expect(page.getByText('pendiente de confirmación')).toBeVisible();
    await page.goto('/carrito');
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
  });
});
