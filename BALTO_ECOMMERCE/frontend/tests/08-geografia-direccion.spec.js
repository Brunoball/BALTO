// Geografía (Georef vía backend): geografia_provincias, geografia_localidades y el
// componente único de domicilio (CamposDireccion) usado en checkout y en Mis direcciones.
const { test, expect } = require('./soporte/test');
const { apiGet, expectExito, expectError } = require('./soporte/api');
const { productos, elegir } = require('./soporte/catalogo');
const { agregarDesdeFicha, completarComprador } = require('./soporte/flujos');
const { simularApi } = require('./soporte/simulador');
const { ENV } = require('./soporte/entorno');

test.describe('Geografía · API', () => {
  test('@smoke geografia_provincias devuelve las 24 jurisdicciones', async ({ request }) => {
    const r = expectExito(await apiGet(request, 'geografia_provincias', { pais: 'AR' }));
    expect(r.provincias.length).toBeGreaterThanOrEqual(24);
    expect(r.provincias.map((p) => p.nombre)).toEqual(expect.arrayContaining(['Córdoba', 'Buenos Aires', 'Mendoza']));
    for (const p of r.provincias) expect(p.id).toMatch(/^\d{2}$/);
  });

  test('geografia_localidades busca por nombre y provincia, y valida la búsqueda', async ({ request }) => {
    const r = expectExito(await apiGet(request, 'geografia_localidades', { q: 'San', provincia: '14' }));
    expect(typeof r.servicio_disponible).toBe('boolean');
    if (r.servicio_disponible) for (const l of r.localidades) expect(l.provincia_id).toBe('14');
    expectError(await apiGet(request, 'geografia_localidades', { q: 'a' }), 422, 'BUSQUEDA_INVALIDA');
    expectError(await apiGet(request, 'geografia_localidades', {}), 422, 'BUSQUEDA_INVALIDA');
  });
});

test.describe('Domicilio · interfaz', () => {
  test('provincias, sugerencias de localidad, CPA y validaciones', async ({ page, request }) => {
    const p = elegir.simple(await productos(request), 1);
    test.skip(!p, 'Se necesita un producto simple.');
    await simularApi(page, { tienda: { checkout: true, pagos: false, cuentas: false, entregas: ['ENVIO'] } });
    await agregarDesdeFicha(page, p);
    await page.goto('/checkout');
    await completarComprador(page, { email: ENV.emailPedidos, apellido: 'Domicilio' });

    const provincia = page.locator('#entrega-provincia');
    await expect(provincia.locator('option')).toHaveCount(25); // "Elegí la provincia" + 24
    await provincia.selectOption({ label: 'Córdoba' });

    const sugeridas = expectExito(await apiGet(request, 'geografia_localidades', { q: 'Córdoba', provincia: '14' }));
    const localidad = page.locator('#entrega-localidad');
    await localidad.fill('Córdoba');
    if (sugeridas.servicio_disponible && sugeridas.localidades.length) {
      const opcion = page.getByRole('listbox').getByRole('option').first();
      await expect(opcion).toBeVisible();
      await opcion.click();
      await expect(localidad).toHaveValue(sugeridas.localidades[0].nombre);
    }

    await page.locator('#entrega-codigo_postal').fill('Z9400ABC');
    await expect(page.getByText(/El CPA Z9400ABC corresponde a/)).toBeVisible();
    await page.locator('#entrega-codigo_postal').fill('12');
    await page.getByTestId('checkout-submit').click();
    await expect(page.locator('#entrega-codigo_postal-error')).toBeVisible();
    await expect(page.locator('#entrega-calle-error')).toBeVisible();
    await expect(page.locator('#entrega-altura-error')).toBeVisible();

    await page.getByLabel('Sin número').check();
    await expect(page.locator('#entrega-altura')).toHaveValue('S/N');
    await page.getByLabel('Recibe otra persona').check();
    await expect(page.locator('#entrega-destinatario_nombre')).toBeVisible();
  });

  test.describe('sin Georef', () => {
    test.use({ diagnosticoEstricto: false });
    test('si Georef no responde, usa la lista local de provincias y deja escribir la localidad', async ({ page, request }) => {
      const p = elegir.simple(await productos(request), 1);
      test.skip(!p, 'Se necesita un producto simple.');
      await simularApi(page, { tienda: { checkout: true, pagos: false, cuentas: false, entregas: ['ENVIO'] },
        fallar: { geografia_provincias: { status: 502, codigo: 'GEOREF_NO_DISPONIBLE' }, geografia_localidades: { status: 502, codigo: 'GEOREF_NO_DISPONIBLE' } } });
      await agregarDesdeFicha(page, p);
      await page.goto('/checkout');
      await expect(page.locator('#entrega-provincia option')).toHaveCount(25);
      await page.locator('#entrega-localidad').fill('Villa Allende');
      await expect(page.locator('#entrega-localidad')).toHaveValue('Villa Allende');
    });
  });
});
