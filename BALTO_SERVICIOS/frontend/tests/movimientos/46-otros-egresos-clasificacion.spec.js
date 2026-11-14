import fs from 'node:fs/promises';
import { test, expect } from '../support/test.js';
import { uniqueName, todayISO } from '../support/data.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { requireMutations, waitDialog, waitForBusyToFinish, searchRow, fillPayment, clickSaveAndWait } from '../support/ui.js';
import { addDaysISO, historicalOperationDays } from '../support/historical-dates.js';
import { createCatalogDescription } from '../support/flows.js';
import {
  cashFlowDay,
  deleteMovement,
  expectRejected,
  financialAnalysis,
  getLists,
  medioPago,
  movementId,
} from '../support/financial-api.js';
import { openExportDialog, downloadFromExportDialog } from '../support/export.js';

// ===== 46-otros-egresos-clasificacion.spec.js (BALTO Servicios) =====
//
// Clasificación OTROS EGRESOS de punta a punta: catálogo, alta, edición,
// persistencia, Análisis Financiero (una sola categoría), Disponibilidad,
// Flujo de Caja, UI escritorio/móvil y exportación.
// (BALTO Servicios no tiene módulo Stock: no aplica el coeficiente ponderado.)
//
// - Los IDs se leen SIEMPRE del catálogo (no se asume 1/2/3/4).
// - Las mutaciones usan requireMutations (tenant E2E, e2e_run=RUN_PREFIX) y se
//   limpian por ID exacto; los nombres llevan RUN_PREFIX para el limpiador E2E.
// - Ningún caso emite comprobantes fiscales (Otros egresos no factura).

const CLASES = ['COSTO FIJO', 'COSTO VARIABLE', 'OTROS EGRESOS'];

