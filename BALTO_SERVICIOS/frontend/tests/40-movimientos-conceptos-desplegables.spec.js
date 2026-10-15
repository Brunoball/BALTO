import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './support/test.js';
import { todayISO, uniqueName } from './support/data.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';
import { expectApiSuccess } from './support/api.js';
import {
  createParty,
  deletePurchase,
  deleteSale,
  directAuthenticatedApi,
  extractMovementId,
  findAccountCurrentType,
  getLists,
  getPurchaseDetail,
  getSaleDetail,
} from './internal/support/internal-api.js';
import {
  getDetalleMovimiento,
  getItemsVisiblesMovimiento,
  getResumenItemsMovimiento,
} from '../src/components/Mov_Subsection/_shared/detalleMovimiento.js';

/**
 * Regresión del botón «Ver (N)» añadido a las tablas de Movimientos.
 * La UI es compartida por Compras, Ventas, Presupuestos, Recibos, OP,
 * Otros ingresos/egresos y la tabla global; no se deben duplicar cambios
 * en el código de producción para testearla.
 *
 * Todas las altas E2E llevan e2e_run=PW-... y la fixture global se encarga
 * de una segunda limpieza por worker aunque alguna aserción falle.
 */
function manualLine(description, quantity, price) {
  return {
    tipo_item: 'MANUAL',
    descripcion: description,
    cantidad: quantity,
    precio: price,
    iva_pct: 0,
    total: Number((quantity * price).toFixed(2)),
  };
}

async function createMovement(page, type, partyId, typeId, items) {
  const purchase = type === 'compra';
  const date = todayISO();
  const action = purchase ? 'compras_crear_batch' : 'ventas_crear_batch';
  const thirdPartyField = purchase ? 'id_proveedor' : 'id_cliente';
  const response = await directAuthenticatedApi(page, action, {
    method: 'POST',
    body: {
      fecha: date,
      id_tipo_venta: typeId,
      [thirdPartyField]: partyId,
      medios_pago: [],
      items: items.map((item) => ({
        ...item,
        fecha: date,
        id_tipo_venta: typeId,
        [thirdPartyField]: partyId,
      })),
    },
  });
  const body = expectApiSuccess(response, `No se pudo crear ${type} con ${items.length} conceptos`);
  const id = extractMovementId(body);
  expect(id, `La ${type} debe devolver un ID para verificarla y limpiarla`).toBeGreaterThan(0);
  return id;
}

/**
 * No se busca por la descripcion MANUAL: compras_listar?q no consulta
 * movimientos_items.descripcion en el backend actual. El cliente/proveedor
 * PW-* es unico por corrida y se encuentra en todos los listados.
 *
 * Validamos TAMBIEN el id_movimiento real devuelto por el endpoint, para
 * evitar falsos positivos cuando existen varias operaciones del mismo tercero.
 */
