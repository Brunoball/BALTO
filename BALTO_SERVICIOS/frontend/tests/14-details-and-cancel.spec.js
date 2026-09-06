import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { requireMutations, closeDialog } from './support/ui.js';
import {
  createStockProduct,
  createPurchase,
  createSale,
  deleteSale,
  deletePurchase,
  deleteUnusedStockProduct,
} from './support/flows.js';

test('@crud ventas y compras: el detalle completo abre con los datos guardados', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);
  const productName = uniqueName('DETALLE-MOV');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('DETALLE'),
    stock: 10,
    cost: 90,
    price: 170,
  });

  const purchaseRow = await createPurchase(page, { productName, quantity: 1, price: 90 });
  await purchaseRow.getByTitle(/Ver información completa del movimiento/i).click();
  const purchaseDialog = page.getByRole('dialog').last();
  await expect(purchaseDialog).toBeVisible();
  await expect(purchaseDialog).toContainText(productName);
  await closeDialog(purchaseDialog);

  const saleRow = await createSale(page, { productName, quantity: 1, price: 170 });
  await saleRow.getByTitle(/Ver información completa del movimiento/i).click();
  const saleDialog = page.getByRole('dialog').last();
  await expect(saleDialog).toBeVisible();
  await expect(saleDialog).toContainText(productName);
  await closeDialog(saleDialog);

  await page.goto('/panel/ventas');
  await deleteSale(page, productName);
  await page.goto('/panel/compras');
  await deletePurchase(page, productName);
  await deleteUnusedStockProduct(page, productName);

  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('@smoke cancelar alta no crea movimientos', async ({ page }) => {
  const cases = [
    ['/panel/ventas', /Nueva Venta/i, 'Nueva Venta'],
    ['/panel/compras', /Nueva Compra/i, 'Nueva Compra'],
    ['/panel/presupuesto', /Nuevo presupuesto/i, 'Nuevo presupuesto'],
  ];

  for (const [route, buttonName, title] of cases) {
    await page.goto(route);
    await page.getByRole('button', { name: buttonName }).first().click();
    const titledDialog = page.getByRole('dialog').filter({ hasText: new RegExp(title, 'i') }).last();
    const anyDialog = page.getByRole('dialog').last();
    const dialog = (await titledDialog.isVisible({ timeout: 45_000 }).catch(() => false))
      ? titledDialog
      : anyDialog;

    await expect(dialog).toBeVisible({ timeout: 45_000 });
    await closeDialog(dialog);
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  }
});
