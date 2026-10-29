import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { createStockProduct, deleteUnusedStockProduct } from './support/flows.js';
import { requireMutations, searchRow, waitDialog, waitForBusyToFinish } from './support/ui.js';

// Un worker de Node/Playwright puede finalizar nativamente en Windows (0xC0000409)
// antes de ejecutar el test. Un solo retry recupera ese cierre accidental y
// lo deja marcado como 'flaky' en el reporte, sin alterar el flujo de Stock.
// Si una aserción funcional falla dos veces, el test continúa fallando.
test.describe.configure({ retries: process.platform === 'win32' ? 1 : 0 });

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

  await page.getByRole('tab', { name: /^Dados de baja$/i }).click();
  await expect(page.getByRole('tab', { name: /^Dados de baja$/i })).toHaveAttribute('aria-selected', 'true');
  await waitForBusyToFinish(page);
  row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
  await expect(row).toContainText(/Dado de baja|Inactivo/i);

  await waitStockAction(page, 'stock_producto_reactivar', async () => {
    await row.getByTitle('Dar de alta producto').click();
  });

  await page.getByRole('tab', { name: /^Activos$/i }).click();
  await expect(page.getByRole('tab', { name: /^Activos$/i })).toHaveAttribute('aria-selected', 'true');
  await waitForBusyToFinish(page);
  row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
  await expect(row).toContainText(name);

  await deleteUnusedStockProduct(page, name);
});

// Verificación de la navegación nueva, incluso cuando el tenant no tiene productos de baja.
// No crea, elimina ni modifica ningún registro y puede usarse para el smoke de despliegue.
test('@stock @ui @critical stock: pestañas Activos / Dados de baja consultan el estado correcto', async ({ page }) => {
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);

  const tabs = page.getByRole('tablist', { name: 'Vista de productos de stock' });
  const activos = tabs.getByRole('tab', { name: 'Activos', exact: true });
  const bajas = tabs.getByRole('tab', { name: 'Dados de baja', exact: true });
  await expect(activos).toHaveAttribute('aria-selected', 'true');
  await expect(bajas).toHaveAttribute('aria-selected', 'false');

  const stockListResponse = (activo) => page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') return false;
    try {
      const url = new URL(response.url());
      return url.searchParams.get('action') === 'stock_productos_listar'
        && url.searchParams.get('activo') === String(activo);
    } catch {
      return false;
    }
  }, { timeout: 30_000 });

  const bajasResponsePromise = stockListResponse(0);
  await bajas.click();
  const bajasResponse = await bajasResponsePromise;
  expect(bajasResponse.status()).toBeLessThan(400);
  await expect(bajas).toHaveAttribute('aria-selected', 'true');
  await expect(activos).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('button', { name: 'Agregar producto', exact: true }).first()).toBeDisabled();

  const activosResponsePromise = stockListResponse(1);
  await activos.click();
  const activosResponse = await activosResponsePromise;
  expect(activosResponse.status()).toBeLessThan(400);
  await expect(activos).toHaveAttribute('aria-selected', 'true');
  await expect(bajas).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('button', { name: 'Agregar producto', exact: true }).first()).toBeEnabled();
});
