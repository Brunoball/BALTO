import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku, todayISO } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import {
  clickSaveAndWait,
  fillMovementRow,
  fillPayment,
  requireMutations,
  searchRow,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  waitDialog,
  waitForBusyToFinish,
} from './support/ui.js';
import {
  applySaleCreditNoteAndCapture,
  convertBudgetToSale,
  createStockProduct,
  deleteBudget,
  deleteSale,
  deleteUnusedStockProduct,
  openMovementDetail,
  prepareBudget,
} from './support/flows.js';
import {
  createParty,
  deleteMovement,
  getLists,
  medioPago,
  movementId,
  tipoVentaId,
} from './support/financial-api.js';
import {
  createServiceArticleFixture,
  createServiceFixture,
  deleteServiceArticleFixture,
  deleteServiceFixture,
  ensureActiveServiceUnit,
  expectServiceStock,
} from './support/services.js';
import { getSessionPlan } from './support/plan.js';
import runCalculoRegression from './descuentos-calculo.regression.cjs';
import runPdfRegression from './descuentos-pdf.regression.cjs';

// BALTO Servicios · Descuento general de ventas y presupuestos.
// El descuento es un ajuste comercial sobre el total (no un renglón). El
// backend lo recalcula, lo prorratea entre los renglones y guarda los importes
// NETOS, de modo que pagos, cuenta corriente, ARCA, notas de crédito y PDFs
// usan siempre el total final. Ninguna prueba emite comprobantes ARCA reales.

const U = runCalculoRegression.loadUtil();

