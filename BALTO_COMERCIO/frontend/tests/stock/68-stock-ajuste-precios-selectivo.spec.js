import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { uniqueName, uniqueSku, RUN_PREFIX } from '../support/data.js';
import { createStockProductFixture } from '../support/stock-fixtures.js';
import { getStockE2EFixtureUnit, getStockProductBySku } from '../support/stock-units.js';
import { openStockPanelWithSessionRecovery } from '../support/flows.js';
import { requireMutations, waitDialog } from '../support/ui.js';

/**
 * BALTO Comercio · Stock → modal "Ajuste de precios" (ajuste selectivo).
 *
 * Reclamo de producción (26/11/2026): con un porcentaje o importe cargado y sólo
 * algunos productos marcados, la tabla mostraba aumento y precio final también en
 * los productos DESMARCADOS. El usuario interpretaba que se iba a modificar todo
 * el catálogo. Además el selector "Tipo de precio" tardaba en habilitarse porque
 * esperaba al historial y se recargaba al fijar el tipo predeterminado.
 *
 * - "@mock": interfaz con respuestas SIMULADAS (page.route) de tipos, opciones,
 *   historial y guardado. No escriben datos. Cubren carreras, cargas lentas,
 *   errores del historial, doble clic y bloqueo del guardado.
 * - "@mutations": integración REAL en el tenant E2E (requireMutations). Crean
 *   productos PW-*, guardan ajustes desde la interfaz y verifican por API la
 *   persistencia, los precios intactos, el historial y la ausencia de jobs de
 *   Tienda Nube. Pasar con mocks NO alcanza: la integración confirma la persistencia.
 */

const amount = (v) => Number(v || 0);
const cents = (v) => Math.round(amount(v) * 100);

function moneyText(value) {
  // "$1.050,00" -> 1050 · "$-100,50" -> -100.5 · "—" -> null
  const raw = String(value || '').replace(/[^\d,.-]/g, '');
  if (!raw || raw === '-') return null;
  return Number(raw.replace(/\./g, '').replace(',', '.'));
}

function payloadOf(body) {
  return body?.data && typeof body.data === 'object' ? { ...body.data, ...body } : body || {};
}

function actionOf(request) {
  try {
    return new URL(request.url()).searchParams.get('action') || '';
  } catch {
    return '';
  }
}

function assertNoTiendaNubeJobs(sync, context) {
  if (!sync || typeof sync !== 'object') return;
  expect(Number(sync.encolados || 0), `${context}: el tenant E2E aislado no debe encolar Tienda Nube`).toBe(0);
  expect(Number(sync.pendientes || 0), `${context}: no debe dejar jobs TN pendientes`).toBe(0);
}

const row = (scope, key) => scope.locator(`[data-testid="ap-row"][data-target-key="${key}"]`);
const cell = (scope, key, id) => row(scope, key).getByTestId(id);

async function abrirAjustePrecios(page) {
  await openStockPanelWithSessionRecovery(page);
  await page.getByRole('button', { name: 'Ajustar precios' }).first().click();
  return waitDialog(page, 'Ajuste de precios');
}

/** Barrera manual para controlar el orden de respuestas sin timeouts. */
function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

