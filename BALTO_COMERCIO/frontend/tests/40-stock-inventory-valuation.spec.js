import { test, expect } from './support/test.js';
import * as XLSX from 'xlsx';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { getStockE2EFixtureUnit } from './support/stock-units.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { requireMutations, waitDialog, waitForBusyToFinish } from './support/ui.js';

function reportPayload(body) {
  return body?.data && body.data?.tipo ? body.data : body || {};
}

test('@stock @reportes @critical inventario valoriza el stock real y Excel conserva las fórmulas según la unidad habilitada', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);

  // No se prueba la integración Tienda Nube: solo se respeta la política
  // real del tenant. Con TN conectada el backend expone exclusivamente UNIDAD.
  // Sin TN se prioriza una unidad fraccionable para conservar esa regresión.
  const unit = await getStockE2EFixtureUnit(page, { preferFractional: true });
  const quantity = unit.fractional ? 1.575 : 2;
  const cost = 15000;
  const salePrice = 26778;
  const expectedCost = quantity * cost;
  const expectedSale = quantity * salePrice;
  if (unit.tnConnected) {
    expect(unit.fractional, 'Tienda Nube conectada no debe exponer una unidad decimal').toBe(false);
    expect(Number(unit.permite_decimales || 0)).toBe(0);
  }

  const productName = uniqueName('STOCK-VALUACION-REPORTE', 65);
  const sku = uniqueSku('VALREP');
  let created = false;

  try {
    await createStockProductFixture(page, {
      name: productName,
      sku,
      stock: quantity,
      cost,
      price: salePrice,
      unitId: Number(unit.id_stock_unidad),
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
    expect(Number(row.stock)).toBeCloseTo(quantity, unit.fractional ? 3 : 0);
    expect(Number(row.precio_costo)).toBeCloseTo(cost, 2);
    expect(Number(row.precio_venta)).toBeCloseTo(salePrice, 2);
    expect(Number(row.valor_costo), 'La valorización al costo debe multiplicar el stock real').toBeCloseTo(expectedCost, 5);
    expect(Number(row.valor_venta), 'La valorización potencial debe multiplicar el stock real').toBeCloseTo(expectedSale, 5);

    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);

    // Regresion: Stock se actualiza mientras la peticion del modal esta
    // pendiente. Eso provoca un rerender del padre y antes cancelaba el
    // resultado aunque la API respondiera HTTP 200, dejando "Generando...".
    let releaseReportRequest;
    const reportGate = new Promise((resolve) => { releaseReportRequest = resolve; });
    const reportEndpoint = '**/*action=stock_reportes_generar*';
    // Sincronizacion explicita: NO retirar la ruta hasta que su handler haya
    // terminado. Si se ejecuta unroute inmediatamente despues de liberar el
    // gate, Playwright puede resolver la ruta por su cuenta y continue() falla
    // con "Route is already handled!", cancelando la descarga posterior.
    let notifyIntercepted;
    const reportIntercepted = new Promise((resolve) => { notifyIntercepted = resolve; });
    let notifyRouteFinished;
    const reportRouteFinished = new Promise((resolve) => { notifyRouteFinished = resolve; });
    let routeWasIntercepted = false;
    const holdReportRequest = async (route) => {
      routeWasIntercepted = true;
      notifyIntercepted();
      try {
        await reportGate;
        await route.continue();
      } finally {
        notifyRouteFinished();
      }
    };
    await page.route(reportEndpoint, holdReportRequest);
    let dialog;
    try {
      const modalReportRequest = page.waitForRequest(
        (request) => request.url().includes('action=stock_reportes_generar'),
        { timeout: 15_000 },
      );
      await page.getByRole('button', { name: /Reportes de Stock/i }).first().click();
      dialog = await waitDialog(page, 'Reportes de Stock');
      await modalReportRequest;
      // waitForRequest se activa antes de que el callback de page.route pueda
      // empezar a ejecutarse; esperar la entrada real evita otra carrera.
      await reportIntercepted;
      await expect(dialog.getByRole('button', { name: /Generando/i })).toBeDisabled();

      // Fuerza el refresco desde el mismo evento que escucha Stock en produccion.
      // Se espera su GET antes de liberar el reporte para que React ya haya
      // podido renderizar al padre con un onClose nuevo.
      const refresh = page.waitForResponse(
        (response) => response.url().includes('action=stock_productos_listar') && response.request().method() === 'GET',
        { timeout: 30_000 },
      );
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('balto:stock-updated')));
      await refresh;
      await page.waitForTimeout(200);
    } finally {
      releaseReportRequest();
      if (routeWasIntercepted) {
        // Esperar continue() ANTES de desmontar el handler: elimina la carrera
        // que aparecia en el test sin alterar los tiempos de la aplicacion.
        await reportRouteFinished;
      }
      await page.unroute(reportEndpoint, holdReportRequest);
    }

    const reportType = dialog.getByRole('combobox', { name: 'Tipo de reporte' });
    await expect(reportType).toHaveValue('inventario_general');
    // Esperar el estado final en vez de asumir que el reporte ya aparecio
    // al abrir el modal. Si queda generando, falla por una razon real.
    await expect(dialog.getByRole('button', { name: /Generar reporte/i })).toBeEnabled({ timeout: 30_000 });
    await expect(
      dialog.getByRole('heading', { name: 'Inventario general', exact: true })
    ).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(productName, { exact: true })).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Exportar Excel/i }).click();
    const download = await downloadPromise;
    const outputPath = testInfo.outputPath('inventario-general-valoracion.xlsx');
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
    expect(Number(sheet[valueCostAddress]?.v)).toBeCloseTo(expectedCost, 5);
    expect(Number(sheet[valueSaleAddress]?.v)).toBeCloseTo(expectedSale, 5);
  } finally {
    if (created) {
      await deleteUnusedStockProduct(page, productName).catch(() => {});
    }
  }
});
