import { expect } from '@playwright/test';
import {
  clickSaveAndWait,
  completeRemainingAmount,
  fillMovementRow,
  fillPayment,
  searchRow,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  selectSafePaymentMethod,
  selectMovementMode,
  selectProduct,
  waitDialog,
  waitForBusyToFinish,
} from './ui.js';

function requestJsonBody(request) {
  try {
    const value = request.postDataJSON();
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function isOtherIncomeCreditOperation(request, operation) {
  const url = new URL(request.url());
  const action = String(url.searchParams.get('action') || '').toLowerCase();
  const expectedOperation = `nota_credito_${operation}`;
  if (action === `otros_ingresos_nota_credito_${operation}`) return true;
  const aliasAction = operation === 'contexto' ? 'otros_ingresos_obtener' : 'otros_ingresos_actualizar';
  if (action !== aliasAction) return false;
  const body = requestJsonBody(request);
  const declared = String(
    url.searchParams.get('operacion') ||
    body.operacion || body.operacion_interna || body.modo_operacion || '',
  ).toLowerCase();
  return declared === expectedOperation;
}

export async function createStockProduct(page, product) {
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Agregar producto/i }).first().click();

  const dialog = await waitDialog(page, 'Productos');
  await dialog.locator('input[name="nombre"]').fill(product.name);
  await dialog.locator('input[name="sku"]').fill(product.sku);
  await dialog.locator('input[name="stock"]').fill(String(product.stock ?? 10));
  await dialog.locator('input[name="precio_costo"]').fill(String(product.cost ?? 100));
  await dialog.locator('input[name="precio_costo"]').blur();
  await dialog.locator('input[name="precio"]').fill(String(product.price ?? 150));
  await dialog.locator('input[name="precio"]').blur();

  // En corridas remotas largas Hostinger puede devolver un 500 transitorio
  // mientras rota conexiones/sesiones. Reintentamos únicamente 5xx/429/408.
  // Si el primer intento llegó a persistir pero falló la respuesta, el segundo
  // puede responder duplicado: en ese caso verificamos por el SKU único antes
  // de considerar fallida el alta. Un error funcional 4xx normal NO se oculta.
  const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
  let createResponse = null;
  let createBody = {};
  let maybePersisted = false;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).searchParams.get('action') === 'stock_productos_crear',
      { timeout: 120_000 },
    );
    const saveButton = dialog.getByRole('button', { name: /Guardar producto/i }).last();
    await expect(saveButton).toBeEnabled({ timeout: 30_000 });
    await saveButton.click();

    createResponse = await createResponsePromise;
    createBody = await createResponse.json().catch(() => ({}));
    const status = createResponse.status();

    if (status < 400 && createBody?.exito !== false && createBody?.success !== false) {
      break;
    }

    if (attempt > 1 && status === 409 && /SKU|DUPLIC|EXIST/i.test(String(createBody?.mensaje || createBody?.message || ''))) {
      maybePersisted = true;
      break;
    }

    if (!transientStatuses.has(status) || attempt === 3) {
      expect(
        status,
        `El alta de ${product.name} respondió HTTP ${status}: ${JSON.stringify(createBody)}`,
      ).toBeLessThan(400);
      expect(
        createBody?.exito !== false && createBody?.success !== false,
        createBody?.mensaje || createBody?.message || `No se pudo crear ${product.name}`,
      ).toBeTruthy();
    }

    await page.waitForTimeout(Math.min(6_000, 1_500 * (2 ** (attempt - 1))));
  }

  if (!maybePersisted) {
    expect(
      createResponse?.status() || 0,
      `El alta de ${product.name} respondió HTTP ${createResponse?.status() || 0}: ${JSON.stringify(createBody)}`,
    ).toBeLessThan(400);
    expect(
      createBody?.exito !== false && createBody?.success !== false,
      createBody?.mensaje || createBody?.message || `No se pudo crear ${product.name}`,
    ).toBeTruthy();
    await expect(dialog).toBeHidden({ timeout: 120_000 });
  }

  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, product.sku, /Buscar por nombre, SKU o variante/i);
  await expect(row).toContainText(product.name);
  await expect(row).toContainText(product.sku);
  return row;
}

export async function editStockProduct(page, productName, updates) {
  const row = await searchRow(page, productName, /Buscar por nombre, SKU o variante/i);
  await row.getByTitle('Editar').click();
  const dialog = await waitDialog(page, 'Editar producto');

  if (updates.name) await dialog.locator('input[name="nombre"]').fill(updates.name);
  if (updates.stock !== undefined) await dialog.locator('input[name="stock"]').fill(String(updates.stock));
  if (updates.price !== undefined) {
    await dialog.locator('input[name="precio"]').fill(String(updates.price));
    await dialog.locator('input[name="precio"]').blur();
  }

  const updateResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'stock_productos_actualizar',
    { timeout: 120_000 },
  );
  await clickSaveAndWait(dialog, /Guardar cambios/i, { timeout: 90_000 });

  const updateResponse = await updateResponsePromise;
  const updateBody = await updateResponse.json().catch(() => ({}));
  expect(
    updateResponse.status(),
    `La edición de ${productName} respondió HTTP ${updateResponse.status()}: ${JSON.stringify(updateBody)}`,
  ).toBeLessThan(400);
  expect(
    updateBody?.exito !== false && updateBody?.success !== false,
    updateBody?.mensaje || updateBody?.message || `No se pudo editar ${productName}`,
  ).toBeTruthy();

  // La búsqueda inmediata puede competir con el refresco automático que dispara
  // el modal de Stock y dejar la grilla mostrando skeletons pese a que la API ya
  // devolvió el producto editado. Recargar después de confirmar la respuesta
  // elimina esa carrera y verifica el estado persistido, no el estado optimista.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);
  return searchRow(page, updates.name || productName, /Buscar por nombre, SKU o variante/i);
}

function requestAction(request) {
  const actionFromUrl = new URL(request.url()).searchParams.get('action');
  if (actionFromUrl) return actionFromUrl;

  try {
    const body = request.postDataJSON();
    if (body && typeof body.action === 'string') return body.action;
  } catch {
    // Puede ser application/x-www-form-urlencoded o multipart/form-data.
  }

  const rawBody = request.postData() || '';
  const match = rawBody.match(/(?:^|[&\r\n])action(?:=|%3D)([^&\r\n]+)/i);
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
}

