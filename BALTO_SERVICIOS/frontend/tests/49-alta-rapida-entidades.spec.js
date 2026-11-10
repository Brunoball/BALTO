import { test, expect } from './support/test.js';
import { uniqueName } from './support/data.js';
import { requireMutations, waitForBusyToFinish, waitDialog } from './support/ui.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';

/**
 * Alta rápida real: verifica UI, POST sin CUIT, selección e inclusión en el
 * catálogo consultado al backend. No crea ventas/compras de prueba.
 * Las entidades PW-* son depuradas por el cleanup habitual del proyecto.
 */
async function elegirAgregar(page, dialog, tipo) {
  const input = dialog.locator('.nc-prov-wrap .ga-wrap input, .dc-prov-wrap .ga-wrap input').first();
  await expect(input, `Selector de ${tipo} disponible`).toBeVisible();
  await input.fill('');
  await input.click();
  const opcion = page.locator('#ga-portal-list .ga-item:not(.is-empty)').filter({ hasText: new RegExp(`Agregar ${tipo}`, 'i') }).first();
  await expect(opcion).toBeVisible({ timeout: 15_000 });
  await opcion.click();
  return input;
}

async function validarPersistencia(page, tipo, nombre, id) {
  const esCliente = tipo === 'cliente';
  const action = esCliente ? 'cc_clientes_listar' : 'cc_proveedores_listar';
  const result = await authenticatedApi(page, action);
  const response = expectApiSuccess(result, `El alta de ${tipo} debe figurar en DB`);
  const rows = response[esCliente ? 'clientes' : 'proveedores'] || response?.data?.[esCliente ? 'clientes' : 'proveedores'] || [];
  expect(rows.some((row) => Number(row[esCliente ? 'id_cliente' : 'id_proveedor']) === id && String(row.nombre).toUpperCase() === nombre)).toBeTruthy();
}

async function verificarAlta(page, dialog, tipo, nombre) {
  const input = await elegirAgregar(page, dialog, tipo);
  const alta = page.getByRole('dialog', { name: `Agregar ${tipo}` });
  await expect(alta).toBeVisible();
  await expect(alta.getByRole('radio', { name: /Solo nombre/i })).toBeChecked();
  await expect(alta.getByRole('radio', { name: /Con CUIT \/ ARCA/i })).not.toBeChecked();
  await expect(alta.getByRole('button', { name: `Guardar ${tipo}` })).toBeDisabled();
  await alta.getByLabel(`Nombre del ${tipo}`).fill(nombre);

  const responsePromise = page.waitForResponse((res) =>
    res.request().method() === 'POST' && new URL(res.url()).searchParams.get('action') === 'catalogo_crear',
    { timeout: 45_000 },
  );
  await alta.getByRole('button', { name: `Guardar ${tipo}` }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
  const requestBody = response.request().postDataJSON();
  expect(requestBody.nombre).toBe(nombre);
  expect(requestBody.catalogo).toBe(tipo === 'cliente' ? 'clientes' : 'proveedores');
  expect(requestBody.cuit).toBeUndefined();
  const body = await response.json();
  expect(body.exito).toBe(true);
  const item = body.item || body.data?.item || {};
  const id = Number(item[tipo === 'cliente' ? 'id_cliente' : 'id_proveedor'] || item.id || 0);
  expect(id).toBeGreaterThan(0);

  await expect(alta).toBeHidden();
  await expect(input).toHaveValue(nombre);
  await validarPersistencia(page, tipo, nombre, id);
  return { input, id };
}

test('@crud @critical alta rápida cliente en Ventas: sin CUIT, seleccionado y persistido', async ({ page }) => {
  await requireMutations(test, page);
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const dialog = await waitDialog(page, 'Nueva Venta');
  const nombre = uniqueName('ALTA-VENTAS');
  const { id } = await verificarAlta(page, dialog, 'cliente', nombre);

  // Al volver a agregar un nombre existente, debe reutilizarse el ID,
  // sin efectuar otro POST ni duplicar registros.
  await elegirAgregar(page, dialog, 'cliente');
  const alta = page.getByRole('dialog', { name: 'Agregar cliente' });
  await alta.getByLabel('Nombre del cliente').fill(nombre);
  const postCatalogo = [];
  const observador = (request) => {
    if (request.method() === 'POST' && new URL(request.url()).searchParams.get('action') === 'catalogo_crear') {
      postCatalogo.push(request);
    }
  };
  page.on('request', observador);
  await alta.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(alta).toBeHidden();
  page.off('request', observador);
  expect(postCatalogo).toHaveLength(0);
  await validarPersistencia(page, 'cliente', nombre, id);
});

test('@crud @critical alta rápida cliente en Presupuestos: sin CUIT, seleccionado y persistido', async ({ page }) => {
  await requireMutations(test, page);
  await page.goto('/panel/presupuesto');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo presupuesto').click();
  const dialog = await waitDialog(page, 'Nuevo presupuesto');
  await verificarAlta(page, dialog, 'cliente', uniqueName('ALTA-PRESU'));
});

test('@crud @critical alta rápida proveedor en Compras: sin CUIT, seleccionado y persistido', async ({ page }) => {
  await requireMutations(test, page);
  await page.goto('/panel/compras');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Compra/i }).click();
  const dialog = await waitDialog(page, 'Nueva Compra');
  await verificarAlta(page, dialog, 'proveedor', uniqueName('ALTA-COMPRAS'));
});

test('@crud alta rápida: permite alternar con CUIT/ARCA sin exigirlo para alta simple', async ({ page }) => {
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  // El modal posee un h2 «Nueva Venta», pero su role=dialog no tiene nombre accesible.
  // Esperar por su encabezado evita depender de un aria-label inexistente.
  const dialog = await waitDialog(page, 'Nueva Venta');
  await elegirAgregar(page, dialog, 'cliente');
  const alta = page.getByRole('dialog', { name: 'Agregar cliente' });
  await alta.getByRole('radio', { name: /Con CUIT \/ ARCA/i }).check();
  await expect(alta.getByRole('button', { name: /Consultar ARCA/i })).toBeVisible();
  await expect(alta.getByRole('button', { name: /Confirmar y cargar cliente/i })).toBeDisabled();
  await alta.getByRole('radio', { name: /Solo nombre/i }).check();
  await expect(alta.getByLabel('Nombre del cliente')).toBeVisible();
  await alta.getByRole('button', { name: /Cancelar/i }).click();
  await expect(alta).toBeHidden();
});
