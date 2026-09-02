import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import {
  createOtherIncomeWithProduct,
  createPurchase,
  createSale,
  createStockProduct,
  deleteUnusedStockProduct,
} from './support/flows.js';
import {
  barcodeApi,
  createVariantStockProduct,
  expectBarcodeSuccess,
  expectDialogSelectedProduct,
  simulateBarcodeScan,
  uniqueExternalBarcode,
} from './support/barcodes.js';
import { requireMutations, searchRow, waitDialog, waitForBusyToFinish } from './support/ui.js';

async function getSimpleProductId(page, sku) {
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
  const id = Number(await row.getAttribute('data-stock-product-id'));
  expect(id).toBeGreaterThan(0);
  return id;
}

async function openNewSale(page) {
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  return waitDialog(page, 'Nueva Venta');
}

async function openNewPurchase(page) {
  await page.goto('/panel/compras');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nueva compra').click();
  return waitDialog(page, 'Nueva Compra');
}

async function openNewOtherIncome(page) {
  await page.goto('/panel/Otrosingresos');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo ingreso').click();
  return waitDialog(page, 'Nuevo Ingreso');
}

async function openNewBudget(page) {
  await page.goto('/panel/presupuesto');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo presupuesto').click();
  return waitDialog(page, 'Nuevo presupuesto');
}

async function openNewBudgetModel(page) {
  await page.goto('/panel/presupuesto');
  await waitForBusyToFinish(page);
  await page.getByTitle('Ver y administrar modelos de presupuesto').click();
  let dialog = await waitDialog(page, 'Modelos de presupuesto');
  await dialog.getByRole('button', { name: /Crear modelo/i }).click();
  dialog = await waitDialog(page, 'Nuevo modelo');
  return dialog;
}

async function scanAndAssert(page, dialog, code, productText, options = {}) {
  await simulateBarcodeScan(page, code, options);
  await expectDialogSelectedProduct(dialog, productText);
  await expect(page.locator('body')).toContainText(/Producto leído:/i, { timeout: 20_000 });
}

function movementBody(request) {
  try {
    return request.postDataJSON() || {};
  } catch {
    return {};
  }
}

function extractMovementItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.detalles)) return payload.detalles;
  if (Array.isArray(payload?.productos)) return payload.productos;
  return [];
}

function movementVariantId(payload) {
  const top = Number(payload?.id_stock_variante || 0);
  if (top > 0) return top;
  const item = extractMovementItems(payload)[0] || null;
  return Number(item?.id_stock_variante || item?.idStockVariante || 0);
}

function movementProductId(payload) {
  const top = Number(payload?.id_stock_producto || 0);
  if (top > 0) return top;
  const item = extractMovementItems(payload)[0] || null;
  return Number(item?.id_stock_producto || item?.idStockProducto || 0);
}

async function persistedMovement(page, action, id, key) {
  const result = await authenticatedApi(page, action, { query: { id_movimiento: id } });
  const body = expectApiSuccess(result, `No se pudo releer el movimiento #${id}`);
  return body?.[key] || body?.data?.[key] || null;
}

function firstPersistedItem(movement) {
  return (
    (Array.isArray(movement?.items) && movement.items[0]) ||
    (Array.isArray(movement?.items_detalle) && movement.items_detalle[0]) ||
    (Array.isArray(movement?.detalles) && movement.detalles[0]) ||
    (Array.isArray(movement?.productos) && movement.productos[0]) ||
    null
  );
}