function parseArs(value) {
  const n = Number(String(value ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function esperado(rows, tipo, valor) {
  const base = U.calcularRenglonesBrutos(rows.map((r) => ({ cantidad: r.cantidad, precio: r.precio, ivaPct: r.iva_pct })));
  const d = U.calcularDescuentoGeneral(base, tipo, String(valor));
  return { d, lines: U.prorratearDescuentoGeneral(base, d) };
}

/**
 * Concepto que se vende en la prueba, adaptado al plan del tenant:
 * - con resources.sell (planes 2 y 3) un material del catálogo, con existencias
 *   sólo si el plan tiene control de stock (resources.stock, plan 3);
 * - sin resources.sell (plan 1) un detalle manual.
 * El descuento es idéntico en todos los casos.
 */
async function crearConcepto(page, label, { price, stock = 5, cost = 100 }) {
  const plan = await getSessionPlan(page);
  const name = uniqueName(label);
  if (plan.can('resources.sell')) {
    await createStockProduct(page, { name, sku: uniqueSku(label.replace(/[^A-Z]/gi, '').slice(0, 8)), stock, cost, price });
    return { name, row: { productName: name }, material: true, stock: plan.can('resources.stock') };
  }
  return { name, row: { description: name }, material: false, stock: false };
}

async function limpiarConcepto(page, c) {
  if (c?.material) await deleteUnusedStockProduct(page, c.name).catch(() => null);
}

async function aplicarDescuento(dialog, tipo, valor) {
  const box = dialog.getByTestId('descuento-general');
  await expect(box).toBeVisible();
  await box.getByLabel('Tipo de descuento').selectOption(tipo);
  await box.getByLabel('Valor del descuento').fill(String(valor));
  return box;
}

async function leerMovimiento(page, action, key, id) {
  const body = expectApiSuccess(
    await authenticatedApi(page, action, { query: { id_movimiento: id, _: Date.now() } }),
    `No se pudo leer ${action} #${id}`,
  );
  return body?.[key] || body?.data?.[key] || body?.movimiento || body;
}

function itemsDe(mov) {
  return (mov?.items_detalle || mov?.items || []).filter((it) => String(it?.tipo_item || '') !== 'CONSUMO_ARTICULO');
}

async function abrirNuevaVenta(page) {
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  return waitDialog(page, 'Nueva Venta');
}

async function formaDeVenta(dialog, pattern) {
  const typeField = dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first();
  return selectFirstNonEmpty(typeField.locator('select'), pattern);
}

function esperarPost(page, action) {
  return page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).searchParams.get('action') === action,
    { timeout: 90_000 },
  );
}

async function ventaApi(page, { lists, clientId, contado, items, descuento = {}, pago = null }) {
  const typeId = tipoVentaId(lists, contado ? 'CONTADO' : 'CUENTA CORRIENTE');
  const fecha = todayISO();
  const body = {
    fecha, id_tipo_venta: typeId, id_cliente: clientId,
    items: items.map((it) => ({ fecha, id_tipo_venta: typeId, id_cliente: clientId, ...it })),
    medios_pago: contado ? [{ id_medio_pago: medioPago(lists).id, monto: pago }] : [],
    ...descuento,
  };
  return authenticatedApi(page, 'ventas_crear_batch', { method: 'POST', body });
}

/* ============================ Pruebas puras ============================ */

test('@pdf @descuentos cálculo de descuento general: sin descuento, %, monto, IVA mixto, inválidos y estrés', async () => {
  await runCalculoRegression();
});

test('@pdf @descuentos PDFs de presupuesto, venta y factura muestran descuento sin restarlo dos veces', async () => {
  await runPdfRegression();
});

/* ============================== Ventas UI ============================== */

test('@crud @critical @descuentos venta sin descuento conserva el comportamiento actual', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-SIN', { stock: 5, cost: 500, price: 1000 });
  const productName = c.name;

  try {
    const dialog = await abrirNuevaVenta(page);
    await fillMovementRow(dialog, { ...c.row, quantity: 1, price: 1000 });
    await selectFirstAutocomplete(dialog, 'Cliente');
    await formaDeVenta(dialog, /CONTADO/i);
    const box = dialog.getByTestId('descuento-general');
    await expect(box).toContainText(/Sin descuento aplicado/i);
    await expect(dialog.getByTestId('nv-summary-total')).toContainText(/1\.000,00/);
    await expect(dialog.getByTestId('nv-summary-descuento')).toHaveCount(0);
    await fillPayment(dialog);

    const responsePromise = esperarPost(page, 'ventas_crear_batch');
    await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 90_000 });
    const response = await responsePromise;
    const payload = response.request().postDataJSON();
    const body = await response.json().catch(() => ({}));
    expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
    expect(payload.descuento_tipo ?? null).toBeNull();
    expect(Number(payload.descuento_monto || 0)).toBe(0);
    expect(Number(body?.monto_total ?? body?.data?.monto_total)).toBeCloseTo(1000, 2);

    const venta = await leerMovimiento(page, 'ventas_obtener', 'venta', movementId(body));
    expect(Number(venta.descuento_monto || 0)).toBe(0);
    expect(itemsDe(venta)[0]?.precio_lista ?? null).toBeNull();
  } finally {
    await deleteSale(page, productName).catch(() => null);
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical @descuentos venta contado con 10 %: total, pagos, DB, detalle y stock', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(5 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-PCT', { stock: 5, cost: 500, price: 1000 });
  const productName = c.name;

  try {
    const dialog = await abrirNuevaVenta(page);
    await fillMovementRow(dialog, { ...c.row, quantity: 1, price: 1000 });
    await selectFirstAutocomplete(dialog, 'Cliente');
    await formaDeVenta(dialog, /CONTADO/i);
    const box = await aplicarDescuento(dialog, 'PORCENTAJE', '10');
    await expect(box.getByTestId('dg-descuento-monto')).toContainText(/100,00/);
    // El total final se muestra en el resumen de la venta, no en el control.
    // El renglón conserva el precio y el total originales.
    await expect(dialog.getByTestId('nv-row-total').first()).toContainText(/1\.000,00/);
    await expect(dialog.getByTestId('nv-summary-descuento')).toContainText(/100,00/);
    await expect(dialog.getByTestId('nv-summary-total')).toContainText(/900,00/);

    await fillPayment(dialog);
    const amount = dialog.locator('.gm-payment-row--amount input').first();
    await expect.poll(async () => parseArs(await amount.inputValue())).toBeCloseTo(900, 2);

    const responsePromise = esperarPost(page, 'ventas_crear_batch');
    await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 90_000 });
    const response = await responsePromise;
    const payload = response.request().postDataJSON();
    const body = await response.json().catch(() => ({}));
    expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
    expect(payload).toMatchObject({ descuento_tipo: 'PORCENTAJE', descuento_valor: 10, descuento_monto: 100, total_bruto: 1000 });
    expect(Number(payload.items[0].precio)).toBeCloseTo(1000, 2);
    expect(Number(payload.items[0].total)).toBeCloseTo(900, 2);
    expect(Number(payload.medios_pago[0].monto)).toBeCloseTo(900, 2);
    expect(Number(body?.monto_total ?? body?.data?.monto_total)).toBeCloseTo(900, 2);
    expect(Number(body?.total_pagado ?? body?.data?.total_pagado)).toBeCloseTo(900, 2);

    // Persistencia y recuperación.
    const venta = await leerMovimiento(page, 'ventas_obtener', 'venta', movementId(body));
    expect(String(venta.descuento_tipo)).toBe('PORCENTAJE');
    expect(Number(venta.descuento_valor)).toBeCloseTo(10, 2);
    expect(Number(venta.descuento_monto)).toBeCloseTo(100, 2);
    expect(Number(venta.total_bruto)).toBeCloseTo(1000, 2);
    expect(Number(venta.monto_total ?? venta.total_movimiento)).toBeCloseTo(900, 2);
    const item = itemsDe(venta)[0];
    expect(Number(item.precio_lista)).toBeCloseTo(1000, 2);
    expect(Number(item.total)).toBeCloseTo(900, 2);

    const detail = await openMovementDetail(page, productName, 'sale');
    const discountNote = detail.getByLabel('Detalle del descuento comercial');
    await expect(discountNote).toBeVisible();
    await expect(discountNote).toContainText(/1\.000,00/);
    await expect(discountNote).toContainText(/900,00/);
    await detail.getByRole('button', { name: /Cerrar/i }).click();

    // Un descuento no reduce cantidades: el stock baja exactamente 1.
    if (c.stock) await expectServiceStock(page, productName, 4);
  } finally {
    await page.goto('/panel/ventas');
    await deleteSale(page, productName).catch(() => null);
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical @descuentos venta cuenta corriente con monto fijo: deuda = total final', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-MONTO', { stock: 5, cost: 500, price: 2780 });
  const productName = c.name;

  try {
    const dialog = await abrirNuevaVenta(page);
    await fillMovementRow(dialog, { ...c.row, quantity: 1, price: 2780 });
    await selectFirstAutocomplete(dialog, 'Cliente');
    await formaDeVenta(dialog, /CUENTA\s*CORRIENTE/i);
    const box = await aplicarDescuento(dialog, 'MONTO', '280');
    await expect(box.getByTestId('dg-total-original')).toContainText(/2\.780,00/);
    await expect(dialog.getByTestId('nv-summary-descuento')).toContainText(/≈\s*10,07\s*%/);
    await expect(dialog.getByTestId('nv-summary-total')).toContainText(/2\.500,00/);

    const responsePromise = esperarPost(page, 'ventas_crear_batch');
    await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 90_000 });
    const response = await responsePromise;
    const body = await response.json().catch(() => ({}));
    expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
    expect(Number(body?.monto_total ?? body?.data?.monto_total)).toBeCloseTo(2500, 2);

    const venta = await leerMovimiento(page, 'ventas_obtener', 'venta', movementId(body));
    expect(String(venta.descuento_tipo)).toBe('MONTO');
    expect(Number(venta.saldo)).toBeCloseTo(2500, 2);
    expect(Number(venta.total_pagado || 0)).toBeCloseTo(0, 2);
  } finally {
    await page.goto('/panel/ventas');
    await deleteSale(page, productName).catch(() => null);
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @descuentos descuentos inválidos se bloquean en pantalla y en el backend', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-INVALIDO', { stock: 5, cost: 500, price: 1000 });
  const productName = c.name;
  let posted = false;
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).searchParams.get('action') === 'ventas_crear_batch') posted = true;
  });

  try {
    const dialog = await abrirNuevaVenta(page);
    await fillMovementRow(dialog, { ...c.row, quantity: 1, price: 1000 });
    await selectFirstAutocomplete(dialog, 'Cliente');
    await formaDeVenta(dialog, /CUENTA\s*CORRIENTE/i);

    for (const [tipo, valor, mensaje] of [
      ['PORCENTAJE', '150', /menor al 100/i],
      ['PORCENTAJE', '100', /menor al 100/i],
      ['PORCENTAJE', '-5', /negativo/i],
      ['MONTO', '1000', /menor al total/i],
      ['MONTO', '5000', /menor al total/i],
      ['MONTO', 'abc', /número válido/i],
    ]) {
      const box = await aplicarDescuento(dialog, tipo, valor);
      await expect(box.getByTestId('dg-error')).toContainText(mensaje);
      await expect(dialog.getByTestId('nv-summary-total')).toContainText(/1\.000,00/);
    }
    await dialog.getByRole('button', { name: /Guardar venta/i }).click();
    await page.waitForTimeout(1_500);
    expect(posted, 'Con un descuento inválido no debe enviarse la venta').toBe(false);

    // Quitar el descuento vuelve al total original.
    await dialog.getByRole('button', { name: 'Quitar descuento' }).click();
    await expect(dialog.getByLabel('Valor del descuento')).toHaveValue('');
    await expect(dialog.getByTestId('dg-error')).toHaveCount(0);
    await dialog.getByRole('button', { name: /Cerrar|✕/i }).first().click().catch(() => null);

    // El backend rechaza aunque el navegador mande datos inválidos.
    const lists = await getLists(page, 'ventas');
    const client = await createParty(page, 'client', 'DESC-INV-CLI');
    const item = { tipo_item: 'MANUAL', descripcion: uniqueName('DESC-INV-API', 90), cantidad: 1, precio: 1000, iva_pct: 0, total: 1000 };
    for (const [descuento, pattern] of [
      [{ descuento_tipo: 'MONTO', descuento_valor: 1000 }, /menor al total/i],
      [{ descuento_tipo: 'PORCENTAJE', descuento_valor: 100 }, /menor a 100/i],
      [{ descuento_tipo: 'PORCENTAJE', descuento_valor: -1 }, /negativo/i],
      [{ descuento_tipo: 'MONTO', descuento_valor: 'abc' }, /número válido/i],
      [{ descuento_tipo: 'PORCENTAJE', descuento_valor: 10, descuento_monto: 50 }, /no coincide/i],
    ]) {
      const res = await ventaApi(page, { lists, clientId: client.id, contado: false, items: [item], descuento });
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      expect(String(res.body?.mensaje || res.body?.message || '')).toMatch(pattern);
    }
    // Pagos que cubren el total original pero no el criterio: deben cubrir el total final.
    const bajo = await ventaApi(page, {
      lists, clientId: client.id, contado: true, pago: 800,
      items: [{ ...item, total: 900 }], descuento: { descuento_tipo: 'PORCENTAJE', descuento_valor: 10 },
    });
    expect(bajo.status).toBeGreaterThanOrEqual(400);
    expect(String(bajo.body?.mensaje || '')).toMatch(/no cubre/i);
  } finally {
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i, /400|422|409/] });
});

