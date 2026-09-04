import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import {
  clickSaveAndWait,
  closeDialog,
  fillMovementRow,
  fillPayment,
  requireMutations,
  searchRow,
  selectFirstAutocomplete,
  selectMovementMode,
  waitDialog,
  waitForBusyToFinish,
} from './support/ui.js';
import {
  applyPurchaseCreditNoteAndCapture,
  applySaleCreditNoteAndCapture,
  createBudget,
  createOtherExpense,
  createOtherIncome,
  createPurchase,
  createSale,
  createStockProduct,
} from './support/flows.js';

function movementContainsDescription(movement, description) {
  const expected = String(description || '').trim().toUpperCase();
  const items = [
    ...(Array.isArray(movement?.items_detalle) ? movement.items_detalle : []),
    ...(Array.isArray(movement?.items_detalle_original) ? movement.items_detalle_original : []),
  ];

  return items.some((item) =>
    [item?.descripcion, item?.detalle, item?.nombre, item?.producto_nombre, item?.stock_producto_nombre]
      .some((value) => String(value || '').trim().toUpperCase().includes(expected)),
  );
}

function parseDisplayedNumber(value) {
  let normalized = String(value || '').replace(/[^0-9,.-]/g, '');
  if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
  return Number(normalized);
}

async function expectMoney(locator, expected, label) {
  const text = await locator.innerText();
  expect(parseDisplayedNumber(text), `${label}: se mostró "${text}"`).toBeCloseTo(expected, 2);
}

async function expectMovementDetail(dialog, expected) {
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog, 'El modal debe mostrar el concepto/producto exacto').toContainText(expected.description);
  if (expected.thirdParty) {
    await expect(dialog, 'El modal debe mostrar el cliente/proveedor correcto').toContainText(expected.thirdParty);
  }

  const itemRow = dialog
    .locator('.mdm-table--items .mdm-table__row:not(.mdm-table__row--head)')
    .filter({ hasText: expected.description })
    .first();
  await expect(itemRow, `Debe existir la línea de detalle ${expected.description}`).toBeVisible({ timeout: 20_000 });
  const cells = itemRow.locator(':scope > span');
  await expect(cells).toHaveCount(6);
  expect(
    parseDisplayedNumber(await cells.nth(1).innerText()),
    'La cantidad del modal debe coincidir con la guardada',
  ).toBeCloseTo(expected.quantity, 3);
  await expectMoney(cells.nth(2), expected.price, 'Precio incorrecto en el modal');
  await expectMoney(cells.nth(5), expected.total, 'Total incorrecto en el modal');
}

async function openModuleDetail(row, expected, title = /Ver información completa/i) {
  await row.getByTitle(title).click();
  const dialog = row.page().getByRole('dialog').last();
  await expectMovementDetail(dialog, expected);
  await closeDialog(dialog);
}

