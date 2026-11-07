// Autenticación del comprador: auth_nonce, auth_google, auth_sesion, auth_logout.
// Google real no se puede automatizar: la interfaz se prueba con Google simulado y el
// contrato del servidor (rechazos, nonce, sesión anónima) contra la API real.
const { test, expect } = require('./soporte/test');
const { ENV } = require('./soporte/entorno');
const { apiGet, apiPost, configuracionTienda, expectExito, expectError } = require('./soporte/api');
const { simularApi } = require('./soporte/simulador');
const { prepararCuenta, instalarCookieReal, sesionActual } = require('./soporte/sesion');
const { productos, elegir } = require('./soporte/catalogo');
const { agregarDesdeFicha } = require('./soporte/flujos');

test.describe('Autenticación · API', () => {
  test('@smoke auth_sesion sin cookie: anónimo y estado de las cuentas', async ({ request }) => {
    const r = expectExito(await apiGet(request, 'auth_sesion'));
    expect(r.autenticado).toBe(false);
    expect(r.cliente).toBeUndefined();
    expect(r.csrf).toBeUndefined();
    expect(typeof r.cuentas?.habilitadas).toBe('boolean');
  });

  test('auth_nonce: nonce de un solo uso ligado a una cookie HttpOnly', async ({ request }) => {
    const cfg = await configuracionTienda(request);
    const r = await apiGet(request, 'auth_nonce');
    if (!cfg.cuentas?.habilitadas || !cfg.cuentas?.google_client_id) {
      expect(r.json?.exito).toBe(false);
      return;
    }
    expectExito(r);
    expect(r.json.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(r.json.client_id).toBe(cfg.cuentas.google_client_id);
    const cookie = [].concat(r.headers['set-cookie'] || []).join('\n');
    expect(cookie, 'El nonce viaja en cookie HttpOnly').toMatch(/HttpOnly/i);
    const otro = expectExito(await apiGet(request, 'auth_nonce'));
    expect(otro.nonce).not.toBe(r.json.nonce);
  });

  test('auth_google rechaza credenciales faltantes, inválidas o sin nonce', async ({ request }) => {
    const cfg = await configuracionTienda(request);
    test.skip(!cfg.cuentas?.habilitadas, 'Las cuentas no están habilitadas en esta tienda.');
    expectError(await apiPost(request, 'auth_google', {}), 400, 'CREDENCIAL_REQUERIDA');
    const invalida = await apiPost(request, 'auth_google', { credential: 'x.y.z' });
    expect([400, 401]).toContain(invalida.status);
    expect(invalida.json.exito).toBe(false);
    expect(invalida.json.cliente).toBeUndefined();
    expectError(await apiGet(request, 'auth_google'), 405, 'METODO_NO_PERMITIDO');
  });

  test('auth_logout sin sesión es inofensivo', async ({ request }) => {
    const r = expectExito(await apiPost(request, 'auth_logout', {}));
    expect(r.autenticado).toBe(false);
  });

  test('sesión REAL (PW_SESION_COMPRADOR): auth_sesion devuelve el cliente y un CSRF', async ({ page, request }) => {
    test.skip(!ENV.sesionComprador, 'Sin PW_SESION_COMPRADOR: la sesión real no se prueba.');
    await instalarCookieReal(page.context(), request);
    const s = await sesionActual(page);
    expect(s.autenticado).toBe(true);
    expect(s.csrf).toMatch(/^[a-f0-9]{64}$/);
    expect(s.cliente.email).toMatch(/@/);
    await page.goto('/');
    await expect(page.locator('.account-trigger')).toContainText(s.cliente.nombre || '');
  });
});

test.describe('Autenticación · interfaz', () => {
  test('@smoke las páginas privadas llevan al ingreso y vuelven al destino después del login', async ({ page }) => {
    const sim = await simularApi(page, { tienda: { cuentas: true }, cuenta: { logueado: false }, google: true });
    await page.goto('/mi-cuenta/pedidos');
    await expect(page).toHaveURL(/\/iniciar-sesion\?volver=%2Fmi-cuenta%2Fpedidos$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Ingresá a tu cuenta/);
    await page.getByRole('button', { name: 'Continuar con Google (simulado)' }).click();
    await expect(page).toHaveURL(/\/mi-cuenta\/pedidos$/);
    expect(sim.llamadas('auth_nonce')).toHaveLength(1);
    expect(sim.llamadas('auth_google')[0].body.credential, 'La web envía SOLO la credencial de Google con el nonce del servidor').toMatch(/^credencial\.simulada\.[a-f0-9]{64}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Mis pedidos/);
  });

  test('el destino del login no permite redirecciones externas', async ({ page }) => {
    await simularApi(page, { tienda: { cuentas: true }, cuenta: { logueado: false }, google: true });
    await page.goto('/iniciar-sesion?volver=https%3A%2F%2Fsitio-malicioso.example.com%2F');
    await page.getByRole('button', { name: 'Continuar con Google (simulado)' }).click();
    await expect(page).toHaveURL(/\/mi-cuenta$/);
    expect(new URL(page.url()).host).toBe(new URL(ENV.baseURL).host);
  });

  test('un error de Google se informa y la compra como invitado sigue disponible', async ({ page }) => {
    const sim = await simularApi(page, { tienda: { cuentas: true }, cuenta: { logueado: false }, google: true, fallar: { auth_google: { status: 403, codigo: 'CUENTA_DESACTIVADA', mensaje: 'Cuenta desactivada.' } } });
    await page.goto('/iniciar-sesion');
    await page.getByRole('button', { name: 'Continuar con Google (simulado)' }).click();
    await expect(page.getByRole('alert')).toContainText('Tu cuenta en esta tienda está desactivada');
    await expect(page.getByRole('link', { name: 'Seguir explorando' })).toBeVisible();
    expect(sim.llamadas('auth_google')).toHaveLength(1);
  });

  test('cerrar sesión desde el menú de la cuenta', async ({ page }) => {
    const { sim } = await prepararCuenta(page, { escribe: false });
    test.skip(!sim, 'En modo real no se cierra la sesión del comprador de prueba.');
    await page.goto('/mi-cuenta');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Hola,/);
    await page.locator('.account-trigger').click();
    await page.getByRole('menuitem', { name: /Cerrar sesión/ }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(sim.llamadas('auth_logout')).toHaveLength(1);
    await page.goto('/mi-cuenta');
    await expect(page).toHaveURL(/\/iniciar-sesion/);
  });

  test('cerrar sesión desde el botón de Mi cuenta lleva al inicio', async ({ page }) => {
    const { sim } = await prepararCuenta(page, { escribe: false });
    test.skip(!sim, 'En modo real no se cierra la sesión del comprador de prueba.');
    await page.goto('/mi-cuenta/direcciones');
    await page.locator('.account-page').getByRole('button', { name: /Cerrar sesión/ }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(sim.llamadas('auth_logout')).toHaveLength(1);
    await expect(page.getByRole('link', { name: 'Ingresar a tu cuenta' })).toBeVisible();
  });

  test('con las cuentas deshabilitadas se compra como invitado', async ({ page }) => {
    await simularApi(page, { tienda: { cuentas: false } });
    await page.goto('/mi-cuenta');
    await expect(page.getByText('Las cuentas todavía no están disponibles')).toBeVisible();
    await page.goto('/iniciar-sesion');
    await expect(page.getByText('El acceso con cuenta todavía no está disponible')).toBeVisible();
  });

  test('en el checkout ofrece ingresar o seguir como invitado', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    await simularApi(page, { tienda: { checkout: true, pagos: false, cuentas: true, entregas: ['RETIRO'] }, cuenta: { logueado: false }, google: true });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { name: '¿Ya tenés una cuenta?' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar como invitado' }).click();
    await expect(page.getByText('Comprás como invitado.')).toBeVisible();
    await expect(page.locator('#checkout-nombre')).toBeFocused();
    await page.getByRole('button', { name: '¿Querés ingresar con tu cuenta?' }).click();
    await page.getByRole('button', { name: 'Continuar con Google (simulado)' }).click();
    await expect(page.getByText('COMPRA CON TU CUENTA')).toBeVisible();
    await expect(page.locator('#checkout-email')).toHaveAttribute('readonly', '');
  });
});
