import { test, expect } from './support/test.js';
import { expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import { requireMutations, waitDialog } from './support/ui.js';
import {
  createServiceArticleFixture,
  deleteServiceArticleFixture,
  expectServiceStock,
  ensureActiveServiceUnit,
  findServiceInventoryRow,
  getServiceArticleByName,
  getTypedServiceArticleByName,
  serviciosApi,
} from './support/services.js';

async function get(page, action, query = {}) {
  return expectApiSuccess(await serviciosApi(page, action, { query }), `Falló ${action}`);
}
async function post(page, action, body = {}) {
  return expectApiSuccess(await serviciosApi(page, action, { method: 'POST', body }), `Falló ${action}`);
}
async function bestEffort(page, action, body = {}) {
  try { return await serviciosApi(page, action, { method: 'POST', body }); } catch { return null; }
}
function exact(rows, name) {
  const target = String(name).trim().toUpperCase();
  return (Array.isArray(rows) ? rows : []).find((row) => String(row?.nombre || '').trim().toUpperCase() === target);
}

const TYPES = {
  MATERIAL: {
    label: 'material',
    tab: 'materiales',
    categoryList: 'servicios_materiales_categorias_listar',
    categoryCreate: 'servicios_material_categoria_crear',
    categoryUpdate: 'servicios_material_categoria_actualizar',
    categoryDown: 'servicios_material_categoria_dar_baja',
    categoryUp: 'servicios_material_categoria_reactivar',
    categoryDelete: 'servicios_material_categoria_eliminar',
    list: 'servicios_materiales_listar',
    listKey: 'materiales',
    get: 'servicios_material_obtener',
    getKey: 'material',
    create: 'servicios_material_crear',
    update: 'servicios_material_actualizar',
    down: 'servicios_material_dar_baja',
    up: 'servicios_material_reactivar',
    delete: 'servicios_material_eliminar',
    history: 'servicios_material_historial_precios',
  },
  INSUMO: {
    label: 'insumo',
    tab: 'insumos',
    categoryList: 'servicios_insumos_categorias_listar',
    categoryCreate: 'servicios_insumo_categoria_crear',
    categoryUpdate: 'servicios_insumo_categoria_actualizar',
    categoryDown: 'servicios_insumo_categoria_dar_baja',
    categoryUp: 'servicios_insumo_categoria_reactivar',
    categoryDelete: 'servicios_insumo_categoria_eliminar',
    list: 'servicios_insumos_listar',
    listKey: 'insumos',
    get: 'servicios_insumo_obtener',
    getKey: 'insumo',
    create: 'servicios_insumo_crear',
    update: 'servicios_insumo_actualizar',
    down: 'servicios_insumo_dar_baja',
    up: 'servicios_insumo_reactivar',
    delete: 'servicios_insumo_eliminar',
    history: 'servicios_insumo_historial_precios',
  },
};

async function runTypedLifecycle(page, type) {
  const cfg = TYPES[type];
  const unit = await ensureActiveServiceUnit(page);
  const categoryName = uniqueName(`CAT-${type}`, 100);
  const categoryEdited = `${categoryName}-EDIT`.slice(0, 100);
  const itemName = uniqueName(type, 120);
  const itemEdited = `${itemName}-EDIT`.slice(0, 120);
  let categoryId = 0;
  let itemId = 0;

  try {
    const createdCategory = await post(page, cfg.categoryCreate, {
      nombre: categoryName,
      descripcion: `CATEGORIA ${type} PLAYWRIGHT`,
    });
    categoryId = Number(createdCategory.id_categoria || createdCategory.data?.id_categoria || 0);
    expect(categoryId).toBeGreaterThan(0);

    let categories = (await get(page, cfg.categoryList, { activo: 'todos' })).categorias;
    expect(exact(categories, categoryName)).toBeTruthy();
    await post(page, cfg.categoryUpdate, { id_categoria: categoryId, nombre: categoryEdited, descripcion: 'EDITADA E2E' });
    await post(page, cfg.categoryDown, { id_categoria: categoryId });
    categories = (await get(page, cfg.categoryList, { activo: 0 })).categorias;
    expect(exact(categories, categoryEdited)).toBeTruthy();
    await post(page, cfg.categoryUp, { id_categoria: categoryId });

    const createdItem = await post(page, cfg.create, {
      nombre: itemName,
      descripcion: `${type} E2E`,
      id_categoria: categoryId,
      id_unidad: Number(unit.id_unidad),
      controla_stock: 1,
      stock_actual: 10,
      costo_unitario: 100,
      precio_venta: 160,
      iva_pct: 21,
    });
    itemId = Number(createdItem.id_articulo || createdItem.data?.id_articulo || 0);
    expect(itemId).toBeGreaterThan(0);

    let rows = (await get(page, cfg.list, { activo: 'todos', q: itemName, limit: 200 }))[cfg.listKey];
    expect(exact(rows, itemName)).toBeTruthy();
    const item = await get(page, cfg.get, { id_articulo: itemId });
    expect(Number(item[cfg.getKey]?.id_articulo)).toBe(itemId);
    expect(item[cfg.getKey]?.tipo).toBe(type);

    await post(page, cfg.update, {
      id_articulo: itemId,
      nombre: itemEdited,
      descripcion: `${type} E2E EDITADO`,
      id_categoria: categoryId,
      id_unidad: Number(unit.id_unidad),
      controla_stock: 1,
      costo_unitario: 125,
      precio_venta: 190,
      iva_pct: 10.5,
    });
    const prices = await get(page, cfg.history, { id_articulo: itemId });
    expect(prices.historial?.length || 0).toBeGreaterThanOrEqual(2);

    await expectServiceStock(page, itemEdited, 10);
    const stockGet = await get(page, 'servicios_stock_obtener', { id_articulo: itemId });
    expect(Number(stockGet.stock_item?.id_articulo)).toBe(itemId);

    await post(page, 'servicios_stock_ajustar', {
      id_articulo: itemId, operacion: 'SUMAR', cantidad: 3, motivo: 'INGRESO E2E',
    });
    await expectServiceStock(page, itemEdited, 13);
    await post(page, 'servicios_stock_ajustar', {
      id_articulo: itemId, operacion: 'RESTAR', cantidad: 1, motivo: 'CONSUMO E2E',
    });
    await expectServiceStock(page, itemEdited, 12);
    await post(page, 'servicios_stock_ajustar', {
      id_articulo: itemId, operacion: 'ESTABLECER', cantidad: 5, motivo: 'RECUENTO E2E',
    });
    await expectServiceStock(page, itemEdited, 5);

    const negative = await serviciosApi(page, 'servicios_stock_ajustar', {
      method: 'POST',
      body: { id_articulo: itemId, operacion: 'RESTAR', cantidad: 6, motivo: 'NEGATIVO BLOQUEADO E2E' },
    });
    expect(negative.status).toBe(409);
    expect(negative.body?.exito ?? negative.body?.success).toBe(false);
    await expectServiceStock(page, itemEdited, 5);

    const stockHistory = await get(page, 'servicios_stock_historial', { id_articulo: itemId, limit: 100 });
    expect(stockHistory.historial?.length || 0).toBeGreaterThanOrEqual(4);
    const historyByReason = new Map((stockHistory.historial || []).map((row) => [String(row.motivo || ''), row]));
    expect(historyByReason.get('INGRESO E2E')).toMatchObject({ operacion: 'SUMAR' });
    expect(Number(historyByReason.get('INGRESO E2E')?.cantidad_anterior)).toBe(10);
    expect(Number(historyByReason.get('INGRESO E2E')?.cantidad_movimiento)).toBe(3);
    expect(Number(historyByReason.get('INGRESO E2E')?.cantidad_nueva)).toBe(13);
    expect(historyByReason.get('CONSUMO E2E')).toMatchObject({ operacion: 'RESTAR' });
    expect(historyByReason.get('RECUENTO E2E')).toMatchObject({ operacion: 'ESTABLECER' });

    await post(page, cfg.down, { id_articulo: itemId });
    rows = (await get(page, cfg.list, { activo: 0, q: itemEdited, limit: 200 }))[cfg.listKey];
    expect(exact(rows, itemEdited)).toBeTruthy();
    const inactiveAdjust = await serviciosApi(page, 'servicios_stock_ajustar', {
      method: 'POST',
      body: { id_articulo: itemId, operacion: 'SUMAR', cantidad: 1, motivo: 'BAJA BLOQUEADA E2E' },
    });
    expect(inactiveAdjust.status).toBe(409);
    await post(page, cfg.up, { id_articulo: itemId });

    const row = await findServiceInventoryRow(page, itemEdited, cfg.tab);
    for (const title of ['Ajustar stock', 'Ver historial', 'Editar', 'Dar de baja', 'Eliminar']) {
      await expect(row.getByTitle(title)).toBeVisible();
    }

    const stockRow = await findServiceInventoryRow(page, itemEdited, 'stock');
    for (const title of ['Ajustar stock', 'Ver historial de stock', 'Editar', 'Dar de baja', 'Eliminar']) {
      await expect(stockRow.getByTitle(title)).toBeVisible();
    }

    await stockRow.getByTitle('Editar').click();
    const editDialog = await waitDialog(page, `Editar ${cfg.label}`);

    // En los modales nuevos el nombre vive en el value del input, no como nodo de texto.
    // Validamos los controles reales y, de paso, el formato visual vigente de stock/importes.
    await expect(editDialog.getByRole('textbox', { name: `Nombre del ${cfg.label}`, exact: true })).toHaveValue(itemEdited);
    await expect(editDialog.getByRole('textbox', { name: 'Stock actual', exact: true })).toHaveValue('5');
    await expect(editDialog.getByRole('textbox', { name: 'Costo unitario', exact: true })).toHaveValue('125,00');
    await expect(editDialog.getByRole('textbox', { name: 'Precio de venta (opcional)', exact: true })).toHaveValue('190,00');
    await editDialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(editDialog).toBeHidden();

    await stockRow.getByTitle('Dar de baja').click();
    const statusDialog = await waitDialog(page, `Dar de baja ${cfg.label}`);
    await expect(statusDialog.locator('.mvdel-value').filter({ hasText: itemEdited }).first()).toHaveText(itemEdited);
    await statusDialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(statusDialog).toBeHidden();

    await stockRow.getByTitle('Eliminar').click();
    const deleteDialog = await waitDialog(page, 'Eliminar registro');

    // El modal global de eliminación no garantiza que el nombre quede en una
    // `.mvdel-value`: según el registro puede mostrarse en el mensaje principal.
    // Validamos el contenido funcional del modal sin acoplarnos a ese detalle de markup.
    await expect(deleteDialog).toContainText(itemEdited);
    await expect(deleteDialog.getByRole('button', { name: 'Eliminar definitivamente', exact: true })).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(deleteDialog).toBeHidden();

    await stockRow.getByTitle('Ajustar stock').click();
    const stockDialog = await waitDialog(page, 'Ajustar stock');
    await expect(stockDialog.getByText(itemEdited, { exact: false })).toBeVisible();
    const operation = stockDialog.locator('select').first();
    await expect(operation.locator('option')).toHaveCount(3);
    await expect(stockDialog.getByText('Motivo del ajuste', { exact: false }).first()).toBeVisible();
    await expect(stockDialog.getByRole('button', { name: 'Ver historial de reajustes' })).toBeVisible();

    const amountInput = stockDialog.locator('input').first();
    const reasonInput = stockDialog.locator('textarea').first();
    await amountInput.fill('2,25');
    await expect(amountInput).toHaveValue('2,25');
    await reasonInput.fill('BORRADOR E2E');
    await stockDialog.getByRole('button', { name: 'Ver historial de reajustes' }).click();

    const historyDialog = await waitDialog(page, 'Historial de stock');
    await expect(historyDialog.getByText('INGRESO E2E', { exact: true })).toBeVisible();
    await expect(historyDialog.getByText('CONSUMO E2E', { exact: true })).toBeVisible();
    await expect(historyDialog.getByText('RECUENTO E2E', { exact: true })).toBeVisible();
    await historyDialog.getByRole('button', { name: 'Cerrar' }).last().click();
    await expect(historyDialog).toBeHidden();

    await expect(stockDialog).toBeVisible();
    await expect(amountInput).toHaveValue('2,25');
    await expect(reasonInput).toHaveValue('BORRADOR E2E');
    await stockDialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(stockDialog).toBeHidden();
  } finally {
    if (itemId) await bestEffort(page, cfg.delete, { id_articulo: itemId });
    if (categoryId) await bestEffort(page, cfg.categoryDelete, { id_categoria: categoryId });
  }
}

test.describe('BALTO Servicios - materiales, insumos y stock simple', () => {
  test('@crud @critical material: alta, edición, historial, stock, baja/reactivación y borrado', async ({ page }) => {
    await requireMutations(test, page);
    await runTypedLifecycle(page, 'MATERIAL');
  });

  test('@crud @critical insumo: alta, edición, historial, stock, baja/reactivación y borrado', async ({ page }) => {
    await requireMutations(test, page);
    await runTypedLifecycle(page, 'INSUMO');
  });

  test('@crud @critical material/insumo sin control de stock queda fuera de Stock y no permite ajustes', async ({ page }) => {
    await requireMutations(test, page);
    const name = uniqueName('INSUMO-SIN-CONTROL-STOCK', 120);
    let id = 0;
    try {
      const row = await createServiceArticleFixture(page, {
        name,
        type: 'INSUMO',
        controlStock: false,
        stock: 99,
        cost: 45,
        price: 70,
      });
      id = Number(row.id_articulo);
      expect(Number(row.controla_stock)).toBe(0);
      expect(Number(row.stock_actual || 0)).toBe(0);

      const typed = await getTypedServiceArticleByName(page, name, 'INSUMO', { activo: 'todos' });
      expect(Number(typed?.controla_stock)).toBe(0);
      expect(await getServiceArticleByName(page, name, { activo: 'todos' })).toBeNull();

      const stockGet = await serviciosApi(page, 'servicios_stock_obtener', { query: { id_articulo: id } });
      expect(stockGet.status).toBe(404);

      const uiRow = await findServiceInventoryRow(page, name, 'insumos');
      await expect(uiRow).toContainText('NO CONTROLADO');
      await expect(uiRow.getByTitle('Ajustar stock')).toHaveCount(0);
      await expect(uiRow.getByTitle('Editar')).toBeVisible();
    } finally {
      if (id) await deleteServiceArticleFixture(page, name, { tolerateHistoricalUse: true });
    }
  });

  test('@crud @critical Stock permite productos independientes con alta, edición, ajuste y estado', async ({ page }) => {
    await requireMutations(test, page);
    const name = uniqueName('PRODUCTO-STOCK', 120);
    const edited = `${name}-EDIT`.slice(0, 120);
    let id = 0;
    try {
      const product = await createServiceArticleFixture(page, {
        name,
        type: 'PRODUCTO',
        stock: 7,
        cost: 80,
        price: 130,
      });
      id = Number(product.id_articulo);
      expect(product.tipo).toBe('PRODUCTO');
      expect(Number(product.controla_stock)).toBe(1);
      await expectServiceStock(page, name, 7);

      await post(page, 'servicios_stock_producto_actualizar', {
        id_articulo: id,
        nombre: edited,
        descripcion: 'PRODUCTO INDEPENDIENTE EDITADO E2E',
        id_categoria: product.id_categoria || null,
        id_unidad: Number(product.id_unidad),
        costo_unitario: 90,
        precio_venta: 145,
        iva_pct: 21,
      });
      await expectServiceStock(page, edited, 7);

      await post(page, 'servicios_stock_ajustar', {
        id_articulo: id, operacion: 'SUMAR', cantidad: 3, motivo: 'PRODUCTO E2E',
      });
      await expectServiceStock(page, edited, 10);

      await post(page, 'servicios_stock_producto_dar_baja', { id_articulo: id });
      let inactive = (await get(page, 'servicios_stock_listar', { activo: 0, q: edited, limit: 50 })).stock || [];
      expect(exact(inactive, edited)?.tipo).toBe('PRODUCTO');
      await post(page, 'servicios_stock_producto_reactivar', { id_articulo: id });

      const uiRow = await findServiceInventoryRow(page, edited, 'stock');
      for (const title of ['Ajustar stock', 'Ver historial de stock', 'Editar', 'Dar de baja', 'Eliminar']) {
        await expect(uiRow.getByTitle(title)).toBeVisible();
      }

      await page.getByRole('button', { name: /Agregar producto/i }).click();
      const dialog = await waitDialog(page, 'Agregar producto');
      await expect(dialog.getByText(/independiente de Materiales e Insumos/i)).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
    } finally {
      if (id) await deleteServiceArticleFixture(page, edited, { tolerateHistoricalUse: true });
    }
  });

});