async function assertGlobalDetail(page, query, expected) {
  await page.goto('/panel/movimientos');
  await waitForBusyToFinish(page);

  // Regex ASCII para evitar problemas de encoding en Windows/PowerShell.
  const search = page.getByPlaceholder(
    /Buscar por descripci.n, cliente, proveedor, medio de pago/i,
  ).first();
  await expect(search).toBeVisible();

  const responsePromise = page.waitForResponse(
    (response) => {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return url.searchParams.get('action') === 'movimientos_listar' && url.searchParams.get('q') === query;
    },
    { timeout: 45_000 },
  );

  await search.fill(query);
  await search.press('Enter');
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);

  const returned = Array.isArray(body?.movimientos) ? body.movimientos : [];
  const exactIndex = returned.findIndex((movement) => {
    const items = Array.isArray(movement?.items_detalle) ? movement.items_detalle : [];
    return items.some((item) =>
      [item?.descripcion, item?.detalle, item?.nombre, item?.producto_nombre, item?.stock_producto_nombre]
        .some((value) => String(value || '').includes(expected.description)),
    );
  });
  expect(
    exactIndex,
    `La búsqueda global debe devolver el movimiento que contiene ${expected.description}`,
  ).toBeGreaterThanOrEqual(0);

  const exactMovement = returned[exactIndex];
  const movementId = Number(
    exactMovement?.id_movimiento ??
    exactMovement?.idMovimiento ??
    exactMovement?.id ??
    0,
  );
  expect(
    movementId,
    `El movimiento global de ${expected.description} debe exponer su ID real`,
  ).toBeGreaterThan(0);

  await waitForBusyToFinish(page);

  // La grilla global actual no expone data-movement-id en sus filas.
  // El conteo puede coincidir mientras React todavía muestra la búsqueda anterior,
  // por eso además validamos tipo y monto antes de abrir el modal.
  const rows = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)');
  await expect(
    rows,
    `La grilla debe renderizar los ${returned.length} movimientos devueltos por el backend`,
  ).toHaveCount(returned.length, { timeout: 30_000 });

  const row = rows.nth(exactIndex);
  await expect(
    row,
    `La grilla debe renderizar en la posición ${exactIndex} el movimiento #${movementId} de ${expected.description}`,
  ).toBeVisible({ timeout: 30_000 });

  const expectedType = String(
    exactMovement?.tipo_label ??
    exactMovement?.tipo_operacion_nombre ??
    exactMovement?.tipo_operacion ??
    exactMovement?.tipo_movimiento_general ??
    exactMovement?.tipo_general ??
    exactMovement?.operacion ??
    '',
  ).trim();
  if (expectedType) {
    await expect(
      row.locator('[data-label="TIPO"]'),
      `La grilla debe haber terminado de renderizar el movimiento #${movementId}`,
    ).toHaveText(expectedType, { timeout: 30_000 });
  }

  const expectedTotal = Number(
    exactMovement?.monto_total ??
    exactMovement?.monto_total_final ??
    exactMovement?.total ??
    exactMovement?.importe_total ??
    exactMovement?.monto ??
    exactMovement?.importe,
  );
  if (Number.isFinite(expectedTotal)) {
    await expect
      .poll(
        async () => parseDisplayedNumber(await row.locator('[data-label="MONTO"]').innerText()),
        {
          message: `La grilla debe mostrar el monto del movimiento #${movementId}`,
          timeout: 30_000,
        },
      )
      .toBeCloseTo(expectedTotal, 2);
  }

  await openModuleDetail(row, expected, /Ver informaci.n completa del movimiento/i);
}

async function createCashSale(page, data) {
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const dialog = await waitDialog(page, 'Nueva Venta');

  await fillMovementRow(dialog, {
    productName: data.productName,
    quantity: data.quantity,
    price: data.price,
  });
  data.clientName = await selectFirstAutocomplete(dialog, 'Cliente');

  const mode = await selectMovementMode(dialog, 'Forma de venta', /CONTADO/i);
  expect(mode.text, 'La venta de esta prueba debe registrarse de contado').toMatch(/CONTADO/i);
  await fillPayment(dialog);

  await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 60_000 });
  return searchRow(page, data.productName, /Buscar por descripción, cliente/i);
}

