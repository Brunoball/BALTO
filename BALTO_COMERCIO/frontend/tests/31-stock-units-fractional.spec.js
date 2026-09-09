import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import {
  createBudget,
  createOtherIncomeWithProduct,
  createPurchase,
  createSale,
  convertBudgetToSale,
  deleteBudget,
  deleteOtherMovement,
  deletePurchase,
  deleteSale,
  deleteUnusedStockProduct,
  applyOtherIncomeCreditNote,
  applyPurchaseCreditNote,
  applySaleCreditNote,
} from './support/flows.js';
import { closeDialog, requireMutations, searchRow, selectProduct, waitDialog, waitForBusyToFinish } from './support/ui.js';
import {
  createStockUnit,
  deleteStockUnit,
  expectProductStock,
  getDefaultStockUnit,
  getStockProductBySku,
} from './support/stock-units.js';

function shortAbbreviation(prefix) {
  return `${prefix}${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 4)}`.slice(0, 18);
}

async function persistedMovement(page, action, id, key) {
  const result = await authenticatedApi(page, action, { query: { id_movimiento: Number(id), _: Date.now() } });
  const body = expectApiSuccess(result, `No se pudo releer el movimiento #${id}`);
  return body?.[key] || body?.data?.[key] || null;
}

function firstItem(movement) {
  return (
    (Array.isArray(movement?.items_detalle) && movement.items_detalle[0]) ||
    (Array.isArray(movement?.items) && movement.items[0]) ||
    (Array.isArray(movement?.detalles) && movement.detalles[0]) ||
    (Array.isArray(movement?.productos) && movement.productos[0]) ||
    null
  );
}

function expectPersistedQuantityAndUnit(item, quantity, unit) {
  expect(item, 'El movimiento debe conservar su ítem persistido').toBeTruthy();
  expect(Number(item?.cantidad || 0)).toBeCloseTo(Number(quantity), 3);
  expect(String(item?.unidad_abreviatura || item?.unidad || '').trim()).toBe(String(unit));
  expect(Number(item?.unidad_permite_decimales ?? 0)).toBe(1);
}

function movementIdFromResponseBody(body) {
  return Number(
    body?.id_movimiento
      ?? body?.data?.id_movimiento
      ?? body?.id_venta
      ?? body?.data?.id_venta
      ?? body?.id_movimiento_venta
      ?? body?.data?.id_movimiento_venta
      ?? body?.ids?.[0]
      ?? body?.data?.ids?.[0]
      ?? body?.ids_movimiento?.[0]
      ?? body?.data?.ids_movimiento?.[0]
      ?? 0,
  );
}

async function expectCreditNoteContextUnit(page, action, movementId, unit) {
  const result = await authenticatedApi(page, action, {
    query: { id_movimiento: Number(movementId), _: Date.now() },
  });
  const body = expectApiSuccess(result, `No se pudo cargar el contexto de NC del movimiento #${movementId}`);
  const context = body?.contexto || body?.data?.contexto || null;
  const item = Array.isArray(context?.items) ? context.items[0] : null;
  expect(item, 'El contexto de la NC debe incluir el ítem original').toBeTruthy();
  expect(String(item?.unidad_abreviatura || '').trim()).toBe(String(unit));
  expect(Number(item?.unidad_permite_decimales ?? 0)).toBe(1);
  return item;
}