async function findOperationRow(page, route, searchPartyName, movementId, firstConcept) {
  const endpoints = {
    '/panel/compras': ['compras_listar', 'compras'],
    '/panel/ventas': ['ventas_listar', 'ventas'],
    '/panel/recibos': ['recibos_listar', 'movimientos'],
    '/panel/OrdenesPago': ['ordenes_pago_listar', 'movimientos'],
    '/panel/movimientos': ['movimientos_listar', 'movimientos'],
  };
  const [action, collection] = endpoints[route] || [];
  expect(action, `Ruta de movimientos desconocida: ${route}`).toBeTruthy();

  await page.goto(route);
  await waitForBusyToFinish(page);
  const search = page.getByPlaceholder(/Buscar por descripci.n/i).first();
  await expect(search).toBeVisible();

  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') return false;
    const url = new URL(response.url());
    return url.searchParams.get('action') === action && url.searchParams.get('q') === searchPartyName;
  }, { timeout: 45_000 });

  await search.fill(searchPartyName);
  await search.press('Enter');
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), `${action} debe responder exitosamente: ${JSON.stringify(body)}`).toBeLessThan(400);
  expect(body.exito, `${action} debe confirmar la consulta`).toBe(true);

  // Estos dos listados muestran deudas de movimientos, no comprobantes de cobro/pago.
  // El backend utiliza "movimientos" (y en OP admite "ordenes" como variante).
  const records = body[collection] ?? body.data?.[collection] ??
    (route === '/panel/OrdenesPago' ? (body.ordenes ?? body.data?.ordenes) : undefined);
  expect(Array.isArray(records), `${action} debe devolver el arreglo ${collection}`).toBe(true);
  const found = records.find((record) => Number(record?.id_movimiento ?? record?.id_movimiento_origen ?? 0) === movementId);
  expect(found, `${action} debe incluir el movimiento #${movementId} del tercero E2E ${searchPartyName}`).toBeTruthy();
  expect(
    getItemsVisiblesMovimiento(found).some((item) => item.nombre_visible.includes(firstConcept)),
    `El listado de ${route} debe incluir el concepto ${firstConcept} del movimiento exacto #${movementId}`,
  ).toBe(true);

  await waitForBusyToFinish(page);
  const visibleRows = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)');
  const byId = page.locator(`.mov-gridTable--row[data-movement-id="${movementId}"]`);
  // Compras, Recibos y OP tienen data-movement-id; Ventas y General no.
  // Para estos ultimos usamos el nombre PW-* que ya corroboramos en la API.
  const row = (await byId.count()) > 0
    ? byId.first()
    : visibleRows.filter({ hasText: firstConcept }).first();
  await expect(row, `La grilla ${route} debe mostrar el movimiento #${movementId}`).toBeVisible({ timeout: 30_000 });
  await expect(row.locator('.mov-detalleTabla__titulo')).toContainText(firstConcept);
  await expect(row, `La grilla ${route} debe mostrar al cliente/proveedor correcto`).toContainText(searchPartyName);
  return row;
}

async function assertTwoConceptsExpand(page, row, expected) {
  const button = row.locator('.mov-detalleTabla__boton');
  // En el frontend la fila desplegable se mantiene montada aun al cerrarse,
  // para poder animar con CSS grid 0fr -> 1fr. Es hermana inmediata de
  // esta operación; no hay que contar los paneles de otras operaciones.
  const panel = row.locator('xpath=following-sibling::*[1][contains(@class, "mov-detalleTabla__filaExpandida")]');
  const content = panel.locator('.mov-detalleTabla__recorte');
  const actionsBefore = await row.locator('.mov-iconBtn').count();
  const dialogsBefore = await page.getByRole('dialog').count();

  await expect(row.locator('.mov-detalleTabla__titulo')).toContainText('+ 1 MÁS');
  await expect(button).toBeVisible();
  await expect(button).toHaveText(/Ver\s*\(2\)/i);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toHaveAttribute('aria-label', 'Ver los 2 conceptos del movimiento');
  await expect(panel, 'La fila animable existe aun cuando esta cerrada').toHaveCount(1);
  await expect(panel, 'El panel debe comenzar accesiblemente cerrado').toHaveAttribute('aria-hidden', 'true');
  await expect(panel).not.toHaveClass(/\bis-open\b/);
  await expect(content, 'El contenido debe estar oculto por CSS al inicio').toBeHidden();

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(button).toContainText('Ocultar');
  await expect(panel).toHaveClass(/\bis-open\b/);
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(content).toBeVisible();
  await expect(panel.locator('.mov-detalleTabla__panelTitulo')).toHaveText(/conceptos del movimiento/i);
  await expect(panel.locator('.mov-detalleTabla__contador')).toHaveText('2 conceptos');
  await expect(panel.locator('.mov-detalleTabla__item')).toHaveCount(2);
  const controlledId = await button.getAttribute('aria-controls');
  expect(controlledId, 'El botón debe apuntar al panel que despliega').toBeTruthy();
  await expect(panel.locator('.mov-detalleTabla__panel')).toHaveAttribute('id', controlledId);

  for (const item of expected) {
    const matched = panel.locator('.mov-detalleTabla__item').filter({ hasText: item.description });
    await expect(matched, `Debe verse el concepto exacto ${item.description}`).toHaveCount(1);
    await expect(matched.locator('.mov-detalleTabla__aclaracion')).toContainText(String(item.quantity));
    await expect(matched.locator('.mov-detalleTabla__itemTotal')).toContainText(
      new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(item.quantity * item.price),
    );
  }

  expect(await row.locator('.mov-iconBtn').count(), 'Ver/Ocultar no debe sustituir acciones de la fila').toBe(actionsBefore);
  expect(await page.getByRole('dialog').count(), 'Ver no debe abrir un modal ni editar el movimiento').toBe(dialogsBefore);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toContainText('Ver (2)');
  await expect(panel).not.toHaveClass(/\bis-open\b/);
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await expect(content).toBeHidden();
}

