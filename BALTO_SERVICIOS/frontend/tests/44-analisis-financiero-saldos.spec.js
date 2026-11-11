import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { waitForBusyToFinish } from './support/ui.js';
import { getSessionPlan } from './support/plan.js';

// Sólo lectura: apto tanto para local como para un smoke remoto, sin CRUD.
const range = { fecha_desde: '2026-10-01', fecha_hasta: '2026-10-28' };
const amount = (v) => Number(v || 0);

async function report(page) {
  await page.goto('/panel', { waitUntil: 'domcontentloaded' });
  const response = await authenticatedApi(page, 'analisis_financiero_resumen', { query: range });
  const json = expectApiSuccess(response, 'Análisis financiero debe responder correctamente');
  expect(json.rango).toEqual({ desde: range.fecha_desde, hasta: range.fecha_hasta });
  expect(json.tesoreria, 'Debe informar tesorería').toBeTruthy();
  return json;
}

test('@analisis-financiero @saldos API concilia saldo de inicio, apertura y movimientos', async ({ page }) => {
  const json = await report(page);
  const t = json.tesoreria;
  expect(t.fecha_corte).toBeTruthy();
  const medio = Array.isArray(t.medios) ? t.medios : [];
  expect(medio.length).toBeGreaterThan(0);
  for (const m of medio) {
    expect(m.nombre).not.toMatch(/cheq/i); // documentos separados del dinero líquido
    // Los ajustes manuales de saldo son un concepto propio: deben venir informados
    // siempre (aunque sea 0) y explicar la diferencia restante del cierre.
    expect(m, `${m.nombre} debe informar ajustes_manuales`).toHaveProperty('ajustes_manuales');
    // Las transferencias internas entre cajas también son un concepto propio
    // (neto firmado por medio); explican el resto de la variación del medio.
    expect(m, `${m.nombre} debe informar transferencias_internas`).toHaveProperty('transferencias_internas');
    expect(amount(m.saldo_final)).toBeCloseTo(
      amount(m.saldo_inicio) + amount(m.saldo_inicial_aplicado) + amount(m.ingresos)
        - amount(m.egresos) + amount(m.ajustes_internos) + amount(m.ajustes_manuales)
        + amount(m.transferencias_internas), 2,
    );
    expect(amount(m.saldo_inicial_configurado)).toBeCloseTo(
      (m.saldos_iniciales || []).reduce((sum, s) => sum + amount(s.importe), 0), 2,
    );
  }
  const sum = (key) => medio.reduce((total, m) => total + amount(m[key]), 0);
  for (const key of ['saldo_inicio', 'saldo_inicial_aplicado', 'saldo_inicial_configurado', 'ingresos', 'egresos', 'ajustes_internos', 'ajustes_manuales', 'transferencias_internas', 'saldo_final']) {
    expect(amount(t[key]), `Total ${key} debe coincidir con el detalle por medio`).toBeCloseTo(sum(key), 2);
  }
  expect(amount(t.saldo_final)).toBeCloseTo(
    amount(t.saldo_inicio) + amount(t.saldo_inicial_aplicado) + amount(t.ingresos)
      - amount(t.egresos) + amount(t.ajustes_internos) + amount(t.ajustes_manuales)
      + amount(t.transferencias_internas), 2,
  );
  // Las transferencias entre cajas nunca cambian el total del negocio.
  expect(amount(t.transferencias_internas), 'Transferencias internas: neto total 0').toBeCloseTo(0, 2);
  expect(amount(json.valores.resultado_neto)).toBeCloseTo(
    amount(json.valores.ventas) + amount(json.valores.otros_ingresos)
      - amount(json.valores.costo_variable) - amount(json.valores.costo_fijo)
      - amount(json.valores.otros_egresos), 2,
  );
  expect(amount(json.valores.resultado_neto), 'La ganancia no debe incluir apertura de tesorería').not.toBeNaN();
  expect(t.patrimonio_inicial).toBeTruthy();
});

test('@analisis-financiero @saldos cambian las aperturas al cambiar el rango, no se duplican', async ({ page }) => {
  await page.goto('/panel', { waitUntil: 'domcontentloaded' });
  const before = expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', {
    query: { fecha_desde: '2026-08-18', fecha_hasta: '2026-08-18' },
  }));
  const after = expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', {
    query: { fecha_desde: '2026-08-19', fecha_hasta: '2026-08-19' },
  }));
  const opening = amount(before.tesoreria.saldo_inicial_aplicado);
  const shifted = amount(after.tesoreria.saldo_inicio);
  const beforeEnd = amount(before.tesoreria.saldo_final);
  expect(after.tesoreria.saldo_inicial_aplicado).toBeDefined();
  // El arranque del día siguiente coincide con el cierre del día anterior.
  expect(shifted).toBeCloseTo(beforeEnd, 2);
  expect(opening).toBeCloseTo((before.tesoreria.medios || []).reduce((total, m) => total + amount(m.saldo_inicial_aplicado), 0), 2);
});

