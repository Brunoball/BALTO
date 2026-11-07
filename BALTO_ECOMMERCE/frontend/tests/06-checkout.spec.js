// Checkout: checkout_crear. La interfaz completa se prueba con el pedido simulado (no escribe);
// el pedido REAL de prueba solo corre en modo PRUEBA con PW_ALLOW_MUTATIONS=1.
const { test, expect } = require('./soporte/test');
const { ENV, requiereMutaciones } = require('./soporte/entorno');
const { apiPost, configuracionTienda, expectError } = require('./soporte/api');
const { productos, elegir } = require('./soporte/catalogo');
const { agregarDesdeFicha, completarComprador, elegirEntrega, completarDomicilio, elegirPago, dinero } = require('./soporte/flujos');
const { simularApi } = require('./soporte/simulador');
const { OBSERVACION_PEDIDO, apellidoE2E } = require('./soporte/datos');

async function productoSimple(request) {
  const p = elegir.simple(await productos(request), 2);
  test.skip(!p, 'Se necesita un producto simple con stock >= 2.');
  return p;
}

test.describe('Checkout · API', () => {
  test('checkout_crear rechaza datos inválidos sin crear pedidos', async ({ request }) => {
    const cfg = await configuracionTienda(request);
    const r = await apiPost(request, 'checkout_crear', { clave_idempotencia: 'e2e-invalido-000000001', items: [], comprador: {}, total_esperado: '0' });
    expect(r.json?.exito).toBe(false);
    if (!cfg.checkout_habilitado) expectError(r, 403, ['CHECKOUT_DESHABILITADO', 'ORIGEN_REQUERIDO']);
    else expect([400, 409, 422]).toContain(r.status);
  });

  test('checkout_crear con un total distinto devuelve los precios vigentes y no registra el pedido', async ({ request }) => {
    const cfg = await configuracionTienda(request);
    test.skip(!cfg.checkout_habilitado, 'El checkout no está habilitado en esta tienda (ni en modo prueba).');
    const p = await productoSimple(request);
    const modalidad = cfg.entrega_modalidades?.find((m) => !m.requiere_direccion)?.codigo || cfg.entrega_modalidades?.[0]?.codigo;
    const metodo = cfg.pagos?.activo ? cfg.pagos.metodos_por_modalidad?.[modalidad]?.[0]?.codigo : undefined;
    const r = await apiPost(request, 'checkout_crear', {
      clave_idempotencia: `e2e-total-${Date.now()}`, items: [{ idPublicacion: p.idPublicacion, cantidad: 1 }], total_esperado: '0.01', website: '', cuenta: 'INVITADO',
      ...(metodo ? { pago: { metodo } } : {}),
      comprador: { nombre: 'Prueba', apellido: 'Total', email: ENV.emailPedidos, telefono: '3515550000', modalidad_entrega: modalidad, observaciones: OBSERVACION_PEDIDO },
    });
    expectError(r, 409, 'PRECIOS_ACTUALIZADOS');
    expect(Number(r.json.lineas[0].precio_unitario)).toBe(Number(p.precio));
  });
});

test.describe('Checkout · interfaz con checkout deshabilitado (real)', () => {
  test('no se puede confirmar', async ({ page, request }) => {
    const cfg = await configuracionTienda(request);
    test.skip(cfg.checkout_habilitado === true, 'El checkout está habilitado (modo prueba o público).');
    const p = await productoSimple(request);
    await agregarDesdeFicha(page, p);
    await page.goto('/carrito');
    await expect(page.getByTestId('checkout-off')).toBeVisible();
    await page.goto('/checkout');
    await expect(page.getByTestId(cfg.checkout_bloqueo === 'SIN_MEDIOS_PAGO' ? 'checkout-sin-pagos' : 'checkout-disabled')).toBeVisible();
    await expect(page.getByTestId('checkout-submit')).toBeDisabled();
  });
});