export async function deleteUnusedStockProduct(page, productName) {
  // Cada prueba crea un producto temporal y lo elimina al final. El modal de
  // confirmación se cierra apenas comienza el request, no cuando termina el
  // DELETE en la base. Esperar solo el cierre del modal generaba una carrera:
  // la prueba buscaba el producto mientras la eliminación todavía seguía en curso.
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);

  const row = await searchRow(page, productName, /Buscar por nombre, SKU o variante/i);
  const productId = Number(await row.getAttribute('data-stock-product-id'));
  expect(productId, `La fila de ${productName} debe exponer su ID real`).toBeGreaterThan(0);

  const deleteButton = row.getByTitle('Eliminar producto definitivamente');
  await expect(deleteButton, `Debe existir la acción de eliminar para ${productName}`).toBeVisible({ timeout: 20_000 });
  await deleteButton.click();

  const first = await waitDialog(page, 'Eliminar producto definitivamente');
  const continueButton = first.getByRole('button', { name: /Eliminar/i }).last();
  await expect(continueButton).toBeEnabled({ timeout: 20_000 });
  await continueButton.click();

  const finalDialog = await waitDialog(page, 'Confirmación final');
  const confirmButton = finalDialog.getByRole('button', { name: /Sí, eliminar para siempre/i }).last();
  await expect(confirmButton).toBeEnabled({ timeout: 20_000 });

  const deleteResponsePromise = page.waitForResponse(
    (response) => {
      const request = response.request();
      if (request.method() !== 'POST') return false;
      return [
        'stock_producto_eliminar_permanente',
        'stock_productos_eliminar_permanente',
      ].includes(requestAction(request));
    },
    { timeout: 120_000 },
  );

  await confirmButton.click();
  await expect(finalDialog).toBeHidden({ timeout: 20_000 });

  const deleteResponse = await deleteResponsePromise;
  expect(
    deleteResponse.ok(),
    `La eliminación definitiva de ${productName} respondió HTTP ${deleteResponse.status()}`,
  ).toBeTruthy();

  const deletePayload = await deleteResponse.json().catch(() => null);
  expect(
    deletePayload?.exito === true || deletePayload?.success === true,
    deletePayload?.mensaje || `El backend no confirmó la eliminación definitiva de ${productName}`,
  ).toBeTruthy();

  const deleteData = deletePayload?.data || deletePayload || {};
  const deletedProductId = Number(
    deletePayload?.id_stock_producto ?? deleteData?.id_stock_producto ?? 0,
  );
  expect(
    deletedProductId,
    `El backend debe confirmar el ID eliminado de ${productName}`,
  ).toBe(productId);
  expect(
    deletePayload?.eliminado_permanente === true || deleteData?.eliminado_permanente === true,
    `El backend respondió, pero no confirmó la eliminación permanente de ${productName}`,
  ).toBeTruthy();

  const deleteDb = deletePayload?.db || deleteData?.db || {};
  expect(
    Number(deleteDb?.producto_eliminado ?? 0),
    `La transacción no informó la eliminación física de ${productName}`,
  ).toBe(1);

  // La respuesta anterior confirma que la transacción terminó. Una recarga evita
  // validar contra la fila React que estaba renderizada antes del COMMIT.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);

  // Selector estructural estable: el placeholder ahora también menciona código
  // de barra y no debe convertir una eliminación correcta en un falso fallo.
  const search = page.locator('.stock-page .cc-filter--search input').first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(productName);
  await search.press('Enter');
  await page.waitForTimeout(450);
  await waitForBusyToFinish(page);

  await expect(
    page.locator(`.mov-gridTable--row:visible:not(.mov-row--skeleton)[data-stock-product-id="${productId}"]`),
    `El producto ${productName} no debe seguir visible después de la eliminación confirmada por el backend`,
  ).toHaveCount(0, { timeout: 30_000 });
}

export async function createPurchase(page, data) {
  await page.goto('/panel/compras');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nueva compra').click();
  const dialog = await waitDialog(page, 'Nueva Compra');

  await fillMovementRow(dialog, {
    productName: data.productName,
    quantity: data.quantity ?? 2,
    price: data.price ?? 100,
  });
  const requestedProvider = String(data.providerName || data.providerSearch || '').trim();
  data.providerName = await selectFirstAutocomplete(dialog, 'Proveedor', requestedProvider);
  const mode = await selectMovementMode(dialog, 'Forma de compra', /CUENTA\s*CORRIENTE/i);
  if (/CONTADO/i.test(mode.text)) await fillPayment(dialog);

  await clickSaveAndWait(dialog, /Guardar compra/i, { timeout: 60_000 });

  // La fila de Compras no siempre imprime el nombre completo del producto. En una
  // suite larga puede seguir visible una respuesta anterior y searchRow() terminar
  // devolviendo esa primera fila. Rebuscamos por backend y cruzamos con el ID real
  // del movimiento para devolver exactamente la compra recién creada.
  return searchPurchaseRowStrict(page, data.productName);
}

export async function editPurchaseQuantity(page, productName, quantity) {
  const row = await searchRow(page, productName, /Buscar por descripción, proveedor/i);
  await row.getByTitle('Editar').click();
  const dialog = await waitDialog(page, 'Editar compra');
  const itemRow = dialog.locator('.gm-table-body .gm-table-row').first();
  const qty = itemRow.locator('input[type="number"]').first();
  await qty.fill(String(quantity));
  await qty.blur();

  const editActions = [];
  const captureEditRequest = (request) => {
    if (request.method() !== 'POST') return;
    const action = new URL(request.url()).searchParams.get('action');
    if (['compras_editar', 'compras_actualizar', 'movimientos_editar'].includes(action)) {
      editActions.push(action);
    }
  };
  page.on('request', captureEditRequest);

  try {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).searchParams.get('action') === 'compras_editar',
      { timeout: 60_000 },
    );

    await clickSaveAndWait(dialog, /Guardar cambios/i, { timeout: 60_000 });
    const response = await responsePromise;
    const body = await response.json().catch(() => ({}));

    expect(
      response.status(),
      `Editar compra respondió HTTP ${response.status()}: ${JSON.stringify(body)}`,
    ).toBeLessThan(400);
    expect(
      body?.exito !== false && body?.success !== false,
      body?.mensaje || body?.message || 'No se pudo editar la compra',
    ).toBeTruthy();
    expect(
      editActions,
      'La edición debe usar sólo compras_editar y nunca caer en aliases que oculten un 422 con un 404',
    ).toEqual(['compras_editar']);
  } finally {
    page.off('request', captureEditRequest);
  }

  return searchRow(page, productName, /Buscar por descripción, proveedor/i);
}

export async function openPurchaseCreditNote(page, productName) {
  // Compras renderiza el detalle del producto fuera de las celdas visibles. Si una
  // respuesta sin filtro termina después de la búsqueda, `searchRow()` puede caer
  // en la primera fila de esa respuesta vieja. Cruzamos siempre con el ID exacto
  // que devuelve `compras_listar?q=...` para no aplicar una NC a otra compra.
  const row = await searchPurchaseRowStrict(page, productName);
  await row.getByTitle(/Aplicar nota de crédito/i).click();
  const dialog = await waitDialog(page, 'Aplicar nota de crédito del proveedor');
  return { row, dialog };
}

