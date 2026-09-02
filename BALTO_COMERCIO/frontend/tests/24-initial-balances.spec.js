import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueChequeNumber, todayISO } from './support/data.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';
import { cleanupTestUser, createEmployeeTestUser, loginTestUserInNewContext } from './support/users.js';
import {
  createEntity,
  openEntityAdmin,
  deleteEntity,
  deactivateEntity,
  reactivateEntity,
} from './support/entity-lifecycle.js';

const CONFIG_ROUTE = '/panel/configuracion/saldos-iniciales';

function addDaysISO(iso, days) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function closeTo(actual, expected, precision = 2) {
  expect(Number(actual || 0)).toBeCloseTo(Number(expected || 0), precision);
}

async function ensureBaltoDocument(page) {
  // Los contextos con storageState arrancan en about:blank. localStorage sólo se
  // puede leer después de navegar a un documento del origen de Balto.
  if (!/^https?:\/\//i.test(page.url())) {
    await page.goto('/panel', { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
  }
}

async function getInitialBalances(page) {
  await ensureBaltoDocument(page);
  const result = await authenticatedApi(page, 'config_saldos_iniciales_get');
  return expectApiSuccess(result, 'No se pudieron leer los saldos iniciales');
}

function initialBalancesTablist(page) {
  return page.getByRole('tablist').first();
}

async function openInitialBalances(page, tabName = null) {
  await page.goto(CONFIG_ROUTE);
  await waitForBusyToFinish(page);
  await expect(page.getByRole('heading', { name: 'Saldos iniciales', exact: true })).toBeVisible({
    timeout: 30_000,
  });

  if (tabName) {
    const tabs = initialBalancesTablist(page);
    await expect(tabs).toBeVisible();
    await tabs.getByRole('button', { name: tabName }).click();
  }
}

async function flowDay(page, date) {
  const result = await authenticatedApi(page, 'flujo_caja_resumen', {
    query: { fecha_desde: date, fecha_hasta: date },
  });
  const body = expectApiSuccess(result, `No se pudo leer Flujo de Caja para ${date}`);
  const store = Array.isArray(body?.tiendas) ? body.tiendas[0] : null;
  const row = Array.isArray(store?.rows) ? store.rows.find((item) => item?.fecha === date) : null;
  expect(row, `Flujo de Caja debe devolver el día ${date}`).toBeTruthy();
  return row;
}

function configEntity(payload, kind, name) {
  const list = kind === 'cliente' ? payload?.clientes : payload?.proveedores;
  const expected = String(name || '').trim().toLocaleUpperCase('es-AR');
  return (Array.isArray(list) ? list : []).find(
    (row) => String(row?.nombre || '').trim().toLocaleUpperCase('es-AR') === expected,
  );
}

async function cleanupCurrentAccountFixture(page, kind, name, knownId = 0) {
  try {
    let id = Number(knownId || 0);
    if (!id) {
      const payload = await getInitialBalances(page);
      const found = configEntity(payload, kind, name);
      id = Number(kind === 'cliente' ? found?.id_cliente : found?.id_proveedor || 0);
    }

    if (id > 0) {
      await authenticatedApi(page, 'config_saldos_iniciales_cc_eliminar', {
        method: 'POST',
        body: {
          tipo_entidad: kind === 'cliente' ? 'CLIENTE' : 'PROVEEDOR',
          id_entidad: id,
        },
      }).catch(() => null);
    }
  } catch {
    // Limpieza defensiva: no tapa el error funcional original.
  }

  try {
    await openEntityAdmin(page, kind);
    await deleteEntity(page, kind, name);
  } catch {
    // Si la entidad no llegó a crearse o ya fue eliminada, no hay nada más que hacer.
  }
}

async function setCurrentAccountInitialBalance(page, {
  kind,
  name,
  situation,
  amount,
  observation,
}) {
  await openInitialBalances(page, /Cuentas corrientes/i);

  if (kind === 'proveedor') {
    await page.getByRole('main').getByRole('button', { name: 'Proveedores', exact: true }).click();
  } else {
    await page.getByRole('main').getByRole('button', { name: 'Clientes', exact: true }).click();
  }

  const search = page.getByLabel(kind === 'cliente' ? /Buscar cliente/i : /Buscar proveedor/i);
  await search.fill(name);

  const row = page.locator('.cfg-si-ccRow').filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(name);

  // El rediseño usa spans visuales (.gm-label) en este modal, no <label for=...>.
  // Localizamos cada control dentro de su .gm-field para probar la UI real sin
  // exigir cambios de accesibilidad al frontend.
  const dateField = dialog.locator('.gm-field').filter({ hasText: 'Fecha de apertura' }).locator('input[type="date"]');
  const situationField = dialog.locator('.gm-field').filter({ hasText: 'Situación' }).locator('select');
  const amountField = dialog.locator('.gm-field').filter({ hasText: 'Importe' }).locator('input');
  const observationField = dialog.locator('.gm-field').filter({ hasText: 'Observación' }).locator('textarea');

  await dateField.fill(todayISO());
  await situationField.selectOption(situation);
  await amountField.fill(String(amount).replace('.', ','));
  await observationField.fill(observation);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'config_saldos_iniciales_cc_guardar',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /^Guardar$/i }).click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));

  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito, body?.mensaje || 'El saldo inicial debe guardarse').toBe(true);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  return body;
}

