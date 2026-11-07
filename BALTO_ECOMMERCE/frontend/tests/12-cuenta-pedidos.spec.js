// Mi cuenta · pedidos: cliente_pedidos (paginado) y cliente_pedido_detalle (con estado del pago).
const { test, expect } = require('./soporte/test');
const { prepararCuenta } = require('./soporte/sesion');
const { pedidoEjemplo } = require('./soporte/simulador');
const { dinero } = require('./soporte/flujos');

test.describe('Mi cuenta · pedidos', () => {
  test('@smoke listado paginado y detalle con el estado del pago', async ({ page }) => {
    const pedidos = Array.from({ length: 12 }, (_, i) => pedidoEjemplo(12 - i));
    const cuenta = await prepararCuenta(page, { escribe: false, cuenta: { pedidos } });
    await page.goto('/mi-cuenta/pedidos');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Mis pedidos/);
    if (cuenta.modo === 'real') {
      // Con la sesión real solo se lee lo que haya en esa cuenta.
      const filas = page.locator('.order-row');
      await expect(filas.first().or(page.getByText('Todavía no hiciste pedidos con tu cuenta'))).toBeVisible();
      if (await filas.count()) {
        await filas.first().getByRole('link', { name: 'Ver detalle' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Pedido #/);
        await expect(page.locator('.order-summary-lines li').first()).toBeVisible();
      }
      return;
    }
    const filas = page.locator('.order-row');
    await expect(filas).toHaveCount(10);
    await expect(filas.first()).toContainText(`#${pedidos[0].numero}`);
    await expect(filas.first()).toContainText('Prueba');
    await expect(filas.first()).toContainText(dinero(pedidos[0].total));
    const paginacion = page.getByRole('navigation', { name: 'Paginación de pedidos' });
    await expect(paginacion).toContainText('Página 1 de 2');
    await paginacion.getByRole('button', { name: /Siguiente/ }).click();
    await expect(page).toHaveURL(/\/mi-cuenta\/pedidos\?pagina=2$/);
    await expect(filas).toHaveCount(2);
    expect([...new Set(cuenta.sim.llamadas('cliente_pedidos').map((l) => l.params.pagina))]).toEqual(['1', '2']);

    const objetivo = pedidos[11];
    await filas.filter({ hasText: objetivo.numero }).getByRole('link', { name: 'Ver detalle' }).click();
    await expect(page).toHaveURL(new RegExp(`/mi-cuenta/pedidos/${objetivo.numero}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(`^Pedido #${objetivo.numero}`));
    expect(cuenta.sim.llamadas('cliente_pedido_detalle').at(-1).params.numero).toBe(objetivo.numero);
    await expect(page.locator('.order-detail')).toContainText(objetivo.items[0].nombre);
    await expect(page.getByTestId('payment-state')).toBeVisible();
    await expect(page.locator('.bank-details')).toContainText('comercio.simulado');
    await expect(page.getByText('Pedido de prueba')).toBeVisible();
    await page.getByRole('link', { name: 'Volver a mis pedidos' }).click();
    await expect(page).toHaveURL(/\/mi-cuenta\/pedidos$/);
  });

  test('cuenta sin pedidos y pedido inexistente', async ({ page }) => {
    const cuenta = await prepararCuenta(page, { escribe: false, cuenta: { pedidos: [] } });
    if (cuenta.modo === 'simulado') {
      await page.goto('/mi-cuenta/pedidos');
      await expect(page.getByText('Todavía no hiciste pedidos con tu cuenta')).toBeVisible();
    }
    await page.goto('/mi-cuenta/pedidos/T-200101-NOEXISTE');
    await expect(page.getByText('No encontramos ese pedido en tu cuenta')).toBeVisible();
  });

  test('un pedido de la cuenta permite subir el comprobante con CSRF (sin token de invitado)', async ({ page }) => {
    const cuenta = await prepararCuenta(page, { escribe: false, cuenta: { pedidos: [pedidoEjemplo(1)] } });
    test.skip(cuenta.modo === 'real', 'Con sesión real no se suben comprobantes a pedidos existentes.');
    await page.goto(`/mi-cuenta/pedidos/${pedidoEjemplo(1).numero}`);
    await page.getByTestId('proof-open').click();
    await page.locator('.proof-uploader input[type=file]').setInputFiles({ name: 'transferencia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%e2e\n') });
    await page.getByTestId('proof-submit').click();
    await expect(page.getByText('¡Recibimos tu comprobante!')).toBeVisible();
    const subida = cuenta.sim.llamadas('pago_comprobante_subir')[0];
    expect(subida.headers['x-csrf-token']).toBe(cuenta.csrf);
    expect(subida.headers['x-ecom-pedido-token']).toBeUndefined();
  });
});