export async function configurePurchaseCreditNote(dialog, options = {}) {
  const normalized = typeof options === 'number' ? { quantity: options } : options;
  const motive = normalized.motive || 'DEVOLUCION_MERCADERIA';

  const motiveSelect = dialog
    .locator('.gm-field')
    .filter({ hasText: /Motivo/i })
    .locator('select')
    .first();
  await expect(motiveSelect).toBeVisible();
  await motiveSelect.selectOption(motive);

  if (['DESCUENTO', 'BONIFICACION', 'DIFERENCIA_PRECIO', 'OTRO'].includes(motive)) {
    const amount = dialog
      .locator('.gm-field')
      .filter({ hasText: /Importe final/i })
      .locator('input[type="number"]')
      .first();
    await expect(amount).toBeVisible();
    await amount.fill(String(normalized.amount ?? 10));

    const ivaSelect = dialog
      .locator('.gm-field')
      .filter({ hasText: /IVA % incluido/i })
      .locator('select')
      .first();
    await expect(ivaSelect).toBeVisible();
    await ivaSelect.selectOption(String(normalized.ivaPct ?? 21));
  } else if (motive !== 'ANULACION_TOTAL') {
    const qty = dialog.locator('.ncp-quantity-input, table tbody input[type="number"]').first();
    await expect(qty).toBeVisible();
    await qty.fill(String(normalized.quantity ?? 1));
  }

  return { motiveSelect };
}

export async function applyPurchaseCreditNote(page, productName, options = 1) {
  const { dialog } = await openPurchaseCreditNote(page, productName);
  await configurePurchaseCreditNote(dialog, options);
  await clickSaveAndWait(dialog, /Aplicar nota de crédito/i, { timeout: 60_000 });
  return searchRow(page, productName, /Buscar por descripción, proveedor/i);
}

export async function applyPurchaseCreditNoteAndCapture(page, productName, options = {}) {
  const { dialog } = await openPurchaseCreditNote(page, productName);
  await configurePurchaseCreditNote(dialog, options);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'compras_nota_credito_crear',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /Aplicar nota de crédito/i }).last().click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  return { response, body };
}

export async function createSale(page, data) {
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const dialog = await waitDialog(page, 'Nueva Venta');

  await fillMovementRow(dialog, {
    productName: data.productName,
    quantity: data.quantity ?? 2,
    price: data.price ?? 150,
  });
  const requestedClient = String(data.clientName || data.clientSearch || '').trim();
  data.clientName = await selectFirstAutocomplete(dialog, 'Cliente', requestedClient);

  const typeField = dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first();
  const typeSelect = typeField.locator('select');
  const selected = await selectFirstNonEmpty(typeSelect, /CUENTA\s*CORRIENTE/i);
  if (/CONTADO/i.test(selected.text)) await fillPayment(dialog);

  await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 60_000 });
  return searchRow(page, data.productName, /Buscar por descripción, cliente/i);
}

export async function openSaleCreditNote(page, productName) {
  const row = await searchRow(page, productName, /Buscar por descripción, cliente/i);
  await row.getByTitle('Emitir nota de crédito').click();
  const dialog = await waitDialog(page, 'Nota de crédito');
  return { row, dialog };
}

export async function configureSaleCreditNote(dialog, options = {}) {
  const normalized = typeof options === 'number' ? { quantity: options } : options;
  const motive = normalized.motive || 'DEVOLUCION_MERCADERIA';

  const motiveSelect = dialog
    .locator('.gm-field')
    .filter({ hasText: /Motivo/i })
    .locator('select')
    .first();
  await expect(motiveSelect).toBeVisible();
  await motiveSelect.selectOption(motive);

  if (['DESCUENTO', 'BONIFICACION', 'DIFERENCIA_PRECIO', 'OTRO'].includes(motive)) {
    const amount = dialog
      .locator('.gm-field')
      .filter({ hasText: /Importe total/i })
      .locator('input[type="number"]')
      .first();
    await expect(amount).toBeVisible();
    await amount.fill(String(normalized.amount ?? 10));

    const ivaSelect = dialog
      .locator('.gm-field')
      .filter({ hasText: /IVA % incluido/i })
      .locator('select')
      .first();
    await expect(ivaSelect).toBeVisible();
    await ivaSelect.selectOption(String(normalized.ivaPct ?? 21));
  } else if (motive !== 'ANULACION_TOTAL') {
    const qty = dialog.locator('input[aria-label^="Cantidad a acreditar"]').first();
    await expect(qty).toBeVisible({ timeout: 20_000 });
    await qty.fill(String(normalized.quantity ?? 1));
    const stockCheck = dialog.locator('input[aria-label^="Reingresar"]').first();
    if (await stockCheck.isVisible().catch(() => false)) {
      if (!(await stockCheck.isChecked())) await stockCheck.check();
    }
  }

  return { motiveSelect };
}

export async function applySaleCreditNote(page, productName, options = 1) {
  const { dialog } = await openSaleCreditNote(page, productName);
  await configureSaleCreditNote(dialog, options);
  await clickSaveAndWait(dialog, /Aplicar nota de crédito/i, { timeout: 60_000 });
  return searchRow(page, productName, /Buscar por descripción, cliente/i);
}

export async function applySaleCreditNoteAndCapture(page, productName, options = {}) {
  const { dialog } = await openSaleCreditNote(page, productName);
  await configureSaleCreditNote(dialog, options);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'ventas_nota_credito_crear',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /Aplicar nota de crédito/i }).last().click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  return { response, body };
}

function purchaseContainsProduct(row, productName) {
  const expected = String(productName || '').trim().toUpperCase();
  if (!expected) return false;

  const originalItems = Array.isArray(row?.items_detalle_original) ? row.items_detalle_original : [];
  const currentItems = Array.isArray(row?.items_detalle) ? row.items_detalle : [];
  const values = [
    row?.detalle,
    row?.descripcion,
    ...originalItems.flatMap((item) => [
      item?.nombre,
      item?.descripcion,
      item?.detalle,
      item?.producto_nombre,
      item?.stock_producto_nombre,
    ]),
    ...currentItems.flatMap((item) => [
      item?.nombre,
      item?.descripcion,
      item?.detalle,
      item?.producto_nombre,
      item?.stock_producto_nombre,
    ]),
  ];

  return values.some((value) => String(value ?? '').trim().toUpperCase().includes(expected));
}

