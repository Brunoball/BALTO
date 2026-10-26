import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { getStockE2EFixtureUnit, waitStockEditorUnitsReady } from './support/stock-units.js';
import { createVariantStockProduct } from './support/barcodes.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { requireMutations, searchRow, waitDialog, waitForBusyToFinish } from './support/ui.js';

function payload(body) {
  return body?.data && typeof body.data === 'object' ? { ...body.data, ...body } : body || {};
}

function rowsOf(body, field) {
  const rows = payload(body)[field];
  expect(Array.isArray(rows), `La respuesta debe contener ${field} como array`).toBe(true);
  return rows;
}

function priceRowsToSave(rows) {
  // Nunca reusar la respuesta entera del backend: contiene columnas de sólo lectura.
  return rows.map((row) => ({
    id_tipo_precio_stock: Number(row.id_tipo_precio_stock),
    monto: Number(row.monto),
    margen_porcentaje: row.margen_porcentaje ?? null,
    margen_valor: row.margen_valor ?? null,
  }));
}

async function pricesFor(page, productId, variantId = null) {
  const response = await authenticatedApi(page, 'stock_precios_obtener', {
    query: {
      id_stock_producto: productId,
      ...(variantId ? { id_stock_variante: variantId } : {}),
      _: Date.now(),
    },
  });
  return rowsOf(expectApiSuccess(response, 'No se pudieron consultar precios'), 'precios');
}

async function historyFor(page, productId) {
  const response = await authenticatedApi(page, 'stock_precios_historial_producto', {
    query: { id_stock_producto: productId, limit: 500, _: Date.now() },
  });
  return rowsOf(expectApiSuccess(response, 'No se pudo leer historial de precios'), 'items');
}

async function writePrices(page, productId, prices, variantId = null) {
  const response = await authenticatedApi(page, 'stock_precio_guardar', {
    method: 'POST',
    body: {
      id_stock_producto: productId,
      ...(variantId ? { id_stock_variante: variantId } : {}),
      precios: prices,
    },
  });
  return expectApiSuccess(response, 'No se pudo guardar el cambio individual de precios');
}

async function fixtureUnitId(page) {
  // Las mutaciones pasan por requireMutations(), que verifica el aislamiento TN.
  // No se debe exigir una unidad que el negocio conectado no puede utilizar.
  const unit = await getStockE2EFixtureUnit(page);
  return Number(unit.id_stock_unidad);
}

test('@stock @search @critical el buscador conserva texto y foco ante escritura, pegado y refresco', async ({ page }) => {
  // La notificación tardía de vencimientos puede abrirse en medio de
  // pressSequentially y robar un carácter al cerrar su propio overlay.
  // Esperamos la primera lectura de alertas antes de probar foco y teclado.
  const alertsLoaded = page.waitForResponse((res) =>
    new URL(res.url()).searchParams.get('action') === 'stock_vencimientos_alertas',
    { timeout: 30_000 },
  );
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  await alertsLoaded;
  // support/test.js ya cierra automáticamente este popup con addLocatorHandler.
  // No cerrarlo otra vez: el handler puede desmontar el botón entre isVisible()
  // y evaluate(), dando un falso timeout antes de comprobar el buscador.
  const search = page.locator('.stock-page .cc-filter--search input').first();
  await expect(search).toBeVisible();
  await search.click();
  await search.fill('PW-FOCO-');
  await search.pressSequentially('STOCK', { delay: 35 });
  await expect(search).toHaveValue('PW-FOCO-STOCK');
  await expect(search).toBeFocused();
  // El debounce, las lecturas de catálogo y la captura técnica del lector no
  // deben borrar letras ni mover el cursor fuera del buscador visible.
  await page.waitForTimeout(1_200);
  await expect(search).toHaveValue('PW-FOCO-STOCK');
  await expect(search).toBeFocused();
  await search.fill('PW-PEGADO-STOCK');
  await page.waitForTimeout(850);
  await expect(search).toHaveValue('PW-PEGADO-STOCK');
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(search).toHaveValue('');
});