test('@crud @critical modales: cada módulo y Movimientos muestran los datos exactos guardados', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(8 * 60_000);

  const purchaseProduct = uniqueName('DETALLE-COMPRA');
  const saleProduct = uniqueName('DETALLE-VENTA');
  const incomeDescription = uniqueName('DETALLE-INGRESO');
  const expenseDescription = uniqueName('DETALLE-EGRESO');
  const budgetProduct = uniqueName('DETALLE-PRESUPUESTO');

  await createStockProduct(page, {
    name: purchaseProduct,
    sku: uniqueSku('DETCOMPRA'),
    stock: 3,
    cost: 137,
    price: 190,
  });
  await createStockProduct(page, {
    name: saleProduct,
    sku: uniqueSku('DETVENTA'),
    stock: 10,
    cost: 120,
    price: 211,
  });
  await createStockProduct(page, {
    name: budgetProduct,
    sku: uniqueSku('DETPRESU'),
    stock: 10,
    cost: 100,
    price: 199,
  });

  const purchaseData = { productName: purchaseProduct, quantity: 2, price: 137 };
  const purchaseRow = await createPurchase(page, purchaseData);
  const purchaseExpected = {
    description: purchaseProduct,
    thirdParty: String(purchaseData.providerName || '').split('\n')[0].trim(),
    quantity: 2,
    price: 137,
    total: 274,
  };
  await openModuleDetail(purchaseRow, purchaseExpected);

  const saleData = { productName: saleProduct, quantity: 3, price: 211 };
  const saleRow = await createSale(page, saleData);
  const saleExpected = {
    description: saleProduct,
    thirdParty: String(saleData.clientName || '').split('\n')[0].trim(),
    quantity: 3,
    price: 211,
    total: 633,
  };
  await openModuleDetail(saleRow, saleExpected);

  const incomeRow = await createOtherIncome(page, {
    description: incomeDescription,
    quantity: 2,
    amount: 83,
  });
  const incomeExpected = {
    description: incomeDescription,
    quantity: 2,
    price: 83,
    total: 166,
  };
  await openModuleDetail(incomeRow, incomeExpected);

  const expenseRow = await createOtherExpense(page, {
    description: expenseDescription,
    quantity: 3,
    amount: 47,
  });
  const expenseExpected = {
    description: expenseDescription,
    quantity: 3,
    price: 47,
    total: 141,
  };
  await openModuleDetail(expenseRow, expenseExpected);

  const budgetData = { productName: budgetProduct, quantity: 4, price: 199, ivaPct: 0 };
  const budgetRow = await createBudget(page, budgetData);
  const budgetExpected = {
    description: budgetProduct,
    thirdParty: String(budgetData.clientName || '').split('\n')[0].trim(),
    quantity: 4,
    price: 199,
    total: 796,
  };
  await openModuleDetail(budgetRow, budgetExpected, /Ver información completa del presupuesto/i);

  // Recibos y Órdenes de Pago deben mostrar el mismo detalle exacto de la deuda origen.
  await page.goto('/panel/recibos');
  const receiptDebt = await searchRow(page, saleProduct, /Buscar por descripción, cliente/i);
  await openModuleDetail(receiptDebt, saleExpected, /Ver detalle de la deuda/i);

  await page.goto('/panel/OrdenesPago');
  const payableDebt = await searchRow(page, purchaseProduct, /Buscar por descripción, proveedor/i);
  await openModuleDetail(payableDebt, purchaseExpected, /Ver detalle de la deuda/i);

  // La vista central debe conservar exactamente los mismos datos, no una descripción mezclada.
  await assertGlobalDetail(page, purchaseProduct, purchaseExpected);
  await assertGlobalDetail(page, saleProduct, saleExpected);
  await assertGlobalDetail(page, incomeDescription, incomeExpected);
  await assertGlobalDetail(page, expenseDescription, expenseExpected);
  await assertGlobalDetail(page, budgetProduct, budgetExpected);
});

