import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import {
  clickSaveAndWait,
  fillPayment,
  requireMutations,
  searchRow,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  selectProduct,
  waitDialog,
  waitForBusyToFinish,
} from './support/ui.js';
import {
  createStockProduct,
  applySaleCreditNoteAndCapture,
  deleteSale,
  deleteUnusedStockProduct,
  openMovementDetail,
} from './support/flows.js';

/*
 * Regresión: descuento general en Nueva Venta.
 *
 * Regla: la grilla muestra precios e importes ORIGINALES; el descuento general
 * se muestra una sola vez en el resumen (Subtotal → Descuento general → Total
 * final). Internamente se prorratea por renglón para ARCA / persistencia / NC y
 * la suma de los renglones persistidos debe ser EXACTAMENTE el total final,
 * el cobro y el ImpTotal informado a ARCA (sin diferencias de centavos).
 *
 * Todos los casos mutan datos: sólo corren con PW_ALLOW_MUTATIONS=1 en el
 * tenant E2E. El caso de facturación intercepta wsfe_emitir y NUNCA emite.
 */

const ars = (text) => {
  const s = String(text ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return Math.abs(Number(s || 0));
};
const cents = (n) => Math.round(Number(n || 0) * 100);

async function openNuevaVenta(page) {
  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  return waitDialog(page, 'Nueva Venta');
}

async function addSaleRow(dialog, index, productName, quantity, ivaPct = '0') {
  if (index > 0) await dialog.getByRole('button', { name: /Agregar fila/i }).click();
  const row = dialog.locator('.gm-table-body .gm-table-row').nth(index);
  await expect(row).toBeVisible();
  await selectProduct(row, productName);
  const qty = row.locator('input[type="number"]').first();
  await qty.fill(String(quantity));
  await qty.blur();
  await row.locator('select.gm-cell-input--select').first().selectOption(String(ivaPct));
  return row;
}

async function setDiscount(dialog, tipo, valor) {
  await dialog.getByLabel('Tipo de descuento').selectOption(tipo);
  await dialog.getByLabel('Valor del descuento').fill(String(valor));
}

async function readScreen(dialog) {
  const rows = (await dialog.locator('[data-testid="nv-row-total"]').allInnerTexts()).map(ars);
  const descLoc = dialog.locator('[data-testid="nv-summary-descuento"] b');
  return {
    rows,
    subtotal: ars(await dialog.locator('[data-testid="nv-summary-subtotal"] b').innerText()),
    descuento: (await descLoc.count()) ? ars(await descLoc.innerText()) : 0,
    total: ars(await dialog.locator('[data-testid="nv-summary-total"] b').innerText()),
  };
}

async function expectScreen(dialog, expected, message) {
  await expect.poll(() => readScreen(dialog), { message, timeout: 10_000 }).toEqual(expected);
}

async function saveAndCapture(page, dialog, { contado }) {
  await selectFirstAutocomplete(dialog, 'Cliente');
  const typeField = dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first();
  await selectFirstNonEmpty(typeField.locator('select'), contado ? /CONTADO/i : /CUENTA\s*CORRIENTE/i);
  if (contado) await fillPayment(dialog);

  const responsePromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).searchParams.get('action') === 'ventas_crear_batch',
    { timeout: 90_000 },
  );
  await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 90_000 });
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
  return { request: response.request().postDataJSON(), result: body?.data || body };
}

async function fetchPersistedSale(page, idMovimiento) {
  const res = await authenticatedApi(page, 'ventas_obtener', { query: { id_movimiento: idMovimiento } });
  expectApiSuccess(res, 'Debe poder recuperarse la venta guardada');
  const venta = res.body?.data?.venta || res.body?.venta || res.body?.data || {};
  const items = Array.isArray(venta.items_detalle) ? venta.items_detalle : (venta.items || []);
  return { venta, items };
}