async function flushRender(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/* ------------------------------------------------------------------------- */
/* @mock                                                                      */
/* ------------------------------------------------------------------------- */

const MOCK_TIPOS = [
  { id_tipo_precio_stock: 9001, nombre: 'PW MOCK COSTO', activo: 1 },
  { id_tipo_precio_stock: 9002, nombre: 'PW MOCK VENTA', activo: 1 },
  { id_tipo_precio_stock: 9003, nombre: 'PW MOCK MAYORISTA', activo: 1 },
];

function mockOpciones(idTipo) {
  // Un ID real (de ListasContext, antes de revalidar) usa otro factor: "$500,00"
  // en ALFA sólo puede venir del tipo simulado 9001.
  const factor = idTipo === 9002 ? 1 : idTipo === 9003 ? 0.8 : idTipo === 9001 ? 0.5 : 0.25;
  const m = (v) => Math.round(v * factor * 100) / 100;
  const base = (id, nombre, precio, extra = {}) => ({
    id_stock_producto: id, id_stock_variante: null, producto_nombre: nombre, producto_sku: `PWMOCK${id}`,
    tiene_variantes: 0, precio_actual: m(precio), precio_faltante: 0, precio_heredado: 0,
    id_tipo_precio_stock: idTipo, ...extra,
  });
  return [
    base(990001, 'PW MOCK ALFA', 1000),
    base(990002, 'PW MOCK BETA', 2500.5),
    base(990003, 'PW MOCK GAMMA', 333.33),
    base(990004, 'PW MOCK DELTA', 500, { tiene_variantes: 1 }),
    { ...base(990004, 'PW MOCK DELTA', 600, { tiene_variantes: 1 }), id_stock_variante: 99041, variante_nombre: 'ROJO', variante_sku: 'PWMOCK41' },
    { ...base(990004, 'PW MOCK DELTA', 500, { tiene_variantes: 1 }), id_stock_variante: 99042, variante_nombre: 'AZUL', variante_sku: 'PWMOCK42', precio_heredado: 1 },
  ];
}

/**
 * Simula el backend del modal. Nunca deja pasar `stock_precios_ajuste_crear`
 * al servidor real: las pruebas @mock no escriben en el tenant.
 */
async function simularAjustePrecios(page, opts = {}) {
  const state = { log: [], posts: [], gates: opts.gates || {} };
  await page.route('**/api.php?*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.searchParams.get('action');
    const tipo = Number(url.searchParams.get('id_tipo_precio_stock') || 0);
    const fulfill = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (action === 'stock_tipos_precio_listar') {
      state.log.push({ action, session: request.headers()['x-session'] || '' });
      if (state.gates.tipos) await state.gates.tipos.promise;
      return fulfill({ exito: true, tipos_precio: MOCK_TIPOS, stock_tipos_precio: MOCK_TIPOS });
    }
    if (action === 'stock_precios_ajustes_historial') {
      state.log.push({ action });
      if (state.gates.historial) await state.gates.historial.promise;
      if (opts.historialError) return fulfill({ exito: false, mensaje: 'Historial no disponible (simulado)' }, 500);
      return fulfill({ exito: true, ajustes: [{ id_ajuste_precio: 424242, tipo_precio_nombre: 'PW MOCK VENTA', created_at: '2026-11-26 09:00:00', total_items: 2, tipo_ajuste: 'porcentaje', valor_ajuste: 5, diferencia_total: 175.03 }] });
    }
    if (action === 'stock_precios_ajuste_opciones') {
      state.log.push({ action, tipo });
      const g = state.gates[`opciones_${tipo}`];
      if (g) await g.promise;
      const tipoRow = MOCK_TIPOS.find((t) => t.id_tipo_precio_stock === tipo) || { id_tipo_precio_stock: tipo, nombre: 'REAL' };
      return fulfill({ exito: true, tipo_precio: tipoRow, id_tipo_precio_stock: tipo, opciones: mockOpciones(tipo) });
    }
    if (action === 'stock_precios_ajuste_crear') {
      let body = {};
      try { body = request.postDataJSON() || {}; } catch { body = {}; }
      state.posts.push(body);
      return fulfill({ exito: true, id_ajuste_precio: 424243, total_items: (body.items || []).length, tiendanube_sync: { total_productos: 0, encolados: 0 } });
    }
    await route.continue();
  });
  return state;
}

async function esperarTiposMock(dialog) {
  const select = dialog.getByTestId('ap-tipo-precio');
  await expect(select.locator('option')).toHaveText(MOCK_TIPOS.map((t) => t.nombre));
  await expect(select).toHaveValue(/^900[123]$/);
  return select;
}