async function ensurePurchasePanelReady(page) {
  const search = page.getByPlaceholder(/Buscar por descripción, proveedor/i).first();

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.goto('/panel/compras', { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page).catch(() => null);
    if (await search.isVisible().catch(() => false)) return search;

    const sessionError = page.getByRole('heading', { name: /No se pudo validar la sesión/i });
    if (!(await sessionError.isVisible().catch(() => false))) {
      await expect(search).toBeVisible({ timeout: 5_000 });
      return search;
    }

    // No reinterpretamos un 500 como éxito: sólo damos tiempo a que el backend
    // remoto se recupere. Si tras cinco intentos sigue en error, el test falla.
    if (attempt < 5) {
      await page.waitForTimeout(Math.min(8_000, 1_500 * (2 ** (attempt - 1))));
    }
  }

  await expect(search).toBeVisible({ timeout: 10_000 });
  return search;
}

async function searchPurchaseRowStrict(page, productName) {
  // La grilla resume los ítems como "1 PRODUCTO", por lo que buscar una fila
  // sólo por su texto visible puede devolver la primera respuesta anterior. Se
  // fuerza una consulta nueva y se cruza el resultado con el ID real del backend.
  const search = await ensurePurchasePanelReady(page);

  await page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key && key.includes(':compras:listar:cc-medios-v5:')) keys.push(key);
    }
    keys.forEach((key) => sessionStorage.removeItem(key));
  });

  const listResponsePromise = page.waitForResponse(
    (response) => {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return url.searchParams.get('action') === 'compras_listar'
        && url.searchParams.get('q') === productName;
    },
    { timeout: 60_000 },
  );

  await search.fill(productName);
  await search.press('Enter');

  const listResponse = await listResponsePromise;
  const listBody = await listResponse.json().catch(() => ({}));
  expect(
    listResponse.status(),
    `La búsqueda de la compra ${productName} respondió HTTP ${listResponse.status()}: ${JSON.stringify(listBody)}`,
  ).toBeLessThan(400);
  expect(
    listBody?.exito !== false && listBody?.success !== false,
    listBody?.mensaje || listBody?.message || `No se pudo buscar la compra ${productName}`,
  ).toBeTruthy();

  const purchases = Array.isArray(listBody?.compras)
    ? listBody.compras
    : Array.isArray(listBody?.data?.compras)
      ? listBody.data.compras
      : [];
  const purchase = purchases.find((row) => purchaseContainsProduct(row, productName));
  expect(
    purchase,
    `El backend no devolvió la compra exacta del producto ${productName}`,
  ).toBeTruthy();

  const movementId = Number(purchase?.id_movimiento ?? purchase?.id_compra ?? purchase?.id ?? 0);
  expect(movementId, `La compra de ${productName} debe exponer su ID real`).toBeGreaterThan(0);

  await waitForBusyToFinish(page);
  const row = page.locator(
    `.mov-gridTable--row:visible:not(.mov-row--skeleton)[data-movement-id="${movementId}"]`,
  );
  await expect(
    row,
    `La interfaz debe renderizar la compra #${movementId} correspondiente a ${productName}`,
  ).toBeVisible({ timeout: 30_000 });
  return row;
}


export async function deletePurchase(page, productName) {
  const row = await searchPurchaseRowStrict(page, productName);
  await row.getByTitle('Eliminar').click();
  const dialog = await waitDialog(page, /Eliminar compra(?: y notas de crédito)?/i);
  const deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST'
      && new URL(response.url()).searchParams.get('action') === 'compras_eliminar',
    { timeout: 90_000 },
  );
  await clickSaveAndWait(dialog, /Eliminar todo|^Eliminar$/i, { timeout: 90_000 });
  const deleteResponse = await deleteResponsePromise;
  const deleteBody = await deleteResponse.json().catch(() => ({}));
  expect(
    deleteResponse.status(),
    `La eliminación de la compra ${productName} respondió HTTP ${deleteResponse.status()}: ${JSON.stringify(deleteBody)}`,
  ).toBeLessThan(400);
  expect(
    deleteBody?.exito !== false && deleteBody?.success !== false,
    deleteBody?.mensaje || deleteBody?.message || `No se pudo eliminar la compra ${productName}`,
  ).toBeTruthy();
}

export async function deleteSale(page, productName) {
  const row = await searchRow(page, productName, /Buscar por descripción, cliente/i);
  await row.getByTitle('Eliminar').click();
  const dialog = page.getByRole('dialog').filter({ hasText: /Eliminar venta/i }).last();
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: /Eliminar todo|^Eliminar$/i }).last();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

export async function openMovementDetail(page, productName, kind) {
  const placeholder = kind === 'purchase'
    ? /Buscar por descripción, proveedor/i
    : /Buscar por descripción, cliente/i;
  const row = await searchRow(page, productName, placeholder);
  await row.getByTitle(/Ver información completa del movimiento/i).click();
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(productName);
  return dialog;
}

export async function prepareBudget(page, data) {
  await page.goto('/panel/presupuesto');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo presupuesto').click();
  const dialog = await waitDialog(page, 'Nuevo presupuesto');

  const itemRow = await fillMovementRow(dialog, {
    productName: data.productName,
    quantity: data.quantity ?? 1,
    price: data.price ?? 150,
  });

  const ivaSelect = itemRow.locator('select.gm-cell-input--select').first();
  await expect(ivaSelect).toBeVisible();
  await ivaSelect.selectOption(String(data.ivaPct ?? 0));

  const requestedClient = String(data.clientName || data.clientSearch || '').trim();
  data.clientName = await selectFirstAutocomplete(dialog, 'Cliente', requestedClient);
  return { dialog, itemRow, ivaSelect };
}

export async function createBudget(page, data) {
  const { dialog } = await prepareBudget(page, data);
  await clickSaveAndWait(dialog, /^Guardar$/i, { timeout: 60_000 });
  return searchRow(page, data.productName, /Buscar por descripción/i);
}

export async function prepareBudgetConversion(page, productName) {
  const row = await searchRow(page, productName, /Buscar por descripción/i);
  await row.getByTitle(/Asignar presupuesto como venta/i).click();
  const dialog = await waitDialog(page, 'Asignar como venta');

  const typeField = dialog.locator('.gm-field').filter({ hasText: 'Tipo de pago' }).first();
  const typeSelect = typeField.locator('select');
  const selected = await selectFirstNonEmpty(typeSelect, /CUENTA\s*CORRIENTE/i);
  if (/CONTADO/i.test(selected.text)) await fillPayment(dialog);

  const action = dialog.getByRole('button', { name: /Asignar como venta|Guardar venta|Confirmar/i }).last();
  await expect(action).toBeEnabled();
  return { row, dialog, action };
}