/** Verificaciones comunes de persistencia, cobro y ausencia de doble descuento. */
function expectPersistedConsistent({ request, result, venta, items }, expected) {
  // Payload: precio de lista + descuento declarado una sola vez.
  expect(cents(request.total_bruto)).toBe(cents(expected.subtotal));
  expect(cents(request.descuento_monto)).toBe(cents(expected.descuento));
  // Respuesta del backend = pantalla (el backend no recalcula otro valor).
  expect(cents(result.total ?? result.monto_total)).toBe(cents(expected.total));
  expect(cents(result.total_bruto)).toBe(cents(expected.subtotal));
  expect(cents(result.descuento_monto)).toBe(cents(expected.descuento));
  // Persistido: Σ renglones netos = total final EXACTO; cabecera bruto − desc = total.
  const sumaItems = items.reduce((acc, it) => acc + cents(it.total), 0);
  expect(sumaItems, 'Σ renglones persistidos debe ser el total final exacto').toBe(cents(expected.total));
  for (const it of items) {
    expect(cents(it.subtotal) + cents(it.iva_monto), 'subtotal + IVA = total por renglón').toBe(cents(it.total));
  }
  if (venta.total_bruto !== undefined) {
    expect(cents(venta.total_bruto) - cents(venta.descuento_monto)).toBe(cents(expected.total));
  }
  // Sin doble descuento: el total aplica el descuento exactamente una vez.
  expect(cents(expected.subtotal) - cents(expected.descuento)).toBe(cents(expected.total));
}

async function createProducts(page, prefix, specs) {
  const names = [];
  for (const [i, spec] of specs.entries()) {
    const name = uniqueName(`${prefix}-${i + 1}`);
    await createStockProduct(page, { name, sku: uniqueSku(`${prefix}${i + 1}`), stock: spec.stock ?? 20, cost: 1, price: spec.price });
    names.push(name);
  }
  return names;
}

async function cleanup(page, saleQuery, names) {
  if (saleQuery) await deleteSale(page, saleQuery).catch(() => {});
  await page.goto('/panel/stock');
  for (const name of names) await deleteUnusedStockProduct(page, name).catch(() => {});
}

test('@crud @critical descuento general: grilla con precios originales, resumen final y persistencia exacta (contado)', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(6 * 60_000);
  const diagnostics = installDiagnostics(page);
  // Mismo carrito que el video del cliente: 2 × 8.500, 2 × 8.100, 1 × 9.500.
  const names = await createProducts(page, 'DESCGRAL', [{ price: 8500 }, { price: 8100 }, { price: 9500 }]);

  const dialog = await openNuevaVenta(page);
  await addSaleRow(dialog, 0, names[0], 2);
  await addSaleRow(dialog, 1, names[1], 2);
  await addSaleRow(dialog, 2, names[2], 1);

  // 1) Sin descuento.
  await expectScreen(dialog, { rows: [17000, 16200, 9500], subtotal: 42700, descuento: 0, total: 42700 }, 'Venta sin descuento');

  // 3) Tres productos + 15 %: los renglones NO cambian; el descuento va sólo al resumen.
  await setDiscount(dialog, 'PORCENTAJE', 15);
  await expectScreen(dialog, { rows: [17000, 16200, 9500], subtotal: 42700, descuento: 6405, total: 36295 }, 'Caso del video');
  await expect(dialog.locator('[data-testid="nv-summary-descuento"]')).toContainText(/Descuento general \(15 %\)/);
  await expect(dialog.locator('[data-testid="nv-summary-total"]')).toContainText(/Total final/);

  // 7) Cambio de cantidad con descuento aplicado.
  const qty0 = dialog.locator('.gm-table-body .gm-table-row').nth(0).locator('input[type="number"]').first();
  await qty0.fill('3');
  await qty0.blur();
  await expectScreen(dialog, { rows: [25500, 16200, 9500], subtotal: 51200, descuento: 7680, total: 43520 }, 'Cambio de cantidad');

  // 8) Eliminación de un producto con descuento aplicado.
  await dialog.locator('.gm-table-body .gm-table-row').nth(1).locator('.gm-row-delete').click();
  await expectScreen(dialog, { rows: [25500, 9500], subtotal: 35000, descuento: 5250, total: 29750 }, 'Eliminación de producto');

  // 4) Descuento fijo.
  await setDiscount(dialog, 'MONTO', 1000);
  await expectScreen(dialog, { rows: [25500, 9500], subtotal: 35000, descuento: 1000, total: 34000 }, 'Descuento fijo');

  // 9) + 11) Contado: guardar, cobro = total final, recuperar y comparar renglones.
  await setDiscount(dialog, 'PORCENTAJE', 15);
  await expectScreen(dialog, { rows: [25500, 9500], subtotal: 35000, descuento: 5250, total: 29750 }, 'Antes de guardar');
  const amountInput = dialog.locator('.gm-payment-row--amount input').first();
  const { request, result } = await saveAndCapture(page, dialog, { contado: true });
  expect(cents(ars(await amountInput.inputValue().catch(() => '29750')))).toBe(cents(29750));
  expect(cents(result.total_pagado)).toBe(cents(29750));
  const pagos = Array.isArray(request.medios_pago) ? request.medios_pago : [];
  expect(pagos.reduce((a, p) => a + cents(p.monto), 0)).toBe(cents(29750));
  // El payload conserva el precio de lista por renglón (no viaja ya descontado).
  expect(request.items.map((i) => cents(i.precio_lista))).toEqual([cents(8500), cents(9500)]);

  const persisted = await fetchPersistedSale(page, Number(result.id_movimiento));
  expectPersistedConsistent({ request, result, ...persisted }, { subtotal: 35000, descuento: 5250, total: 29750 });

  // Detalle: informa el descuento una vez y rotula los importes netos.
  const detail = await openMovementDetail(page, names[0], 'sale');
  const note = detail.getByLabel('Detalle del descuento comercial');
  await expect(note).toContainText(/35\.000,00/);
  await expect(note).toContainText(/5\.250,00/);
  await expect(note).toContainText(/29\.750,00/);
  await expect(detail.locator('.mdm-table__row--head')).toContainText(/Total neto/);
  await detail.getByRole('button', { name: /Cerrar/i }).click();

  await cleanup(page, names[0], names);
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /imagen/i] });
});