test.describe('Checkout · interfaz (pedido simulado, no escribe)', () => {
  test('@smoke validaciones, retiro, doble clic y confirmación', async ({ page, request }) => {
    const p = await productoSimple(request);
    const sim = await simularApi(page, { tienda: { checkout: true, modo: 'PRUEBA', pagos: false, cuentas: false, entregas: ['RETIRO', 'ENVIO'] } });
    await agregarDesdeFicha(page, p, { cantidad: 2 });
    await page.goto('/checkout');
    await expect(page.getByText('Modo prueba autorizado.')).toBeVisible();
    await expect(page.getByText('COMPRA COMO INVITADO')).toBeVisible();
    const submit = page.getByTestId('checkout-submit');
    await expect(submit).toBeEnabled();

    await submit.click();
    await expect(page.locator('#checkout-nombre-error')).toBeVisible();
    await expect(page.locator('#checkout-nombre')).toBeFocused();
    await completarComprador(page, { email: 'no-es-email', apellido: apellidoE2E() });
    await submit.click();
    await expect(page.getByText('Ingresá un email válido.')).toBeVisible();
    await page.locator('#checkout-email').fill(ENV.emailPedidos);
    await submit.click();
    await expect(page.locator('#checkout-modalidad_entrega-error')).toBeVisible();
    await elegirEntrega(page, 'RETIRO');
    await expect(page.getByTestId('summary-total')).toHaveText(dinero(Number(p.precio) * 2));
    await page.locator('#checkout-observaciones').fill(OBSERVACION_PEDIDO);

    await submit.dblclick();
    await expect(page).toHaveURL(/\/pedido\/confirmado$/);
    expect(sim.llamadas('checkout_crear'), 'El doble clic no debe enviar dos pedidos').toHaveLength(1);
    const enviado = sim.llamadas('checkout_crear')[0].body;
    expect(enviado).toMatchObject({ cuenta: 'INVITADO', website: '', comprador: { modalidad_entrega: 'RETIRO', email: ENV.emailPedidos, observaciones: OBSERVACION_PEDIDO } });
    expect(enviado.items).toEqual([{ idPublicacion: p.idPublicacion, idVariante: null, cantidad: '2' }]);
    expect(enviado.clave_idempotencia).toMatch(/^[\w-]{16,}$/);
    await expect(page.getByTestId('order-number')).toHaveText(/^T-\d{6}-[A-Z2-9]{8}$/);
    await expect(page.getByText('pendiente de confirmación')).toBeVisible();
    await expect(page.locator('.order-summary-lines')).toContainText(p.nombre);
    await page.goto('/carrito');
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
  });

  test('envío a domicilio exige y envía la dirección', async ({ page, request }) => {
    const p = await productoSimple(request);
    const sim = await simularApi(page, { tienda: { checkout: true, pagos: false, cuentas: false, entregas: ['RETIRO', 'ENVIO'] } });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await completarComprador(page, { email: ENV.emailPedidos, apellido: apellidoE2E() });
    await elegirEntrega(page, 'ENVIO');
    await expect(page.getByTestId('summary-total')).toBeVisible();
    await expect(page.getByTestId('summary-shipping')).toHaveText('A coordinar');
    await page.getByTestId('checkout-submit').click();
    await expect(page.locator('#entrega-calle-error')).toBeVisible();
    await completarDomicilio(page, 'entrega', { calle: 'Avenida Colón', altura: '1234', codigoPostal: 'X5000ABC' });
    await page.getByTestId('checkout-submit').click();
    await expect(page).toHaveURL(/\/pedido\/confirmado$/);
    const entrega = sim.llamadas('checkout_crear')[0].body.comprador.entrega;
    expect(entrega).toMatchObject({ calle: 'Avenida Colón', altura: '1234', provincia: 'Córdoba', localidad: 'Córdoba' });
    await expect(page.getByText('El costo de envío no está incluido')).toBeVisible();
  });

  test('error del servidor: muestra el mensaje y conserva los datos', async ({ page, request }) => {
    const p = await productoSimple(request);
    await simularApi(page, { tienda: { checkout: true, pagos: false, cuentas: false, entregas: ['RETIRO'] }, fallar: { checkout_crear: { status: 409, codigo: 'IDEMPOTENCIA_CONFLICTO', mensaje: 'Detectamos un pedido distinto con la misma clave.' } } });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await completarComprador(page, { email: ENV.emailPedidos, apellido: apellidoE2E() });
    await page.getByTestId('checkout-submit').click();
    await expect(page.getByTestId('checkout-error')).toHaveText('Detectamos un pedido distinto con la misma clave.');
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.locator('#checkout-email')).toHaveValue(ENV.emailPedidos);
  });

  test('los datos del formulario se conservan al recargar (solo en esta pestaña)', async ({ page, request }) => {
    const p = await productoSimple(request);
    await simularApi(page, { tienda: { checkout: true, pagos: false, cuentas: false, entregas: ['RETIRO'] } });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await completarComprador(page, { nombre: 'Recarga', email: ENV.emailPedidos, apellido: apellidoE2E() });
    await page.reload();
    await expect(page.locator('#checkout-nombre')).toHaveValue('Recarga');
    const enLocal = await page.evaluate(() => JSON.stringify(localStorage));
    expect(enLocal, 'Los datos personales no se guardan en localStorage').not.toContain(ENV.emailPedidos);
  });

  test('medio de pago obligatorio cuando la tienda tiene pagos activos', async ({ page, request }) => {
    const p = await productoSimple(request);
    const sim = await simularApi(page, { tienda: { checkout: true, pagos: true, cuentas: false, entregas: ['RETIRO'] } });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await completarComprador(page, { email: ENV.emailPedidos, apellido: apellidoE2E() });
    await expect(page.getByRole('radiogroup', { name: 'Medio de pago' })).toBeVisible();
    await page.getByTestId('checkout-submit').click();
    await expect(page.getByText('Elegí un medio de pago.')).toBeVisible();
    await elegirPago(page, 'EFECTIVO');
    await page.getByTestId('checkout-submit').click();
    await expect(page).toHaveURL(/\/pedido\/confirmado$/);
    expect(sim.llamadas('checkout_crear')[0].body.pago).toEqual({ metodo: 'EFECTIVO' });
    await expect(page.getByTestId('payment-message')).toContainText('efectivo al retirar');
  });
});

