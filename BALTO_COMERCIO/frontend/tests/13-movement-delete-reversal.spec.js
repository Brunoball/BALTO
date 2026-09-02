import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { requireMutations, searchRow } from './support/ui.js';
import {
  createStockProduct,
  createPurchase,
  createSale,
  deletePurchase,
  deleteSale,
  deleteUnusedStockProduct,
} from './support/flows.js';

async function expectStock(page, productName, expected) {
  await page.goto('/panel/stock');
  const row = await searchRow(page, productName, /Buscar por nombre, SKU o variante/i);
  await expect(row.locator('[role="cell"]').nth(2)).toContainText(String(expected));
}

test('@crud @critical eliminar compra revierte exactamente el ingreso de stock', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('COMPRA-DELETE');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('COMPRADEL'),
    stock: 10,
    cost: 100,
    price: 160,
  });
  await createPurchase(page, { productName, quantity: 2, price: 100 });
  await expectStock(page, productName, 12);

  await page.goto('/panel/compras');
  await deletePurchase(page, productName);
  await expectStock(page, productName, 10);
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /imagen/i] });
});

test('@crud @critical eliminar venta revierte exactamente la salida de stock', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('VENTA-DELETE');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('VENTADEL'),
    stock: 10,
    cost: 100,
    price: 200,
  });
  await createSale(page, { productName, quantity: 2, price: 200 });
  await expectStock(page, productName, 8);

  await page.goto('/panel/ventas');
  await deleteSale(page, productName);
  await expectStock(page, productName, 10);
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /imagen/i] });
});