export async function convertBudgetToSale(page, productName) {
  const { row, dialog, action } = await prepareBudgetConversion(page, productName);
  await action.click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(row.getByTitle(/Presupuesto ya asignado como venta/i)).toBeVisible({ timeout: 20_000 });
}

export async function deleteBudget(page, productName) {
  const row = await searchRow(page, productName, /Buscar por descripción/i);
  await row.getByTitle('Eliminar').click();
  const dialog = await waitDialog(page, 'Eliminar presupuesto');
  await clickSaveAndWait(dialog, /Eliminar/i, { timeout: 45_000 });
}

export async function createCatalogDescription(dialog, description) {
  const page = dialog.page();
  let activeDialog = dialog;
  let row;
  let input;

  // En una suite larga el servidor de desarrollo puede recargar la SPA justo
  // después de abrir el modal. El input que Playwright ya había resuelto queda
  // detached y el modal desaparece, aunque Balto y su API sigan funcionando.
  // Reabrimos una sola vez únicamente cuando comprobamos esa navegación; los
  // errores normales del formulario continúan fallando sin ser ocultados.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    row = activeDialog.locator('.gm-table-body .gm-table-row').first();
    input = row.locator('input[placeholder*="descripción" i]').first();

    try {
      await expect(input).toBeVisible({ timeout: 15_000 });
      await input.click({ timeout: 15_000 });
      break;
    } catch (error) {
      const path = new URL(page.url()).pathname.toLowerCase();
      const isIncome = path.includes('/otrosingresos');
      const isExpense = path.includes('/otrosegresos');
      const modalDisappeared = !(await activeDialog.isVisible().catch(() => false));

      if (attempt > 0 || !modalDisappeared || (!isIncome && !isExpense)) {
        throw error;
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await waitForBusyToFinish(page);

      const trigger = page.getByTitle(isIncome ? 'Crear nuevo ingreso' : 'Crear nuevo egreso');
      await expect(trigger).toBeVisible({ timeout: 20_000 });
      await trigger.click();
      activeDialog = await waitDialog(page, isIncome ? 'Nuevo Ingreso' : 'Nuevo Egreso');
    }
  }

  const add = page.locator('#ga-portal-list .ga-item').filter({ hasText: /Agregar nueva descripción/i }).first();
  await expect(add).toBeVisible();
  await add.click();

  const mini = await waitDialog(page, 'Nueva descripción');
  await mini.locator('#nueva-descripcion-input').fill(description);
  await clickSaveAndWait(mini, /^Guardar$/i, { timeout: 30_000 });
  await expect(input).toHaveValue(new RegExp(description, 'i'));
  return row;
}

export async function createOtherIncome(page, data) {
  await page.goto('/panel/Otrosingresos');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo ingreso').click();
  const dialog = await waitDialog(page, 'Nuevo Ingreso');
  await expect(dialog.getByRole('button', { name: /^Guardar ingreso$/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Facturar$/i })).toBeVisible();
  const requestedClient = String(data.clientName || data.clientSearch || '').trim();
  data.clientName = await selectFirstAutocomplete(dialog, 'Cliente', requestedClient);

  let row;
  if (data.freeText) {
    row = dialog.locator('.gm-table-body .gm-table-row').first();
    const input = row.locator('input[placeholder*="descripción" i]').first();
    await expect(input).toBeVisible();
    await input.fill(data.description);
  } else {
    row = await createCatalogDescription(dialog, data.description);
  }
  const qty = row.locator('input[type="number"]').first();
  await qty.fill(String(data.quantity ?? 1));
  const price = row.locator('input[inputmode="decimal"]').first();
  await price.fill(String(data.amount ?? 100));
  await price.blur();
  await fillPayment(dialog);

  if (data.finalAction === 'facturar') {
    await dialog.getByRole('button', { name: /^Facturar$/i }).click();
    const invoiceDialog = page.getByRole('dialog').last();
    await expect(invoiceDialog).toBeVisible({ timeout: 60_000 });
    await expect(invoiceDialog).toContainText(/Resumen antes de emitir|Datos fiscales para facturar/i);
    return { invoiceDialog, incomeDialog: dialog };
  }

  await clickSaveAndWait(dialog, /Guardar ingreso/i, { timeout: 60_000 });
  return searchRow(page, data.description, /Buscar por descripción/i);
}

async function visibleDialog(page, title) {
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByText(title, { exact: false }) })
    .last();
  return (await dialog.isVisible().catch(() => false)) ? dialog : null;
}

export async function detectOtherIncomeInvoiceStep(page) {
  await expect
    .poll(async () => {
      const fiscal = await visibleDialog(page, /Datos fiscales para facturar/i);
      const summary = await visibleDialog(page, /Resumen antes de emitir/i);
      return fiscal ? 'fiscal' : summary ? 'summary' : '';
    }, {
      timeout: 60_000,
      message: 'Facturar debe abrir el modal fiscal por CUIT o el resumen global de facturación.',
    })
    .toMatch(/^(fiscal|summary)$/);

  const fiscalDialog = await visibleDialog(page, /Datos fiscales para facturar/i);
  if (fiscalDialog) return { kind: 'fiscal', dialog: fiscalDialog };
  return {
    kind: 'summary',
    dialog: await waitDialog(page, /Resumen antes de emitir/i),
  };
}

export async function expectOtherIncomeInvoiceSummary(dialog, data = {}) {
  await expect(dialog).toContainText(/Resumen antes de emitir/i);
  await expect(dialog).toContainText(/Cuenta fiscal emisora/i);
  await expect(dialog).toContainText(/Datos del cliente/i);
  await expect(dialog).toContainText(/Datos del emisor/i);
  await expect(dialog).toContainText(/Detalle/i);
  await expect(dialog).not.toContainText(/Buscar \/ completar cliente|Paso 1 de 3|Receptor del ingreso/i);

  if (data.clientName) await expect(dialog).toContainText(data.clientName);
  for (const item of data.items || []) await expect(dialog).toContainText(item);
}