test('@stock @sku @critical SKU duplicado identifica producto existente, sin crear otro', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(180_000);
  const name = uniqueName('STOCK-SKU-DUP');
  const sku = uniqueSku('SKUDUP');
  let created = false;
  try {
    const response = await createStockProductFixture(page, {
      name, sku, stock: 3, cost: 120, price: 220,
      unitId: await fixtureUnitId(page),
    });
    expect(Number(payload(response).producto?.id_stock_producto || 0)).toBeGreaterThan(0);
    created = true;
    const duplicate = await authenticatedApi(page, 'stock_productos_crear', {
      method: 'POST',
      body: {
        nombre: uniqueName('INTENTO-DUPLICADO'), sku,
        stock: 0, precio_costo: 120, precio: 220,
      },
    });
    expect(duplicate.status, `Se esperaba rechazo funcional, llegó ${duplicate.status}: ${duplicate.text}`).toBe(409);
    const message = String(duplicate.body?.mensaje || duplicate.body?.message || '');
    expect(message).toContain(sku);
    expect(message.toUpperCase()).toContain(name.toUpperCase());
    expect(message).toMatch(/producto/i);
    expect(message).not.toMatch(/SQLSTATE|Duplicate entry|Integrity constraint/i);
  } finally {
    if (created) await deleteUnusedStockProduct(page, name);
  }
});

test('@stock @historial @critical editar precio, repetirlo y quitar promoción deja sólo los cambios reales', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(180_000);
  const name = uniqueName('STOCK-HISTORIAL');
  const sku = uniqueSku('HISTOCT');
  let created = false;
  try {
    const response = await createStockProductFixture(page, {
      name, sku, stock: 3, cost: 120, price: 200,
      unitId: await fixtureUnitId(page),
    });
    const productId = Number(payload(response).producto?.id_stock_producto || 0);
    expect(productId).toBeGreaterThan(0);
    created = true;
    const original = priceRowsToSave(await pricesFor(page, productId));
    const sale = original.find((item) => item.id_tipo_precio_stock === 2);
    expect(sale, 'Debe existir el precio de venta base').toBeTruthy();
    const historyBefore = await historyFor(page, productId);
    const originalIds = new Set(historyBefore.map((item) => Number(item.id_ajuste_precio_item)));
    const changed = original.map((item) => item.id_tipo_precio_stock === 2 ? { ...item, monto: 235.75 } : item);

    await writePrices(page, productId, changed);
    let fresh = (await historyFor(page, productId)).filter((item) => !originalIds.has(Number(item.id_ajuste_precio_item)));
    expect(fresh.filter((item) => Number(item.id_tipo_precio_stock) === 2)).toHaveLength(1);
    const saleHistory = fresh.find((item) => Number(item.id_tipo_precio_stock) === 2);
    expect(Number(saleHistory.precio_anterior)).toBeCloseTo(Number(sale.monto), 2);
    expect(Number(saleHistory.precio_nuevo)).toBeCloseTo(235.75, 2);
    expect(String(saleHistory.observacion || '')).toMatch(/Stock|BALTO/i);

    await writePrices(page, productId, changed);
    const afterRepeated = (await historyFor(page, productId)).filter((item) => !originalIds.has(Number(item.id_ajuste_precio_item)));
    expect(afterRepeated, 'Guardar dos veces el mismo importe no debe sumar eventos').toHaveLength(1);

    const promo = [...changed, { id_tipo_precio_stock: 3, monto: 210 }];
    await writePrices(page, productId, promo);
    await writePrices(page, productId, changed);
    fresh = (await historyFor(page, productId)).filter((item) => !originalIds.has(Number(item.id_ajuste_precio_item)));
    const promoChanges = fresh.filter((item) => Number(item.id_tipo_precio_stock) === 3);
    expect(promoChanges).toHaveLength(2);
    expect(promoChanges.some((item) => Number(item.precio_anterior) === 0 && Number(item.precio_nuevo) === 210)).toBe(true);
    expect(promoChanges.some((item) => Number(item.precio_anterior) === 210 && Number(item.precio_nuevo) === 0)).toBe(true);
    expect(fresh).toHaveLength(3);

    const final = await pricesFor(page, productId);
    expect(final.find((item) => Number(item.id_tipo_precio_stock) === 2)?.monto).toBeDefined();
    expect(final.some((item) => Number(item.id_tipo_precio_stock) === 3)).toBe(false);

    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    const row = await searchRow(page, sku, /Buscar por nombre, SKU/i);
    await row.getByTitle('Historial de precios').click();
    const dialog = await waitDialog(page, 'Historial de precios');
    await expect(dialog).toContainText(/Precio base del producto/i);
    await expect(dialog).toContainText(/Edición de precio desde Stock/i);
  } finally {
    if (created) await deleteUnusedStockProduct(page, name);
  }
});

