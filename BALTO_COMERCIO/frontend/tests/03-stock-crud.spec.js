import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { requireMutations } from './support/ui.js';
import { createStockProduct, editStockProduct, deleteUnusedStockProduct } from './support/flows.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';

test('@stock @crud @critical stock: alta, edición y eliminación definitiva', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  // Hostinger + escritura + recarga + historial pueden superar los 60 s por defecto.
  test.setTimeout(4 * 60_000);
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

  // La edición normal del modal tiene que persistir el histórico, no sólo
  // cambiar el importe actual. Antes esto sólo lo comprobaba el ajuste masivo.
  const productId = Number(await editedRow.getAttribute('data-stock-product-id'));
  expect(productId).toBeGreaterThan(0);
  const historyResult = await authenticatedApi(page, 'stock_precios_historial_producto', {
    query: { id_stock_producto: productId, limit: 100, _: Date.now() },
  });
  const historyBody = expectApiSuccess(historyResult, 'La edición de Stock debe conservar historial');
  const history = historyBody?.items || historyBody?.data?.items || [];
  const saleChange = history.find((row) =>
    Number(row.id_tipo_precio_stock) === 2 &&
    Math.abs(Number(row.precio_nuevo) - 210) < 0.01 &&
    Math.abs(Number(row.precio_anterior) - 190) < 0.01
  );
  expect(saleChange, 'La edición 190 → 210 debe quedar registrada con el origen BALTO').toBeTruthy();
  expect(String(saleChange.observacion || '')).toMatch(/BALTO|Stock/i);

  await deleteUnusedStockProduct(page, editedName);
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /imagen/i] });
});
