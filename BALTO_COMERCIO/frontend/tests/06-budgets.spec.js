import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { ENV } from './support/env.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import {
  closeDialog,
  requireMutations,
  searchRow,
  selectOptionValues,
} from './support/ui.js';
import {
  createStockProduct,
  createBudget,
  prepareBudget,
  convertBudgetToSale,
  deleteBudget,
  prepareBudgetConversion,
  deleteSale,
  deleteUnusedStockProduct,
} from './support/flows.js';

const IVA_VALUES = ['0', '10.5', '21', '27'];

async function authenticatedApiGet(page, actionAndQuery) {
  const apiBase = ENV.apiURL.replace(/\/$/, '');
  return page.evaluate(async ({ url }) => {
    const sessionKey =
      localStorage.getItem('session_key') ||
      localStorage.getItem('sessionKey') ||
      localStorage.getItem('X-Session') ||
      '';
    const token = localStorage.getItem('token') || '';
    const headers = {};
    if (sessionKey) headers['X-Session'] = sessionKey;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(url, { headers });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }, { url: `${apiBase}/api.php?${actionAndQuery}` });
}

test('@crud @critical presupuesto: crear, eliminar y convertir sin doble impacto', async ({ page }, testInfo) => {
  // Este recorrido hace dos altas de stock, dos presupuestos, conversión,
  // validaciones de detalle y limpieza transaccional. En una suite completa el
  // límite general de 90 s puede vencer únicamente durante esa limpieza.
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('PRESUPUESTO-CONVERTIR');
  const disposableName = uniqueName('PRESUPUESTO-ELIMINAR');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('PRESU'),
    stock: 10,
    cost: 100,
    price: 180,
  });
  await createStockProduct(page, {
    name: disposableName,
    sku: uniqueSku('PRESUDEL'),
    stock: 3,
    cost: 80,
    price: 140,
  });

  await createBudget(page, { productName: disposableName, quantity: 1, price: 140, ivaPct: 10.5 });
  await deleteBudget(page, disposableName);

  const budgetData = { productName, quantity: 1, price: 180, ivaPct: 21 };
  await createBudget(page, budgetData);

  // El presupuesto debe quedar realmente persistido en el historial. Se recarga
  // la pantalla para no validar sólo el estado React que acaba de crearlo.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const historyRow = await searchRow(page, productName, /Buscar por descripción/i);
  await historyRow.getByTitle(/Ver información completa del presupuesto/i).click();
  const budgetDetail = page.getByRole('dialog').last();
  await expect(budgetDetail).toContainText(productName);
  await expect(budgetDetail).toContainText(String(budgetData.clientName).split('\n')[0]);
  const budgetItem = budgetDetail
    .locator('.mdm-table--items .mdm-table__row:not(.mdm-table__row--head)')
    .filter({ hasText: productName })
    .first();
  await expect(budgetItem).toBeVisible();
  await expect(budgetItem.locator(':scope > span').nth(1)).toHaveText(/^1(?:[,.]0+)?$/);
  await expect(budgetItem.locator(':scope > span').nth(2)).toContainText(/180[,.]00/);
  await expect(budgetItem.locator(':scope > span').nth(5)).toContainText(/217[,.]80/);
  await closeDialog(budgetDetail);

  await convertBudgetToSale(page, productName);

  // Segundo intento: el botón debe quedar marcado como ya convertido y no crear otra venta.
  const convertedRow = await searchRow(page, productName, /Buscar por descripción/i);
  await expect(convertedRow.getByTitle(/Presupuesto ya asignado como venta/i)).toBeVisible();

  // La venta generada desde el historial debe conservar cliente, producto,
  // cantidad e importe del presupuesto, y existir una sola vez.
  await page.goto('/panel/ventas');
  const convertedSale = await searchRow(page, productName, /Buscar por descripción, cliente/i);
  await convertedSale.getByTitle(/Ver información completa del movimiento/i).click();
  const saleDetail = page.getByRole('dialog').last();
  await expect(saleDetail).toContainText(productName);
  await expect(saleDetail).toContainText(String(budgetData.clientName).split('\n')[0]);
  const convertedItem = saleDetail
    .locator('.mdm-table--items .mdm-table__row:not(.mdm-table__row--head)')
    .filter({ hasText: productName })
    .first();
  await expect(convertedItem.locator(':scope > span').nth(1)).toHaveText(/^1(?:[,.]0+)?$/);
  await expect(convertedItem.locator(':scope > span').nth(2)).toContainText(/180[,.]00/);
  await expect(convertedItem.locator(':scope > span').nth(5)).toContainText(/217[,.]80/);
  await closeDialog(saleDetail);

  await page.goto('/panel/stock');
  const stockRow = await searchRow(page, productName, /Buscar por nombre, SKU o variante/i);
  await expect(stockRow.locator('[role="cell"]').nth(2)).toContainText('9');

  // Eliminar la venta libera la conversión; luego se limpian presupuesto y productos de prueba.
  await page.goto('/panel/ventas');
  await deleteSale(page, productName);
  await page.goto('/panel/presupuesto');
  await deleteBudget(page, productName);
  await page.goto('/panel/stock');
  await deleteUnusedStockProduct(page, productName);
  await deleteUnusedStockProduct(page, disposableName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /PDF/i, /imagen/i] });
});