async function deleteCurrentAccountInitialBalance(page, kind, name) {
  await openInitialBalances(page, /Cuentas corrientes/i);

  if (kind === 'proveedor') {
    await page.getByRole('main').getByRole('button', { name: 'Proveedores', exact: true }).click();
  }

  const search = page.getByLabel(kind === 'cliente' ? /Buscar cliente/i : /Buscar proveedor/i);
  await search.fill(name);
  const row = page.locator('.cfg-si-ccRow').filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Eliminar saldo/i })).toBeVisible();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'config_saldos_iniciales_cc_eliminar',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /Eliminar saldo/i }).click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));

  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito, body?.mensaje || 'El saldo inicial debe eliminarse').toBe(true);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

function summaryRow(body, kind, id) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const key = kind === 'cliente' ? 'id_cliente' : 'id_proveedor';
  return rows.find((row) => Number(row?.[key] || 0) === Number(id));
}

async function assertCurrentAccountBalance(page, kind, id, expectedBalance, expectedSide = null) {
  const summaryAction = kind === 'cliente' ? 'cc_saldos_clientes' : 'cc_saldos_proveedores';
  const summary = expectApiSuccess(
    await authenticatedApi(page, summaryAction),
    `No se pudo leer el saldo del ${kind}`,
  );
  const row = summaryRow(summary, kind, id);
  expect(row, `Debe existir el ${kind} de prueba en el resumen de cuenta corriente`).toBeTruthy();
  closeTo(row.saldo, expectedBalance);

  const historyAction = kind === 'cliente' ? 'cc_historial_cliente' : 'cc_historial_proveedor';
  const queryKey = kind === 'cliente' ? 'id_cliente' : 'id_proveedor';
  const history = expectApiSuccess(
    await authenticatedApi(page, historyAction, { query: { [queryKey]: id } }),
    `No se pudo leer el historial del ${kind}`,
  );
  const initial = (Array.isArray(history?.rows) ? history.rows : []).find(
    (item) => item?.tipo_registro === 'saldo_inicial',
  );

  if (Math.abs(Number(expectedBalance || 0)) < 0.001) {
    expect(initial, 'Al eliminar el saldo no debe quedar una fila SALDO INICIAL').toBeFalsy();
    return;
  }

  expect(initial, 'El historial debe exponer la fila SALDO INICIAL').toBeTruthy();
  expect(initial?.id_movimiento).toBeNull();
  expect(initial?.comprobante).toBe('SALDO INICIAL');

  if (expectedSide === 'DEUDA') {
    closeTo(initial?.debito, Math.abs(expectedBalance));
    closeTo(initial?.credito, 0);
  } else if (expectedSide === 'FAVOR') {
    closeTo(initial?.credito, Math.abs(expectedBalance));
    closeTo(initial?.debito, 0);
  }
}

async function fillInitialChequeForm(page, {
  type,
  openingDate,
  emissionDate,
  dueDate,
  issuer,
  number,
  amount,
  observation = '',
}) {
  await page.getByLabel('Tipo').selectOption(type);
  await page.getByLabel('Fecha de apertura').fill(openingDate);
  await page.getByLabel('Fecha emisión').fill(emissionDate);
  await page.getByLabel('Fecha de pago / vencimiento').fill(dueDate);
  await page.getByLabel('Emisor').fill(issuer);
  await page.getByLabel('Número').fill(number);
  await page.getByLabel('Importe').fill(String(amount).replace('.', ','));
  if (observation) await page.getByLabel('Observación').fill(observation);
}

