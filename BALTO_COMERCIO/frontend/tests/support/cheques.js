import { expect } from '@playwright/test';
import {
  clickSaveAndWait,
  completeRemainingAmount,
  fillMovementRow,
  searchRow,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  selectSafePaymentMethod,
  waitDialog,
  waitForBusyToFinish,
} from './ui.js';
import { createCatalogDescription } from './flows.js';
import { deleteCurrentAccountPayment } from './api.js';

function actionFromResponse(response) {
  try {
    return new URL(response.url()).searchParams.get('action') || '';
  } catch {
    return '';
  }
}

function responseForAction(page, action, timeout = 90_000) {
  return page.waitForResponse(
    (response) => response.request().method() === 'POST' && actionFromResponse(response) === action,
    { timeout },
  );
}

async function responseBody(response, label) {
  const body = await response.json().catch(() => ({}));
  expect(response.status(), `${label}: HTTP ${response.status()} ${JSON.stringify(body)}`).toBeLessThan(400);
  expect(
    body?.exito !== false && body?.success !== false,
    body?.mensaje || body?.message || label,
  ).toBeTruthy();
  return body;
}

function isEcheq(tipo) {
  return String(tipo || '').toUpperCase() === 'ECHEQ';
}

export async function selectChequePaymentMethod(scope, tipo = 'CHEQUE') {
  const select = scope.locator('.gm-payment-row--method select').first();
  await expect(select).toBeVisible({ timeout: 20_000 });

  let options = [];
  await expect.poll(async () => {
    options = await select.locator('option').evaluateAll((nodes) => nodes.map((node) => ({
      value: String(node.value || ''),
      text: String(node.textContent || '').trim(),
      disabled: Boolean(node.disabled),
    })));
    return options.filter((option) => option.value && !option.disabled).length;
  }, {
    timeout: 20_000,
    message: 'Deben cargarse los medios de pago antes de seleccionar cheque',
  }).toBeGreaterThan(0);

  const electronic = isEcheq(tipo);
  const candidate = options.find((option) => {
    if (!option.value || option.disabled) return false;
    const text = option.text.toUpperCase();
    const looksElectronic = /ECHEQ|E-CHEQ|E CHEQ|ELECTR[ÓO]NICO/.test(text);
    return electronic ? looksElectronic : /CHEQ/.test(text) && !looksElectronic;
  });

  if (!candidate) {
    throw new Error(`No existe un medio de pago activo para ${electronic ? 'eCheq' : 'cheque'}.`);
  }

  await select.selectOption(candidate.value);
  return candidate;
}

function chequeField(dialog, label) {
  return dialog.locator('.nc-field').filter({ hasText: label }).locator('input').first();
}

export async function fillIncomingCheque(scope, cheque) {
  const tipo = cheque.tipo || 'CHEQUE';
  const electronic = isEcheq(tipo);

  const page = scope.page();
  const modal = page.getByRole('dialog', {
    name: electronic ? /Cargar eCheq/i : /Cargar Cheque/i,
  }).last();

  // El bloque de medio de pago puede reconstruirse durante la hidratación y
  // desmontar exactamente el botón que Playwright estaba por pulsar. Repetimos
  // selección + click como una sola operación hasta que el submodal quede abierto.
  await expect(async () => {
    if (await modal.isVisible().catch(() => false)) return;

    await selectChequePaymentMethod(scope, tipo);
    const load = scope.getByRole('button', {
      name: electronic ? /Cargar eCheq/i : /Cargar cheque/i,
    }).last();
    await expect(load).toBeVisible({ timeout: 5_000 });
    await expect(load).toBeEnabled({ timeout: 5_000 });
    await load.click({ timeout: 5_000 });
    await expect(modal).toBeVisible({ timeout: 5_000 });
  }).toPass({
    timeout: 30_000,
    intervals: [150, 300, 600, 1_000],
  });

  await chequeField(modal, /Emisor \/ Banco/i).fill(cheque.emisor);
  await chequeField(modal, /N° de/i).fill(String(cheque.numero));
  const amount = chequeField(modal, /Importe/i);
  await amount.fill(String(cheque.importe));
  await amount.blur();

  const dates = modal.locator('input[type="date"]');
  if (cheque.fechaEmision) await dates.nth(0).fill(cheque.fechaEmision);
  if (cheque.fechaPago) await dates.nth(1).fill(cheque.fechaPago);

  const confirm = modal.getByRole('button', {
    name: electronic ? /Confirmar eCheq/i : /Confirmar cheque/i,
  }).last();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(modal).toBeHidden({ timeout: 30_000 });
  await expect(scope.locator('.gm-check-item').filter({ hasText: String(cheque.numero) }).first())
    .toBeVisible({ timeout: 20_000 });
}