test('@analisis-financiero UI muestra las pestañas según plan sin perder gráfico ni saldos', async ({ page }) => {
  await page.goto('/panel/analisis-financiero');
  await waitForBusyToFinish(page);

  // La cuarta pestaña se habilita por la capacidad del plan, no por un
  // número fijo de pestañas: Básico = 3; Intermedio/Full con costeo = 4.
  const { can } = await getSessionPlan(page);
  const conCosteo = can('services.costing');
  const tabs = page.getByRole('tablist', { name: 'Secciones del análisis financiero' });
  await expect(tabs).toBeVisible();
  const disponibilidad = tabs.getByRole('tab', { name: 'Disponibilidad' });
  const resultados = tabs.getByRole('tab', { name: 'Resultados' });
  const medios = tabs.getByRole('tab', { name: 'Medios de pago' });
  const rentabilidad = tabs.getByRole('tab', { name: 'Rentabilidad' });
  const rentabilidadPanel = page.locator('#af-panel-rentabilidad');
  await expect(tabs.getByRole('tab')).toHaveCount(conCosteo ? 4 : 3);
  if (conCosteo) {
    await expect(rentabilidad).toBeVisible();
    await expect(rentabilidadPanel).toBeHidden();
  } else {
    await expect(rentabilidad).toHaveCount(0);
    await expect(rentabilidadPanel).toHaveCount(0);
  }
  await expect(disponibilidad).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Movimientos de dinero' })).toBeVisible();

  const disponibilidadPanel = page.locator('#af-panel-disponibilidad');
  const resultadosPanel = page.locator('#af-panel-resultados');
  const mediosPanel = page.locator('#af-panel-medios');
  await expect(disponibilidadPanel).toBeVisible();
  await expect(resultadosPanel).toBeHidden();
  await expect(mediosPanel).toBeHidden();

  await expect(disponibilidadPanel.getByRole('region', { name: 'Resumen de tesorería' })).toBeVisible();
  await expect(disponibilidadPanel.locator('.af-metrics .af-metric')).toHaveCount(2);
  await expect(disponibilidadPanel.getByText('Cobros recibidos', { exact: true })).toBeVisible();
  await expect(disponibilidadPanel.getByText('Pagos realizados', { exact: true })).toBeVisible();
  await expect(disponibilidadPanel.getByRole('heading', { name: 'Evolución del saldo' })).toBeVisible();
  await expect(disponibilidadPanel.getByRole('heading', { name: 'Conciliación' })).toBeVisible();
  await expect(disponibilidadPanel.getByRole('img', { name: /Evolución del saldo:/i })).toBeVisible();
  const graph = disponibilidadPanel.locator('.af-insightGrid .af-chartPanel');
  const reconcile = disponibilidadPanel.locator('.af-insightGrid .af-reconcile');
  await expect(graph).toBeVisible();
  await expect(reconcile).toBeVisible();
  await expect(reconcile.getByText('Aperturas del período')).toBeVisible();
  await expect(reconcile.getByText('Saldo al cierre')).toBeVisible();

  // En escritorio gráfico y conciliación deben compartir la misma fila.
  await page.setViewportSize({ width: 1440, height: 900 });
  const graphBox = await graph.boundingBox();
  const reconcileBox = await reconcile.boundingBox();
  expect(graphBox, 'Gráfico debe estar renderizado').not.toBeNull();
  expect(reconcileBox, 'Conciliación debe estar renderizada').not.toBeNull();
  expect(Math.abs(graphBox.y - reconcileBox.y)).toBeLessThan(5);
  expect(graphBox.x + graphBox.width).toBeLessThanOrEqual(reconcileBox.x + 5);

  await resultados.click();
  await expect(resultados).toHaveAttribute('aria-selected', 'true');
  await expect(disponibilidad).toHaveAttribute('aria-selected', 'false');
  await expect(resultadosPanel).toBeVisible();
  await expect(disponibilidadPanel).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Rendimiento del negocio' })).toBeVisible();
  await expect(resultadosPanel.getByRole('heading', { name: 'Ingresos y costos' })).toBeVisible();
  await expect(resultadosPanel.getByText('Resultado operativo')).toBeVisible();
  await expect(resultadosPanel.getByText('Pendiente de cobrar')).toBeVisible();
  await expect(resultadosPanel.getByText('Pendiente de pagar')).toBeVisible();

  await medios.click();
  await expect(medios).toHaveAttribute('aria-selected', 'true');
  await expect(resultadosPanel).toBeHidden();
  await expect(mediosPanel).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saldos por medio de pago' })).toBeVisible();
  const table = mediosPanel.getByRole('table', { name: 'Saldos por medio de pago' });
  await expect(table).toBeVisible();
  for (const header of ['Medio de pago', 'Arranque', 'Aperturas', 'Cobros', 'Pagos', 'Cierre']) {
    await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
  }
  await expect(table.locator('.af-mediumFoot')).toBeVisible();

  if (conCosteo) {
    // En planes con costeo, Rentabilidad debe poder abrirse sin superponer
    // las otras pestañas. El contenido se carga al entrar en ella.
    await rentabilidad.click();
    await expect(rentabilidad).toHaveAttribute('aria-selected', 'true');
    await expect(rentabilidadPanel).toBeVisible();
    await expect(disponibilidadPanel).toBeHidden();
    await expect(resultadosPanel).toBeHidden();
    await expect(mediosPanel).toBeHidden();
  }

  // Volver a Disponibilidad debe conservar gráficos y saldos, no recargar una
  // pantalla desactualizada ni dejar un panel superpuesto.
  await disponibilidad.click();
  await expect(disponibilidad).toHaveAttribute('aria-selected', 'true');
  await expect(disponibilidadPanel).toBeVisible();
  await expect(resultadosPanel).toBeHidden();
  await expect(mediosPanel).toBeHidden();
  await expect(graph).toBeVisible();
  await expect(reconcile).toBeVisible();
});
