import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { createStockProduct, deleteUnusedStockProduct } from './support/flows.js';
import { requireMutations, searchRow, waitDialog, waitForBusyToFinish } from './support/ui.js';
import { cleanupTestUser, createEmployeeTestUser, loginTestUserInNewContext } from './support/users.js';
import {
  barcodeApi,
  createVariantStockProduct,
  expectBarcodeSuccess,
  getBarcodeProduct,
  setVariantActiveState,
  uniqueExternalBarcode,
} from './support/barcodes.js';

async function stockProductId(page, query) {
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, query, /Buscar por nombre, SKU o variante/i);
  const id = Number(await row.getAttribute('data-stock-product-id'));
  expect(id, `Stock debe exponer el ID real de ${query}`).toBeGreaterThan(0);
  return { id, row };
}

async function setProductActiveState(page, sku, active) {
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);

  if (!active) {
    const row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
    await row.getByTitle('Dar de baja').click();
    const dialog = await waitDialog(page, 'Dar de baja producto');
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'stock_producto_dar_baja',
    { timeout: 120_000 });
    await dialog.getByRole('button', { name: /^Dar de baja$/i }).click();
    const response = await responsePromise;
    expect(response.status()).toBeLessThan(400);
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    return;
  }

  // Para reactivar primero hay que entrar al listado de bajas; el producto ya no
  // existe en la grilla activa, así que buscarlo antes siempre devuelve 0 filas.
  await page.getByRole('button', { name: /Ver dados de baja/i }).first().click();
  await waitForBusyToFinish(page);
  const row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).searchParams.get('action') === 'stock_producto_reactivar',
  { timeout: 120_000 });
  await row.getByTitle('Dar de alta producto').click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
}

test('@stock @barcode @alta guardar desde Código de barra mantiene el modal abierto y genera BL-P con ID real', async ({ page }) => {
  await requireMutations(test, page);
  const productName = uniqueName('BARCODE-ALTA');
  const productSku = uniqueSku('BCALTA');

  try {
    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Agregar producto/i }).first().click();
    const dialog = await waitDialog(page, 'Productos');

    await dialog.locator('input[name="nombre"]').fill(productName);
    await dialog.locator('input[name="sku"]').fill(productSku);
    await dialog.locator('input[name="stock"]').fill('4');
    await dialog.locator('input[name="precio_costo"]').fill('80');
    await dialog.locator('input[name="precio_costo"]').blur();
    await dialog.locator('input[name="precio"]').fill('140');
    await dialog.locator('input[name="precio"]').blur();

    await dialog.getByRole('tab', { name: /Código de barra/i }).click();
    await expect(dialog).toContainText(/Primero hay que guardar el producto/i);
    const saveAndGenerate = dialog.getByRole('button', { name: /Guardar y generar códigos/i });
    await expect(saveAndGenerate).toBeEnabled();

    const createPromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'stock_productos_crear',
    { timeout: 120_000 });
    await saveAndGenerate.click();
    const createResponse = await createPromise;
    const createBody = await createResponse.json().catch(() => ({}));
    expect(createResponse.status(), JSON.stringify(createBody)).toBeLessThan(400);

    // Este es el comportamiento especial de la pestaña: el alta ya ocurrió, pero
    // el modal NO se cierra hasta que el usuario termina de imprimir/asociar códigos.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Finalizar/i })).toBeEnabled({ timeout: 45_000 });
    const card = dialog.locator('.stock-barcode__card').first();
    await expect(card).toBeVisible({ timeout: 45_000 });
    const text = await card.innerText();
    const match = text.match(/BL-P-(\d+)/i);
    expect(match, `La tarjeta debe mostrar un BL-P-ID real. Texto: ${text}`).toBeTruthy();
    const productId = Number(match[1]);
    expect(productId).toBeGreaterThan(0);
    await expect(card.locator('.stock-barcode__section--internal .stock-barcode__svg')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Imprimir código/i })).toBeEnabled();

    const lookup = expectBarcodeSuccess(
      await barcodeApi(page, 'buscar', { query: { codigo_barra: `BL-P-${productId}` } }),
      'El BL-P recién generado debe resolver el producto que acaba de persistirse',
    );
    expect(Number(lookup?.producto?.id_stock_producto || 0)).toBe(productId);

    await dialog.getByRole('button', { name: /Finalizar/i }).click();
    await expect(dialog).toBeHidden({ timeout: 120_000 });
  } finally {
    await deleteUnusedStockProduct(page, productName).catch(() => null);
  }
});