export async function selectPortfolioCheque(scope, numero, tipo = 'CHEQUE') {
  await selectChequePaymentMethod(scope, tipo);
  const loading = scope.locator('.gm-payment-checks-loading').first();
  if (await loading.isVisible().catch(() => false)) {
    await expect(loading).toBeHidden({ timeout: 30_000 });
  }

  const card = scope.locator('.gm-check-item').filter({ hasText: String(numero) }).first();
  await expect(card, `El cheque ${numero} debe estar disponible en la cartera del modal`).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(card).toHaveClass(/gm-check-item--selected/, { timeout: 10_000 });
  const checked = await card.getAttribute('aria-checked');
  if (checked !== null) expect(checked).toBe('true');

  // La selección del cheque y el recálculo del total atraviesan estados React
  // distintos en algunos modales. Esperar la cobertura evita guardar durante
  // el render intermedio donde la tarjeta ya está marcada pero el monto interno
  // todavía continúa en cero.
  await expect(
    scope.locator('.gm-payment-totals-ok').first(),
    `El cheque ${numero} debe cubrir el importe antes de guardar`,
  ).toBeVisible({ timeout: 15_000 });
  return card;
}

export async function createSaleWithIncomingCheque(page, data, cheque) {
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const dialog = await waitDialog(page, 'Nueva Venta');

  await fillMovementRow(dialog, {
    productName: data.productName,
    quantity: data.quantity ?? 1,
    price: data.price,
  });
  data.clientName = await selectFirstAutocomplete(dialog, 'Cliente');
  const mode = dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).locator('select').first();
  const selected = await selectFirstNonEmpty(mode, /CONTADO/i);
  expect(selected.text).toMatch(/CONTADO/i);
  await fillIncomingCheque(dialog, cheque);
  await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 90_000 });
  return searchRow(page, data.productName, /Buscar por descripción, cliente/i);
}

export async function createOtherIncomeWithIncomingCheque(page, data, cheque) {
  await page.goto('/panel/Otrosingresos');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo ingreso').click();
  const dialog = await waitDialog(page, 'Nuevo Ingreso');
  const requestedClient = String(data.clientName || data.clientSearch || '').trim();
  data.clientName = await selectFirstAutocomplete(dialog, 'Cliente', requestedClient);

  const row = await createCatalogDescription(dialog, data.description);
  await row.locator('input[type="number"]').first().fill(String(data.quantity ?? 1));
  const price = row.locator('input[inputmode="decimal"]').first();
  await price.fill(String(data.amount));
  await price.blur();
  await fillIncomingCheque(dialog, cheque);
  await clickSaveAndWait(dialog, /Guardar ingreso/i, { timeout: 90_000 });
  return searchRow(page, data.description, /Buscar por descripción/i);
}

export async function payReceivableWithIncomingCheque(page, productName, cheque) {
  await page.goto('/panel/recibos');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, productName, /Buscar por descripción, cliente/i);
  const movementId = await row.getAttribute('data-movement-id');
  if (!movementId) throw new Error('La deuda a cobrar no expone data-movement-id.');

  await row.getByTitle('Cobrar').click();
  const dialog = await waitDialog(page, 'Pagar recibo');

  // Igual que en el cobro normal, no dependemos de capturar requests de
  // hidratación. Si React reconstruye el modal, reponemos cheque + deuda hasta
  // que ambos permanezcan visibles y el total quede cubierto de forma estable.
  await expect(async () => {
    const debt = dialog.locator(`.gm-receipt-row[data-movement-id="${movementId}"]`).first();
    await expect(debt).toBeVisible({ timeout: 5_000 });

    const chequeCard = dialog.locator('.gm-check-item').filter({ hasText: String(cheque.numero) }).first();
    if (!(await chequeCard.isVisible().catch(() => false))) {
      await fillIncomingCheque(dialog, cheque);
    }

    const freshDebt = dialog.locator(`.gm-receipt-row[data-movement-id="${movementId}"]`).first();
    const checkbox = freshDebt.locator('input[type="checkbox"]');
    if (!(await checkbox.isChecked().catch(() => false))) {
      await freshDebt.click({ timeout: 5_000 });
    }
    await expect(checkbox).toBeChecked({ timeout: 5_000 });

    await expect(
      dialog.locator('.gm-check-item').filter({ hasText: String(cheque.numero) }).first(),
      `El cheque ${cheque.numero} debe seguir cargado en el recibo`,
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      dialog.locator('.gm-payment-totals-ok').first(),
      `El cheque ${cheque.numero} debe cubrir el recibo seleccionado antes de confirmar`,
    ).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole('button', { name: /Confirmar cobro/i })).toBeEnabled({ timeout: 5_000 });

    await page.waitForTimeout(500);
    await expect(dialog.locator(`.gm-receipt-row[data-movement-id="${movementId}"] input[type="checkbox"]`).first())
      .toBeChecked({ timeout: 2_000 });
    await expect(dialog.locator('.gm-check-item').filter({ hasText: String(cheque.numero) }).first())
      .toBeVisible({ timeout: 2_000 });
    await expect(dialog.locator('.gm-payment-totals-ok').first()).toBeVisible({ timeout: 2_000 });
  }).toPass({
    timeout: 45_000,
    intervals: [150, 300, 600, 1_000],
  });

  const responsePromise = responseForAction(page, 'recibos_confirmar_pago');
  await dialog.getByRole('button', { name: /Confirmar cobro/i }).click();
  const body = await responseBody(await responsePromise, 'El recibo con cheque debe guardarse');

  const finalizar = page.getByRole('button', { name: /^Finalizar$/i }).last();
  await expect(finalizar).toBeVisible({ timeout: 45_000 });
  await finalizar.click();
  await expect(finalizar).toBeHidden({ timeout: 45_000 });
  return body;
}