export async function continueOtherIncomeInvoiceToSummary(page, step, options = {}) {
  if (step.kind === 'summary') return step.dialog;

  const fiscalDialog = step.dialog;
  await expect(fiscalDialog).toContainText(/Datos fiscales para facturar/i);
  await expect(fiscalDialog).toContainText(/Factura por CUIT/i);
  await expect(fiscalDialog).toContainText(/Consulta ARCA/i);
  const cuit = String(options.cuit || '').replace(/\D/g, '');
  expect(cuit, 'PW_ARCA_CLIENT_CUIT debe tener 11 dígitos si el cliente no posee ficha fiscal.').toHaveLength(11);

  const cuitInput = fiscalDialog.locator('input[inputmode="numeric"]').first();
  await expect(cuitInput).toBeVisible();
  await cuitInput.fill(cuit);

  const lookupResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).searchParams.get('action') === 'padron_cuit',
    { timeout: 120_000 },
  );
  await fiscalDialog.getByRole('button', { name: /Consultar ARCA/i }).click();
  const lookupResponse = await lookupResponsePromise;
  expect(lookupResponse.status(), 'La consulta de CUIT en ARCA debe responder correctamente.').toBeLessThan(400);
  await expect(fiscalDialog).toContainText(/Datos encontrados y listos para confirmar/i, { timeout: 120_000 });

  await fiscalDialog.getByRole('button', { name: /Confirmar y facturar/i }).click();
  await expect(fiscalDialog).toBeHidden({ timeout: 120_000 });
  const summary = await waitDialog(page, /Resumen antes de emitir/i);
  await expectOtherIncomeInvoiceSummary(summary, options);
  return summary;
}

function expectSuccessfulJsonResponse(response, body, label) {
  expect(
    response.status(),
    `${label} respondió HTTP ${response.status()}: ${JSON.stringify(body)}`,
  ).toBeLessThan(400);
  expect(
    body?.exito !== false && body?.success !== false,
    body?.mensaje || body?.message || `${label} no fue confirmada por el backend.`,
  ).toBeTruthy();
}

export async function emitOtherIncomeInvoice(page, summaryDialog, description) {
  await expectOtherIncomeInvoiceSummary(summaryDialog, { items: [description] });
  const confirmation = summaryDialog.locator('.mfr-check__input').first();
  await expect(confirmation).toBeVisible();
  if (!(await confirmation.isChecked())) await confirmation.check();

  const arcaPromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'wsfe_emitir',
    { timeout: 180_000 },
  );
  const createPromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'otros_ingresos_crear',
    { timeout: 180_000 },
  );
  const linkPromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'otros_ingresos_comprobantes_vincular_movimiento',
    { timeout: 180_000 },
  );

  await summaryDialog.getByRole('button', { name: /Emitir \+ facturar/i }).click();
  const [arcaResponse, createResponse, linkResponse] = await Promise.all([
    arcaPromise,
    createPromise,
    linkPromise,
  ]);
  const [arcaBody, createBody, linkBody] = await Promise.all([
    arcaResponse.json().catch(() => ({})),
    createResponse.json().catch(() => ({})),
    linkResponse.json().catch(() => ({})),
  ]);
  expectSuccessfulJsonResponse(arcaResponse, arcaBody, 'La emisión ARCA');
  expect(
    arcaBody?.cae || arcaBody?.data?.cae || arcaBody?.factura?.cae || arcaBody?.data?.factura?.cae,
    'ARCA debe devolver un CAE.',
  ).toBeTruthy();
  expectSuccessfulJsonResponse(createResponse, createBody, 'El alta del ingreso facturado');
  expectSuccessfulJsonResponse(linkResponse, linkBody, 'La vinculación de la factura');
  await expect(summaryDialog).toBeHidden({ timeout: 180_000 });

  const row = await searchRow(page, description, /Buscar por descripción/i);
  await expect(row.getByTitle('Editar')).toHaveCount(0);
  await expect(row.getByTitle(/Facturar ingreso/i)).toHaveCount(0);
  await expect(row.getByTitle('Ver comprobante')).toBeEnabled();
  return { row, arcaBody, createBody, linkBody };
}

export async function openOtherIncomeDetail(page, query) {
  const row = await searchRow(page, query, /Buscar por descripción/i);
  await row.getByTitle(/Ver información completa del movimiento/i).click();
  const dialog = await waitDialog(page, /Detalle de ingreso/i);
  await expect(dialog).toContainText(query);
  return { row, dialog };
}

export async function expectOtherIncomeCreditTrace(page, query, expected = {}) {
  const { row, dialog } = await openOtherIncomeDetail(page, query);
  await expect(dialog).toContainText(/Ingreso ajustado por nota de crédito/i);
  await expect(dialog.getByText(/Estado documental/i).first()).toBeVisible();
  await expect(dialog.getByText(/Ajustada por nota de crédito/i).first()).toBeVisible();

  const trace = dialog.getByRole('note', { name: /Trazabilidad de notas de crédito/i });
  await expect(trace).toBeVisible();
  await trace.getByTitle(/Ver detalle de la nota de crédito/i).click();
  await expect(trace).toContainText(/Importe original/i);
  await expect(trace).toContainText(/Total acreditado/i);
  await expect(trace).toContainText(/Valor vigente/i);
  await expect(trace).toContainText(/Nota de crédito/i);
  if (expected.item) await expect(trace).toContainText(expected.item);

  await dialog.getByRole('button', { name: /Cerrar/i }).last().click();
  await expect(dialog).toBeHidden();
  return row;
}

