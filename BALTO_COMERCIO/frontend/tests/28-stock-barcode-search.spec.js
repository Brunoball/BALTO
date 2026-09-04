import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { createStockProduct, deleteUnusedStockProduct } from './support/flows.js';
import {
  barcodeApi,
  createVariantStockProduct,
  expectBarcodeSuccess,
  simulateBarcodeScan,
  uniqueExternalBarcode,
} from './support/barcodes.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';

const STOCK_SEARCH = /Buscar por nombre, SKU, código de barra o variante/i;

function listedProducts(body) {
  if (Array.isArray(body?.productos)) return body.productos;
  if (Array.isArray(body?.data?.productos)) return body.data.productos;
  return [];
}

function productIdOf(product) {
  return Number(
    product?.id_stock_producto ??
      product?.id_producto ??
      product?.id ??
      0,
  );
}

async function expectProductListedBySearch(page, search, productId, message) {
  const result = await authenticatedApi(page, 'stock_productos_listar', {
    query: {
      buscar: search,
      activo: 1,
      pagina: 1,
      por_pagina: 20,
      _r: Date.now(),
    },
  });
  const body = expectApiSuccess(result, message);
  const products = listedProducts(body);

  expect(
    products.some((product) => productIdOf(product) === Number(productId)),
    `${message}. IDs recibidos: ${products.map(productIdOf).join(', ') || '(ninguno)'}`,
  ).toBe(true);

  return products.find((product) => productIdOf(product) === Number(productId));
}

function waitStockSearchResponse(page, expectedSearch) {
  return page.waitForResponse((response) => {
    try {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return (
        url.searchParams.get('action') === 'stock_productos_listar' &&
        String(url.searchParams.get('buscar') || '').trim() === String(expectedSearch).trim() &&
        url.searchParams.get('activo') === '1'
      );
    } catch {
      return false;
    }
  }, { timeout: 30_000 });
}

async function expectScannerReadyWithoutVisibleFocus(page) {
  const search = page.getByPlaceholder(STOCK_SEARCH).first();
  const capture = page.getByLabel('Captura del lector de códigos de barra');

  await expect(search).toBeVisible();
  await expect(search).not.toBeFocused();
  await expect.poll(
    () => capture.evaluate((node) => document.activeElement === node),
    {
      timeout: 5_000,
      intervals: [50, 100, 200],
      message: 'Stock debe preparar el lector invisible sin activar visualmente el buscador.',
    },
  ).toBe(true);

  return { search, capture };
}

async function scanAndExpectStockResult(page, code, productId, productName, options = {}) {
  const search = page.getByPlaceholder(STOCK_SEARCH).first();
  await expect(search).not.toBeFocused();

  const responsePromise = waitStockSearchResponse(page, code);
  await simulateBarcodeScan(page, code, options);
  const response = await responsePromise;
  const responseBody = await response.json().catch(() => ({}));

  expect(
    response.status(),
    `La búsqueda disparada por el lector respondió HTTP ${response.status()}: ${JSON.stringify(responseBody)}`,
  ).toBeLessThan(400);
  expect(responseBody?.exito !== false && responseBody?.success !== false).toBe(true);

  await expect(search).toHaveValue(code);
  await waitForBusyToFinish(page);

  const row = page.locator(`[data-stock-product-id="${Number(productId)}"]`).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(productName);

  // El valor se muestra en el buscador, pero el cursor permanece en la captura
  // técnica invisible para que la interfaz no quede marcada como activa.
  await expect(search).not.toBeFocused();
  return row;
}

async function pasteBarcode(page, code) {
  await page.evaluate((text) => {
    const target = document.activeElement instanceof Element
      ? document.activeElement
      : document.body;
    const event = new Event('paste', {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        getData: (type) => (type === 'text' || type === 'text/plain' ? String(text) : ''),
      },
    });
    target.dispatchEvent(event);
  }, String(code));
}

