import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import {
  closeDialog,
  requireMutations,
  waitForBusyToFinish,
} from './support/ui.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import {
  applyPurchaseCreditNoteAndCapture,
  applySaleCreditNoteAndCapture,
  createStockProduct,
  createSale,
  createPurchase,
  payReceivable,
  payPayable,
} from './support/flows.js';

async function expectDebtSettledOrRemoved(page, {
  url,
  productName,
  searchPlaceholder,
  settledPattern,
  listAction,
  listKeys,
}) {
  // Primero verificamos que la pantalla siga accesible y que el filtro exista.
  // La confirmación de saldo se hace contra el endpoint que alimenta esa misma
  // grilla: leer filas DOM durante la recarga era inestable porque los skeletons
  // pueden contarse como visibles y desmontarse entre count() e innerText().
  await page.goto(url);
  await waitForBusyToFinish(page);
  const search = page.getByPlaceholder(searchPlaceholder).first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(productName);

  await expect.poll(async () => {
    const result = await authenticatedApi(page, listAction, {
      query: { q: productName, limit: 101, offset: 0, _: Date.now() },
    });
    expectApiSuccess(result, `No se pudo verificar el saldo final de ${productName}`);

    const roots = [result.body, result.body?.data].filter(Boolean);
    const rows = [];
    for (const root of roots) {
      for (const key of listKeys) {
        if (Array.isArray(root?.[key])) rows.push(...root[key]);
      }
    }

    const needle = String(productName).trim().toUpperCase();
    const candidate = rows.find((row) =>
      JSON.stringify(row || {}).toUpperCase().includes(needle)
    );

    // Recibos/Órdenes de pago listan deuda pendiente. Si el registro ya no está,
    // el pago quedó saldado. Algunas versiones conservan la fila con estado/saldo.
    if (!candidate) return 'REMOVED';

    const state = String(
      candidate?.estado_pago ??
      candidate?.estado ??
      candidate?.estado_cuenta_corriente ??
      ''
    ).toUpperCase();
    const balance =
      candidate?.saldo ??
      candidate?.saldo_pendiente ??
      candidate?.importe_pendiente ??
      candidate?.restante ??
      '';

    return `${state} SALDO ${balance}`.trim();
  }, {
    timeout: 30_000,
    intervals: [500, 1_000, 2_000],
    message: `La deuda de ${productName} siguió pendiente después de finalizar el pago.`,
  }).toMatch(settledPattern);
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

function accountConfig(kind) {
  const isClient = kind === 'client';
  return {
    route: isClient
      ? '/panel/cuentas-corrientes/clientes'
      : '/panel/cuentas-corrientes/proveedores',
    searchPlaceholder: isClient ? /Buscar por cliente/i : /Buscar por proveedor/i,
    detailAction: isClient ? 'cc_historial_cliente' : 'cc_historial_proveedor',
    historyAction: isClient
      ? 'cc_movimientos_historial_cliente'
      : 'cc_movimientos_historial_proveedor',
    idQuery: isClient ? 'id_cliente' : 'id_proveedor',
    createAction: isClient ? 'cc_cliente_crear' : 'cc_proveedor_crear',
    idResponse: isClient ? 'id_cliente' : 'id_proveedor',
  };
}

async function createAccountParty(page, kind, name) {
  const config = accountConfig(kind);
  const normalizedName = String(name).trim().toUpperCase();
  const result = await authenticatedApi(page, config.createAction, {
    method: 'POST',
    body: { nombre: normalizedName, activo: 1 },
  });
  const body = expectApiSuccess(result, `No se pudo crear ${normalizedName}`);
  const id = Number(body?.[config.idResponse] ?? body?.data?.[config.idResponse] ?? 0);
  expect(id, `${normalizedName} debe exponer su identificador`).toBeGreaterThan(0);
  return { id, name: normalizedName };
}

async function waitAccountResponse(page, action, idQuery, partyId, trigger) {
  const responsePromise = page.waitForResponse(
    (response) => {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return url.searchParams.get('action') === action
        && Number(url.searchParams.get(idQuery)) === Number(partyId);
    },
    { timeout: 45_000 },
  );

  await trigger();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
  return body;
}

async function openAccount(page, kind, party) {
  const config = accountConfig(kind);
  await page.goto(config.route);
  await waitForBusyToFinish(page);

  const search = page.getByPlaceholder(config.searchPlaceholder).first();

  // La pantalla puede mostrar el buscador antes de terminar de cargar la cuenta
  // corriente. Esperamos que React lo habilite y permita edición antes de escribir.
  await expect(search).toBeVisible({ timeout: 30_000 });
  await expect(search).toBeEnabled({ timeout: 45_000 });
  await expect(search).toBeEditable({ timeout: 45_000 });
  await search.fill(party.name);

  const summaryRow = page
    .locator('.cc-cliente-table__movRow:visible')
    .filter({ hasText: party.name })
    .first();
  await expect(summaryRow, `Debe aparecer la cuenta corriente de ${party.name}`).toBeVisible({ timeout: 30_000 });

  const body = await waitAccountResponse(
    page,
    config.detailAction,
    config.idQuery,
    party.id,
    () => summaryRow.click(),
  );

  await waitForBusyToFinish(page);
  await expect(page.getByRole('tab', { name: /^Cuenta corriente$/i })).toHaveAttribute('aria-selected', 'true');
  return { body, config };
}

function findAccountRows(body, movementId) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const movement = rows.find(
    (row) => row?.tipo_registro === 'movimiento'
      && Number(row?.id_movimiento) === Number(movementId),
  );
  const creditNote = rows.find(
    (row) => row?.tipo_registro === 'nota_credito'
      && Number(row?.id_movimiento_origen) === Number(movementId),
  );
  return { rows, movement, creditNote };
}

