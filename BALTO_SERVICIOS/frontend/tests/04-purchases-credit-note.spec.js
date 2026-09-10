import { test, expect } from './support/test.js';
import { Buffer } from 'node:buffer';
import { patchContextNavigation, patchPageNavigation } from './support/env.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import {
  clickSaveAndWait,
  closeDialog,
  requireMutations,
  searchRow,
  selectOptionValues,
} from './support/ui.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { expectServiceStock } from './support/services.js';
import {
  createPurchase,
  editPurchaseQuantity,
  applyPurchaseCreditNote,
  applyPurchaseCreditNoteAndCapture,
  openPurchaseCreditNote,
  configurePurchaseCreditNote,
  deletePurchase,
  deleteUnusedStockProduct,
} from './support/flows.js';


test.beforeEach(async ({ page, context }) => {
  patchContextNavigation(context);
  patchPageNavigation(page);
});
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

test('@crud @critical compra: ingresa stock, edita cantidad y NC de proveedor resta stock', async ({ page }, testInfo) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('COMPRA-NC');

  await createStockProductFixture(page, {
    name: productName,
    sku: uniqueSku('COMPRA'),
    stock: 10,
    cost: 100,
    price: 160,
  });

  const purchaseRow = await createPurchase(page, { productName, quantity: 3, price: 100 });
  const purchaseId = Number(await purchaseRow.getAttribute('data-movement-id') || 0);
  expect(purchaseId, 'La compra de control debe exponer id_movimiento').toBeGreaterThan(0);
  await editPurchaseQuantity(page, productName, 4);
  await applyPurchaseCreditNote(page, productName, 1);

  await expectServiceStock(page, productName, 13);

  // La rama de ajustes económicos debe ofrecer todos los motivos, usar selector
  // cerrado de IVA y no modificar el stock.
  await page.goto('/panel/compras');
  const { dialog } = await openPurchaseCreditNote(page, productName);
  const motiveSelect = dialog
    .locator('.gm-field')
    .filter({ hasText: /Motivo/i })
    .locator('select')
    .first();
  await expect((await selectOptionValues(motiveSelect)).sort()).toEqual([...CREDIT_NOTE_MOTIVES].sort());

  await configurePurchaseCreditNote(dialog, {
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
  const economicResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'compras_nota_credito_crear',
    { timeout: 90_000 },
  );
  await clickSaveAndWait(dialog, /Aplicar nota de crédito/i, { timeout: 60_000 });
  const economicResponse = await economicResponsePromise;
  const economicBody = await economicResponse.json().catch(() => ({}));
  expect(economicResponse.status(), JSON.stringify(economicBody)).toBeLessThan(400);
  expect(creditNoteId(economicBody), 'La NC económica debe devolver un identificador').toBeGreaterThan(0);

  // Regresión del cierre final: $10 con IVA 21% antes podía persistirse como $9,99
  // al recalcular desde una base redondeada. Se valida el valor realmente guardado
  // por el backend, no sólo lo que mostró el modal.
  const persistedPurchase = expectApiSuccess(
    await authenticatedApi(page, 'compras_obtener', {
      query: { id_movimiento: purchaseId, _: Date.now() },
    }),
    'No se pudo releer la compra después de la NC económica',
  )?.compra;
  const exactEconomicNote = (persistedPurchase?.notas_credito_detalle || []).find(
    (note) => String(note?.motivo || '').toUpperCase() === 'DIFERENCIA_PRECIO',
  );
  expect(exactEconomicNote, 'La compra debe exponer la NC económica persistida').toBeTruthy();
  expect(Number(exactEconomicNote.total), 'La NC solicitada por $10 debe persistirse exactamente en $10,00').toBeCloseTo(10, 2);

  await expectServiceStock(page, productName, 13);

  // Una compra con NC aplicada no se puede reescribir: cambiar sus items rompería
  // la trazabilidad entre el movimiento original y la nota. La acción Editar
  // debe desaparecer completamente, no quedar visible como botón deshabilitado.
  await page.goto('/panel/compras');
  const purchaseWithCreditNote = await searchRow(page, productName, /Buscar por descripción, proveedor/i);
  await expect(
    purchaseWithCreditNote.getByTitle('Editar'),
    'El botón Editar debe ocultarse cuando la compra tiene una nota de crédito aplicada',
  ).toHaveCount(0);
  await expect(
    purchaseWithCreditNote.getByTitle('No se puede editar: tiene una nota de crédito aplicada'),
    'No debe quedar visible el antiguo botón Editar deshabilitado',
  ).toHaveCount(0);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical NC compra: adjunta archivo y lo abre desde el ojo de la compra', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('COMPRA-NC-ARCHIVO');
  const fileName = `nota-credito-proveedor-${Date.now()}.png`;

  await createStockProductFixture(page, {
    name: productName,
    sku: uniqueSku('COMPRANCARCH'),
    stock: 5,
    cost: 100,
    price: 160,
  });

  const purchaseRow = await createPurchase(page, { productName, quantity: 2, price: 100 });
  const eyeWithoutDocument = purchaseRow.getByTitle('Sin comprobante');
  await expect(
    eyeWithoutDocument,
    'La compra de control debe comenzar sin comprobante propio',
  ).toBeDisabled();

  const { dialog } = await openPurchaseCreditNote(page, productName);
  await configurePurchaseCreditNote(dialog, {
    motive: 'DIFERENCIA_PRECIO',
    amount: 10,
    ivaPct: 21,
  });

  const fileInput = dialog.locator('input[type="file"][accept*="image"]').first();
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    // PNG válido de 1 x 1 para probar la carga y el visor sin depender de fixtures.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(dialog.getByTitle(fileName)).toBeVisible();

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'compras_nota_credito_crear',
    { timeout: 90_000 },
  );
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') ===
        'compras_comprobantes_vincular_movimientos_lote_upload',
    { timeout: 90_000 },
  );

  await dialog.getByRole('button', { name: /Aplicar nota de crédito/i }).last().click();
  const [createResponse, uploadResponse] = await Promise.all([
    createResponsePromise,
    uploadResponsePromise,
  ]);
  const createBody = await createResponse.json().catch(() => ({}));
  const uploadBody = await uploadResponse.json().catch(() => ({}));

  expect(createResponse.status(), JSON.stringify(createBody)).toBeLessThan(400);
  expect(
    createBody?.exito !== false && createBody?.success !== false,
    createBody?.mensaje || createBody?.message,
  ).toBeTruthy();
  expect(uploadResponse.status(), JSON.stringify(uploadBody)).toBeLessThan(400);
  expect(
    uploadBody?.exito !== false && uploadBody?.success !== false,
    uploadBody?.mensaje || uploadBody?.message,
  ).toBeTruthy();
  await expect(dialog).toBeHidden({ timeout: 90_000 });

  // La recarga es indispensable: obliga a reconstruir la fila con
  // comprobantes_detalle devuelto por el backend, que era donde aparecía la regresión.
  await page.goto('/panel/compras');
  const reloadedRow = await searchRow(page, productName, /Buscar por descripción, proveedor/i);
  const eyeWithCreditNote = reloadedRow.getByTitle('Ver comprobante');
  await expect(
    eyeWithCreditNote,
    'El archivo de la NC debe habilitar el ojo aunque la compra no tenga comprobante propio',
  ).toBeEnabled();

  const downloadResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).searchParams.get('action') === 'compras_comprobantes_descargar',
    { timeout: 60_000 },
  );
  await eyeWithCreditNote.click();
  const downloadResponse = await downloadResponsePromise;
  const downloadBody = await downloadResponse.json().catch(() => ({}));
  expect(downloadResponse.status(), JSON.stringify(downloadBody)).toBeLessThan(400);
  expect(downloadBody?.exito, downloadBody?.mensaje || 'El backend debe entregar la URL del archivo').toBe(true);
  expect(String(downloadBody?.url || ''), 'El archivo vinculado debe tener una URL de visualización').not.toBe('');

  const viewer = page.getByRole('dialog', { name: /Comprobantes de Compra/i });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(
    viewer.locator('[aria-label="Vista previa imagen"]'),
    'El visor debe renderizar la imagen adjuntada a la nota de crédito',
  ).toBeVisible({ timeout: 30_000 });
  await closeDialog(viewer);

  await deletePurchase(page, productName);
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical NC compra: backend rechaza IVA manipulado fuera del selector', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('COMPRA-NC-IVA');

  await createStockProductFixture(page, {
    name: productName,
    sku: uniqueSku('COMPRAIVA'),
    stock: 5,
    cost: 100,
    price: 160,
  });
  await createPurchase(page, { productName, quantity: 2, price: 100 });

  let intercepted = false;
  await page.route('**/api.php?action=compras_nota_credito_crear**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    const payload = request.postDataJSON();
    payload.iva_pct_ajuste = 15;
    intercepted = true;
    await route.continue({ postData: JSON.stringify(payload) });
  });

  const { dialog } = await openPurchaseCreditNote(page, productName);
  await configurePurchaseCreditNote(dialog, {
    motive: 'OTRO',
    amount: 10,
    ivaPct: 21,
  });

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('action=compras_nota_credito_crear') &&
      response.request().method() === 'POST',
  );

  await dialog.getByRole('button', { name: /Aplicar nota de crédito/i }).last().click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));

  expect(intercepted, 'La prueba debe haber manipulado el IVA enviado al backend').toBe(true);
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(String(body?.mensaje || body?.message || '')).toMatch(/IVA|10,5|21|27/i);
  await expect(dialog).toBeVisible();
  await closeDialog(dialog);

  await page.unroute('**/api.php?action=compras_nota_credito_crear**');
  await page.goto('/panel/compras');
  await deletePurchase(page, productName);
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [
      /imagen/i,
      // Esta respuesta 422 es el resultado esperado de la manipulación intencional de IVA.
      /Failed to load resource: the server responded with a status of 422/i,
    ],
  });
});