test.describe('@stock @pricing @mock ajuste de precios: vista previa selectiva y carga del selector', () => {
  test('sólo las filas seleccionadas muestran ajuste; resumen y payload exactos', async ({ page }) => {
    const sim = await simularAjustePrecios(page);
    const dialog = await abrirAjustePrecios(page);
    const select = await esperarTiposMock(dialog);
    await select.selectOption('9002');
    await expect(cell(dialog, '990003:base', 'ap-row-actual')).toHaveText('$333,33');

    await dialog.getByTestId('ap-valor-ajuste').fill('5');
    await row(dialog, '990001:base').locator('input[type="checkbox"]').check();
    await row(dialog, '990002:base').locator('input[type="checkbox"]').check();

    await expect(cell(dialog, '990001:base', 'ap-row-ajuste')).toHaveText('+$50,00');
    await expect(cell(dialog, '990001:base', 'ap-row-final')).toHaveText('$1.050,00');
    await expect(cell(dialog, '990002:base', 'ap-row-ajuste')).toHaveText('+$125,03');
    await expect(cell(dialog, '990002:base', 'ap-row-final')).toHaveText('$2.625,53');
    // El tercero NO está seleccionado: sin ajuste y con su precio actual como final.
    await expect(cell(dialog, '990003:base', 'ap-row-ajuste')).toHaveText('—');
    await expect(cell(dialog, '990003:base', 'ap-row-final')).toHaveText('$333,33');
    await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('2');
    await expect(dialog.getByTestId('ap-resumen-anterior')).toHaveText('$3.500,50');
    await expect(dialog.getByTestId('ap-resumen-nuevo')).toHaveText('$3.675,53');
    await expect(dialog.getByTestId('ap-resumen-diferencia')).toHaveText('+$175,03');

    // Desmarcar quita el ajuste en el acto; volver a marcar lo recalcula.
    await row(dialog, '990002:base').locator('input[type="checkbox"]').uncheck();
    await expect(cell(dialog, '990002:base', 'ap-row-ajuste')).toHaveText('—');
    await expect(cell(dialog, '990002:base', 'ap-row-final')).toHaveText('$2.500,50');
    await expect(dialog.getByTestId('ap-resumen-diferencia')).toHaveText('+$50,00');
    await row(dialog, '990002:base').locator('input[type="checkbox"]').check();
    await expect(cell(dialog, '990002:base', 'ap-row-ajuste')).toHaveText('+$125,03');

    await dialog.getByTestId('ap-guardar').click();
    await expect.poll(() => sim.posts.length).toBe(1);
    expect(sim.posts[0].id_tipo_precio_stock).toBe(9002);
    expect(sim.posts[0].tipo_ajuste).toBe('porcentaje');
    expect(sim.posts[0].valor_ajuste).toBe('5.0000');
    expect(sim.posts[0].items).toEqual([
      { id_stock_producto: 990001, id_stock_variante: null },
      { id_stock_producto: 990002, id_stock_variante: null },
    ]);
  });

  test('buscar no pierde selección; Seleccionar visibles respeta filtro y herencia; Limpiar quita ajustes', async ({ page }) => {
    await simularAjustePrecios(page);
    const dialog = await abrirAjustePrecios(page);
    const select = await esperarTiposMock(dialog);
    await select.selectOption('9002');
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$1.000,00');
    await dialog.getByTestId('ap-valor-ajuste').fill('5');
    await row(dialog, '990001:base').locator('input[type="checkbox"]').check();

    await dialog.getByTestId('ap-buscar').fill('DELTA');
    await expect(row(dialog, '990001:base')).toHaveCount(0);
    await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('1');
    await expect(dialog.getByTestId('ap-seleccion-oculta')).toContainText('1 seleccionado fuera del filtro');

    await dialog.getByRole('button', { name: /Seleccionar visibles/ }).click();
    // Base DELTA + variante ROJO (precio propio). AZUL hereda: no es elegible.
    await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('3');
    await expect(row(dialog, '990004:99042')).toHaveAttribute('data-selected', 'false');
    await expect(cell(dialog, '990004:99042', 'ap-row-ajuste')).toHaveText('—');
    await expect(cell(dialog, '990004:99042', 'ap-row-final')).toHaveText('$500,00');
    await expect(row(dialog, '990004:99042').getByTestId('ap-row-heredado')).toContainText('pasará a $525,00');
    await expect(dialog.getByTestId('ap-aviso-heredados')).toContainText('1 variante hereda el precio base');

    await dialog.getByTestId('ap-buscar').fill('');
    await expect(row(dialog, '990001:base')).toHaveAttribute('data-selected', 'true');

    await dialog.getByRole('button', { name: 'Limpiar' }).click();
    await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('0');
    await expect(dialog.getByTestId('ap-row-ajuste')).toHaveText(Array(6).fill('—'));
    await expect(dialog.getByTestId('ap-aviso-heredados')).toHaveCount(0);
    await expect(dialog.getByTestId('ap-guardar')).toBeDisabled();
  });

  test('cambiar de tipo limpia la selección y no vuelve a pedir tipos ni historial', async ({ page }) => {
    const sim = await simularAjustePrecios(page);
    const dialog = await abrirAjustePrecios(page);
    const select = await esperarTiposMock(dialog);
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$500,00'); // 9001 (costo)
    await row(dialog, '990001:base').locator('input[type="checkbox"]').check();
    await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('1');

    const tiposAntes = sim.log.filter((l) => l.action === 'stock_tipos_precio_listar').length;
    await select.selectOption('9002');
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$1.000,00');
    await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('0');
    await expect(row(dialog, '990001:base')).toHaveAttribute('data-selected', 'false');

    expect(sim.log.filter((l) => l.action === 'stock_tipos_precio_listar').length).toBe(tiposAntes);
    expect(sim.log.filter((l) => l.action === 'stock_precios_ajustes_historial')).toHaveLength(0);
    expect(sim.log.filter((l) => l.action === 'stock_precios_ajuste_opciones' && l.tipo === 9002)).toHaveLength(1);
  });

  test('A→B→C con respuestas en orden inverso: sólo se muestran las opciones de C', async ({ page }) => {
    const gates = { opciones_9002: gate() };
    await simularAjustePrecios(page, { gates });
    const dialog = await abrirAjustePrecios(page);
    const select = await esperarTiposMock(dialog);
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$500,00'); // A = 9001

    const respuestaB = page.waitForResponse((r) => actionOf(r.request()) === 'stock_precios_ajuste_opciones'
      && new URL(r.url()).searchParams.get('id_tipo_precio_stock') === '9002');
    await select.selectOption('9002'); // B queda retenida
    await expect(dialog.getByTestId('ap-guardar')).toBeDisabled();
    await select.selectOption('9003'); // C responde primero
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$800,00');

    gates.opciones_9002.open(); // B llega tarde
    await respuestaB;
    await flushRender(page);
    await expect(select).toHaveValue('9003');
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$800,00');
    await expect(cell(dialog, '990002:base', 'ap-row-actual')).toHaveText('$2.000,40');
  });

  test('no se puede guardar mientras se cargan las opciones del tipo elegido', async ({ page }) => {
    const gates = { opciones_9002: gate() };
    const sim = await simularAjustePrecios(page, { gates });
    const dialog = await abrirAjustePrecios(page);
    const select = await esperarTiposMock(dialog);
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$500,00');
    await dialog.getByTestId('ap-valor-ajuste').fill('5');
    await row(dialog, '990001:base').locator('input[type="checkbox"]').check();
    await expect(dialog.getByTestId('ap-guardar')).toBeEnabled();

    await select.selectOption('9002');
    await expect(dialog.getByTestId('ap-tabla-estado')).toContainText('Cargando productos');
    await expect(dialog.getByTestId('ap-guardar')).toBeDisabled();
    gates.opciones_9002.open();
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$1.000,00');
    await expect(dialog.getByTestId('ap-guardar')).toBeDisabled(); // la selección anterior se limpió
    expect(sim.posts).toHaveLength(0);
  });

  test('historial lento: tipos y ajustes disponibles sin esperarlo; se carga al entrar a su pestaña', async ({ page }) => {
    const gates = { historial: gate() };
    const sim = await simularAjustePrecios(page, { gates });
    const dialog = await abrirAjustePrecios(page);
    const select = await esperarTiposMock(dialog);
    await expect(select).toBeEnabled();
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$500,00');
    expect(sim.log.filter((l) => l.action === 'stock_precios_ajustes_historial')).toHaveLength(0);

    await dialog.getByRole('tab', { name: /Historial/ }).click();
    await expect(dialog.getByTestId('ap-historial')).toContainText('Cargando historial');
    gates.historial.open();
    await expect(dialog.getByTestId('ap-historial')).toContainText('#424242');
  });

  test('historial con error: se informa en su pestaña y el ajuste sigue funcionando', async ({ page }) => {
    const sim = await simularAjustePrecios(page, { historialError: true });
    const dialog = await abrirAjustePrecios(page);
    await esperarTiposMock(dialog);
    await dialog.getByRole('tab', { name: /Historial/ }).click();
    await expect(dialog.getByTestId('ap-historial-error')).toContainText('Historial no disponible');
    await dialog.getByRole('tab', { name: /Ajustes/ }).click();
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$500,00');
    await dialog.getByTestId('ap-valor-ajuste').fill('10');
    await row(dialog, '990001:base').locator('input[type="checkbox"]').check();
    await dialog.getByTestId('ap-guardar').click();
    await expect.poll(() => sim.posts.length).toBe(1);
    expect(sim.posts[0].items).toEqual([{ id_stock_producto: 990001, id_stock_variante: null }]);
  });

  test('listas: el modal revalida los tipos en cada apertura, usa la sesión actual y nunca guarda un tipo obsoleto', async ({ page }) => {
    const gates = { tipos: gate() };
    const sim = await simularAjustePrecios(page, { gates });
    const dialog = await abrirAjustePrecios(page);
    // Mientras se revalida, el selector puede mostrar los tipos de ListasContext (misma sesión).
    gates.tipos.open();
    const select = await esperarTiposMock(dialog);
    await expect(select).toHaveValue(/^900[123]$/);
    const sessionKey = await page.evaluate(() => localStorage.getItem('session_key') || '');
    const pedidos = sim.log.filter((l) => l.action === 'stock_tipos_precio_listar');
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.every((l) => l.session === sessionKey), 'las lecturas usan la X-Session vigente').toBe(true);

    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$500,00');
    await dialog.getByTestId('ap-valor-ajuste').fill('1');
    await row(dialog, '990001:base').locator('input[type="checkbox"]').check();
    await dialog.getByTestId('ap-guardar').click();
    await expect.poll(() => sim.posts.length).toBe(1);
    expect(MOCK_TIPOS.map((t) => t.id_tipo_precio_stock)).toContain(sim.posts[0].id_tipo_precio_stock);

    // Segunda apertura: vuelve a pedir tipos (sin caché persistente entre aperturas).
    const antes = sim.log.filter((l) => l.action === 'stock_tipos_precio_listar').length;
    await page.getByRole('button', { name: 'Ajustar precios' }).first().click();
    const dialog2 = await waitDialog(page, 'Ajuste de precios');
    await esperarTiposMock(dialog2);
    expect(sim.log.filter((l) => l.action === 'stock_tipos_precio_listar').length).toBeGreaterThan(antes);
  });

  test('doble activación de Guardar, cancelar y selección vacía no generan escrituras duplicadas', async ({ page }) => {
    const sim = await simularAjustePrecios(page);
    let dialog = await abrirAjustePrecios(page);
    await esperarTiposMock(dialog);
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$500,00');
    await dialog.getByTestId('ap-valor-ajuste').fill('5');
    await expect(dialog.getByTestId('ap-guardar'), 'sin selección no se puede guardar').toBeDisabled();

    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
    expect(sim.posts).toHaveLength(0);

    dialog = await abrirAjustePrecios(page);
    await esperarTiposMock(dialog);
    await expect(cell(dialog, '990001:base', 'ap-row-actual')).toHaveText('$500,00');
    await dialog.getByTestId('ap-valor-ajuste').fill('5');
    await row(dialog, '990001:base').locator('input[type="checkbox"]').check();
    // Dos clicks en el mismo ciclo de eventos (antes de que React vuelva a renderizar).
    const crear = page.waitForResponse((r) => actionOf(r.request()) === 'stock_precios_ajuste_crear');
    await dialog.getByTestId('ap-guardar').evaluate((button) => { button.click(); button.click(); });
    await crear;
    await expect(dialog).toBeHidden();
    expect(sim.posts).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------- */
/* @mutations                                                                 */
/* ------------------------------------------------------------------------- */

async function preciosDe(page, idProducto, idVariante = null) {
  const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_obtener', {
    query: { id_stock_producto: idProducto, ...(idVariante ? { id_stock_variante: idVariante } : {}), _: Date.now() },
  }), 'No se pudieron consultar los precios');
  return payloadOf(body).precios || [];
}

