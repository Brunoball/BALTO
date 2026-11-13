import { test, expect } from '../support/test.js';
import { uniqueName, todayISO, uniqueSku, uniqueChequeNumber } from '../support/data.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import {
  requireMutations,
  clickSaveAndWait,
  fillMovementRow,
  fillPayment,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  waitDialog,
  waitForBusyToFinish,
  selectMovementMode,
} from '../support/ui.js';
import { addDaysISO, historicalOperationDays } from '../support/historical-dates.js';
import {
  cashFlowDay,
  createParty,
  createProduct,
  createPurchase,
  createSale,
  deleteMovement,
  expectRejected,
  getLists,
  medioPago,
  movementId,
  paymentDates,
  tipoVentaId,
  financialAnalysis,
} from '../support/financial-api.js';
import { createStockProduct, deleteUnusedStockProduct } from '../support/flows.js';

// Regresión unificada de fechas de operaciones, cobros, pagos, apertura,
// cuenta corriente, presupuestos y cheques. Se consolidaron los antiguos
// tests 52, 53, 55 y 56 sin eliminar sus casos ni cambiar sus aserciones.
// La sesión y las escrituras están protegidas por support/test.js y E2E guard.

// Los movimientos históricos pueden quedar fuera del rango predeterminado de la grilla.
// La limpieza de este test no debe depender de filtros visuales: usamos el ID
// exacto devuelto por el alta y comprobamos el resultado del borrado.
async function eliminarMovimientoDePrueba(page, action, id) {
  if (!(Number(id) > 0)) return;
  expectApiSuccess(await authenticatedApi(page, action, {
    method: 'POST', body: { id_movimiento: Number(id) },
  }), `No se pudo limpiar el movimiento de prueba #${id} (${action})`);
}

// ===== 54-politica-fechas-importes-pagos.spec.js =====

// POLÍTICA ÚNICA DE FECHAS: en una operación contado la fecha del modal es la
// fecha del cobro/pago. created_at es sólo auditoría. Todo por API: sin ARCA ni Tienda Nube.

async function aperturaDelMedio(page, idMedio) {
  const body = expectApiSuccess(await authenticatedApi(page, 'config_saldos_iniciales_get'), 'No se pudieron leer los saldos iniciales');
  return (Array.isArray(body?.tesoreria) ? body.tesoreria : [])
    .filter((r) => Number(r?.id_medio_pago || 0) === idMedio)
    .map((r) => String(r?.fecha_saldo || '').slice(0, 10))
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
    .sort()[0] || null;
}

function egreso({ fecha, nombre, total, idMedio, monto = total, extraPago = {} }) {
  return {
    fecha,
    items: [{ detalle: nombre, cantidad: 1, precio: total, iva_pct: 0, subtotal: total, iva_monto: 0, total }],
    monto_total: total,
    medios_pago: [{ id_medio_pago: idMedio, monto, ...extraPago }],
  };
}