test('@crud @critical NC compra: ejecuta realmente los cuatro motivos actuales y valida su impacto de stock', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(9 * 60_000);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('COMPRA-NC-CUATRO-MOTIVOS');
  const totalProductName = uniqueName('COMPRA-NC-ANULACION-TOTAL');

  await createStockProductFixture(page, {
    name: productName,
    sku: uniqueSku('COMPRANC4'),
    stock: 12,
    cost: 100,
    price: 160,
  });
  await createStockProductFixture(page, {
    name: totalProductName,
    sku: uniqueSku('COMPRANCTOTAL'),
    stock: 4,
    cost: 100,
    price: 160,
  });
  await createPurchase(page, { productName, quantity: 6, price: 100 });
  await createPurchase(page, { productName: totalProductName, quantity: 2, price: 100 });

  const applied = [];
  const apply = async (targetProduct, options) => {
    await page.goto('/panel/compras');
    const result = await applyPurchaseCreditNoteAndCapture(page, targetProduct, options);
    expect(creditNoteId(result.body), `El motivo ${options.motive} debe crear una nota identificable`).toBeGreaterThan(0);
    applied.push(options.motive);
  };

  await apply(productName, { motive: 'DEVOLUCION_MERCADERIA', quantity: 1 });
  for (const motive of ['DIFERENCIA_PRECIO', 'OTRO']) {
    await apply(productName, { motive, amount: 5, ivaPct: 21 });
  }

  await expectServiceStock(page, productName, 17);

  // ANULACION_TOTAL se prueba sobre una compra independiente. Si se aplica
  // después de ajustes económicos sobre la misma compra, el modal selecciona
  // todas las unidades pero el saldo monetario ya es menor y la UI la bloquea
  // correctamente por exceder el disponible.
  await apply(totalProductName, { motive: 'ANULACION_TOTAL' });
  expect([...applied].sort()).toEqual([...CREDIT_NOTE_MOTIVES].sort());

  await expectServiceStock(page, totalProductName, 4);

  await page.goto('/panel/compras');
  await deletePurchase(page, productName);
  await deletePurchase(page, totalProductName);
  await deleteUnusedStockProduct(page, productName);
  await deleteUnusedStockProduct(page, totalProductName);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});