function itemContainsProduct(item, productName) {
  const expected = String(productName).trim().toUpperCase();
  return [
    item?.nombre,
    item?.descripcion,
    item?.detalle,
    item?.producto_nombre,
    item?.stock_producto_nombre,
  ].some((value) => String(value || '').trim().toUpperCase().includes(expected));
}

function expectCompleteAccountPayload(body, {
  movementId,
  productName,
  originalTotal,
  creditTotal,
  currentTotal,
  expectedModality,
}) {
  const { movement, creditNote } = findAccountRows(body, movementId);

  expect(movement, 'La cuenta corriente debe incluir el movimiento original').toBeTruthy();
  expect(creditNote, 'La cuenta corriente debe incluir la nota de crédito como crédito separado').toBeTruthy();

  expect(Number(movement?.debito)).toBeCloseTo(originalTotal, 2);
  expect(Number(movement?.credito)).toBeCloseTo(0, 2);
  expect(Number(movement?.monto_total_original)).toBeCloseTo(originalTotal, 2);
  expect(Number(movement?.monto_acreditado)).toBeCloseTo(creditTotal, 2);
  expect(Number(movement?.monto_total_vigente)).toBeCloseTo(currentTotal, 2);
  expect(Number(movement?.tiene_nota_credito || 0)).toBe(1);
  expect(
    (Array.isArray(movement?.items_detalle) ? movement.items_detalle : [])
      .some((item) => itemContainsProduct(item, productName)),
    'El movimiento debe conservar el producto original en items_detalle',
  ).toBe(true);

  expect(Number(creditNote?.credito)).toBeCloseTo(creditTotal, 2);
  expect(Number(creditNote?.monto_total_original)).toBeCloseTo(originalTotal, 2);
  expect(Number(creditNote?.monto_total_vigente)).toBeCloseTo(currentTotal, 2);
  expect(String(creditNote?.motivo || '')).toBe('DEVOLUCION_MERCADERIA');
  expect(String(creditNote?.modalidad || '')).toBe(expectedModality);
  expect(
    (Array.isArray(creditNote?.items_detalle) ? creditNote.items_detalle : [])
      .some((item) => itemContainsProduct(item, productName)),
    'La nota de crédito debe informar el producto acreditado',
  ).toBe(true);
  expect(
    (Array.isArray(creditNote?.items_detalle_original) ? creditNote.items_detalle_original : [])
      .some((item) => itemContainsProduct(item, productName)),
    'La nota de crédito debe conservar los ítems de la operación original',
  ).toBe(true);

  expect(Number(body?.totales?.debito)).toBeCloseTo(originalTotal, 2);
  expect(Number(body?.totales?.credito)).toBeCloseTo(creditTotal, 2);
  expect(Number(body?.totales?.saldo)).toBeCloseTo(currentTotal, 2);

  return { movement, creditNote };
}