test('@critical @movimientos @regression Compras, Ventas y Movimientos despliegan sus dos conceptos, cierran y respetan un concepto único', async ({ page }) => {
  test.setTimeout(9 * 60_000);
  await requireMutations(test, page);

  const provider = await createParty(page, 'provider', uniqueName('EXP-PROVEEDOR', 120));
  const client = await createParty(page, 'client', uniqueName('EXP-CLIENTE', 120));
  const typeId = findAccountCurrentType(await getLists(page, 'compras'));
  const purchaseItems = [
    manualLine(uniqueName('EXP-COMPRA-INSTALACION', 120), 2, 150),
    manualLine(uniqueName('EXP-COMPRA-TRASLADO', 120), 1, 75),
  ];
  const saleItems = [
    manualLine(uniqueName('EXP-VENTA-MANTENIMIENTO', 120), 3, 120),
    manualLine(uniqueName('EXP-VENTA-INSPECCION', 120), 1, 55),
  ];
  const singleItem = manualLine(uniqueName('EXP-VENTA-UNICA', 120), 1, 90);
  const ids = { purchase: 0, sale: 0, singleSale: 0 };

  try {
    ids.purchase = await createMovement(page, 'compra', provider.id, typeId, purchaseItems);
    ids.sale = await createMovement(page, 'venta', client.id, typeId, saleItems);
    ids.singleSale = await createMovement(page, 'venta', client.id, typeId, [singleItem]);

    const purchase = await getPurchaseDetail(page, ids.purchase);
    const sale = await getSaleDetail(page, ids.sale);
    const single = await getSaleDetail(page, ids.singleSale);
    for (const [label, movement, count] of [
      ['compra', purchase, 2], ['venta', sale, 2], ['venta única', single, 1],
    ]) {
      expect(
        getItemsVisiblesMovimiento(movement),
        `Persistencia: ${label} debe contener ${count} conceptos comerciales visibles`,
      ).toHaveLength(count);
    }

    const purchaseRow = await findOperationRow(page, '/panel/compras', provider.name, ids.purchase, purchaseItems[0].descripcion);
    await assertTwoConceptsExpand(page, purchaseRow, purchaseItems.map((item) => ({
      description: item.descripcion, quantity: item.cantidad, price: item.precio,
    })));

    const saleRow = await findOperationRow(page, '/panel/ventas', client.name, ids.sale, saleItems[0].descripcion);
    await assertTwoConceptsExpand(page, saleRow, saleItems.map((item) => ({
      description: item.descripcion, quantity: item.cantidad, price: item.precio,
    })));

    // La deuda de la venta/compra conserva los mismos conceptos en Cobros y Pagos.
    const receiptRow = await findOperationRow(page, '/panel/recibos', client.name, ids.sale, saleItems[0].descripcion);
    await assertTwoConceptsExpand(page, receiptRow, saleItems.map((item) => ({
      description: item.descripcion, quantity: item.cantidad, price: item.precio,
    })));
    const payableRow = await findOperationRow(page, '/panel/OrdenesPago', provider.name, ids.purchase, purchaseItems[0].descripcion);
    await assertTwoConceptsExpand(page, payableRow, purchaseItems.map((item) => ({
      description: item.descripcion, quantity: item.cantidad, price: item.precio,
    })));

    // Un ítem no muestra Ver (1) ni crea una fila adicional.
    const singleRow = await findOperationRow(page, '/panel/ventas', client.name, ids.singleSale, singleItem.descripcion);
    await expect(singleRow.locator('.mov-detalleTabla__titulo')).toContainText(singleItem.descripcion);
    await expect(singleRow.locator('.mov-detalleTabla__boton')).toHaveCount(0);
    // Puede haber otras ventas con 2+ conceptos en este listado: no hay que
    // exigir cero paneles globales. Esta venta de un solo item no genera uno.
    await expect(singleRow.locator('xpath=following-sibling::*[1][contains(@class, "mov-detalleTabla__filaExpandida")]')).toHaveCount(0);

    // La misma venta debe poder desplegarse en el listado GENERAL, no sólo en Ventas.
    const globalSale = await findOperationRow(page, '/panel/movimientos', client.name, ids.sale, saleItems[0].descripcion);
    await assertTwoConceptsExpand(page, globalSale, saleItems.map((item) => ({
      description: item.descripcion, quantity: item.cantidad, price: item.precio,
    })));

    const globalPurchase = await findOperationRow(page, '/panel/movimientos', provider.name, ids.purchase, purchaseItems[0].descripcion);
    await assertTwoConceptsExpand(page, globalPurchase, purchaseItems.map((item) => ({
      description: item.descripcion, quantity: item.cantidad, price: item.precio,
    })));
  } finally {
    // Limpieza temprana, complementada siempre por el cleanup E2E por worker.
    if (ids.singleSale) await deleteSale(page, ids.singleSale).catch(() => null);
    if (ids.sale) await deleteSale(page, ids.sale).catch(() => null);
    if (ids.purchase) await deletePurchase(page, ids.purchase).catch(() => null);
  }
});