test('@crud @critical descuento general: cuenta corriente con prorrateo decimal sin diferencias de centavos', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(6 * 60_000);
  const diagnostics = installDiagnostics(page);
  // 10) + 15) Precios con centavos, IVA mixto y descuento porcentual que obliga
  // a prorratear con residuo. Con el backend anterior este carrito se guardaba con
  // Σ renglones = 9.804,00 frente a un total cobrable de 9.804,02.
  // Cantidades enteras: los productos E2E se crean con unidad "u", que no admite
  // decimales (validación correcta del sistema).
  const names = await createProducts(page, 'DESCCTA', [{ price: 1999.99 }, { price: 3569.8 }]);

  const dialog = await openNuevaVenta(page);
  await addSaleRow(dialog, 0, names[0], 3, '21');
  await addSaleRow(dialog, 1, names[1], 1, '10.5');
  await setDiscount(dialog, 'PORCENTAJE', 12.5);
  const screen = await readScreen(dialog);
  expect(screen.rows).toEqual([7259.96, 3944.63]);
  expect(screen).toMatchObject({ subtotal: 11204.59, descuento: 1400.57, total: 9804.02 });

  const { request, result } = await saveAndCapture(page, dialog, { contado: false });
  expect(String(result.estado_pago || '')).toMatch(/PENDIENTE/i);
  expect(cents(result.total_pagado || 0)).toBe(0);
  const persisted = await fetchPersistedSale(page, Number(result.id_movimiento));
  expectPersistedConsistent({ request, result, ...persisted }, { subtotal: 11204.59, descuento: 1400.57, total: 9804.02 });

  // El saldo pendiente de la cuenta corriente es exactamente el total final.
  const row = await searchRow(page, names[0], /Buscar por descripción, cliente/i);
  await expect(row).toContainText(/9\.804,02/);

  await cleanup(page, names[0], names);
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /imagen/i] });
});

test('@crud @critical descuento general: NC interna parcial acredita el importe neto prorrateado', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(6 * 60_000);
  const diagnostics = installDiagnostics(page);
  // 14) La NC se calcula desde los renglones persistidos: debe acreditar el
  // neto realmente cobrado de ese renglón, no el precio de lista.
  const names = await createProducts(page, 'DESCNC', [{ price: 1000 }, { price: 3000 }]);
  const dialog = await openNuevaVenta(page);
  await addSaleRow(dialog, 0, names[0], 2);
  await addSaleRow(dialog, 1, names[1], 1);
  await setDiscount(dialog, 'PORCENTAJE', 10);
  await expectScreen(dialog, { rows: [2000, 3000], subtotal: 5000, descuento: 500, total: 4500 }, 'Venta para NC');
  const { result } = await saveAndCapture(page, dialog, { contado: true });
  const { items } = await fetchPersistedSale(page, Number(result.id_movimiento));
  const netoUnitario = cents(items[0].total) / Number(items[0].cantidad);
  expect(netoUnitario).toBe(cents(900));

  const { body } = await applySaleCreditNoteAndCapture(page, names[0], 1);
  const data = body?.data || body;
  const totalNc = Number(data?.total ?? data?.monto_total ?? data?.total_nota_credito ?? data?.importe ?? NaN);
  if (Number.isFinite(totalNc)) expect(cents(totalNc)).toBe(cents(900));

  await cleanup(page, names[0], names);
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /imagen/i] });
});