async function expectCreditNoteDialog(dialog, {
  productName,
  partyName,
  returnedQuantity,
  originalTotal,
  creditTotal,
  currentTotal,
  expectedModalityLabel,
}) {
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog, 'El modal debe mostrar el producto exacto').toContainText(productName);
  await expect(dialog, 'El modal debe mostrar el cliente/proveedor de la cuenta').toContainText(partyName);
  await expect(dialog.getByLabel('Trazabilidad de notas de crédito')).toBeVisible();

  await expectMoney(
    dialog.locator('.mdm-total-chip--original b'),
    originalTotal,
    'Importe original incorrecto en el modal de cuenta corriente',
  );
  await expectMoney(
    dialog.locator('.mdm-total-chip--credit b'),
    -creditTotal,
    'Importe acreditado incorrecto en el modal de cuenta corriente',
  );
  await expectMoney(
    dialog.locator('.mdm-total-chip--current b'),
    currentTotal,
    'Total vigente incorrecto en el modal de cuenta corriente',
  );

  await dialog.getByTitle('Ver detalle de la nota de crédito').first().click();
  await expect(dialog).toContainText(/Devolucion Mercaderia/i);
  await expect(dialog).toContainText(expectedModalityLabel);

  const creditedItem = dialog
    .getByLabel('Productos acreditados')
    .locator('.mdm-credit-note__item')
    .filter({ hasText: productName })
    .first();
  await expect(creditedItem, 'El modal debe identificar el producto acreditado').toBeVisible();
  await expect(creditedItem).toContainText(new RegExp(`Cant\\.\\s*${returnedQuantity}(?:[,.]0+)?`, 'i'));
  await expectMoney(
    creditedItem.locator('.mdm-credit-note__item-total'),
    creditTotal,
    'Importe incorrecto del producto acreditado',
  );
}

async function expectAccountUiAndDialogs(page, {
  body,
  movementId,
  productName,
  partyName,
  returnedQuantity,
  originalTotal,
  creditTotal,
  currentTotal,
  expectedModalityLabel,
}) {
  const { movement, creditNote } = findAccountRows(body, movementId);
  const detailTable = page.locator('.cc-cliente-table--detail');
  const rows = detailTable.locator('.cc-cliente-table__body .mov-gridTable--row:visible');

  const movementRow = rows.filter({ hasText: movement.comprobante }).first();
  const creditNoteRow = rows.filter({ hasText: creditNote.comprobante }).first();
  await expect(movementRow).toBeVisible({ timeout: 30_000 });
  await expect(creditNoteRow).toBeVisible({ timeout: 30_000 });

  const movementCells = movementRow.locator(':scope > .mov-gridCell');
  const noteCells = creditNoteRow.locator(':scope > .mov-gridCell');
  await expectMoney(movementCells.nth(2), originalTotal, 'Débito incorrecto en la fila original');
  await expectMoney(movementCells.nth(4), originalTotal, 'Saldo incorrecto antes de aplicar la nota');
  await expectMoney(noteCells.nth(3), creditTotal, 'Crédito incorrecto en la fila de la nota');
  await expectMoney(noteCells.nth(4), currentTotal, 'Saldo incorrecto después de aplicar la nota');

  const footerCells = detailTable
    .locator('.cc-cliente-table__footWrap .mov-gridTable')
    .locator(':scope > .mov-gridCell');
  await expectMoney(footerCells.nth(2), originalTotal, 'Total débito incorrecto');
  await expectMoney(footerCells.nth(3), creditTotal, 'Total crédito incorrecto');
  await expectMoney(footerCells.nth(4), currentTotal, 'Saldo total incorrecto');

  await movementRow.getByTitle('Ver detalle completo del movimiento').click();
  const movementDialog = page.getByRole('dialog').last();
  await expectCreditNoteDialog(movementDialog, {
    productName,
    partyName,
    returnedQuantity,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModalityLabel,
  });
  await closeDialog(movementDialog);

  await creditNoteRow.getByTitle('Ver detalle completo de la nota de crédito').click();
  const creditDialog = page.getByRole('dialog').last();
  await expect(creditDialog).toContainText(/Detalle de la nota de crédito/i);
  await expectCreditNoteDialog(creditDialog, {
    productName,
    partyName,
    returnedQuantity,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModalityLabel,
  });
  await closeDialog(creditDialog);
}