test('@stock @unidades @critical contrato de unidades: UNIDAD sigue entera y las fraccionables conservan 3 decimales', async ({ page }) => {
  await requireMutations(test, page);
  const defaultUnit = await getDefaultStockUnit(page);
  expect(String(defaultUnit.nombre || '').toUpperCase()).toBe('UNIDAD');
  expect(String(defaultUnit.abreviatura || '')).toBe('u');
  expect(Number(defaultUnit.permite_decimales || 0)).toBe(0);

  // Retrocompatibilidad/Tienda Nube: cualquier alta legacy que no informe unidad
  // debe seguir naciendo como UNIDAD/u, sin introducir kg/g implícitamente.
  const legacyName = uniqueName('UNIDAD-LEGACY-U', 65);
  const legacySku = uniqueSku('LEGACYU');
  await createStockProductFixture(page, {
    name: legacyName,
    sku: legacySku,
    stock: 3,
    cost: 10,
    price: 20,
  });
  const legacyProduct = await getStockProductBySku(page, legacySku);
  expect(Number(legacyProduct.id_stock_unidad)).toBe(Number(defaultUnit.id_stock_unidad));
  expect(String(legacyProduct.unidad_abreviatura || '')).toBe('u');

  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const unitSaleDialog = await waitDialog(page, 'Nueva Venta');
  const unitSaleRow = unitSaleDialog.locator('.gm-table-body .gm-table-row').first();
  await selectProduct(unitSaleRow, legacyName);
  const integerQtyInput = unitSaleRow.locator('input[type="number"]').first();
  await expect(integerQtyInput).toHaveAttribute('step', '1');
  await integerQtyInput.fill('0.5');
  expect(await integerQtyInput.evaluate((el) => el.validity.stepMismatch)).toBeTruthy();
  await closeDialog(unitSaleDialog);

  await page.goto('/panel/stock');
  await deleteUnusedStockProduct(page, legacyName);

  const rejectedName = uniqueName('UNIDAD-ENTERA-RECHAZO', 65);
  const rejectedSku = uniqueSku('U-DEC-RECHAZO');
  const rejected = await authenticatedApi(page, 'stock_productos_crear', {
    method: 'POST',
    body: {
      nombre: rejectedName,
      sku: rejectedSku,
      stock: 0.125,
      id_stock_unidad: Number(defaultUnit.id_stock_unidad),
      precio_costo: 10,
      precio: 20,
      diferir_sync: 1,
      origen_sync: 'playwright_e2e',
      skip_tiendanube_sync: 1,
    },
  });
  expect(rejected.status).toBeGreaterThanOrEqual(400);
  expect(rejected.body?.exito === false || rejected.body?.success === false).toBeTruthy();
  expect(String(rejected.body?.mensaje || rejected.body?.message || '')).toMatch(/entero|unidad\s*u/i);

  const unitName = uniqueName('UNIDAD-KG-DECIMAL', 65);
  const unit = await createStockUnit(page, {
    name: unitName,
    abbreviation: shortAbbreviation('kg'),
    decimals: true,
  });
  const unitId = Number(unit.id_stock_unidad);
  const productName = uniqueName('STOCK-KG-DECIMAL', 65);
  const sku = uniqueSku('KGDEC');

  await createStockProductFixture(page, {
    name: productName,
    sku,
    stock: 12.375,
    cost: 100,
    price: 160,
    unitId,
  });

  let product = await getStockProductBySku(page, sku);
  expect(Number(product.stock)).toBeCloseTo(12.375, 3);
  expect(Number(product.id_stock_unidad)).toBe(unitId);
  expect(String(product.unidad_abreviatura)).toBe(String(unit.abreviatura));
  expect(Number(product.unidad_permite_decimales)).toBe(1);

  // No se puede convertir una unidad ya usada por stock fraccionario en unidad entera.
  const disableDecimals = await authenticatedApi(page, 'stock_unidad_actualizar', {
    method: 'POST',
    body: {
      id_stock_unidad: unitId,
      nombre: unitName,
      abreviatura: unit.abreviatura,
      permite_decimales: 0,
    },
  });
  expect(disableDecimals.status).toBe(409);
  expect(String(disableDecimals.body?.mensaje || '')).toMatch(/stock fraccionario|decimales/i);

  // Tampoco puede borrarse mientras conserve productos/variantes asociados.
  const deleteUsed = await deleteStockUnit(page, unitId, { expectFailure: true });
  expect(deleteUsed.status).toBe(409);
  expect(String(deleteUsed.body?.mensaje || '')).toMatch(/en uso|re-?asign/i);

  await page.goto('/panel/stock');
  await deleteUnusedStockProduct(page, productName);
  await deleteStockUnit(page, unitId);
});

