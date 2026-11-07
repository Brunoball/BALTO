// Pagos: pagos_metodos_disponibles, pago_detalle_pedido, pago_comprobante_subir,
// pago_comprobante_estado y pago_comprobante_descargar.
const { test, expect } = require('./soporte/test');
const { ENV, requiereMutaciones } = require('./soporte/entorno');
const { apiGet, apiPost, directa, configuracionTienda, expectExito } = require('./soporte/api');
const { productos, elegir } = require('./soporte/catalogo');
const { agregarDesdeFicha, completarComprador, elegirEntrega, elegirPago, PNG_1X1, dinero } = require('./soporte/flujos');
const { simularApi, CUENTA_BANCARIA } = require('./soporte/simulador');
const { OBSERVACION_PEDIDO, apellidoE2E } = require('./soporte/datos');

const NUMERO_FALSO = 'T-200101-ZZZZZZZZ';

test.describe('Pagos · API', () => {
  test('@smoke pagos_metodos_disponibles coincide con la configuración de la tienda', async ({ request }) => {
    const r = expectExito(await apiGet(request, 'pagos_metodos_disponibles'));
    const cfg = await configuracionTienda(request);
    expect(r.pagos.activo).toBe(Boolean(cfg.pagos?.activo));
    expect(r.pagos.estado).toBe(cfg.pagos?.estado);
    if (r.pagos.activo) {
      expect(Object.keys(r.pagos.metodos_por_modalidad || {}).length).toBeGreaterThan(0);
      for (const lista of Object.values(r.pagos.metodos_por_modalidad)) for (const m of lista) expect(['TRANSFERENCIA_BANCARIA', 'EFECTIVO', 'MERCADO_PAGO']).toContain(m.codigo);
    }
  });

  test('las acciones del pedido exigen sesión o el token del pedido', async ({ request }) => {
    for (const action of ['pago_detalle_pedido', 'pago_comprobante_estado', 'pago_comprobante_descargar']) {
      const sinNada = await apiGet(request, action, { numero: NUMERO_FALSO, id: 1 });
      expect([401, 404], `${action} sin autorización`).toContain(sinNada.status);
      expect(sinNada.json?.exito).toBe(false);
      const tokenFalso = await apiGet(request, action, { numero: NUMERO_FALSO, id: 1 }, { headers: { 'X-Ecom-Pedido-Token': 'a'.repeat(43) } });
      expect([401, 404], `${action} con token falso`).toContain(tokenFalso.status);
    }
    const subirJson = await apiPost(request, 'pago_comprobante_subir', {}, { params: { numero: NUMERO_FALSO } });
    expect([401, 404, 415]).toContain(subirJson.status);
    expect((await directa(request, 'pago_comprobante_subir', { params: { numero: NUMERO_FALSO } })).status).toBe(405);
  });
});

test.describe('Pagos · interfaz (simulada, no escribe)', () => {
  test('transferencia: datos de la cuenta, carga de comprobante, revisión y descarga', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    const sim = await simularApi(page, { tienda: { checkout: true, pagos: true, cuentas: false, entregas: ['RETIRO'] } });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await completarComprador(page, { email: ENV.emailPedidos, apellido: apellidoE2E() });
    await elegirPago(page, 'TRANSFERENCIA_BANCARIA');
    await expect(page.locator('.payment-preview')).toContainText(CUENTA_BANCARIA.alias);
    await page.getByTestId('checkout-submit').click();
    await expect(page).toHaveURL(/\/pedido\/confirmado$/);

    const numero = (await page.getByTestId('order-number').textContent()).trim();
    const autorizacion = await page.evaluate((k) => sessionStorage.getItem(k), `balto:ecommerce:pedido-autorizacion:${ENV.tienda}:${numero}`);
    expect(autorizacion, 'El token del invitado vive solo en sessionStorage de esta pestaña').toContain('token');
    const detalle = sim.llamadas('pago_detalle_pedido')[0];
    expect(detalle.headers['x-ecom-pedido-token']).toBe(JSON.parse(autorizacion).token);
    expect(detalle.params.numero).toBe(numero);

    await expect(page.getByTestId('payment-message')).toHaveText('Elegiste transferencia bancaria.');
    await expect(page.getByTestId('bank-amount')).toHaveText(dinero(p.precio));
    await expect(page.locator('.bank-details')).toContainText(CUENTA_BANCARIA.cbu_cvu);
    await expect(page.getByRole('button', { name: 'Copiar Alias' })).toBeVisible();

    await page.getByTestId('proof-open').click();
    const input = page.locator('.proof-uploader input[type=file]');
    await input.setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('no es un comprobante') });
    await expect(page.getByTestId('proof-error')).toBeVisible();
    await expect(page.getByTestId('proof-submit')).toBeDisabled();
    await input.setInputFiles({ name: 'comprobante-e2e.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await expect(page.getByAltText('Vista previa del comprobante')).toBeVisible();
    await page.getByTestId('proof-submit').click();
    await expect(page.getByText('¡Recibimos tu comprobante!')).toBeVisible();
    const subida = sim.llamadas('pago_comprobante_subir')[0];
    expect(subida.headers['x-ecom-pedido-token']).toBe(JSON.parse(autorizacion).token);
    expect(subida.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    await expect(page.getByRole('list', { name: 'Comprobantes enviados' })).toContainText('comprobante-e2e.png');
    await expect(page.getByTestId('proof-open')).toHaveCount(0);

    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar comprobante-e2e.png' }).click();
    expect((await descarga).suggestedFilename()).toBe('comprobante-e2e.png');
    expect(sim.llamadas('pago_comprobante_descargar')[0].headers['x-ecom-pedido-token']).toBe(JSON.parse(autorizacion).token);
  });

  test('envío + transferencia: se transfiere solo el importe de los productos', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    await simularApi(page, { tienda: { checkout: true, pagos: true, cuentas: false, entregas: ['ENVIO'] } });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await elegirPago(page, 'TRANSFERENCIA_BANCARIA');
    await expect(page.locator('.payment-preview')).toContainText('Importe a transferir (productos)');
    await elegirPago(page, 'EFECTIVO');
    await expect(page.locator('.payment-note')).toContainText('Pagás en efectivo al recibir tu compra.');
  });

  test('sin medios de pago para la modalidad no deja confirmar', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    await simularApi(page, { tienda: { checkout: true, pagos: true, cuentas: false, entregas: ['RETIRO'], config: { pagos: { activo: true, estado: 'ACTIVO', metodos_por_modalidad: { RETIRO: [] }, cuenta_bancaria: null, mercado_pago: { disponible: false, proximamente: true } } } } });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await expect(page.getByText('No hay medios de pago disponibles para esta modalidad de entrega.')).toBeVisible();
    await expect(page.getByTestId('checkout-submit')).toBeDisabled();
  });
});