test('@smoke @movimientos conceptos: la receta interna no infla Ver (N), y una fila única no se despliega', async () => {
  const movement = {
    items_detalle: [
      { tipo_item_db: 'SERVICIO', servicio_nombre: 'REPARACIÓN DE BOMBA', cantidad: 1, precio: 500, total: 500 },
      { tipo_item_db: 'CONSUMO_ARTICULO', articulo_nombre: 'TORNILLO INTERNO', cantidad: 3, precio: 10, total: 30 },
      { tipo_item_db: 'MANUAL', descripcion: 'TRASLADO', cantidad: 2, precio: 75, total: 150 },
    ],
  };

  const visible = getItemsVisiblesMovimiento(movement);
  expect(visible.map((item) => item.nombre_visible)).toEqual(['REPARACIÓN DE BOMBA', 'TRASLADO']);
  expect(getResumenItemsMovimiento(movement)).toBe('1 SERVICIO / 1 DETALLE');
  expect(getDetalleMovimiento(movement)).not.toContain('TORNILLO INTERNO');
  expect(getItemsVisiblesMovimiento({ items_detalle: [movement.items_detalle[0]] })).toHaveLength(1);
  expect(getItemsVisiblesMovimiento({ items_detalle: [movement.items_detalle[1]] })).toHaveLength(0);
  expect(getItemsVisiblesMovimiento({})).toHaveLength(0);
});


test('@smoke @movimientos las ocho tablas mantienen conectado el desplegable compartido', async () => {
  // Contrato estructural: detecta pantallas que vuelvan al resumen sin botón.
  // No reemplaza las comprobaciones E2E de apertura y cierre con operaciones reales.
  const screens = [
    'Movimientos/Movimientos.jsx',
    'Mov_Subsection/Compra/Compras.jsx',
    'Mov_Subsection/Ventas/Ventas.jsx',
    'Mov_Subsection/Documentos_Comerciales/Presupuestos.jsx',
    'Mov_Subsection/Recibos/Recibos.jsx',
    'Mov_Subsection/OrdenesPago/OrdenesPago.jsx',
    'Mov_Subsection/Otros_Ingresos/Otros_Ingresos.jsx',
    'Mov_Subsection/Otros_Egresos/Otros_Egresos.jsx',
  ];

  for (const file of screens) {
    const source = readFileSync(path.resolve(process.cwd(), 'src', 'components', file), 'utf8');
    expect(source, `${file}: debe envolver cada registro con el estado expandible`)
      .toMatch(/<FilaMovimientoExpandible\b/);
    expect(source, `${file}: debe renderizar el resumen y botón en su tabla`)
      .toMatch(/<DetalleMovimientoTabla\b/);
  }
});