test('@stock @unidades @ui Stock: crea unidad desde el selector y guarda stock fraccionario sin truncarlo', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);
  const productName = uniqueName('STOCK-UI-UNIDAD', 65);
  const sku = uniqueSku('UIUNIT');
  const unitName = uniqueName('STOCK-UI-KILO', 65);
  const abbreviation = shortAbbreviation('kgu');

  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Agregar producto/i }).first().click();
  const dialog = await waitDialog(page, 'Productos');

  await dialog.locator('input[name="nombre"]').fill(productName);
  await dialog.locator('input[name="sku"]').fill(sku);
  await dialog.locator('input[name="stock"]').fill('7,625');
  await dialog.locator('input[name="precio_costo"]').fill('100');
  await dialog.locator('input[name="precio"]').fill('160');

  const unitField = dialog.locator('.fl-field').filter({ hasText: /Unidad de stock/i }).first();
  const select = unitField.locator('select').first();
  await expect(select).toBeVisible();
  await select.selectOption('__new_unit__');
  await unitField.getByPlaceholder(/Nombre \(GRAMO\)/i).fill(unitName);
  await unitField.getByPlaceholder('g', { exact: true }).fill(abbreviation);
  const decimalCheck = unitField.locator('label').filter({ hasText: /Permitir cantidades decimales/i }).locator('input[type="checkbox"]').first();
  await expect(decimalCheck).toBeChecked();

  const unitResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).searchParams.get('action') === 'stock_unidad_crear',
  { timeout: 60_000 });
  await unitField.getByRole('button', { name: /^Guardar$/i }).click();
  const unitResponse = await unitResponsePromise;
  const unitBody = await unitResponse.json().catch(() => ({}));
  expect(unitResponse.status(), JSON.stringify(unitBody)).toBeLessThan(400);
  const unitId = Number(unitBody?.unidad?.id_stock_unidad || unitBody?.data?.unidad?.id_stock_unidad || 0);
  expect(unitId).toBeGreaterThan(0);
  await expect(select).toHaveValue(String(unitId));

  // El mismo selector debe permitir modificar la unidad seleccionada sin salir de Stock.
  const editedAbbreviation = `${abbreviation}e`.slice(0, 20);
  await select.selectOption('__edit_unit__');
  await expect(unitField.getByPlaceholder(/Nombre \(GRAMO\)/i)).toHaveValue(unitName);
  await unitField.getByPlaceholder('g', { exact: true }).fill(editedAbbreviation);
  const updateUnitResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).searchParams.get('action') === 'stock_unidad_actualizar',
  { timeout: 60_000 });
  await unitField.getByRole('button', { name: /^Guardar$/i }).click();
  const updateUnitResponse = await updateUnitResponsePromise;
  expect(updateUnitResponse.status()).toBeLessThan(400);
  await expect(select).toHaveValue(String(unitId));

  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).searchParams.get('action') === 'stock_productos_crear',
  { timeout: 120_000 });
  await dialog.getByRole('button', { name: /Guardar producto/i }).last().click();
  const createResponse = await createResponsePromise;
  const createBody = await createResponse.json().catch(() => ({}));
  expect(createResponse.status(), JSON.stringify(createBody)).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 120_000 });

  const persisted = await getStockProductBySku(page, sku);
  expect(Number(persisted.stock)).toBeCloseTo(7.625, 3);
  expect(Number(persisted.id_stock_unidad)).toBe(unitId);
  expect(String(persisted.unidad_abreviatura)).toBe(editedAbbreviation);

  await page.goto('/panel/stock');
  const row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
  await expect(row).toContainText(/7[,.]625/);
  await expect(row).toContainText(editedAbbreviation);

  // La edición también debe conservar la unidad y aceptar fracciones de 0,001.
  await row.getByTitle('Editar').click();
  const editDialog = await waitDialog(page, 'Editar producto');
  await editDialog.locator('input[name="stock"]').fill('8,125');
  const editUnitField = editDialog.locator('.cmi-floatingField').filter({ hasText: /Unidad de stock/i }).first();
  await expect(editUnitField.getByRole('combobox').first()).toHaveValue(String(unitId));
  const updateProductResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).searchParams.get('action') === 'stock_productos_actualizar',
  { timeout: 120_000 });
  await editDialog.getByRole('button', { name: /Guardar cambios/i }).click();
  const updateProductResponse = await updateProductResponsePromise;
  expect(updateProductResponse.status()).toBeLessThan(400);
  await expect(editDialog).toBeHidden({ timeout: 120_000 });
  const editedProduct = await getStockProductBySku(page, sku);
  expect(Number(editedProduct.stock)).toBeCloseTo(8.125, 3);
  expect(Number(editedProduct.id_stock_unidad)).toBe(unitId);

  await deleteUnusedStockProduct(page, productName);
  await deleteStockUnit(page, unitId);
});

