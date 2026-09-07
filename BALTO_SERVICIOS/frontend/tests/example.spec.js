import { test, expect } from './support/test.js';

// Comprobación real del dashboard de BALTO Servicios.
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

  const card = page.locator('.db-kpi').filter({ hasText: 'Servicios activos' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Servicios disponibles', { exact: true })).toBeVisible();

  const expectedValue = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(
    Math.round(Number(kpis.servicios_activos || 0))
  );
  await expect(card.locator('.db-kpi__value')).toHaveText(expectedValue);
});