async function createInitialCheque(page, values) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'config_saldos_iniciales_cheque_crear',
    { timeout: 90_000 },
  );
  await page.getByRole('button', { name: /Cargar en cartera/i }).click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito, body?.mensaje || 'El cheque inicial debe crearse').toBe(true);

  const cheque = (Array.isArray(body?.cheques) ? body.cheques : []).find(
    (row) => String(row?.numero_cheque || '') === String(values.number),
  );
  expect(cheque, 'La respuesta debe devolver el cheque/eCheq inicial recién cargado').toBeTruthy();
  expect(cheque?.estado).toBe('EN_CARTERA');
  return cheque;
}

async function deleteInitialCheque(page, number) {
  await openInitialBalances(page, /Cheques/i);
  const row = page.locator('.cfg-si-table tbody tr').filter({ hasText: number }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  // El rediseño actual pide confirmación antes de ejecutar el POST.
  await row.getByTitle('Eliminar carga inicial').click();
  const confirmDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: /Eliminar cheque\/eCheq/i }) })
    .last();
  await expect(confirmDialog).toBeVisible({ timeout: 15_000 });

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === 'config_saldos_iniciales_cheque_eliminar',
    { timeout: 90_000 },
  );
  await confirmDialog.getByRole('button', { name: /^Eliminar$/i }).click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito, body?.mensaje || 'El cheque inicial debe eliminarse').toBe(true);
  await expect(confirmDialog).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.cfg-si-table tbody tr').filter({ hasText: number })).toHaveCount(0, {
    timeout: 30_000,
  });
}

test('@configuracion @saldos-iniciales abre desde Configuración y expone las tres áreas', async ({ page }) => {
  await page.goto('/panel/configuracion');
  await waitForBusyToFinish(page);

  const card = page.getByText('Saldos iniciales', { exact: true }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();

  await expect(page).toHaveURL(/\/panel\/configuracion\/saldos-iniciales/);
  await expect(page.getByRole('heading', { name: 'Saldos iniciales', exact: true })).toBeVisible();
  const tabs = initialBalancesTablist(page);
  await expect(tabs.getByRole('button', { name: /^Caja y cuentas\b/i })).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Cheques\b/i })).toBeVisible();
  await expect(tabs.getByRole('button', { name: /^Cuentas corrientes\b/i })).toBeVisible();

  const payload = await getInitialBalances(page);
  expect(Array.isArray(payload?.medios_pago)).toBe(true);
  expect(
    payload.medios_pago.every((medio) => !/ECHEQ|CHEQUE/i.test(String(medio?.nombre || ''))),
    'CHEQUE y ECHEQ no deben aparecer como saldos monetarios de Caja y cuentas',
  ).toBe(true);
  expect(Array.isArray(payload?.clientes)).toBe(true);
  expect(Array.isArray(payload?.proveedores)).toBe(true);
  expect(Array.isArray(payload?.cheques)).toBe(true);
});