test('@stock @barcode @critical producto simple: BL-P, código físico, duplicados, prefijos reservados e inactivos', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const productName = uniqueName('BARCODE-SIMPLE');
  const productSku = uniqueSku('BCSIMPLE');
  const otherName = uniqueName('BARCODE-OTRO');
  const otherSku = uniqueSku('BCOTRO');
  const external = uniqueExternalBarcode('FISICO');
  let inactive = false;

  try {
    await createStockProduct(page, { name: productName, sku: productSku, stock: 8, cost: 100, price: 180 });
    await createStockProduct(page, { name: otherName, sku: otherSku, stock: 5, cost: 80, price: 150 });
    const { id: productId } = await stockProductId(page, productSku);
    const { id: otherId } = await stockProductId(page, otherSku);

    const snapshot = await getBarcodeProduct(page, productId);
    expect(snapshot?.codigos_internos?.producto).toBe(`BL-P-${productId}`);
    expect(snapshot?.codigos_internos?.variantes).toHaveLength(0);

    const internalLookup = await barcodeApi(page, 'buscar', { query: { codigo_barra: `BL-P-${productId}` } });
    const internalBody = expectBarcodeSuccess(internalLookup, 'BL-P debe resolver el producto simple');
    expect(internalBody?.tipo_codigo).toBe('interno');
    expect(internalBody?.tipo_entidad).toBe('producto');
    expect(Number(internalBody?.producto?.id_stock_producto)).toBe(productId);

    // UI real de Stock: muestra el BL-P y guarda un código físico con Enter, igual
    // que una pistola keyboard-wedge configurada con terminador. Rebuscamos el producto
    // porque la consulta del segundo producto cambió el filtro de la grilla.
    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    const productRow = await searchRow(page, productSku, /Buscar por nombre, SKU o variante/i);
    await productRow.getByTitle('Editar').click();
    const dialog = await waitDialog(page, 'Editar producto');
    await dialog.getByRole('tab', { name: /Código de barra/i }).click();
    const card = dialog.locator('.stock-barcode__card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(`BL-P-${productId}`);
    await expect(card.locator('.stock-barcode__section--internal .stock-barcode__svg')).toBeVisible();
    await expect(card.getByRole('button', { name: /^Imprimir$/i })).toBeEnabled();
    // La UI actual abre un modal dedicado para escanear/escribir el código físico.
    await card.getByRole('button', { name: /Agregar código/i }).click();
    const barcodeDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: /Agregar código de barra/i }) })
      .last();
    await expect(barcodeDialog).toBeVisible({ timeout: 15_000 });
    const scanInput = barcodeDialog.locator('input.stock-barcode__scanInput');
    await expect(scanInput).toBeFocused({ timeout: 10_000 });

    const savePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/stock/codigos_barra/endpoint.php'),
    { timeout: 60_000 });
    await scanInput.fill(external);
    await scanInput.press('Enter');
    const saveResponse = await savePromise;
    expect(saveResponse.status()).toBeLessThan(400);
    await expect(barcodeDialog).toBeHidden({ timeout: 30_000 });
    await expect(card).toContainText(external);
    await expect(card.getByRole('button', { name: /Cambiar código/i })).toBeVisible();

    const externalLookup = await barcodeApi(page, 'buscar', { query: { codigo_barra: external } });
    const externalBody = expectBarcodeSuccess(externalLookup, 'El código físico debe resolver el producto');
    expect(externalBody?.tipo_codigo).toBe('externo');
    expect(Number(externalBody?.producto?.id_stock_producto)).toBe(productId);

    // La UNIQUE global impide reutilizar el mismo código en otro artículo.
    const duplicate = await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: { op: 'guardar', tipo_entidad: 'producto', id_stock_producto: otherId, codigo_barra: external },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body?.codigo).toBe('BARCODE_DUPLICATE');

    const reserved = await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: { op: 'guardar', tipo_entidad: 'producto', id_stock_producto: otherId, codigo_barra: `BL-P-${otherId}` },
    });
    expect(reserved.status).toBe(422);
    expect(String(reserved.body?.mensaje || '')).toMatch(/prefijos BL-P- y BL-V-.*reservados/i);

    await dialog.getByRole('button', { name: /Cerrar/i }).click().catch(() => null);
    await setProductActiveState(page, productSku, false);
    inactive = true;

    const inactiveLookup = await barcodeApi(page, 'buscar', { query: { codigo_barra: `BL-P-${productId}` } });
    expect(inactiveLookup.status).toBe(409);
    expect(inactiveLookup.body?.codigo).toBe('BARCODE_PRODUCT_INACTIVE');

    const inactiveWrite = await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: {
        op: 'guardar',
        tipo_entidad: 'producto',
        id_stock_producto: productId,
        codigo_barra: uniqueExternalBarcode('INACTIVO'),
      },
    });
    expect(inactiveWrite.status).toBe(409);
    expect(inactiveWrite.body?.codigo).toBe('BARCODE_PRODUCT_INACTIVE_WRITE');

    // Quitar queda permitido al admin aunque el artículo esté inactivo, para poder limpiar asociaciones viejas.
    const remove = await barcodeApi(page, 'quitar', {
      method: 'DELETE',
      body: { op: 'quitar', tipo_entidad: 'producto', id_stock_producto: productId },
    });
    expectBarcodeSuccess(remove, 'El admin debe poder quitar el código físico de un producto inactivo');
    const removedLookup = await barcodeApi(page, 'buscar', { query: { codigo_barra: external } });
    expect(removedLookup.status).toBe(404);

    await setProductActiveState(page, productSku, true);
    inactive = false;
  } finally {
    if (inactive) await setProductActiveState(page, productSku, true).catch(() => null);
    await deleteUnusedStockProduct(page, productName).catch(() => null);
    await deleteUnusedStockProduct(page, otherName).catch(() => null);
  }
});