test('@movimientos @stock @unidades @critical venta + NC + eliminación conservan 0,001 y la unidad real', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const unit = await createStockUnit(page, {
    name: uniqueName('VENTA-KG-UNIT', 65),
    abbreviation: shortAbbreviation('kgv'),
    decimals: true,
  });
  const unitId = Number(unit.id_stock_unidad);
  const productName = uniqueName('VENTA-KG-FRAC', 65);
  const sku = uniqueSku('VENTAKG');

  await createStockProductFixture(page, { name: productName, sku, stock: 5, cost: 100, price: 160, unitId });

  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const fractionalSaleDialog = await waitDialog(page, 'Nueva Venta');
  const fractionalSaleRow = fractionalSaleDialog.locator('.gm-table-body .gm-table-row').first();
  await selectProduct(fractionalSaleRow, productName);
  await expect(fractionalSaleRow.locator('input[type="number"]').first()).toHaveAttribute('step', '0.001');
  await closeDialog(fractionalSaleDialog);

  const saleCreatePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'POST') return false;
    const action = new URL(response.url()).searchParams.get('action');
    return action === 'ventas_crear' || action === 'ventas_crear_batch';
  }, { timeout: 90_000 });
  await createSale(page, { productName, quantity: 0.375, price: 160 });
  const saleCreateResponse = await saleCreatePromise;
  const saleCreateBody = await saleCreateResponse.json().catch(() => ({}));
  expect(saleCreateResponse.status(), JSON.stringify(saleCreateBody)).toBeLessThan(400);
  const saleId = movementIdFromResponseBody(saleCreateBody);
  expect(saleId, `La creación de venta debe devolver su ID: ${JSON.stringify(saleCreateBody)}`).toBeGreaterThan(0);
  await expectProductStock(page, sku, 4.625);

  const sale = await persistedMovement(page, 'ventas_obtener', saleId, 'venta');
  expectPersistedQuantityAndUnit(firstItem(sale), 0.375, unit.abreviatura);
  const saleNcContextItem = await expectCreditNoteContextUnit(page, 'ventas_nota_credito_contexto', saleId, unit.abreviatura);
  expect(Number(saleNcContextItem?.cantidad_disponible || 0)).toBeCloseTo(0.375, 3);

  await applySaleCreditNote(page, productName, { motive: 'DEVOLUCION_MERCADERIA', quantity: 0.125 });
  await expectProductStock(page, sku, 4.75);


  await page.goto('/panel/ventas');
  await deleteSale(page, productName);
  await expectProductStock(page, sku, 5);
  await page.goto('/panel/stock');
  await deleteUnusedStockProduct(page, productName);
  await deleteStockUnit(page, unitId);
});

test('@movimientos @stock @unidades @critical compra + NC parcial conservan cantidades fraccionarias exactas', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const unit = await createStockUnit(page, {
    name: uniqueName('COMPRA-KG-UNIT', 65),
    abbreviation: shortAbbreviation('kgc'),
    decimals: true,
  });
  const unitId = Number(unit.id_stock_unidad);
  const productName = uniqueName('COMPRA-KG-FRAC', 65);
  const sku = uniqueSku('COMPRAKG');

  await createStockProductFixture(page, { name: productName, sku, stock: 2.5, cost: 100, price: 160, unitId });
  const purchaseRow = await createPurchase(page, { productName, quantity: 0.375, price: 100 });
  const purchaseId = Number(await purchaseRow.getAttribute('data-movement-id'));
  expect(purchaseId).toBeGreaterThan(0);
  await expectProductStock(page, sku, 2.875);

  const purchase = await persistedMovement(page, 'compras_obtener', purchaseId, 'compra');
  expectPersistedQuantityAndUnit(firstItem(purchase), 0.375, unit.abreviatura);
  const purchaseNcContextItem = await expectCreditNoteContextUnit(page, 'compras_nota_credito_contexto', purchaseId, unit.abreviatura);
  expect(Number(purchaseNcContextItem?.cantidad_disponible || 0)).toBeCloseTo(0.375, 3);

  await applyPurchaseCreditNote(page, productName, { motive: 'DEVOLUCION_MERCADERIA', quantity: 0.125 });
  await expectProductStock(page, sku, 2.75);

  await page.goto('/panel/compras');
  await deletePurchase(page, productName);
  await expectProductStock(page, sku, 2.5);
  await page.goto('/panel/stock');
  await deleteUnusedStockProduct(page, productName);
  await deleteStockUnit(page, unitId);
});