test('@configuracion @saldos-iniciales tesorería: UI arma el guardado y backend protege fechas/datos inválidos sin alterar dinero real', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  await openInitialBalances(page, /Caja y cuentas/i);

  const snapshot = await getInitialBalances(page);
  expect(snapshot?.medios_pago?.length, 'Debe existir al menos un medio monetario activo').toBeGreaterThan(0);

  const firstMedium = snapshot.medios_pago[0];
  const firstCard = page.locator('.cfg-si-accountCard').first();
  await expect(firstCard).toBeVisible();

  let capturedPayload = null;
  const fakeAmount = 12345.67;
  const fakeObservation = uniqueName('SALDO-TESORERIA-UI', 70);

  await page.route('**/api.php?action=config_saldos_iniciales_tesoreria_guardar**', async (route) => {
    capturedPayload = route.request().postDataJSON();
    const submitted = (Array.isArray(capturedPayload?.saldos) ? capturedPayload.saldos : []).find(
      (row) => Number(row?.id_medio_pago || 0) === Number(firstMedium.id_medio_pago),
    );

    const nextTreasury = [
      ...(Array.isArray(snapshot?.tesoreria) ? snapshot.tesoreria : []).filter(
        (row) => Number(row?.id_medio_pago || 0) !== Number(firstMedium.id_medio_pago),
      ),
      {
        id_saldo_inicial: 999999999,
        id_medio_pago: Number(firstMedium.id_medio_pago),
        medio_pago: firstMedium.nombre,
        fecha_saldo: submitted?.fecha_saldo || todayISO(),
        saldo: Number(submitted?.saldo || 0),
        observaciones: submitted?.observaciones || '',
        updated_at: `${todayISO()} 12:00:00`,
      },
    ];

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        exito: true,
        mensaje: 'Saldos iniciales de caja y cuentas guardados correctamente.',
        medios_pago: snapshot.medios_pago,
        tesoreria: nextTreasury,
        clientes: snapshot.clientes,
        proveedores: snapshot.proveedores,
        cheques: snapshot.cheques,
      }),
    });
  });

  try {
    await firstCard.getByLabel('Fecha de apertura').fill(todayISO());
    await firstCard.getByLabel('Saldo inicial').fill(String(fakeAmount).replace('.', ','));
    await firstCard.getByLabel('Observación').fill(fakeObservation);

    await page.getByRole('button', { name: /Guardar saldos/i }).click();
    await expect(page.locator('body')).toContainText(/Saldos iniciales de caja y cuentas guardados correctamente/i);

    expect(capturedPayload, 'La UI debe enviar el payload de tesorería').toBeTruthy();
    const sent = capturedPayload.saldos.find(
      (row) => Number(row?.id_medio_pago || 0) === Number(firstMedium.id_medio_pago),
    );
    expect(sent).toBeTruthy();
    closeTo(sent.saldo, fakeAmount);
    expect(sent.observaciones).toBe(fakeObservation);
  } finally {
    await page.unroute('**/api.php?action=config_saldos_iniciales_tesoreria_guardar**');
  }

  // Backend real: una fecha futura siempre debe rechazarse y, por lo tanto,
  // esta comprobación no modifica ningún saldo existente.
  const future = addDaysISO(todayISO(), 1);
  const rejectedFuture = await authenticatedApi(page, 'config_saldos_iniciales_tesoreria_guardar', {
    method: 'POST',
    body: {
      saldos: [{
        id_medio_pago: Number(firstMedium.id_medio_pago),
        fecha_saldo: future,
        saldo: 1,
        observaciones: uniqueName('NO-GUARDAR', 50),
      }],
    },
  });
  expect(rejectedFuture.status).toBe(400);
  expect(String(rejectedFuture.body?.mensaje || '')).toMatch(/fecha.*no puede ser futura/i);

  const rejectedEmpty = await authenticatedApi(page, 'config_saldos_iniciales_tesoreria_guardar', {
    method: 'POST',
    body: { saldos: [] },
  });
  expect(rejectedEmpty.status).toBe(400);
  expect(String(rejectedEmpty.body?.mensaje || '')).toMatch(/No se recibieron saldos/i);

  // Los saldos reales del tenant se consideran baseline de sólo lectura. El E2E
  // ya comprobó arriba el armado del POST interceptando la UI y ejercita el
  // backend únicamente con casos que deben ser rechazados; nunca regraba un
  // saldo real sólo para probar que persiste.
  const existing = Array.isArray(snapshot?.tesoreria) ? snapshot.tesoreria[0] : null;
  if (existing) {
    expect(Number(existing.id_medio_pago || 0)).toBeGreaterThan(0);
    expect(String(existing.fecha_saldo || '')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    testInfo.annotations.push({
      type: 'real-baseline-readonly',
      description: 'El saldo monetario real existente se leyó como baseline y no fue reescrito por Playwright.',
    });
  } else {
    testInfo.annotations.push({
      type: 'no-existing-treasury',
      description: 'No había saldos monetarios previos; el test validó UI y rechazos seguros sin crear datos permanentes.',
    });
  }
});



