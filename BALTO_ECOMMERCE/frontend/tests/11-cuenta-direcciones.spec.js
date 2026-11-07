// Mi cuenta · direcciones: cliente_direcciones, cliente_direccion_guardar,
// cliente_direccion_predeterminada y cliente_direccion_eliminar.
const { test, expect } = require('./soporte/test');
const { prepararCuenta, postReal } = require('./soporte/sesion');
const { ENV } = require('./soporte/entorno');
const { completarDomicilio, agregarDesdeFicha } = require('./soporte/flujos');
const { productos, elegir } = require('./soporte/catalogo');
const { RUN_PREFIX } = require('./soporte/datos');

// Las direcciones de prueba llevan el RUN_PREFIX en "Referencias" y se borran al final (modo real).
const tarjeta = (page, texto) => page.locator('.address-card').filter({ hasText: texto });

test.describe('Mi cuenta · direcciones', () => {
  test('@smoke alta, predeterminada, edición y baja', async ({ page }) => {
    const cuenta = await prepararCuenta(page, { escribe: true });
    const calleA = `Calle ${RUN_PREFIX.replace(/[^A-Z]/g, '').slice(0, 6) || 'Prueba'} Uno`;
    const calleB = `Calle ${RUN_PREFIX.replace(/[^A-Z]/g, '').slice(0, 6) || 'Prueba'} Dos`;
    try {
      await page.goto('/mi-cuenta/direcciones');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Mis direcciones/);

      // Alta con validaciones
      await page.getByRole('button', { name: 'Agregar dirección' }).click();
      const form = page.getByRole('form', { name: 'Nueva dirección' });
      await expect(form).toBeVisible();
      await form.getByRole('button', { name: 'Guardar dirección' }).click();
      await expect(page.locator('#dirform-calle-error')).toBeVisible();
      await page.locator('#dirform-destinatario_nombre').fill('Ana');
      await page.locator('#dirform-destinatario_apellido').fill('Prueba');
      await completarDomicilio(page, 'dirform', { calle: calleA, altura: '101' });
      await page.locator('#dirform-referencias').fill(RUN_PREFIX);
      await form.getByRole('button', { name: 'Guardar dirección' }).click();
      await expect(page.locator('.account-notice')).toContainText('Dirección guardada.');
      await expect(tarjeta(page, calleA)).toBeVisible();

      // Segunda dirección marcada como predeterminada
      await page.getByRole('button', { name: 'Agregar dirección' }).click();
      await page.locator('#dirform-destinatario_nombre').fill('Ana');
      await page.locator('#dirform-destinatario_apellido').fill('Prueba');
      await completarDomicilio(page, 'dirform', { calle: calleB, altura: '202' });
      await page.locator('#dirform-referencias').fill(RUN_PREFIX);
      await page.getByLabel('Usar como dirección predeterminada').check();
      await page.getByRole('button', { name: 'Guardar dirección' }).click();
      await expect(tarjeta(page, calleB).locator('.address-default')).toBeVisible();
      await expect(tarjeta(page, calleA).locator('.address-default')).toHaveCount(0);

      // Cambiar la predeterminada
      await tarjeta(page, calleA).getByRole('button', { name: 'Predeterminada' }).click();
      await expect(page.locator('.account-notice')).toContainText('Dirección predeterminada actualizada.');
      await expect(tarjeta(page, calleA).locator('.address-default')).toBeVisible();
      await expect(tarjeta(page, calleB).locator('.address-default')).toHaveCount(0);

      // Editar
      await tarjeta(page, calleB).getByRole('button', { name: 'Editar' }).click();
      await expect(page.getByRole('form', { name: 'Editar dirección' })).toBeVisible();
      await page.locator('#dirform-altura').fill('303');
      await page.getByRole('button', { name: 'Guardar dirección' }).click();
      await expect(page.locator('.account-notice')).toContainText('Dirección actualizada.');
      await expect(tarjeta(page, calleB)).toContainText('303');

      // Eliminar (con confirmación)
      await tarjeta(page, calleB).getByRole('button', { name: 'Eliminar' }).click();
      await tarjeta(page, calleB).getByRole('button', { name: 'Cancelar' }).click();
      await expect(tarjeta(page, calleB)).toBeVisible();
      await tarjeta(page, calleB).getByRole('button', { name: 'Eliminar' }).click();
      await tarjeta(page, calleB).getByRole('button', { name: 'Sí, eliminar' }).click();
      await expect(page.locator('.account-notice')).toContainText('Dirección eliminada.');
      await expect(tarjeta(page, calleB)).toHaveCount(0);

      if (cuenta.modo === 'simulado') {
        for (const a of ['cliente_direccion_guardar', 'cliente_direccion_predeterminada', 'cliente_direccion_eliminar']) {
          for (const l of cuenta.sim.llamadas(a)) expect(l.headers['x-csrf-token'], `${a} envía CSRF`).toBe(cuenta.csrf);
        }
        expect(cuenta.sim.llamadas('cliente_direccion_guardar')[0].body).toMatchObject({ calle: calleA, altura: '101', provincia: 'Córdoba', pais: 'AR', destinatario_nombre: 'Ana' });
      }
    } finally {
      if (cuenta.modo === 'real') {
        const res = await page.request.get(`/ecom-api?action=cliente_direcciones&tienda=${encodeURIComponent(ENV.tienda)}`);
        for (const d of (await res.json()).direcciones || []) {
          if (String(d.referencias || '').includes(RUN_PREFIX)) await postReal(page, 'cliente_direccion_eliminar', { id: d.id }, cuenta.csrf);
        }
      }
    }
  });

  test('las direcciones guardadas se ofrecen en el checkout con envío', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    const cuenta = await prepararCuenta(page, {
      escribe: false,
      tienda: { checkout: true, pagos: false, entregas: ['ENVIO'] },
      cuenta: { direcciones: [{ etiqueta: 'CASA', destinatario_nombre: 'Ana', destinatario_apellido: 'Prueba', telefono: null, pais: 'AR', provincia: 'Córdoba', provincia_id: '14', localidad: 'Córdoba', localidad_id: null, codigo_postal: '5000', calle: 'Bv. San Juan', altura: '500', piso_depto: null, referencias: null, predeterminada: true, actualizado_en: '2026-01-01 10:00:00' }] },
    });
    test.skip(cuenta.modo === 'real', 'Con sesión real depende de las direcciones de esa cuenta.');
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    const grupo = page.getByRole('radiogroup', { name: 'Dirección de entrega' });
    await expect(grupo).toContainText('Bv. San Juan 500');
    await expect(grupo.getByRole('radio').first()).toBeChecked();
    await grupo.getByText('Usar otra dirección').click();
    await expect(page.locator('#entrega-calle')).toBeVisible();
    await expect(page.getByLabel('Guardar esta dirección en mi cuenta para próximas compras')).toBeVisible();
  });
});
