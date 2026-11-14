import { test, expect } from '../support/test.js';
import { getSessionPlan } from '../support/plan.js';

// Comprobación real del dashboard de BALTO Servicios.
//
// La tercera tarjeta depende del plan del tenant (Dashboard.jsx + backend
// dashboard_repo_fetch_kpis):
// - plan con `resources.stock`: "Stock valorizado" + "N artículos con stock";
// - resto de los planes: "Servicios activos" + "Servicios disponibles".
// El backend conserva `servicios_activos` en el contrato para todos los planes.
const formatNumber = (value) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
  .format(Math.round(Number(value || 0)));
const formatMoney = (value) => new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0));
// Intl puede separar "$" del importe con NBSP o espacio común según el runtime.
const moneyPattern = (value) => new RegExp(formatMoney(value).replace(/[\s ]+/g, '[\\s\\u00a0]*').replace(/\$/g, '\\$').replace(/\./g, '\\.'));

test('@smoke Balto abre el panel autenticado y muestra servicios activos', async ({ page }) => {
  const dashboardResponse = page.waitForResponse(
    (response) => response.url().includes('action=dashboard_resumen') && response.request().method() === 'GET'
  );

  await page.goto('/panel/dashboard');
  await expect(page).toHaveURL(/\/panel\/dashboard/);
  await expect(page.getByText('Panel Contable', { exact: false }).first()).toBeVisible();

  const response = await dashboardResponse;
  expect(response.ok(), 'dashboard_resumen debe responder correctamente').toBeTruthy();

  const json = await response.json();
  const kpis = json?.data?.kpis ?? json?.kpis ?? {};
  expect(kpis).toHaveProperty('servicios_activos');
  expect(Number(kpis.servicios_activos)).toBeGreaterThanOrEqual(0);

  const plan = await getSessionPlan(page);
  expect(plan.status, 'auth_session_check debe informar el plan del tenant').toBeLessThan(400);

  if (plan.can('resources.stock')) {
    expect(kpis).toHaveProperty('stock_valorizado');
    expect(kpis).toHaveProperty('productos_con_stock');

    const card = page.locator('.db-kpi').filter({ hasText: 'Stock valorizado' });
    await expect(card).toBeVisible();
    await expect(page.locator('.db-kpi').filter({ hasText: 'Servicios activos' })).toHaveCount(0);
    await expect(card.locator('.db-kpi__value')).toHaveText(moneyPattern(kpis.stock_valorizado));
    await expect(card.locator('.db-kpi__detail')).toHaveText(
      `${formatNumber(kpis.productos_con_stock)} artículos con stock`,
    );
  } else {
    const card = page.locator('.db-kpi').filter({ hasText: 'Servicios activos' });
    await expect(card).toBeVisible();
    await expect(page.locator('.db-kpi').filter({ hasText: 'Stock valorizado' })).toHaveCount(0);
    await expect(card.getByText('Servicios disponibles', { exact: true })).toBeVisible();
    await expect(card.locator('.db-kpi__value')).toHaveText(formatNumber(kpis.servicios_activos));
  }
});
