import { test, expect } from './support/test.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import {
  createBudget,
  convertBudgetToSale,
  deleteBudget,
  deleteSale,
} from './support/flows.js';
import {
  createServiceArticleFixture,
  createServiceFixture,
  deleteServiceArticleFixture,
  deleteServiceFixture,
  ensureActiveServiceUnit,
  expectServiceStock,
  getTypedServiceArticleByName,
} from './support/services.js';
import {
  fillMovementRow,
  fillPayment,
  requireMutations,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  selectService,
  selectServicePriceInMovementRow,
  waitDialog,
  waitForBusyToFinish,
} from './support/ui.js';

function normalizePriceName(value) {
  return String(value || '').trim().toLocaleUpperCase('es-AR');
}

function findPrice(service, pattern) {
  return (service?.precios || []).find((row) => pattern.test(normalizePriceName(row?.tipo_precio))) || null;
}

async function movementCatalog(page) {
  const body = expectApiSuccess(
    await authenticatedApi(page, 'global_obtener_listas', { query: { _: Date.now() } }),
    'No se pudieron cargar las listas globales de Movimientos',
  );
  return body?.listas || body;
}

async function closeDialogByX(dialog) {
  const close = dialog.getByRole('button', { name: /Cerrar/i }).last();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  }
}

test.describe('BALTO Servicios - regresión de los últimos cambios en Movimientos', () => {
  test('@critical catálogo + Ventas + Presupuestos + Otros ingresos respetan servicio sin stock, receta completa, cantidad entera y precios venta/costo', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    await requireMutations(test, page);

    const unit = await ensureActiveServiceUnit(page);
    const materialName = uniqueName('MAT-RECETA-UI', 120);
    const inputName = uniqueName('INS-SIN-STOCK-UI', 120);
    const serviceName = uniqueName('SERVICIO-RECETA-UI', 120);
    let materialId = 0;
    let inputId = 0;
    let serviceId = 0;

    try {
      const material = await createServiceArticleFixture(page, {
        type: 'MATERIAL',
        name: materialName,
        idUnit: Number(unit.id_unidad),
        stock: 30,
        cost: 10,
        price: 25,
        controlStock: true,
      });
      materialId = Number(material.id_articulo);

      const input = await createServiceArticleFixture(page, {
        type: 'INSUMO',
        name: inputName,
        idUnit: Number(unit.id_unidad),
        stock: 0,
        cost: 7,
        price: 15,
        controlStock: false,
      });
      inputId = Number(input.id_articulo);

      const service = await createServiceFixture(page, {
        name: serviceName,
        idUnit: Number(unit.id_unidad),
        baseCost: 5,
        price: 200,
        ivaPct: 0,
        articles: [
          { id_articulo: materialId, cantidad: 2 },
          { id_articulo: inputId, cantidad: 3 },
        ],
      });
      serviceId = Number(service.id_servicio);

      const lists = await movementCatalog(page);
      const catalogService = (lists?.servicios_movimiento || lists?.serviciosMovimiento || lists?.servicios || []).find((row) => Number(row?.id_servicio || 0) === serviceId);
      expect(catalogService, 'El servicio debe estar disponible en el catálogo combinado').toBeTruthy();

      // El servicio nunca es inventario en sí mismo.
      expect(catalogService.stock).toBeNull();
      expect(catalogService.stock_disponible).toBeNull();

      // La receta que viaja a Movimientos contiene TODOS los Materiales/Insumos.
      const components = catalogService.componentes_servicio || catalogService.consumos_snapshot || [];
      expect(components).toHaveLength(2);
      expect(components.some((row) => Number(row.id_articulo) === materialId && Number(row.controla_stock) === 1)).toBe(true);
      expect(components.some((row) => Number(row.id_articulo) === inputId && Number(row.controla_stock) === 0)).toBe(true);

      const salePrice = findPrice(catalogService, /PRECIO\s+DE\s+VENTA|PRECIO\s+VENTA|^VENTA$/i);
      const costPrice = findPrice(catalogService, /PRECIO\s+DE\s+COSTO|PRECIO\s+COSTO|^COSTO$/i);
      expect(salePrice, 'El selector debe exponer PRECIO DE VENTA').toBeTruthy();
      expect(costPrice, 'El selector debe exponer PRECIO DE COSTO').toBeTruthy();
      expect(Number(salePrice.monto)).toBeCloseTo(200, 2);
      // costo base 5 + material 2*10 + insumo sin stock 3*7 = 46.
      expect(Number(costPrice.monto)).toBeCloseTo(46, 2);

      // -------- Ventas --------
      await page.goto('/panel/ventas');
      await waitForBusyToFinish(page);
      await page.getByRole('button', { name: /Nueva Venta/i }).click();
      const saleDialog = await waitDialog(page, 'Nueva Venta');
      const saleRow = await fillMovementRow(saleDialog, { serviceName, quantity: 1 });

      const qty = saleRow.locator('input[type="number"]').first();
      await expect(qty).toHaveAttribute('step', '1');
      await expect(qty).toHaveAttribute('min', '1');
      await qty.fill('2.75');
      await qty.blur();
      expect(Number(await qty.inputValue())).toBe(2);

      const salePriceButton = saleRow.locator('.gm-table-cell').nth(2).locator('button').first();
      await expect(salePriceButton).toContainText(/P\.\s*VENTA/i);
      await expect(salePriceButton).toContainText(/200/);
      await selectServicePriceInMovementRow(saleRow, 'cost');
      await expect(salePriceButton).toContainText(/P\.\s*de\s*COSTO/i);
      await expect(salePriceButton).toContainText(/46/);
      await selectServicePriceInMovementRow(saleRow, 'sale');

      const saleToggle = saleDialog.getByRole('button', { name: /Materiales\s*\/\s*insumos\s*\(2\)/i }).first();
      await expect(saleToggle).toBeVisible();
      await expect(saleDialog.locator('.ssc__body')).toHaveCount(0);
      await saleToggle.click();
      const saleComposition = saleDialog.locator('.ssc__body').first();
      await expect(saleComposition).toContainText(materialName);
      await expect(saleComposition).toContainText(inputName);
      await expect(saleComposition).toContainText(/Sin control de stock/i);
      await closeDialogByX(saleDialog);

      // -------- Presupuestos --------
      await page.goto('/panel/presupuesto');
      await waitForBusyToFinish(page);
      await page.getByTitle('Crear nuevo presupuesto').click();
      const budgetDialog = await waitDialog(page, 'Nuevo presupuesto');
      const budgetRow = await fillMovementRow(budgetDialog, { serviceName, quantity: 1 });
      const budgetPriceButton = budgetRow.locator('.gm-table-cell').nth(2).locator('button').first();
      await expect(budgetPriceButton).toContainText(/P\.\s*VENTA/i);
      await selectServicePriceInMovementRow(budgetRow, 'cost');
      await expect(budgetPriceButton).toContainText(/P\.\s*de\s*COSTO/i);
      const budgetToggle = budgetDialog.getByRole('button', { name: /Materiales\s*\/\s*insumos\s*\(2\)/i }).first();
      await expect(budgetDialog.locator('.ssc__body')).toHaveCount(0);
      await budgetToggle.click();
      await expect(budgetDialog.locator('.ssc__body')).toContainText(inputName);
      await closeDialogByX(budgetDialog);

      // -------- Otros ingresos --------
      await page.goto('/panel/Otrosingresos');
      await waitForBusyToFinish(page);
      await page.getByTitle('Crear nuevo ingreso').click();
      const incomeDialog = await waitDialog(page, 'Nuevo Ingreso');
      const incomeRow = incomeDialog.locator('.gm-table-body .gm-table-row').first();
      await incomeDialog.getByLabel('Tipo de ítem fila 1').selectOption('servicio');
      await selectService(incomeRow, serviceName);

      const incomeQty = incomeRow.locator('input[type="number"]').first();
      await expect(incomeQty).toHaveAttribute('step', '1');
      const incomePrice = incomeDialog.getByLabel('Precio del servicio fila 1');
      await expect(incomePrice).toBeVisible();
      const optionTexts = await incomePrice.locator('option').allTextContents();
      expect(optionTexts.join(' ')).toMatch(/PRECIO DE VENTA/i);
      expect(optionTexts.join(' ')).toMatch(/PRECIO DE COSTO/i);
      await expect(incomePrice.locator('option:checked')).toContainText(/PRECIO DE VENTA/i);
      const costOption = incomePrice.locator('option').filter({ hasText: /PRECIO DE COSTO/i }).first();
      const costValue = await costOption.getAttribute('value');
      await incomePrice.selectOption(String(costValue));
      await expect(incomePrice.locator('option:checked')).toContainText(/PRECIO DE COSTO/i);

      const incomeToggle = incomeDialog.getByRole('button', { name: /Materiales\s*\/\s*insumos\s*\(2\)/i }).first();
      await expect(incomeDialog.locator('.ssc__body')).toHaveCount(0);
      await incomeToggle.click();
      await expect(incomeDialog.locator('.ssc__body')).toContainText(materialName);
      await expect(incomeDialog.locator('.ssc__body')).toContainText(inputName);
      await expect(incomeDialog.locator('.ssc__body')).toContainText(/Sin control de stock/i);
      await closeDialogByX(incomeDialog);
    } finally {
      if (serviceId) await deleteServiceFixture(page, serviceId).catch(() => null);
      if (materialId) await deleteServiceArticleFixture(page, materialName, { tolerateHistoricalUse: true }).catch(() => null);
      if (inputId) await deleteServiceArticleFixture(page, inputName, { tolerateHistoricalUse: true }).catch(() => null);
    }
  });

  test('@crud @critical una venta congela la composición editada del servicio; sólo los componentes con stock impactan inventario y el backend rechaza cantidad decimal', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    await requireMutations(test, page);

    const unit = await ensureActiveServiceUnit(page);
    const materialName = uniqueName('MAT-SNAPSHOT', 120);
    const inputName = uniqueName('INS-SNAPSHOT-NOSTOCK', 120);
    const extraName = uniqueName('MAT-SNAPSHOT-EXTRA', 120);
    const serviceName = uniqueName('SERVICIO-SNAPSHOT', 120);
    let materialId = 0;
    let inputId = 0;
    let extraId = 0;
    let serviceId = 0;
    let saleCreated = false;
    let capturedPayload = null;

    try {
      const material = await createServiceArticleFixture(page, {
        type: 'MATERIAL', name: materialName, idUnit: Number(unit.id_unidad), stock: 20, cost: 10, price: 30,
      });
      materialId = Number(material.id_articulo);
      const input = await createServiceArticleFixture(page, {
        type: 'INSUMO', name: inputName, idUnit: Number(unit.id_unidad), controlStock: false, stock: 0, cost: 5, price: 15,
      });
      inputId = Number(input.id_articulo);
      const extra = await createServiceArticleFixture(page, {
        type: 'MATERIAL', name: extraName, idUnit: Number(unit.id_unidad), stock: 20, cost: 8, price: 20,
      });
      extraId = Number(extra.id_articulo);

      const service = await createServiceFixture(page, {
        name: serviceName,
        idUnit: Number(unit.id_unidad),
        baseCost: 4,
        price: 180,
        ivaPct: 0,
        articles: [
          { id_articulo: materialId, cantidad: 2 },
          { id_articulo: inputId, cantidad: 3 },
        ],
      });
      serviceId = Number(service.id_servicio);

      await page.goto('/panel/ventas');
      await waitForBusyToFinish(page);
      await page.getByRole('button', { name: /Nueva Venta/i }).click();
      const dialog = await waitDialog(page, 'Nueva Venta');
      const row = await fillMovementRow(dialog, { serviceName, quantity: 2, servicePriceKind: 'cost' });

      const toggle = dialog.getByRole('button', { name: /Materiales\s*\/\s*insumos\s*\(2\)/i }).first();
      await toggle.click();
      const body = dialog.locator('.ssc__body').first();

      const materialRow = body.locator('.ssc__row').filter({ hasText: materialName }).first();
      const materialQty = materialRow.locator('.ssc__qty input').first();
      await materialQty.fill('1.5');
      await materialQty.blur();
      await expect(materialRow.locator('.ssc__metric').first()).toContainText(/Necesario total\s*3(?:\D|$)/i); // 2 servicios x 1,5.

      await body.getByRole('button', { name: /Agregar material \/ insumo/i }).click();
      const addedRow = body.locator('.ssc__row').last();
      const addedSelect = addedRow.locator('.ssc__resource select');
      const extraOption = addedSelect.locator('option').filter({ hasText: extraName }).first();
      const extraValue = await extraOption.getAttribute('value');
      await addedSelect.selectOption(String(extraValue));
      const addedQty = addedRow.locator('.ssc__qty input').first();
      await addedQty.fill('4');
      await addedQty.blur();
      await expect(addedRow).toContainText(extraName);
      await expect(addedRow.locator('.ssc__metric').first()).toContainText(/Necesario total\s*8(?:\D|$)/i); // 2 servicios x 4.

      const requestedClient = await selectFirstAutocomplete(dialog, 'Cliente', '');
      expect(requestedClient).not.toBe('');
      const typeField = dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first();
      const selectedType = await selectFirstNonEmpty(typeField.locator('select'), /CUENTA\s*CORRIENTE/i);
      if (/CONTADO/i.test(selectedType.text)) await fillPayment(dialog);

      const responsePromise = page.waitForResponse(
        (response) => response.request().method() === 'POST'
          && new URL(response.url()).searchParams.get('action') === 'ventas_crear_batch',
        { timeout: 60_000 },
      );
      const requestListener = (request) => {
        if (request.method() !== 'POST') return;
        if (new URL(request.url()).searchParams.get('action') !== 'ventas_crear_batch') return;
        try { capturedPayload = request.postDataJSON(); } catch { capturedPayload = null; }
      };
      page.on('request', requestListener);
      try {
        await dialog.getByRole('button', { name: /Guardar venta/i }).last().click();
        const response = await responsePromise;
        const responseBody = await response.json().catch(() => ({}));
        expect(response.status(), JSON.stringify(responseBody)).toBeLessThan(400);
        expect(responseBody?.exito !== false && responseBody?.success !== false, responseBody?.mensaje || responseBody?.message).toBeTruthy();
        await expect(dialog).toBeHidden({ timeout: 60_000 });
        saleCreated = true;
      } finally {
        page.off('request', requestListener);
      }

      expect(capturedPayload, 'Debe capturarse el payload real enviado por Nueva Venta').toBeTruthy();
      const sent = capturedPayload.items?.[0];
      expect(sent?.tipo_item).toBe('SERVICIO');
      expect(Number(sent?.id_servicio)).toBe(serviceId);
      expect(Number(sent?.cantidad)).toBe(2);
      expect(Array.isArray(sent?.consumos_snapshot)).toBe(true);
      const snapshot = new Map(sent.consumos_snapshot.map((component) => [Number(component.id_articulo), Number(component.cantidad_por_unidad)]));
      expect(snapshot.get(materialId)).toBeCloseTo(1.5, 6);
      expect(snapshot.get(inputId)).toBeCloseTo(3, 6);
      expect(snapshot.get(extraId)).toBeCloseTo(4, 6);

      await expectServiceStock(page, materialName, 17); // 20 - 2*1.5
      await expectServiceStock(page, extraName, 12); // 20 - 2*4
      const noStock = await getTypedServiceArticleByName(page, inputName, 'INSUMO', { activo: 'todos' });
      expect(Number(noStock?.controla_stock)).toBe(0);
      expect(Number(noStock?.stock_actual || 0)).toBe(0);

      await page.goto('/panel/ventas');
      await deleteSale(page, serviceName);
      saleCreated = false;
      await expectServiceStock(page, materialName, 20);
      await expectServiceStock(page, extraName, 20);

      // Reutilizamos exactamente el payload válido que salió de la UI y alteramos
      // sólo la cantidad. Así la prueba backend no depende de inventar campos.
      const decimalPayload = structuredClone(capturedPayload);
      decimalPayload.items[0].cantidad = 1.5;
      const decimalAttempt = await authenticatedApi(page, 'ventas_crear_batch', {
        method: 'POST',
        body: decimalPayload,
      });
      expect(decimalAttempt.status).toBeGreaterThanOrEqual(400);
      expect(String(decimalAttempt.body?.mensaje || decimalAttempt.body?.message || '')).toMatch(/cantidad.*servicio.*entero|servicio.*número entero/i);
      await expectServiceStock(page, materialName, 20);
      await expectServiceStock(page, extraName, 20);
    } finally {
      if (saleCreated) {
        try { await page.goto('/panel/ventas'); await deleteSale(page, serviceName); } catch {}
      }
      if (serviceId) await deleteServiceFixture(page, serviceId).catch(() => null);
      if (materialId) await deleteServiceArticleFixture(page, materialName, { tolerateHistoricalUse: true }).catch(() => null);
      if (inputId) await deleteServiceArticleFixture(page, inputName, { tolerateHistoricalUse: true }).catch(() => null);
      if (extraId) await deleteServiceArticleFixture(page, extraName, { tolerateHistoricalUse: true }).catch(() => null);
    }
  });

  test('@crud @critical presupuesto de servicio conserva receta/precio y recién consume stock al asignarse como venta', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    await requireMutations(test, page);

    const unit = await ensureActiveServiceUnit(page);
    const materialName = uniqueName('MAT-PRESUP-SERV', 120);
    const serviceName = uniqueName('SERVICIO-PRESUP-STOCK', 120);
    let materialId = 0;
    let serviceId = 0;
    let budgetCreated = false;
    let saleCreated = false;

    try {
      const material = await createServiceArticleFixture(page, {
        type: 'MATERIAL', name: materialName, idUnit: Number(unit.id_unidad), stock: 10, cost: 12, price: 30,
      });
      materialId = Number(material.id_articulo);
      const service = await createServiceFixture(page, {
        name: serviceName,
        idUnit: Number(unit.id_unidad),
        baseCost: 6,
        price: 100,
        ivaPct: 0,
        articles: [{ id_articulo: materialId, cantidad: 2 }],
      });
      serviceId = Number(service.id_servicio);

      await createBudget(page, {
        serviceName,
        quantity: 2,
        servicePriceKind: 'cost',
        ivaPct: 0,
      });
      budgetCreated = true;
      await expectServiceStock(page, materialName, 10);

      await convertBudgetToSale(page, serviceName);
      saleCreated = true;
      await expectServiceStock(page, materialName, 6);

      await page.goto('/panel/ventas');
      await deleteSale(page, serviceName);
      saleCreated = false;
      await expectServiceStock(page, materialName, 10);

      await page.goto('/panel/presupuesto');
      try {
        await deleteBudget(page, serviceName);
        budgetCreated = false;
      } catch {
        // El cleanup global E2E también elimina modelos/presupuestos PW-* si el
        // presupuesto asignado conserva una relación histórica no borrable por UI.
      }
    } finally {
      if (saleCreated) {
        try { await page.goto('/panel/ventas'); await deleteSale(page, serviceName); } catch {}
      }
      if (budgetCreated) {
        try { await page.goto('/panel/presupuesto'); await deleteBudget(page, serviceName); } catch {}
      }
      if (serviceId) await deleteServiceFixture(page, serviceId).catch(() => null);
      if (materialId) await deleteServiceArticleFixture(page, materialName, { tolerateHistoricalUse: true }).catch(() => null);
    }
  });
});