test.describe('@flujo @regression política única de fechas (contado)', () => {
  test.describe.configure({ mode: 'serial' });

  test('TEST 1 — venta contado histórica: venta, cobro y Flujo de Caja en la fecha elegida', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);
    const dias = await historicalOperationDays(page);
    test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
    const lists = await getLists(page, 'ventas');
    const medio = medioPago(lists);
    const client = await createParty(page, 'client', 'FECHA-UNICA-CLI');
    const product = await createProduct(page, 'FECHA-UNICA-VTA', { stock: 3, cost: 50, price: 241 });
    const antesDia = await cashFlowDay(page, dias.operationDay);
    const antesHoy = await cashFlowDay(page, dias.today);
    let id = 0;
    try {
      const body = expectApiSuccess(await createSale(page, {
        fecha: dias.operationDay, typeId: tipoVentaId(lists, 'CONTADO'), clientId: client.id,
        productId: product.id, amount: 241,
        // Un cliente viejo que mande otra fecha_pago no puede separar el cobro de la venta.
        medios: [{ id_medio_pago: medio.id, monto: 241, fecha_pago: dias.today }],
      }), 'No se pudo crear la venta contado histórica');
      id = movementId(body);
      const { mov, fechas } = await paymentDates(page, 'ventas_obtener', 'venta', id);
      expect(String(mov.fecha).slice(0, 10)).toBe(dias.operationDay);
      expect(fechas.length).toBeGreaterThan(0);
      for (const f of fechas) expect(f, 'El cobro contado usa la fecha de la venta').toBe(dias.operationDay);
      expect((await cashFlowDay(page, dias.operationDay)).ingresos - antesDia.ingresos).toBeCloseTo(241, 2);
      expect((await cashFlowDay(page, dias.today)).ingresos - antesHoy.ingresos, 'Nada se registra en el día de carga').toBeCloseTo(0, 2);
    } finally {
      await deleteMovement(page, 'ventas_eliminar', id);
    }
  });

  test('TEST 2 — compra contado histórica: el egreso cae en la fecha de la compra', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);
    const dias = await historicalOperationDays(page);
    test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
    const lists = await getLists(page, 'compras');
    const medio = medioPago(lists);
    const provider = await createParty(page, 'provider', 'FECHA-UNICA-PROV');
    const product = await createProduct(page, 'FECHA-UNICA-CMP', { stock: 0, cost: 133, price: 200 });
    const antesDia = await cashFlowDay(page, dias.operationDay);
    const antesHoy = await cashFlowDay(page, dias.today);
    let id = 0;
    try {
      const body = expectApiSuccess(await createPurchase(page, {
        fecha: dias.operationDay, typeId: tipoVentaId(lists, 'CONTADO'), providerId: provider.id,
        productId: product.id, amount: 133, medios: [{ id_medio_pago: medio.id, monto: 133 }],
      }), 'No se pudo crear la compra contado histórica');
      id = movementId(body);
      const { fechas } = await paymentDates(page, 'compras_obtener', 'compra', id);
      for (const f of fechas) expect(f).toBe(dias.operationDay);
      expect((await cashFlowDay(page, dias.operationDay)).egresos - antesDia.egresos).toBeCloseTo(133, 2);
      expect((await cashFlowDay(page, dias.today)).egresos - antesHoy.egresos).toBeCloseTo(0, 2);
    } finally {
      await deleteMovement(page, 'compras_eliminar', id);
    }
  });

  test('TEST 3 — otros ingresos y egresos históricos impactan en su fecha', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);
    const dias = await historicalOperationDays(page);
    test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
    const medio = medioPago(await getLists(page, 'ventas'));
    const antes = await cashFlowDay(page, dias.operationDay);
    let idIngreso = 0;
    let idEgreso = 0;
    try {
      const ing = expectApiSuccess(await authenticatedApi(page, 'otros_ingresos_crear', {
        method: 'POST',
        body: { ...egreso({ fecha: dias.operationDay, nombre: uniqueName('INGRESO-FECHA-UNICA'), total: 157, idMedio: medio.id }) },
      }), 'No se pudo crear el otro ingreso histórico');
      idIngreso = movementId(ing);
      const eg = expectApiSuccess(await authenticatedApi(page, 'otros_egresos_crear', {
        method: 'POST',
        body: egreso({ fecha: dias.operationDay, nombre: uniqueName('EGRESO-FECHA-UNICA'), total: 89, idMedio: medio.id }),
      }), 'No se pudo crear el otro egreso histórico');
      idEgreso = movementId(eg);
      for (const f of (await paymentDates(page, 'otros_ingresos_obtener', 'ingreso', idIngreso)).fechas) expect(f).toBe(dias.operationDay);
      for (const f of (await paymentDates(page, 'otros_egresos_obtener', 'egreso', idEgreso)).fechas) expect(f).toBe(dias.operationDay);
      const despues = await cashFlowDay(page, dias.operationDay);
      expect(despues.ingresos - antes.ingresos).toBeCloseTo(157, 2);
      expect(despues.egresos - antes.egresos).toBeCloseTo(89, 2);
    } finally {
      await deleteMovement(page, 'otros_ingresos_eliminar', idIngreso);
      await deleteMovement(page, 'otros_egresos_eliminar', idEgreso);
    }
  });

  test('TEST 10 — editar sin cambiar la fecha conserva el día; cambiarla mueve el pago a la nueva fecha (nunca a hoy)', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);
    const dias = await historicalOperationDays(page);
    test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
    const medio = medioPago(await getLists(page, 'ventas'));
    const nombre = uniqueName('EGRESO-EDICION-FECHA');
    let id = 0;
    try {
      id = movementId(expectApiSuccess(await authenticatedApi(page, 'otros_egresos_crear', {
        method: 'POST', body: egreso({ fecha: dias.operationDay, nombre, total: 70, idMedio: medio.id }),
      }), 'No se pudo crear el egreso a editar'));

      expectApiSuccess(await authenticatedApi(page, 'otros_egresos_actualizar', {
        method: 'POST',
        body: { id_movimiento: id, ...egreso({ fecha: dias.operationDay, nombre, total: 75, idMedio: medio.id }) },
      }), 'No se pudo editar el importe');
      for (const f of (await paymentDates(page, 'otros_egresos_obtener', 'egreso', id)).fechas) {
        expect(f, 'Editar el importe no mueve el pago').toBe(dias.operationDay);
      }

      expectApiSuccess(await authenticatedApi(page, 'otros_egresos_actualizar', {
        method: 'POST',
        body: { id_movimiento: id, ...egreso({ fecha: dias.paymentDay, nombre, total: 75, idMedio: medio.id }) },
      }), 'No se pudo editar la fecha');
      for (const f of (await paymentDates(page, 'otros_egresos_obtener', 'egreso', id)).fechas) {
        expect(f, 'El pago acompaña la nueva fecha de la operación').toBe(dias.paymentDay);
      }
    } finally {
      await deleteMovement(page, 'otros_egresos_eliminar', id);
    }
  });

  test('una operación sin fecha se rechaza: no se usa la fecha del servidor', async ({ page }) => {
    await requireMutations(test, page);
    const medio = medioPago(await getLists(page, 'ventas'));
    const body = egreso({ fecha: '', nombre: uniqueName('EGRESO-SIN-FECHA'), total: 10, idMedio: medio.id });
    delete body.fecha;
    expectRejected(await authenticatedApi(page, 'otros_egresos_crear', { method: 'POST', body }), /Falta la fecha/i);
  });

  test('efectivo/banco no pueden superar el total de una operación contado', async ({ page }) => {
    await requireMutations(test, page);
    const medio = medioPago(await getLists(page, 'ventas'));
    expectRejected(await authenticatedApi(page, 'otros_egresos_crear', {
      method: 'POST', body: egreso({ fecha: todayISO(), nombre: uniqueName('EGRESO-SOBREPAGO'), total: 100, idMedio: medio.id, monto: 1000 }),
    }), /superan el total/i);
  });

  test('una operación contado con fecha futura se rechaza', async ({ page }) => {
    await requireMutations(test, page);
    const medio = medioPago(await getLists(page, 'ventas'));
    expectRejected(await authenticatedApi(page, 'otros_egresos_crear', {
      method: 'POST', body: egreso({ fecha: addDaysISO(todayISO(), 2), nombre: uniqueName('EGRESO-FUTURO'), total: 100, idMedio: medio.id }),
    }), /posterior al día de hoy/i);
  });

  test('TEST 9 — un movimiento anterior al saldo inicial del medio se rechaza (no duplica dinero)', async ({ page }) => {
    await requireMutations(test, page);
    const medio = medioPago(await getLists(page, 'ventas'));
    const apertura = await aperturaDelMedio(page, medio.id);
    test.skip(!apertura, `El medio ${medio.nombre} no tiene saldo inicial de tesorería en esta base.`);
    expectRejected(await authenticatedApi(page, 'otros_egresos_crear', {
      method: 'POST', body: egreso({ fecha: addDaysISO(apertura, -1), nombre: uniqueName('EGRESO-PRE-APERTURA'), total: 100, idMedio: medio.id }),
    }), /anterior al saldo inicial/i);
  });
});