export async function deleteFiscalOtherIncomeThroughTotalCreditNote(page, query) {
  const row = await searchRow(page, query, /Buscar por descripción/i);
  await row.getByTitle('Eliminar').click();

  const blockedDialog = await waitDialog(page, /No se puede eliminar todavía/i);
  await expect(blockedDialog).toContainText(/factura emitida en ARCA/i);
  await expect(blockedDialog).toContainText(/nota de crédito por todo el saldo/i);
  await expect(blockedDialog.getByRole('button', { name: /^Eliminar$/i })).toBeDisabled();
  await blockedDialog.getByRole('button', { name: /Emitir nota de crédito/i }).click();
  await expect(blockedDialog).toBeHidden();

  const creditDialog = await waitDialog(page, /Nota de crédito de ingreso|Emitir nota de crédito/i);
  await expect(creditDialog).toContainText(/Ingreso facturado en ARCA/i, { timeout: 90_000 });
  await expect(creditDialog).toContainText(/ANULACIÓN TOTAL/i);
  const continueButton = creditDialog.getByRole('button', { name: /^Emitir nota de crédito$/i }).last();
  await expect(continueButton).toBeEnabled({ timeout: 90_000 });
  await continueButton.click();

  const summary = await waitDialog(page, /Resumen antes de emitir nota de crédito/i);
  await expect(summary).toContainText(/Resumen de nota de crédito/i);
  const confirmation = summary.locator('.mfr-check__input').first();
  await expect(confirmation).toBeVisible();
  if (!(await confirmation.isChecked())) await confirmation.check();

  const arcaPromise = page.waitForResponse(
    (response) => response.request().method() === 'POST'
      && new URL(response.url()).searchParams.get('action') === 'wsfe_emitir',
    { timeout: 180_000 },
  );
  const applyPromise = page.waitForResponse(
    (response) => response.request().method() === 'POST'
      && isOtherIncomeCreditOperation(response.request(), 'aplicar'),
    { timeout: 180_000 },
  );
  await summary.getByRole('button', { name: /Emitir \+ facturar/i }).click();
  const [arcaResponse, applyResponse] = await Promise.all([arcaPromise, applyPromise]);
  const [arcaBody, applyBody] = await Promise.all([
    arcaResponse.json().catch(() => ({})),
    applyResponse.json().catch(() => ({})),
  ]);
  expectSuccessfulJsonResponse(arcaResponse, arcaBody, 'La nota de crédito ARCA');
  expect(
    arcaBody?.cae || arcaBody?.data?.cae || arcaBody?.factura?.cae || arcaBody?.data?.factura?.cae,
    'La nota de crédito ARCA debe devolver CAE.',
  ).toBeTruthy();
  expectSuccessfulJsonResponse(applyResponse, applyBody, 'La aplicación de la nota de crédito total');
  await expect(summary).toBeHidden({ timeout: 180_000 });

  const finalDelete = await waitDialog(page, /Eliminar ingreso anulado/i);
  await expect(finalDelete.getByRole('button', { name: /^Eliminar$/i })).toBeEnabled();
  const deletePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST'
      && new URL(response.url()).searchParams.get('action') === 'otros_ingresos_eliminar',
    { timeout: 120_000 },
  );
  await finalDelete.getByRole('button', { name: /^Eliminar$/i }).click();
  const deleteResponse = await deletePromise;
  const deleteBody = await deleteResponse.json().catch(() => ({}));
  expectSuccessfulJsonResponse(deleteResponse, deleteBody, 'La eliminación del ingreso fiscal anulado');
  await expect(finalDelete).toBeHidden({ timeout: 120_000 });

  const search = page.getByPlaceholder(/Buscar por descripción/i).first();
  await search.fill(query);
  await search.press('Enter');
  await waitForBusyToFinish(page);
  await expect(page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: query })).toHaveCount(0);
}

export async function createOtherIncomeWithProduct(page, data) {
  await page.goto('/panel/Otrosingresos');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo ingreso').click();
  const dialog = await waitDialog(page, 'Nuevo Ingreso');
  const requestedClient = String(data.clientName || data.clientSearch || '').trim();
  data.clientName = await selectFirstAutocomplete(dialog, 'Cliente', requestedClient);

  const row = dialog.locator('.gm-table-body .gm-table-row').first();
  await dialog.getByLabel('Tipo de ítem fila 1').selectOption('producto');
  await selectProduct(row, data.productName);
  await row.locator('input[type="number"]').first().fill(String(data.quantity ?? 1));

  if (data.price !== undefined) {
    const price = row.locator('input[inputmode="decimal"]').first();
    await price.fill(String(data.price));
    await price.blur();
  }

  await fillPayment(dialog);
  await clickSaveAndWait(dialog, /Guardar ingreso/i, { timeout: 60_000 });
  return searchRow(page, data.productName, /Buscar por descripción/i);
}

export async function openOtherIncomeCreditNote(page, query) {
  const row = await searchRow(page, query, /Buscar por descripción/i);
  await row.getByTitle('Emitir nota de crédito').click();
  const dialog = await waitDialog(page, 'Nota de crédito de ingreso');
  return { row, dialog };
}

export async function configureOtherIncomeCreditNote(dialog, options = {}) {
  const normalized = typeof options === 'number' ? { quantity: options } : options;
  const motive = normalized.motive || 'DEVOLUCION_MERCADERIA';

  // El modal de ingresos reutiliza el componente de NC de Ventas, pero se
  // renderiza en un portal y primero carga el contexto del movimiento. Buscar
  // el selector por sus opciones evita depender de wrappers/clases de layout.
  const motiveSelect = dialog
    .locator(`select:has(option[value="${motive}"])`)
    .first();
  await expect(motiveSelect).toBeVisible({ timeout: 30_000 });
  await motiveSelect.selectOption(motive);
  await expect(motiveSelect).toHaveValue(motive);

  if (['DESCUENTO', 'BONIFICACION', 'DIFERENCIA_PRECIO', 'OTRO'].includes(motive)) {
    const adjustment = dialog.locator('.ncv-form-grid--adjustment').first();
    await expect(adjustment).toBeVisible({ timeout: 20_000 });

    const amount = adjustment.locator('input[type="number"]').first();
    await expect(amount).toBeVisible();
    await amount.fill(String(normalized.amount ?? 10));

    const ivaSelect = adjustment.locator('select').first();
    await expect(ivaSelect).toBeVisible();
    await ivaSelect.selectOption(String(normalized.ivaPct ?? 21));
  } else if (motive !== 'ANULACION_TOTAL') {
    const qty = dialog.locator('input[aria-label^="Cantidad a acreditar"]').first();
    await expect(qty).toBeVisible({ timeout: 20_000 });
    await qty.fill(String(normalized.quantity ?? 1));

    const stockCheck = dialog.locator('input[aria-label^="Reingresar"]').first();
    if (await stockCheck.isVisible().catch(() => false)) {
      if (!(await stockCheck.isChecked())) await stockCheck.check();
      await expect(stockCheck).toBeChecked();
    }
  }

  return { motiveSelect };
}

export async function applyOtherIncomeCreditNote(page, query, options = 1) {
  const { dialog } = await openOtherIncomeCreditNote(page, query);
  await configureOtherIncomeCreditNote(dialog, options);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      isOtherIncomeCreditOperation(response.request(), 'crear'),
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /Aplicar nota de crédito/i }).last().click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  return { response, body };
}

export async function createOtherExpense(page, data) {
  await page.goto('/panel/Otrosegresos');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo egreso').click();
  const dialog = await waitDialog(page, 'Nuevo Egreso');
  const row = await createCatalogDescription(dialog, data.description);
  const qty = row.locator('input[type="number"]').first();
  await qty.fill(String(data.quantity ?? 1));
  const price = row.locator('input[inputmode="decimal"]').first();
  await price.fill(String(data.amount ?? 100));
  await price.blur();

  const classification = dialog.locator('.gm-field').filter({ hasText: 'Clasificación' }).locator('select');
  await selectFirstNonEmpty(classification);
  await fillPayment(dialog);
  await clickSaveAndWait(dialog, /Guardar egreso/i, { timeout: 60_000 });
  return searchRow(page, data.description, /Buscar por descripción/i);
}