test('@configuracion @saldos-iniciales @guards validaciones finales: importes inválidos, CC inexistente/inactiva y cheque con fechas o monto imposibles', async ({ page }) => {
  await requireMutations(test, page);

  // Frontend: un texto no numérico jamás debe transformarse silenciosamente en 0
  // ni llegar al backend de tesorería.
  await openInitialBalances(page, /Caja y cuentas/i);
  const snapshot = await getInitialBalances(page);
  expect(snapshot?.medios_pago?.length).toBeGreaterThan(0);
  const firstCard = page.locator('.cfg-si-accountCard').first();
  await expect(firstCard).toBeVisible();

  let treasuryWrites = 0;
  const countTreasuryWrite = (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).searchParams.get('action') === 'config_saldos_iniciales_tesoreria_guardar'
    ) treasuryWrites += 1;
  };
  page.on('request', countTreasuryWrite);
  try {
    await firstCard.getByLabel('Saldo inicial').fill('importe-invalido');
    await page.getByRole('button', { name: /Guardar saldos/i }).click();
    await expect(page.locator('body')).toContainText(/importe no es válido/i);
    await page.waitForTimeout(250);
    expect(treasuryWrites, 'Un importe inválido no debe disparar ningún POST de tesorería').toBe(0);
  } finally {
    page.off('request', countTreasuryWrite);
  }

  // Backend CC: cero no es un saldo válido, eliminar algo inexistente no debe
  // fingir éxito/auditar una baja, y una entidad inactiva no puede recibir apertura.
  const name = uniqueName('SALDO-GUARDS-CLIENTE', 65);
  let entityId = 0;
  let inactive = false;
  try {
    await createEntity(page, 'cliente', name);
    let config = await getInitialBalances(page);
    const entity = configEntity(config, 'cliente', name);
    entityId = Number(entity?.id_cliente || 0);
    expect(entityId).toBeGreaterThan(0);

    const zero = await authenticatedApi(page, 'config_saldos_iniciales_cc_guardar', {
      method: 'POST',
      body: {
        tipo_entidad: 'CLIENTE', id_entidad: entityId, fecha_saldo: todayISO(),
        sentido: 'DEUDA', importe: 0, observaciones: uniqueName('NO-CERO', 50),
      },
    });
    expect(zero.status).toBe(400);
    expect(String(zero.body?.mensaje || '')).toMatch(/mayor a cero/i);

    const missingDelete = await authenticatedApi(page, 'config_saldos_iniciales_cc_eliminar', {
      method: 'POST',
      body: { tipo_entidad: 'CLIENTE', id_entidad: entityId },
    });
    expect(missingDelete.status).toBe(400);
    expect(String(missingDelete.body?.mensaje || '')).toMatch(/ya no existe/i);

    await deactivateEntity(page, 'cliente', name);
    inactive = true;
    const inactiveSave = await authenticatedApi(page, 'config_saldos_iniciales_cc_guardar', {
      method: 'POST',
      body: {
        tipo_entidad: 'CLIENTE', id_entidad: entityId, fecha_saldo: todayISO(),
        sentido: 'DEUDA', importe: 10, observaciones: uniqueName('NO-INACTIVO', 50),
      },
    });
    expect(inactiveSave.status).toBe(400);
    expect(String(inactiveSave.body?.mensaje || '')).toMatch(/dada de baja/i);

    await reactivateEntity(page, 'cliente', name);
    inactive = false;
    config = await getInitialBalances(page);
    expect(configEntity(config, 'cliente', name)?.id_saldo_inicial).toBeNull();
  } finally {
    if (inactive) await reactivateEntity(page, 'cliente', name).catch(() => null);
    await cleanupCurrentAccountFixture(page, 'cliente', name, entityId);
  }

  // Backend cheque: vencimiento anterior a emisión y overflow DECIMAL se
  // rechazan antes de INSERT, por lo que no alteran la cartera real.
  const invalidDue = await authenticatedApi(page, 'config_saldos_iniciales_cheque_crear', {
    method: 'POST',
    body: {
      tipo: 'CHEQUE',
      fecha_saldo: todayISO(),
      fecha_emision: todayISO(),
      fecha_pago: addDaysISO(todayISO(), -1),
      emisor: uniqueName('SALDO-CHEQUE-FECHA', 60),
      numero_cheque: uniqueChequeNumber(),
      importe: 10,
    },
  });
  expect(invalidDue.status).toBe(400);
  expect(String(invalidDue.body?.mensaje || '')).toMatch(/fecha de pago\/vencimiento.*no puede ser anterior.*fecha de emisión/i);

  const tooLarge = await authenticatedApi(page, 'config_saldos_iniciales_cheque_crear', {
    method: 'POST',
    body: {
      tipo: 'ECHEQ',
      fecha_saldo: todayISO(),
      fecha_emision: todayISO(),
      fecha_pago: addDaysISO(todayISO(), 1),
      emisor: uniqueName('SALDO-CHEQUE-MAX', 60),
      numero_cheque: uniqueChequeNumber(),
      importe: 10_000_000_000,
    },
  });
  expect(tooLarge.status).toBe(400);
  expect(String(tooLarge.body?.mensaje || '')).toMatch(/máximo permitido/i);
});

