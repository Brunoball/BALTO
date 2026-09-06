import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import {
  clickSaveAndWait,
  fillMovementRow,
  fillPayment,
  requireMutations,
  searchRow,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  selectOptionValues,
  waitDialog,
  waitForBusyToFinish,
} from './support/ui.js';
import {
  createStockProduct,
  createSale,
  applySaleCreditNote,
  applySaleCreditNoteAndCapture,
  openSaleCreditNote,
  configureSaleCreditNote,
  deleteSale,
  deleteUnusedStockProduct,
  openMovementDetail,
} from './support/flows.js';
import { expectServiceStock } from './support/services.js';

const CREDIT_NOTE_MOTIVES = [
  'DEVOLUCION_MERCADERIA',
  'ANULACION_TOTAL',
  'DIFERENCIA_PRECIO',
  'OTRO',
];

const IVA_VALUES = ['0', '10.5', '21', '27'];

function creditNoteId(body) {
  return Number(
    body?.id_nota_credito ??
      body?.data?.id_nota_credito ??
      body?.id_movimiento_nota_credito ??
      body?.data?.id_movimiento_nota_credito ??
      0,
  );
}

function parseArsInput(value) {
  const normalized = String(value ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return Number(normalized || 0);
}


test('@crud @critical venta: contado asigna exactamente el total vigente al medio de pago', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('VENTA-CONTADO');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('VENTACONT'),
    stock: 5,
    cost: 500,
    price: 1000,
  });

  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const dialog = await waitDialog(page, 'Nueva Venta');

  await fillMovementRow(dialog, {
    productName,
    quantity: 1,
    price: 1000,
  });
  await selectFirstAutocomplete(dialog, 'Cliente');

  const typeField = dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first();
  await selectFirstNonEmpty(typeField.locator('select'), /CONTADO/i);

  // BALTO Servicios actual ya no expone el descuento comercial heredado de
  // Comercio. El medio de pago debe cubrir exactamente el total vigente.
  await expect(dialog.getByLabel('Tipo de descuento')).toHaveCount(0);
  await expect(dialog.getByLabel('Valor del descuento')).toHaveCount(0);

  await fillPayment(dialog);
  const amountInput = dialog.locator('.gm-payment-row--amount input').first();
  await expect.poll(async () => parseArsInput(await amountInput.inputValue())).toBeCloseTo(1000, 2);
  await expect(dialog.locator('.gm-payment-totals')).toContainText(/Asignado/i);
  await expect(dialog.locator('.gm-payment-totals')).toContainText(/1\.000,00/);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'ventas_crear_batch',
    { timeout: 90_000 },
  );

  await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 90_000 });
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  const result = body?.data || body;
  const requestPayload = response.request().postDataJSON();

  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
  expect(Number(requestPayload?.total_bruto ?? requestPayload?.total ?? 1000)).toBeCloseTo(1000, 2);
  expect(Number(requestPayload?.descuento_monto || 0)).toBeCloseTo(0, 2);
  expect(Number(result?.monto_total ?? result?.total ?? 0)).toBeCloseTo(1000, 2);
  expect(Number(result?.total_pagado ?? 0)).toBeCloseTo(1000, 2);

  const pagosEnviados = Array.isArray(requestPayload?.medios_pago) ? requestPayload.medios_pago : [];
  expect(pagosEnviados).toHaveLength(1);
  expect(Number(pagosEnviados[0]?.monto || 0)).toBeCloseTo(1000, 2);

  const row = await searchRow(page, productName, /Buscar por descripción, cliente/i);
  await expect(row).toContainText(/1\.000,00/);

  const detail = await openMovementDetail(page, productName, 'sale');
  await expect(detail.getByLabel('Detalle del descuento comercial')).toHaveCount(0);
  const paymentSection = detail.locator('.mdm-section--medios');
  await expect(paymentSection).toContainText(/Total pagado/i);
  await expect(paymentSection).toContainText(/1\.000,00/);

  await detail.getByRole('button', { name: /Cerrar/i }).click();
  await expect(detail).toBeHidden();

  await deleteSale(page, productName);
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical venta: descuenta stock y NC interna reingresa stock', async ({ page }, testInfo) => {
  // En la corrida completa el backend compartido puede tardar bastante más que
  // cuando se ejecuta este archivo solo. El flujo incluye alta, venta, dos NC,
  // reversión y eliminación física del producto; 90 s cortaba durante la
  // verificación final aunque todas las mutaciones principales ya habían pasado.
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('VENTA-NC');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('VENTA'),
    stock: 10,
    cost: 100,
    price: 200,
  });

  await createSale(page, { productName, quantity: 2, price: 200 });
  await applySaleCreditNote(page, productName, 1);

  await expectServiceStock(page, productName, 9);

  // Los ajustes sin stock comparten una rama distinta. Deben exponer todas las
  // opciones, usar el selector cerrado de IVA y conservar el stock.
  await page.goto('/panel/ventas');
  const { dialog } = await openSaleCreditNote(page, productName);
  const motiveSelect = dialog
    .locator('.gm-field')
    .filter({ hasText: /Motivo/i })
    .locator('select')
    .first();
  await expect((await selectOptionValues(motiveSelect)).sort()).toEqual([...CREDIT_NOTE_MOTIVES].sort());

  await configureSaleCreditNote(dialog, {
    motive: 'DIFERENCIA_PRECIO',
    amount: 10,
    ivaPct: 21,
  });

  const ivaSelect = dialog
    .locator('.gm-field')
    .filter({ hasText: /IVA % incluido/i })
    .locator('select')
    .first();
  await expect(await selectOptionValues(ivaSelect)).toEqual(IVA_VALUES);
  await clickSaveAndWait(dialog, /Aplicar nota de crédito/i, { timeout: 60_000 });

  await expectServiceStock(page, productName, 9);

  // La eliminación conjunta debe revertir venta y todas sus NC, dejando el stock original.
  await page.goto('/panel/ventas');
  await deleteSale(page, productName);
  await expectServiceStock(page, productName, 10);
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical NC venta: repetir la misma petición no duplica nota ni stock', async ({ page }, testInfo) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('VENTA-NC-IDEMPOTENCIA');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('VENTANCIDEM'),
    stock: 10,
    cost: 100,
    price: 200,
  });
  await createSale(page, { productName, quantity: 2, price: 200 });

  let firstBody = null;
  let duplicateBody = null;
  let duplicateStatus = 0;

  await page.route('**/api.php?action=ventas_nota_credito_crear**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const payload = request.postDataJSON();
    const firstResponse = await route.fetch();
    firstBody = await firstResponse.json().catch(() => ({}));

    const requestHeaders = request.headers();
    const duplicateHeaders = {};
    for (const name of ['content-type', 'x-session', 'authorization']) {
      if (requestHeaders[name]) duplicateHeaders[name] = requestHeaders[name];
    }

    const duplicateResponse = await page.request.post(request.url(), {
      headers: duplicateHeaders,
      data: payload,
    });
    duplicateStatus = duplicateResponse.status();
    duplicateBody = await duplicateResponse.json().catch(() => ({}));

    await route.fulfill({ response: firstResponse });
  });

  await applySaleCreditNote(page, productName, 1);

  expect(duplicateStatus).toBeLessThan(400);
  const firstId = Number(
    firstBody?.id_nota_credito ??
      firstBody?.data?.id_nota_credito ??
      firstBody?.id_movimiento_nota_credito ??
      firstBody?.data?.id_movimiento_nota_credito ??
      0,
  );
  const duplicateId = Number(
    duplicateBody?.id_nota_credito ??
      duplicateBody?.data?.id_nota_credito ??
      duplicateBody?.id_movimiento_nota_credito ??
      duplicateBody?.data?.id_movimiento_nota_credito ??
      0,
  );
  expect(firstId, 'La primera petición debe crear o recuperar una nota').toBeGreaterThan(0);
  expect(duplicateId, 'La petición repetida debe devolver la misma nota').toBe(firstId);

  await expectServiceStock(page, productName, 9);

  await page.unroute('**/api.php?action=ventas_nota_credito_crear**');
  await page.goto('/panel/ventas');
  await deleteSale(page, productName);
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical NC venta: ejecuta realmente los cuatro motivos actuales y valida su impacto de stock', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(9 * 60_000);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('VENTA-NC-CUATRO-MOTIVOS');
  const totalProductName = uniqueName('VENTA-NC-ANULACION-TOTAL');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('VENTANC4'),
    stock: 12,
    cost: 100,
    price: 200,
  });
  await createStockProduct(page, {
    name: totalProductName,
    sku: uniqueSku('VENTANCTOTAL'),
    stock: 4,
    cost: 100,
    price: 200,
  });
  await createSale(page, { productName, quantity: 6, price: 100 });
  await createSale(page, { productName: totalProductName, quantity: 2, price: 100 });

  const applied = [];
  const apply = async (targetProduct, options) => {
    await page.goto('/panel/ventas');
    const result = await applySaleCreditNoteAndCapture(page, targetProduct, options);
    expect(creditNoteId(result.body), `El motivo ${options.motive} debe crear una nota identificable`).toBeGreaterThan(0);
    applied.push(options.motive);
  };

  await apply(productName, { motive: 'DEVOLUCION_MERCADERIA', quantity: 1 });
  for (const motive of ['DIFERENCIA_PRECIO', 'OTRO']) {
    await apply(productName, { motive, amount: 5, ivaPct: 21 });
  }

  await expectServiceStock(page, productName, 7);

  // La anulación total usa una venta independiente para no mezclarla con los
  // ajustes económicos previos. En la misma venta esos ajustes reducen el saldo
  // disponible, aunque la selección total de unidades conserve su valor bruto.
  await apply(totalProductName, { motive: 'ANULACION_TOTAL' });
  expect([...applied].sort()).toEqual([...CREDIT_NOTE_MOTIVES].sort());

  await expectServiceStock(page, totalProductName, 4);

  await page.goto('/panel/ventas');
  await deleteSale(page, productName);
  await deleteSale(page, totalProductName);
  await deleteUnusedStockProduct(page, productName);
  await deleteUnusedStockProduct(page, totalProductName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});