/* ======================= Backend: IVA y redondeos ======================= */

test('@crud @critical @descuentos IVA 0/10,5/21/27 y redondeos complejos cierran al centavo', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);
  const lists = await getLists(page, 'ventas');
  const client = await createParty(page, 'client', 'DESC-IVA-CLI');
  const rows = [
    { tipo_item: 'MANUAL', descripcion: uniqueName('DESC-IVA21', 90), cantidad: 3, precio: 1234.57, iva_pct: 21 },
    { tipo_item: 'MANUAL', descripcion: uniqueName('DESC-IVA105', 90), cantidad: 2.5, precio: 999.99, iva_pct: 10.5 },
    { tipo_item: 'MANUAL', descripcion: uniqueName('DESC-IVA27', 90), cantidad: 1, precio: 333.33, iva_pct: 27 },
    { tipo_item: 'MANUAL', descripcion: uniqueName('DESC-IVA0', 90), cantidad: 7.333, precio: 12.34, iva_pct: 0 },
  ];
  const ids = [];
  try {
    for (const [tipo, valor] of [['PORCENTAJE', 7.35], ['MONTO', 1234.56]]) {
      const { d, lines } = esperado(rows, tipo, valor);
      expect(d.activo).toBe(true);
      for (const contado of [false, true]) {
        const res = await ventaApi(page, {
          lists, clientId: client.id, contado, pago: d.totalFinal,
          items: rows.map((r, i) => ({ ...r, precio_lista: r.precio, total: lines[i].total })),
          descuento: { descuento_tipo: tipo, descuento_valor: valor, descuento_monto: d.monto, total_bruto: d.totalBruto },
        });
        const body = expectApiSuccess(res, `${tipo} ${valor}`);
        const id = movementId(body);
        ids.push(id);
        expect(Number(body.monto_total ?? body.total)).toBeCloseTo(d.totalFinal, 2);
        const venta = await leerMovimiento(page, 'ventas_obtener', 'venta', id);
        const items = itemsDe(venta);
        expect(items).toHaveLength(rows.length);
        let suma = 0;
        const porAlicuota = {};
        items.forEach((it, i) => {
          expect(Number(it.subtotal)).toBeCloseTo(lines[i].subtotal, 2);
          expect(Number(it.iva_monto)).toBeCloseTo(lines[i].ivaMonto, 2);
          expect(Number(it.total)).toBeCloseTo(lines[i].total, 2);
          expect(Math.round((Number(it.subtotal) + Number(it.iva_monto)) * 100) / 100).toBeCloseTo(Number(it.total), 2);
          suma += Number(it.total);
          const k = String(Number(it.iva_pct));
          porAlicuota[k] = (porAlicuota[k] || 0) + Number(it.subtotal) + Number(it.iva_monto);
        });
        expect(Math.round(suma * 100) / 100).toBeCloseTo(d.totalFinal, 2);
        expect(Math.round(Object.values(porAlicuota).reduce((a, b) => a + b, 0) * 100) / 100).toBeCloseTo(d.totalFinal, 2);
        expect(Number(venta.saldo)).toBeCloseTo(contado ? 0 : d.totalFinal, 2);
      }
    }
  } finally {
    for (const id of ids) await deleteMovement(page, 'ventas_eliminar', id);
  }
});

