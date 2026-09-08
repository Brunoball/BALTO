import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { createOtherIncome } from './support/flows.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';

const CONFIG_URL = '/panel/configuracion?seccion=listas-categorias';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function configRow(page, name) {
  const exact = new RegExp(`^${escapeRegExp(name)}$`, 'i');
  return page
    .locator('.cfg-listas-gridBody [role="row"]')
    .filter({ has: page.locator('strong').filter({ hasText: exact }) })
    .first();
}

function dialogWithText(page, text) {
  return page.getByRole('dialog').filter({ hasText: text }).last();
}

function waitAction(page, action, method = 'POST') {
  return page.waitForResponse((response) => {
    if (response.request().method() !== method) return false;
    try {
      return new URL(response.url()).searchParams.get('action') === action;
    } catch {
      return false;
    }
  }, { timeout: 90_000 });
}

async function openListsAndCategories(page) {
  const responsePromise = page.waitForResponse((response) => {
    try {
      return (
        response.request().method() === 'GET' &&
        new URL(response.url()).searchParams.get('action') === 'config_listas_categorias_resumen_listar'
      );
    } catch {
      return false;
    }
  }, { timeout: 45_000 });

  await page.goto(CONFIG_URL);
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
  await waitForBusyToFinish(page);
  await expect(page.getByRole('heading', { name: 'Listas y categorías' })).toBeVisible();
}