test('@configuracion @saldos-iniciales @security empleado básico no puede leer ni modificar aperturas por API', async ({ page, browser }) => {
  await requireMutations(test, page);
  const username = uniqueName('SALDO-EMPLEADO', 36);
  const password = 'Pw!123456';
  let context = null;

  try {
    await createEmployeeTestUser(page, username, password);
    const employeeSession = await loginTestUserInNewContext(browser, username, password);
    context = employeeSession.context;
    const employeePage = employeeSession.page;

    const forbiddenRead = await authenticatedApi(employeePage, 'config_saldos_iniciales_get');
    expect(forbiddenRead.status).toBe(403);
    expect(String(forbiddenRead.body?.mensaje || forbiddenRead.body?.message || '')).toMatch(/administrador|permiso|acceso/i);

    // Payload vacío a propósito: incluso si hubiera una regresión de permisos no
    // alteraría dinero real, pero debe ser rechazado antes de ejecutar la lógica de guardado.
    const forbiddenWrite = await authenticatedApi(employeePage, 'config_saldos_iniciales_tesoreria_guardar', {
      method: 'POST',
      body: { saldos: [] },
    });
    expect(forbiddenWrite.status).toBe(403);
    expect(String(forbiddenWrite.body?.mensaje || forbiddenWrite.body?.message || '')).toMatch(/administrador|permiso|acceso/i);
  } finally {
    if (context) await context.close().catch(() => null);
    await cleanupTestUser(page, username);
  }
});

test('@flujo @saldos-iniciales aplica aperturas existentes al saldo pero no las informa como ingresos del día', async ({ page }, testInfo) => {
  const payload = await getInitialBalances(page);
  const expectedByDate = new Map();

  for (const row of Array.isArray(payload?.tesoreria) ? payload.tesoreria : []) {
    const date = String(row?.fecha_saldo || '');
    if (!date) continue;
    expectedByDate.set(date, (expectedByDate.get(date) || 0) + Number(row?.saldo || 0));
  }
  for (const row of Array.isArray(payload?.cheques) ? payload.cheques : []) {
    const date = String(row?.fecha_saldo || '');
    if (!date) continue;
    expectedByDate.set(date, (expectedByDate.get(date) || 0) + Math.abs(Number(row?.importe || 0)));
  }

  if (!expectedByDate.size) {
    testInfo.annotations.push({
      type: 'no-opening-data',
      description: 'El tenant todavía no tiene aperturas persistidas para contrastar con Flujo de Caja.',
    });
    return;
  }

  for (const [date, expectedOpening] of expectedByDate.entries()) {
    const row = await flowDay(page, date);
    closeTo(row.saldo_inicial_aplicado, expectedOpening);
    // El saldo de apertura tiene su campo propio. Ingresos sigue representando
    // únicamente movimientos reales del día y nunca se reemplaza por la apertura.
    expect(row).toHaveProperty('ingresos');
    expect(row).toHaveProperty('egresos');
  }
});

for (const kind of ['cliente', 'proveedor']) {
  test(`@cuentas-corrientes @saldos-iniciales ${kind}: alta, cambio deuda/favor, historial y eliminación`, async ({ page }) => {
    await requireMutations(test, page);
    const name = uniqueName(`SALDO-${kind}`, 65);
    const type = kind === 'cliente' ? 'CLIENTE' : 'PROVEEDOR';
    let entityId = 0;

    try {
      await createEntity(page, kind, name);

      let config = await getInitialBalances(page);
      let entity = configEntity(config, kind, name);
      expect(entity, `La entidad ${name} debe estar disponible para configurar su saldo`).toBeTruthy();
      entityId = Number(kind === 'cliente' ? entity.id_cliente : entity.id_proveedor);
      expect(entityId).toBeGreaterThan(0);
      expect(entity.id_saldo_inicial).toBeNull();

      const debtAmount = kind === 'cliente' ? 431.25 : 532.40;
      const debtObservation = uniqueName(`SALDO-${kind}-DEUDA`, 70);
      await setCurrentAccountInitialBalance(page, {
        kind,
        name,
        situation: 'DEUDA',
        amount: debtAmount,
        observation: debtObservation,
      });

      config = await getInitialBalances(page);
      entity = configEntity(config, kind, name);
      expect(entity?.id_saldo_inicial).not.toBeNull();
      closeTo(entity?.saldo, debtAmount);
      expect(entity?.observaciones).toBe(debtObservation);
      await assertCurrentAccountBalance(page, kind, entityId, debtAmount, 'DEUDA');

      const favorAmount = kind === 'cliente' ? 117.35 : 218.60;
      const favorObservation = uniqueName(`SALDO-${kind}-FAVOR`, 70);
      await setCurrentAccountInitialBalance(page, {
        kind,
        name,
        situation: 'FAVOR',
        amount: favorAmount,
        observation: favorObservation,
      });

      config = await getInitialBalances(page);
      entity = configEntity(config, kind, name);
      closeTo(entity?.saldo, -favorAmount);
      expect(entity?.observaciones).toBe(favorObservation);
      await assertCurrentAccountBalance(page, kind, entityId, -favorAmount, 'FAVOR');

      // Backend: sentido inválido debe rechazarse sin modificar el saldo vigente.
      const invalidSide = await authenticatedApi(page, 'config_saldos_iniciales_cc_guardar', {
        method: 'POST',
        body: {
          tipo_entidad: type,
          id_entidad: entityId,
          fecha_saldo: todayISO(),
          sentido: 'INVALIDO',
          importe: 999,
          observaciones: 'NO DEBE GUARDARSE',
        },
      });
      expect(invalidSide.status).toBe(400);
      expect(String(invalidSide.body?.mensaje || '')).toMatch(/Situación inicial inválida/i);
      await assertCurrentAccountBalance(page, kind, entityId, -favorAmount, 'FAVOR');

      await deleteCurrentAccountInitialBalance(page, kind, name);
      await assertCurrentAccountBalance(page, kind, entityId, 0);

      config = await getInitialBalances(page);
      entity = configEntity(config, kind, name);
      expect(entity?.id_saldo_inicial).toBeNull();
    } finally {
      await cleanupCurrentAccountFixture(page, kind, name, entityId);
    }
  });
}