async function expectUnifiedHistory(page, kind, party, {
  movementId,
  productName,
  returnedQuantity,
  originalTotal,
  creditTotal,
  currentTotal,
  expectedModalityLabel,
}) {
  const config = accountConfig(kind);
  const historyTab = page.getByRole('tab', { name: /^Historial$/i });
  const body = await waitAccountResponse(
    page,
    config.historyAction,
    config.idQuery,
    party.id,
    () => historyTab.click(),
  );

  await waitForBusyToFinish(page);
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');

  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const movement = rows.find((row) => Number(row?.id_movimiento) === Number(movementId));
  expect(movement, 'Historial debe devolver el movimiento original unificado con su NC').toBeTruthy();
  expect(rows.filter((row) => Number(row?.id_movimiento) === Number(movementId))).toHaveLength(1);
  expect(Number(movement?.monto_total_original)).toBeCloseTo(originalTotal, 2);
  expect(Number(movement?.monto_acreditado)).toBeCloseTo(creditTotal, 2);
  expect(Number(movement?.monto_total_vigente)).toBeCloseTo(currentTotal, 2);
  expect(Number(movement?.saldo)).toBeCloseTo(currentTotal, 2);
  expect(Number(body?.totales?.debito)).toBeCloseTo(originalTotal, 2);
  expect(Number(body?.totales?.credito)).toBeCloseTo(creditTotal, 2);
  expect(Number(body?.totales?.saldo)).toBeCloseTo(currentTotal, 2);

  const historyRow = page
    .locator('.cc-cliente-table--detail .cc-cliente-table__body .mov-gridTable--row:visible')
    .filter({ hasText: movement.comprobante })
    .first();
  await expect(historyRow).toBeVisible({ timeout: 30_000 });
  const cells = historyRow.locator(':scope > .mov-gridCell');
  await expectMoney(cells.nth(2), originalTotal, 'Total original incorrecto en Historial');
  await expectMoney(cells.nth(3), creditTotal, 'Acreditado incorrecto en Historial');
  await expectMoney(cells.nth(4), currentTotal, 'Saldo incorrecto en Historial');

  await historyRow.getByTitle('Ver detalle completo del movimiento').click();
  const dialog = page.getByRole('dialog').last();
  await expectCreditNoteDialog(dialog, {
    productName,
    partyName: party.name,
    returnedQuantity,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModalityLabel,
  });
  await closeDialog(dialog);
}

test('@crud @critical cuenta corriente cliente: venta pendiente y recibo completo', async ({ page }, testInfo) => {
  // Integra frontend local con API remota: una corrida completa puede superar
  // el timeout global de 60 s aun sin errores funcionales. Damos margen sólo a
  // este flujo crítico, manteniendo timeouts internos estrictos por operación.
  testInfo.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('CC-CLIENTE');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('CCCLI'),
    stock: 5,
    cost: 100,
    price: 220,
  });
  await createSale(page, { productName, quantity: 1, price: 220 });
  await payReceivable(page, productName);

  await expectDebtSettledOrRemoved(page, {
    url: '/panel/recibos',
    productName,
    searchPlaceholder: /Buscar por descripción, cliente/i,
    settledPattern: /REMOVED|PAGADO|COBRADO|SALDADO|SALDO\s*\$?\s*0(?:[,.]00)?/i,
    listAction: 'recibos_listar',
    listKeys: ['movimientos', 'recibos'],
  });

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/PDF/i, /recibo/i, /Tienda Nube/i] });
});

test('@crud @critical cuenta corriente proveedor: compra pendiente y orden de pago completa', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('CC-PROVEEDOR');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('CCPROV'),
    stock: 2,
    cost: 90,
    price: 170,
  });
  await createPurchase(page, { productName, quantity: 1, price: 90 });
  await payPayable(page, productName);

  await expectDebtSettledOrRemoved(page, {
    url: '/panel/OrdenesPago',
    productName,
    searchPlaceholder: /Buscar por descripción, proveedor/i,
    settledPattern: /REMOVED|PAGADO|SALDADO|SALDO\s*\$?\s*0(?:[,.]00)?/i,
    listAction: 'ordenes_pago_listar',
    listKeys: ['movimientos', 'ordenes', 'ordenes_pago'],
  });

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/PDF/i, /orden/i, /Tienda Nube/i] });
});