/* ============================= Presupuestos ============================= */

async function guardarPresupuesto(page, dialog) {
  const createdPromise = esperarPost(page, 'presupuestos_crear');
  const pdfPromise = page.waitForRequest(
    (req) => req.method() === 'POST' && new URL(req.url()).searchParams.get('action') === 'ventas_comprobantes_vincular_movimiento',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /^Guardar$/i }).last().click();
  const created = await createdPromise;
  const payload = created.request().postDataJSON();
  const body = await created.json().catch(() => ({}));
  expect(created.status(), JSON.stringify(body)).toBeLessThan(400);
  const pdfRequest = await pdfPromise;
  const multipart = (pdfRequest.postDataBuffer() || Buffer.from('')).toString('latin1');
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  return { payload, body, id: Number(body.id_movimiento || body.data?.id_movimiento || 0), multipart };
}

test('@crud @critical @descuentos presupuesto con 10 %: guardado, detalle y PDF', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-PRESU-PCT', { stock: 5, cost: 500, price: 1000 });
  const productName = c.name;

  try {
    const { dialog } = await prepareBudget(page, { ...c.row, quantity: 1, price: 1000, ivaPct: 21 });
    const box = await aplicarDescuento(dialog, 'PORCENTAJE', '10');
    await expect(box.getByTestId('dg-total-original')).toContainText(/1\.210,00/);
    await expect(dialog.getByTestId('np-summary-total')).toContainText(/1\.089,00/);
    await expect(dialog.getByTestId('np-row-total').first()).toContainText(/1\.210,00/);

    const { payload, body, id, multipart } = await guardarPresupuesto(page, dialog);
    expect(payload).toMatchObject({ descuento_tipo: 'PORCENTAJE', descuento_valor: 10, descuento_monto: 121, total_bruto: 1210 });
    expect(Number(body.monto_total ?? body.total)).toBeCloseTo(1089, 2);
    // El PDF se genera con el descuento y el total final.
    expect(multipart).toMatch(/"descuento_monto":121/);
    expect(multipart).toMatch(/"monto_ars":1089/);

    const presupuesto = await leerMovimiento(page, 'presupuestos_obtener', 'presupuesto', id);
    expect(Number(presupuesto.descuento_monto)).toBeCloseTo(121, 2);
    expect(Number(presupuesto.total_bruto)).toBeCloseTo(1210, 2);
    expect(Number(presupuesto.monto_total)).toBeCloseTo(1089, 2);
    expect(Number(itemsDe(presupuesto)[0].precio_lista)).toBeCloseTo(1000, 2);

    await page.goto('/panel/presupuesto');
    await deleteBudget(page, productName);
  } finally {
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical @descuentos presupuesto $278.000 − $28.000 → venta contado $250.000 e idempotencia', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(6 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-PRESU-MONTO', { stock: 5, cost: 1000, price: 278000 });
  const productName = c.name;
  let saleId = 0;
  let budgetId = 0;

  try {
    const { dialog } = await prepareBudget(page, { ...c.row, quantity: 1, price: 278000, ivaPct: 0 });
    await aplicarDescuento(dialog, 'MONTO', '28.000');
    await expect(dialog.getByTestId('np-summary-descuento')).toContainText(/≈\s*10,07\s*%/);
    await expect(dialog.getByTestId('np-summary-total')).toContainText(/250\.000,00/);
    const saved = await guardarPresupuesto(page, dialog);
    budgetId = saved.id;
    expect(Number(saved.body.monto_total ?? saved.body.total)).toBeCloseTo(250000, 2);

    // Conversión a venta CONTADO desde la UI.
    const row = await searchRow(page, productName, /Buscar por descripción/i);
    await row.getByTitle(/Asignar presupuesto como venta/i).click();
    const conv = await waitDialog(page, 'Asignar como venta');
    await expect(conv.getByTestId('asignar-descuento')).toContainText(/28\.000,00/);
    await expect(conv.getByTestId('asignar-total')).toContainText(/250\.000,00/);
    const typeField = conv.locator('.gm-field').filter({ hasText: 'Tipo de pago' }).first();
    await selectFirstNonEmpty(typeField.locator('select'), /CONTADO/i);
    await fillPayment(conv);
    const convertedPromise = esperarPost(page, 'presupuestos_convertir_venta');
    await conv.getByRole('button', { name: /Asignar como venta|Guardar venta|Confirmar/i }).last().click();
    const converted = await convertedPromise;
    const convBody = await converted.json().catch(() => ({}));
    expect(converted.status(), JSON.stringify(convBody)).toBeLessThan(400);
    expect(Number(converted.request().postDataJSON()?.medios_pago?.[0]?.monto)).toBeCloseTo(250000, 2);
    saleId = Number(convBody.id_venta || convBody.data?.id_venta || 0);
    expect(saleId).toBeGreaterThan(0);
    await expect(conv).toBeHidden({ timeout: 60_000 });

    const venta = await leerMovimiento(page, 'ventas_obtener', 'venta', saleId);
    expect(Number(venta.monto_total ?? venta.total_movimiento)).toBeCloseTo(250000, 2);
    expect(Number(venta.total_pagado)).toBeCloseTo(250000, 2);
    expect(Number(venta.descuento_monto)).toBeCloseTo(28000, 2);
    expect(Number(venta.total_bruto)).toBeCloseTo(278000, 2);
    expect(Number(itemsDe(venta)[0].precio_lista)).toBeCloseTo(278000, 2);
    const presupuesto = await leerMovimiento(page, 'presupuestos_obtener', 'presupuesto', budgetId);
    expect(Number(presupuesto.descuento_monto)).toBeCloseTo(28000, 2);

    // Reintento: misma venta, sin duplicar ni volver a descontar.
    const lists = await getLists(page, 'ventas');
    const retry = expectApiSuccess(await authenticatedApi(page, 'presupuestos_convertir_venta', {
      method: 'POST',
      body: { id_presupuesto: budgetId, fecha: todayISO(), id_tipo_venta: tipoVentaId(lists, 'CONTADO'), medios_pago: [{ id_medio_pago: medioPago(lists).id, monto: 250000 }] },
    }), 'El reintento de conversión debe ser idempotente');
    expect(Number(retry.id_venta || retry.data?.id_venta)).toBe(saleId);
    expect(Boolean(retry.ya_existia ?? retry.data?.ya_existia)).toBe(true);
    const ventaTrasReintento = await leerMovimiento(page, 'ventas_obtener', 'venta', saleId);
    expect(Number(ventaTrasReintento.total_pagado)).toBeCloseTo(250000, 2);
    expect(Number(ventaTrasReintento.monto_total ?? ventaTrasReintento.total_movimiento)).toBeCloseTo(250000, 2);
    if (c.stock) await expectServiceStock(page, productName, 4);
  } finally {
    if (saleId) await deleteMovement(page, 'ventas_eliminar', saleId);
    if (budgetId) await deleteMovement(page, 'presupuestos_eliminar', budgetId);
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical @descuentos presupuesto con descuento convertido a cuenta corriente registra el total final', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(5 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-PRESU-CC', { stock: 5, cost: 100, price: 1000 });
  const productName = c.name;
  let saleId = 0;
  let budgetId = 0;
  try {
    const { dialog } = await prepareBudget(page, { ...c.row, quantity: 1, price: 1000, ivaPct: 0 });
    await aplicarDescuento(dialog, 'PORCENTAJE', '10');
    budgetId = (await guardarPresupuesto(page, dialog)).id;
    const convertedPromise = esperarPost(page, 'presupuestos_convertir_venta');
    await convertBudgetToSale(page, productName);
    const convBody = await (await convertedPromise).json().catch(() => ({}));
    saleId = Number(convBody.id_venta || convBody.data?.id_venta || 0);
    const venta = await leerMovimiento(page, 'ventas_obtener', 'venta', saleId);
    expect(Number(venta.monto_total ?? venta.total_movimiento)).toBeCloseTo(900, 2);
    expect(Number(venta.saldo)).toBeCloseTo(900, 2);
    expect(Number(venta.descuento_monto)).toBeCloseTo(100, 2);
  } finally {
    if (saleId) await deleteMovement(page, 'ventas_eliminar', saleId);
    if (budgetId) await deleteMovement(page, 'presupuestos_eliminar', budgetId);
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

/* ======================== Facturación (sin emitir) ======================== */

test('@crud @critical @descuentos venta facturada: ARCA recibe el total final y bases/IVA consistentes', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-FACT', { stock: 5, cost: 100, price: 1000 });
  const productName = c.name;
  let arcaPayload = null;
  let ventaPosted = false;

  // Cliente con datos fiscales simulados: no se consulta ni modifica ARCA.
  await page.route('**/api.php?action=cliente_fiscal_get**', async (route) => {
    const id = Number(new URL(route.request().url()).searchParams.get('id_cliente') || 0);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      exito: true, existe: true,
      cliente_fiscal: { id_cliente: id, cuit: '20111111112', doc_tipo: 80, doc_nro: '20111111112', razon_social: 'PW CLIENTE FISCAL', condicion_iva: 'CONSUMIDOR FINAL', domicilio: 'PRUEBA' },
    }) });
  });
  // La emisión se intercepta y se rechaza: se valida el pedido sin consumir numeración.
  await page.route('**/api.php?action=wsfe_emitir**', async (route) => {
    arcaPayload = route.request().postDataJSON();
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ exito: false, mensaje: 'Emisión ARCA bloqueada por Playwright (descuentos).' }) });
  });
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).searchParams.get('action') === 'ventas_crear_batch') ventaPosted = true;
  });

  try {
    const dialog = await abrirNuevaVenta(page);
    await fillMovementRow(dialog, { ...c.row, quantity: 1, price: 1000 });
    await selectFirstAutocomplete(dialog, 'Cliente');
    await formaDeVenta(dialog, /CONTADO/i);
    const ivaSelect = dialog.locator('.gm-table-body .gm-table-row').first().locator('select.gm-cell-input--select').last();
    await ivaSelect.selectOption('21');
    await aplicarDescuento(dialog, 'PORCENTAJE', '10');
    await fillPayment(dialog);
    await dialog.getByRole('button', { name: /^Facturar$/i }).click();

    const resumen = page.getByRole('dialog').filter({ hasText: /Resumen antes de emitir/i }).last();
    const abierto = await resumen.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    test.skip(!abierto, 'El tenant de prueba no tiene configuración de facturación ARCA.');
    const nota = resumen.getByLabel('Descuento general de la venta');
    await expect(nota).toContainText(/1\.210,00/);
    await expect(nota).toContainText(/1\.089,00/);
    await resumen.locator('.mfr-check__input').check({ force: true });
    await resumen.getByRole('button', { name: /Emitir \+ facturar/i }).click();
    await expect.poll(() => arcaPayload !== null, { timeout: 30_000 }).toBe(true);

    // La petición real de wsfe_emitir envuelve los datos fiscales en { data: ... }.
    // En el contrato legado pueden venir directamente en la raíz. Validar ambos
    // formatos evita leer undefined como NaN y mantiene las comprobaciones reales.
    const facturaPayload = arcaPayload?.data ?? arcaPayload;
    expect(facturaPayload, 'El pedido ARCA debe contener los datos de facturación').toBeTruthy();
    const items = facturaPayload.items_facturacion;
    expect(Array.isArray(items), 'El pedido ARCA debe incluir sus ítems').toBe(true);
    expect(items).toHaveLength(1);
    const neto = items.reduce((a, it) => a + Number(it.subtotal || 0), 0);
    const iva = items.reduce((a, it) => a + Number(it.iva_monto || 0), 0);
    expect(Number(facturaPayload.total_ars)).toBeCloseTo(1089, 2);
    expect(Math.round((neto + iva) * 100) / 100).toBeCloseTo(1089, 2);
    expect(Number(items[0].precio_unitario)).toBeCloseTo(1000, 2);
    expect(Number(items[0].impBonif)).toBeCloseTo(100, 2);
    await page.waitForTimeout(1_000);
    expect(ventaPosted, 'Sin autorización ARCA no debe guardarse la venta').toBe(false);
  } finally {
    await page.unroute('**/api.php?action=wsfe_emitir**').catch(() => null);
    await page.unroute('**/api.php?action=cliente_fiscal_get**').catch(() => null);
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i, /409|ARCA|bloqueada/i] });
});