const precioTipo = (precios, idTipo) => precios.find((p) => Number(p.id_tipo_precio_stock) === Number(idTipo)) || null;
const firmaOtrosTipos = (precios, idTipo) => precios
  .filter((p) => Number(p.id_tipo_precio_stock) !== Number(idTipo))
  .map((p) => `${p.id_tipo_precio_stock}:${cents(p.monto)}`)
  .sort();

/** Cantidad de registros de historial de precios de los productos (no depende de otros workers). */
async function historialDe(page, idsProductos) {
  let total = 0;
  for (const id of idsProductos) {
    const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_historial_producto', {
      query: { id_stock_producto: id, limit: 500, _: Date.now() },
    }), 'No se pudo leer el historial de precios del producto');
    total += (payloadOf(body).items || []).length;
  }
  return total;
}

async function detalleAjuste(page, idAjuste) {
  const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_ajuste_obtener', {
    query: { id_ajuste_precio: idAjuste, _: Date.now() },
  }), 'No se pudo leer el detalle del ajuste');
  return payloadOf(body);
}

async function prepararModal(page, { tipoId, tag, esperar }) {
  const dialog = await abrirAjustePrecios(page);
  const select = dialog.getByTestId('ap-tipo-precio');
  await expect(select.locator(`option[value="${tipoId}"]`)).toHaveCount(1);
  await select.selectOption(String(tipoId));
  await dialog.getByTestId('ap-buscar').fill(tag);
  for (const [key, texto] of esperar) {
    await expect(cell(dialog, key, 'ap-row-actual')).toHaveText(texto);
  }
  return dialog;
}