test('@crud @critical Movimientos: unifica venta y NC parcial con total y pago vigentes', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(5 * 60_000);

  const productName = uniqueName('MOVIMIENTO-NC-UNIFICADA');
  const quantity = 2;
  const price = 300;
  const originalTotal = 600;
  const returnedQuantity = 1;
  const creditTotal = 300;
  const currentTotal = 300;

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('MOVNCUNI'),
    stock: 10,
    cost: 150,
    price,
  });
  await createCashSale(page, { productName, quantity, price });

  const creditResult = await applySaleCreditNoteAndCapture(page, productName, {
    motive: 'DEVOLUCION_MERCADERIA',
    quantity: returnedQuantity,
  });
  const creditMovementId = Number(
    creditResult.body?.id_movimiento_nc ??
      creditResult.body?.data?.id_movimiento_nc ??
      creditResult.body?.id_movimiento_nota_credito ??
      creditResult.body?.data?.id_movimiento_nota_credito ??
      0,
  );

  await page.goto('/panel/movimientos');
  await waitForBusyToFinish(page);
  const search = page.getByPlaceholder(
    /Buscar por descripción, cliente, proveedor, medio de pago/i,
  ).first();
  await expect(search).toBeVisible();

  const responsePromise = page.waitForResponse(
    (response) => {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return url.searchParams.get('action') === 'movimientos_listar' && url.searchParams.get('q') === productName;
    },
    { timeout: 45_000 },
  );
  await search.fill(productName);
  await search.press('Enter');

  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);

  const returned = Array.isArray(body?.movimientos) ? body.movimientos : [];
  const matching = returned.filter((movement) => movementContainsDescription(movement, productName));
  expect(matching, 'Movimientos debe devolver una única fila para la venta y su NC').toHaveLength(1);

  const movement = matching[0];
  expect(Number(movement?.tiene_nota_credito || 0)).toBe(1);
  expect(Number(movement?.monto_total_original)).toBeCloseTo(originalTotal, 2);
  expect(Number(movement?.monto_acreditado)).toBeCloseTo(creditTotal, 2);
  expect(Number(movement?.monto_total)).toBeCloseTo(currentTotal, 2);
  expect(movement?.notas_credito_detalle).toHaveLength(1);
  const creditNote = movement.notas_credito_detalle[0];
  expect(Number(creditNote?.total)).toBeCloseTo(creditTotal, 2);
  expect(creditNote?.items_detalle, 'La NC debe informar los productos acreditados').toHaveLength(1);
  expect(
    String(creditNote.items_detalle[0]?.nombre || creditNote.items_detalle[0]?.descripcion || ''),
  ).toContain(productName);
  expect(Number(creditNote.items_detalle[0]?.cantidad)).toBeCloseTo(returnedQuantity, 3);
  expect(Number(creditNote.items_detalle[0]?.total)).toBeCloseTo(creditTotal, 2);
  const hiddenCreditMovementId = creditMovementId || Number(
    creditNote?.id_movimiento_nc || 0,
  );
  expect(hiddenCreditMovementId, 'La respuesta debe identificar el movimiento contable de la NC').toBeGreaterThan(0);
  expect(
    returned.some((row) => Number(row?.id_movimiento) === hiddenCreditMovementId),
    'El movimiento contable de la NC no debe mostrarse como una segunda fila',
  ).toBe(false);

  const payments = Array.isArray(movement?.medios_pago_detalle)
    ? movement.medios_pago_detalle
    : [];
  expect(payments.length, 'La venta de contado debe conservar su medio de pago').toBeGreaterThan(0);
  const paidTotal = payments.reduce(
    (sum, payment) => sum + Number(payment?.monto_aplicado ?? payment?.monto ?? 0),
    0,
  );
  expect(paidTotal, 'El medio de pago debe quedar limitado al total vigente').toBeCloseTo(currentTotal, 2);

  await waitForBusyToFinish(page);
  const rows = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)');
  await expect(rows, 'La búsqueda no debe mostrar una fila separada para la NC').toHaveCount(1);
  const row = rows.first();
  await expectMoney(row.locator('[role="cell"]').nth(4), currentTotal, 'Monto vigente incorrecto en la tabla');

  await row.getByTitle(/Ver información completa del movimiento/i).click();
  const detail = page.getByRole('dialog').last();
  await expect(detail).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByLabel('Trazabilidad de notas de crédito')).toBeVisible();
  await expect(detail).toContainText('Venta ajustada por nota de crédito');
  await expectMoney(
    detail.locator('.mdm-total-chip--original b'),
    originalTotal,
    'Importe original incorrecto en el resumen de la NC',
  );
  await expectMoney(
    detail.locator('.mdm-total-chip--credit b'),
    -creditTotal,
    'Importe acreditado incorrecto en el resumen de la NC',
  );
  await expectMoney(
    detail.locator('.mdm-total-chip--current b'),
    currentTotal,
    'Total vigente incorrecto en el modal',
  );

  await detail.getByTitle('Ver detalle de la nota de crédito').click();
  await expect(detail).toContainText(/Devolucion Mercaderia/i);
  await expect(detail).toContainText(/Interna/i);
  const creditedItem = detail
    .getByLabel('Productos acreditados')
    .locator('.mdm-credit-note__item')
    .filter({ hasText: productName })
    .first();
  await expect(creditedItem, 'El modal debe identificar el producto devuelto').toBeVisible();
  await expect(creditedItem).toContainText(`Cant. ${returnedQuantity}`);
  await expectMoney(
    creditedItem.locator('.mdm-credit-note__item-total'),
    creditTotal,
    'Importe incorrecto del producto devuelto',
  );
  await expectMoney(
    detail.locator('.mdm-medio-card__amount').first(),
    currentTotal,
    'Monto vigente incorrecto en el medio de pago',
  );
  await expectMoney(
    detail.locator('.mdm-total-paid-chip b'),
    currentTotal,
    'Total pagado incorrecto después de la NC',
  );

  const originalItem = detail
    .locator('.mdm-table--items .mdm-table__row:not(.mdm-table__row--head)')
    .filter({ hasText: productName })
    .first();
  await expect(originalItem).toBeVisible();
  await expectMoney(
    originalItem.locator(':scope > span').nth(5),
    originalTotal,
    'El detalle original de la venta debe conservarse',
  );
  await closeDialog(detail);

  // Ventas reutiliza el modal global, pero obtiene los datos desde su propio
  // endpoint. Debe exponer el mismo producto acreditado que Movimientos.
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  const saleRow = await searchRow(page, productName, /Buscar por descripción, cliente/i);
  await saleRow.getByTitle(/Ver información completa del movimiento/i).click();

  const saleDetail = page.getByRole('dialog').last();
  await expect(saleDetail).toBeVisible({ timeout: 30_000 });
  await expect(saleDetail.getByLabel('Trazabilidad de notas de crédito')).toBeVisible();
  await saleDetail.getByTitle('Ver detalle de la nota de crédito').click();

  const saleCreditedItem = saleDetail
    .getByLabel('Productos acreditados')
    .locator('.mdm-credit-note__item')
    .filter({ hasText: productName })
    .first();
  await expect(
    saleCreditedItem,
    'El modal abierto desde Ventas debe identificar el producto devuelto',
  ).toBeVisible();
  await expect(saleCreditedItem).toContainText(`Cant. ${returnedQuantity}`);
  await expectMoney(
    saleCreditedItem.locator('.mdm-credit-note__item-total'),
    creditTotal,
    'Importe incorrecto del producto devuelto en el modal de Ventas',
  );
  await expectMoney(
    saleDetail.locator('.mdm-total-chip--current b'),
    currentTotal,
    'Total vigente incorrecto en el modal abierto desde Ventas',
  );
  await closeDialog(saleDetail);
});

