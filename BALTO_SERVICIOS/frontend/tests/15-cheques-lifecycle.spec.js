import { test, expect } from './support/test.js';
import { uniqueChequeNumber, uniqueName, uniqueSku, todayISO } from './support/data.js';
import { requireMutations, searchRow, waitForBusyToFinish } from './support/ui.js';
import {
  createPurchase,
  createSale,
  createStockProduct,
  deleteOtherMovement,
  deletePurchase,
  deleteSale,
} from './support/flows.js';
import {
  createOtherExpenseWithPortfolioCheque,
  createOtherIncomeWithIncomingCheque,
  createPurchaseWithPortfolioCheque,
  createSaleWithIncomingCheque,
  deleteCurrentAccountPaymentViaUi,
  editPurchaseToCurrentAccount,
  extractPaymentId,
  payPayableWithPortfolioCheque,
  payReceivableWithIncomingCheque,
  replaceChequeWithNonCheque,
} from './support/cheques.js';
import { expectChequeEvents, expectChequeState } from './support/api.js';

function buildCheque(label, importe, tipo = 'CHEQUE') {
  return {
    numero: uniqueChequeNumber(),
    // Los formularios de cheques admiten letras y números y normalizan los
    // separadores al guardar. Construimos desde el inicio el valor canónico que
    // realmente debe persistir para poder exigir coincidencia exacta en cartera,
    // depósito, egreso sintético y detalle global.
    emisor: uniqueName(`BANCO-${label}`, 42).replace(/[^A-Z0-9]/g, ''),
    importe,
    tipo,
    fechaEmision: todayISO(),
    fechaPago: todayISO(),
  };
}

function paymentIdFrom(body) {
  return extractPaymentId(body?.data || body);
}

test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(6 * 60_000);
});

async function findChequeRow(page, numero) {
  const search = page.locator('input[placeholder*="Buscar" i]').first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(String(numero));
  await search.press('Enter');
  await page.waitForTimeout(750);
  await waitForBusyToFinish(page);
  const row = page
    .locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)')
    .filter({ hasText: String(numero) })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

