import { expect } from '@playwright/test';
import { authenticatedApi, expectApiSuccess } from './api.js';

export function decimal3(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1000) / 1000;
}

export async function listStockUnits(page, activo = 'todos') {
  const result = await authenticatedApi(page, 'stock_unidades_listar', {
    query: { activo, _: Date.now() },
  });
  expectApiSuccess(result, 'No se pudieron listar las unidades de stock');
  return Array.isArray(result.body?.unidades)
    ? result.body.unidades
    : Array.isArray(result.body?.data?.unidades)
      ? result.body.data.unidades
      : [];
}

export async function getDefaultStockUnit(page) {
  const units = await listStockUnits(page, 'todos');
  const unit = units.find((row) => Number(row?.es_default || 0) === 1)
    || units.find((row) => String(row?.nombre || '').toUpperCase() === 'UNIDAD');
  expect(unit, 'Debe existir la unidad predeterminada UNIDAD').toBeTruthy();
  expect(Number(unit.id_stock_unidad || 0)).toBeGreaterThan(0);
  return unit;
}

/** Fixture compatible con la política REAL del tenant.
 * requireMutations() debe ejecutarse ANTES: sólo modifica datos aislados E2E.
 * Nunca crea unidades ni intenta eludir el bloqueo de Tienda Nube.
 */
export async function getStockE2EFixtureUnit(page, { preferFractional = true } = {}) {
  const policyResult = await authenticatedApi(page, 'stock_unidades_politica');
  const policy = expectApiSuccess(policyResult, 'No se pudo consultar la política de unidades');
  const connected = Boolean(policy.tiendanube_conectada);
  const units = await listStockUnits(page, 'todos');
  const defaultUnit = units.find((unit) => Number(unit?.es_default || 0) === 1)
    || units.find((unit) => String(unit?.nombre || '').toUpperCase() === 'UNIDAD');
  expect(defaultUnit, 'Debe existir la unidad UNIDAD en el tenant E2E').toBeTruthy();
  const fractional = !connected && preferFractional
    ? units.find((unit) => Number(unit?.activo ?? 1) === 1 &&
      Number(unit?.permite_decimales || 0) === 1 &&
      Number(unit?.es_default || 0) !== 1)
    : null;
  const unit = fractional || defaultUnit;
  if (connected) {
    expect(Number(unit.id_stock_unidad)).toBe(Number(policy.id_stock_unidad_obligatoria));
  }
  return {
    ...unit,
    tnConnected: connected,
    fractional: Number(unit?.permite_decimales || 0) === 1,
  };
}

/** Evita pulsar Guardar mientras el editor todavía no leyó la política.
 * En esa ventana React muestra un toast y no envía el POST.
 */
export async function waitStockEditorUnitsReady(page, dialog, { variant = false } = {}) {
  const policy = expectApiSuccess(await authenticatedApi(page, 'stock_unidades_politica'),
    'No se pudo verificar la política de unidades del editor');
  // Filtrar por la etiqueta, no por el texto total de la caja:
  // dentro del select figura además la opción 'UNIDAD (u)'.
  const label = page.locator('.cmi-floatingLabel').filter({
    hasText: variant ? /^Unidad\s*\*$/i : /^Unidad de stock$/i,
  });
  const select = dialog.locator('.cmi-floatingField').filter({ has: label }).locator('select').first();
  await expect(select, 'El selector de unidades del editor debe estar montado').toBeVisible({ timeout: 30_000 });
  if (policy.tiendanube_conectada) {
    await expect(select).toHaveValue(String(policy.id_stock_unidad_obligatoria), { timeout: 30_000 });
    await expect(select.locator('option')).toHaveCount(1);
    await expect(select).toBeDisabled();
  } else {
    await expect(select).toBeEnabled({ timeout: 30_000 });
  }
  return policy;
}

export async function createStockUnit(page, { name, abbreviation, decimals = true }) {
  const result = await authenticatedApi(page, 'stock_unidad_crear', {
    method: 'POST',
    body: {
      nombre: name,
      abreviatura: abbreviation,
      permite_decimales: decimals ? 1 : 0,
    },
  });
  expectApiSuccess(result, `No se pudo crear la unidad ${name}`);
  const unit = result.body?.unidad || result.body?.data?.unidad;
  expect(unit, `El backend debe devolver la unidad ${name}`).toBeTruthy();
  return unit;
}

export async function updateStockUnit(page, id, data) {
  const result = await authenticatedApi(page, 'stock_unidad_actualizar', {
    method: 'POST',
    body: { id_stock_unidad: Number(id), ...data },
  });
  expectApiSuccess(result, `No se pudo actualizar la unidad #${id}`);
  return result.body?.unidad || result.body?.data?.unidad;
}

export async function setStockUnitActive(page, id, active) {
  const result = await authenticatedApi(
    page,
    active ? 'stock_unidad_reactivar' : 'stock_unidad_dar_baja',
    { method: 'POST', body: { id_stock_unidad: Number(id) } },
  );
  expectApiSuccess(result, `No se pudo ${active ? 'reactivar' : 'dar de baja'} la unidad #${id}`);
  return result.body?.unidad || result.body?.data?.unidad;
}

export async function deleteStockUnit(page, id, { expectFailure = false } = {}) {
  const result = await authenticatedApi(page, 'stock_unidad_eliminar', {
    method: 'POST',
    body: { id_stock_unidad: Number(id) },
  });
  if (expectFailure) {
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body?.exito === false || result.body?.success === false).toBeTruthy();
    return result;
  }
  expectApiSuccess(result, `No se pudo eliminar la unidad #${id}`);
  return result;
}

export async function getStockProductBySku(page, sku, { activo = 'todos' } = {}) {
  const result = await authenticatedApi(page, 'stock_productos_listar', {
    query: { buscar: sku, activo, limit: 50, _: Date.now() },
  });
  expectApiSuccess(result, `No se pudo consultar Stock para ${sku}`);
  const products = Array.isArray(result.body?.productos)
    ? result.body.productos
    : Array.isArray(result.body?.data?.productos)
      ? result.body.data.productos
      : [];
  const product = products.find((row) => String(row?.sku || '').trim().toUpperCase() === String(sku).trim().toUpperCase());
  expect(product, `Debe existir el producto SKU ${sku}`).toBeTruthy();
  return product;
}

export async function expectProductStock(page, sku, expected, precision = 3) {
  const product = await getStockProductBySku(page, sku);
  const actual = Number(product?.stock ?? product?.stock_actual ?? 0);
  expect(actual, `Stock persistido de ${sku}`).toBeCloseTo(Number(expected), precision);
  return product;
}

export async function expectFractionalRejected(result, unitAbbreviation = 'u') {
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(result.body?.exito === false || result.body?.success === false).toBeTruthy();
  expect(String(result.body?.mensaje || result.body?.message || '')).toMatch(
    new RegExp(`entero|decimal|${String(unitAbbreviation).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`, 'i'),
  );
}