// ===== 52-venta-fecha-cobro-historico.spec.js =====

// UI — Nueva Venta CONTADO tiene UNA sola fecha. La fecha elegida es la de la
// venta y la del cobro; el día en que se carga no tiene efecto financiero.
const salePrice = 734;

test('@ventas @flujo @regression venta contado histórica: una sola fecha para la venta y el cobro', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const dias = await historicalOperationDays(page);
  test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
  const name = uniqueName('VENTA-FECHA-UNICA');
  const antesDia = await cashFlowDay(page, dias.operationDay);
  const antesHoy = await cashFlowDay(page, dias.today);
  let createdProduct = false;
  let saleId = 0;

  try {
    await createStockProduct(page, { name, sku: uniqueSku('FUNICA'), stock: 3, cost: 200, price: salePrice });
    createdProduct = true;

    await page.goto('/panel/ventas');
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Nueva Venta/i }).click();
    const dialog = await waitDialog(page, 'Nueva Venta');
    await fillMovementRow(dialog, { productName: name, quantity: 1, price: salePrice });
    await selectFirstAutocomplete(dialog, 'Cliente');
    await selectFirstNonEmpty(
      dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first().locator('select'),
      /CONTADO/i,
    );
    await fillPayment(dialog);
    await dialog.locator('#nv-fecha-input').fill(dias.operationDay);
    await expect(dialog.locator('#nv-fecha-input')).toHaveValue(dias.operationDay);

    // No existe un segundo selector de fecha para el cobro.
    await expect(dialog.getByLabel(/Fecha de cobro/i)).toHaveCount(0);
    await expect(dialog.locator('input[type="date"]')).toHaveCount(1);

    const saleResponsePromise = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).searchParams.get('action') === 'ventas_crear_batch',
      { timeout: 90_000 },
    );
    await clickSaveAndWait(dialog, /Guardar venta/i, { timeout: 90_000 });
    const saleResponse = await saleResponsePromise;
    const saleBody = await saleResponse.json().catch(() => ({}));
    expect(saleResponse.status(), JSON.stringify(saleBody)).toBeLessThan(400);
    expect(saleBody?.exito !== false, JSON.stringify(saleBody)).toBeTruthy();
    saleId = movementId(saleBody);
    expect(saleId, 'La venta de prueba debe devolver su ID real').toBeGreaterThan(0);

    const posted = saleResponse.request().postDataJSON();
    expect(posted?.items?.[0]?.fecha).toBe(dias.operationDay);
    for (const mp of posted?.medios_pago || []) {
      expect(mp.fecha_pago, 'El frontend ya no envía una segunda fecha').toBeUndefined();
    }

    const { mov, fechas } = await paymentDates(page, 'ventas_obtener', 'venta', saleId);
    expect(String(mov.fecha).slice(0, 10)).toBe(dias.operationDay);
    expect(fechas.length).toBeGreaterThan(0);
    for (const f of fechas) expect(f, 'El cobro queda en la fecha de la venta').toBe(dias.operationDay);

    expect((await cashFlowDay(page, dias.operationDay)).ingresos - antesDia.ingresos).toBeCloseTo(salePrice, 2);
    expect((await cashFlowDay(page, dias.today)).ingresos - antesHoy.ingresos, 'Nada se registra el día de carga').toBeCloseTo(0, 2);
  } finally {
    await eliminarMovimientoDePrueba(page, 'ventas_eliminar', saleId);
    if (createdProduct) {
      await page.goto('/panel/stock');
      await deleteUnusedStockProduct(page, name);
    }
  }
});

