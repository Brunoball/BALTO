import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { RUN_PREFIX, uniqueName } from './support/data.js';
import { createSale, deleteSale } from './support/flows.js';
import {
  createServiceArticleFixture,
  deleteServiceArticleFixture,
  findServiceInventoryRow,
  getTypedServiceArticleByName,
  serviciosApi,
} from './support/services.js';
import { requireMutations, waitDialog, waitForBusyToFinish } from './support/ui.js';

async function post(page, action, body = {}, label = action) {
  return expectApiSuccess(
    await serviciosApi(page, action, { method: 'POST', body }),
    `Falló ${label}`,
  );
}

async function rawPost(page, action, body = {}) {
  return serviciosApi(page, action, { method: 'POST', body });
}

async function get(page, action, query = {}, label = action) {
  return expectApiSuccess(
    await serviciosApi(page, action, { query }),
    `Falló ${label}`,
  );
}

async function bestEffort(page, action, body = {}) {
  try {
    return await serviciosApi(page, action, { method: 'POST', body });
  } catch {
    return null;
  }
}

function exactByName(rows, name) {
  const expected = String(name || '').trim().toLocaleUpperCase('es-AR');
  return (Array.isArray(rows) ? rows : []).find(
    (row) => String(row?.nombre || '').trim().toLocaleUpperCase('es-AR') === expected,
  ) || null;
}

function idFrom(body, key) {
  return Number(body?.[key] || body?.data?.[key] || 0);
}

async function createWorker(page, { name, hourlyCost }) {
  const body = await post(page, 'servicios_trabajador_crear', {
    nombre: name,
    documento: uniqueName('DOC-SEL', 28),
    rol: 'TECNICO E2E',
    tipo_trabajador: 'CONTRATADO',
    modalidad_pago: 'HORA',
    monto_periodo: Number(hourlyCost),
    horas_periodo: 1,
    notas: `FIXTURE ${name}`,
  });
  const id = idFrom(body, 'id_trabajador');
  expect(id, `El trabajador ${name} debe devolver id_trabajador`).toBeGreaterThan(0);
  return id;
}

async function createService(page, {
  name,
  unitId,
  articles = [],
  workers = [],
  otherCost = 0,
  price = 100,
}) {
  const body = await post(page, 'servicios_servicio_crear', {
    nombre: name,
    id_categoria: null,
    id_unidad_cobro: Number(unitId),
    descripcion: `SERVICIO E2E ${name}`,
    costo_base: Number(otherCost),
    duracion_estimada_minutos: 60,
    precio_venta: Number(price),
    iva_pct: 0,
    composicion: {
      articulos: articles,
      trabajadores: workers,
    },
  });
  const id = idFrom(body, 'id_servicio');
  expect(id, `El servicio ${name} debe devolver id_servicio`).toBeGreaterThan(0);
  return id;
}

async function createUnit(page, name) {
  const body = await post(page, 'servicios_unidad_crear', {
    nombre: name,
    simbolo: `T${Date.now().toString(36).slice(-5)}`.toUpperCase(),
  });
  const id = idFrom(body, 'id_unidad');
  expect(id, `La unidad ${name} debe devolver id_unidad`).toBeGreaterThan(0);
  return id;
}

async function deleteService(page, id) {
  if (!id) return;
  await bestEffort(page, 'servicios_composicion_guardar', {
    id_servicio: Number(id),
    composicion: { articulos: [], trabajadores: [] },
  });
  await bestEffort(page, 'servicios_servicio_eliminar', { id_servicio: Number(id) });
}