export async function editOtherMovement(page, kind, query, newAmount) {
  const placeholder = /Buscar por descripción/i;
  const row = await searchRow(page, query, placeholder);
  await row.getByTitle('Editar').click();
  const title = kind === 'income' ? 'Editar ingreso' : 'Editar egreso';
  const dialog = await waitDialog(page, title);
  const price = dialog.locator('.gm-table-body .gm-table-row input[inputmode="decimal"]').first();
  await price.fill(String(newAmount));
  await price.blur();
  await completeRemainingAmount(dialog);
  await clickSaveAndWait(dialog, /Guardar cambios/i, { timeout: 60_000 });
  return searchRow(page, query, placeholder);
}

export async function deleteOtherMovement(page, kind, query) {
  const row = await searchRow(page, query, /Buscar por descripción/i);
  await row.getByTitle('Eliminar').click();
  const dialog = await waitDialog(page, kind === 'income' ? 'Eliminar ingreso' : 'Eliminar egreso');
  await clickSaveAndWait(dialog, /Eliminar/i, { timeout: 60_000 });
}

export async function payReceivable(page, productName) {
  await page.goto('/panel/recibos');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, productName, /Buscar por descripción, cliente/i);
  const movementId = await row.getAttribute('data-movement-id');
  if (!movementId) throw new Error('La fila del recibo no expone data-movement-id.');

  await row.getByTitle('Cobrar').click();
  const dialog = await waitDialog(page, 'Pagar recibo');

  // No esperamos una request concreta: en una corrida larga algunas respuestas
  // pueden haber terminado antes de registrar el listener. En cambio, preparamos
  // el modal de forma idempotente y sólo seguimos cuando selección, medio, monto
  // y botón de confirmación sobreviven juntos a los re-renders de React.
  await expect(async () => {
    const debtRow = dialog.locator(`.gm-receipt-row[data-movement-id="${movementId}"]`).first();
    await expect(debtRow).toBeVisible({ timeout: 5_000 });

    const method = dialog.locator('.gm-payment-row--method select').first();
    await expect(method).toBeVisible({ timeout: 5_000 });
    if (!(await method.inputValue().catch(() => ''))) {
      await selectSafePaymentMethod(dialog);
    }

    const freshDebtRow = dialog.locator(`.gm-receipt-row[data-movement-id="${movementId}"]`).first();
    const checkbox = freshDebtRow.locator('input[type="checkbox"]');
    if (!(await checkbox.isChecked().catch(() => false))) {
      await freshDebtRow.click({ timeout: 5_000 });
    }
    await expect(checkbox).toBeChecked({ timeout: 5_000 });

    await completeRemainingAmount(dialog);

    const confirm = dialog.getByRole('button', { name: /Confirmar cobro/i });
    await expect(confirm).toBeEnabled({ timeout: 5_000 });

    // Ventana corta de estabilidad: si una hidratación tardía reconstruye el
    // modal, el bloque completo se reintenta en vez de continuar con estado 0.
    await page.waitForTimeout(500);
    await expect(dialog.locator(`.gm-receipt-row[data-movement-id="${movementId}"] input[type="checkbox"]`).first())
      .toBeChecked({ timeout: 2_000 });
    await expect(dialog.locator('.gm-payment-row--method select').first()).not.toHaveValue('', { timeout: 2_000 });
    await expect(dialog.getByRole('button', { name: /Confirmar cobro/i })).toBeEnabled({ timeout: 2_000 });
  }).toPass({
    // Frontend local + API remota: la hidratación del modal puede tardar más
    // durante una corrida larga. El reintento sigue siendo acotado a este flujo.
    timeout: 90_000,
    intervals: [150, 300, 600, 1_000, 2_000],
  });

  // Registramos el listener ANTES del click para no perder una respuesta rápida
  // y verificamos la confirmación real del backend, no sólo el estado visual.
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'recibos_confirmar_pago',
    { timeout: 120_000 },
  );

  await dialog.getByRole('button', { name: /Confirmar cobro/i }).click();

  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(
    response.status(),
    `El recibo debe guardarse: HTTP ${response.status()} ${JSON.stringify(body)}`,
  ).toBeLessThan(400);
  expect(
    body?.exito !== false && body?.success !== false,
    body?.mensaje || body?.message || 'No se pudo confirmar el cobro del recibo',
  ).toBeTruthy();

  const finalizar = page.getByRole('button', { name: /^Finalizar$/i }).last();
  await expect(finalizar).toBeVisible({ timeout: 45_000 });
  await finalizar.click();
  await expect(finalizar).toBeHidden({ timeout: 45_000 });
}

export async function payPayable(page, productName) {
  await page.goto('/panel/OrdenesPago');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, productName, /Buscar por descripción, proveedor/i);
  const movementId = await row.getAttribute('data-movement-id');
  if (!movementId) throw new Error('La fila de la orden no expone data-movement-id.');

  await row.getByTitle('Pagar').click();
  const dialog = await waitDialog(page, 'Pagar orden');

  const debtRow = dialog.locator(`.gm-order-row[data-movement-id="${movementId}"]`).first();
  await expect(debtRow).toBeVisible({ timeout: 20_000 });

  // Igual que en Recibos: cambiar el medio de pago reconstruye el panel lateral y
  // puede limpiar una deuda que se marcó antes. Primero estabilizamos el medio y
  // recién después seleccionamos la obligación exacta creada por el test.
  await selectSafePaymentMethod(dialog);

  const checkbox = debtRow.locator('input[type="checkbox"]');
  if (!(await checkbox.isChecked())) {
    // La fila completa funciona como control de selección. Evitamos force-check
    // porque el click del input también puede propagarse a la fila y alternar dos
    // veces el mismo estado.
    await debtRow.click();
  }
  await expect(checkbox).toBeChecked({ timeout: 10_000 });
  await completeRemainingAmount(dialog);

  const confirm = dialog.getByRole('button', { name: /Confirmar pago/i });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const finalizar = page.getByRole('button', { name: /^Finalizar$/i }).last();
  await expect(finalizar).toBeVisible({ timeout: 45_000 });
  await expect(finalizar).toBeEnabled({ timeout: 45_000 });

  // React puede reemplazar el botón mientras recalcula el pago. Volvemos a
  // localizarlo en cada intento para evitar fallas por un nodo desmontado.
  await expect(async () => {
    const botonActual = page.getByRole('button', { name: /^Finalizar$/i }).last();
    await expect(botonActual).toBeVisible({ timeout: 5_000 });
    await expect(botonActual).toBeEnabled({ timeout: 5_000 });
    await botonActual.click({ timeout: 5_000 });
  }).toPass({
    timeout: 45_000,
    intervals: [500, 1_000, 2_000],
  });

  await expect(
    page.getByRole('button', { name: /^Finalizar$/i }).last(),
  ).toBeHidden({ timeout: 45_000 });
}