test('@stock @variants @sku @historial crear y editar variante sin SKU conserva precio e historial', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(240_000);
  const name = uniqueName('STOCK-VAR-SIN-SKU');
  const sku = uniqueSku('VAR-SIN-SKU');
  let created = false;
  try {
    const initialPrice = 260;
    const built = await createVariantStockProduct(page, {
      name, sku,
      variants: [{ name: uniqueName('VARIANTE-UNO', 40), stock: 4, price: initialPrice }],
    });
    created = true;
    const productId = Number(built.productId);
    const variantId = Number(built.variants?.[0]?.id_stock_variante || 0);
    expect(variantId).toBeGreaterThan(0);
    expect(String(built.variants[0].sku || '')).toBe('');

    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    const row = await searchRow(page, sku, /Buscar por nombre, SKU/i);
    await row.getByTitle('Editar').click();
    const dialog = await waitDialog(page, 'Editar producto');
    await expect(dialog.locator('.cmi-v2-variantPanelOnly')).toBeHidden();
    await dialog.getByRole('tab', { name: /^Variantes$/i }).click();
    // El botón puede habilitarse antes de que llegue la política de unidades;
    // guardar en ese instante no emite POST y deja el waitForResponse colgado.
    await waitStockEditorUnitsReady(page, dialog, { variant: true });
    const card = dialog.locator('.cmi-v2-variantCard').first();
    await expect(card).toBeVisible();
    await expect(card.getByPlaceholder('SKU', { exact: true })).toHaveValue('');
    const price = card.locator('.cmi-floatingField, .fl-field').filter({ hasText: /Precio de venta/i }).first().locator('input');
    await price.fill('295');
    await price.blur();
    const responseWait = page.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'stock_productos_actualizar',
      { timeout: 120_000 });
    await dialog.getByRole('button', { name: /Guardar cambios/i }).click();
    const response = await responseWait;
    const body = await response.json().catch(() => ({}));
    expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
    expect(body?.exito !== false && body?.success !== false).toBe(true);
    await expect(dialog).toBeHidden({ timeout: 120_000 });

    const variants = await authenticatedApi(page, 'stock_variantes_listar', {
      query: { id_stock_producto: productId, activo: 'todos', _: Date.now() },
    });
    const stored = rowsOf(expectApiSuccess(variants), 'variantes').find((v) => Number(v.id_stock_variante) === variantId);
    expect(stored).toBeTruthy();
    expect(String(stored.sku || '')).toBe('');

    const sale = (await pricesFor(page, productId, variantId)).find((item) => Number(item.id_tipo_precio_stock) === 2);
    expect(sale).toBeTruthy();
    expect(Number(sale.monto)).toBeCloseTo(295, 2);
    const changes = (await historyFor(page, productId)).filter((item) =>
      Number(item.id_stock_variante) === variantId &&
      Number(item.id_tipo_precio_stock) === 2 &&
      Number(item.precio_nuevo) === 295
    );
    expect(changes, 'El cambio de precio de la variante sin SKU debe figurar en el historial').toHaveLength(1);
  } finally {
    if (created) await deleteUnusedStockProduct(page, name);
  }
});