async function openServiceRow(page, name) {
  await page.goto('/panel/servicios');
  await waitForBusyToFinish(page);
  const search = page.getByPlaceholder('Buscar servicio...');
  await expect(search).toBeVisible();
  await search.fill(name);
  const row = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

async function openWorkerRow(page, name) {
  await page.goto('/panel/servicios');
  await waitForBusyToFinish(page);
  await page.getByRole('tablist').getByRole('button', { name: /^Trabajadores$/ }).click();
  const search = page.getByPlaceholder('Buscar trabajador o rol...');
  await expect(search).toBeVisible();
  await search.fill(name);
  const row = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

async function assertBlockedDelete(row, reason) {
  const button = row.locator('button.mov-iconBtn--danger').last();
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-label', reason);
  await expect(button.locator('xpath=..')).toHaveAttribute('title', reason);
}

async function assertEnabledDelete(row) {
  const button = row.locator('button.mov-iconBtn--danger').last();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('aria-label', 'Eliminar');
  await expect(button.locator('xpath=..')).toHaveAttribute('title', 'Eliminar');
}

async function addFilteredMultiSelection(dialog, cardSelector, searchText, expectedNames) {
  const card = dialog.locator(cardSelector);
  const trigger = card.locator('.servicios-multi-select__trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const picker = pageDialogWithinCard(card);
  const search = picker.locator('input[type="search"]');
  await expect(search).toBeVisible();
  await search.fill(searchText);

  for (const name of expectedNames) {
    await expect(picker.locator('.servicios-multi-select__options button').filter({ hasText: name })).toHaveCount(1);
  }

  await picker.getByRole('button', { name: 'Seleccionar resultados', exact: true }).click();
  await expect(picker.getByRole('button', { name: `Agregar (${expectedNames.length})`, exact: true })).toBeEnabled();
  await picker.getByRole('button', { name: `Agregar (${expectedNames.length})`, exact: true }).click();
  await expect(picker).toBeHidden();
}

function pageDialogWithinCard(card) {
  return card.locator('.servicios-multi-select__menu[role="dialog"]');
}

async function deleteBudgetModel(page, idModel) {
  if (!idModel) return;
  try {
    await authenticatedApi(page, 'presupuestos_modelos_eliminar', {
      method: 'POST',
      body: { id_modelo: Number(idModel) },
    });
  } catch {}
}

test.describe('BALTO Servicios - UX nueva, rentabilidad y blindaje de borrado', () => {
  test('@critical alta rápida de unidad + selector múltiple + margen deseado recalculan y persisten bien', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);

    const resourceTag = uniqueName('UX-MULTI-ART', 52);
    const workerTag = uniqueName('UX-MULTI-WRK', 52);
    const materialName = `${resourceTag}-MAT`.slice(0, 120);
    const inputName = `${resourceTag}-INS`.slice(0, 120);
    const workerAName = `${workerTag}-A`.slice(0, 100);
    const workerBName = `${workerTag}-B`.slice(0, 100);
    const quickUnitName = uniqueName('UNIDAD-DESDE-SERVICIO', 70);
    const serviceName = uniqueName('SERVICIO-UX-MARGEN', 120);

    let materialId = 0;
    let inputId = 0;
    let workerAId = 0;
    let workerBId = 0;
    let unitId = 0;
    let serviceId = 0;

    try {
      const material = await createServiceArticleFixture(page, {
        type: 'MATERIAL',
        name: materialName,
        stock: 50,
        cost: 10,
        price: 15,
      });
      materialId = Number(material.id_articulo);

      const input = await createServiceArticleFixture(page, {
        type: 'INSUMO',
        name: inputName,
        stock: 50,
        cost: 20,
        price: 30,
      });
      inputId = Number(input.id_articulo);

      workerAId = await createWorker(page, { name: workerAName, hourlyCost: 30 });
      workerBId = await createWorker(page, { name: workerBName, hourlyCost: 40 });

      // Las fixtures se crean por API; recargamos para que el catálogo del modal
      // tenga exactamente esos recursos antes de probar la selección múltiple.
      await page.goto('/panel/servicios');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForBusyToFinish(page);
      await page.getByRole('button', { name: 'Agregar servicio', exact: true }).click();
      const dialog = await waitDialog(page, 'Agregar servicio');

      const unitSelect = dialog.getByRole('combobox', { name: 'Unidad de cobro', exact: true });
      await expect(unitSelect.getByRole('option', { name: '+ AGREGAR UNIDAD', exact: true })).toHaveCount(1);
      await unitSelect.selectOption('__ADD__');

      const unitDialog = await waitDialog(page, 'Agregar unidad');
      const nameField = unitDialog.locator('.gm-field').filter({ hasText: /^Nombre$/ }).locator('input').first();
      const symbolField = unitDialog.locator('.gm-field').filter({ hasText: /Símbolo/ }).locator('input').first();
      await nameField.fill(quickUnitName);
      await symbolField.fill(`Q${Date.now().toString(36).slice(-4)}`.toUpperCase());
      const createUnitResponse = page.waitForResponse(
        (response) => response.request().method() === 'POST'
          && new URL(response.url()).searchParams.get('action') === 'servicios_unidad_crear',
        { timeout: 30_000 },
      );
      await unitDialog.getByRole('button', { name: 'Guardar unidad', exact: true }).click();
      const unitResponse = await createUnitResponse;
      expect(unitResponse.status()).toBeLessThan(400);
      await expect(unitDialog).toBeHidden({ timeout: 20_000 });

      const units = (await get(page, 'servicios_unidades_listar', { activo: 'todos' })).unidades || [];
      const createdUnit = exactByName(units, quickUnitName);
      expect(createdUnit, 'La unidad creada desde el servicio debe existir').toBeTruthy();
      unitId = Number(createdUnit.id_unidad);
      await expect(unitSelect).toHaveValue(String(unitId));

      await dialog.getByRole('textbox', { name: 'Nombre del servicio', exact: true }).fill(serviceName);
      const otherCost = dialog.getByRole('textbox', { name: 'Otros costos', exact: true });
      const margin = dialog.getByRole('textbox', { name: 'Margen deseado (%)', exact: true });
      const salePrice = dialog.getByRole('textbox', { name: 'Precio de venta', exact: true });
      await otherCost.fill('100');

      await addFilteredMultiSelection(
        dialog,
        '.servicios-component-card--materials',
        resourceTag,
        [materialName, inputName],
      );
      const materialRow = dialog.locator('.servicios-component-card--materials .servicios-component-row').filter({ hasText: materialName });
      const inputRow = dialog.locator('.servicios-component-card--materials .servicios-component-row').filter({ hasText: inputName });
      await expect(materialRow).toHaveCount(1);
      await expect(inputRow).toHaveCount(1);
      await materialRow.locator('.servicios-component-quantity__input').fill('2');
      await inputRow.locator('.servicios-component-quantity__input').fill('3');

      // Los ya agregados desaparecen del selector: no pueden duplicarse.
      const materialCard = dialog.locator('.servicios-component-card--materials');
      await materialCard.locator('.servicios-multi-select__trigger').click();
      const materialPicker = pageDialogWithinCard(materialCard);
      await materialPicker.locator('input[type="search"]').fill(resourceTag);
      await expect(materialPicker.locator('.servicios-multi-select__options button')).toHaveCount(0);
      await expect(materialPicker).toContainText('NO HAY RECURSOS DISPONIBLES');
      await page.keyboard.press('Escape');
      await expect(materialPicker).toBeHidden();

      await addFilteredMultiSelection(
        dialog,
        '.servicios-component-card--labor',
        workerTag,
        [workerAName, workerBName],
      );
      const workerARow = dialog.locator('.servicios-component-card--labor .servicios-component-row').filter({ hasText: workerAName });
      const workerBRow = dialog.locator('.servicios-component-card--labor .servicios-component-row').filter({ hasText: workerBName });
      await expect(workerARow).toHaveCount(1);
      await expect(workerBRow).toHaveCount(1);
      await workerARow.locator('.servicios-component-quantity__input').fill('2');
      await workerBRow.locator('.servicios-component-quantity__input').fill('3');

      // El margen sobre venta no puede llegar a 100%: el precio tendería a infinito.
      // El formulario debe rechazarlo antes de llamar al backend y permanecer abierto.
      await margin.fill('100');
      await dialog.getByRole('button', { name: 'Crear servicio', exact: true }).click();
      await expect(page.locator('.toast-error .toast-message')).toHaveText('El margen deseado debe ser menor a 100%.');
      await expect(dialog).toBeVisible();

      // Costo = 2*10 + 3*20 + 2*30 + 3*40 + 100 = 360.
      // Con margen sobre venta de 20 %, el precio correcto es 360 / 0,8 = 450.
      await margin.fill('20');
      await expect(salePrice).toHaveValue('450,00');

      // Si el costo cambia mientras el margen manda, el precio se recalcula solo.
      // Nuevo costo = 440 -> precio = 440 / 0,8 = 550.
      await otherCost.fill('180');
      await expect(salePrice).toHaveValue('550,00');

      // Si el usuario toma control del precio, el margen pasa a reflejar el valor real.
      await salePrice.fill('500');
      await expect(margin).toHaveValue('12');

      // Volvemos a margen como fuente antes de guardar para verificar persistencia.
      await margin.fill('20');
      await expect(salePrice).toHaveValue('550,00');

      const createResponsePromise = page.waitForResponse(
        (response) => response.request().method() === 'POST'
          && new URL(response.url()).searchParams.get('action') === 'servicios_servicio_crear',
        { timeout: 45_000 },
      );
      await dialog.getByRole('button', { name: 'Crear servicio', exact: true }).click();
      const createResponse = await createResponsePromise;
      const createBody = await createResponse.json().catch(() => ({}));
      expect(createResponse.status(), JSON.stringify(createBody)).toBeLessThan(400);
      expect(createBody?.exito !== false && createBody?.success !== false).toBe(true);
      serviceId = Number(createBody?.id_servicio || createBody?.data?.id_servicio || 0);
      expect(serviceId).toBeGreaterThan(0);
      await expect(dialog).toBeHidden({ timeout: 30_000 });

      const fetched = await get(page, 'servicios_servicio_obtener', { id_servicio: serviceId });
      expect(Number(fetched.servicio?.id_unidad_cobro)).toBe(unitId);
      expect(Number(fetched.servicio?.precio_venta)).toBeCloseTo(550, 2);

      const articleMap = new Map((fetched.servicio?.articulos || []).map((row) => [Number(row.id_articulo), Number(row.cantidad)]));
      expect(articleMap.get(materialId)).toBeCloseTo(2, 6);
      expect(articleMap.get(inputId)).toBeCloseTo(3, 6);

      const workerMap = new Map((fetched.servicio?.trabajadores || []).map((row) => [Number(row.id_trabajador), Number(row.horas_estimadas)]));
      expect(workerMap.get(workerAId)).toBeCloseTo(2, 6);
      expect(workerMap.get(workerBId)).toBeCloseTo(3, 6);

      const listed = exactByName((await get(page, 'servicios_catalogo_listar', { activo: 'todos', q: serviceName })).servicios, serviceName);
      expect(Number(listed?.costo_estimado)).toBeCloseTo(440, 2);
    } finally {
      await deleteService(page, serviceId);
      if (materialId) await deleteServiceArticleFixture(page, materialName, { tolerateHistoricalUse: true });
      if (inputId) await deleteServiceArticleFixture(page, inputName, { tolerateHistoricalUse: true });
      if (workerAId) await bestEffort(page, 'servicios_trabajador_eliminar', { id_trabajador: workerAId });
      if (workerBId) await bestEffort(page, 'servicios_trabajador_eliminar', { id_trabajador: workerBId });
      if (unitId) await bestEffort(page, 'servicios_unidad_eliminar', { id_unidad: unitId });
    }
  });

  test('@critical artículo y trabajador usados en una composición bloquean el hard-delete en UI y backend; al desvincular se liberan', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);

    const articleName = uniqueName('GUARD-COMP-MAT', 120);
    const workerName = uniqueName('GUARD-COMP-WRK', 100);
    const serviceName = uniqueName('GUARD-COMP-SRV', 120);
    const unitName = uniqueName('GUARD-COMP-UNIT', 70);

    let articleId = 0;
    let workerId = 0;
    let serviceId = 0;
    let unitId = 0;

    try {
      unitId = await createUnit(page, unitName);
      const article = await createServiceArticleFixture(page, {
        type: 'MATERIAL', name: articleName, idUnit: unitId, stock: 20, cost: 25, price: 40,
      });
      articleId = Number(article.id_articulo);
      workerId = await createWorker(page, { name: workerName, hourlyCost: 50 });
      serviceId = await createService(page, {
        name: serviceName,
        unitId,
        articles: [{ id_articulo: articleId, cantidad: 1 }],
        workers: [{ id_trabajador: workerId, horas_estimadas: 1 }],
        price: 200,
      });

      const materialDelete = await rawPost(page, 'servicios_material_eliminar', { id_articulo: articleId });
      expect(materialDelete.status).toBe(409);
      expect(String(materialDelete.body?.mensaje || '')).toMatch(/servicio|composici/i);

      const workerDelete = await rawPost(page, 'servicios_trabajador_eliminar', { id_trabajador: workerId });
      expect(workerDelete.status).toBe(409);
      expect(String(workerDelete.body?.mensaje || '')).toMatch(/servicio/i);

      let materialRow = await findServiceInventoryRow(page, articleName, 'materiales');
      await assertBlockedDelete(materialRow, /forma parte de 1 servicio/i);

      let workerRow = await openWorkerRow(page, workerName);
      await assertBlockedDelete(workerRow, /asignado a 1 servicio/i);

      await post(page, 'servicios_composicion_guardar', {
        id_servicio: serviceId,
        composicion: { articulos: [], trabajadores: [] },
      });

      const material = await getTypedServiceArticleByName(page, articleName, 'MATERIAL', { activo: 'todos' });
      expect(Number(material?.cantidad_servicios || 0)).toBe(0);
      const workers = (await get(page, 'servicios_trabajadores_listar', { activo: 'todos', q: workerName })).trabajadores || [];
      expect(Number(exactByName(workers, workerName)?.cantidad_servicios || 0)).toBe(0);

      materialRow = await findServiceInventoryRow(page, articleName, 'materiales');
      await assertEnabledDelete(materialRow);
      workerRow = await openWorkerRow(page, workerName);
      await assertEnabledDelete(workerRow);
    } finally {
      await deleteService(page, serviceId);
      if (articleId) await deleteServiceArticleFixture(page, articleName, { tolerateHistoricalUse: true });
      if (workerId) await bestEffort(page, 'servicios_trabajador_eliminar', { id_trabajador: workerId });
      if (unitId) await bestEffort(page, 'servicios_unidad_eliminar', { id_unidad: unitId });
    }
  });

  test('@critical producto directo y material/insumo consumidos por servicio quedan bloqueados por movimientos', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    await requireMutations(test, page);

    const unitName = uniqueName('GUARD-ART-MOV-UNIT', 70);
    const materialName = uniqueName('GUARD-MOV-MAT', 120);
    const inputName = uniqueName('GUARD-MOV-INS', 120);
    const productName = uniqueName('GUARD-MOV-PROD', 120);
    const serviceName = uniqueName('GUARD-MOV-CONSUMO-SRV', 120);

    let unitId = 0;
    let materialId = 0;
    let inputId = 0;
    let productId = 0;
    let serviceId = 0;
    let serviceSaleCreated = false;
    let productSaleCreated = false;

    try {
      unitId = await createUnit(page, unitName);
      const material = await createServiceArticleFixture(page, {
        type: 'MATERIAL', name: materialName, idUnit: unitId, stock: 20, cost: 10, price: 15,
      });
      const input = await createServiceArticleFixture(page, {
        type: 'INSUMO', name: inputName, idUnit: unitId, stock: 20, cost: 12, price: 18,
      });
      const product = await createServiceArticleFixture(page, {
        type: 'PRODUCTO', name: productName, idUnit: unitId, stock: 20, cost: 20, price: 35,
      });
      materialId = Number(material.id_articulo);
      inputId = Number(input.id_articulo);
      productId = Number(product.id_articulo);

      serviceId = await createService(page, {
        name: serviceName,
        unitId,
        articles: [
          { id_articulo: materialId, cantidad: 2 },
          { id_articulo: inputId, cantidad: 3 },
        ],
        price: 150,
      });

      await createSale(page, { serviceName, quantity: 1, price: 150 });
      serviceSaleCreated = true;
      await createSale(page, { productName, quantity: 1, price: 35 });
      productSaleCreated = true;

      await expect.poll(async () => {
        const row = await getTypedServiceArticleByName(page, materialName, 'MATERIAL', { activo: 'todos' });
        return Number(row?.tiene_movimientos || 0);
      }, { timeout: 30_000, intervals: [300, 700, 1_500] }).toBe(1);
      await expect.poll(async () => {
        const row = await getTypedServiceArticleByName(page, inputName, 'INSUMO', { activo: 'todos' });
        return Number(row?.tiene_movimientos || 0);
      }, { timeout: 30_000, intervals: [300, 700, 1_500] }).toBe(1);
      await expect.poll(async () => {
        const row = await getTypedServiceArticleByName(page, productName, 'PRODUCTO', { activo: 'todos' });
        return Number(row?.tiene_movimientos || 0);
      }, { timeout: 30_000, intervals: [300, 700, 1_500] }).toBe(1);

      const materialDelete = await rawPost(page, 'servicios_material_eliminar', { id_articulo: materialId });
      expect(materialDelete.status).toBe(409);
      expect(String(materialDelete.body?.mensaje || '')).toMatch(/movimientos/i);

      const inputDelete = await rawPost(page, 'servicios_insumo_eliminar', { id_articulo: inputId });
      expect(inputDelete.status).toBe(409);
      expect(String(inputDelete.body?.mensaje || '')).toMatch(/movimientos/i);

      const productDelete = await rawPost(page, 'servicios_stock_producto_eliminar', { id_articulo: productId });
      expect(productDelete.status).toBe(409);
      expect(String(productDelete.body?.mensaje || '')).toMatch(/movimientos/i);

      let materialRow = await findServiceInventoryRow(page, materialName, 'materiales');
      await assertBlockedDelete(materialRow, /utilizado en movimientos/i);
      let inputRow = await findServiceInventoryRow(page, inputName, 'insumos');
      await assertBlockedDelete(inputRow, /utilizado en movimientos/i);
      let productRow = await findServiceInventoryRow(page, productName, 'stock');
      await assertBlockedDelete(productRow, /utilizado en movimientos/i);

      // Al borrar los movimientos, el producto directo queda libre. Material e insumo
      // dejan de estar bloqueados por historial, pero siguen protegidos por la receta
      // del servicio hasta que esa composición se quite explícitamente.
      await page.goto('/panel/ventas');
      await deleteSale(page, productName);
      productSaleCreated = false;
      await deleteSale(page, serviceName);
      serviceSaleCreated = false;

      await expect.poll(async () => {
        const [mat, ins, prod] = await Promise.all([
          getTypedServiceArticleByName(page, materialName, 'MATERIAL', { activo: 'todos' }),
          getTypedServiceArticleByName(page, inputName, 'INSUMO', { activo: 'todos' }),
          getTypedServiceArticleByName(page, productName, 'PRODUCTO', { activo: 'todos' }),
        ]);
        return [mat, ins, prod].map((row) => Number(row?.tiene_movimientos || 0));
      }, { timeout: 30_000, intervals: [300, 700, 1_500] }).toEqual([0, 0, 0]);

      productRow = await findServiceInventoryRow(page, productName, 'stock');
      await assertEnabledDelete(productRow);
      materialRow = await findServiceInventoryRow(page, materialName, 'materiales');
      await assertBlockedDelete(materialRow, /forma parte de 1 servicio/i);
      inputRow = await findServiceInventoryRow(page, inputName, 'insumos');
      await assertBlockedDelete(inputRow, /forma parte de 1 servicio/i);

      await post(page, 'servicios_composicion_guardar', {
        id_servicio: serviceId,
        composicion: { articulos: [], trabajadores: [] },
      });

      materialRow = await findServiceInventoryRow(page, materialName, 'materiales');
      await assertEnabledDelete(materialRow);
      inputRow = await findServiceInventoryRow(page, inputName, 'insumos');
      await assertEnabledDelete(inputRow);
    } finally {
      if (productSaleCreated) {
        try {
          await page.goto('/panel/ventas');
          await deleteSale(page, productName);
        } catch {}
      }
      if (serviceSaleCreated) {
        try {
          await page.goto('/panel/ventas');
          await deleteSale(page, serviceName);
        } catch {}
      }
      await deleteService(page, serviceId);
      if (materialId) await deleteServiceArticleFixture(page, materialName, { tolerateHistoricalUse: true });
      if (inputId) await deleteServiceArticleFixture(page, inputName, { tolerateHistoricalUse: true });
      if (productId) await deleteServiceArticleFixture(page, productName, { tolerateHistoricalUse: true });
      if (unitId) await bestEffort(page, 'servicios_unidad_eliminar', { id_unidad: unitId });
    }
  });

  test('@critical servicio usado en un movimiento bloquea el hard-delete y se libera al eliminar el movimiento', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);

    const unitName = uniqueName('GUARD-MOV-UNIT', 70);
    const serviceName = uniqueName('GUARD-MOV-SRV', 120);
    let unitId = 0;
    let serviceId = 0;
    let saleCreated = false;

    try {
      unitId = await createUnit(page, unitName);
      serviceId = await createService(page, { name: serviceName, unitId, price: 175 });

      await createSale(page, { serviceName, quantity: 1, price: 175 });
      saleCreated = true;

      let catalog = (await get(page, 'servicios_catalogo_listar', { activo: 'todos', q: serviceName })).servicios || [];
      let service = exactByName(catalog, serviceName);
      expect(Number(service?.tiene_movimientos || 0)).toBe(1);

      const blocked = await rawPost(page, 'servicios_servicio_eliminar', { id_servicio: serviceId });
      expect(blocked.status).toBe(409);
      expect(String(blocked.body?.mensaje || '')).toMatch(/movimientos/i);

      let row = await openServiceRow(page, serviceName);
      await assertBlockedDelete(row, /utilizado en movimientos/i);

      await page.goto('/panel/ventas');
      await deleteSale(page, serviceName);
      saleCreated = false;

      await expect.poll(async () => {
        const rows = (await get(page, 'servicios_catalogo_listar', { activo: 'todos', q: serviceName })).servicios || [];
        return Number(exactByName(rows, serviceName)?.tiene_movimientos || 0);
      }, { timeout: 30_000, intervals: [300, 700, 1_500] }).toBe(0);

      row = await openServiceRow(page, serviceName);
      await assertEnabledDelete(row);

      const deleted = await rawPost(page, 'servicios_servicio_eliminar', { id_servicio: serviceId });
      expect(deleted.status).toBeLessThan(400);
      expect(deleted.body?.exito !== false).toBe(true);
      serviceId = 0;
    } finally {
      if (saleCreated) {
        try {
          await page.goto('/panel/ventas');
          await deleteSale(page, serviceName);
        } catch {}
      }
      await deleteService(page, serviceId);
      if (unitId) await bestEffort(page, 'servicios_unidad_eliminar', { id_unidad: unitId });
    }
  });

  test('@critical modelos de presupuesto bloquean artículos y servicios en UI/backend y al borrar el modelo los liberan', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);

    const unitName = uniqueName('GUARD-MODEL-UNIT', 70);
    const articleName = uniqueName('GUARD-MODEL-ART', 120);
    const serviceName = uniqueName('GUARD-MODEL-SRV', 120);
    const modelName = uniqueName('GUARD-MODEL', 140);
    let unitId = 0;
    let articleId = 0;
    let serviceId = 0;
    let modelId = 0;

    try {
      unitId = await createUnit(page, unitName);
      const article = await createServiceArticleFixture(page, {
        type: 'PRODUCTO', name: articleName, idUnit: unitId, stock: 10, cost: 35, price: 60,
      });
      articleId = Number(article.id_articulo);
      serviceId = await createService(page, { name: serviceName, unitId, price: 120 });

      const modelResult = expectApiSuccess(
        await authenticatedApi(page, 'presupuestos_modelos_guardar', {
          method: 'POST',
          body: {
            nombre: modelName,
            descripcion: `MODELO E2E ${RUN_PREFIX}`,
            es_personalizado: 1,
            items: [
              { id_servicio: serviceId, descripcion: serviceName, cantidad: 1, precio: 120, iva_pct: 0 },
              { id_articulo: articleId, descripcion: articleName, cantidad: 1, precio: 60, iva_pct: 0 },
            ],
          },
        }),
        'No se pudo crear el modelo E2E de presupuesto',
      );
      modelId = Number(modelResult?.id_modelo || modelResult?.data?.id_modelo || 0);
      expect(modelId).toBeGreaterThan(0);

      let services = (await get(page, 'servicios_catalogo_listar', { activo: 'todos', q: serviceName })).servicios || [];
      let service = exactByName(services, serviceName);
      expect(Number(service?.tiene_modelos_presupuesto || 0)).toBe(1);
      let product = await getTypedServiceArticleByName(page, articleName, 'PRODUCTO', { activo: 'todos' });
      expect(Number(product?.tiene_modelos_presupuesto || 0)).toBe(1);

      const serviceDelete = await rawPost(page, 'servicios_servicio_eliminar', { id_servicio: serviceId });
      expect(serviceDelete.status).toBe(409);
      expect(String(serviceDelete.body?.mensaje || '')).toMatch(/modelo|presupuesto/i);

      const productDelete = await rawPost(page, 'servicios_stock_producto_eliminar', { id_articulo: articleId });
      expect(productDelete.status).toBe(409);
      expect(String(productDelete.body?.mensaje || '')).toMatch(/modelo|presupuesto/i);

      let serviceRow = await openServiceRow(page, serviceName);
      await assertBlockedDelete(serviceRow, /modelos de presupuesto/i);
      let productRow = await findServiceInventoryRow(page, articleName, 'stock');
      await assertBlockedDelete(productRow, /modelos de presupuesto/i);

      const deleteModel = await authenticatedApi(page, 'presupuestos_modelos_eliminar', {
        method: 'POST',
        body: { id_modelo: modelId },
      });
      expectApiSuccess(deleteModel, 'No se pudo eliminar el modelo E2E');
      modelId = 0;

      services = (await get(page, 'servicios_catalogo_listar', { activo: 'todos', q: serviceName })).servicios || [];
      service = exactByName(services, serviceName);
      expect(Number(service?.tiene_modelos_presupuesto || 0)).toBe(0);
      product = await getTypedServiceArticleByName(page, articleName, 'PRODUCTO', { activo: 'todos' });
      expect(Number(product?.tiene_modelos_presupuesto || 0)).toBe(0);

      serviceRow = await openServiceRow(page, serviceName);
      await assertEnabledDelete(serviceRow);
      productRow = await findServiceInventoryRow(page, articleName, 'stock');
      await assertEnabledDelete(productRow);
    } finally {
      await deleteBudgetModel(page, modelId);
      await deleteService(page, serviceId);
      if (articleId) await deleteServiceArticleFixture(page, articleName, { tolerateHistoricalUse: true });
      if (unitId) await bestEffort(page, 'servicios_unidad_eliminar', { id_unidad: unitId });
    }
  });
});