test('@crud @critical presupuesto: dos pestañas no pueden convertirlo dos veces', async ({ page, context }, testInfo) => {
  // Incluye dos respuestas concurrentes, una tercera página verificadora y la
  // limpieza final. Conservamos timeouts cortos en cada espera, pero permitimos
  // que el recorrido completo soporte la latencia acumulada del backend.
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('PRESUPUESTO-CONCURRENCIA');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('PRESUCONC'),
    stock: 10,
    cost: 100,
    price: 180,
  });
  await createBudget(page, { productName, quantity: 1, price: 180, ivaPct: 21 });

  const secondPage = await context.newPage();
  const first = await prepareBudgetConversion(page, productName);
  await secondPage.goto('/panel/presupuesto');
  const second = await prepareBudgetConversion(secondPage, productName);

  const isConversionResponse = (response) =>
    response.url().includes('action=presupuestos_convertir_venta') &&
    response.request().method() === 'POST';

  const firstResponsePromise = page.waitForResponse(isConversionResponse, { timeout: 60_000 });
  const secondResponsePromise = secondPage.waitForResponse(isConversionResponse, { timeout: 60_000 });

  await Promise.all([first.action.click(), second.action.click()]);
  const [firstResponse, secondResponse] = await Promise.all([
    firstResponsePromise,
    secondResponsePromise,
  ]);

  expect(firstResponse.status()).toBeLessThan(500);
  expect(secondResponse.status()).toBeLessThan(500);

  const [firstBody, secondBody] = await Promise.all([
    firstResponse.json().catch(() => ({})),
    secondResponse.json().catch(() => ({})),
  ]);
  const firstSaleId = Number(firstBody?.id_venta ?? firstBody?.data?.id_venta ?? firstBody?.id_movimiento ?? 0);
  const secondSaleId = Number(secondBody?.id_venta ?? secondBody?.data?.id_venta ?? secondBody?.id_movimiento ?? 0);

  expect(firstSaleId, 'La primera conversión debe devolver una venta').toBeGreaterThan(0);
  expect(secondSaleId, 'El reintento concurrente debe recuperar la misma venta').toBeGreaterThan(0);
  expect(secondSaleId, 'Ambas pestañas deben recibir exactamente el mismo id de venta').toBe(firstSaleId);

  const verifier = await context.newPage();
  await verifier.goto('/panel/ventas');
  await searchRow(verifier, productName, /Buscar por descripción, cliente/i);
  const sales = verifier.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)');
  await expect(sales, 'La búsqueda debe devolver exactamente una venta').toHaveCount(1, { timeout: 30_000 });

  await verifier.goto('/panel/stock');
  const stockRow = await searchRow(verifier, productName, /Buscar por nombre, SKU o variante/i);
  await expect(stockRow.locator('[role="cell"]').nth(2)).toContainText('9');

  // Limpieza controlada: borrar la única venta libera el presupuesto.
  await verifier.goto('/panel/ventas');
  await deleteSale(verifier, productName);
  await verifier.goto('/panel/presupuesto');
  await deleteBudget(verifier, productName);
  await verifier.goto('/panel/stock');
  await deleteUnusedStockProduct(verifier, productName);

  await secondPage.close();
  await verifier.close();
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/ya fue convertido/i, /Tienda Nube/i, /PDF/i, /imagen/i] });
});