export async function createPurchaseWithPortfolioCheque(page, data, cheque) {
  await page.goto('/panel/compras');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nueva compra').click();
  const dialog = await waitDialog(page, 'Nueva Compra');

  await fillMovementRow(dialog, {
    productName: data.productName,
    quantity: data.quantity ?? 1,
    price: data.price,
  });
  data.providerName = await selectFirstAutocomplete(dialog, 'Proveedor');
  const mode = dialog.locator('.gm-field').filter({ hasText: 'Forma de compra' }).locator('select').first();
  const selected = await selectFirstNonEmpty(mode, /CONTADO/i);
  expect(selected.text).toMatch(/CONTADO/i);
  await selectPortfolioCheque(dialog, cheque.numero, cheque.tipo);

  const responsePromise = responseForAction(page, 'compras_crear_batch');
  await clickSaveAndWait(dialog, /Guardar compra/i, { timeout: 90_000, waitForClose: false });
  await responseBody(await responsePromise, 'La compra con cheque de cartera debe guardarse');
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  return searchRow(page, data.productName, /Buscar por descripción, proveedor/i);
}

export async function editPurchaseToCurrentAccount(page, productName) {
  const row = await searchRow(page, productName, /Buscar por descripción, proveedor/i);
  await row.getByTitle('Editar').click();
  const dialog = await waitDialog(page, 'Editar compra');
  const mode = dialog.locator('.gm-field').filter({ hasText: 'Forma de compra' }).locator('select').first();
  const selected = await selectFirstNonEmpty(mode, /CUENTA\s*CORRIENTE/i);
  expect(selected.text).toMatch(/CUENTA\s*CORRIENTE/i);
  await clickSaveAndWait(dialog, /Guardar cambios/i, { timeout: 90_000 });
}

export async function payPayableWithPortfolioCheque(page, productName, cheque) {
  await page.goto('/panel/OrdenesPago');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, productName, /Buscar por descripción, proveedor/i);
  const movementId = await row.getAttribute('data-movement-id');
  if (!movementId) throw new Error('La deuda a pagar no expone data-movement-id.');

  await row.getByTitle('Pagar').click();
  const dialog = await waitDialog(page, 'Pagar orden');
  const debt = dialog.locator(`.gm-order-row[data-movement-id="${movementId}"]`).first();
  await expect(debt).toBeVisible({ timeout: 20_000 });
  const checkbox = debt.locator('input[type="checkbox"]');
  if (!(await checkbox.isChecked())) await checkbox.check({ force: true });
  await selectPortfolioCheque(dialog, cheque.numero, cheque.tipo);

  const responsePromise = responseForAction(page, 'ordenes_pago_confirmar_pago');
  await dialog.getByRole('button', { name: /Confirmar pago/i }).click();
  const body = await responseBody(await responsePromise, 'La orden de pago con cheque debe guardarse');

  const finalizar = page.getByRole('button', { name: /^Finalizar$/i }).last();
  await expect(finalizar).toBeVisible({ timeout: 45_000 });
  await finalizar.click();
  await expect(finalizar).toBeHidden({ timeout: 45_000 });
  return body;
}