function norm(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** { 'COSTO FIJO': id, 'COSTO VARIABLE': id, 'OTROS EGRESOS': id } desde el catálogo real. */
async function catalogoClasificaciones(page) {
  const lists = await getLists(page, 'ventas');
  const rows = (Array.isArray(lists?.clasificaciones) ? lists.clasificaciones : [])
    .filter((r) => Number(r?.activo ?? 1) !== 0)
    .map((r) => ({ id: Number(r?.id ?? r?.id_clasificacion ?? 0), nombre: norm(r?.nombre) }))
    .filter((r) => r.id > 0);
  const ids = {};
  for (const nombre of CLASES) {
    const match = rows.filter((r) => r.nombre === nombre);
    expect(match, `El catálogo debe tener exactamente una clasificación activa "${nombre}" (¿se aplicó la migración?)`).toHaveLength(1);
    ids[nombre] = match[0].id;
  }
  expect(new Set(Object.values(ids)).size, 'Las tres clasificaciones deben tener IDs distintos').toBe(3);
  return { ids, lists };
}

function egresoBody({ fecha, nombre, total, idMedio, idClasificacion }) {
  return {
    fecha,
    ...(idClasificacion ? { id_clasificacion: idClasificacion } : {}),
    items: [{ detalle: nombre, cantidad: 1, precio: total, iva_pct: 0, subtotal: total, iva_monto: 0, total }],
    monto_total: total,
    medios_pago: [{ id_medio_pago: idMedio, monto: total }],
  };
}

async function crearEgreso(page, data) {
  const body = expectApiSuccess(await authenticatedApi(page, 'otros_egresos_crear', {
    method: 'POST', body: egresoBody(data),
  }), `No se pudo crear el egreso ${data.nombre}`);
  const id = movementId(body);
  expect(id, 'El alta debe devolver id_movimiento').toBeGreaterThan(0);
  return id;
}

async function editarEgreso(page, id, data) {
  return expectApiSuccess(await authenticatedApi(page, 'otros_egresos_actualizar', {
    method: 'POST', body: { id_movimiento: id, ...egresoBody(data) },
  }), `No se pudo editar el egreso #${id}`);
}

async function leerEgreso(page, id) {
  const body = expectApiSuccess(await authenticatedApi(page, 'otros_egresos_obtener', {
    query: { id_movimiento: id, _: Date.now() },
  }), `No se pudo leer el egreso #${id}`);
  const egreso = body?.egreso || body?.data?.egreso || {};
  const medios = Array.isArray(egreso?.medios_pago_detalle) ? egreso.medios_pago_detalle : [];
  return {
    egreso,
    idClasificacion: egreso?.id_clasificacion == null ? null : Number(egreso.id_clasificacion),
    clasificacionNombre: norm(egreso?.clasificacion_nombre),
    pagos: medios.length,
    pagado: medios.reduce((acc, m) => acc + Number(m?.monto || 0), 0),
  };
}

async function af(page, desde, hasta) {
  const body = await financialAnalysis(page, desde, hasta);
  const v = body?.valores || body?.data?.valores || {};
  const t = body?.tesoreria || body?.data?.tesoreria || {};
  const n = (x) => Number(x || 0);
  return {
    costo_fijo: n(v.costo_fijo), costo_variable: n(v.costo_variable), otros_egresos: n(v.otros_egresos),
    gastos_personales: n(v.gastos_personales), resultado_neto: n(v.resultado_neto),
    ventas: n(v.ventas), otros_ingresos: n(v.otros_ingresos),
    tesoreria_egresos: n(t.egresos), tesoreria_saldo_final: n(t.saldo_final),
    medios: Array.isArray(t.medios) ? t.medios : [],
  };
}

function medioEgresos(snapshot, idMedio) {
  const m = snapshot.medios.find((x) => Number(x?.id ?? x?.id_medio_pago) === Number(idMedio));
  return Number(m?.egresos || 0);
}

function expectDeltaCategorias(antes, despues, esperado, mensaje) {
  for (const key of ['costo_fijo', 'costo_variable', 'otros_egresos', 'gastos_personales']) {
    expect(despues[key] - antes[key], `${mensaje}: delta de ${key}`).toBeCloseTo(esperado[key] || 0, 2);
  }
}

const selectorClasificacion = (dialog) => dialog.getByTestId('oe-clasificacion-select');
const opcionesSelector = (select) => select.locator('option').evaluateAll(
  (os) => os.filter((o) => o.value !== '').map((o) => ({ id: Number(o.value), nombre: o.textContent.trim() })),
);
const textoSeleccionado = (select) => select.evaluate((s) => s.options[s.selectedIndex]?.textContent?.trim() || '');

test.describe('@otros-egresos @clasificacion @regression OTROS EGRESOS de punta a punta', () => {
  test.describe.configure({ mode: 'serial' });

  test('1 — el catálogo presenta COSTO FIJO, COSTO VARIABLE y OTROS EGRESOS activos', async ({ page }) => {
    const { ids } = await catalogoClasificaciones(page);
    for (const nombre of CLASES) expect(ids[nombre]).toBeGreaterThan(0);
  });

  test('2-5, 9 — alta de las tres clasificaciones: ID persistido exacto y reapertura', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);
    const { ids, lists } = await catalogoClasificaciones(page);
    const medio = medioPago(lists);
    const creados = [];
    try {
      for (const [nombre, total] of [['COSTO FIJO', 111], ['COSTO VARIABLE', 122], ['OTROS EGRESOS', 133]]) {
        const id = await crearEgreso(page, {
          fecha: todayISO(), nombre: uniqueName(`OE-ALTA-${nombre.replace(/\s/g, '-')}`), total, idMedio: medio.id, idClasificacion: ids[nombre],
        });
        creados.push(id);
        const leido = await leerEgreso(page, id);
        expect(leido.idClasificacion, `${nombre}: el ID persistido debe ser el elegido`).toBe(ids[nombre]);
        expect(leido.clasificacionNombre).toBe(nombre);
        expect(leido.pagos, `${nombre}: un único pago`).toBe(1);
        expect(leido.pagado).toBeCloseTo(total, 2);
      }
    } finally {
      for (const id of creados) await deleteMovement(page, 'otros_egresos_eliminar', id);
    }
  });

  test('validaciones — clasificación inexistente o inválida se rechaza y no crea movimientos', async ({ page }) => {
    await requireMutations(test, page);
    const { ids, lists } = await catalogoClasificaciones(page);
    const medio = medioPago(lists);
    const inexistente = Math.max(...Object.values(ids)) + 100_000;
    expectRejected(await authenticatedApi(page, 'otros_egresos_crear', {
      method: 'POST', body: egresoBody({ fecha: todayISO(), nombre: uniqueName('OE-CLASIF-INEXISTENTE'), total: 10, idMedio: medio.id, idClasificacion: inexistente }),
    }), /no existe/i);
    expectRejected(await authenticatedApi(page, 'otros_egresos_crear', {
      method: 'POST', body: { ...egresoBody({ fecha: todayISO(), nombre: uniqueName('OE-CLASIF-INVALIDA'), total: 10, idMedio: medio.id }), id_clasificacion: 'abc' },
    }), /no es válida/i);
  });

  test('6-14 — reclasificación, Análisis Financiero, Disponibilidad, Flujo de Caja y filtros históricos', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);
    const dias = await historicalOperationDays(page);
    test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
    const { ids, lists } = await catalogoClasificaciones(page);
    const medio = medioPago(lists);
    const dia = dias.operationDay;
    const total = 137;
    const nombre = uniqueName('OE-RECLASIF');

    const afAntes = await af(page, dia, dia);
    const afAntesPrevio = await af(page, addDaysISO(dia, -3), addDaysISO(dia, -1));
    const afAntesPosterior = await af(page, dias.paymentDay, dias.paymentDay);
    const flujoAntes = await cashFlowDay(page, dia);
    let id = 0;
    try {
      // Alta COSTO FIJO.
      id = await crearEgreso(page, { fecha: dia, nombre, total, idMedio: medio.id, idClasificacion: ids['COSTO FIJO'] });
      expectDeltaCategorias(afAntes, await af(page, dia, dia), { costo_fijo: total }, 'Alta COSTO FIJO');

      const pasos = [
        ['COSTO FIJO → OTROS EGRESOS', 'OTROS EGRESOS', { otros_egresos: total }],
        ['OTROS EGRESOS → COSTO VARIABLE', 'COSTO VARIABLE', { costo_variable: total }],
        ['COSTO VARIABLE → COSTO FIJO', 'COSTO FIJO', { costo_fijo: total }],
        ['COSTO FIJO → OTROS EGRESOS (final)', 'OTROS EGRESOS', { otros_egresos: total }],
      ];
      for (const [titulo, destino, delta] of pasos) {
        await editarEgreso(page, id, { fecha: dia, nombre, total, idMedio: medio.id, idClasificacion: ids[destino] });
        const leido = await leerEgreso(page, id);
        expect(leido.idClasificacion, `${titulo}: la clasificación debe guardarse realmente`).toBe(ids[destino]);
        expect(leido.clasificacionNombre, `${titulo}: al reabrir aparece la clasificación guardada`).toBe(destino);
        expect(leido.pagos, `${titulo}: la edición no duplica pagos`).toBe(1);
        expect(leido.pagado, `${titulo}: el pago conserva el importe`).toBeCloseTo(total, 2);

        const despues = await af(page, dia, dia);
        expectDeltaCategorias(afAntes, despues, delta, titulo);
        const suma = (s) => s.costo_fijo + s.costo_variable + s.otros_egresos + s.gastos_personales;
        expect(suma(despues) - suma(afAntes), `${titulo}: el egreso se cuenta una sola vez`).toBeCloseTo(total, 2);
        expect(despues.resultado_neto - afAntes.resultado_neto, `${titulo}: el resultado baja exactamente el importe`).toBeCloseTo(-total, 2);
        // Fórmula vigente sin cambios.
        expect(despues.resultado_neto).toBeCloseTo(
          despues.ventas + despues.otros_ingresos - despues.costo_variable - despues.costo_fijo - despues.otros_egresos, 2,
        );
        // Tesorería: una sola salida, sin importar la clasificación.
        expect(despues.tesoreria_egresos - afAntes.tesoreria_egresos, `${titulo}: Disponibilidad descuenta una sola vez`).toBeCloseTo(total, 2);
        expect(despues.tesoreria_saldo_final - afAntes.tesoreria_saldo_final, `${titulo}: saldo de cierre`).toBeCloseTo(-total, 2);
        expect(medioEgresos(despues, medio.id) - medioEgresos(afAntes, medio.id), `${titulo}: medio ${medio.nombre}`).toBeCloseTo(total, 2);
        expect((await cashFlowDay(page, dia)).egresos - flujoAntes.egresos, `${titulo}: Flujo de Caja una sola salida`).toBeCloseTo(total, 2);
      }

      // Editar sólo el importe (sin enviar clasificación) no la modifica.
      await editarEgreso(page, id, { fecha: dia, nombre, total: total + 3, idMedio: medio.id });
      let leido = await leerEgreso(page, id);
      expect(leido.idClasificacion, 'Editar el importe sin clasificación conserva OTROS EGRESOS').toBe(ids['OTROS EGRESOS']);
      expect(leido.pagos).toBe(1);
      await editarEgreso(page, id, { fecha: dia, nombre, total, idMedio: medio.id, idClasificacion: ids['OTROS EGRESOS'] });

      // Una clasificación inválida en la edición se rechaza y no borra la actual.
      expectRejected(await authenticatedApi(page, 'otros_egresos_actualizar', {
        method: 'POST', body: { id_movimiento: id, ...egresoBody({ fecha: dia, nombre, total, idMedio: medio.id }), id_clasificacion: 'x' },
      }), /no es válida/i);
      leido = await leerEgreso(page, id);
      expect(leido.idClasificacion).toBe(ids['OTROS EGRESOS']);

      // 13 — filtros históricos: sólo impacta en el rango que contiene la fecha.
      expectDeltaCategorias(afAntesPrevio, await af(page, addDaysISO(dia, -3), addDaysISO(dia, -1)), {}, 'Rango anterior');
      expectDeltaCategorias(afAntesPosterior, await af(page, dias.paymentDay, dias.paymentDay), {}, 'Rango posterior');
    } finally {
      await deleteMovement(page, 'otros_egresos_eliminar', id);
    }
    // Tras eliminar, todo vuelve al estado previo (sin restos ni pagos huérfanos).
    expectDeltaCategorias(afAntes, await af(page, dia, dia), {}, 'Después de eliminar');
    expect((await cashFlowDay(page, dia)).egresos - flujoAntes.egresos).toBeCloseTo(0, 2);
  });

  for (const [dispositivo, viewport] of [['escritorio', { width: 1440, height: 900 }], ['móvil', { width: 390, height: 844 }]]) {
    test(`16 — UI ${dispositivo}: tres opciones con IDs reales, alta y edición conservan la selección`, async ({ page }) => {
      test.setTimeout(4 * 60_000);
      await requireMutations(test, page);
      await page.setViewportSize(viewport);
      const { ids } = await catalogoClasificaciones(page);
      const description = uniqueName(`OE-UI-${dispositivo === 'móvil' ? 'MOV' : 'DESK'}`);
      let id = 0;
      try {
        await page.goto('/panel/Otrosegresos');
        await waitForBusyToFinish(page);
        await page.getByTitle('Crear nuevo egreso').click();
        let dialog = await waitDialog(page, 'Nuevo Egreso');
        const select = selectorClasificacion(dialog);
        await expect(select).toBeVisible();
        // El catálogo de clasificaciones llega por la carga global de listas: puede
        // tardar un instante después de abrir el modal. Se espera a que aparezcan.
        await expect.poll(() => opcionesSelector(select), { timeout: 20_000 })
          .toEqual(CLASES.map((nombre) => ({ id: ids[nombre], nombre })));
        await expect(dialog.getByTestId('oe-clasificacion-error')).toHaveCount(0);
        if (dispositivo === 'móvil') {
          const box = await select.boundingBox();
          expect(box, 'El selector debe renderizarse en móvil').not.toBeNull();
          expect(box.x + box.width, 'El selector no debe desbordar el ancho del móvil').toBeLessThanOrEqual(viewport.width + 1);
        }

        const row = await createCatalogDescription(dialog, description);
        await row.locator('input[type="number"]').first().fill('1');
        const price = row.locator('input[inputmode="decimal"]').first();
        await price.fill('161');
        await price.blur();
        await select.selectOption(String(ids['OTROS EGRESOS']));
        await fillPayment(dialog);
        await expect(select, 'La selección se mantiene al completar el formulario').toHaveValue(String(ids['OTROS EGRESOS']));
        const created = page.waitForResponse((r) => /action=otros_egresos_crear/.test(r.url()) && r.request().method() === 'POST');
        await clickSaveAndWait(dialog, /Guardar egreso/i, { timeout: 60_000 });
        id = movementId(await (await created).json());
        expect(id).toBeGreaterThan(0);
        expect((await leerEgreso(page, id)).idClasificacion, 'El payload de la UI lleva el ID elegido').toBe(ids['OTROS EGRESOS']);

        // Editar: abre con OTROS EGRESOS, cambia a COSTO VARIABLE, reabre y lo muestra.
        let fila = await searchRow(page, description, /Buscar por descripción/i);
        await fila.locator('button[title="Editar"]').click();
        dialog = await waitDialog(page, 'Editar egreso');
        await expect.poll(() => textoSeleccionado(selectorClasificacion(dialog)), { timeout: 20_000 }).toBe('OTROS EGRESOS');
        await selectorClasificacion(dialog).selectOption(String(ids['COSTO VARIABLE']));
        await clickSaveAndWait(dialog, /Guardar cambios/i, { timeout: 60_000 });
        expect((await leerEgreso(page, id)).idClasificacion).toBe(ids['COSTO VARIABLE']);

        fila = await searchRow(page, description, /Buscar por descripción/i);
        await fila.locator('button[title="Editar"]').click();
        dialog = await waitDialog(page, 'Editar egreso');
        await expect.poll(() => textoSeleccionado(selectorClasificacion(dialog)), {
          message: 'Al reabrir aparece la clasificación guardada', timeout: 20_000,
        }).toBe('COSTO VARIABLE');
        await dialog.getByRole('button', { name: /cancelar/i }).last().click();
        await expect(dialog).toBeHidden();
      } finally {
        await deleteMovement(page, 'otros_egresos_eliminar', id);
      }
    });
  }

  test('17 — la exportación de Análisis Financiero informa los mismos importes por categoría', async ({ page }, testInfo) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);
    const { ids, lists } = await catalogoClasificaciones(page);
    const medio = medioPago(lists);
    const total = 173;
    let id = 0;
    try {
      id = await crearEgreso(page, { fecha: todayISO(), nombre: uniqueName('OE-EXPORT'), total, idMedio: medio.id, idClasificacion: ids['OTROS EGRESOS'] });
      const resumen = page.waitForResponse((r) => /action=analisis_financiero_resumen/.test(r.url()) && r.ok());
      await page.goto('/panel/analisis-financiero');
      const body = await (await resumen).json();
      await waitForBusyToFinish(page);
      const valores = body?.valores || body?.data?.valores || {};
      const rango = body?.rango || body?.data?.rango || {};
      if (rango.desde <= todayISO() && todayISO() <= rango.hasta) {
        expect(Number(valores.otros_egresos), 'El egreso de hoy integra Otros egresos del rango visible').toBeGreaterThanOrEqual(total - 0.01);
      }

      const dialog = await openExportDialog(page, /Exportar/i);
      const csv = dialog.locator('.boton-exportar-choice--format').filter({ hasText: /CSV/i }).first();
      await csv.click();
      const { path } = await downloadFromExportDialog(page, dialog, testInfo, 'af-otros-egresos');
      const text = (await fs.readFile(path, 'utf8')).replace(/^﻿/, '');
      const valor = (concepto) => {
        const line = text.split(/\r?\n/).find((l) => l.split(';')[0].replace(/"/g, '').trim() === concepto);
        expect(line, `La exportación debe incluir "${concepto}"`).toBeTruthy();
        return Number(String(line.split(';')[1]).replace(/"/g, ''));
      };
      expect(valor('Costo fijo')).toBeCloseTo(Number(valores.costo_fijo || 0), 2);
      expect(valor('Costo variable')).toBeCloseTo(Number(valores.costo_variable || 0), 2);
      expect(valor('Otros egresos')).toBeCloseTo(Number(valores.otros_egresos || 0), 2);
      expect(valor('Resultado operativo')).toBeCloseTo(Number(valores.resultado_neto || 0), 2);
    } finally {
      await deleteMovement(page, 'otros_egresos_eliminar', id);
    }
  });
});