test('@stock @barcode @variants variantes: un BL-V por ID real, guardado sin cerrar modal e inactivo protegido', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const productName = uniqueName('BARCODE-VARIANTES');
  const parentSku = uniqueSku('BCPADRE');
  const first = { name: uniqueName('BC-VAR-A', 40), sku: uniqueSku('BCVA'), stock: 6, price: 250 };
  const second = { name: uniqueName('BC-VAR-B', 40), sku: uniqueSku('BCVB'), stock: 7, price: 260 };
  const third = { name: uniqueName('BC-VAR-C', 40), sku: uniqueSku('BCVC'), stock: 8, price: 270 };
  const external = uniqueExternalBarcode('VARIANTE');
  let firstVariantInactive = false;

  try {
    const created = await createVariantStockProduct(page, {
      name: productName,
      sku: parentSku,
      variants: [first, second],
    });
    const productId = created.productId;

    let snapshot = await getBarcodeProduct(page, productId);
    expect(snapshot?.variantes).toHaveLength(2);
    expect(snapshot?.codigos_internos?.variantes).toHaveLength(2);
    for (const variant of snapshot.variantes) {
      const variantId = Number(variant.id_stock_variante);
      expect(snapshot.codigos_internos.variantes).toContainEqual({
        id_stock_variante: variantId,
        codigo: `BL-V-${variantId}`,
      });
    }

    const productLookup = await barcodeApi(page, 'buscar', { query: { codigo_barra: `BL-P-${productId}` } });
    expect(productLookup.status).toBe(409);
    expect(productLookup.body?.codigo).toBe('BARCODE_PRODUCT_NOW_HAS_VARIANTS');

    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    const row = await searchRow(page, parentSku, /Buscar por nombre, SKU o variante/i);
    await row.getByTitle('Editar').click();
    const dialog = await waitDialog(page, 'Editar producto');
    await dialog.getByRole('tab', { name: /Código de barra/i }).click();
    await expect(dialog.locator('.stock-barcode__card')).toHaveCount(2, { timeout: 30_000 });
    await expect(dialog.locator('.stock-barcode__section--internal .stock-barcode__svg')).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: /Imprimir todos/i })).toBeEnabled();
    for (const variant of snapshot.variantes) {
      await expect(dialog).toContainText(`BL-V-${Number(variant.id_stock_variante)}`);
    }

    // Agrega una variante todavía sin ID, vuelve a Códigos y usa el botón nuevo.
    // El producto debe guardarse sin cerrar el modal y recién después mostrar BL-V-ID real.
    await dialog.getByRole('tab', { name: /^Variantes$/i }).click();
    await dialog.getByRole('button', { name: /Agregar variante/i }).click();
    const thirdCard = dialog.locator('.cmi-v2-variantCard').last();
    await thirdCard.getByPlaceholder(/TALLE M \/ NEGRO/i).fill(third.name);

    // Regresión del bug corregido: si una variante nueva todavía es inválida,
    // Código de barra NO puede anunciar "Cambios guardados" ni recargar IDs falsos.
    let updateRequests = 0;
    const countUpdate = (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).searchParams.get('action') === 'stock_productos_actualizar'
      ) updateRequests += 1;
    };
    page.on('request', countUpdate);
    await dialog.getByRole('tab', { name: /Código de barra/i }).click();
    await expect(dialog).toContainText(/Hay cambios de variantes sin guardar/i);
    await dialog.getByRole('button', { name: /Guardar cambios y generar códigos/i }).click();
    await page.waitForTimeout(300);
    expect(updateRequests, 'Una variante inválida no debe disparar el UPDATE ni simular éxito').toBe(0);
    await expect(page.locator('body')).not.toContainText(/Cambios guardados\. Los códigos ya usan los IDs definitivos/i);
    page.off('request', countUpdate);

    // La validación vuelve a Variantes. Completamos la fila y repetimos el flujo válido.
    await expect(dialog.getByRole('tab', { name: /^Variantes$/i })).toHaveAttribute('aria-selected', 'true');
    await thirdCard.getByPlaceholder('SKU', { exact: true }).fill(third.sku);
    await thirdCard.locator('input[inputmode="numeric"]').first().fill(String(third.stock));
    const priceField = thirdCard.locator('.cmi-floatingField, .fl-field').filter({ hasText: /Precio de venta/i }).first();
    await priceField.locator('input').fill(String(third.price));
    await priceField.locator('input').blur();

    await dialog.getByRole('tab', { name: /Código de barra/i }).click();
    await expect(dialog).toContainText(/Hay cambios de variantes sin guardar/i);
    const updatePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'stock_productos_actualizar',
    { timeout: 120_000 });
    await dialog.getByRole('button', { name: /Guardar cambios y generar códigos/i }).click();
    const updateResponse = await updatePromise;
    const updateBody = await updateResponse.json().catch(() => ({}));
    expect(updateResponse.status(), JSON.stringify(updateBody)).toBeLessThan(400);
    await expect(dialog).toBeVisible();

    await expect.poll(async () => (await getBarcodeProduct(page, productId))?.variantes?.length || 0, {
      timeout: 45_000,
      intervals: [300, 700, 1_500],
    }).toBe(3);
    snapshot = await getBarcodeProduct(page, productId);
    await expect(dialog.locator('.stock-barcode__card')).toHaveCount(3, { timeout: 30_000 });
    await expect(dialog.locator('.stock-barcode__section--internal .stock-barcode__svg')).toHaveCount(3);
    await expect(dialog.getByRole('button', { name: /Imprimir todos/i })).toBeEnabled();
    for (const variant of snapshot.variantes) {
      await expect(dialog).toContainText(`BL-V-${Number(variant.id_stock_variante)}`);
    }

    const firstStored = snapshot.variantes.find((variant) => String(variant.sku) === first.sku);
    expect(firstStored).toBeTruthy();
    const firstVariantId = Number(firstStored.id_stock_variante);

    const saveExternal = await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: {
        op: 'guardar',
        tipo_entidad: 'variante',
        id_stock_producto: productId,
        id_stock_variante: firstVariantId,
        codigo_barra: external,
      },
    });
    expectBarcodeSuccess(saveExternal);

    const variantLookup = await barcodeApi(page, 'buscar', { query: { codigo_barra: `BL-V-${firstVariantId}` } });
    const variantBody = expectBarcodeSuccess(variantLookup);
    expect(variantBody?.tipo_entidad).toBe('variante');
    expect(Number(variantBody?.variante?.id_stock_variante)).toBe(firstVariantId);

    const externalVariantLookup = await barcodeApi(page, 'buscar', { query: { codigo_barra: external } });
    const externalVariantBody = expectBarcodeSuccess(
      externalVariantLookup,
      'El código físico de una variante debe resolver exactamente esa variante',
    );
    expect(externalVariantBody?.tipo_codigo).toBe('externo');
    expect(externalVariantBody?.tipo_entidad).toBe('variante');
    expect(Number(externalVariantBody?.variante?.id_stock_variante)).toBe(firstVariantId);
    expect(Number(externalVariantBody?.variante?.id_stock_producto)).toBe(productId);

    await dialog.getByRole('button', { name: /Cerrar/i }).click().catch(() => null);
    await setVariantActiveState(page, parentSku, first.sku, false);
    firstVariantInactive = true;

    const inactiveLookup = await barcodeApi(page, 'buscar', { query: { codigo_barra: `BL-V-${firstVariantId}` } });
    expect(inactiveLookup.status).toBe(409);
    expect(inactiveLookup.body?.codigo).toBe('BARCODE_VARIANT_INACTIVE');

    const inactiveWrite = await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: {
        op: 'guardar',
        tipo_entidad: 'variante',
        id_stock_producto: productId,
        id_stock_variante: firstVariantId,
        codigo_barra: uniqueExternalBarcode('VAR-INACTIVA'),
      },
    });
    expect(inactiveWrite.status).toBe(409);
    expect(inactiveWrite.body?.codigo).toBe('BARCODE_VARIANT_INACTIVE_WRITE');

    const remove = await barcodeApi(page, 'quitar', {
      method: 'DELETE',
      body: {
        op: 'quitar',
        tipo_entidad: 'variante',
        id_stock_producto: productId,
        id_stock_variante: firstVariantId,
      },
    });
    expectBarcodeSuccess(remove);
    const externalMissing = await barcodeApi(page, 'buscar', { query: { codigo_barra: external } });
    expect(externalMissing.status).toBe(404);

    await setVariantActiveState(page, parentSku, first.sku, true);
    firstVariantInactive = false;
  } finally {
    if (firstVariantInactive) await setVariantActiveState(page, parentSku, first.sku, true).catch(() => null);
    await deleteUnusedStockProduct(page, productName).catch(() => null);
  }
});