// ===== 53-fecha-pagos-compra-historica.spec.js =====

// UI — Nueva Compra CONTADO tiene UNA sola fecha: la del modal es la fecha de la
// compra y del egreso de caja; created_at sólo registra cuándo se cargó.

test('@compras @flujo @regression compra contado histórica: una sola fecha para la compra y el pago', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const dias = await historicalOperationDays(page);
  test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
  const productName = uniqueName('COMPRA-FECHA-UNICA');
  const antesDia = await cashFlowDay(page, dias.operationDay);
  const antesHoy = await cashFlowDay(page, dias.today);
  let createdProduct = false;
  let purchaseId = 0;

  try {
    await createStockProduct(page, { name: productName, sku: uniqueSku('CUNICA'), stock: 5, cost: 140, price: 230 });
    createdProduct = true;

    await page.goto('/panel/compras');
    await waitForBusyToFinish(page);
    await page.getByTitle('Crear nueva compra').click();
    const dialog = await waitDialog(page, 'Nueva Compra');
    await fillMovementRow(dialog, { productName, quantity: 1, price: 140 });
    await selectFirstAutocomplete(dialog, 'Proveedor');
    await selectMovementMode(dialog, 'Forma de compra', /CONTADO/i);
    await fillPayment(dialog);
    await dialog.locator('#nc-fecha-input').fill(dias.operationDay);
    await expect(dialog.locator('#nc-fecha-input')).toHaveValue(dias.operationDay);

    // No existe un segundo selector de fecha para el pago.
    await expect(dialog.getByLabel(/Fecha de pago/i)).toHaveCount(0);
    await expect(dialog.locator('input[type="date"]')).toHaveCount(1);

    const responsePromise = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).searchParams.get('action') === 'compras_crear_batch',
      { timeout: 90_000 },
    );
    await clickSaveAndWait(dialog, /Guardar compra/i, { timeout: 90_000 });
    const response = await responsePromise;
    const data = await response.json().catch(() => ({}));
    expect(response.status(), JSON.stringify(data)).toBeLessThan(400);
    expect(data?.exito !== false, JSON.stringify(data)).toBeTruthy();
    purchaseId = movementId(data);
    expect(purchaseId, 'La compra de prueba debe devolver su ID real').toBeGreaterThan(0);

    const posted = response.request().postDataJSON();
    expect(posted?.items?.[0]?.fecha).toBe(dias.operationDay);
    expect(posted?.medios_pago?.length).toBeGreaterThan(0);
    for (const pago of posted.medios_pago) {
      expect(pago.fecha_pago, 'El frontend ya no envía una segunda fecha').toBeUndefined();
    }

    const { fechas } = await paymentDates(page, 'compras_obtener', 'compra', purchaseId);
    for (const f of fechas) expect(f, 'El egreso queda en la fecha de la compra').toBe(dias.operationDay);

    const total = Number(data?.total ?? data?.monto_total ?? 0);
    expect(total).toBeGreaterThan(0);
    expect((await cashFlowDay(page, dias.operationDay)).egresos - antesDia.egresos).toBeCloseTo(total, 2);
    expect((await cashFlowDay(page, dias.today)).egresos - antesHoy.egresos, 'Nada se registra el día de carga').toBeCloseTo(0, 2);
  } finally {
    await eliminarMovimientoDePrueba(page, 'compras_eliminar', purchaseId);
    if (createdProduct) {
      await page.goto('/panel/stock');
      await deleteUnusedStockProduct(page, productName);
    }
  }
});

