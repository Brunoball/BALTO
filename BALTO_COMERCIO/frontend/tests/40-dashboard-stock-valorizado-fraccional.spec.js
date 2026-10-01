import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { createStockUnit, deleteStockUnit } from './support/stock-units.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { requireMutations } from './support/ui.js';

async function dashboardStockValue(page) {
  const result = await authenticatedApi(page, 'dashboard_resumen', {
    query: { _: Date.now() },
  });
  const body = expectApiSuccess(result, 'No se pudo leer el Dashboard');
  const value = Number(body?.kpis?.stock_valorizado);
  expect(Number.isFinite(value), 'Dashboard debe devolver stock_valorizado numérico').toBeTruthy();
  return value;
}

test('@dashboard @stock @critical stock valorizado respeta cantidades fraccionarias y usa costo, no venta', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);

  const productName = uniqueName('DASH-STOCK-FRACCIONAL', 65);
  const sku = uniqueSku('DASHFRAC');
  const unitName = uniqueName('DASH-UNIDAD-FRAC', 65);
  const abbreviation = `df${Date.now().toString(36).slice(-6)}`.slice(0, 18);

  let unitId = 0;
  let productCreated = false;

  try {
    const unit = await createStockUnit(page, {
      name: unitName,
      abbreviation,
      decimals: true,
    });
    unitId = Number(unit?.id_stock_unidad || 0);
    expect(unitId).toBeGreaterThan(0);

    const before = await dashboardStockValue(page);

    // Caso exacto que explicó el cliente: 1,575 unidades fraccionarias deben
    // multiplicarse por el costo como 1.575, nunca como 1575.
    // El precio de venta se deja deliberadamente enorme para demostrar que el
    // Dashboard valoriza al COSTO y no al precio de venta.
    await createStockProductFixture(page, {
      name: productName,
      sku,
      stock: 1.575,
      cost: 15000,
      price: 999999,
      unitId,
    });
    productCreated = true;

    const after = await dashboardStockValue(page);
    const delta = after - before;
    const expected = 1.575 * 15000; // 23.625,00

    expect(delta).toBeCloseTo(expected, 2);
    expect(delta).not.toBeCloseTo(1575 * 15000, 0);
    expect(delta).not.toBeCloseTo(1.575 * 999999, 0);
  } finally {
    if (productCreated) {
      await deleteUnusedStockProduct(page, productName).catch((error) => {
        console.warn(`[cleanup dashboard-stock-fraccional] producto: ${error?.message || error}`);
      });
    }
    if (unitId > 0) {
      await deleteStockUnit(page, unitId).catch((error) => {
        console.warn(`[cleanup dashboard-stock-fraccional] unidad: ${error?.message || error}`);
      });
    }
  }
});
