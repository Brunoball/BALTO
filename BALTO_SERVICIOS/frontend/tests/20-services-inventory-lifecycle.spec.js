import { test, expect } from './support/test.js';
import { expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import { requireMutations, waitDialog } from './support/ui.js';
import {
  expectServiceStock,
  ensureActiveServiceUnit,
  findServiceInventoryRow,
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
    await expect(stockRow.getByTitle('Ajustar stock')).toBeVisible();
    await expect(stockRow.getByTitle('Ver historial de stock')).toBeVisible();
    await stockRow.getByTitle('Ajustar stock').click();
    const stockDialog = await waitDialog(page, 'Ajustar stock');
    await expect(stockDialog.getByText(itemEdited, { exact: false })).toBeVisible();
    const operation = stockDialog.locator('select').first();
    await expect(operation.locator('option')).toHaveCount(3);
    await expect(stockDialog.getByText('Motivo del ajuste', { exact: false }).first()).toBeVisible();
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
});