test('@crud @critical cuenta corriente cliente: NC parcial calcula saldo y muestra detalle completo', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(6 * 60_000);
  const diagnostics = installDiagnostics(page);

  await page.goto('/panel/movimientos');
  await waitForBusyToFinish(page);

  const party = await createAccountParty(page, 'client', uniqueName('CC-NC-CLIENTE'));
  const productName = uniqueName('CC-NC-VENTA');
  const originalTotal = 600;
  const creditTotal = 300;
  const currentTotal = 300;
  const returnedQuantity = 1;

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('CCNCVTA'),
    stock: 10,
    cost: 150,
    price: 300,
  });

  const saleData = {
    productName,
    clientName: party.name,
    quantity: 2,
    price: 300,
  };
  await createSale(page, saleData);
  expect(String(saleData.clientName).toUpperCase()).toContain(party.name);

  // La fila de Ventas no expone data-movement-id en todas las versiones del
  // frontend. La respuesta de creación de la NC sí devuelve de forma contractual
  // el id_movimiento_origen, por lo que tomamos el identificador real del backend.
  const saleCreditNote = await applySaleCreditNoteAndCapture(page, productName, {
    motive: 'DEVOLUCION_MERCADERIA',
    quantity: returnedQuantity,
  });
  const movementId = Number(
    saleCreditNote.body?.id_movimiento_origen
      ?? saleCreditNote.body?.data?.id_movimiento_origen
      ?? 0,
  );
  expect(
    movementId,
    `La NC de venta debe devolver id_movimiento_origen: ${JSON.stringify(saleCreditNote.body)}`,
  ).toBeGreaterThan(0);
  expect(
    String(saleCreditNote.body?.modalidad ?? saleCreditNote.body?.data?.modalidad ?? ''),
  ).toBe('INTERNA');

  const { body } = await openAccount(page, 'client', party);
  expectCompleteAccountPayload(body, {
    movementId,
    productName,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModality: 'INTERNA',
  });
  await expectAccountUiAndDialogs(page, {
    body,
    movementId,
    productName,
    partyName: party.name,
    returnedQuantity,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModalityLabel: /Interna/i,
  });
  await expectUnifiedHistory(page, 'client', party, {
    movementId,
    productName,
    returnedQuantity,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModalityLabel: /Interna/i,
  });

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [/PDF/i, /nota de crédito/i, /Tienda Nube/i],
  });
});

test('@crud @critical cuenta corriente proveedor: NC parcial calcula saldo y muestra detalle completo', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(6 * 60_000);
  const diagnostics = installDiagnostics(page);

  await page.goto('/panel/movimientos');
  await waitForBusyToFinish(page);

  const party = await createAccountParty(page, 'provider', uniqueName('CC-NC-PROVEEDOR'));
  const productName = uniqueName('CC-NC-COMPRA');
  const originalTotal = 480;
  const creditTotal = 240;
  const currentTotal = 240;
  const returnedQuantity = 1;

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('CCNCCOM'),
    stock: 2,
    cost: 240,
    price: 360,
  });

  const purchaseData = {
    productName,
    providerName: party.name,
    quantity: 2,
    price: 240,
  };
  await createPurchase(page, purchaseData);
  expect(String(purchaseData.providerName).toUpperCase()).toContain(party.name);

  const purchaseCreditNote = await applyPurchaseCreditNoteAndCapture(page, productName, {
    motive: 'DEVOLUCION_MERCADERIA',
    quantity: returnedQuantity,
  });
  const movementId = Number(
    purchaseCreditNote.body?.id_movimiento_origen
      ?? purchaseCreditNote.body?.data?.id_movimiento_origen
      ?? 0,
  );
  expect(
    movementId,
    `La NC de compra debe devolver id_movimiento_origen: ${JSON.stringify(purchaseCreditNote.body)}`,
  ).toBeGreaterThan(0);
  expect(
    String(purchaseCreditNote.body?.modalidad ?? purchaseCreditNote.body?.data?.modalidad ?? ''),
  ).toBe('PROVEEDOR');

  const { body } = await openAccount(page, 'provider', party);
  expectCompleteAccountPayload(body, {
    movementId,
    productName,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModality: 'PROVEEDOR',
  });
  await expectAccountUiAndDialogs(page, {
    body,
    movementId,
    productName,
    partyName: party.name,
    returnedQuantity,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModalityLabel: /Proveedor/i,
  });
  await expectUnifiedHistory(page, 'provider', party, {
    movementId,
    productName,
    returnedQuantity,
    originalTotal,
    creditTotal,
    currentTotal,
    expectedModalityLabel: /Proveedor/i,
  });

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [/PDF/i, /nota de crédito/i, /Tienda Nube/i],
  });
});