export async function createOtherExpenseWithPortfolioCheque(page, data, cheque) {
  await page.goto('/panel/Otrosegresos');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nuevo egreso').click();
  const dialog = await waitDialog(page, 'Nuevo Egreso');
  const row = await createCatalogDescription(dialog, data.description);
  await row.locator('input[type="number"]').first().fill(String(data.quantity ?? 1));
  const price = row.locator('input[inputmode="decimal"]').first();
  await price.fill(String(data.amount));
  await price.blur();
  const classification = dialog.locator('.gm-field').filter({ hasText: 'Clasificación' }).locator('select');
  await selectFirstNonEmpty(classification);
  await selectPortfolioCheque(dialog, cheque.numero, cheque.tipo);
  await clickSaveAndWait(dialog, /Guardar egreso/i, { timeout: 90_000 });
  return searchRow(page, data.description, /Buscar por descripción/i);
}

export async function replaceChequeWithNonCheque(page, kind, query) {
  const row = await searchRow(page, query, /Buscar por descripción/i);
  await row.getByTitle('Editar').click();
  const dialog = await waitDialog(page, kind === 'income' ? 'Editar ingreso' : 'Editar egreso');
  await selectSafePaymentMethod(dialog);
  await completeRemainingAmount(dialog);
  await clickSaveAndWait(dialog, /Guardar cambios/i, { timeout: 90_000 });
}

export function extractPaymentId(body) {
  const ids = [
    ...(Array.isArray(body?.ids_pago) ? body.ids_pago : []),
    ...(Array.isArray(body?.ids_cobro) ? body.ids_cobro : []),
    body?.id_pago,
    body?.id_cobro,
  ].map((value) => Number(value || 0)).filter(Boolean);
  expect(ids[0], 'El backend debe devolver el id exacto del pago/cobro generado').toBeGreaterThan(0);
  return ids[0];
}

export async function deleteCurrentAccountPaymentViaUi(page, options) {
  const isProvider = options.kind === 'provider';
  const route = isProvider
    ? '/panel/cuentas-corrientes/proveedores'
    : '/panel/cuentas-corrientes/clientes';
  const placeholder = isProvider ? /Buscar por proveedor/i : /Buscar por cliente/i;
  const partyName = String(options.partyName || '').split('\n')[0].trim();
  const expectedId = Number(options.paymentId || 0);

  await page.goto(route);
  await waitForBusyToFinish(page);
  const search = page.getByPlaceholder(placeholder).first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(partyName);
  await page.waitForTimeout(700);
  await waitForBusyToFinish(page);

  const summary = page
    .locator('.cc-cliente-table__body button.mov-gridTable--row')
    .filter({ hasText: partyName })
    .first();
  await expect(summary, `Debe aparecer la cuenta corriente de ${partyName}`).toBeVisible({ timeout: 30_000 });
  await summary.click();

  const deleteSelector = 'button[title="Eliminar solo este registro de cobro"]';
  await expect(page.locator(deleteSelector).first()).toBeVisible({ timeout: 30_000 });
  const integer = Math.trunc(Number(options.amount || 0));
  const cents = Math.round((Number(options.amount || 0) - integer) * 100);
  const amountPattern = new RegExp(
    `(?:^|[^0-9])${integer}(?:[.,]${String(cents).padStart(2, '0')})?(?:[^0-9]|$)`,
  );
  const candidates = page
    .locator('.cc-cliente-table__body .mov-gridTable--row')
    .filter({ has: page.locator(deleteSelector) })
    .filter({ hasText: amountPattern });

  await expect.poll(
    async () => candidates.count(),
    {
      timeout: 30_000,
      intervals: [300, 700, 1_500],
      message: `Debe existir al menos un pago eliminable por ${options.amount}`,
    },
  ).toBeGreaterThan(0);

  const candidateCount = await candidates.count();

  // Cuando existen cobros históricos con el mismo importe, la grilla no expone
  // el id_cobro en el DOM y elegir una fila por monto podría borrar un registro
  // ajeno a esta ejecución. En ese caso usamos el id exacto devuelto por el alta
  // y eliminamos únicamente ese cobro mediante el mismo endpoint del sistema.
  if (candidateCount > 1) {
    expect(expectedId, 'Debe existir el id exacto del cobro para resolver importes duplicados').toBeGreaterThan(0);
    const body = await deleteCurrentAccountPayment(page, expectedId);
    expect(Number(body?.id_cobro || body?.id_movimiento_medio_pago || expectedId)).toBe(expectedId);
    return body;
  }

  await candidates.first().locator(deleteSelector).click();
  const dialog = await waitDialog(page, 'Eliminar registro de cobro');
  const responsePromise = responseForAction(page, 'cc_eliminar_cobro');
  await dialog.getByRole('button', { name: /Eliminar cobro/i }).last().click();
  const response = await responsePromise;
  const body = await responseBody(response, 'La eliminación del pago debe finalizar correctamente');
  expect(Number(body?.id_cobro || body?.id_movimiento_medio_pago || 0)).toBe(expectedId);
  await expect(dialog).toBeHidden({ timeout: 45_000 });
  return body;
}