test.describe.serial('@crud @critical ciclo profundo de cheques', () => {
  test('venta: el cheque recibido sigue EN_CARTERA aunque se elimine la venta', async ({ page }) => {
    await requireMutations(test, page);
    const productName = uniqueName('CHQ-VENTA-ORIGEN');
    const cheque = buildCheque('VENTA', 121);

    await createStockProduct(page, {
      name: productName,
      sku: uniqueSku('CHQVENTA'),
      stock: 5,
      cost: 70,
      price: 121,
    });
    await createSaleWithIncomingCheque(page, { productName, quantity: 1, price: 121 }, cheque);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');
    await expectChequeEvents(page, cheque.numero, ['INGRESO_CARTERA']);

    await page.goto('/panel/ventas');
    await deleteSale(page, productName);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');
  });

  test('recibo: quitar el cobro no elimina ni da de baja el cheque recibido', async ({ page }) => {
    await requireMutations(test, page);
    const productName = uniqueName('CHQ-RECIBO-ORIGEN');
    const cheque = buildCheque('RECIBO', 132);

    await createStockProduct(page, {
      name: productName,
      sku: uniqueSku('CHQRECIBO'),
      stock: 5,
      cost: 80,
      price: 132,
    });
    const saleData = { productName, quantity: 1, price: 132 };
    // createSale normal fuerza cuenta corriente cuando está disponible.
    await createSale(page, saleData);
    const receipt = await payReceivableWithIncomingCheque(page, productName, cheque);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');

    await deleteCurrentAccountPaymentViaUi(page, {
      kind: 'client',
      partyName: saleData.clientName,
      amount: cheque.importe,
      paymentId: paymentIdFrom(receipt),
    });
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');

    await page.goto('/panel/ventas');
    await deleteSale(page, productName);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');
  });

  test('otros ingresos: editar o eliminar el origen conserva el cheque en cartera', async ({ page }) => {
    await requireMutations(test, page);
    const description = uniqueName('CHQ-OTRO-INGRESO');
    const cheque = buildCheque('INGRESO', 143);

    await createOtherIncomeWithIncomingCheque(page, { description, amount: 143 }, cheque);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');

    await page.goto('/panel/Otrosingresos');
    await replaceChequeWithNonCheque(page, 'income', description);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');

    await page.goto('/panel/Otrosingresos');
    await deleteOtherMovement(page, 'income', description);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');
  });

  test('compras: usar, dejar de usar al editar, reutilizar y liberar al eliminar', async ({ page }) => {
    await requireMutations(test, page);
    const source = uniqueName('CHQ-FONDO-COMPRA');
    const firstProduct = uniqueName('CHQ-COMPRA-EDITAR');
    const secondProduct = uniqueName('CHQ-COMPRA-ELIMINAR');
    const cheque = buildCheque('COMPRA', 154);

    await createOtherIncomeWithIncomingCheque(page, { description: source, amount: 154 }, cheque);
    await createStockProduct(page, {
      name: firstProduct,
      sku: uniqueSku('CHQCMPED'),
      stock: 1,
      cost: 154,
      price: 200,
    });
    await createStockProduct(page, {
      name: secondProduct,
      sku: uniqueSku('CHQCMPDEL'),
      stock: 1,
      cost: 154,
      price: 200,
    });

    await createPurchaseWithPortfolioCheque(page, { productName: firstProduct, price: 154 }, cheque);
    await expectChequeState(page, cheque.numero, 'EGRESADO_CARTERA');

    await page.goto('/panel/compras');
    await editPurchaseToCurrentAccount(page, firstProduct);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');

    await createPurchaseWithPortfolioCheque(page, { productName: secondProduct, price: 154 }, cheque);
    await expectChequeState(page, cheque.numero, 'EGRESADO_CARTERA');
    await page.goto('/panel/compras');
    await deletePurchase(page, secondProduct);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');
  });

  test('orden de pago: al borrar el pago el cheque vuelve a EN_CARTERA', async ({ page }) => {
    await requireMutations(test, page);
    const source = uniqueName('CHQ-FONDO-ORDEN');
    const productName = uniqueName('CHQ-ORDEN-PAGO');
    const cheque = buildCheque('ORDEN', 165);

    await createOtherIncomeWithIncomingCheque(page, { description: source, amount: 165 }, cheque);
    await createStockProduct(page, {
      name: productName,
      sku: uniqueSku('CHQORDEN'),
      stock: 1,
      cost: 165,
      price: 210,
    });
    const purchaseData = { productName, quantity: 1, price: 165 };
    await createPurchase(page, purchaseData);
    const order = await payPayableWithPortfolioCheque(page, productName, cheque);
    await expectChequeState(page, cheque.numero, 'EGRESADO_CARTERA');

    await deleteCurrentAccountPaymentViaUi(page, {
      kind: 'provider',
      partyName: purchaseData.providerName,
      amount: cheque.importe,
      paymentId: paymentIdFrom(order),
    });
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');
  });

  test('otros egresos: editar libera, se puede reutilizar y eliminar vuelve a liberar', async ({ page }) => {
    await requireMutations(test, page);
    const source = uniqueName('CHQ-FONDO-EGRESO');
    const firstExpense = uniqueName('CHQ-EGRESO-EDITAR');
    const secondExpense = uniqueName('CHQ-EGRESO-ELIMINAR');
    const cheque = buildCheque('EGRESO', 176);

    await createOtherIncomeWithIncomingCheque(page, { description: source, amount: 176 }, cheque);
    await createOtherExpenseWithPortfolioCheque(page, { description: firstExpense, amount: 176 }, cheque);
    await expectChequeState(page, cheque.numero, 'EGRESADO_CARTERA');

    await page.goto('/panel/Otrosegresos');
    await replaceChequeWithNonCheque(page, 'expense', firstExpense);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');

    await createOtherExpenseWithPortfolioCheque(page, { description: secondExpense, amount: 176 }, cheque);
    await expectChequeState(page, cheque.numero, 'EGRESADO_CARTERA');
    await page.goto('/panel/Otrosegresos');
    await deleteOtherMovement(page, 'expense', secondExpense);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA');
  });
});

