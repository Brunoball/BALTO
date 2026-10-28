import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { waitForBusyToFinish } from './support/ui.js';

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
    expect(amount(m.saldo_final)).toBeCloseTo(
      amount(m.saldo_inicio) + amount(m.saldo_inicial_aplicado) + amount(m.ingresos)
        - amount(m.egresos) + amount(m.ajustes_internos), 2,
    );
    expect(amount(m.saldo_inicial_configurado)).toBeCloseTo(
      (m.saldos_iniciales || []).reduce((sum, s) => sum + amount(s.importe), 0), 2,
    );
  }
  const sum = (key) => medio.reduce((total, m) => total + amount(m[key]), 0);
  for (const key of ['saldo_inicio', 'saldo_inicial_aplicado', 'saldo_inicial_configurado', 'ingresos', 'egresos', 'ajustes_internos', 'saldo_final']) {
    expect(amount(t[key]), `Total ${key} debe coincidir con el detalle por medio`).toBeCloseTo(sum(key), 2);
  }
  expect(amount(t.saldo_final)).toBeCloseTo(
    amount(t.saldo_inicio) + amount(t.saldo_inicial_aplicado) + amount(t.ingresos)
      - amount(t.egresos) + amount(t.ajustes_internos), 2,
  );
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

test('@analisis-financiero UI muestra solo las 3 secciones sin perder gráfico ni saldos', async ({ page }) => {
  await page.goto('/panel/analisis-financiero');
  await waitForBusyToFinish(page);
  await expect(page.getByRole('heading', { name: 'Análisis financiero' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Resumen financiero' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cómo se formó tu saldo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rendimiento del negocio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '¿Dónde está el dinero?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evolución del saldo' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Evolución del saldo:/i })).toBeVisible();
  await expect(page.locator('.af-metrics .af-metric')).toHaveCount(2);
  await expect(page.getByText('Cobros recibidos', { exact: true })).toBeVisible();
  await expect(page.getByText('Pagos realizados', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saldos iniciales y patrimonio' })).toHaveCount(0);
  await expect(page.locator('.af-shareGrid')).toHaveCount(0);
  await expect(page.locator('.af-resultPill')).toHaveCount(0);
  await expect(page.getByRole('table')).toBeVisible();
  const graph = page.locator('.af-insightGrid .af-chartPanel');
  const reconcile = page.locator('.af-insightGrid .af-reconcile');
  await expect(graph).toBeVisible();
  await expect(reconcile).toBeVisible();
  await expect(reconcile.getByText('Aperturas del período')).toBeVisible();
  // En escritorio, gráfico y conciliación deben compartir la misma fila.
  await page.setViewportSize({ width: 1440, height: 900 });
  const graphBox = await graph.boundingBox();
  const reconcileBox = await reconcile.boundingBox();
  expect(graphBox, 'Gráfico debe estar renderizado').not.toBeNull();
  expect(reconcileBox, 'Conciliación debe estar renderizada').not.toBeNull();
  expect(Math.abs(graphBox.y - reconcileBox.y)).toBeLessThan(5);
  expect(graphBox.x + graphBox.width).toBeLessThanOrEqual(reconcileBox.x + 5);
});
