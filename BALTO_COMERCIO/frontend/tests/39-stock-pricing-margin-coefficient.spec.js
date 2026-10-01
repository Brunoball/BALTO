import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { waitDialog, waitForBusyToFinish } from './support/ui.js';

function numberFromInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const number = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

test('@stock @pricing @critical margen real y coeficiente ponderado usan la fórmula del contador', async ({ page }) => {
  const coefficientResult = await authenticatedApi(page, 'stock_coeficiente_ponderado', {
    query: { utilidad_pct: 10, _: Date.now() },
  });
  const coefficientBody = expectApiSuccess(
    coefficientResult,
    'No se pudo calcular el coeficiente ponderado de Stock',
  );
  const coefficient = coefficientBody?.data || coefficientBody || {};

  expect(coefficient.periodo).toMatch(/^\d{4}-\d{2}$/);
  expect(Number(coefficient.utilidad_deseada_pct)).toBeCloseTo(10, 4);
  expect(Number(coefficient.compras_mercaderia)).toBeGreaterThanOrEqual(0);
  expect(Number(coefficient.gastos_fijos)).toBeGreaterThanOrEqual(0);
  expect(Number(coefficient.gastos_variables)).toBeGreaterThanOrEqual(0);

  if (coefficient.disponible) {
    const compras = Number(coefficient.compras_mercaderia);
    const estructura = Number(coefficient.gastos_fijos) + Number(coefficient.gastos_variables);
    const esperado = 1 + estructura / compras + Number(coefficient.utilidad_deseada_pct) / 100;
    expect(Number(coefficient.coeficiente_ponderado)).toBeCloseTo(esperado, 5);
  } else {
    expect(coefficient.coeficiente_ponderado).toBeNull();
    expect(String(coefficient.advertencia || '')).toMatch(/compras/i);
  }

  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Agregar producto/i }).first().click();

  const dialog = await waitDialog(page, 'Productos');
  await expect(dialog.getByTestId('stock-coeficiente-ponderado')).toBeVisible();

  const cost = dialog.locator('input[name="precio_costo"]');
  const price = dialog.locator('input[name="precio"]');
  const marginPct = dialog.locator('input[name="margen_venta_porcentaje"]');
  const marginValue = dialog.locator('input[name="margen_venta_valor"]');

  await cost.fill('100');
  await cost.blur();
  await price.fill('200');
  await price.blur();

  expect(numberFromInput(await marginPct.inputValue())).toBeCloseTo(50, 2);
  expect(numberFromInput(await marginValue.inputValue())).toBeCloseTo(100, 2);

  // 20% de margen real sobre precio con costo 100 implica precio 125 y ganancia 25.
  await marginPct.fill('20');
  await marginPct.blur();

  expect(numberFromInput(await price.inputValue())).toBeCloseTo(125, 2);
  expect(numberFromInput(await marginValue.inputValue())).toBeCloseTo(25, 2);

  await dialog.getByRole('button', { name: /Cancelar/i }).last().click();
  await expect(dialog).toBeHidden();
});