test('@presupuestos @stock @unidades @critical presupuesto fraccionario no toca stock y al convertir descuenta exacto', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const unit = await createStockUnit(page, {
    name: uniqueName('PRESU-KG-UNIT', 65),
    abbreviation: shortAbbreviation('kgp'),
    decimals: true,
  });
  const unitId = Number(unit.id_stock_unidad);
  const productName = uniqueName('PRESU-KG-FRAC', 65);
  const sku = uniqueSku('PRESUKG');

  await createStockProductFixture(page, { name: productName, sku, stock: 8.5, cost: 100, price: 180, unitId });
  await createBudget(page, { productName, quantity: 0.225, price: 180, ivaPct: 21 });
  await expectProductStock(page, sku, 8.5);

  const conversionPromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && new URL(response.url()).searchParams.get('action') === 'presupuestos_convertir_venta',
  { timeout: 90_000 });
  await convertBudgetToSale(page, productName);
  const conversionResponse = await conversionPromise;
  const conversionBody = await conversionResponse.json().catch(() => ({}));
  expect(conversionResponse.status(), JSON.stringify(conversionBody)).toBeLessThan(400);
  const saleId = movementIdFromResponseBody(conversionBody);
  expect(saleId, `La conversión de presupuesto debe devolver id_venta: ${JSON.stringify(conversionBody)}`).toBeGreaterThan(0);
  await expectProductStock(page, sku, 8.275);

  await page.goto('/panel/ventas');
  await searchRow(page, productName, /Buscar por descripción, cliente/i);
  const sale = await persistedMovement(page, 'ventas_obtener', saleId, 'venta');
  expectPersistedQuantityAndUnit(firstItem(sale), 0.225, unit.abreviatura);

  await deleteSale(page, productName);
  await expectProductStock(page, sku, 8.5);
  await page.goto('/panel/presupuesto');
  await deleteBudget(page, productName);
  await page.goto('/panel/stock');
  await deleteUnusedStockProduct(page, productName);
  await deleteStockUnit(page, unitId);
});

test('@movimientos @stock @unidades otros ingresos: impacta stock decimal, NC revierte decimal y conserva unidad', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const unit = await createStockUnit(page, {
    name: uniqueName('INGRESO-KG-UNIT', 65),
    abbreviation: shortAbbreviation('kgi'),
    decimals: true,
  });
  const unitId = Number(unit.id_stock_unidad);
  const productName = uniqueName('INGRESO-KG-FRAC', 65);
  const sku = uniqueSku('INGKG');

  await createStockProductFixture(page, { name: productName, sku, stock: 3.25, cost: 100, price: 160, unitId });
  const incomeCreatePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
      && new URL(response.url()).searchParams.get('action') === 'otros_ingresos_crear',
  { timeout: 90_000 });
  await createOtherIncomeWithProduct(page, { productName, quantity: 0.325, price: 160 });
  const incomeCreateResponse = await incomeCreatePromise;
  const incomeCreateBody = await incomeCreateResponse.json().catch(() => ({}));
  expect(incomeCreateResponse.status(), JSON.stringify(incomeCreateBody)).toBeLessThan(400);
  const incomeId = movementIdFromResponseBody(incomeCreateBody);
  expect(incomeId, `La creación de otro ingreso debe devolver su ID: ${JSON.stringify(incomeCreateBody)}`).toBeGreaterThan(0);
  // Otros Ingresos con producto representa una salida comercial de mercadería: descuenta stock.
  await expectProductStock(page, sku, 2.925);

  const income = await persistedMovement(page, 'otros_ingresos_obtener', incomeId, 'ingreso');
  expectPersistedQuantityAndUnit(firstItem(income), 0.325, unit.abreviatura);
  const incomeNcContextItem = await expectCreditNoteContextUnit(page, 'otros_ingresos_nota_credito_contexto', incomeId, unit.abreviatura);
  expect(Number(incomeNcContextItem?.cantidad_disponible || 0)).toBeCloseTo(0.325, 3);

  await applyOtherIncomeCreditNote(page, productName, { motive: 'DEVOLUCION_MERCADERIA', quantity: 0.125 });
  // La NC devuelve al stock exactamente la fracción acreditada.
  await expectProductStock(page, sku, 3.05);

  await page.goto('/panel/Otrosingresos');
  await deleteOtherMovement(page, 'income', productName);
  await expectProductStock(page, sku, 3.25);
  await page.goto('/panel/stock');
  await deleteUnusedStockProduct(page, productName);
  await deleteStockUnit(page, unitId);
});