test('@barcode @movimientos @critical pistola selecciona automáticamente en todas las altas: venta, compra, ingreso, presupuesto y modelo', async ({ page }) => {
  // Este flujo abre cinco modales, crea/elimina un producto y consulta el backend
  // remoto varias veces. El timeout global de 60 s es demasiado corto para una
  // corrida completa contra Hostinger aunque la funcionalidad esté respondiendo.
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const productName = uniqueName('SCAN-ALTAS');
  const sku = uniqueSku('SCANALTAS');
  const external = uniqueExternalBarcode('EAN-ALTAS');
  let productId = 0;

  try {
    await createStockProduct(page, { name: productName, sku, stock: 25, cost: 90, price: 180 });
    productId = await getSimpleProductId(page, sku);
    expectBarcodeSuccess(await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: { op: 'guardar', tipo_entidad: 'producto', id_stock_producto: productId, codigo_barra: external },
    }));

    // Venta: código físico + Enter. Es el caso equivalente a escanear el EAN que ya trae un producto.
    let dialog = await openNewSale(page);
    await scanAndAssert(page, dialog, external, productName, { terminator: 'Enter', delay: 5 });

    // Compra: BL-P generado por Balto + Tab. La compra permite incluso artículos sin stock.
    dialog = await openNewPurchase(page);
    await scanAndAssert(page, dialog, `BL-P-${productId}`, productName, { terminator: 'Tab', delay: 5 });

    // Otro ingreso: lectora sin sufijo. El hook debe confirmar por velocidad + silencio.
    dialog = await openNewOtherIncome(page);
    await scanAndAssert(page, dialog, external, productName, { terminator: null, delay: 5, idleMs: 300 });
    await expect(dialog.getByLabel('Tipo de ítem fila 1')).toHaveValue('producto');

    // Presupuesto.
    dialog = await openNewBudget(page);
    await scanAndAssert(page, dialog, `BL-P-${productId}`, productName, { terminator: 'Enter', delay: 5 });

    // Modelo de presupuesto.
    dialog = await openNewBudgetModel(page);
    await scanAndAssert(page, dialog, external, productName, { terminator: null, delay: 5, idleMs: 300 });

    expectBarcodeSuccess(await barcodeApi(page, 'quitar', {
      method: 'DELETE',
      body: { op: 'quitar', tipo_entidad: 'producto', id_stock_producto: productId },
    }));
  } finally {
    if (productId > 0) {
      await barcodeApi(page, 'quitar', {
        method: 'DELETE',
        body: { op: 'quitar', tipo_entidad: 'producto', id_stock_producto: productId },
      }).catch(() => null);
    }
    await deleteUnusedStockProduct(page, productName).catch(() => null);
  }
});