for (const type of ['CHEQUE', 'ECHEQ']) {
  test(`@cheques @saldos-iniciales ${type}: fecha protegida, alta en cartera, duplicado y eliminación limpia`, async ({ page }) => {
    await requireMutations(test, page);
    const number = uniqueChequeNumber();
    const invalidNumber = uniqueChequeNumber();
    const issuer = uniqueName(`SALDO-${type}`, 60);
    const amount = type === 'CHEQUE' ? 684.30 : 785.40;
    const today = todayISO();
    const yesterday = addDaysISO(today, -1);
    const dueDate = addDaysISO(today, 30);
    let created = false;

    try {
      await openInitialBalances(page, /Cheques/i);

      // Fecha de emisión posterior a la apertura: la UI debe frenarla antes de llamar al backend.
      await fillInitialChequeForm(page, {
        type,
        openingDate: yesterday,
        emissionDate: today,
        dueDate,
        issuer: `${issuer}-INVALIDO`,
        number: invalidNumber,
        amount: 10,
      });
      // El formulario ya blinda esta regla antes de llamar al backend. El test viejo
      // esperaba un POST 400 y por eso agotaba 90 s aunque la UI estuviera funcionando bien.
      let invalidCreateRequests = 0;
      const countInvalidCreate = (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).searchParams.get('action') === 'config_saldos_iniciales_cheque_crear'
        ) invalidCreateRequests += 1;
      };
      page.on('request', countInvalidCreate);
      await page.getByRole('button', { name: /Cargar en cartera/i }).click();
      await expect(page.locator('body')).toContainText(
        /fecha de emisión.*no puede ser posterior.*fecha de apertura/i,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(250);
      page.off('request', countInvalidCreate);
      expect(invalidCreateRequests, 'La validación de fechas debe cortar el alta antes del POST').toBe(0);

      const beforeFlow = await flowDay(page, today);

      // Alta válida.
      await fillInitialChequeForm(page, {
        type,
        openingDate: today,
        emissionDate: today,
        dueDate,
        issuer,
        number,
        amount,
        observation: uniqueName(`APERTURA-${type}`, 65),
      });
      const cheque = await createInitialCheque(page, { number });
      created = true;
      expect(cheque?.tipo).toBe(type);
      closeTo(cheque?.importe, amount);

      const configRow = page.locator('.cfg-si-table tbody tr').filter({ hasText: number }).first();
      await expect(configRow).toBeVisible({ timeout: 30_000 });
      await expect(configRow).toContainText(issuer);
      await expect(configRow).toContainText(/EN CARTERA/i);

      // Debe ser un documento real reutilizado por el módulo normal de cartera.
      const carteraRoute = type === 'ECHEQ'
        ? '/panel/cheques/echeqs-cartera'
        : '/panel/cheques/cartera';
      await page.goto(carteraRoute);
      await waitForBusyToFinish(page);
      const search = page.locator('input[placeholder*="Buscar" i]').first();
      await search.fill(number);
      await search.press('Enter');
      const carteraRow = page
        .locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)')
        .filter({ hasText: number })
        .first();
      await expect(carteraRow).toBeVisible({ timeout: 30_000 });
      await expect(carteraRow).toContainText(issuer);

      // El alta de un cheque inicial incrementa apertura, no "Ingresos".
      const afterFlow = await flowDay(page, today);
      closeTo(
        Number(afterFlow.saldo_inicial_aplicado || 0) - Number(beforeFlow.saldo_inicial_aplicado || 0),
        amount,
      );
      closeTo(afterFlow.ingresos, beforeFlow.ingresos);
      closeTo(afterFlow.egresos, beforeFlow.egresos);

      // Un número ya existente no puede cargarse de nuevo.
      await openInitialBalances(page, /Cheques/i);
      await fillInitialChequeForm(page, {
        type,
        openingDate: today,
        emissionDate: today,
        dueDate,
        issuer: `${issuer}-DUP`,
        number,
        amount,
      });
      let responsePromise = page.waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          new URL(res.url()).searchParams.get('action') === 'config_saldos_iniciales_cheque_crear',
        { timeout: 90_000 },
      );
      await page.getByRole('button', { name: /Cargar en cartera/i }).click();
      let response = await responsePromise;
      let body = await response.json().catch(() => ({}));
      expect(response.status()).toBe(400);
      expect(String(body?.mensaje || '')).toMatch(/Ya existe un cheque\/eCheq con ese número/i);

      await deleteInitialCheque(page, number);
      created = false;

      const afterDeleteFlow = await flowDay(page, today);
      closeTo(afterDeleteFlow.saldo_inicial_aplicado, beforeFlow.saldo_inicial_aplicado);
      closeTo(afterDeleteFlow.ingresos, beforeFlow.ingresos);
      closeTo(afterDeleteFlow.egresos, beforeFlow.egresos);

      const config = await getInitialBalances(page);
      expect(
        config.cheques.some((row) => String(row?.numero_cheque || '') === number),
        'El cheque inicial eliminado no debe quedar en Configuración',
      ).toBe(false);
    } finally {
      if (created) {
        try {
          await deleteInitialCheque(page, number);
        } catch {
          // Limpieza defensiva.
        }
      }
    }
  });
}