test('@crud @critical presupuesto: selector IVA, recálculo backend y rechazo de IVA manipulado', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('PRESUPUESTO-BACKEND');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('PRESUBACK'),
    stock: 5,
    cost: 100,
    price: 200,
  });

  let totalsWereTampered = false;
  await page.route('**/api.php?action=presupuestos_crear**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const payload = request.postDataJSON();
    payload.subtotal = 1;
    payload.iva_monto = 0;
    payload.total = 1;
    payload.monto_total = 1;
    payload.items = (payload.items || []).map((item) => ({
      ...item,
      subtotal: 0.01,
      iva_monto: 0,
      total: 0.01,
    }));
    totalsWereTampered = true;
    await route.continue({ postData: JSON.stringify(payload) });
  });

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('action=presupuestos_crear') &&
      response.request().method() === 'POST',
  );
  await createBudget(page, {
    productName,
    quantity: 1,
    price: 200,
    ivaPct: 21,
  });
  const createResponse = await createResponsePromise;
  const createBody = await createResponse.json();
  const budgetId = Number(createBody?.id_movimiento ?? createBody?.data?.id_movimiento ?? 0);

  expect(totalsWereTampered, 'La prueba debe haber falseado los totales del navegador').toBe(true);
  expect(createResponse.status()).toBe(201);
  expect(budgetId).toBeGreaterThan(0);

  const detailResponse = await authenticatedApiGet(
    page,
    `action=presupuestos_obtener&id_movimiento=${encodeURIComponent(budgetId)}`,
  );
  expect(detailResponse.status).toBe(200);

  const detail = detailResponse.body?.data || detailResponse.body;
  const item = (detail?.items || [])[0] || {};
  const budget = detail?.presupuesto || {};

  expect(Number(item.subtotal)).toBeCloseTo(200, 2);
  expect(Number(item.iva_monto)).toBeCloseTo(42, 2);
  expect(Number(item.total)).toBeCloseTo(242, 2);
  expect(Number(budget.monto_total ?? budget.total)).toBeCloseTo(242, 2);

  await page.unroute('**/api.php?action=presupuestos_crear**');
  await page.goto('/panel/presupuesto');
  await deleteBudget(page, productName);

  let ivaWasTampered = false;
  await page.route('**/api.php?action=presupuestos_crear**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const payload = request.postDataJSON();
    payload.items = (payload.items || []).map((item) => ({
      ...item,
      iva_pct: 15,
      ivaPct: 15,
      iva: 15,
    }));
    ivaWasTampered = true;
    await route.continue({ postData: JSON.stringify(payload) });
  });

  const { dialog, ivaSelect } = await prepareBudget(page, {
    productName,
    quantity: 1,
    price: 200,
    ivaPct: 21,
  });
  await expect(await selectOptionValues(ivaSelect)).toEqual(IVA_VALUES);

  const invalidResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('action=presupuestos_crear') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: /^Guardar$/i }).last().click();
  const invalidResponse = await invalidResponsePromise;
  const invalidBody = await invalidResponse.json().catch(() => ({}));

  expect(ivaWasTampered, 'La prueba debe haber falseado el IVA del navegador').toBe(true);
  expect(invalidResponse.status()).toBe(422);
  expect(String(invalidBody?.mensaje || invalidBody?.message || '')).toMatch(/IVA|10,5|21|27/i);
  await expect(dialog).toBeVisible();
  await closeDialog(dialog);

  await page.unroute('**/api.php?action=presupuestos_crear**');
  await page.goto('/panel/stock');
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [
      /Tienda Nube/i,
      /PDF/i,
      /imagen/i,
      // Esta respuesta 422 confirma que el backend rechazó el IVA adulterado.
      /Failed to load resource: the server responded with a status of 422/i,
    ],
  });
});
