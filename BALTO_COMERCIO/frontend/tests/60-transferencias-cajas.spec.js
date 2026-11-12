import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { RUN_PREFIX, todayISO } from './support/data.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';
import { cleanupTestUser, createEmployeeTestUser, loginTestUserInNewContext } from './support/users.js';

/**
 * BALTO Comercio · Transferencias internas entre cajas (Flujo de Caja).
 *
 * Adaptado de la suite 50 de BALTO Servicios. Diferencias de Comercio:
 *  - El historial conserva la columna Usuario (también para transferencias).
 *  - Se verifica además el Dashboard de Comercio (caja actual, líquido y
 *    saldos por medio), que toma sus disponibilidades de Análisis Financiero.
 *
 * Bloques, de menor a mayor impacto:
 *  A) Interfaz con mocks (page.route): no escribe nada. Apto para cualquier entorno.
 *  B) API de sólo lectura (GET): validaciones de la vista previa autoritativa.
 *  C) Mutaciones reales: requieren PW_ALLOW_MUTATIONS=1, tenant E2E aislado,
 *     BALTO_E2E_TOOLS_ENABLED=1 en el backend de PRUEBA y la migración
 *     `tesoreria_transferencias` aplicada. Toda transferencia lleva el RUN_PREFIX
 *     en observaciones: el limpiador E2E borra primero las reversiones y luego
 *     las originales (la tabla sólo admite ese DELETE dentro del limpiador).
 *     Nunca se ejecuta contra producción sin habilitación explícita.
 *
 * Numeración de los casos = numeración del requerimiento (1 a 50).
 */