test('@crud @critical Compras: el modal muestra los productos de la NC parcial', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);

  const productName = uniqueName('COMPRA-NC-DETALLE');
  const quantity = 2;
  const price = 300;
  const returnedQuantity = 1;
  const originalTotal = quantity * price;
  const creditTotal = returnedQuantity * price;
  const currentTotal = originalTotal - creditTotal;

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('COMPNCDET'),
    stock: 3,
    cost: price,
    price: 450,
  });
  await createPurchase(page, { productName, quantity, price });

  await applyPurchaseCreditNoteAndCapture(page, productName, {
    motive: 'DEVOLUCION_MERCADERIA',
    quantity: returnedQuantity,
  });

  await page.goto('/panel/compras');
  await waitForBusyToFinish(page);
  const purchaseRow = await searchRow(page, productName, /Buscar por descripción, proveedor/i);
  await purchaseRow.getByTitle(/Ver información completa del movimiento/i).click();

  const purchaseDetail = page.getByRole('dialog').last();
  await expect(purchaseDetail).toBeVisible({ timeout: 30_000 });
  await expect(purchaseDetail.getByLabel('Trazabilidad de notas de crédito')).toBeVisible();
  await purchaseDetail.getByTitle('Ver detalle de la nota de crédito').click();

  const creditedItem = purchaseDetail
    .getByLabel('Productos acreditados')
    .locator('.mdm-credit-note__item')
    .filter({ hasText: productName })
    .first();
  await expect(
    creditedItem,
    'El modal abierto desde Compras debe identificar el producto devuelto',
  ).toBeVisible();
  await expect(creditedItem).toContainText(`Cant. ${returnedQuantity}`);
  await expectMoney(
    creditedItem.locator('.mdm-credit-note__item-total'),
    creditTotal,
    'Importe incorrecto del producto devuelto en el modal de Compras',
  );
  await expectMoney(
    purchaseDetail.locator('.mdm-credit-amount--original .mdm-credit-amount__value'),
    originalTotal,
    'Importe original incorrecto en el modal abierto desde Compras',
  );
  await expectMoney(
    purchaseDetail.locator('.mdm-total-chip--current b'),
    currentTotal,
    'Total vigente incorrecto en el modal abierto desde Compras',
  );
  await closeDialog(purchaseDetail);
});