/* ===================== Notas de crédito, anulación y stock ===================== */

test('@crud @critical @descuentos nota de crédito total de una venta con descuento acredita el neto y repone stock', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(5 * 60_000);
  const diagnostics = installDiagnostics(page);
  const c = await crearConcepto(page, 'DESC-NC', { stock: 4, cost: 100, price: 1000 });
  const productName = c.name;
  try {
    const dialog = await abrirNuevaVenta(page);
    await fillMovementRow(dialog, { ...c.row, quantity: 2, price: 1000 });
    await selectFirstAutocomplete(dialog, 'Cliente');
    await formaDeVenta(dialog, /CUENTA\s*CORRIENTE/i);
    await aplicarDescuento(dialog, 'PORCENTAJE', '10');
    await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 90_000 });
    if (c.stock) await expectServiceStock(page, productName, 2);

    await page.goto('/panel/ventas');
    const { body } = await applySaleCreditNoteAndCapture(page, productName, { motive: 'ANULACION_TOTAL' });
    const totalNc = Number(body?.total ?? body?.data?.total ?? body?.total_nota_credito ?? body?.data?.total_nota_credito ?? body?.monto ?? 0);
    if (totalNc > 0) expect(totalNc).toBeCloseTo(1800, 2);
    if (c.stock) await expectServiceStock(page, productName, 4);

    // Anulación: la venta con su NC se elimina y el stock queda como al inicio.
    await page.goto('/panel/ventas');
    await deleteSale(page, productName);
    if (c.stock) await expectServiceStock(page, productName, 4);
  } finally {
    await limpiarConcepto(page, c);
  }
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/imagen/i] });
});