for (const tipo of ['CHEQUE', 'ECHEQ']) {
  test(`@crud @critical ${tipo}: depósito crea egreso visible y Reactivar lo devuelve a cartera`, async ({ page }) => {
    await requireMutations(test, page);
    const cheque = buildCheque(`DEPOSITO-${tipo}`, tipo === 'ECHEQ' ? 188 : 187, tipo);
    const source = uniqueName(`ORIGEN-DEPOSITO-${tipo}`);
    const carteraRoute = tipo === 'ECHEQ' ? '/panel/cheques/echeqs-cartera' : '/panel/cheques/cartera';
    const flujoRoute = tipo === 'ECHEQ' ? '/panel/cheques/flujo-echeqs' : '/panel/cheques/flujo';
    const depositAction = tipo === 'ECHEQ' ? 'echeq_cartera_depositar' : 'cheques_cartera_depositar';
    const reactivateAction = tipo === 'ECHEQ' ? 'echeq_deposito_revertir' : 'cheques_deposito_revertir';
    const depositLabel = tipo === 'ECHEQ' ? 'ECHEQ DEPOSITADO' : 'CHEQUE DEPOSITADO';

    await createOtherIncomeWithIncomingCheque(page, { description: source, amount: cheque.importe }, cheque);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA', tipo);

    await page.goto(carteraRoute);
    await waitForBusyToFinish(page);
    const carteraRow = await findChequeRow(page, cheque.numero);
    await expect(carteraRow).toContainText(cheque.emisor);
    await carteraRow.getByTitle('Depositar en el banco').click();
    const depositDialog = page.getByRole('dialog').filter({ hasText: /Depositar.*en el banco/i }).last();
    await expect(depositDialog).toBeVisible();

    // Estos datos se muestran dentro de inputs readOnly. toContainText() sólo
    // inspecciona nodos de texto y no incluye el atributo value de un input.
    const emisorInput = depositDialog
      .locator('.fl-field')
      .filter({ hasText: /^Emisor$/i })
      .locator('input[readonly]');
    const numeroInput = depositDialog
      .locator('.fl-field')
      .filter({ hasText: /^N° de (?:cheque|echeq)$/i })
      .locator('input[readonly]');
    await expect(emisorInput).toHaveValue(cheque.emisor);
    await expect(numeroInput).toHaveValue(cheque.numero);

    const depositResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).searchParams.get('action') === depositAction,
    );
    await depositDialog.getByRole('button', { name: /^Depositar$/i }).click();
    const depositResponse = await depositResponsePromise;
    const depositBody = await depositResponse.json().catch(() => ({}));
    expect(depositResponse.status()).toBeLessThan(400);
    expect(depositBody?.estado).toBe('DEPOSITADO_BANCO');
    expect(Number(depositBody?.id_movimiento_virtual || depositBody?.id_movimiento || 0)).toBeGreaterThanOrEqual(900_000_000);
    await expect(depositDialog).toBeHidden({ timeout: 30_000 });

    await expectChequeState(page, cheque.numero, 'DEPOSITADO_BANCO', tipo);
    await expectChequeEvents(page, cheque.numero, ['EGRESO_CARTERA', 'DEPOSITADO_BANCO'], tipo);

    await page.goto('/panel/Otrosegresos');
    const expenseRow = await searchRow(page, cheque.numero, /Buscar por descripción/i);
    await expect(expenseRow).toContainText(depositLabel);
    await expect(expenseRow.getByTitle('Editar')).toHaveCount(0);
    await expect(expenseRow.getByTitle('Eliminar')).toHaveCount(0);
    await expenseRow.getByTitle(/Ver información completa del movimiento/i).click();
    const expenseDetail = page.getByRole('dialog').last();
    await expect(expenseDetail).toContainText(depositLabel);
    await expect(expenseDetail).toContainText(cheque.numero);
    await expect(expenseDetail).toContainText(cheque.emisor);
    await expenseDetail.getByRole('button', { name: /Cerrar/i }).click();

    await page.goto('/panel/movimientos');
    const globalRow = await searchRow(
      page,
      cheque.numero,
      /Buscar por descripción, cliente, proveedor, medio de pago/i,
    );
    await expect(globalRow).toContainText(depositLabel);
    await globalRow.getByTitle(/Ver información completa del movimiento/i).click();
    const globalDetail = page.getByRole('dialog').last();
    await expect(globalDetail).toContainText(depositLabel);
    await expect(globalDetail).toContainText(cheque.numero);
    await expect(globalDetail).toContainText(cheque.emisor);
    await globalDetail.getByRole('button', { name: /Cerrar/i }).click();

    await page.goto(flujoRoute);
    await waitForBusyToFinish(page);
    const flowSearch = page.locator('input[placeholder*="Buscar" i]').first();
    await flowSearch.fill(cheque.numero);
    await flowSearch.press('Enter');
    await page.waitForTimeout(750);
    await waitForBusyToFinish(page);
    const depositFlowRow = page
      .locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)')
      .filter({ hasText: cheque.numero })
      .filter({ hasText: /Depositado/i })
      .first();
    await expect(depositFlowRow).toBeVisible({ timeout: 30_000 });
    await depositFlowRow.getByTitle('Reactivar en cartera').click();
    const reactivationDialog = page.getByRole('dialog').filter({ hasText: /Reactivar en cartera/i }).last();
    await expect(reactivationDialog).toContainText(cheque.numero);
    await reactivationDialog.locator('textarea').fill(`REVERSIÓN AUTOMÁTICA ${cheque.numero}`);

    const reactivationResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).searchParams.get('action') === reactivateAction,
    );
    await reactivationDialog.getByRole('button', { name: /Reactivar/i }).last().click();
    const reactivationResponse = await reactivationResponsePromise;
    const reactivationBody = await reactivationResponse.json().catch(() => ({}));
    expect(reactivationResponse.status()).toBeLessThan(400);
    expect(reactivationBody?.evento).toBe('REVERSION_DEPOSITO');
    expect(reactivationBody?.estado).toBe('EN_CARTERA');
    expect(Number(reactivationBody?.id_historial || 0)).toBeGreaterThan(0);
    await expect(reactivationDialog).toBeHidden({ timeout: 30_000 });
    await expectChequeState(page, cheque.numero, 'EN_CARTERA', tipo);

    await page.goto('/panel/Otrosegresos');
    const expenseSearch = page.getByPlaceholder(/Buscar por descripción/i).first();
    await expenseSearch.fill(cheque.numero);
    await expenseSearch.press('Enter');
    await page.waitForTimeout(750);
    await waitForBusyToFinish(page);
    await expect(
      page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: depositLabel }),
      'Al reactivar, el egreso sintético debe desaparecer sin borrar el historial del depósito',
    ).toHaveCount(0, { timeout: 30_000 });

    await page.goto('/panel/movimientos');
    const globalSearch = page.getByPlaceholder(
      /Buscar por descripción, cliente, proveedor, medio de pago/i,
    ).first();
    await globalSearch.fill(cheque.numero);
    await globalSearch.press('Enter');
    await page.waitForTimeout(750);
    await waitForBusyToFinish(page);
    await expect(
      page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: depositLabel }),
      'La reactivación también debe retirar el egreso sintético del listado global',
    ).toHaveCount(0, { timeout: 30_000 });
  });
}