/** Guarda desde la interfaz y devuelve { payload, data } del POST real. */
async function guardarDesdeUI(page, dialog, writes) {
  const reqPromise = page.waitForRequest((r) => r.method() === 'POST' && actionOf(r) === 'stock_precios_ajuste_crear');
  const resPromise = page.waitForResponse((r) => r.request().method() === 'POST' && actionOf(r.request()) === 'stock_precios_ajuste_crear', { timeout: 120_000 });
  const before = writes.length;
  await dialog.getByTestId('ap-guardar').evaluate((button) => { button.click(); button.click(); });
  const request = await reqPromise;
  const response = await resPromise;
  expect(response.status(), await response.text()).toBeLessThan(400);
  const data = payloadOf(await response.json());
  expect(data.exito !== false).toBe(true);
  expect(writes.length - before, 'un único POST por guardado (doble activación incluida)').toBe(1);
  await expect(dialog).toBeHidden();
  return { payload: request.postDataJSON(), data };
}

test.describe('@stock @pricing @mutations @critical ajuste selectivo real en el tenant E2E', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(10 * 60_000);

  test('persistencia: sólo cambian las filas seleccionadas, en todos los modos, con variantes', async ({ page }) => {
    await requireMutations(test, page);

    const writes = [];
    const tnRequests = [];
    page.on('request', (r) => {
      const action = actionOf(r);
      if (r.method() === 'POST' && action === 'stock_precios_ajuste_crear') writes.push(r);
      if (/^stock_tiendanube_jobs_/.test(action)) tnRequests.push(action);
    });

    const token = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const tag = uniqueName(`AJSEL-${token}`, 60);
    // uniqueSku recorta a 32 caracteres: el token y la letra se agregan al final.
    const skuDe = (suffix) => `${uniqueSku('AJ')}${token}${suffix}`.slice(-24);
    const fixtures = [
      { k: 'A', price: 1000 },
      { k: 'B', price: 2500.5 },
      { k: 'C', price: 333.33 },
      { k: 'D', price: 500 },
    ].map((f) => ({ ...f, name: `${tag}-${f.k}`.slice(0, 70), sku: skuDe(f.k) }));

    const ids = {};
    try {
      for (const f of fixtures) {
        await createStockProductFixture(page, { name: f.name, sku: f.sku, stock: 3, cost: 100, price: f.price });
        ids[f.k] = Number((await getStockProductBySku(page, f.sku)).id_stock_producto);
        expect(ids[f.k]).toBeGreaterThan(0);
      }

      const typesBody = expectApiSuccess(await authenticatedApi(page, 'stock_tipos_precio_listar', { query: { _: Date.now() } }));
      const types = payloadOf(typesBody).tipos_precio || [];
      const sale = types.find((t) => /VENTA/i.test(String(t?.nombre || '')));
      expect(sale, 'Debe existir PRECIO DE VENTA').toBeTruthy();
      const saleId = Number(sale.id_tipo_precio_stock);

      // Variantes de D: V1 con precio propio, V2 hereda el precio base.
      const unit = await getStockE2EFixtureUnit(page);
      const variantes = {};
      for (const nombre of ['V1', 'V2']) {
        const res = expectApiSuccess(await authenticatedApi(page, 'stock_variante_crear', {
          method: 'POST',
          body: {
            id_stock_producto: ids.D, nombre_variante: `${tag}-${nombre}`.slice(0, 70), sku: skuDe(`D${nombre}`),
            stock: 2, id_stock_unidad: Number(unit.id_stock_unidad), atributos: [], categorias: [], precios: [],
          },
        }), `No se pudo crear la variante ${nombre}`);
        const data = payloadOf(res);
        variantes[nombre] = Number(data.id_stock_variante || data.variante?.id_stock_variante || 0);
        expect(variantes[nombre]).toBeGreaterThan(0);
        assertNoTiendaNubeJobs(data.tiendanube_sync, `Alta variante ${nombre}`);
      }
      expectApiSuccess(await authenticatedApi(page, 'stock_precio_guardar', {
        method: 'POST',
        body: { id_stock_producto: ids.D, id_stock_variante: variantes.V1, precios: [{ id_tipo_precio_stock: saleId, monto: 777.77 }] },
      }), 'No se pudo asignar precio propio a V1');

      const keyA = `${ids.A}:base`; const keyB = `${ids.B}:base`; const keyC = `${ids.C}:base`; const keyD = `${ids.D}:base`;
      const keyV1 = `${ids.D}:${variantes.V1}`; const keyV2 = `${ids.D}:${variantes.V2}`;

      const snapshot = {};
      for (const k of ['A', 'B', 'C', 'D']) snapshot[k] = await preciosDe(page, ids[k]);
      const stockAntes = {};
      for (const f of fixtures) stockAntes[f.k] = Number((await getStockProductBySku(page, f.sku)).stock || 0);

      await test.step('5% a A y B: C sin ajuste, desmarcar/remarcar, resumen y payload exactos', async () => {
        const dialog = await prepararModal(page, {
          tipoId: saleId, tag,
          esperar: [[keyA, '$1.000,00'], [keyB, '$2.500,50'], [keyC, '$333,33']],
        });
        await dialog.getByTestId('ap-valor-ajuste').fill('5');
        await dialog.getByTestId('ap-observacion').fill(`${RUN_PREFIX} AJUSTE SELECTIVO 5%`);
        await row(dialog, keyA).locator('input[type="checkbox"]').check();
        await row(dialog, keyB).locator('input[type="checkbox"]').check();
        await expect(cell(dialog, keyC, 'ap-row-ajuste')).toHaveText('—');
        await expect(cell(dialog, keyC, 'ap-row-final')).toHaveText('$333,33');
        await row(dialog, keyB).locator('input[type="checkbox"]').uncheck();
        await expect(cell(dialog, keyB, 'ap-row-ajuste')).toHaveText('—');
        await row(dialog, keyB).locator('input[type="checkbox"]').check();
        await expect(cell(dialog, keyA, 'ap-row-final')).toHaveText('$1.050,00');
        await expect(cell(dialog, keyB, 'ap-row-final')).toHaveText('$2.625,53');
        await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('2');
        await expect(dialog.getByTestId('ap-resumen-anterior')).toHaveText('$3.500,50');
        await expect(dialog.getByTestId('ap-resumen-nuevo')).toHaveText('$3.675,53');
        await expect(dialog.getByTestId('ap-resumen-diferencia')).toHaveText('+$175,03');

        const { payload, data } = await guardarDesdeUI(page, dialog, writes);
        expect(payload.items).toEqual([
          { id_stock_producto: ids.A, id_stock_variante: null },
          { id_stock_producto: ids.B, id_stock_variante: null },
        ]);
        expect(Number(data.total_items)).toBe(2);
        assertNoTiendaNubeJobs(data.tiendanube_sync, 'Ajuste selectivo 5%');

        const pa = await preciosDe(page, ids.A); const pb = await preciosDe(page, ids.B); const pc = await preciosDe(page, ids.C);
        expect(cents(precioTipo(pa, saleId).monto)).toBe(105000);
        expect(cents(precioTipo(pb, saleId).monto)).toBe(262553);
        expect(cents(precioTipo(pc, saleId).monto), 'C desmarcado conserva su precio').toBe(33333);
        expect(firmaOtrosTipos(pa, saleId)).toEqual(firmaOtrosTipos(snapshot.A, saleId));
        expect(firmaOtrosTipos(pb, saleId)).toEqual(firmaOtrosTipos(snapshot.B, saleId));
        expect(firmaOtrosTipos(pc, saleId)).toEqual(firmaOtrosTipos(snapshot.C, saleId));

        const detalle = await detalleAjuste(page, Number(data.id_ajuste_precio));
        expect(Number(detalle.ajuste?.total_items)).toBe(2);
        expect(detalle.items.map((i) => Number(i.id_stock_producto)).sort()).toEqual([ids.A, ids.B].sort());
      });

      await test.step('importe, importe negativo, porcentaje negativo, centavos y precio fijo: vista previa = persistencia', async () => {
        const casos = [
          { modo: 'valor', valor: '150,25', esperado: 120025 },
          { modo: 'valor', valor: '-200,10', esperado: 100015 },
          { modo: 'porcentaje', valor: '-12,5', esperado: 87513 }, // 1000,15 × 0,875 = 875,13125
          { modo: 'fijo', valor: '1234,56', esperado: 123456 },
        ];
        let actual = '$1.050,00';
        for (const caso of casos) {
          const dialog = await prepararModal(page, { tipoId: saleId, tag, esperar: [[keyA, actual]] });
          await dialog.getByTestId('ap-modo-ajuste').selectOption(caso.modo);
          await dialog.getByTestId('ap-valor-ajuste').fill(caso.valor);
          await dialog.getByTestId('ap-observacion').fill(`${RUN_PREFIX} AJUSTE ${caso.modo} ${caso.valor}`);
          await row(dialog, keyA).locator('input[type="checkbox"]').check();
          const preview = moneyText(await cell(dialog, keyA, 'ap-row-final').innerText());
          expect(Math.round(preview * 100), `vista previa ${caso.modo} ${caso.valor}`).toBe(caso.esperado);
          await expect(cell(dialog, keyB, 'ap-row-ajuste')).toHaveText('—');
          const { payload } = await guardarDesdeUI(page, dialog, writes);
          expect(payload.items).toEqual([{ id_stock_producto: ids.A, id_stock_variante: null }]);
          expect(cents(precioTipo(await preciosDe(page, ids.A), saleId).monto), `persistido ${caso.modo}`).toBe(caso.esperado);
          actual = `$${(caso.esperado / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        expect(cents(precioTipo(await preciosDe(page, ids.B), saleId).monto)).toBe(262553);
        expect(cents(precioTipo(await preciosDe(page, ids.C), saleId).monto)).toBe(33333);
      });

      await test.step('variantes: base con heredada avisada; variante propia sólo cambia ella', async () => {
        let dialog = await prepararModal(page, {
          tipoId: saleId, tag,
          esperar: [[keyD, '$500,00'], [keyV1, '$777,77'], [keyV2, '$500,00']],
        });
        await expect(row(dialog, keyV2).locator('input[type="checkbox"]')).toBeDisabled();
        await dialog.getByTestId('ap-valor-ajuste').fill('5');
        await row(dialog, keyD).locator('input[type="checkbox"]').check();
        await expect(dialog.getByTestId('ap-aviso-heredados')).toBeVisible();
        await expect(row(dialog, keyV2).getByTestId('ap-row-heredado')).toContainText('pasará a $525,00');
        await expect(cell(dialog, keyV1, 'ap-row-ajuste')).toHaveText('—');
        let res = await guardarDesdeUI(page, dialog, writes);
        expect(res.payload.items).toEqual([{ id_stock_producto: ids.D, id_stock_variante: null }]);

        expect(cents(precioTipo(await preciosDe(page, ids.D), saleId).monto)).toBe(52500);
        const v1 = precioTipo(await preciosDe(page, ids.D, variantes.V1), saleId);
        expect(cents(v1.monto), 'V1 con precio propio no seleccionada: intacta').toBe(77777);
        expect(Number(v1.heredado)).toBe(0);
        const v2 = precioTipo(await preciosDe(page, ids.D, variantes.V2), saleId);
        expect(cents(v2.monto), 'V2 heredada sigue al base').toBe(52500);
        expect(Number(v2.heredado), 'no se creó un precio propio en la heredada').toBe(1);

        dialog = await prepararModal(page, { tipoId: saleId, tag, esperar: [[keyD, '$525,00'], [keyV1, '$777,77']] });
        await dialog.getByTestId('ap-valor-ajuste').fill('10');
        await row(dialog, keyV1).locator('input[type="checkbox"]').check();
        await expect(cell(dialog, keyV1, 'ap-row-final')).toHaveText('$855,55');
        await expect(dialog.getByTestId('ap-aviso-heredados')).toHaveCount(0);
        res = await guardarDesdeUI(page, dialog, writes);
        expect(res.payload.items).toEqual([{ id_stock_producto: ids.D, id_stock_variante: variantes.V1 }]);
        expect(cents(precioTipo(await preciosDe(page, ids.D, variantes.V1), saleId).monto)).toBe(85555);
        expect(cents(precioTipo(await preciosDe(page, ids.D), saleId).monto), 'base intacto').toBe(52500);
      });

      await test.step('buscar, seleccionar visibles, cambiar tipo y cancelar no escriben', async () => {
        const antes = writes.length;
        const historialAntes = await historialDe(page, Object.values(ids));
        const dialog = await prepararModal(page, { tipoId: saleId, tag, esperar: [[keyC, '$333,33']] });
        await dialog.getByTestId('ap-valor-ajuste').fill('5');
        await dialog.getByTestId('ap-buscar').fill(`${tag}-C`);
        await dialog.getByRole('button', { name: /Seleccionar visibles/ }).click();
        await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('1');
        await dialog.getByTestId('ap-buscar').fill(tag);
        await expect(row(dialog, keyC)).toHaveAttribute('data-selected', 'true');
        await expect(row(dialog, keyA)).toHaveAttribute('data-selected', 'false');
        const otro = types.find((t) => Number(t.id_tipo_precio_stock) !== saleId);
        if (otro) {
          await dialog.getByTestId('ap-tipo-precio').selectOption(String(otro.id_tipo_precio_stock));
          await expect(dialog.getByTestId('ap-resumen-cantidad')).toHaveText('0');
        }
        await dialog.getByRole('button', { name: 'Cancelar' }).click();
        await expect(dialog).toBeHidden();
        expect(writes.length).toBe(antes);
        expect(await historialDe(page, Object.values(ids)), 'cancelar no genera historial').toBe(historialAntes);
        expect(cents(precioTipo(await preciosDe(page, ids.C), saleId).monto)).toBe(33333);
      });

      await test.step('API: selección vacía rechazada y reenvío idéntico no duplica el ajuste', async () => {
        const historialAntes = await historialDe(page, Object.values(ids));
        for (const items of [[], undefined]) {
          const vacio = await authenticatedApi(page, 'stock_precios_ajuste_crear', {
            method: 'POST',
            body: { id_tipo_precio_stock: saleId, tipo_ajuste: 'porcentaje', valor_ajuste: '50', observacion: `${RUN_PREFIX} VACIO`, ...(items ? { items } : {}) },
          });
          expect(vacio.status).toBe(400);
        }
        expect(await historialDe(page, Object.values(ids)), 'la selección vacía no escribe').toBe(historialAntes);

        const historialC = await historialDe(page, [ids.C]);
        const body = { id_tipo_precio_stock: saleId, tipo_ajuste: 'valor', valor_ajuste: '0.01', observacion: `${RUN_PREFIX} REENVIO`, items: [{ id_stock_producto: ids.C, id_stock_variante: null }] };
        const [r1, r2] = await Promise.all([
          authenticatedApi(page, 'stock_precios_ajuste_crear', { method: 'POST', body }),
          authenticatedApi(page, 'stock_precios_ajuste_crear', { method: 'POST', body }),
        ]);
        const estados = [r1.status, r2.status].sort();
        expect(estados, `${r1.text} | ${r2.text}`).toEqual([200, 409]);
        expect(cents(precioTipo(await preciosDe(page, ids.C), saleId).monto), 'un solo +0,01').toBe(33334);
        expect(await historialDe(page, [ids.C]), 'un único registro de historial nuevo para C').toBe(historialC + 1);
      });

      await test.step('sin cambios en stock, otros tipos de precio ni Tienda Nube', async () => {
        for (const f of fixtures) {
          expect(Number((await getStockProductBySku(page, f.sku)).stock || 0), `stock de ${f.k}`).toBe(stockAntes[f.k]);
        }
        for (const k of ['A', 'B', 'C', 'D']) {
          expect(firmaOtrosTipos(await preciosDe(page, ids[k]), saleId), `otros tipos de ${k}`).toEqual(firmaOtrosTipos(snapshot[k], saleId));
        }
        expect(tnRequests, 'el tenant E2E no debe procesar jobs de Tienda Nube').toEqual([]);
      });
    } finally {
      for (const id of Object.values(ids)) {
        await authenticatedApi(page, 'stock_producto_eliminar_permanente', {
          method: 'POST',
          body: { id, confirmar_desvinculacion: 1 },
        }).catch(() => null);
      }
    }
  });
});