test.describe('Pagos · comprobante REAL en pedido de prueba', () => {
  test('@mutations transferencia de invitado: detalle, subida, estado y descarga', async ({ page, request }) => {
    requiereMutaciones(test);
    const cfg = await configuracionTienda(request);
    test.skip(cfg.checkout_modo !== 'PRUEBA', 'Solo en modo PRUEBA (token de checkout de prueba en el proxy local).');
    const modalidad = Object.entries(cfg.pagos?.metodos_por_modalidad || {}).find(([, l]) => l.some((m) => m.codigo === 'TRANSFERENCIA_BANCARIA'))?.[0];
    test.skip(!cfg.pagos?.activo || !modalidad, 'La tienda no tiene transferencia bancaria activa.');
    test.skip(cfg.entrega_modalidades.find((m) => m.codigo === modalidad)?.requiere_direccion, 'La transferencia solo está disponible con envío a domicilio.');
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');

    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await completarComprador(page, { email: ENV.emailPedidos, apellido: apellidoE2E(), observaciones: OBSERVACION_PEDIDO });
    await elegirEntrega(page, modalidad);
    await elegirPago(page, 'TRANSFERENCIA_BANCARIA');
    await page.getByTestId('checkout-submit').click();
    await expect(page).toHaveURL(/\/pedido\/confirmado$/);
    const numero = (await page.getByTestId('order-number').textContent()).trim();
    const token = JSON.parse(await page.evaluate((k) => sessionStorage.getItem(k), `balto:ecommerce:pedido-autorizacion:${ENV.tienda}:${numero}`)).token;

    await page.getByTestId('proof-open').click();
    await page.locator('.proof-uploader input[type=file]').setInputFiles({ name: 'comprobante-e2e.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await page.getByTestId('proof-submit').click();
    await expect(page.getByText('¡Recibimos tu comprobante!')).toBeVisible();

    const estado = expectExito(await apiGet(request, 'pago_comprobante_estado', { numero }, { headers: { 'X-Ecom-Pedido-Token': token } }));
    expect(estado.pago).toMatchObject({ metodo: 'TRANSFERENCIA_BANCARIA', estado: 'EN_REVISION', estado_comprobante: 'PENDIENTE', puede_subir_comprobante: false });
    const det = expectExito(await apiGet(request, 'pago_detalle_pedido', { numero }, { headers: { 'X-Ecom-Pedido-Token': token } }));
    expect(det.pedido.numero).toBe(numero);
    const id = estado.pago.comprobantes[0].id;
    const res = await request.get(`/ecom-api?action=pago_comprobante_descargar&tienda=${ENV.tienda}&numero=${numero}&id=${id}`, { headers: { 'X-Ecom-Pedido-Token': token } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    const sinToken = await apiGet(request, 'pago_comprobante_descargar', { numero, id });
    expect(sinToken.status).toBe(401);
  });
});
