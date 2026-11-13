import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { RUN_PREFIX, todayISO } from '../support/data.js';
import { requireMutations, waitForBusyToFinish } from '../support/ui.js';
import { cleanupTestUser, createEmployeeTestUser, loginTestUserInNewContext } from '../support/users.js';
import fs from 'node:fs';

/**
 * BALTO Comercio · Ajustes de saldos de caja (Flujo de Caja)
 *
 * Tres bloques, de menor a mayor impacto:
 *  A) Interfaz con mocks (page.route): no escribe nada. Apto para cualquier entorno.
 *  B) API de sólo lectura: validaciones de fecha e importes vía previsualizar (GET).
 *  C) Mutaciones reales: requieren PW_ALLOW_MUTATIONS=1, tenant E2E aislado y la
 *     migración `tesoreria_ajustes_saldo` aplicada. Cada ajuste lleva el RUN_PREFIX
 *     en observaciones: el limpiador E2E borra primero las reversiones y luego los
 *     originales. Nunca se ejecuta contra producción sin habilitación explícita.
 */

const FLUJO_ROUTE = '/panel/flujo-de-caja';
const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);
const nbsp = (s) => String(s || '').replace(/ /g, ' ').trim();

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function clave(label = 'k') {
  return `${RUN_PREFIX}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/* =========================================================
   A) Interfaz con mocks
========================================================= */

const MOCK_MEDIOS = [
  { id_medio_pago: 1, nombre: 'EFECTIVO', activo: true, grupo_key: 'efectivo', grupo_label: 'EFECTIVO', saldo_actual: 150000, ajustable: true },
  { id_medio_pago: 8, nombre: 'CAJA CHICA', activo: true, grupo_key: 'efectivo', grupo_label: 'EFECTIVO', saldo_actual: 0, ajustable: true },
  { id_medio_pago: 4, nombre: 'BANCO', activo: true, grupo_key: 'banco', grupo_label: 'BANCO', saldo_actual: 200000, ajustable: true },
  { id_medio_pago: 2, nombre: 'MERCADO PAGO', activo: true, grupo_key: 'mercado_pago', grupo_label: 'MERCADO PAGO', saldo_actual: 80000, ajustable: true },
];
const MOCK_MOTIVOS = [
  { codigo: 'DIFERENCIA_DE_ARQUEO', label: 'DIFERENCIA DE ARQUEO' },
  { codigo: 'CONCILIACION_BANCARIA', label: 'CONCILIACIÓN BANCARIA' },
  { codigo: 'REGULARIZACION_DE_SALDO', label: 'REGULARIZACIÓN DE SALDO' },
  { codigo: 'CORRECCION_ADMINISTRATIVA', label: 'CORRECCIÓN ADMINISTRATIVA' },
  { codigo: 'OTRO', label: 'OTRO' },
];

async function routeAction(page, action, handler) {
  await page.route((url) => url.pathname.endsWith('/api.php') && url.searchParams.get('action') === action, handler);
}

/** Instala mocks de ajustes y fuerza la habilitación en el resumen real. */
async function mockAjustes(page, { todayAjuste = 0 } = {}) {
  const calls = { crear: [], previsualizar: [] };
  const today = todayISO();

  // El alta de un ajuste dispara una segunda lectura del resumen. Si cada lectura
  // hace route.fetch() contra el backend remoto, la petición puede seguir viva al
  // terminar el test y fallar con "Response has been disposed". Mantener un
  // snapshot por URL hace el mock estable sin perder los datos reales de apertura.
  const resumenCache = new Map();
  const resumenPendiente = new Map();
  await routeAction(page, 'flujo_caja_resumen', async (route) => {
    const url = route.request().url();
    let snapshot = resumenCache.get(url);
    if (!snapshot) {
      if (!resumenPendiente.has(url)) {
        const cargar = (async () => {
          const response = await route.fetch();
          const json = await response.json();
          json.ajustes_saldo = { habilitado: true, puede_gestionar: true };
          for (const row of json?.tiendas?.[0]?.rows || []) {
            row.ajustes_manuales = row.fecha === today ? todayAjuste : 0;
          }
          const headers = { ...response.headers() };
          // El cuerpo JSON cambia de tamaño; conservar CORS pero no los headers
          // de transporte correspondientes al cuerpo original.
          delete headers['content-length'];
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];
          const resultado = { status: response.status(), headers, json };
          resumenCache.set(url, resultado);
          return resultado;
        })();
        resumenPendiente.set(url, cargar);
      }
      const pendiente = resumenPendiente.get(url);
      try {
        snapshot = await pendiente;
      } finally {
        if (resumenPendiente.get(url) === pendiente) resumenPendiente.delete(url);
      }
    }
    await route.fulfill({ status: snapshot.status, headers: snapshot.headers, json: snapshot.json });
  });
  await routeAction(page, 'flujo_caja_ajustes_medios', (route) => route.fulfill({
    json: { exito: true, fecha_negocio: today, medios: MOCK_MEDIOS, motivos: MOCK_MOTIVOS, habilitado: true },
  }));
  await routeAction(page, 'flujo_caja_ajustes_previsualizar', (route) => {
    const q = new URL(route.request().url()).searchParams;
    calls.previsualizar.push(Object.fromEntries(q.entries()));
    const medio = MOCK_MEDIOS.find((m) => m.id_medio_pago === Number(q.get('id_medio_pago')));
    const importe = Number(q.get('importe'));
    const tipo = q.get('tipo_ajuste');
    const diferencia = tipo === 'ESTABLECER' ? importe - medio.saldo_actual : tipo === 'SUMAR' ? importe : -importe;
    return route.fulfill({
      json: {
        exito: true,
        preview: {
          medio, tipo, importe_ingresado: importe, saldo_actual: medio.saldo_actual, diferencia,
          saldo_nuevo: medio.saldo_actual + diferencia, sin_diferencia: diferencia === 0,
          advertencias: [], fecha_negocio: today,
        },
      },
    });
  });
  await routeAction(page, 'flujo_caja_ajustes_crear', async (route) => {
    calls.crear.push(route.request().postDataJSON());
    await new Promise((r) => setTimeout(r, 400)); // ventana para un segundo clic
    await route.fulfill({
      json: { exito: true, mensaje: 'Ajuste de saldo registrado correctamente.', duplicado: false, ajuste: { id_ajuste: 1 }, saldo_actual: 145000 },
    });
  });
  await routeAction(page, 'flujo_caja_ajustes_listar', (route) => route.fulfill({
    json: {
      exito: true, total: 1, neto: -5000, rows: [{
        id_ajuste: 1, id_medio_pago: 1, medio_nombre: 'EFECTIVO', fecha: today, created_at: `${today} 10:15:00`,
        tipo: 'ESTABLECER', tipo_label: 'ESTABLECER SALDO REAL', importe_ingresado: 145000, diferencia: -5000,
        saldo_anterior: 150000, saldo_posterior: 145000, motivo: 'DIFERENCIA_DE_ARQUEO', motivo_label: 'DIFERENCIA DE ARQUEO',
        observaciones: 'FALTANTE EN ARQUEO', usuario_nombre: 'ADMIN', id_ajuste_revertido: null, revertido_por: null,
        estado: 'VIGENTE', puede_revertir: true,
      }],
    },
  }));
  return calls;
}

async function openFlujo(page) {
  await page.goto(FLUJO_ROUTE);
  // Apuntar al título visible del módulo, no a la sección de la topbar de escritorio
  // (oculta a 390 px). Mantener validación real de carga y de filas.
  await expect(page.locator('.mov-page--flujoCaja .mov-card__title')).toBeVisible();
  await waitForBusyToFinish(page);
  await expect(page.locator('.fc-dayRow').first()).toBeVisible();
}

async function elegirTipoAjuste(dialog, nombre) {
  const tab = dialog.getByRole('tab', { name: nombre });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openAjusteModal(page) {
  await page.getByRole('button', { name: 'Ajustar saldo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajustar saldo' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#fc-aj-medio')).toBeEnabled();
  return dialog;
}

test.describe('@flujo @ajustes-saldo interfaz (mocks, sin escrituras)', () => {
  test('1-2 · botón en Flujo de Caja, modal con medios monetarios y saldo actual', async ({ page }) => {
    await mockAjustes(page);
    await openFlujo(page);

    await expect(page.getByRole('button', { name: 'Ajustar saldo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Historial de ajustes de saldo' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'AJUSTES' })).toBeVisible();

    const dialog = await openAjusteModal(page);
    const options = await dialog.locator('#fc-aj-medio option').allTextContents();
    expect(options).toEqual(['EFECTIVO', 'CAJA CHICA', 'BANCO', 'MERCADO PAGO']);
    expect(options.join(' ')).not.toMatch(/CHEQ/i);
    await expect(dialog.locator('#fc-aj-medio optgroup')).toHaveAttribute('label', 'EFECTIVO');
    await expect(dialog.getByText(/agrupa 2 medios/)).toBeVisible();
    await expect(dialog.locator('.fc-aj-current strong')).toHaveText(/\$\s?150\.000,00/);
    // El tipo de ajuste pasó a pestañas (role=tab); por defecto sigue siendo establecer el saldo real.
    await expect(dialog.getByRole('tab', { name: 'Establecer saldo' })).toHaveAttribute('aria-selected', 'true');
  });

  test('3-6 · vista previa inmediata de suma, resta y saldo real', async ({ page }) => {
    await mockAjustes(page);
    await openFlujo(page);
    const dialog = await openAjusteModal(page);
    const diferencia = dialog.getByTestId('fc-aj-diferencia');
    const nuevo = dialog.getByTestId('fc-aj-nuevo-saldo');

    await dialog.locator('#fc-aj-importe').fill('145.000');
    expect(nbsp(await diferencia.textContent())).toBe('− $ 5.000,00');
    expect(nbsp(await nuevo.textContent())).toBe('$ 145.000,00');

    await elegirTipoAjuste(dialog, 'Sumar importe');
    await dialog.locator('#fc-aj-importe').fill('20.000,50');
    expect(nbsp(await diferencia.textContent())).toBe('+ $ 20.000,50');
    expect(nbsp(await nuevo.textContent())).toBe('$ 170.000,50');

    await elegirTipoAjuste(dialog, 'Restar importe');
    expect(nbsp(await diferencia.textContent())).toBe('− $ 20.000,50');
    expect(nbsp(await nuevo.textContent())).toBe('$ 129.999,50');

    await dialog.locator('#fc-aj-medio').selectOption({ label: 'BANCO' });
    expect(nbsp(await nuevo.textContent())).toBe('$ 179.999,50');
  });

  test('7-8 · motivo obligatorio, OTRO exige explicación e importes inválidos', async ({ page }) => {
    const calls = await mockAjustes(page);
    await openFlujo(page);
    const dialog = await openAjusteModal(page);
    const confirmar = dialog.getByRole('button', { name: 'Confirmar ajuste' });

    await confirmar.click();
    await expect(dialog.getByText('Ingresá un importe válido (hasta 2 decimales).')).toBeVisible();
    await expect(dialog.getByText('Seleccioná el motivo del ajuste.')).toBeVisible();

    for (const invalid of ['1.2.3', '12,345', '1,2,3']) {
      await dialog.locator('#fc-aj-importe').fill(invalid);
      await confirmar.click();
      await expect(dialog.getByText('Ingresá un importe válido (hasta 2 decimales).')).toBeVisible();
    }
    await dialog.locator('#fc-aj-importe').fill('abc');
    await expect(dialog.locator('#fc-aj-importe')).toHaveValue('');

    await dialog.locator('#fc-aj-importe').fill('150.000');
    await dialog.locator('#fc-aj-motivo').selectOption('DIFERENCIA_DE_ARQUEO');
    await confirmar.click();
    await expect(dialog.getByText(/no hay diferencia para registrar/)).toBeVisible();

    await elegirTipoAjuste(dialog, 'Sumar importe');
    await dialog.locator('#fc-aj-importe').fill('0');
    await confirmar.click();
    await expect(dialog.getByText('El importe debe ser mayor a cero.')).toBeVisible();

    await dialog.locator('#fc-aj-importe').fill('100');
    await dialog.locator('#fc-aj-motivo').selectOption('OTRO');
    await confirmar.click();
    await expect(dialog.getByText(/Explicá la diferencia/)).toBeVisible();
    expect(calls.previsualizar, 'Nada inválido llega al backend').toHaveLength(0);

    await dialog.locator('#fc-aj-observaciones').fill('sobrante de cambio');
    await expect(dialog.locator('#fc-aj-observaciones')).toHaveValue('SOBRANTE DE CAMBIO');
    await expect(dialog.getByText(/Explicá la diferencia/)).toHaveCount(0);
  });

  test('11 · confirmación clara y doble clic envía una sola solicitud con clave idempotente', async ({ page }) => {
    const calls = await mockAjustes(page);
    await openFlujo(page);
    const dialog = await openAjusteModal(page);

    await dialog.locator('#fc-aj-importe').fill('145.000');
    await dialog.locator('#fc-aj-motivo').selectOption('DIFERENCIA_DE_ARQUEO');
    await dialog.getByRole('button', { name: 'Confirmar ajuste' }).click();

    const confirm = page.getByRole('dialog', { name: 'Confirmar ajuste de saldo' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText('EFECTIVO', { exact: true })).toBeVisible();
    expect(nbsp(await confirm.getByTestId('fc-aj-confirm-diferencia').textContent())).toBe('− $ 5.000,00');
    expect(nbsp(await confirm.getByTestId('fc-aj-confirm-nuevo').textContent())).toBe('$ 145.000,00');

    const registrar = confirm.getByRole('button', { name: 'Registrar ajuste' });
    // Esperar la actualización del resumen posterior al alta antes de cerrar el
    // contexto del test. También comprueba que la UI realmente solicita refresco.
    const resumenRefrescado = page.waitForResponse((response) =>
      response.url().includes('action=flujo_caja_resumen') && response.request().method() === 'GET' && response.ok(),
    );
    await registrar.dblclick();
    await expect(confirm).toBeHidden();
    await expect(page.getByText('Ajuste de saldo registrado correctamente.')).toBeVisible();
    await resumenRefrescado;

    expect(calls.crear, 'Un doble clic no puede generar dos ajustes').toHaveLength(1);
    const body = calls.crear[0];
    expect(body).toMatchObject({ id_medio_pago: 1, tipo_ajuste: 'ESTABLECER', importe: '145000.00', motivo: 'DIFERENCIA_DE_ARQUEO', saldo_esperado: '150000.00' });
    expect(body.clave_solicitud).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(body, 'El navegador no decide la diferencia ni la fecha').not.toHaveProperty('diferencia');
    expect(body).not.toHaveProperty('fecha');
  });

  test('12 · historial muestra fecha, medio, importe, saldos, motivo y estado sin usuario', async ({ page }) => {
    await mockAjustes(page);
    await openFlujo(page);
    await page.getByRole('button', { name: 'Historial de ajustes de saldo' }).click();
    const hist = page.getByRole('dialog', { name: 'Historial de ajustes de saldo' });
    const row = hist.locator('[data-ajuste-id="1"]');
    await expect(row).toBeVisible();
    for (const text of ['EFECTIVO', 'ESTABLECER SALDO REAL', 'DIFERENCIA DE ARQUEO', 'FALTANTE EN ARQUEO', 'VIGENTE']) {
      await expect(row.getByText(text, { exact: true })).toBeVisible();
    }
    await expect(hist.getByRole('columnheader', { name: 'Usuario', exact: true })).toHaveCount(0);
    await expect(row.locator('[data-label="Usuario"]')).toHaveCount(0);
    await expect(row.locator('[data-label="Ajuste"]')).toHaveText(/−\s?\$\s?5\.000,00/);
    await expect(row.locator('[data-label="Saldo anterior"]')).toHaveText(/150\.000,00/);
    await expect(row.locator('[data-label="Saldo posterior"]')).toHaveText(/145\.000,00/);
    await expect(row.getByRole('button', { name: 'Revertir ajuste #1' })).toBeVisible();
  });

  test('19 · exportaciones CSV y TXT incluyen la columna de ajustes', async ({ page }) => {
    await mockAjustes(page, { todayAjuste: -5000 });
    await openFlujo(page);
    // La tabla se ordena descendente: la primera fila puede ser un día futuro.
    // El mock aplica el ajuste únicamente a la fecha actual del negocio.
    const fechaHoy = todayISO().split('-').reverse().join('/');
    const filaHoy = page.locator('.fc-dayRow').filter({
      has: page.locator('[data-label="FECHA"]', { hasText: fechaHoy }),
    });
    await expect(filaHoy, `Debe existir la fila de hoy (${fechaHoy})`).toHaveCount(1);
    await expect(filaHoy.locator('[data-label="AJUSTES"]')).toHaveText(/−\s?\$\s?5\.000,00/);

    const exportar = async (format) => {
      await page.locator('.mov-page--flujoCaja .boton-exportar-trigger').click();
      const modal = page.locator('.boton-exportar-modal');
      await modal.locator('.boton-exportar-choice--format', { hasText: format }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), modal.locator('.boton-exportar-modal__submit').click()]);
      return fs.readFileSync(await download.path(), 'utf8');
    };

    const csv = await exportar('CSV');
    const [header, ...csvRows] = csv.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
    const columnas = header.split(';');
    expect(columnas).toContain('AJUSTES_MANUALES');
    const idxFecha = columnas.indexOf('FECHA');
    const idxAjustes = columnas.indexOf('AJUSTES_MANUALES');
    // Igual que en pantalla, buscar la fecha del mock, no la primera fila del CSV.
    const filaCsvHoy = csvRows.map((line) => line.split(';'))
      .find((cells) => cells[idxFecha] === fechaHoy);
    expect(filaCsvHoy, `El CSV debe incluir la fecha ${fechaHoy}`).toBeDefined();
    expect(Number(filaCsvHoy[idxAjustes])).toBe(-5000);

    const txt = await exportar('TXT');
    expect(txt).toMatch(/AJUSTES MANUALES: -5000/);
    expect(txt).toMatch(/SALDO = saldo anterior \+ APERTURAS \+ INGRESOS - EGRESOS \+ DEPÓSITOS NETOS \+ AJUSTES MANUALES/);
  });

  test('20 · diseño en escritorio y móvil sin desbordes', async ({ page }) => {
    await mockAjustes(page);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await openFlujo(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `Sin scroll horizontal en ${viewport.width}px`).toBeLessThanOrEqual(1);

      const dialog = await openAjusteModal(page);
      const box = await dialog.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      await expect(dialog.getByRole('button', { name: 'Confirmar ajuste' })).toBeVisible();

      await dialog.getByRole('button', { name: 'Ver historial' }).click();
      const hist = page.getByRole('dialog', { name: 'Historial de ajustes de saldo' });
      await expect(hist.locator('[data-ajuste-id="1"]')).toBeVisible();
      const histBox = await hist.boundingBox();
      expect(histBox.x + histBox.width).toBeLessThanOrEqual(viewport.width + 1);
      // El historial tiene dos botones "Cerrar" (la X del encabezado y el del pie):
      // se usa el del pie y se confirma que el modal se cierra.
      await hist.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
      await expect(hist).toBeHidden();
    }
  });
});

/* =========================================================
   B) API de sólo lectura
========================================================= */

test.describe('@flujo @ajustes-saldo API sin escrituras', () => {
  test('1 · el backend habilita la gestión sólo a administradores', async ({ page }) => {
    await page.goto('/panel', { waitUntil: 'domcontentloaded' });
    const today = todayISO();
    const resumen = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_resumen', { query: { fecha_desde: today, fecha_hasta: today } }));
    expect(resumen.ajustes_saldo, 'El resumen informa el estado de Ajustes de saldo').toBeTruthy();
    expect(resumen.ajustes_saldo.puede_gestionar, 'La sesión de pruebas es administradora').toBe(true);
    for (const row of resumen.tiendas[0].rows) expect(typeof row.ajustes_manuales).toBe('number');
  });

  test('2 · medios ajustables: sólo cajas monetarias con su saldo actual', async ({ page }) => {
    await page.goto('/panel', { waitUntil: 'domcontentloaded' });
    const json = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_medios'));
    expect(json.fecha_negocio).toBe(todayISO());
    expect(json.medios.length).toBeGreaterThan(0);
    for (const m of json.medios) {
      expect(m.nombre).not.toMatch(/CHEQ/i);
      expect(Number(m.id_medio_pago)).toBeGreaterThan(0);
      expect(Number.isFinite(Number(m.saldo_actual))).toBe(true);
    }
    const af = expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', { query: { fecha_desde: todayISO(), fecha_hasta: todayISO() } }));
    for (const m of json.medios) {
      const afMedio = af.tesoreria.medios.find((x) => Number(x.id) === Number(m.id_medio_pago));
      close(m.saldo_actual, afMedio?.saldo_final, `El saldo de ${m.nombre} es el mismo que informa Análisis Financiero`);
    }
  });

  test('8-9 · previsualizar rechaza importes inválidos y fechas futuras o retroactivas', async ({ page }) => {
    await page.goto('/panel', { waitUntil: 'domcontentloaded' });
    const medios = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_medios')).medios;
    const medio = medios[0];
    const preview = (query) => authenticatedApi(page, 'flujo_caja_ajustes_previsualizar', { query: { id_medio_pago: medio.id_medio_pago, tipo_ajuste: 'SUMAR', ...query } });

    for (const importe of ['abc', '-5', '1.234', '1e5', '10000000000000']) {
      const res = await preview({ importe });
      expect(res.status, `Importe ${importe}`).toBe(400);
      expect(res.body.exito).toBe(false);
    }
    for (const fecha of [addDaysISO(todayISO(), 1), addDaysISO(todayISO(), -1), '2026-02-30']) {
      const res = await preview({ importe: '10', fecha });
      expect(res.status, `Fecha ${fecha}`).toBe(400);
      expect(['FECHA_NO_PERMITIDA', 'FECHA_INVALIDA']).toContain(res.body.codigo);
    }
    const ok = expectApiSuccess(await preview({ importe: '10.50', fecha: todayISO() }));
    close(ok.preview.diferencia, 10.5, 'SUMAR 10,50');
    close(ok.preview.saldo_nuevo, amount(medio.saldo_actual) + 10.5, 'Nuevo saldo calculado por el backend');

    const cheque = await authenticatedApi(page, 'flujo_caja_ajustes_previsualizar', { query: { id_medio_pago: 999999, tipo_ajuste: 'SUMAR', importe: '1' } });
    expect(cheque.status).toBe(400);
  });

  test('crear y revertir exigen POST', async ({ page }) => {
    await page.goto('/panel', { waitUntil: 'domcontentloaded' });
    for (const action of ['flujo_caja_ajustes_crear', 'flujo_caja_ajustes_revertir']) {
      const res = await authenticatedApi(page, action, { method: 'GET' });
      expect(res.status, action).toBe(405);
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
  const rows = fc.tiendas[0].rows;
  return {
    fc, af, afMes,
    hoy: rows.find((r) => r.fecha === today),
    ayer: rows.find((r) => r.fecha === yesterday),
    medios: expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_medios', { query: { _: Date.now() } })).medios,
  };
}

async function currentAccounts(page) {
  const strip = (body) => { const { request_id: _r, ...rest } = body || {}; return rest; };
  return {
    clientes: strip(expectApiSuccess(await authenticatedApi(page, 'cc_saldos_clientes', { query: { _: 1 } }))),
    proveedores: strip(expectApiSuccess(await authenticatedApi(page, 'cc_saldos_proveedores', { query: { _: 1 } }))),
  };
}

test.describe('@flujo @ajustes-saldo @mutations ajustes reales y conciliación', () => {
  test.describe.configure({ mode: 'serial' });

  let medio = null;
  let antes = null;
  let ccAntes = null;
  let ajuste = null;
  const importe = 1234.56;
  const obs = `${RUN_PREFIX} AJUSTE E2E DE PRUEBA`;

  test.beforeEach(async ({ page }) => {
    await requireMutations(test, page);
    await page.goto('/panel', { waitUntil: 'domcontentloaded' });
    const res = await authenticatedApi(page, 'flujo_caja_resumen', { query: { fecha_desde: todayISO(), fecha_hasta: todayISO() } });
    test.skip(!res.body?.ajustes_saldo?.habilitado, 'La migración tesoreria_ajustes_saldo no está aplicada en este tenant.');
  });

  test('9 · crear rechaza fechas no actuales y saldos desactualizados sin escribir', async ({ page }) => {
    const { medios } = await snapshot(page);
    medio = medios.find((m) => /EFECTIVO/i.test(m.nombre)) || medios[0];
    const base = { id_medio_pago: medio.id_medio_pago, tipo_ajuste: 'SUMAR', importe: '1.00', motivo: 'OTRO', observaciones: obs, saldo_esperado: medio.saldo_actual.toFixed(2) };

    for (const fecha of [addDaysISO(todayISO(), 1), addDaysISO(todayISO(), -1)]) {
      const res = await authenticatedApi(page, 'flujo_caja_ajustes_crear', { method: 'POST', body: { ...base, fecha, clave_solicitud: clave('fecha') } });
      expect(res.status).toBe(400);
      expect(res.body.codigo).toBe('FECHA_NO_PERMITIDA');
    }
    const stale = await authenticatedApi(page, 'flujo_caja_ajustes_crear', { method: 'POST', body: { ...base, saldo_esperado: (medio.saldo_actual + 1).toFixed(2), clave_solicitud: clave('stale') } });
    expect(stale.status).toBe(409);
    expect(stale.body.codigo).toBe('SALDO_DESACTUALIZADO');
    close(stale.body.saldo_actual, medio.saldo_actual, 'Devuelve el saldo vigente para refrescar');

    const sinMotivo = await authenticatedApi(page, 'flujo_caja_ajustes_crear', { method: 'POST', body: { ...base, motivo: '', clave_solicitud: clave('motivo') } });
    expect(sinMotivo.status).toBe(400);

    const list = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_listar', { query: { id_medio_pago: medio.id_medio_pago, fecha_desde: todayISO(), fecha_hasta: todayISO() } }));
    expect(list.rows.filter((r) => String(r.observaciones || '').startsWith(RUN_PREFIX))).toHaveLength(0);
  });

  test('5-6, 11, 14-18 · ajuste real: saldo nuevo, idempotencia y conciliación', async ({ page }) => {
    antes = await snapshot(page);
    ccAntes = await currentAccounts(page);
    medio = antes.medios.find((m) => Number(m.id_medio_pago) === Number(medio?.id_medio_pago)) || antes.medios[0];
    const saldoReal = Math.round((amount(medio.saldo_actual) + importe) * 100) / 100;
    const body = {
      id_medio_pago: medio.id_medio_pago, tipo_ajuste: 'ESTABLECER', importe: saldoReal.toFixed(2),
      motivo: 'DIFERENCIA_DE_ARQUEO', observaciones: obs, saldo_esperado: amount(medio.saldo_actual).toFixed(2),
      clave_solicitud: clave('crear'),
    };

    const creado = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_crear', { method: 'POST', body }));
    ajuste = creado.ajuste;
    expect(creado.duplicado).toBe(false);
    close(ajuste.diferencia, importe, 'Establecer saldo real: el backend calcula la diferencia');
    close(ajuste.saldo_anterior, medio.saldo_actual, 'Saldo anterior');
    close(ajuste.saldo_posterior, saldoReal, 'Saldo posterior');
    expect(ajuste.fecha).toBe(todayISO());
    expect(ajuste.estado).toBe('VIGENTE');

    // 11 · reenvío idéntico (doble envío / reintento de red): mismo registro.
    const repetido = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_crear', { method: 'POST', body }));
    expect(repetido.duplicado).toBe(true);
    expect(repetido.ajuste.id_ajuste).toBe(ajuste.id_ajuste);

    const despues = await snapshot(page);
    // 14 · Flujo de Caja
    close(despues.fc.saldo_actual - antes.fc.saldo_actual, importe, 'El saldo actual cambia exactamente una vez');
    close(despues.hoy.ajustes_manuales - antes.hoy.ajustes_manuales, importe, 'Columna AJUSTES del día');
    close(despues.hoy.saldo - antes.hoy.saldo, importe, 'Saldo del día');
    const cards = (r) => r.medios_pago.reduce((s, c) => s + amount(c.saldo), 0);
    close(cards(despues.hoy), despues.hoy.saldo, 'Las tarjetas suman el total del día');
    // 16 · cierres históricos intactos
    close(despues.ayer.saldo, antes.ayer.saldo, 'El cierre de ayer no cambia');
    close(despues.ayer.ajustes_manuales, antes.ayer.ajustes_manuales, 'Ayer no recibe ajustes de hoy');
    // 17 · ingresos y egresos operativos intactos
    close(despues.hoy.ingresos, antes.hoy.ingresos, 'Ingresos sin cambios');
    close(despues.hoy.egresos, antes.hoy.egresos, 'Egresos sin cambios');
    close(despues.hoy.ajustes_internos, antes.hoy.ajustes_internos, 'ajustes_internos (cheques) no se reutiliza');
    // 15 · Análisis Financiero = Flujo de Caja
    close(despues.af.tesoreria.saldo_final, despues.hoy.saldo, 'Mismo saldo en ambos informes');
    close(despues.af.tesoreria.saldo_actual, despues.fc.saldo_actual, 'Mismo saldo actual');
    close(despues.af.tesoreria.ajustes_manuales - antes.af.tesoreria.ajustes_manuales, importe, 'Concepto independiente en tesorería');
    close(despues.af.tesoreria.ingresos, antes.af.tesoreria.ingresos, 'Cobros sin cambios');
    close(despues.af.tesoreria.egresos, antes.af.tesoreria.egresos, 'Pagos sin cambios');
    expect(despues.afMes.valores, 'Ventas, costos y resultado no cambian').toEqual(antes.afMes.valores);
    const afMedio = despues.af.tesoreria.medios.find((m) => Number(m.id) === Number(medio.id_medio_pago));
    close(afMedio.saldo_final, saldoReal, 'Saldo por medio en Análisis Financiero');
    // 18 · cuentas corrientes intactas
    expect(await currentAccounts(page), 'Saldos de clientes y proveedores intactos').toEqual(ccAntes);

    // 12 · historial
    const hist = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_listar', { query: { id_medio_pago: medio.id_medio_pago } }));
    const row = hist.rows.find((r) => r.id_ajuste === ajuste.id_ajuste);
    expect(row).toMatchObject({ estado: 'VIGENTE', motivo: 'DIFERENCIA_DE_ARQUEO', tipo: 'ESTABLECER', puede_revertir: true });
    expect(row.observaciones).toBe(obs);
    expect(row.usuario_nombre).toBeTruthy();
    expect(hist.rows.filter((r) => r.id_ajuste === ajuste.id_ajuste)).toHaveLength(1);
  });

  test('19 · la exportación real refleja el ajuste del día', async ({ page }) => {
    test.skip(!ajuste, 'Requiere el ajuste creado en el paso anterior.');
    const erroresBrowser = [];
    page.on('pageerror', (error) => erroresBrowser.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') erroresBrowser.push(msg.text());
    });

    await openFlujo(page);
    const botonExportar = page.locator('.mov-page--flujoCaja .boton-exportar-trigger');
    await expect(botonExportar, 'La exportación debe estar habilitada con filas cargadas').toBeEnabled();
    await botonExportar.click();
    const modal = page.locator('.boton-exportar-modal');
    await expect(modal).toBeVisible();
    const csv = modal.locator('.boton-exportar-choice--format', { hasText: 'CSV' });
    await csv.click();
    await expect(csv, 'CSV debe quedar seleccionado antes de confirmar').toHaveClass(/is-selected/);
    const confirmar = modal.locator('.boton-exportar-modal__submit');
    await expect(confirmar).toBeEnabled();

    // Capturar la descarga antes de confirmar. Si el navegador no la registra,
    // informar si el modal mostró un error o si hubo excepciones JavaScript.
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await confirmar.click();
    let download;
    try {
      download = await downloadPromise;
    } catch (error) {
      const alerta = await page.locator('[role="alert"]:visible').allTextContents().catch(() => []);
      const modalVisible = await modal.isVisible().catch(() => false);
      throw new Error(
        `No se inició la descarga CSV real. Modal abierto: ${modalVisible}. ` +
        `Alertas: ${JSON.stringify(alerta)}. ` +
        `Errores del navegador: ${JSON.stringify(erroresBrowser.slice(-5))}. ` +
        `Causa: ${error.message}`
      );
    }
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    const contenido = fs.readFileSync(await download.path(), 'utf8');
    const [header, ...lines] = contenido.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
    const cols = header.split(';');
    expect(cols).toContain('FECHA');
    expect(cols).toContain('AJUSTES_MANUALES');
    const today = todayISO().split('-').reverse().join('/');
    const row = lines.map((l) => l.split(';')).find((c) => c[cols.indexOf('FECHA')] === today);
    expect(row, 'El CSV incluye el día de hoy').toBeTruthy();
    const fc = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_resumen', { query: { fecha_desde: todayISO(), fecha_hasta: todayISO() } }));
    close(row[cols.indexOf('AJUSTES_MANUALES')], fc.tiendas[0].rows[0].ajustes_manuales, 'AJUSTES_MANUALES del CSV');
  });

  test('13 · la reversión compensa exactamente una vez y conserva ambos registros', async ({ page }) => {
    test.skip(!ajuste, 'Requiere el ajuste creado en el paso anterior.');
    const body = { id_ajuste: ajuste.id_ajuste, observaciones: `${RUN_PREFIX} REVERSION E2E`, clave_solicitud: clave('rev') };
    const rev = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_revertir', { method: 'POST', body }));
    close(rev.ajuste.diferencia, -importe, 'Asiento compensatorio');
    expect(rev.ajuste.tipo).toBe('REVERSION');
    expect(rev.ajuste.id_ajuste_revertido).toBe(ajuste.id_ajuste);
    expect(rev.original.estado).toBe('REVERTIDO');

    const repetida = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_revertir', { method: 'POST', body }));
    expect(repetida.duplicado).toBe(true);
    expect(repetida.ajuste.id_ajuste).toBe(rev.ajuste.id_ajuste);

    const otra = await authenticatedApi(page, 'flujo_caja_ajustes_revertir', { method: 'POST', body: { ...body, clave_solicitud: clave('rev2') } });
    expect(otra.status).toBe(409);
    expect(otra.body.codigo).toBe('AJUSTE_YA_REVERTIDO');
    const deReversion = await authenticatedApi(page, 'flujo_caja_ajustes_revertir', { method: 'POST', body: { ...body, id_ajuste: rev.ajuste.id_ajuste, clave_solicitud: clave('rev3') } });
    expect(deReversion.status).toBe(409);

    const despues = await snapshot(page);
    close(despues.fc.saldo_actual, antes.fc.saldo_actual, 'Efecto neto cero');
    close(despues.hoy.ajustes_manuales, antes.hoy.ajustes_manuales, 'Ajustes del día vuelven al valor previo');
    close(despues.af.tesoreria.saldo_final, despues.hoy.saldo, 'Conciliación tras la reversión');

    const hist = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_listar', { query: { id_medio_pago: medio.id_medio_pago } }));
    const original = hist.rows.find((r) => r.id_ajuste === ajuste.id_ajuste);
    const reversion = hist.rows.find((r) => r.id_ajuste === rev.ajuste.id_ajuste);
    expect(original).toMatchObject({ estado: 'REVERTIDO', revertido_por: rev.ajuste.id_ajuste, puede_revertir: false });
    expect(reversion).toMatchObject({ estado: 'REVERSION', id_ajuste_revertido: ajuste.id_ajuste, puede_revertir: false });
  });

  test('10 · el backend rechaza a un empleado básico aunque arme la solicitud', async ({ page, browser }) => {
    const username = `${RUN_PREFIX}-AJ-EMP`.slice(0, 36);
    const password = 'Pw!123456';
    let context = null;
    try {
      await createEmployeeTestUser(page, username, password);
      const employee = await loginTestUserInNewContext(browser, username, password);
      context = employee.context;
      const ep = employee.page;
      const create = await authenticatedApi(ep, 'flujo_caja_ajustes_crear', {
        method: 'POST',
        body: { id_medio_pago: medio?.id_medio_pago || 1, tipo_ajuste: 'SUMAR', importe: '1.00', motivo: 'OTRO', observaciones: obs, saldo_esperado: '0', clave_solicitud: clave('emp') },
      });
      expect(create.status).toBe(403);
      for (const action of ['flujo_caja_ajustes_medios', 'flujo_caja_ajustes_listar', 'flujo_caja_ajustes_previsualizar']) {
        expect((await authenticatedApi(ep, action)).status, action).toBe(403);
      }
      const revert = await authenticatedApi(ep, 'flujo_caja_ajustes_revertir', { method: 'POST', body: { id_ajuste: ajuste?.id_ajuste || 1, observaciones: obs, clave_solicitud: clave('emp2') } });
      expect(revert.status).toBe(403);

      const resumen = expectApiSuccess(await authenticatedApi(ep, 'flujo_caja_resumen', { query: { fecha_desde: todayISO(), fecha_hasta: todayISO() } }));
      expect(resumen.ajustes_saldo.puede_gestionar).toBe(false);
      await ep.goto(FLUJO_ROUTE);
      await expect(ep.locator('.fc-dayRow').first()).toBeVisible();
      await expect(ep.getByRole('button', { name: 'Ajustar saldo' })).toHaveCount(0);
    } finally {
      if (context) await context.close().catch(() => null);
      await cleanupTestUser(page, username);
    }
  });
});