test('@crud @critical @descuentos servicio con composición: el descuento no cambia consumos ni costos', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(5 * 60_000);
  const plan = await getSessionPlan(page);
  test.skip(!plan.can('services.composition'), 'El plan del tenant no incluye materiales en la composición de servicios.');
  const conStock = plan.can('resources.stock');
  const unit = await ensureActiveServiceUnit(page);
  const materialName = uniqueName('DESC-MAT', 120);
  const serviceName = uniqueName('DESC-SERV', 120);
  const ids = [];
  let serviceId = 0;
  try {
    const material = await createServiceArticleFixture(page, {
      type: 'MATERIAL', name: materialName, idUnit: Number(unit.id_unidad), stock: 20, cost: 15, price: 30, controlStock: conStock,
    });
    const service = await createServiceFixture(page, {
      name: serviceName, idUnit: Number(unit.id_unidad), price: 200, ivaPct: 0,
      articles: [{ id_articulo: Number(material.id_articulo), cantidad: 1.5 }],
    });
    serviceId = Number(service.id_servicio);
    const lists = await getLists(page, 'ventas');
    const client = await createParty(page, 'client', 'DESC-SERV-CLI');
    const item = { tipo_item: 'SERVICIO', id_servicio: serviceId, descripcion: serviceName, cantidad: 2, precio: 200, precio_lista: 200, iva_pct: 0 };

    const sin = expectApiSuccess(await ventaApi(page, { lists, clientId: client.id, contado: false, items: [{ ...item, total: 400 }] }), 'venta sin descuento');
    ids.push(movementId(sin));
    if (conStock) await expectServiceStock(page, materialName, 17);
    const con = expectApiSuccess(await ventaApi(page, {
      lists, clientId: client.id, contado: false, items: [{ ...item, total: 360 }], descuento: { descuento_tipo: 'PORCENTAJE', descuento_valor: 10 },
    }), 'venta con descuento');
    ids.push(movementId(con));
    expect(Number(con.monto_total)).toBeCloseTo(360, 2);
    if (conStock) await expectServiceStock(page, materialName, 14);

    const vSin = itemsDe(await leerMovimiento(page, 'ventas_obtener', 'venta', ids[0]))[0];
    const vCon = itemsDe(await leerMovimiento(page, 'ventas_obtener', 'venta', ids[1]))[0];
    expect(Number(vCon.cantidad)).toBeCloseTo(Number(vSin.cantidad), 6);
    const consumos = async (id) => {
      const mov = await leerMovimiento(page, 'ventas_obtener', 'venta', id);
      const filas = (mov?.items_detalle || mov?.items || []).filter((it) => String(it?.tipo_item || '') === 'CONSUMO_ARTICULO');
      const desdeSnapshot = (mov?.items_detalle || []).flatMap((it) => Array.isArray(it?.consumos_snapshot) ? it.consumos_snapshot : []);
      return JSON.stringify((filas.length ? filas : desdeSnapshot).map((x) => [Number(x.id_articulo || 0), Number(x.cantidad ?? x.cantidad_total ?? 0)]));
    };
    expect(await consumos(ids[1]), 'consumos idénticos con y sin descuento').toBe(await consumos(ids[0]));
    expect(Number(vCon.costo_unitario_snapshot ?? 0)).toBeCloseTo(Number(vSin.costo_unitario_snapshot ?? 0), 4);
  } finally {
    for (const id of ids.reverse()) await deleteMovement(page, 'ventas_eliminar', id);
    if (serviceId) await deleteServiceFixture(page, serviceId).catch(() => null);
    await deleteServiceArticleFixture(page, materialName, { tolerateHistoricalUse: true }).catch(() => null);
  }
});
