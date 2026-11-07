// Mi cuenta · perfil: cliente_perfil y cliente_actualizar (con CSRF).
// Modo real con PW_SESION_COMPRADOR (+ PW_ALLOW_MUTATIONS para guardar, y se restaura);
// si no, API simulada con el mismo formato.
const { test, expect } = require('./soporte/test');
const { prepararCuenta, postReal, instalarCookieReal, sesionActual } = require('./soporte/sesion');
const { apiGet, expectError } = require('./soporte/api');
const { ENV } = require('./soporte/entorno');

test.describe('Mi cuenta · perfil', () => {
  test('cliente_perfil: exige sesión y con sesión real devuelve el mismo cliente que auth_sesion', async ({ page, request }) => {
    expectError(await apiGet(request, 'cliente_perfil'), [401, 503], ['SESION_REQUERIDA', 'CUENTAS_NO_DISPONIBLES']);
    test.skip(!ENV.sesionComprador, 'Sin PW_SESION_COMPRADOR solo se prueba el rechazo sin sesión.');
    await instalarCookieReal(page.context(), request);
    const s = await sesionActual(page);
    const r = await page.request.get(`/ecom-api?action=cliente_perfil&tienda=${encodeURIComponent(ENV.tienda)}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).cliente).toEqual(s.cliente);
  });

  test('@smoke muestra los datos del cliente; el email es de solo lectura', async ({ page }) => {
    const cuenta = await prepararCuenta(page, { escribe: false, cuenta: { cliente: { nombre: 'Lucía', apellido: 'Gómez', telefono: '3515550000' } } });
    await page.goto('/mi-cuenta');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(`^Hola, ${cuenta.cliente.nombre || ''}`));
    await expect(page.locator('#perfil-nombre')).toHaveValue(cuenta.cliente.nombre || '');
    await expect(page.locator('#perfil-apellido')).toHaveValue(cuenta.cliente.apellido || '');
    await expect(page.locator('#perfil-email')).toHaveValue(cuenta.cliente.email);
    await expect(page.locator('#perfil-email')).toHaveAttribute('readonly', '');
    for (const enlace of ['Mis datos', 'Mis direcciones', 'Mis pedidos']) await expect(page.getByRole('link', { name: enlace }).first()).toBeVisible();
  });

  test('valida y guarda cambios enviando el token CSRF', async ({ page }) => {
    const cuenta = await prepararCuenta(page, { escribe: true });
    const original = { nombre: cuenta.cliente.nombre, apellido: cuenta.cliente.apellido, telefono: cuenta.cliente.telefono };
    const posts = [];
    page.on('request', (r) => { if (r.url().includes('action=cliente_actualizar')) posts.push(r); });
    try {
      await page.goto('/mi-cuenta');
      await page.locator('#perfil-nombre').fill('123');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await expect(page.locator('#perfil-nombre-error')).toHaveText('Ingresá tu nombre (solo letras).');
      expect(posts, 'Con errores no se llama al servidor').toHaveLength(0);
      await page.locator('#perfil-telefono').fill('12');
      await page.locator('#perfil-nombre').fill('Valentina');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await expect(page.locator('#perfil-telefono-error')).toBeVisible();
      await page.locator('#perfil-telefono').fill('351 555 0001');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await expect(page.getByText('Datos guardados')).toBeVisible();
      expect(posts).toHaveLength(1);
      expect(posts[0].headers()['x-csrf-token']).toBe(cuenta.csrf);
      expect(posts[0].postDataJSON()).toEqual({ nombre: 'Valentina', apellido: original.apellido, telefono: '351 555 0001' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Hola, Valentina/);
      await page.reload();
      await expect(page.locator('#perfil-nombre')).toHaveValue('Valentina');
    } finally {
      if (cuenta.modo === 'real') await postReal(page, 'cliente_actualizar', original, cuenta.csrf);
    }
  });

  test('si la sesión vence, la página privada vuelve al ingreso', async ({ page }) => {
    const cuenta = await prepararCuenta(page, { escribe: false });
    test.skip(cuenta.modo === 'real', 'Se prueba con sesión simulada (no se invalida la sesión real).');
    await page.goto('/mi-cuenta');
    await expect(page.locator('#perfil-nombre')).toBeVisible();
    cuenta.sim.estado.logueado = false; // el servidor "venció" la sesión
    await page.locator('#perfil-nombre').fill('Otro');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/\/iniciar-sesion\?volver=%2Fmi-cuenta$/);
  });
});
