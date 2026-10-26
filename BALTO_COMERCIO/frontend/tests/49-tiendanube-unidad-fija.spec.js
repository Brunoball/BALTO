import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { getDefaultStockUnit } from './support/stock-units.js';
import { requireMutations, waitForBusyToFinish, waitDialog } from './support/ui.js';

// Regresión: Tienda Nube conectada usa únicamente UNIDAD, sin configuración de presentaciones.
// Se valida la politica REAL del tenant en MASTER, sin modificar conexiones.
test('@stock @tiendanube @unidades @critical política de UNIDAD respeta la conexión del tenant', async ({ page }) => {
  const politica = expectApiSuccess(await authenticatedApi(page, 'stock_unidades_politica'));
  const conectada = Boolean(politica.tiendanube_conectada);
  expect(politica.unidad_bloqueada).toBe(conectada);
  const unidad = await getDefaultStockUnit(page);
  if (conectada) {
    expect(Number(politica.id_stock_unidad_obligatoria)).toBe(Number(unidad.id_stock_unidad));
    const respuesta = expectApiSuccess(await authenticatedApi(page, 'stock_unidades_listar', { query: { activo: 'todos' } }));
    expect(respuesta.unidad_bloqueada).toBe(true);
    expect(respuesta.unidades.map(u => Number(u.id_stock_unidad))).toEqual([Number(unidad.id_stock_unidad)]);
  } else {
    expect(politica.id_stock_unidad_obligatoria).toBeNull();
    const respuesta = expectApiSuccess(await authenticatedApi(page, 'stock_unidades_listar', { query: { activo: 'todos' } }));
    expect(respuesta.unidad_bloqueada).toBe(false);
    expect(respuesta.unidades.some(u => Number(u.id_stock_unidad) === Number(unidad.id_stock_unidad))).toBe(true);
  }
});

test('@stock @tiendanube @unidades @critical conectado no permite crear unidades ni productos fraccionarios', async ({ page }) => {
  const politica = expectApiSuccess(await authenticatedApi(page, 'stock_unidades_politica'));
  test.skip(!politica.tiendanube_conectada, 'El negocio de esta corrida no tiene Tienda Nube conectada.');
  await requireMutations(test, page);
  const unidad = await getDefaultStockUnit(page);

  const nuevaUnidad = await authenticatedApi(page, 'stock_unidad_crear', {
    method: 'POST', body: { nombre: uniqueName('TN-UNIDAD-RECHAZADA'), abreviatura: `tu${Date.now()}`, permite_decimales: 1 },
  });
  expect(nuevaUnidad.status).toBe(409);
  expect(nuevaUnidad.body?.exito).toBe(false);
  expect(String(nuevaUnidad.body?.mensaje)).toMatch(/bloqueada|tienda nube/i);

  // La ruta independiente de Configuración también debe estar protegida.
  const desdeConfiguracion = await authenticatedApi(page, 'config_listas_categorias_stock_unidad_crear', {
    method: 'POST', body: { nombre: uniqueName('TN-CONFIG-RECHAZADA'), abreviatura: `tc${Date.now()}`, permite_decimales: 1 },
  });
  expect(desdeConfiguracion.status).toBe(409);
  expect(String(desdeConfiguracion.body?.mensaje || '')).toMatch(/bloqueada|tienda nube/i);

  // Se usa un ID distinto aunque no exista. La política debe rechazarlo
  // ANTES de que resolverId convierta silenciosamente un ID inválido en UNIDAD.
  const prohibido = Number(unidad.id_stock_unidad) + 500000;
  const rechazada = await authenticatedApi(page, 'stock_productos_crear', {
    method: 'POST', body: {
      nombre: uniqueName('TN-UNIDAD-INVALIDA'), sku: uniqueSku('TNUNIT'), stock: 1,
      id_stock_unidad: prohibido, precio_costo: 10, precio: 20,
      diferir_sync: 1, origen_sync: 'playwright_e2e',
    },
  });
  expect(rechazada.status).toBe(409);
  expect(String(rechazada.body?.mensaje || '')).toMatch(/UNIDAD/i);

  const conVariante = await authenticatedApi(page, 'stock_productos_crear', {
    method: 'POST', body: {
      nombre: uniqueName('TN-VAR-INVALIDA'), sku: uniqueSku('TNVAR'), stock: 0,
      tiene_variantes: 1, id_stock_unidad: Number(unidad.id_stock_unidad),
      variantes: [{ nombre_variante: 'V1', sku: uniqueSku('V1'), stock: 1, id_stock_unidad: prohibido }],
      precio_costo: 10, precio: 20, diferir_sync: 1, origen_sync: 'playwright_e2e',
    },
  });
  expect(conVariante.status).toBe(409);
  expect(String(conVariante.body?.mensaje || '')).toMatch(/UNIDAD/i);

});


test('@stock @tiendanube @unidades @ui no muestra pestaña TN y bloquea selectores solo con conexión', async ({ page }) => {
  const politica = expectApiSuccess(await authenticatedApi(page, 'stock_unidades_politica'));
  const conectada = Boolean(politica.tiendanube_conectada);

  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Agregar producto/i }).first().click();
  const dialog = await waitDialog(page, 'Productos');
  await expect(dialog.getByRole('tab', { name: /^Tienda Nube$/i })).toHaveCount(0);
  const field = dialog.locator('.fl-field').filter({ hasText: /Unidad de stock/i }).first().locator('select').first();
  await expect(field).toBeVisible();
  if (conectada) {
    await expect(field).toBeDisabled();
    await expect(field).toHaveValue(String(politica.id_stock_unidad_obligatoria));
    await expect(field.locator('option')).toHaveCount(1);
    await expect(field.locator('option')).toHaveText('UNIDAD (u)');
  } else {
    await expect(field).toBeEnabled();
    await expect(field.locator('option[value="__new_unit__"]')).toHaveCount(1);
  }

  await page.goto('/panel/configuracion?seccion=listas-categorias');
  await waitForBusyToFinish(page);
  const tabUnidades = page.getByRole('button', { name: /^Unidades de stock$/i });
  if (conectada) await expect(tabUnidades).toHaveCount(0);
  else await expect(tabUnidades).toBeVisible();
});