test.describe('Checkout · pedido REAL de prueba', () => {
  test('@mutations crea un pedido T-… en modo prueba autorizado', async ({ page, request }) => {
    requiereMutaciones(test);
    const cfg = await configuracionTienda(request);
    test.skip(cfg.checkout_modo !== 'PRUEBA', 'Solo en modo PRUEBA: el proxy local necesita BALTO_ECOMMERCE_CHECKOUT_TEST_TOKEN (ver README).');
    const p = await productoSimple(request);
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await expect(page.getByText('Modo prueba autorizado.')).toBeVisible();
    await completarComprador(page, { email: ENV.emailPedidos, apellido: apellidoE2E(), observaciones: OBSERVACION_PEDIDO });
    const modalidad = cfg.entrega_modalidades?.find((m) => !m.requiere_direccion)?.codigo;
    test.skip(cfg.entrega_modalidades?.length && !modalidad, 'La tienda solo tiene envío a domicilio.');
    if (modalidad) await elegirEntrega(page, modalidad);
    if (cfg.pagos?.activo) await elegirPago(page, cfg.pagos.metodos_por_modalidad?.[modalidad]?.find((m) => m.codigo === 'EFECTIVO') ? 'EFECTIVO' : 'TRANSFERENCIA_BANCARIA');
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('action=checkout_crear')) posts.push(r); });
    await page.getByTestId('checkout-submit').dblclick();
    await expect(page).toHaveURL(/\/pedido\/confirmado$/);
    await expect(page.getByTestId('order-number')).toHaveText(/^T-\d{6}-[A-Z2-9]{8}$/);
    await expect(page.getByText('Pedido de prueba: no genera ventas')).toBeVisible();
    expect(posts).toHaveLength(1);
    test.info().annotations.push({ type: 'pedido', description: await page.getByTestId('order-number').textContent() });
  });
});