test('@barcode @movimientos @variants edición: compra e ingreso leen BL-V; recibo y orden guardan id_stock_variante real', async ({ page }) => {
  test.setTimeout(7 * 60_000);
  await requireMutations(test, page);

  const sourceName = uniqueName('SCAN-ORIGEN');
  const sourceSku = uniqueSku('SCANORIGEN');
  const payableSourceName = uniqueName('SCAN-ORDEN-ORIGEN');
  const payableSourceSku = uniqueSku('SCANORDEN');
  const targetName = uniqueName('SCAN-VARIANTES');
  const targetSku = uniqueSku('SCANPADRE');
  const variantA = { name: uniqueName('SCAN-VAR-A', 40), sku: uniqueSku('SCNVA'), stock: 0, price: 230 };
  const variantB = { name: uniqueName('SCAN-VAR-B', 40), sku: uniqueSku('SCNVB'), stock: 12, price: 240 };

  await createStockProduct(page, { name: sourceName, sku: sourceSku, stock: 30, cost: 80, price: 170 });
  const sourceProductId = await getSimpleProductId(page, sourceSku);
  await createStockProduct(page, { name: payableSourceName, sku: payableSourceSku, stock: 30, cost: 75, price: 165 });
  const payableSourceProductId = await getSimpleProductId(page, payableSourceSku);
  const target = await createVariantStockProduct(page, {
    name: targetName,
    sku: targetSku,
    variants: [variantA, variantB],
  });
  const storedVariantA = target.variants.find((row) => String(row.sku) === variantA.sku);
  const storedVariantB = target.variants.find((row) => String(row.sku) === variantB.sku);
  expect(storedVariantA, 'Debe existir la variante sin stock destino en DB').toBeTruthy();
  expect(storedVariantB, 'Debe existir la variante con stock destino en DB').toBeTruthy();
  const variantAId = Number(storedVariantA.id_stock_variante);
  const variantBId = Number(storedVariantB.id_stock_variante);
  expect(variantAId).toBeGreaterThan(0);
  expect(variantBId).toBeGreaterThan(0);
  const targetProductId = target.productId;
  const zeroStockVariantCode = `BL-V-${variantAId}`;
  const variantCode = `BL-V-${variantBId}`;
  const variantExternal = uniqueExternalBarcode('EAN-VAR-MOV');
  expectBarcodeSuccess(await barcodeApi(page, 'guardar', {
    method: 'POST',
    body: {
      op: 'guardar',
      tipo_entidad: 'variante',
      id_stock_producto: targetProductId,
      id_stock_variante: variantBId,
      codigo_barra: variantExternal,
    },
  }), 'No se pudo preparar el código físico de la variante para movimientos');

  // Fixtures de movimientos reales, todos marcados PW y limpiables por el teardown.
  await createPurchase(page, { productName: sourceName, quantity: 1, price: 80 });
  // Compra separada para Orden de Pago: editar la primera compra cambia su descripción/producto,
  // por lo que no debemos reutilizar el mismo movimiento como fixture de dos flujos distintos.
  await createPurchase(page, { productName: payableSourceName, quantity: 1, price: 75 });
  await createOtherIncomeWithProduct(page, { productName: sourceName, quantity: 1, price: 170 });
  await createSale(page, { productName: sourceName, quantity: 1, price: 170 });

  // 1) Editar compra: no alcanza con verla seleccionada; el payload y la DB deben
  // conservar el id_stock_variante que vino de la pistola. La variante A tiene stock 0:
  // Compras debe incluirla igualmente porque esta operación suma stock.
  await page.goto('/panel/compras');
  await waitForBusyToFinish(page);
  let row = await searchRow(page, sourceName, /Buscar por descripción, proveedor/i);
  const purchaseMovementId = Number(await row.getAttribute('data-movement-id'));
  expect(purchaseMovementId).toBeGreaterThan(0);
  await row.getByTitle('Editar').click();
  let dialog = await waitDialog(page, 'Editar compra');
  await scanAndAssert(page, dialog, zeroStockVariantCode, variantA.name, { terminator: 'Enter', delay: 5 });

  const purchaseRequestPromise = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).searchParams.get('action') === 'compras_editar',
  { timeout: 90_000 });
  const purchaseResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).searchParams.get('action') === 'compras_editar',
  { timeout: 90_000 });
  await dialog.getByRole('button', { name: /Guardar cambios/i }).click();
  const [purchaseRequest, purchaseResponse] = await Promise.all([purchaseRequestPromise, purchaseResponsePromise]);
  const purchaseResponseBody = await purchaseResponse.json().catch(() => ({}));
  expect(purchaseResponse.status(), JSON.stringify(purchaseResponseBody)).toBeLessThan(400);
  const purchasePayload = movementBody(purchaseRequest);
  expect(movementProductId(purchasePayload)).toBe(targetProductId);
  expect(movementVariantId(purchasePayload)).toBe(variantAId);
  await expect(dialog).toBeHidden({ timeout: 45_000 });

  const purchasePersisted = await persistedMovement(page, 'compras_obtener', purchaseMovementId, 'compra');
  const purchaseItem = firstPersistedItem(purchasePersisted);
  expect(Number(purchaseItem?.id_stock_producto || purchasePersisted?.id_stock_producto || 0)).toBe(targetProductId);
  expect(Number(purchaseItem?.id_stock_variante || purchasePersisted?.id_stock_variante || 0)).toBe(variantAId);

  // 2) Editar otro ingreso: mismo control extremo a extremo (UI -> request -> DB).
  await page.goto('/panel/Otrosingresos');
  await waitForBusyToFinish(page);
  row = await searchRow(page, sourceName, /Buscar por descripción/i);
  // Otros Ingresos no expone data-movement-id en la fila. Capturamos el GET real
  // que abre el editor para tomar exactamente el movimiento seleccionado por UI.
  const incomeLoadPromise = page.waitForResponse((response) =>
    new URL(response.url()).searchParams.get('action') === 'otros_ingresos_obtener',
  { timeout: 90_000 });
  await row.getByTitle('Editar').click();
  const incomeLoad = await incomeLoadPromise;
  const incomeMovementId = Number(new URL(incomeLoad.url()).searchParams.get('id_movimiento') || 0);
  expect(incomeMovementId).toBeGreaterThan(0);
  dialog = await waitDialog(page, 'Editar ingreso');
  await scanAndAssert(page, dialog, variantCode, variantB.name, { terminator: 'Tab', delay: 5 });

  // Editar Otro Ingreso es multi-ítem: si la fila existente ya está ocupada,
  // la pistola agrega correctamente una línea nueva con el producto escaneado.
  // Eso aumenta el total del ingreso; completamos el medio de pago antes de
  // guardar para probar el flujo real y no quedar bloqueados por la validación
  // contable de “medios de pago deben cubrir el total”.
  const completarRestante = dialog.getByTitle('Completar importe restante').first();
  await expect(completarRestante).toBeEnabled({ timeout: 20_000 });
  await completarRestante.click();

  const incomeRequestPromise = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).searchParams.get('action') === 'otros_ingresos_actualizar',
  { timeout: 90_000 });
  const incomeResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).searchParams.get('action') === 'otros_ingresos_actualizar',
  { timeout: 90_000 });
  await dialog.getByRole('button', { name: /Guardar cambios/i }).click();
  const [incomeRequest, incomeResponse] = await Promise.all([incomeRequestPromise, incomeResponsePromise]);
  const incomeResponseBody = await incomeResponse.json().catch(() => ({}));
  expect(incomeResponse.status(), JSON.stringify(incomeResponseBody)).toBeLessThan(400);
  const incomePayload = movementBody(incomeRequest);
  const incomePayloadItems = extractMovementItems(incomePayload);
  const scannedIncomeItem = incomePayloadItems.find((item) =>
    Number(item?.id_stock_producto || item?.idStockProducto || 0) === targetProductId &&
    Number(item?.id_stock_variante || item?.idStockVariante || 0) === variantBId
  );
  expect(scannedIncomeItem, 'El payload de Editar Otro Ingreso debe incluir la variante escaneada').toBeTruthy();
  await expect(dialog).toBeHidden({ timeout: 45_000 });

  const incomePersisted = await persistedMovement(page, 'otros_ingresos_obtener', incomeMovementId, 'ingreso');
  const incomePersistedItems =
    (Array.isArray(incomePersisted?.items) && incomePersisted.items) ||
    (Array.isArray(incomePersisted?.items_detalle) && incomePersisted.items_detalle) ||
    (Array.isArray(incomePersisted?.detalles) && incomePersisted.detalles) ||
    (Array.isArray(incomePersisted?.productos) && incomePersisted.productos) ||
    [];
  const persistedScannedIncomeItem = incomePersistedItems.find((item) =>
    Number(item?.id_stock_producto || item?.idStockProducto || 0) === targetProductId &&
    Number(item?.id_stock_variante || item?.idStockVariante || 0) === variantBId
  );
  expect(
    persistedScannedIncomeItem,
    'La DB debe conservar la variante escaneada dentro de los ítems del Otro Ingreso editado'
  ).toBeTruthy();

  // 3) Editar Recibo (deuda de venta): captura el payload real y confirma persistencia de id_stock_variante.
  await page.goto('/panel/recibos');
  await waitForBusyToFinish(page);
  row = await searchRow(page, sourceName, /Buscar por descripción, cliente/i);
  const receiptMovementId = Number(await row.getAttribute('data-movement-id'));
  expect(receiptMovementId).toBeGreaterThan(0);
  await row.getByTitle('Editar').click();
  dialog = await waitDialog(page, 'Editar recibo');
  await scanAndAssert(page, dialog, variantExternal, variantB.name, { terminator: 'Enter', delay: 5 });

  const receiptRequestPromise = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).searchParams.get('action') === 'recibos_actualizar',
  { timeout: 90_000 });
  const receiptResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).searchParams.get('action') === 'recibos_actualizar',
  { timeout: 90_000 });
  await dialog.getByRole('button', { name: /Guardar cambios/i }).click();
  const [receiptRequest, receiptResponse] = await Promise.all([receiptRequestPromise, receiptResponsePromise]);
  const receiptResponseBody = await receiptResponse.json().catch(() => ({}));
  expect(receiptResponse.status(), JSON.stringify(receiptResponseBody)).toBeLessThan(400);
  const receiptPayload = movementBody(receiptRequest);
  expect(movementProductId(receiptPayload)).toBe(targetProductId);
  expect(movementVariantId(receiptPayload)).toBe(variantBId);
  await expect(dialog).toBeHidden({ timeout: 45_000 });

  const receiptPersisted = await persistedMovement(page, 'recibos_obtener', receiptMovementId, 'recibo');
  const receiptItem = firstPersistedItem(receiptPersisted);
  expect(Number(receiptItem?.id_stock_producto || receiptPersisted?.id_stock_producto || 0)).toBe(targetProductId);
  expect(Number(receiptItem?.id_stock_variante || receiptPersisted?.id_stock_variante || 0)).toBe(variantBId);

  // Compatibilidad defensiva agregada en backend: un cliente viejo que edita el
  // mismo producto sin mandar id_stock_variante no debe borrar la variante existente.
  const legacyReceiptPayload = {
    ...receiptPayload,
    id_movimiento: receiptMovementId,
    items: extractMovementItems(receiptPayload).map((item) => {
      const copy = { ...item };
      delete copy.id_stock_variante;
      delete copy.idStockVariante;
      return copy;
    }),
  };
  delete legacyReceiptPayload.id_stock_variante;
  delete legacyReceiptPayload.idStockVariante;
  expectApiSuccess(await authenticatedApi(page, 'recibos_actualizar', {
    method: 'POST',
    body: legacyReceiptPayload,
  }), 'Editar recibo sin campo de variante debe preservar la variante actual');
  const receiptAfterLegacy = await persistedMovement(page, 'recibos_obtener', receiptMovementId, 'recibo');
  const receiptLegacyItem = firstPersistedItem(receiptAfterLegacy);
  expect(Number(receiptLegacyItem?.id_stock_variante || receiptAfterLegacy?.id_stock_variante || 0)).toBe(variantBId);

  // Backend: una variante de otro producto nunca puede aceptarse aunque alguien altere el request manualmente.
  const badReceiptPayload = {
    ...receiptPayload,
    id_movimiento: receiptMovementId,
    id_stock_producto: sourceProductId,
    id_stock_variante: variantBId,
    items: extractMovementItems(receiptPayload).map((item) => ({
      ...item,
      id_stock_producto: sourceProductId,
      id_stock_variante: variantBId,
    })),
  };
  const rejectedReceipt = await authenticatedApi(page, 'recibos_actualizar', {
    method: 'POST',
    body: badReceiptPayload,
  });
  expect(rejectedReceipt.status).toBe(422);
  expect(String(rejectedReceipt.body?.mensaje || '')).toMatch(/variante.*no pertenece|no pertenece.*producto/i);

  // 4) Editar Orden de Pago (deuda de compra): mismo blindaje para proveedor y,
  // además, confirma que la lista completa de compras expone variantes con stock 0.
  await page.goto('/panel/OrdenesPago');
  await waitForBusyToFinish(page);
  row = await searchRow(page, payableSourceName, /Buscar por descripción, proveedor/i);
  const orderMovementId = Number(await row.getAttribute('data-movement-id'));
  expect(orderMovementId).toBeGreaterThan(0);
  await row.getByTitle('Editar').click();
  dialog = await waitDialog(page, 'Editar orden de pago');
  await scanAndAssert(page, dialog, zeroStockVariantCode, variantA.name, { terminator: null, delay: 5, idleMs: 300 });

  const orderRequestPromise = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).searchParams.get('action') === 'ordenes_pago_actualizar',
  { timeout: 90_000 });
  const orderResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).searchParams.get('action') === 'ordenes_pago_actualizar',
  { timeout: 90_000 });
  await dialog.getByRole('button', { name: /Guardar cambios/i }).click();
  const [orderRequest, orderResponse] = await Promise.all([orderRequestPromise, orderResponsePromise]);
  const orderResponseBody = await orderResponse.json().catch(() => ({}));
  expect(orderResponse.status(), JSON.stringify(orderResponseBody)).toBeLessThan(400);
  const orderPayload = movementBody(orderRequest);
  expect(movementProductId(orderPayload)).toBe(targetProductId);
  expect(movementVariantId(orderPayload)).toBe(variantAId);
  await expect(dialog).toBeHidden({ timeout: 45_000 });

  const orderPersisted = await persistedMovement(page, 'ordenes_pago_obtener', orderMovementId, 'orden_pago');
  const orderItem = firstPersistedItem(orderPersisted);
  expect(Number(orderItem?.id_stock_producto || orderPersisted?.id_stock_producto || 0)).toBe(targetProductId);
  expect(Number(orderItem?.id_stock_variante || orderPersisted?.id_stock_variante || 0)).toBe(variantAId);

  const legacyOrderPayload = {
    ...orderPayload,
    id_movimiento: orderMovementId,
    items: extractMovementItems(orderPayload).map((item) => {
      const copy = { ...item };
      delete copy.id_stock_variante;
      delete copy.idStockVariante;
      return copy;
    }),
  };
  delete legacyOrderPayload.id_stock_variante;
  delete legacyOrderPayload.idStockVariante;
  expectApiSuccess(await authenticatedApi(page, 'ordenes_pago_actualizar', {
    method: 'POST',
    body: legacyOrderPayload,
  }), 'Editar orden sin campo de variante debe preservar la variante actual');
  const orderAfterLegacy = await persistedMovement(page, 'ordenes_pago_obtener', orderMovementId, 'orden_pago');
  const orderLegacyItem = firstPersistedItem(orderAfterLegacy);
  expect(Number(orderLegacyItem?.id_stock_variante || orderAfterLegacy?.id_stock_variante || 0)).toBe(variantAId);

  const badOrderPayload = {
    ...orderPayload,
    id_movimiento: orderMovementId,
    id_stock_producto: payableSourceProductId,
    id_stock_variante: variantAId,
    items: extractMovementItems(orderPayload).map((item) => ({
      ...item,
      id_stock_producto: payableSourceProductId,
      id_stock_variante: variantAId,
    })),
  };
  const rejectedOrder = await authenticatedApi(page, 'ordenes_pago_actualizar', {
    method: 'POST',
    body: badOrderPayload,
  });
  expect(rejectedOrder.status).toBe(422);
  expect(String(rejectedOrder.body?.mensaje || '')).toMatch(/variante.*no pertenece|no pertenece.*producto/i);

  expectBarcodeSuccess(await barcodeApi(page, 'quitar', {
    method: 'DELETE',
    body: {
      op: 'quitar',
      tipo_entidad: 'variante',
      id_stock_producto: targetProductId,
      id_stock_variante: variantBId,
    },
  }), 'El código físico de la variante debe poder limpiarse al terminar el E2E');
});