test('@cheques @saldos-iniciales @critical un cheque inicial usado queda protegido contra eliminación', async ({ page }) => {
  await requireMutations(test, page);
  const number = uniqueChequeNumber();
  const issuer = uniqueName('SALDO-CHEQUE-USADO', 60);
  const today = todayISO();

  await openInitialBalances(page, /Cheques/i);
  await fillInitialChequeForm(page, {
    type: 'CHEQUE',
    openingDate: today,
    emissionDate: today,
    dueDate: addDaysISO(today, 15),
    issuer,
    number,
    amount: 96.75,
    observation: uniqueName('APERTURA-USADA', 65),
  });
  const cheque = await createInitialCheque(page, { number });
  const idCheque = Number(cheque?.id_cheque || 0);
  expect(idCheque).toBeGreaterThan(0);

  // Lo usamos mediante la misma acción real de cartera. A partir de este punto
  // ya existe historia posterior a la apertura y Configuración jamás debe poder
  // borrar el documento para "hacer desaparecer" ese recorrido.
  const deposit = await authenticatedApi(page, 'cheques_cartera_depositar', {
    method: 'POST',
    body: { id_cheque: idCheque, fecha_deposito: today },
  });
  const depositBody = expectApiSuccess(deposit, 'No se pudo depositar el cheque inicial de prueba');
  expect(String(depositBody?.estado || '')).toBe('DEPOSITADO_BANCO');

  const blockedDelete = await authenticatedApi(page, 'config_saldos_iniciales_cheque_eliminar', {
    method: 'POST',
    body: { id_cheque: idCheque },
  });
  expect(blockedDelete.status).toBe(400);
  expect(String(blockedDelete.body?.mensaje || '')).toMatch(/movimientos posteriores|relacionado a un movimiento|historial posterior/i);

  const config = await getInitialBalances(page);
  const stillPresent = (Array.isArray(config?.cheques) ? config.cheques : []).find(
    (row) => Number(row?.id_cheque || 0) === idCheque,
  );
  expect(stillPresent, 'El intento de borrado rechazado no debe quitar el saldo inicial').toBeTruthy();
  expect(String(stillPresent?.estado || '')).toBe('DEPOSITADO_BANCO');

  // No lo revertimos/borramos manualmente: justamente la lógica de saldos
  // debe negarse. El cleanup E2E identifica el cheque por el emisor PW-* y
  // elimina de forma controlada flujo, historial, saldo inicial y documento.
});