const FLUJO_ROUTE = '/panel/flujo-de-caja';
const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);
const nbsp = (s) => String(s || '').replace(/ /g, ' ').trim();
const money2 = (n) => (Math.round(amount(n) * 100) / 100).toFixed(2);

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function clave(label = 'k') {
  return `trf-${RUN_PREFIX}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/* =========================================================
   A) Interfaz con mocks
========================================================= */

const MOCK_MEDIOS = [
  { id_medio_pago: 1, nombre: 'EFECTIVO', activo: true, grupo_key: 'efectivo', grupo_label: 'EFECTIVO', saldo_actual: 150000, puede_origen: true, puede_destino: true },
  { id_medio_pago: 2, nombre: 'MERCADO PAGO', activo: true, grupo_key: 'mercado_pago', grupo_label: 'MERCADO PAGO', saldo_actual: 50000, puede_origen: true, puede_destino: true },
  { id_medio_pago: 4, nombre: 'BANCO', activo: true, grupo_key: 'banco', grupo_label: 'BANCO', saldo_actual: 150000, puede_origen: true, puede_destino: true },
  { id_medio_pago: 11, nombre: 'SANTANDER BANCO', activo: true, grupo_key: 'banco', grupo_label: 'BANCO', saldo_actual: 20000, puede_origen: true, puede_destino: true },
  { id_medio_pago: 13, nombre: 'CUENTA VIEJA', activo: false, grupo_key: 'medio_13', grupo_label: 'CUENTA VIEJA', saldo_actual: 5000, puede_origen: true, puede_destino: false },
];
const MOCK_AJ_MEDIOS = MOCK_MEDIOS.filter((m) => m.activo).map(({ puede_origen: _o, puede_destino: _d, ...m }) => ({ ...m, ajustable: true }));

async function routeAction(page, action, handler) {
  await page.route((url) => url.pathname.endsWith('/api.php') && url.searchParams.get('action') === action, handler);
}

function mockTransferRow(today, over = {}) {
  return {
    id_transferencia: 7, tipo: 'TRANSFERENCIA', tipo_label: 'TRANSFERENCIA INTERNA', fecha: today, created_at: `${today} 10:30:00`,
    id_medio_origen: 4, medio_origen_nombre: 'BANCO', medio_origen_activo: true,
    id_medio_destino: 7, medio_destino_nombre: 'PERSONAL PAY', medio_destino_activo: true,
    importe: 25000, saldo_origen_anterior: 175000, saldo_origen_posterior: 150000, saldo_destino_anterior: 0, saldo_destino_posterior: 25000,
    observaciones: 'PAGO A PROVEEDOR', usuario_nombre: 'ADMIN', id_transferencia_revertida: null, revertido_por: null,
    estado: 'VIGENTE', puede_revertir: true, efecto_medio: null, ...over,
  };
}

/**
 * Mocks de transferencias + resumen real (fetch-through con snapshot por URL,
 * igual que el test 43) forzando la gestión habilitada.
 */
async function mockTransferencias(page, opts = {}) {
  const calls = { crear: [], previsualizar: [], revertir: [], listar: [] };
  const today = todayISO();
  const resumenCache = new Map();
  const resumenPendiente = new Map();
  await routeAction(page, 'flujo_caja_resumen', async (route) => {
    const url = route.request().url();
    let snapshot = resumenCache.get(url);
    if (!snapshot) {
      if (!resumenPendiente.has(url)) {
        resumenPendiente.set(url, (async () => {
          const response = await route.fetch();
          const json = await response.json();
          json.ajustes_saldo = { habilitado: true, puede_gestionar: true };
          json.transferencias = { habilitado: true };
          for (const row of json?.tiendas?.[0]?.rows || []) {
            const cards = row.medios_pago || [];
            for (const c of cards) c.transferencias = 0;
            if (row.fecha === today && opts.cardTransfer && cards.length >= 2) {
              cards[0].transferencias = -10000;
              cards[1].transferencias = 10000;
            }
          }
          const headers = { ...response.headers() };
          delete headers['content-length'];
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];
          const resultado = { status: response.status(), headers, json };
          resumenCache.set(url, resultado);
          return resultado;
        })());
      }
      const pendiente = resumenPendiente.get(url);
      try { snapshot = await pendiente; } finally { if (resumenPendiente.get(url) === pendiente) resumenPendiente.delete(url); }
    }
    await route.fulfill({ status: snapshot.status, headers: snapshot.headers, json: snapshot.json });
  });
  await routeAction(page, 'flujo_caja_ajustes_medios', (route) => route.fulfill({
    json: { exito: true, fecha_negocio: today, medios: MOCK_AJ_MEDIOS, motivos: [{ codigo: 'DIFERENCIA_DE_ARQUEO', label: 'DIFERENCIA DE ARQUEO' }], habilitado: true },
  }));
  await routeAction(page, 'flujo_caja_ajustes_listar', (route) => route.fulfill({ json: { exito: true, rows: [], neto: 0, total: 0 } }));
  await routeAction(page, 'flujo_caja_transferencias_medios', (route) => route.fulfill({
    json: { exito: true, fecha_negocio: today, medios: MOCK_MEDIOS, total_negocio: 375000, habilitado: true },
  }));
  await routeAction(page, 'flujo_caja_transferencias_previsualizar', (route) => {
    const q = Object.fromEntries(new URL(route.request().url()).searchParams.entries());
    calls.previsualizar.push(q);
    if (opts.previewError) return route.fulfill({ status: opts.previewError.status, json: { exito: false, ...opts.previewError.body } });
    const o = MOCK_MEDIOS.find((m) => m.id_medio_pago === Number(q.id_medio_origen));
    const d = MOCK_MEDIOS.find((m) => m.id_medio_pago === Number(q.id_medio_destino));
    const imp = Number(q.importe);
    return route.fulfill({ json: { exito: true, preview: {
      fecha_negocio: today, importe: imp,
      origen: { ...o, delta: -imp, saldo_posterior: o.saldo_actual - imp },
      destino: { ...d, delta: imp, saldo_posterior: d.saldo_actual + imp },
      total_negocio_actual: 375000, total_negocio_posterior: 375000, variacion_total: 0,
      mismo_grupo: o.grupo_key === d.grupo_key, advertencias: [],
    } } });
  });
  await routeAction(page, 'flujo_caja_transferencias_crear', async (route) => {
    calls.crear.push(route.request().postDataJSON());
    await new Promise((r) => setTimeout(r, 400)); // ventana para un segundo clic
    if (opts.crearError) return route.fulfill({ status: opts.crearError.status, json: { exito: false, ...opts.crearError.body } });
    return route.fulfill({ json: { exito: true, mensaje: 'Transferencia registrada correctamente.', duplicado: false, transferencia: mockTransferRow(today, { id_transferencia: 8 }) } });
  });
  await routeAction(page, 'flujo_caja_transferencias_listar', (route) => {
    const q = Object.fromEntries(new URL(route.request().url()).searchParams.entries());
    calls.listar.push(q);
    const rows = q.estado && q.estado !== 'VIGENTE' ? [] : [mockTransferRow(today)];
    return route.fulfill({ json: { exito: true, rows, total: rows.length, neto: 0, habilitado: true } });
  });
  await routeAction(page, 'flujo_caja_transferencias_revertir', (route) => {
    calls.revertir.push(route.request().postDataJSON());
    return route.fulfill({ json: { exito: true, mensaje: 'Transferencia revertida correctamente.', duplicado: false,
      transferencia: mockTransferRow(today, { id_transferencia: 9, tipo: 'REVERSION', estado: 'REVERSION', puede_revertir: false }),
      original: mockTransferRow(today, { estado: 'REVERTIDO', revertido_por: 9, puede_revertir: false }) } });
  });
  return calls;
}

async function openFlujo(page) {
  await page.goto(FLUJO_ROUTE);
  await expect(page.locator('.mov-page--flujoCaja .mov-card__title')).toBeVisible();
  await waitForBusyToFinish(page);
  await expect(page.locator('.fc-dayRow').first()).toBeVisible();
}

async function openTransferTab(page) {
  await page.getByRole('button', { name: 'Ajustar saldo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajustar saldo' });
  await expect(dialog).toBeVisible();
  const tab = dialog.getByRole('tab', { name: 'Transferir entre cajas' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.locator('#fc-tr-origen')).toBeEnabled();
  return dialog;
}

async function fillTransfer(dialog, { origen = '4', destino = '2', importe = '10000', obs = '' } = {}) {
  await dialog.locator('#fc-tr-origen').selectOption(origen);
  await dialog.locator('#fc-tr-destino').selectOption(destino);
  await dialog.locator('#fc-tr-importe').fill(importe);
  if (obs) await dialog.locator('#fc-tr-observaciones').fill(obs);
}

test.describe('@flujo @transferencias interfaz (mocks, sin escrituras)', () => {
  test('1-3, 5-6 · cuarta pestaña, ajustes intactos, medios reales sin cheques y con saldo', async ({ page }) => {
    await mockTransferencias(page);
    await openFlujo(page);
    await page.getByRole('button', { name: 'Ajustar saldo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajustar saldo' });
    await expect(dialog.getByRole('tab')).toHaveText(['Establecer saldo', 'Sumar importe', 'Restar importe', 'Transferir entre cajas']);
    // 2 · las tres opciones actuales conservan su comportamiento.
    await expect(dialog.getByRole('tab', { name: 'Establecer saldo' })).toHaveAttribute('aria-selected', 'true');
    await dialog.locator('#fc-aj-importe').fill('145.000');
    expect(nbsp(await dialog.getByTestId('fc-aj-diferencia').textContent())).toBe('− $ 5.000,00');
    await dialog.getByRole('tab', { name: 'Sumar importe' }).click();
    await dialog.locator('#fc-aj-importe').fill('20.000,50');
    expect(nbsp(await dialog.getByTestId('fc-aj-nuevo-saldo').textContent())).toBe('$ 170.000,50');

    await dialog.getByRole('tab', { name: 'Transferir entre cajas' }).click();
    await expect(dialog.locator('#fc-aj-importe')).toHaveCount(0);
    await expect(dialog.locator('#fc-tr-origen')).toBeEnabled();
    const origenes = (await dialog.locator('#fc-tr-origen option').allTextContents()).map(nbsp);
    const destinos = (await dialog.locator('#fc-tr-destino option').allTextContents()).map(nbsp);
    // 3 y 6 · IDs reales con nombre y saldo actual, agrupados sin perder el medio individual.
    expect(origenes).toContain('BANCO · $ 150.000,00');
    expect(origenes).toContain('SANTANDER BANCO · $ 20.000,00');
    await expect(dialog.locator('#fc-tr-origen optgroup[label="BANCO"] option')).toHaveCount(2);
    // 5 · sin CHEQUE / ECHEQ.
    expect([...origenes, ...destinos].join(' ')).not.toMatch(/CHEQ/i);
    // Política: inactivo con saldo sólo como origen.
    expect(origenes.some((t) => /CUENTA VIEJA.*INACTIVO/.test(t))).toBe(true);
    expect(destinos.some((t) => /CUENTA VIEJA/.test(t))).toBe(false);
  });

  test('4, 7-8 · no permite el mismo medio, valida importe y calcula saldos posteriores', async ({ page }) => {
    const calls = await mockTransferencias(page);
    await openFlujo(page);
    const dialog = await openTransferTab(page);
    await dialog.locator('#fc-tr-origen').selectOption('4');
    await expect(dialog.locator('#fc-tr-destino option[value="4"]')).toBeDisabled();
    await dialog.locator('#fc-tr-destino').selectOption('2');
    await expect(dialog.locator('#fc-tr-origen option[value="2"]')).toBeDisabled();

    const confirmar = dialog.getByRole('button', { name: 'Confirmar transferencia' });
    for (const invalid of ['1.2.3', '12,345', '1,2,3']) {
      await dialog.locator('#fc-tr-importe').fill(invalid);
      await confirmar.click();
      await expect(dialog.getByText('Ingresá un importe válido (hasta 2 decimales).')).toBeVisible();
    }
    await dialog.locator('#fc-tr-importe').fill('abc');
    await expect(dialog.locator('#fc-tr-importe')).toHaveValue('');
    await dialog.locator('#fc-tr-importe').fill('0');
    await confirmar.click();
    await expect(dialog.getByText('El importe debe ser mayor a cero.')).toBeVisible();
    await dialog.locator('#fc-tr-importe').fill('150000,01');
    await confirmar.click();
    await expect(dialog.getByText(/supera el saldo disponible en BANCO/)).toBeVisible();
    expect(calls.previsualizar, 'Nada inválido llega al backend').toHaveLength(0);

    await dialog.locator('#fc-tr-importe').fill('10000');
    expect(nbsp(await dialog.getByTestId('fc-tr-origen-actual').textContent())).toBe('$ 150.000,00');
    expect(nbsp(await dialog.getByTestId('fc-tr-origen-delta').textContent())).toBe('− $ 10.000,00');
    expect(nbsp(await dialog.getByTestId('fc-tr-origen-posterior').textContent())).toBe('$ 140.000,00');
    expect(nbsp(await dialog.getByTestId('fc-tr-destino-actual').textContent())).toBe('$ 50.000,00');
    expect(nbsp(await dialog.getByTestId('fc-tr-destino-delta').textContent())).toBe('+ $ 10.000,00');
    expect(nbsp(await dialog.getByTestId('fc-tr-destino-posterior').textContent())).toBe('$ 60.000,00');
    expect(nbsp(await dialog.getByTestId('fc-tr-total').textContent())).toMatch(/^Sin cambios/);
    await dialog.locator('#fc-tr-importe').blur();
    await expect(dialog.locator('#fc-tr-importe')).toHaveValue('10.000,00');

    // Dos medios de la misma tarjeta: se informa que la tarjeta no cambia.
    await dialog.locator('#fc-tr-destino').selectOption('11');
    await expect(dialog.getByTestId('fc-tr-mismo-grupo')).toBeVisible();
  });

  test('9-10 · confirmación con datos del backend y doble clic = una sola solicitud', async ({ page }) => {
    const calls = await mockTransferencias(page);
    await openFlujo(page);
    const dialog = await openTransferTab(page);
    await fillTransfer(dialog, { obs: 'transferencia desde el banco' });
    await dialog.getByRole('button', { name: 'Confirmar transferencia' }).click();

    const confirm = page.getByRole('dialog', { name: 'Confirmar transferencia entre cajas' });
    await expect(confirm).toBeVisible();
    expect(calls.previsualizar).toHaveLength(1);
    expect(calls.previsualizar[0]).toMatchObject({ id_medio_origen: '4', id_medio_destino: '2', importe: '10000.00' });
    expect(nbsp(await confirm.getByTestId('fc-tr-confirm-importe').textContent())).toBe('$ 10.000,00');
    expect(nbsp(await confirm.getByTestId('fc-tr-confirm-origen-posterior').textContent())).toBe('$ 140.000,00');
    expect(nbsp(await confirm.getByTestId('fc-tr-confirm-destino-posterior').textContent())).toBe('$ 60.000,00');
    await expect(confirm.getByText('TRANSFERENCIA DESDE EL BANCO')).toBeVisible();

    const resumenRefrescado = page.waitForResponse((r) => r.url().includes('action=flujo_caja_resumen') && r.request().method() === 'GET' && r.ok());
    await confirm.getByRole('button', { name: 'Registrar transferencia' }).dblclick();
    await expect(confirm).toBeHidden();
    await expect(page.getByText('Transferencia registrada correctamente.')).toBeVisible();
    await resumenRefrescado;

    expect(calls.crear, 'Un doble clic no puede generar dos transferencias').toHaveLength(1);
    const body = calls.crear[0];
    expect(body).toMatchObject({ id_medio_origen: 4, id_medio_destino: 2, importe: '10000.00', saldo_origen_esperado: '150000.00', saldo_destino_esperado: '50000.00' });
    expect(body.clave_solicitud).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(body, 'El navegador no decide fecha ni saldos resultantes').not.toHaveProperty('fecha');
    expect(body).not.toHaveProperty('saldo_origen_posterior');
  });

  test('11 · errores del backend: vista previa, saldo desactualizado y rechazo final', async ({ page }) => {
    await mockTransferencias(page, { previewError: { status: 409, body: { codigo: 'SALDO_INSUFICIENTE', mensaje: 'Saldo insuficiente en BANCO: disponible $ 1,00.' } } });
    await openFlujo(page);
    let dialog = await openTransferTab(page);
    await fillTransfer(dialog, { importe: '10' });
    await dialog.getByRole('button', { name: 'Confirmar transferencia' }).click();
    await expect(dialog.locator('.fc-aj-error', { hasText: 'Saldo insuficiente en BANCO' })).toBeVisible();

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const calls = await mockTransferencias(page, { crearError: { status: 409, body: { codigo: 'SALDO_DESACTUALIZADO', mensaje: 'El saldo de BANCO cambió.', medios_cambiados: [{ nombre: 'BANCO' }] } } });
    await openFlujo(page);
    dialog = await openTransferTab(page);
    await fillTransfer(dialog, { importe: '10' });
    await dialog.getByRole('button', { name: 'Confirmar transferencia' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirmar transferencia entre cajas' });
    await confirm.getByRole('button', { name: 'Registrar transferencia' }).click();
    await expect(page.getByRole('dialog', { name: 'Ajustar saldo' }).getByText(/El saldo de BANCO cambió antes de confirmar/)).toBeVisible();
    expect(calls.crear).toHaveLength(1);
    await expect(page.getByText('Transferencia registrada correctamente.')).toHaveCount(0);
  });

  test('tarjetas: concepto "Transferencias internas" separado de ingresos y egresos', async ({ page }) => {
    await mockTransferencias(page, { cardTransfer: true });
    await openFlujo(page);
    const fechaHoy = todayISO().split('-').reverse().join('/');
    const filaHoy = page.locator('.fc-dayRow').filter({ has: page.locator('[data-label="FECHA"]', { hasText: fechaHoy }) });
    await filaHoy.click();
    const rows = page.locator('.fc-payCard__row--transferencias');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Transferencias internas');
    await expect(rows.first()).toContainText(/−\s?\$\s?10\.000,00/);
    await expect(rows.nth(1)).toContainText(/\+\s?\$\s?10\.000,00/);
  });

  test('38-40 · historial: todos / ajustes / transferencias, detalle y filtros', async ({ page }) => {
    const calls = await mockTransferencias(page);
    await openFlujo(page);
    await page.getByRole('button', { name: 'Historial de ajustes de saldo' }).click();
    const hist = page.getByRole('dialog', { name: 'Historial de ajustes de saldo' });
    const row = hist.locator('[data-transferencia-id="7"]');
    await expect(row).toBeVisible();
    // Comercio conserva la columna Usuario del historial (también en transferencias).
    await expect(hist.getByRole('columnheader', { name: 'Usuario', exact: true })).toHaveCount(1);
    await expect(row.locator('[data-label="Usuario"]')).toHaveText('ADMIN');
    for (const text of ['BANCO', 'PERSONAL PAY', 'TRANSFERENCIA INTERNA', 'VIGENTE']) {
      await expect(row.getByText(text, { exact: true }).first()).toBeVisible();
    }
    await expect(row.locator('[data-label="Importe"]')).toHaveText(/25\.000,00/);
    await row.getByRole('button', { name: 'Detalle de la transferencia #7' }).click();
    const det = hist.locator('[data-transferencia-detalle="7"]');
    await expect(det).toContainText(/175\.000,00 → \$\s?150\.000,00/);
    await expect(det).toContainText(/0,00 → \$\s?25\.000,00/);
    await expect(det.getByText('Usuario', { exact: true })).toBeVisible();
    await expect(det.getByText('ADMIN', { exact: true })).toBeVisible();

    await hist.getByRole('tab', { name: 'Ajustes' }).click();
    await expect(hist.locator('[data-transferencia-id]')).toHaveCount(0);
    await hist.getByRole('tab', { name: 'Transferencias' }).click();
    await expect(hist.locator('[data-transferencia-id="7"]')).toBeVisible();

    await hist.locator('#fc-aj-f-medio').selectOption({ label: 'BANCO' });
    expect(calls.listar.at(-1).id_medio_pago).toBe('4');
    await hist.locator('#fc-aj-f-estado').selectOption('REVERTIDO');
    expect(calls.listar.at(-1).estado).toBe('REVERTIDO');
    await expect(hist.getByText('No hay registros')).toBeVisible();
    await hist.locator('#fc-aj-f-estado').selectOption('');
    await hist.locator('#fc-aj-f-desde').fill(todayISO());
    expect(calls.listar.at(-1).fecha_desde).toBe(todayISO());
  });

  test('41 · revertir desde el historial pide motivo y envía la compensación vinculada', async ({ page }) => {
    const calls = await mockTransferencias(page);
    await openFlujo(page);
    await page.getByRole('button', { name: 'Historial de ajustes de saldo' }).click();
    const hist = page.getByRole('dialog', { name: 'Historial de ajustes de saldo' });
    await hist.locator('[data-transferencia-id="7"]').getByRole('button', { name: 'Revertir transferencia #7' }).click();
    const rev = page.getByRole('alertdialog', { name: 'Revertir transferencia #7' });
    expect(nbsp(await rev.getByTestId('fc-tr-revert-route').textContent())).toBe('PERSONAL PAY → BANCO');
    await rev.getByRole('button', { name: 'Confirmar reversión' }).click();
    await expect(rev.getByText(/mínimo 5 caracteres/)).toBeVisible();
    expect(calls.revertir).toHaveLength(0);
    await rev.locator('#fc-aj-revert-motivo').fill('cargada dos veces');
    await rev.getByRole('button', { name: 'Confirmar reversión' }).click();
    await expect(rev).toBeHidden();
    expect(calls.revertir).toHaveLength(1);
    expect(calls.revertir[0]).toMatchObject({ id_transferencia: 7, observaciones: 'CARGADA DOS VECES' });
  });

  test('12-13 · escritorio y móvil sin desbordes', async ({ page }) => {
    await mockTransferencias(page);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await openFlujo(page);
      const dialog = await openTransferTab(page);
      await fillTransfer(dialog);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `Sin scroll horizontal en ${viewport.width}px`).toBeLessThanOrEqual(1);
      const box = await dialog.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      await expect(dialog.getByRole('button', { name: 'Confirmar transferencia' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Confirmar transferencia' }).click();
      const confirm = page.getByRole('dialog', { name: 'Confirmar transferencia entre cajas' });
      const cbox = await confirm.boundingBox();
      expect(cbox.x + cbox.width).toBeLessThanOrEqual(viewport.width + 1);
      await confirm.getByRole('button', { name: 'Volver' }).click();
      await dialog.getByRole('button', { name: 'Ver historial' }).click();
      const hist = page.getByRole('dialog', { name: 'Historial de ajustes de saldo' });
      await expect(hist.locator('[data-transferencia-id="7"]')).toBeVisible();
      const hbox = await hist.boundingBox();
      expect(hbox.x + hbox.width).toBeLessThanOrEqual(viewport.width + 1);
      await hist.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
      await expect(hist).toBeHidden();
    }
  });
});

/* =========================================================
   B) API de sólo lectura (vista previa: nunca escribe)
========================================================= */

async function mediosTransfer(page) {
  return expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_medios', { query: { _: Date.now() } }));
}

/** Dos medios activos distintos; origen = el de mayor saldo. */
function elegirPar(medios) {
  const activos = medios.filter((m) => m.puede_destino);
  const origen = [...medios].filter((m) => m.puede_origen).sort((a, b) => amount(b.saldo_actual) - amount(a.saldo_actual))[0];
  const destino = activos.find((m) => m.id_medio_pago !== origen?.id_medio_pago);
  return { origen, destino };
}

test.describe('@flujo @transferencias API sin escrituras', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/panel', { waitUntil: 'domcontentloaded' });
  });

  test('3, 5 · medios admitidos con el mismo saldo que Análisis Financiero', async ({ page }) => {
    const json = await mediosTransfer(page);
    expect(json.fecha_negocio).toBe(todayISO());
    expect(json.medios.length).toBeGreaterThan(0);
    const af = expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', { query: { fecha_desde: todayISO(), fecha_hasta: todayISO() } }));
    for (const m of json.medios) {
      expect(m.nombre).not.toMatch(/CHEQ/i);
      expect(m.puede_destino ? m.activo : true, `${m.nombre}: destino sólo activo`).toBe(true);
      const afMedio = af.tesoreria.medios.find((x) => Number(x.id) === Number(m.id_medio_pago));
      close(m.saldo_actual, afMedio?.saldo_final, `Saldo de ${m.nombre} = Análisis Financiero`);
    }
    close(json.total_negocio, af.tesoreria.saldo_final, 'Total del negocio = disponibilidades');
  });

  test('14-19, 22 · la vista previa rechaza importes, medios y fechas inválidos', async ({ page }) => {
    const { medios } = await mediosTransfer(page);
    const { origen, destino } = elegirPar(medios);
    test.skip(!origen || !destino, 'Se necesitan dos medios monetarios.');
    const preview = (query) => authenticatedApi(page, 'flujo_caja_transferencias_previsualizar', {
      query: { id_medio_origen: origen.id_medio_pago, id_medio_destino: destino.id_medio_pago, importe: '1', ...query },
    });
    for (const importe of ['0', '-5', 'abc', '1.234', '1e5', '10000000000000', '']) {
      const res = await preview({ importe });
      expect(res.status, `Importe "${importe}"`).toBe(400);
      expect(['IMPORTE_INVALIDO', 'IMPORTE_FUERA_DE_RANGO']).toContain(res.body.codigo);
    }
    const casos = [
      [{ id_medio_origen: 999999 }, 'MEDIO_INEXISTENTE'],
      [{ id_medio_destino: 999999 }, 'MEDIO_INEXISTENTE'],
      [{ id_medio_destino: origen.id_medio_pago }, 'MISMO_MEDIO'],
      [{ id_medio_origen: '' }, 'ORIGEN_REQUERIDO'],
    ];
    for (const [query, codigo] of casos) {
      const res = await preview(query);
      expect(res.status, codigo).toBe(400);
      expect(res.body.codigo).toBe(codigo);
    }
    const insuf = await preview({ importe: money2(amount(origen.saldo_actual) + 0.01) });
    expect(insuf.status).toBe(409);
    expect(insuf.body.codigo).toBe('SALDO_INSUFICIENTE');
    for (const fecha of [addDaysISO(todayISO(), 1), addDaysISO(todayISO(), -1), '2026-02-30']) {
      const res = await preview({ fecha });
      expect(res.status, `Fecha ${fecha}`).toBe(400);
      expect(['FECHA_NO_PERMITIDA', 'FECHA_INVALIDA']).toContain(res.body.codigo);
    }
    const ok = expectApiSuccess(await preview({ importe: '1.50', fecha: todayISO() }));
    close(ok.preview.origen.saldo_posterior, amount(origen.saldo_actual) - 1.5, 'Origen posterior');
    close(ok.preview.destino.saldo_posterior, amount(destino.saldo_actual) + 1.5, 'Destino posterior');
    close(ok.preview.variacion_total, 0, 'Variación total 0');
    close(ok.preview.total_negocio_posterior, ok.preview.total_negocio_actual, 'Total sin cambios');
  });

  test('5 · CHEQUE / ECHEQ no se admiten aunque se arme la solicitud', async ({ page }) => {
    const listas = await authenticatedApi(page, 'global_obtener_listas');
    const mediosTodos = listas.body?.medios_pago || listas.body?.data?.medios_pago || [];
    const cheque = mediosTodos.find((m) => /CHEQ/i.test(String(m.nombre || '')));
    test.skip(!cheque, 'El tenant no informa un medio CHEQUE/ECHEQ en las listas globales.');
    const { medios } = await mediosTransfer(page);
    const res = await authenticatedApi(page, 'flujo_caja_transferencias_previsualizar', {
      query: { id_medio_origen: cheque.id_medio_pago, id_medio_destino: medios[0].id_medio_pago, importe: '1' },
    });
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('MEDIO_NO_ADMITIDO');
  });

  test('crear y revertir exigen POST; el resumen informa la habilitación', async ({ page }) => {
    for (const action of ['flujo_caja_transferencias_crear', 'flujo_caja_transferencias_revertir']) {
      expect((await authenticatedApi(page, action, { method: 'GET' })).status, action).toBe(405);
    }
    const resumen = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_resumen', { query: { fecha_desde: todayISO(), fecha_hasta: todayISO() } }));
    expect(typeof resumen.transferencias?.habilitado).toBe('boolean');
    for (const row of resumen.tiendas[0].rows) {
      close(row.transferencias_internas, 0, `${row.fecha}: el neto total de transferencias es 0`);
    }
  });
});

/* =========================================================
   C) Mutaciones reales (tenant E2E aislado)
========================================================= */

async function snapshot(page) {
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);
  const fc = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_resumen', { query: { fecha_desde: yesterday, fecha_hasta: today, _: Date.now() } }));
  const af = expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', { query: { fecha_desde: today, fecha_hasta: today, _: Date.now() } }));
  const afMes = expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', { query: { fecha_desde: `${today.slice(0, 7)}-01`, fecha_hasta: today, _: Date.now() } }));
  const db = expectApiSuccess(await authenticatedApi(page, 'dashboard_resumen', { query: { fecha_desde: `${today.slice(0, 7)}-01`, fecha_hasta: today, _: Date.now() } }));
  const rows = fc.tiendas[0].rows;
  const medios = (await mediosTransfer(page)).medios;
  return {
    fc, af, afMes, db, medios,
    byId: Object.fromEntries(medios.map((m) => [m.id_medio_pago, m])),
    hoy: rows.find((r) => r.fecha === today),
    ayer: rows.find((r) => r.fecha === yesterday),
  };
}

function bodyFor(origen, destino, importe, over = {}) {
  return {
    id_medio_origen: origen.id_medio_pago,
    id_medio_destino: destino.id_medio_pago,
    importe: money2(importe),
    observaciones: `${RUN_PREFIX} TRANSFERENCIA E2E`,
    saldo_origen_esperado: money2(origen.saldo_actual),
    saldo_destino_esperado: money2(destino.saldo_actual),
    clave_solicitud: clave('c'),
    ...over,
  };
}

async function listarTr(page, query = {}) {
  return expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_listar', { query: { ...query, _: Date.now() } }));
}

async function cuentasCorrientes(page) {
  const strip = (body) => { const { request_id: _r, ...rest } = body || {}; return rest; };
  return {
    clientes: strip(expectApiSuccess(await authenticatedApi(page, 'cc_saldos_clientes', { query: { _: 1 } }))),
    proveedores: strip(expectApiSuccess(await authenticatedApi(page, 'cc_saldos_proveedores', { query: { _: 1 } }))),
  };
}

test.describe('@flujo @transferencias @mutations transferencias reales y conciliación', () => {
  test.describe.configure({ mode: 'serial' });

  const importe = 1234.56;
  let par = null;
  let antes = null;
  let ccAntes = null;
  let transferencia = null;

  test.beforeEach(async ({ page }) => {
    await requireMutations(test, page);
    await page.goto('/panel', { waitUntil: 'domcontentloaded' });
    const res = await authenticatedApi(page, 'flujo_caja_resumen', { query: { fecha_desde: todayISO(), fecha_hasta: todayISO() } });
    test.skip(!res.body?.transferencias?.habilitado, 'La migración tesoreria_transferencias no está aplicada en este tenant.');
  });

  test('14-26 · validaciones de crear, idempotencia y sin escrituras parciales', async ({ page }) => {
    const s = await snapshot(page);
    par = elegirPar(s.medios);
    test.skip(!par.origen || !par.destino || amount(par.origen.saldo_actual) < importe * 3, 'Se necesitan dos medios y saldo suficiente en el origen.');
    const { origen, destino } = par;
    const crear = (body) => authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body });
    const totalAntes = (await listarTr(page)).total;

    const rechazos = [
      [{ importe: '0' }, 400, 'IMPORTE_INVALIDO'],
      [{ importe: '-10' }, 400, 'IMPORTE_INVALIDO'],
      [{ importe: '1,5' }, 400, 'IMPORTE_INVALIDO'],
      [{ id_medio_origen: 999999 }, 400, 'MEDIO_INEXISTENTE'],
      [{ id_medio_destino: 999999 }, 400, 'MEDIO_INEXISTENTE'],
      [{ id_medio_destino: origen.id_medio_pago }, 400, 'MISMO_MEDIO'],
      [{ importe: money2(amount(origen.saldo_actual) + 1) }, 409, 'SALDO_INSUFICIENTE'],
      [{ saldo_origen_esperado: money2(amount(origen.saldo_actual) + 1) }, 409, 'SALDO_DESACTUALIZADO'],
      [{ fecha: addDaysISO(todayISO(), 1) }, 400, 'FECHA_NO_PERMITIDA'],
      [{ fecha: addDaysISO(todayISO(), -1) }, 400, 'FECHA_NO_PERMITIDA'],
      [{ clave_solicitud: 'x' }, 400, 'CLAVE_SOLICITUD_INVALIDA'],
      [{ saldo_destino_esperado: '' }, 400, 'SALDO_ESPERADO_REQUERIDO'],
    ];
    for (const [over, status, codigo] of rechazos) {
      const res = await crear(bodyFor(origen, destino, importe, over));
      expect(res.status, `${codigo} ${JSON.stringify(over)}`).toBe(status);
      expect(res.body.codigo).toBe(codigo);
    }
    const stale = await crear(bodyFor(origen, destino, importe, { saldo_destino_esperado: money2(amount(destino.saldo_actual) - 1) }));
    expect(stale.body.medios_cambiados?.map((m) => m.id_medio_pago)).toEqual([destino.id_medio_pago]);

    // 26 · ninguna validación fallida dejó registros ni movió dinero.
    expect((await listarTr(page)).total).toBe(totalAntes);
    const despues = await snapshot(page);
    close(despues.byId[origen.id_medio_pago].saldo_actual, origen.saldo_actual, 'Origen intacto');
    close(despues.byId[destino.id_medio_pago].saldo_actual, destino.saldo_actual, 'Destino intacto');
  });

  test('27-37 · transferencia real: saldos, conciliación y reportes sin duplicar', async ({ page }) => {
    test.skip(!par?.origen, 'Requiere el par de medios del paso anterior.');
    antes = await snapshot(page);
    ccAntes = await cuentasCorrientes(page);
    const origen = antes.byId[par.origen.id_medio_pago];
    const destino = antes.byId[par.destino.id_medio_pago];
    const body = bodyFor(origen, destino, importe);

    const creado = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body }));
    transferencia = creado.transferencia;
    expect(creado.duplicado).toBe(false);
    expect(transferencia).toMatchObject({ estado: 'VIGENTE', tipo: 'TRANSFERENCIA', fecha: todayISO(), id_medio_origen: origen.id_medio_pago, id_medio_destino: destino.id_medio_pago });
    close(transferencia.saldo_origen_anterior, origen.saldo_actual, 'Snapshot origen anterior');
    close(transferencia.saldo_origen_posterior, amount(origen.saldo_actual) - importe, 'Snapshot origen posterior');
    close(transferencia.saldo_destino_posterior, amount(destino.saldo_actual) + importe, 'Snapshot destino posterior');

    // 24 · idempotencia: reenvío idéntico devuelve la misma operación.
    const repetido = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body }));
    expect(repetido.duplicado).toBe(true);
    expect(repetido.transferencia.id_transferencia).toBe(transferencia.id_transferencia);
    // 25 · misma clave con otros datos: conflicto sin mover dinero.
    const reuso = await authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body: { ...body, importe: money2(importe + 1) } });
    expect(reuso.status).toBe(409);
    expect(reuso.body.codigo).toBe('CLAVE_SOLICITUD_REUTILIZADA');

    const d = await snapshot(page);
    // 27-29
    close(d.byId[origen.id_medio_pago].saldo_actual, amount(origen.saldo_actual) - importe, '27 · el origen disminuye exactamente el importe');
    close(d.byId[destino.id_medio_pago].saldo_actual, amount(destino.saldo_actual) + importe, '28 · el destino aumenta exactamente el importe');
    close(d.fc.saldo_actual, antes.fc.saldo_actual, '29 · saldo total del negocio sin cambios');
    close(d.af.tesoreria.saldo_final, antes.af.tesoreria.saldo_final, '29 · disponibilidades sin cambios');
    // 30-32
    close(d.hoy.ingresos, antes.hoy.ingresos, '30 · ingresos operativos sin cambios');
    close(d.hoy.egresos, antes.hoy.egresos, '31 · egresos operativos sin cambios');
    close(d.af.tesoreria.ingresos, antes.af.tesoreria.ingresos, '30 · cobros sin cambios');
    close(d.af.tesoreria.egresos, antes.af.tesoreria.egresos, '31 · pagos sin cambios');
    expect(d.afMes.valores, '32 · ventas, costos, otros egresos y resultado sin cambios').toEqual(antes.afMes.valores);
    expect(await cuentasCorrientes(page), 'Cuentas corrientes intactas').toEqual(ccAntes);
    close(d.hoy.ajustes_manuales, antes.hoy.ajustes_manuales, 'No se mezcla con ajustes manuales');
    close(d.hoy.ajustes_internos, antes.hoy.ajustes_internos, 'No se mezcla con ajustes internos de cheques');
    close(d.af.tesoreria.ajustes_manuales, antes.af.tesoreria.ajustes_manuales, 'AF: ajustes manuales sin cambios');
    // 33 · Flujo de Caja = Análisis Financiero.
    close(d.af.tesoreria.saldo_final, d.hoy.saldo, '33 · mismo saldo en ambos informes');
    close(d.af.tesoreria.saldo_actual, d.fc.saldo_actual, '33 · mismo saldo actual');
    for (const m of [origen, destino]) {
      const afMedio = d.af.tesoreria.medios.find((x) => Number(x.id) === Number(m.id_medio_pago));
      close(afMedio.saldo_final, d.byId[m.id_medio_pago].saldo_actual, `33 · ${m.nombre}: AF = saldo de transferencias`);
    }
    const afO = d.af.tesoreria.medios.find((x) => Number(x.id) === Number(origen.id_medio_pago));
    close(amount(afO.transferencias_internas) - amount(antes.af.tesoreria.medios.find((x) => Number(x.id) === Number(origen.id_medio_pago)).transferencias_internas), -importe, 'AF: concepto propio en el origen');
    close(d.af.tesoreria.transferencias_internas, 0, '37 · el total de transferencias no se duplica ni suma');
    // Dashboard de Comercio: la caja actual no cambia y cada medio refleja la transferencia.
    close(d.db.kpis.saldo_caja_actual, antes.db.kpis.saldo_caja_actual, 'Dashboard · caja actual sin cambios');
    close(d.db.kpis.saldo_caja_liquido, d.af.tesoreria.saldo_final, 'Dashboard · líquido = Análisis Financiero');
    close(d.db.kpis.ventas_periodo, antes.db.kpis.ventas_periodo, 'Dashboard · ventas sin cambios');
    close(d.db.kpis.ingresos_periodo, antes.db.kpis.ingresos_periodo, 'Dashboard · ingresos sin cambios');
    close(d.db.kpis.egresos_periodo, antes.db.kpis.egresos_periodo, 'Dashboard · egresos sin cambios');
    const dbMedio = (snap, id) => (snap.db.kpis.saldo_caja_medios || []).find((m) => Number(m.id_medio_pago) === Number(id));
    close(amount(dbMedio(d, origen.id_medio_pago)?.saldo) - amount(dbMedio(antes, origen.id_medio_pago)?.saldo), -importe, 'Dashboard · medio de origen');
    close(amount(dbMedio(d, destino.id_medio_pago)?.saldo) - amount(dbMedio(antes, destino.id_medio_pago)?.saldo), importe, 'Dashboard · medio de destino');
    // 34 · histórico intacto.
    close(d.ayer.saldo, antes.ayer.saldo, '34 · el cierre de ayer no cambia');
    expect(d.ayer.medios_pago, '34 · tarjetas de ayer intactas').toEqual(antes.ayer.medios_pago);
    // 35 · acumulado del día refleja la transferencia en las tarjetas.
    const grupoO = d.hoy.medios_pago.find((c) => c.medios.some((x) => x.id_medio_pago === origen.id_medio_pago));
    const grupoD = d.hoy.medios_pago.find((c) => c.medios.some((x) => x.id_medio_pago === destino.id_medio_pago));
    const antesO = antes.hoy.medios_pago.find((c) => c.key === grupoO.key);
    const antesD = antes.hoy.medios_pago.find((c) => c.key === grupoD.key);
    if (grupoO.key !== grupoD.key) {
      close(grupoO.saldo - antesO.saldo, -importe, '35 · tarjeta de origen');
      close(grupoD.saldo - antesD.saldo, importe, '35 · tarjeta de destino');
      close(grupoO.transferencias - antesO.transferencias, -importe, 'Concepto Transferencias internas en la tarjeta');
    }
    close(d.hoy.medios_pago.reduce((s, c) => s + amount(c.saldo), 0), d.hoy.saldo, '37 · las tarjetas suman el saldo general');
    close(d.hoy.transferencias_internas, 0, 'Fila del día: neto total 0');
    expect(d.hoy.transferencias_cantidad).toBeGreaterThanOrEqual(1);

    // 38-39 · historial
    const hist = await listarTr(page, { id_medio_pago: origen.id_medio_pago, fecha_desde: todayISO(), fecha_hasta: todayISO() });
    const row = hist.rows.find((r) => r.id_transferencia === transferencia.id_transferencia);
    expect(row).toMatchObject({ estado: 'VIGENTE', puede_revertir: true, medio_origen_nombre: origen.nombre, medio_destino_nombre: destino.nombre });
    expect(row.usuario_nombre).toBeTruthy();
    expect(row.observaciones).toBe(body.observaciones);
    close(row.efecto_medio, -importe, 'Efecto sobre el medio filtrado');
    expect(hist.rows.filter((r) => r.id_transferencia === transferencia.id_transferencia)).toHaveLength(1);
  });

  test('40 · filtros del historial (medio de destino, fechas, tipo y estado)', async ({ page }) => {
    test.skip(!transferencia, 'Requiere la transferencia del paso anterior.');
    const porDestino = await listarTr(page, { id_medio_pago: transferencia.id_medio_destino });
    expect(porDestino.rows.some((r) => r.id_transferencia === transferencia.id_transferencia)).toBe(true);
    const ayer = await listarTr(page, { fecha_desde: addDaysISO(todayISO(), -1), fecha_hasta: addDaysISO(todayISO(), -1) });
    expect(ayer.rows.some((r) => r.id_transferencia === transferencia.id_transferencia)).toBe(false);
    const reversiones = await listarTr(page, { tipo: 'REVERSION' });
    expect(reversiones.rows.every((r) => r.tipo === 'REVERSION')).toBe(true);
    const vigentes = await listarTr(page, { estado: 'VIGENTE' });
    expect(vigentes.rows.some((r) => r.id_transferencia === transferencia.id_transferencia)).toBe(true);
    const ordenadas = [...vigentes.rows].sort((a, b) => (a.created_at === b.created_at ? b.id_transferencia - a.id_transferencia : a.created_at < b.created_at ? 1 : -1));
    expect(vigentes.rows.map((r) => r.id_transferencia)).toEqual(ordenadas.map((r) => r.id_transferencia));
  });

  test('41-43, 45-46 · reversión compensatoria, una sola vez y sin tocar el pasado', async ({ page }) => {
    test.skip(!transferencia, 'Requiere la transferencia del paso anterior.');
    const a = await snapshot(page);
    const body = { id_transferencia: transferencia.id_transferencia, observaciones: `${RUN_PREFIX} REVERSION E2E`, clave_solicitud: clave('rev') };
    const sinMotivo = await authenticatedApi(page, 'flujo_caja_transferencias_revertir', { method: 'POST', body: { ...body, observaciones: 'x', clave_solicitud: clave('rev0') } });
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.codigo).toBe('OBSERVACIONES_REQUERIDAS');

    const rev = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_revertir', { method: 'POST', body }));
    expect(rev.transferencia).toMatchObject({
      tipo: 'REVERSION', estado: 'REVERSION', id_transferencia_revertida: transferencia.id_transferencia,
      id_medio_origen: transferencia.id_medio_destino, id_medio_destino: transferencia.id_medio_origen,
    });
    close(rev.transferencia.importe, importe, '41 · mismo importe');
    expect(rev.original.estado).toBe('REVERTIDO');

    const repetida = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_revertir', { method: 'POST', body }));
    expect(repetida.duplicado).toBe(true);
    const otra = await authenticatedApi(page, 'flujo_caja_transferencias_revertir', { method: 'POST', body: { ...body, clave_solicitud: clave('rev2') } });
    expect(otra.status).toBe(409);
    expect(otra.body.codigo).toBe('TRANSFERENCIA_YA_REVERTIDA');
    const deReversion = await authenticatedApi(page, 'flujo_caja_transferencias_revertir', { method: 'POST', body: { ...body, id_transferencia: rev.transferencia.id_transferencia, clave_solicitud: clave('rev3') } });
    expect(deReversion.status).toBe(409);
    expect(deReversion.body.codigo).toBe('REVERSION_NO_REVERSIBLE');

    const d = await snapshot(page);
    close(d.byId[transferencia.id_medio_origen].saldo_actual, amount(a.byId[transferencia.id_medio_origen].saldo_actual) + importe, '41 · el origen recupera el importe');
    close(d.byId[transferencia.id_medio_destino].saldo_actual, amount(a.byId[transferencia.id_medio_destino].saldo_actual) - importe, '41 · el destino lo devuelve');
    close(d.fc.saldo_actual, a.fc.saldo_actual, '45 · total inalterado tras revertir');
    close(d.db.kpis.saldo_caja_actual, a.db.kpis.saldo_caja_actual, '45 · Dashboard inalterado tras revertir');
    close(d.af.tesoreria.saldo_final, d.hoy.saldo, '45 · conciliación tras revertir');
    close(d.ayer.saldo, a.ayer.saldo, '46 · la reversión no altera días anteriores');
    expect(d.afMes.valores).toEqual(a.afMes.valores);

    // 42 · original conservada y ambas visibles.
    const hist = await listarTr(page, { id_medio_pago: transferencia.id_medio_origen });
    expect(hist.rows.find((r) => r.id_transferencia === transferencia.id_transferencia)).toMatchObject({ estado: 'REVERTIDO', revertido_por: rev.transferencia.id_transferencia, puede_revertir: false });
    expect(hist.rows.find((r) => r.id_transferencia === rev.transferencia.id_transferencia)).toMatchObject({ estado: 'REVERSION', puede_revertir: false });
  });

  test('44 · no se revierte si la caja que devuelve no tiene saldo suficiente', async ({ page }) => {
    const s = await snapshot(page);
    const { origen } = elegirPar(s.medios);
    const activos = s.medios.filter((m) => m.puede_destino && m.id_medio_pago !== origen?.id_medio_pago);
    test.skip(!origen || activos.length < 2 || amount(origen.saldo_actual) < 10, 'Se necesitan tres medios y saldo en el origen.');
    const [b, c] = activos;
    const x = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body: bodyFor(origen, b, 5) })).transferencia;
    const s2 = await snapshot(page);
    // Vaciar B hacia C: la caja que debería devolver ya no tiene el dinero.
    const vaciar = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_crear', {
      method: 'POST', body: bodyFor(s2.byId[b.id_medio_pago], s2.byId[c.id_medio_pago], s2.byId[b.id_medio_pago].saldo_actual),
    })).transferencia;
    const totalAntes = (await listarTr(page)).total;
    const res = await authenticatedApi(page, 'flujo_caja_transferencias_revertir', {
      method: 'POST', body: { id_transferencia: x.id_transferencia, observaciones: `${RUN_PREFIX} REVERSION SIN SALDO`, clave_solicitud: clave('rsin') },
    });
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('SALDO_INSUFICIENTE');
    expect(res.body.mensaje).toMatch(/No se puede revertir automáticamente/);
    expect((await listarTr(page)).total, 'Sin escrituras').toBe(totalAntes);
    // Dejar el estado ordenado: revertir primero el vaciado y luego la original.
    for (const id of [vaciar.id_transferencia, x.id_transferencia]) {
      expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_revertir', {
        method: 'POST', body: { id_transferencia: id, observaciones: `${RUN_PREFIX} REVERSION ORDEN`, clave_solicitud: clave('rord') },
      }));
    }
  });

  test('36 · transferencia entre dos medios del mismo grupo visual', async ({ page }) => {
    const s = await snapshot(page);
    const card = s.hoy.medios_pago.find((c) => c.medios.filter((m) => s.byId[m.id_medio_pago]?.puede_destino).length >= 2
      && c.medios.some((m) => amount(s.byId[m.id_medio_pago]?.saldo_actual) >= 1));
    test.skip(!card, 'El tenant no tiene dos medios activos agrupados en la misma tarjeta.');
    const enGrupo = card.medios.map((m) => s.byId[m.id_medio_pago]).filter(Boolean);
    const o = enGrupo.find((m) => amount(m.saldo_actual) >= 1);
    const d = enGrupo.find((m) => m.id_medio_pago !== o.id_medio_pago && m.puede_destino);
    const t = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body: bodyFor(o, d, 1) })).transferencia;
    const after = await snapshot(page);
    close(after.byId[o.id_medio_pago].saldo_actual, amount(o.saldo_actual) - 1, 'Medio individual de origen');
    close(after.byId[d.id_medio_pago].saldo_actual, amount(d.saldo_actual) + 1, 'Medio individual de destino');
    close(after.hoy.medios_pago.find((c) => c.key === card.key).saldo, card.saldo, 'La tarjeta del grupo no cambia (correcto)');
    expect((await listarTr(page, { id_medio_pago: d.id_medio_pago })).rows.some((r) => r.id_transferencia === t.id_transferencia), 'Figura en el historial').toBe(true);
  });

  test('48 · dos solicitudes simultáneas sobre el mismo saldo: una sola se aplica', async ({ page }) => {
    const s = await snapshot(page);
    const { origen, destino } = elegirPar(s.medios);
    test.skip(!origen || !destino || amount(origen.saldo_actual) < 2, 'Saldo insuficiente para la prueba.');
    const [r1, r2] = await Promise.all([
      authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body: bodyFor(origen, destino, 1) }),
      authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body: bodyFor(origen, destino, 1) }),
    ]);
    const estados = [r1.status, r2.status].sort();
    expect(estados, 'Una se registra y la otra detecta el saldo ya modificado').toEqual([200, 409]);
    expect([r1, r2].find((r) => r.status === 409).body.codigo).toBe('SALDO_DESACTUALIZADO');
    const after = await snapshot(page);
    close(after.byId[origen.id_medio_pago].saldo_actual, amount(origen.saldo_actual) - 1, 'El origen bajó una sola vez');
    close(after.fc.saldo_actual, s.fc.saldo_actual, 'Total intacto');
  });

  test('49 · operaciones simultáneas en sentidos opuestos no se interbloquean', async ({ page }) => {
    const s = await snapshot(page);
    const { origen, destino } = elegirPar(s.medios);
    test.skip(!origen || !destino || amount(origen.saldo_actual) < 1 || amount(destino.saldo_actual) < 1, 'Ambos medios necesitan saldo.');
    const results = await Promise.all([
      authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body: bodyFor(origen, destino, 1) }),
      authenticatedApi(page, 'flujo_caja_transferencias_crear', { method: 'POST', body: bodyFor(destino, origen, 1) }),
    ]);
    for (const r of results) {
      // Un deadlock aparecería como 5xx: los bloqueos se toman siempre en orden ascendente.
      expect([200, 409], `HTTP ${r.status} ${r.body?.codigo || ''}`).toContain(r.status);
    }
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    const after = await snapshot(page);
    close(after.fc.saldo_actual, s.fc.saldo_actual, 'Total intacto');
    close(after.af.tesoreria.saldo_final, after.hoy.saldo, 'Conciliación intacta');
  });

  test('47, 23 · un empleado básico no puede consultar ni gestionar transferencias', async ({ page, browser }) => {
    const username = `${RUN_PREFIX}-TR-EMP`.slice(0, 36);
    const password = 'Pw!123456';
    let context = null;
    try {
      await createEmployeeTestUser(page, username, password);
      const employee = await loginTestUserInNewContext(browser, username, password);
      context = employee.context;
      const ep = employee.page;
      const { medios } = await mediosTransfer(page);
      const { origen, destino } = elegirPar(medios);
      const crear = await authenticatedApi(ep, 'flujo_caja_transferencias_crear', { method: 'POST', body: bodyFor(origen, destino, 1) });
      expect(crear.status).toBe(403);
      for (const action of ['flujo_caja_transferencias_medios', 'flujo_caja_transferencias_listar', 'flujo_caja_transferencias_previsualizar']) {
        expect((await authenticatedApi(ep, action, { query: { id_medio_origen: origen.id_medio_pago, id_medio_destino: destino.id_medio_pago, importe: '1' } })).status, action).toBe(403);
      }
      const revert = await authenticatedApi(ep, 'flujo_caja_transferencias_revertir', { method: 'POST', body: { id_transferencia: transferencia?.id_transferencia || 1, observaciones: `${RUN_PREFIX} EMP`, clave_solicitud: clave('emp') } });
      expect(revert.status).toBe(403);
      await ep.goto(FLUJO_ROUTE);
      await expect(ep.locator('.fc-dayRow').first()).toBeVisible();
      await expect(ep.getByRole('button', { name: 'Ajustar saldo' })).toHaveCount(0);
    } finally {
      if (context) await context.close().catch(() => null);
      await cleanupTestUser(page, username);
    }
  });

  test('50 · aislamiento de tenant: sólo medios del tenant autenticado, sin parámetros de tenant', async ({ page }) => {
    const { medios } = await mediosTransfer(page);
    const { origen, destino } = elegirPar(medios);
    test.skip(!origen || !destino, 'Se necesitan dos medios.');
    // El navegador no puede elegir base ni tenant: cualquier campo de ese tipo se ignora
    // y la conexión sigue siendo la de la sesión. Un medio ajeno al tenant no existe aquí.
    const ajeno = await authenticatedApi(page, 'flujo_caja_transferencias_crear', {
      method: 'POST', body: bodyFor(origen, destino, 1, { id_medio_destino: 2147483646, id_tenant: 999, tenant_id: 999, db_name: 'otro_tenant' }),
    });
    expect(ajeno.status).toBe(400);
    expect(ajeno.body.codigo).toBe('MEDIO_INEXISTENTE');
    const listado = await listarTr(page, { id_tenant: 999 });
    const ids = new Set(medios.map((m) => m.id_medio_pago));
    for (const r of listado.rows.filter((x) => String(x.observaciones || '').startsWith(RUN_PREFIX))) {
      expect(ids.has(r.id_medio_origen) || r.medio_origen_activo === false).toBe(true);
    }
  });
});