// ===== 55-cuentas-corrientes-presupuestos-conciliacion.spec.js =====

// Cuenta corriente: la venta/compra se registra en su fecha y el dinero impacta
// en la fecha del Recibo / Orden de pago. Presupuesto convertido: usa la fecha
// elegida en la conversión. Conciliación: misma magnitud y corte en ambos reportes.

test.describe('@flujo @cuentas-corrientes @regression fechas de cuenta corriente, presupuestos y conciliación', () => {
  test.describe.configure({ mode: 'serial' });

  test('TEST 4 y 5 — venta CC histórica no genera ingreso; el recibo impacta en su propia fecha', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);
    const dias = await historicalOperationDays(page);
    test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
    const lists = await getLists(page, 'ventas');
    const medio = medioPago(lists);
    const client = await createParty(page, 'client', 'CC-FECHA-CLI');
    const product = await createProduct(page, 'CC-FECHA-VTA', { stock: 3, cost: 60, price: 317 });
    const antesVenta = await cashFlowDay(page, dias.operationDay);
    const antesRecibo = await cashFlowDay(page, dias.paymentDay);
    let id = 0;
    try {
      id = movementId(expectApiSuccess(await createSale(page, {
        fecha: dias.operationDay, typeId: tipoVentaId(lists, 'CUENTA CORRIENTE'),
        clientId: client.id, productId: product.id, amount: 317, medios: [],
      }), 'No se pudo crear la venta CC histórica'));
      expect((await cashFlowDay(page, dias.operationDay)).ingresos - antesVenta.ingresos, 'La venta pendiente no es dinero').toBeCloseTo(0, 2);

      // Un recibo no puede ser anterior a la venta que cancela.
      expectRejected(await authenticatedApi(page, 'recibos_confirmar_pago', {
        method: 'POST',
        body: { ids_movimiento: [id], id_cliente: client.id, fecha: addDaysISO(dias.operationDay, -1), medios_pago: [{ id_medio_pago: medio.id, monto: 317 }] },
      }), /anterior a la fecha de la venta/i);

      // Un recibo sin fecha se rechaza (no se usa "hoy" en silencio).
      expectRejected(await authenticatedApi(page, 'recibos_confirmar_pago', {
        method: 'POST',
        body: { ids_movimiento: [id], id_cliente: client.id, medios_pago: [{ id_medio_pago: medio.id, monto: 317 }] },
      }), /Falta la fecha del recibo/i);

      expectApiSuccess(await authenticatedApi(page, 'recibos_confirmar_pago', {
        method: 'POST',
        body: { ids_movimiento: [id], id_cliente: client.id, fecha: dias.paymentDay, medios_pago: [{ id_medio_pago: medio.id, monto: 317 }] },
      }), 'No se pudo registrar el recibo histórico');

      const { fechas } = await paymentDates(page, 'recibos_obtener', 'recibo', id);
      expect(fechas).toContain(dias.paymentDay);
      expect((await cashFlowDay(page, dias.paymentDay)).ingresos - antesRecibo.ingresos).toBeCloseTo(317, 2);
      expect((await cashFlowDay(page, dias.operationDay)).ingresos - antesVenta.ingresos).toBeCloseTo(0, 2);
    } finally {
      await deleteMovement(page, 'ventas_eliminar', id);
    }
  });

  test('TEST 6 — compra CC histórica: la orden de pago egresa en su propia fecha', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);
    const dias = await historicalOperationDays(page);
    test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
    const lists = await getLists(page, 'compras');
    const medio = medioPago(lists);
    const provider = await createParty(page, 'provider', 'CC-FECHA-PROV');
    const product = await createProduct(page, 'CC-FECHA-CMP', { stock: 0, cost: 211, price: 300 });
    const antesCompra = await cashFlowDay(page, dias.operationDay);
    const antesOrden = await cashFlowDay(page, dias.paymentDay);
    let id = 0;
    try {
      id = movementId(expectApiSuccess(await createPurchase(page, {
        fecha: dias.operationDay, typeId: tipoVentaId(lists, 'CUENTA CORRIENTE'),
        providerId: provider.id, productId: product.id, amount: 211, medios: [],
      }), 'No se pudo crear la compra CC histórica'));
      expect((await cashFlowDay(page, dias.operationDay)).egresos - antesCompra.egresos).toBeCloseTo(0, 2);

      expectApiSuccess(await authenticatedApi(page, 'ordenes_pago_confirmar_pago', {
        method: 'POST',
        body: { ids_movimiento: [id], id_proveedor: provider.id, fecha: dias.paymentDay, medios_pago: [{ id_medio_pago: medio.id, monto: 211 }] },
      }), 'No se pudo registrar la orden de pago histórica');

      const { fechas } = await paymentDates(page, 'ordenes_pago_obtener', 'orden_pago', id);
      expect(fechas).toContain(dias.paymentDay);
      expect((await cashFlowDay(page, dias.paymentDay)).egresos - antesOrden.egresos).toBeCloseTo(211, 2);
    } finally {
      await deleteMovement(page, 'compras_eliminar', id);
    }
  });

  test('TEST 7 — presupuesto convertido a venta contado: el cobro usa la fecha de la conversión', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);
    const dias = await historicalOperationDays(page);
    test.skip(!dias, 'El saldo inicial más reciente no deja días históricos disponibles.');
    const lists = await getLists(page, 'ventas');
    const medio = medioPago(lists);
    const client = await createParty(page, 'client', 'PRESU-FECHA-CLI');
    const product = await createProduct(page, 'PRESU-FECHA', { stock: 3, cost: 40, price: 199 });
    const antes = await cashFlowDay(page, dias.paymentDay);
    let idPresupuesto = 0;
    let idVenta = 0;
    try {
      idPresupuesto = movementId(expectApiSuccess(await authenticatedApi(page, 'presupuestos_crear', {
        method: 'POST',
        body: {
          fecha: dias.operationDay, id_cliente: client.id,
          items: [{ id_stock_producto: product.id, descripcion: product.name, cantidad: 1, precio: 199, iva_pct: 0, total: 199 }],
        },
      }), 'No se pudo crear el presupuesto'));

      const conv = expectApiSuccess(await authenticatedApi(page, 'presupuestos_convertir_venta', {
        method: 'POST',
        body: {
          id_presupuesto: idPresupuesto, fecha: dias.paymentDay, id_tipo_venta: tipoVentaId(lists, 'CONTADO'),
          accion_venta: 'guardar', es_facturada: 0,
          medios_pago: [{ id_medio_pago: medio.id, monto: 199 }],
        },
      }), 'No se pudo convertir el presupuesto');
      idVenta = Number(conv?.id_venta || conv?.data?.id_venta || 0);
      expect(idVenta).toBeGreaterThan(0);

      const { mov, fechas } = await paymentDates(page, 'ventas_obtener', 'venta', idVenta);
      expect(String(mov.fecha).slice(0, 10), 'La venta usa la fecha de la conversión').toBe(dias.paymentDay);
      for (const f of fechas) expect(f, 'El cobro usa la fecha de la venta resultante').toBe(dias.paymentDay);
      expect((await cashFlowDay(page, dias.paymentDay)).ingresos - antes.ingresos).toBeCloseTo(199, 2);
    } finally {
      await deleteMovement(page, 'ventas_eliminar', idVenta);
      await deleteMovement(page, 'presupuestos_eliminar', idPresupuesto);
    }
  });

  test('TEST 12 — Flujo de Caja y la tesorería de Análisis Financiero coinciden al mismo corte', async ({ page }) => {
    const dias = await historicalOperationDays(page);
    const cortes = dias ? [dias.operationDay, dias.paymentDay, dias.today] : [new Date().toISOString().slice(0, 10)];
    for (const dia of cortes) {
      const caja = await cashFlowDay(page, dia);
      const af = await financialAnalysis(page, dia, dia);
      expect(Number(af?.tesoreria?.saldo_final || 0), `Saldo de cierre del ${dia}`).toBeCloseTo(caja.saldo, 2);
      const ingresosAf = Number(af?.tesoreria?.ingresos || 0);
      const egresosAf = Number(af?.tesoreria?.egresos || 0);
      expect(ingresosAf, `Ingresos del ${dia}`).toBeCloseTo(caja.ingresos, 2);
      expect(egresosAf, `Egresos del ${dia}`).toBeCloseTo(caja.egresos, 2);
    }
  });
});