async function createDetailFromConfig(page, name) {
  await page.getByRole('button', { name: /Agregar detalle/i }).click();
  const dialog = dialogWithText(page, /Agregar detalle/i);
  await expect(dialog).toBeVisible();
  await dialog.locator('input.gm-input').fill(name);

  const responsePromise = waitAction(page, 'config_listas_categorias_detalle_crear');
  await dialog.getByRole('button', { name: /Guardar detalle/i }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  return configRow(page, name);
}

async function createCategoryFromConfig(page, { name, description = '', parentName = '' }) {
  await page.getByRole('button', { name: /Agregar categoría/i }).click();
  const dialog = dialogWithText(page, /Agregar categoría de stock/i);
  await expect(dialog).toBeVisible();
  await dialog.locator('input.gm-input').fill(name);
  if (parentName) await dialog.locator('select.gm-select').selectOption({ label: parentName });
  if (description) await dialog.locator('textarea').fill(description);

  const responsePromise = waitAction(page, 'config_listas_categorias_stock_categoria_crear');
  await dialog.getByRole('button', { name: /Guardar categoría/i }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
  const body = await response.json().catch(() => ({}));
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  return {
    row: configRow(page, name),
    id: Number(body?.id_stock_categoria ?? body?.categoria?.id_stock_categoria ?? body?.data?.id_stock_categoria ?? 0),
  };
}

test('@configuracion @crud listas y categorías: Detalles tiene ciclo completo', async ({ page }) => {
  await requireMutations(test, page);
  const originalName = uniqueName('CFG-DETALLE', 60);
  const editedName = `${originalName}-EDITADO`.slice(0, 70);

  await openListsAndCategories(page);

  let row = await createDetailFromConfig(page, originalName);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('ACTIVO');

  await row.getByTitle('Editar').click();
  let dialog = dialogWithText(page, /Editar detalle/i);
  await expect(dialog).toBeVisible();
  await dialog.locator('input.gm-input').fill(editedName);
  let responsePromise = waitAction(page, 'config_listas_categorias_detalle_actualizar');
  await dialog.getByRole('button', { name: /Guardar detalle/i }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  row = configRow(page, editedName);
  await expect(row).toBeVisible();

  await row.getByTitle('Dar de baja').click();
  dialog = page.getByRole('dialog', { name: /Dar de baja detalle/i }).last();
  await expect(dialog).toContainText(/dejará de estar disponible para nuevas selecciones/i);
  responsePromise = waitAction(page, 'config_listas_categorias_detalle_dar_baja');
  await dialog.getByRole('button', { name: /^Dar de baja$/i }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(configRow(page, editedName)).toHaveCount(0);

  await page.getByRole('button', { name: /^Bajas$/i }).click();
  row = configRow(page, editedName);
  await expect(row).toBeVisible();
  await expect(row).toContainText('BAJA');

  await row.getByTitle('Reactivar').click();
  dialog = page.getByRole('dialog', { name: /Reactivar detalle/i }).last();
  responsePromise = waitAction(page, 'config_listas_categorias_detalle_reactivar');
  await dialog.getByRole('button', { name: /^Reactivar$/i }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await page.getByRole('button', { name: /^Activos$/i }).click();
  row = configRow(page, editedName);
  await expect(row).toBeVisible();

  await row.getByTitle('Eliminar').click();
  dialog = page.getByRole('dialog', { name: /Eliminar detalle/i }).last();
  await expect(dialog).toContainText(/El detalle se eliminará definitivamente/i);
  responsePromise = waitAction(page, 'config_listas_categorias_detalle_eliminar');
  await dialog.getByRole('button', { name: /Eliminar definitivamente/i }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(configRow(page, editedName)).toHaveCount(0);
});

test('@configuracion @critical listas y categorías: eliminar un Detalle usado conserva el movimiento sin detalle', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const usedDetail = uniqueName('CFG-DET-USADO', 60);

  await createOtherIncome(page, {
    description: usedDetail,
    amount: 135,
    freeText: false,
  });

  await openListsAndCategories(page);
  const row = configRow(page, usedDetail);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.locator(':scope > [role="cell"]').nth(1)).not.toHaveText('0');

  await row.getByTitle('Eliminar').click();
  const dialog = page.getByRole('dialog', { name: /Eliminar detalle/i }).last();
  await expect(dialog).toContainText(/ingresos, egresos y presupuestos.*se conservarán.*sin detalle asignado/i);
  await expect(dialog).toContainText(/Usos históricos/i);

  const responsePromise = waitAction(page, 'config_listas_categorias_detalle_eliminar');
  await dialog.getByRole('button', { name: /Eliminar definitivamente/i }).click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(Number(body?.movimientos_sin_detalle ?? body?.data?.movimientos_sin_detalle ?? 0)).toBeGreaterThanOrEqual(1);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(configRow(page, usedDetail)).toHaveCount(0);

  // La eliminación del catálogo no borra el ingreso histórico. Consultamos el
  // backend directamente para no depender del caché de rendimiento de la grilla:
  // si ese filtro ya está cacheado, la UI puede resolver la búsqueda sin emitir GET.
  const listResult = await authenticatedApi(page, 'otros_ingresos_listar', {
    query: {
      q: usedDetail,
      limit: 50,
      offset: 0,
      _: Date.now(),
    },
  });
  expectApiSuccess(listResult, 'No se pudo consultar el ingreso histórico después de eliminar el Detalle');

  const payload = listResult.body?.data && typeof listResult.body.data === 'object'
    ? listResult.body.data
    : listResult.body;
  const returned = [
    payload?.otros_ingresos,
    payload?.ingresos,
    payload?.movimientos,
    listResult.body?.otros_ingresos,
    listResult.body?.ingresos,
    listResult.body?.movimientos,
  ].find(Array.isArray) || [];

  const survivingMovement = returned.find((movement) => {
    const items = [
      ...(Array.isArray(movement?.items_detalle) ? movement.items_detalle : []),
      ...(Array.isArray(movement?.items) ? movement.items : []),
    ];
    return items.some((item) =>
      [item?.descripcion, item?.detalle, item?.nombre]
        .some((value) => String(value || '').includes(usedDetail)),
    );
  });
  expect(survivingMovement, 'El ingreso histórico debe seguir existiendo después de eliminar el Detalle').toBeTruthy();

  const survivingItems = [
    ...(Array.isArray(survivingMovement?.items_detalle) ? survivingMovement.items_detalle : []),
    ...(Array.isArray(survivingMovement?.items) ? survivingMovement.items : []),
  ];
  const survivingItem = survivingItems.find((item) =>
    [item?.descripcion, item?.detalle, item?.nombre]
      .some((value) => String(value || '').includes(usedDetail)),
  );
  expect(survivingItem, 'Debe conservarse el ítem histórico del ingreso').toBeTruthy();
  expect(Number(survivingItem?.id_detalle || 0), 'El ítem debe quedar desvinculado del catálogo eliminado').toBe(0);

  const survivingMovementId = Number(
    survivingMovement?.id_movimiento ?? survivingMovement?.id_ingreso ?? survivingMovement?.id ?? 0,
  );
  expect(survivingMovementId, 'El ingreso conservado debe exponer su ID real').toBeGreaterThan(0);

  // Limpieza por ID: una vez desvinculado el Detalle, no dependemos de que el texto
  // eliminado siga visible en la grilla para poder borrar el movimiento de prueba.
  const cleanupResponse = await authenticatedApi(page, 'otros_ingresos_eliminar', {
    method: 'POST',
    body: { id_movimiento: survivingMovementId },
  });
  expectApiSuccess(cleanupResponse, `No se pudo limpiar el ingreso de prueba #${survivingMovementId}`);

});

test('@configuracion @critical @stock listas y categorías: categoría con productos se elimina sin borrar stock y sus hijas pasan a principales', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const parentName = uniqueName('CFG-CAT-PADRE', 60);
  const childName = uniqueName('CFG-CAT-HIJA', 60);
  const childEditedName = `${childName}-E`.slice(0, 70);
  const productName = uniqueName('CFG-CAT-PROD', 60);

  await openListsAndCategories(page);
  await page.getByRole('button', { name: /Categorías de stock/i }).click();

  const parent = await createCategoryFromConfig(page, {
    name: parentName,
    description: 'Categoría padre creada por Playwright',
  });
  expect(parent.id, 'El alta debe devolver el ID real de la categoría').toBeGreaterThan(0);
  await expect(parent.row).toBeVisible();

  const child = await createCategoryFromConfig(page, {
    name: childName,
    parentName,
    description: 'Subcategoría creada por Playwright',
  });
  await expect(child.row).toContainText(`Subcategoría de ${parentName}`);

  // También cubrimos edición sobre categorías.
  await child.row.getByTitle('Editar').click();
  let dialog = dialogWithText(page, /Editar categoría de stock/i);
  await dialog.locator('input.gm-input').fill(childEditedName);
  let responsePromise = waitAction(page, 'config_listas_categorias_stock_categoria_actualizar');
  await dialog.getByRole('button', { name: /Guardar categoría/i }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(configRow(page, childEditedName)).toContainText(`Subcategoría de ${parentName}`);

  // Baja/reactivación quedan separadas de la eliminación definitiva.
  let parentRow = configRow(page, parentName);
  await parentRow.getByTitle('Dar de baja').click();
  dialog = page.getByRole('dialog', { name: /Dar de baja categoría de stock/i }).last();
  responsePromise = waitAction(page, 'config_listas_categorias_stock_categoria_dar_baja');
  await dialog.getByRole('button', { name: /^Dar de baja$/i }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await page.getByRole('button', { name: /^Bajas$/i }).click();
  parentRow = configRow(page, parentName);
  await expect(parentRow).toBeVisible();
  await parentRow.getByTitle('Reactivar').click();
  dialog = page.getByRole('dialog', { name: /Reactivar categoría de stock/i }).last();
  responsePromise = waitAction(page, 'config_listas_categorias_stock_categoria_reactivar');
  await dialog.getByRole('button', { name: /^Reactivar$/i }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Activos$/i }).click();

  const createdProduct = await createStockProductFixture(page, {
    name: productName,
    sku: uniqueSku('CFGCAT'),
    stock: 7,
    cost: 100,
    price: 180,
    categoryIds: [parent.id],
    primaryCategoryId: parent.id,
  });
  const product = createdProduct?.producto || createdProduct?.data?.producto || {};
  const productId = Number(product?.id_stock_producto ?? product?.id ?? 0);
  expect(productId, 'El fixture debe devolver el ID real del producto').toBeGreaterThan(0);

  // El producto se creó fuera de esta pantalla: recargamos para validar los contadores persistidos.
  await openListsAndCategories(page);
  await page.getByRole('button', { name: /Categorías de stock/i }).click();
  parentRow = configRow(page, parentName);
  await expect(parentRow).toBeVisible();
  await expect(parentRow.locator(':scope > [role="cell"]').nth(2)).toHaveText('1');
  await expect(parentRow.locator(':scope > [role="cell"]').nth(3)).toHaveText('1');

  await parentRow.getByTitle('Eliminar').click();
  dialog = page.getByRole('dialog', { name: /Eliminar categoría de stock/i }).last();
  await expect(dialog).toContainText(/productos asociados conservarán su stock/i);
  await expect(dialog).toContainText(/única categoría.*sin categoría de stock/i);
  await expect(dialog).toContainText(/subcategorías pasarán a ser categorías principales/i);
  await expect(dialog).toContainText(/Productos asociados\s*1/i);
  await expect(dialog).toContainText(/Subcategorías\s*1/i);

  responsePromise = waitAction(page, 'config_listas_categorias_stock_categoria_eliminar');
  await dialog.getByRole('button', { name: /Eliminar definitivamente/i }).click();
  const deleteResponse = await responsePromise;
  const deleteBody = await deleteResponse.json().catch(() => ({}));
  expect(deleteResponse.status(), JSON.stringify(deleteBody)).toBeLessThan(400);
  expect(Number(deleteBody?.productos_afectados ?? deleteBody?.data?.productos_afectados ?? 0)).toBeGreaterThanOrEqual(1);
  expect(Number(deleteBody?.subcategorias_reubicadas ?? deleteBody?.data?.subcategorias_reubicadas ?? 0)).toBeGreaterThanOrEqual(1);
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await expect(configRow(page, parentName)).toHaveCount(0);
  await expect(configRow(page, childEditedName)).toContainText('Categoría principal');

  // El producto sigue existiendo, mantiene su cantidad y queda sin la categoría eliminada.
  const productResponse = await authenticatedApi(page, 'stock_producto_obtener', {
    query: { id_stock_producto: productId, _r: Date.now() },
  });
  const productBody = expectApiSuccess(productResponse, 'El producto debe seguir existiendo después de eliminar su categoría');
  const persistedProduct = productBody?.producto || productBody?.data?.producto || {};
  expect(Number(persistedProduct?.stock ?? -1)).toBe(7);
  expect(Number(persistedProduct?.id_categoria_stock ?? persistedProduct?.id_stock_categoria ?? 0)).toBe(0);
  expect(Array.isArray(persistedProduct?.categorias) ? persistedProduct.categorias : []).toHaveLength(0);
});