test('@barcode @movimientos @scanner-resilience lecturas consecutivas y doble terminador no pierden productos ni ensucian el campo enfocado', async ({ page }) => {
  // En el trace fallido el escenario ya había terminado y el timeout de 60 s
  // venció durante el cleanup de los productos E2E. Damos margen al teardown sin
  // relajar ninguna aserción funcional del scanner.
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const firstName = uniqueName('SCAN-COLA-A');
  const firstSku = uniqueSku('SCANCOLAA');
  const secondName = uniqueName('SCAN-COLA-B');
  const secondSku = uniqueSku('SCANCOLAB');

  try {
    await createStockProduct(page, { name: firstName, sku: firstSku, stock: 8, cost: 50, price: 100 });
    await createStockProduct(page, { name: secondName, sku: secondSku, stock: 9, cost: 55, price: 110 });
    const firstId = await getSimpleProductId(page, firstSku);
    const secondId = await getSimpleProductId(page, secondSku);

    const dialog = await openNewSale(page);
    const clientInput = dialog.locator('.nc-prov-wrap input.gm-input').first();
    await expect(clientInput).toBeVisible();
    const originalClientText = 'CLIENTE SIN CAMBIOS';
    await clientInput.fill(originalClientText);
    await clientInput.focus();

    // Simula una pistola configurada con CR+LF/doble terminador y, sin esperar
    // el lookup de la primera, una segunda lectura. El hook debe absorber el
    // terminador residual y procesar ambas lecturas en serie.
    await simulateBarcodeScan(page, `BL-P-${firstId}`, {
      terminator: 'Enter',
      extraTerminators: ['Enter'],
    });
    // Sin esperar el lookup anterior: reproduce dos lecturas consecutivas y deja
    // que la cola interna del hook las serialice.
    await simulateBarcodeScan(page, `BL-P-${secondId}`, { terminator: 'Enter' });

    await expectDialogSelectedProduct(dialog, firstName);
    await expectDialogSelectedProduct(dialog, secondName);
    await expect(dialog).toBeVisible();
    await expect(clientInput).toHaveValue(originalClientText);

    await expect.poll(async () => {
      const values = await dialog.locator('input').evaluateAll((nodes) =>
        nodes.map((node) => String(node.value || '').toUpperCase())
      );
      return [firstName, secondName].filter((name) =>
        values.some((value) => value.includes(String(name).toUpperCase()))
      ).length;
    }, {
      timeout: 25_000,
      intervals: [100, 250, 500, 1_000],
      message: 'Dos lecturas consecutivas deben terminar seleccionando dos productos distintos.',
    }).toBe(2);

    // Nueva Venta no tiene botón “Cancelar”; el cierre seguro del modal es la
    // X del encabezado (aria-label="Cerrar"). Llegar hasta acá ya confirma que
    // el doble terminador no envió el formulario ni cerró el modal por error.
    await dialog.getByRole('button', { name: /^Cerrar$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  } finally {
    await deleteUnusedStockProduct(page, firstName).catch(() => null);
    await deleteUnusedStockProduct(page, secondName).catch(() => null);
  }
});