// ===== 56-cheques-deposito-reversion-saldos.spec.js =====

// TEST 11 — Un cheque recibido es un documento, no dinero. Su depósito lo pasa a
// Banco; la reversión lo devuelve a cartera y un nuevo depósito lo vuelve a sumar
// UNA sola vez. Flujo de Caja y Análisis Financiero deben quedar iguales.

function bancoCard(day) {
  return day.medios.find((m) => String(m?.key || '') === 'banco') || null;
}

test('@cheques @flujo @regression depósito, reversión y nuevo depósito conservan saldos exactos', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const hoy = todayISO();
  const lists = await getLists(page, 'ventas');
  const medioCheque = medioPago(lists, 'cheque');
  const client = await createParty(page, 'client', 'CHQ-SALDOS-CLI');
  const product = await createProduct(page, 'CHQ-SALDOS', { stock: 3, cost: 100, price: 463 });
  const importe = 463;
  const numero = uniqueChequeNumber();

  const inicial = await cashFlowDay(page, hoy);
  test.skip(!bancoCard(inicial), 'La base no tiene un medio de pago Banco para acreditar depósitos.');
  const bancoInicial = Number(bancoCard(inicial).saldo || 0);

  const venta = expectApiSuccess(await createSale(page, {
    fecha: hoy, typeId: tipoVentaId(lists, 'CONTADO'), clientId: client.id, productId: product.id, amount: importe,
    medios: [{
      id_medio_pago: medioCheque.id, monto: importe, frontend_row_uid: uniqueName('CHQ-ROW', 40),
      cheque: { emisor: 'BANCO PRUEBA E2E', numero_cheque: numero, importe, fecha_emision: hoy, fecha_pago: hoy },
    }],
  }), 'No se pudo crear la venta con cheque');
  expect(movementId(venta)).toBeGreaterThan(0);
  const idCheque = Number(venta?.cheques_creados?.[0]?.id_cheque || venta?.data?.cheques_creados?.[0]?.id_cheque || 0);
  expect(idCheque, 'La venta debe crear el cheque en cartera').toBeGreaterThan(0);

  const conCheque = await cashFlowDay(page, hoy);
  expect(conCheque.saldo - inicial.saldo, 'Un cheque en cartera no es dinero disponible').toBeCloseTo(0, 2);

  const depositar = async () => expectApiSuccess(await authenticatedApi(page, 'cheques_cartera_depositar', {
    method: 'POST', body: { id_cheque: idCheque, fecha_deposito: hoy },
  }), 'No se pudo depositar el cheque');

  await depositar();
  let dia = await cashFlowDay(page, hoy);
  expect(dia.saldo - inicial.saldo, 'Depósito: el saldo sube una vez').toBeCloseTo(importe, 2);
  expect(Number(bancoCard(dia).saldo || 0) - bancoInicial, 'Depósito: Banco sube').toBeCloseTo(importe, 2);
  expect(dia.ingresos - inicial.ingresos, 'El depósito es transferencia interna, no ingreso comercial').toBeCloseTo(0, 2);

  expectApiSuccess(await authenticatedApi(page, 'cheques_deposito_revertir', {
    method: 'POST',
    body: { id_cheque: idCheque, fecha_reversion: hoy, motivo: 'Reversion de prueba E2E', confirmacion: true },
  }), 'No se pudo revertir el depósito');
  dia = await cashFlowDay(page, hoy);
  expect(dia.saldo - inicial.saldo, 'Reversión: el dinero vuelve a ser cheque en cartera').toBeCloseTo(0, 2);
  expect(Number(bancoCard(dia).saldo || 0) - bancoInicial).toBeCloseTo(0, 2);

  await depositar();
  dia = await cashFlowDay(page, hoy);
  expect(dia.saldo - inicial.saldo, 'Nuevo depósito: se suma una sola vez').toBeCloseTo(importe, 2);
  expect(Number(bancoCard(dia).saldo || 0) - bancoInicial).toBeCloseTo(importe, 2);

  const af = await financialAnalysis(page, hoy, hoy);
  expect(Number(af?.tesoreria?.saldo_final || 0), 'Análisis Financiero concilia con Flujo de Caja').toBeCloseTo(dia.saldo, 2);
});