test('@stock @barcode @security empleado puede leer con pistola pero no guardar ni quitar asociaciones', async ({ page, browser }) => {
  await requireMutations(test, page);
  const productName = uniqueName('BARCODE-PERMISOS');
  const productSku = uniqueSku('BCPERM');
  const username = uniqueName('BC-EMPLEADO', 36);
  const password = 'Pw!123456';
  const external = uniqueExternalBarcode('PERMISOS');
  let context = null;

  try {
    await createStockProduct(page, { name: productName, sku: productSku, stock: 5, cost: 70, price: 120 });
    const { id: productId } = await stockProductId(page, productSku);
    expectBarcodeSuccess(await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: { op: 'guardar', tipo_entidad: 'producto', id_stock_producto: productId, codigo_barra: external },
    }));

    await createEmployeeTestUser(page, username, password);
    const employeeSession = await loginTestUserInNewContext(browser, username, password);
    context = employeeSession.context;
    const employeePage = employeeSession.page;

    const internalLookup = await barcodeApi(employeePage, 'buscar', { query: { codigo_barra: `BL-P-${productId}` } });
    expectBarcodeSuccess(internalLookup, 'Empleado básico debe poder resolver BL-P para movimientos');
    const externalLookup = await barcodeApi(employeePage, 'buscar', { query: { codigo_barra: external } });
    expectBarcodeSuccess(externalLookup, 'Empleado básico debe poder resolver código físico para movimientos');

    const forbiddenSave = await barcodeApi(employeePage, 'guardar', {
      method: 'POST',
      body: {
        op: 'guardar',
        tipo_entidad: 'producto',
        id_stock_producto: productId,
        codigo_barra: uniqueExternalBarcode('NO-PERMITIR'),
      },
    });
    expect(forbiddenSave.status).toBe(403);
    expect(forbiddenSave.body?.codigo).toBe('BARCODE_WRITE_FORBIDDEN');

    const forbiddenDelete = await barcodeApi(employeePage, 'quitar', {
      method: 'DELETE',
      body: { op: 'quitar', tipo_entidad: 'producto', id_stock_producto: productId },
    });
    expect(forbiddenDelete.status).toBe(403);
    expect(forbiddenDelete.body?.codigo).toBe('BARCODE_WRITE_FORBIDDEN');

    // La asociación debe seguir intacta después de los intentos del empleado.
    expectBarcodeSuccess(await barcodeApi(page, 'buscar', { query: { codigo_barra: external } }));
    expectBarcodeSuccess(await barcodeApi(page, 'quitar', {
      method: 'DELETE',
      body: { op: 'quitar', tipo_entidad: 'producto', id_stock_producto: productId },
    }));
  } finally {
    if (context) await context.close().catch(() => null);
    await cleanupTestUser(page, username);
    await deleteUnusedStockProduct(page, productName).catch(() => null);
  }
});
