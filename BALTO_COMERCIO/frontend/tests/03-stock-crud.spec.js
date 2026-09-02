import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { requireMutations } from './support/ui.js';
import { createStockProduct, editStockProduct, deleteUnusedStockProduct } from './support/flows.js';

test('@crud @critical stock: alta, edición y eliminación definitiva', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const originalName = uniqueName('STOCK-CRUD');
  const editedName = `${originalName}-EDITADO`.slice(0, 70);

  await createStockProduct(page, {
    name: originalName,
    sku: uniqueSku('STOCK'),
    stock: 7,
    cost: 120,
    price: 190,
  });

  const editedRow = await editStockProduct(page, originalName, {
    name: editedName,
    stock: 9,
    price: 210,
  });
  const stockCell = editedRow.locator('[role="cell"][data-label="STOCK"]');
  await expect(stockCell).toBeVisible();
  await expect(stockCell).toContainText('9');

  await deleteUnusedStockProduct(page, editedName);
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /imagen/i] });
});