test('@stock @barcode @search @critical ProductoRepository y la pantalla encuentran un producto simple por código sin tocar el buscador', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);

  const productName = uniqueName('BARCODE-BUSCADOR');
  const productSku = uniqueSku('BCBUSCA');
  const external = uniqueExternalBarcode('BUSCADOR');
  let productId = 0;

  try {
    const createdRow = await createStockProduct(page, {
      name: productName,
      sku: productSku,
      stock: 9,
      cost: 110,
      price: 190,
    });
    productId = Number(await createdRow.getAttribute('data-stock-product-id'));
    expect(productId).toBeGreaterThan(0);

    expectBarcodeSuccess(await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: {
        op: 'guardar',
        tipo_entidad: 'producto',
        id_stock_producto: productId,
        codigo_barra: external,
      },
    }));

    // Cobertura directa del cambio de ProductoRepository.php.
    await expectProductListedBySearch(
      page,
      external,
      productId,
      'stock_productos_listar debe buscar el código físico del producto',
    );
    await expectProductListedBySearch(
      page,
      `BL-P-${productId}`,
      productId,
      'stock_productos_listar debe buscar el código interno BL-P-ID',
    );
    await expectProductListedBySearch(
      page,
      `BLP${productId}`,
      productId,
      'stock_productos_listar debe aceptar también el formato compacto BLPID',
    );

    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    await expectScannerReadyWithoutVisibleFocus(page);

    // Pistola con Enter.
    await scanAndExpectStockResult(page, external, productId, productName, {
      terminator: 'Enter',
    });

    // Pistola sin Enter/Tab: Stock confirma la ráfaga después del silencio.
    const internal = `BL-P-${productId}`;
    await scanAndExpectStockResult(page, internal, productId, productName, {
      terminator: null,
      idleMs: 320,
    });

    // Algunos lectores se presentan como pegado en lugar de teclas individuales.
    const pasteResponse = waitStockSearchResponse(page, external);
    await pasteBarcode(page, external);
    const response = await pasteResponse;
    expect(response.status()).toBeLessThan(400);
    await expect(page.getByPlaceholder(STOCK_SEARCH).first()).toHaveValue(external);
    await expect(page.locator(`[data-stock-product-id="${productId}"]`).first()).toContainText(productName);
    await expect(page.getByPlaceholder(STOCK_SEARCH).first()).not.toBeFocused();
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

test('@stock @barcode @search @variants ProductoRepository devuelve el producto padre al buscar códigos de una variante', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);

  const productName = uniqueName('BARCODE-BUSCA-VAR');
  const parentSku = uniqueSku('BCBUSCAV');
  const variant = {
    name: uniqueName('BC-BUSCA-VAR-A', 40),
    sku: uniqueSku('BCBVA'),
    stock: 7,
    price: 230,
  };
  const external = uniqueExternalBarcode('BUSCA-VAR');
  let productId = 0;
  let variantId = 0;

  try {
    const created = await createVariantStockProduct(page, {
      name: productName,
      sku: parentSku,
      variants: [variant],
    });
    productId = Number(created.productId);
    variantId = Number(created.variants?.[0]?.id_stock_variante || 0);
    expect(productId).toBeGreaterThan(0);
    expect(variantId).toBeGreaterThan(0);

    expectBarcodeSuccess(await barcodeApi(page, 'guardar', {
      method: 'POST',
      body: {
        op: 'guardar',
        tipo_entidad: 'variante',
        id_stock_producto: productId,
        id_stock_variante: variantId,
        codigo_barra: external,
      },
    }));

    await expectProductListedBySearch(
      page,
      external,
      productId,
      'El código físico de una variante debe devolver su producto padre',
    );
    await expectProductListedBySearch(
      page,
      `BL-V-${variantId}`,
      productId,
      'BL-V-ID debe devolver el producto padre de la variante',
    );
    await expectProductListedBySearch(
      page,
      `BLV${variantId}`,
      productId,
      'El formato compacto BLVID debe devolver el producto padre de la variante',
    );

    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    await expectScannerReadyWithoutVisibleFocus(page);
    await scanAndExpectStockResult(
      page,
      `BL-V-${variantId}`,
      productId,
      productName,
      { terminator: 'Tab' },
    );
  } finally {
    if (productId > 0 && variantId > 0) {
      await barcodeApi(page, 'quitar', {
        method: 'DELETE',
        body: {
          op: 'quitar',
          tipo_entidad: 'variante',
          id_stock_producto: productId,
          id_stock_variante: variantId,
        },
      }).catch(() => null);
    }
    await deleteUnusedStockProduct(page, productName).catch(() => null);
  }
});
