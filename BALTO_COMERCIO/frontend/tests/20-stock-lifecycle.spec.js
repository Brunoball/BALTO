import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { createStockProduct, deleteUnusedStockProduct } from './support/flows.js';
import { requireMutations, searchRow, waitDialog, waitForBusyToFinish } from './support/ui.js';

async function waitStockAction(page, action, click) {
  const responsePromise = page.waitForResponse(
    (response) => {
      const request = response.request();
      let requestAction = new URL(response.url()).searchParams.get('action') || '';
      if (!requestAction) {
        try {
          requestAction = request.postDataJSON()?.action || '';
        } catch {
          requestAction = '';
        }
      }
      return request.method() === 'POST' && requestAction === action;
    },
    { timeout: 120_000 },
  );
  await click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
}

test('@stock @crud @critical stock: baja, listado de bajas, reactivación y eliminación', async ({ page }) => {
  await requireMutations(test, page);
  const name = uniqueName('STOCK-CICLO-BAJA');
  const sku = uniqueSku('BAJA');

  await createStockProduct(page, {
    name,
    sku,
    stock: 4,
    cost: 90,
    price: 140,
  });

  let row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
  await row.getByTitle('Dar de baja').click();
  const lowDialog = await waitDialog(page, 'Dar de baja producto');
  await waitStockAction(page, 'stock_producto_dar_baja', async () => {
    await lowDialog.getByRole('button', { name: /^Dar de baja$/i }).click();
  });
  await expect(lowDialog).toBeHidden({ timeout: 30_000 });

  await page.getByRole('button', { name: /Ver dados de baja/i }).first().click();
  await waitForBusyToFinish(page);
  row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
  await expect(row).toContainText(/Dado de baja|Inactivo/i);

  await waitStockAction(page, 'stock_producto_reactivar', async () => {
    await row.getByTitle('Dar de alta producto').click();
  });

  await page.getByRole('button', { name: /Ver activos/i }).first().click();
  await waitForBusyToFinish(page);
  row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
  await expect(row).toContainText(name);

  await deleteUnusedStockProduct(page, name);
});