test('@stock @variantes @unidades variantes con unidades distintas mantienen su unidad y el padre muestra Unidades mixtas', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);
  const unitA = await createStockUnit(page, {
    name: uniqueName('VAR-GRAMOS', 65),
    abbreviation: shortAbbreviation('gv'),
    decimals: true,
  });
  const unitB = await createStockUnit(page, {
    name: uniqueName('VAR-KILOS', 65),
    abbreviation: shortAbbreviation('kv'),
    decimals: true,
  });
  const productName = uniqueName('VAR-UNIDADES-MIXTAS', 65);
  const parentSku = uniqueSku('VARMIX');
  const skuA = uniqueSku('VARG');
  const skuB = uniqueSku('VARK');

  await createStockProductFixture(page, {
    name: productName,
    sku: parentSku,
    stock: 0,
    cost: 0,
    price: 0,
    unitId: Number(unitA.id_stock_unidad),
    variants: [
      {
        nombre_variante: 'BOLSA CHICA',
        sku: skuA,
        stock: 500.125,
        unitId: Number(unitA.id_stock_unidad),
        atributos: [{ atributo: 'PRESENTACION', valor: 'CHICA' }],
      },
      {
        nombre_variante: 'BOLSA GRANDE',
        sku: skuB,
        stock: 2.375,
        unitId: Number(unitB.id_stock_unidad),
        atributos: [{ atributo: 'PRESENTACION', valor: 'GRANDE' }],
      },
    ],
  });

  const product = await getStockProductBySku(page, parentSku);
  expect(Number(product.unidades_variantes_distintas)).toBe(2);

  const variantsResult = await authenticatedApi(page, 'stock_variantes_listar', {
    query: { id_stock_producto: Number(product.id_stock_producto), activo: 'todos', _: Date.now() },
  });
  const variantsBody = expectApiSuccess(variantsResult, 'No se pudieron releer las variantes mixtas');
  const variants = variantsBody?.variantes || variantsBody?.data?.variantes || [];
  expect(variants).toHaveLength(2);
  const persistedA = variants.find((row) => String(row.sku) === skuA);
  const persistedB = variants.find((row) => String(row.sku) === skuB);
  expect(Number(persistedA?.stock)).toBeCloseTo(500.125, 3);
  expect(Number(persistedA?.id_stock_unidad)).toBe(Number(unitA.id_stock_unidad));
  expect(Number(persistedB?.stock)).toBeCloseTo(2.375, 3);
  expect(Number(persistedB?.id_stock_unidad)).toBe(Number(unitB.id_stock_unidad));

  await page.goto('/panel/stock');
  const row = await searchRow(page, parentSku, /Buscar por nombre, SKU o variante/i);
  await expect(row).toContainText(/Unidades mixtas/i);
  await row.click();
  const variantA = page.locator('.prod-variantsMiniTable__row').filter({ hasText: skuA }).first();
  const variantB = page.locator('.prod-variantsMiniTable__row').filter({ hasText: skuB }).first();
  await expect(variantA).toContainText(/500[,.]125/);
  await expect(variantA).toContainText(String(unitA.abreviatura));
  await expect(variantB).toContainText(/2[,.]375/);
  await expect(variantB).toContainText(String(unitB.abreviatura));

  await deleteUnusedStockProduct(page, productName);
  await deleteStockUnit(page, Number(unitA.id_stock_unidad));
  await deleteStockUnit(page, Number(unitB.id_stock_unidad));
});
