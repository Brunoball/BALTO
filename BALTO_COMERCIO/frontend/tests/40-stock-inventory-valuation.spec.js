import { test, expect } from './support/test.js';
import * as XLSX from 'xlsx';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { listStockUnits } from './support/stock-units.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { requireMutations, waitDialog, waitForBusyToFinish } from './support/ui.js';

function reportPayload(body) {
  return body?.data && body.data?.tipo ? body.data : body || {};
}

test('@stock @reportes @critical inventario fraccionario valoriza stock real × precio unitario y Excel conserva las fórmulas', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);

  const units = await listStockUnits(page, 'todos');
  const fractionalUnit = units.find((unit) =>
    Number(unit?.activo ?? 1) === 1 &&
    Number(unit?.permite_decimales || 0) === 1,
  );
  expect(fractionalUnit, 'Debe existir una unidad fraccionable activa para validar kg/litros').toBeTruthy();

  const productName = uniqueName('STOCK-VALUACION-FRACC', 65);
  const sku = uniqueSku('VALFRAC');
  let created = false;

  try {
    await createStockProductFixture(page, {
      name: productName,
      sku,
      stock: 1.575,
      cost: 15000,
      price: 26778,
      unitId: Number(fractionalUnit.id_stock_unidad),
    });
    created = true;

    const reportResult = await authenticatedApi(page, 'stock_reportes_generar', {
      query: { tipo: 'inventario_general', _: Date.now() },
    });
    const reportBody = expectApiSuccess(reportResult, 'No se pudo generar Inventario general');
    const report = reportPayload(reportBody);
    const rows = Array.isArray(report?.filas) ? report.filas : [];
    const row = rows.find((item) => String(item?.sku || '').trim().toUpperCase() === sku.toUpperCase());

    expect(row, `El reporte debe incluir el producto ${sku}`).toBeTruthy();
    expect(Number(row.stock)).toBeCloseTo(1.575, 3);
    expect(Number(row.precio_costo)).toBeCloseTo(15000, 2);
    expect(Number(row.precio_venta)).toBeCloseTo(26778, 2);
    expect(Number(row.valor_costo), '1,575 × $15.000 debe valorizar $23.625').toBeCloseTo(23625, 5);
    expect(Number(row.valor_venta), '1,575 × $26.778 debe valorizar $42.175,35').toBeCloseTo(42175.35, 5);

    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Reportes de Stock/i }).first().click();
    const dialog = await waitDialog(page, 'Reportes de Stock');
    const reportType = dialog.getByRole('combobox', { name: 'Tipo de reporte' });
    await expect(reportType).toHaveValue('inventario_general');
    await expect(
      dialog.getByRole('heading', { name: 'Inventario general', exact: true })
    ).toBeVisible();
    await expect(dialog.getByText(productName, { exact: true })).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Exportar Excel/i }).click();
    const download = await downloadPromise;
    const outputPath = testInfo.outputPath('inventario-general-fraccional.xlsx');
    await download.saveAs(outputPath);

    const workbook = XLSX.readFile(outputPath, { cellDates: false, cellFormula: true });
    const sheet = workbook.Sheets['Reporte Stock'];
    expect(sheet, 'El XLSX debe contener la hoja Reporte Stock').toBeTruthy();

    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    const headerRowIndex = matrix.findIndex((values) =>
      Array.isArray(values) &&
      values.includes('Stock') &&
      values.includes('Precio costo') &&
      values.includes('Precio venta') &&
      values.includes('Valuación costo') &&
      values.includes('Potencial venta'),
    );
    expect(headerRowIndex, 'Debe existir la cabecera del inventario exportado').toBeGreaterThanOrEqual(0);

    const headers = matrix[headerRowIndex];
    const productColumn = headers.indexOf('Producto');
    const stockColumn = headers.indexOf('Stock');
    const costColumn = headers.indexOf('Precio costo');
    const saleColumn = headers.indexOf('Precio venta');
    const valueCostColumn = headers.indexOf('Valuación costo');
    const valueSaleColumn = headers.indexOf('Potencial venta');
    const dataRowIndex = matrix.findIndex((values, index) =>
      index > headerRowIndex && String(values?.[productColumn] || '').trim() === productName,
    );
    expect(dataRowIndex, `El XLSX debe contener ${productName}`).toBeGreaterThan(headerRowIndex);

    const stockAddress = XLSX.utils.encode_cell({ r: dataRowIndex, c: stockColumn });
    const costAddress = XLSX.utils.encode_cell({ r: dataRowIndex, c: costColumn });
    const saleAddress = XLSX.utils.encode_cell({ r: dataRowIndex, c: saleColumn });
    const valueCostAddress = XLSX.utils.encode_cell({ r: dataRowIndex, c: valueCostColumn });
    const valueSaleAddress = XLSX.utils.encode_cell({ r: dataRowIndex, c: valueSaleColumn });

    expect(sheet[valueCostAddress]?.f).toBe(`${stockAddress}*${costAddress}`);
    expect(sheet[valueSaleAddress]?.f).toBe(`${stockAddress}*${saleAddress}`);
    expect(Number(sheet[valueCostAddress]?.v)).toBeCloseTo(23625, 5);
    expect(Number(sheet[valueSaleAddress]?.v)).toBeCloseTo(42175.35, 5);
  } finally {
    if (created) {
      await deleteUnusedStockProduct(page, productName).catch(() => {});
    }
  }
});