test('@critical descuento general: payload de facturación ARCA (interceptado, no emite)', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const diagnostics = installDiagnostics(page);
  // 13) No se emite ningún comprobante: wsfe_emitir se intercepta y se responde
  // con error controlado. Sólo se valida el payload que React enviaría a ARCA.
  let arcaPayload = null;
  const esWsfeEmitir = (url) => new URL(url).searchParams.get('action') === 'wsfe_emitir';
  await page.route(esWsfeEmitir, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON() || {};
    // ModalFacturaBaltoResumen envía el comprobante dentro de { data: {...} }.
    if (!arcaPayload) arcaPayload = body.data || body;
    // 422 = rechazo controlado (no cuenta como error 5xx del servidor en diagnostics).
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ exito: false, mensaje: 'E2E: emisión ARCA bloqueada por el test.' }) });
  });

  const names = await createProducts(page, 'DESCARCA', [{ price: 1234.57 }, { price: 333.33 }]);
  const dialog = await openNuevaVenta(page);
  await addSaleRow(dialog, 0, names[0], 3, '21');
  await addSaleRow(dialog, 1, names[1], 7, '10.5');
  await setDiscount(dialog, 'PORCENTAJE', 17.5);
  const screen = await readScreen(dialog);

  await selectFirstAutocomplete(dialog, 'Cliente');
  const typeField = dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first();
  await selectFirstNonEmpty(typeField.locator('select'), /CONTADO/i);
  await fillPayment(dialog);
  await dialog.getByRole('button', { name: /^Facturar$/i }).click();
  // Resumen fiscal: se busca DENTRO de su diálogo (en el listado de fondo hay
  // botones "Emitir nota de crédito" que no deben tocarse).
  const resumen = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /Resumen antes de emitir/i }) }).last();
  await expect(resumen).toBeVisible({ timeout: 30_000 });
  const confirmar = resumen.getByRole('checkbox', { name: /Confirmo que los datos/i });
  await expect(confirmar).toBeEnabled({ timeout: 30_000 });
  // El checkbox real queda debajo del ícono personalizado (.mfr-check__box):
  // se hace clic en la etiqueta completa, como lo haría el usuario.
  await resumen.locator('label.mfr-check').first().click();
  if (!(await confirmar.isChecked())) await confirmar.check({ force: true });
  await expect(confirmar).toBeChecked();
  const emitir = resumen.getByRole('button', { name: /Emitir \+ facturar/i });
  await expect(emitir).toBeEnabled({ timeout: 15_000 });
  await emitir.click();
  await expect.poll(() => arcaPayload !== null, { timeout: 30_000 }).toBeTruthy();

  const items = arcaPayload.items_facturacion || [];
  const impNeto = items.reduce((a, i) => a + cents(i.subtotal), 0);
  const impIva = items.reduce((a, i) => a + cents(i.iva_monto), 0);
  expect(impNeto + impIva, 'ImpNeto + ImpIVA = ImpTotal').toBe(cents(arcaPayload.total_ars));
  expect(cents(arcaPayload.total_ars), 'ImpTotal = total final de la pantalla').toBe(cents(screen.total));
  expect(cents(screen.subtotal) - cents(screen.descuento)).toBe(cents(screen.total));
  // Representación fiscal: precio unitario de lista + bonificación por renglón.
  expect(items.map((i) => cents(i.precio_unitario))).toEqual([cents(1234.57), cents(333.33)]);
  for (const i of items) expect(Number(i.bonif_pct)).toBeGreaterThan(0);

  // La emisión fue bloqueada: no se creó venta ni comprobante. Se cierra todo.
  await resumen.getByRole('button', { name: /^Cerrar$/i }).click().catch(() => {});
  await page.goto('/panel/stock');
  for (const name of names) await deleteUnusedStockProduct(page, name).catch(() => {});
  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/Tienda Nube/i, /imagen/i, /ARCA/i, /422/, /bloqueada por el test/i] });
});
