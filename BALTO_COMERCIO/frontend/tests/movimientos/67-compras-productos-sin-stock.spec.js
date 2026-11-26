import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { todayISO, uniqueName, uniqueSku } from '../support/data.js';
import {
  requireMutations,
  gotoPanelReady,
  waitDialog,
  selectProduct,
  selectFirstAutocomplete,
  selectMovementMode,
  clickSaveAndWait,
} from '../support/ui.js';
import { createStockProductFixture } from '../support/stock-fixtures.js';
import { getStockProductBySku, getDefaultStockUnit } from '../support/stock-units.js';
import {
  getLists,
  tipoVentaId,
  createParty,
  movementId,
  deleteMovement,
  expectRejected,
} from '../support/financial-api.js';

/**
 * BALTO Comercio · Compras con "Mueve stock": selector de productos.
 *
 * Error corregido: el selector de Nueva/Editar Compra terminaba mostrando sólo
 * productos con stock positivo. Causa (frontend): ListasContext descartaba
 * `detalles_compras` (lista completa que el backend ya enviaba) y, al abrir el
 * modal, la recarga del contexto reemplazaba la lista completa por `detalles`
 * (lista vendible de Ventas). El backend y sus validaciones NO cambiaron.
 *
 * - "@mock": interfaz con respuestas simuladas de global_obtener_listas
 *   reproduciendo la carrera (no escribe datos).
 * - "@mutations": integración real en el tenant E2E (requireMutations). Los
 *   productos/proveedores/clientes llevan RUN_PREFIX y se limpian por ID.
 *
 * Stock "reservado": BALTO Comercio no tiene un modelo de reservas (ni tabla ni
 * columna); la disponibilidad es el stock físico. Si en el futuro se agrega,
 * este archivo es el lugar para cubrirlo.
 */

const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 3);
const MUEVE = 'MUEVE_STOCK';
const NO_MUEVE = 'NO_MUEVE_STOCK';

const item = (idProducto, cantidad, precio, extra = {}) => ({
  tipo_movimiento_stock: MUEVE, mueve_stock: 1, id_stock_producto: idProducto, cantidad, precio, iva_pct: 0, ...extra,
});

/**
 * `skuCode` debe ser corto y único dentro del archivo: uniqueSku() recorta el
 * nombre a 32 caracteres (prefijo de corrida incluido), así que dos etiquetas
 * largas que sólo difieren al final ("...STOCK-0" / "...STOCK-5") generaban el
 * MISMO SKU y el alta del segundo fixture respondía 409.
 */
async function producto(page, label, skuCode, { stock = 0, cost = 100, price = 180, variants } = {}) {
  const sku = uniqueSku(skuCode);
  const name = uniqueName(label, 90).toUpperCase();
  await createStockProductFixture(page, { name, sku, stock, cost, price, ...(variants ? { variants: variants(sku) } : {}) });
  const row = await getStockProductBySku(page, sku);
  return { id: Number(row.id_stock_producto), sku, name: String(row.nombre || name) };
}

async function stockDe(page, sku) {
  const p = await getStockProductBySku(page, sku);
  return amount(p.stock ?? p.stock_actual);
}

const ids = (rows) => new Set((rows || []).map((r) => Number(r?.id_stock_producto ?? r?.id ?? 0)));

async function listasCrudas(page, query) {
  const body = expectApiSuccess(await authenticatedApi(page, 'global_obtener_listas', { query: { ...query, _: Date.now() } }));
  return body?.listas && typeof body.listas === 'object' ? body.listas : body;
}

const esListas = (response, contextoCompras) => {
  const url = new URL(response.url());
  if (url.searchParams.get('action') !== 'global_obtener_listas') return false;
  const compras = ['compra', 'compras'].includes(url.searchParams.get('contexto') || '')
    || url.searchParams.get('include_sin_stock') === '1';
  return compras === contextoCompras;
};

/**
 * Abre Nueva Compra y, si se pide, espera las DOS cargas de listas que dispara
 * el modal: el refresco puntual de compras y la recarga del contexto global.
 * La recarga del contexto es justamente la que antes pisaba la lista completa,
 * así que las aserciones tienen que correr después de ambas.
 */
async function abrirNuevaCompra(page, { esperarListas = false } = {}) {
  await gotoPanelReady(page, '/panel/compras', page.getByTitle('Crear nueva compra'));
  const listasCompras = esperarListas ? page.waitForResponse((r) => esListas(r, true), { timeout: 60_000 }) : null;
  const listasContexto = esperarListas ? page.waitForResponse((r) => esListas(r, false), { timeout: 60_000 }) : null;
  await page.getByTitle('Crear nueva compra').click();
  const dialog = await waitDialog(page, 'Nueva Compra');
  if (esperarListas) {
    expect((await listasCompras).ok(), 'lista de compras').toBe(true);
    expect((await listasContexto).ok(), 'recarga del contexto global').toBe(true);
  }
  return dialog;
}

/**
 * La lista de productos llega de forma asíncrona (global_obtener_listas tarda
 * cientos de ms o más en Hostinger). Buscar apenas abre el modal leía la lista
 * vacía: se espera a que la opción aparezca. Para comprobar una AUSENCIA, antes
 * se espera la presencia de otro producto que sí debe figurar (lista cargada).
 */
async function esperarOpcion(page, scope, texto) {
  await expect
    .poll(() => opcionesVisibles(page, scope, texto), {
      message: `"${texto}" debe ofrecerse en el selector`,
      timeout: 45_000,
      intervals: [300, 600, 1_000, 2_000],
    })
    .toContain(texto);
}

async function opcionesVisibles(page, scope, texto) {
  const input = scope.locator('input[placeholder*="producto" i]').first();
  await input.fill('');
  await input.fill(texto);
  const list = page.locator('#psa-portal-list');
  await list.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => null);
  const textos = await list.locator('.psa-item, li').allInnerTexts().catch(() => []);
  await input.fill('');
  return textos.join('\n');
}

test.describe('@movimientos @compras @mock selector de Compras ante la recarga del contexto', () => {
  test('la recarga tardía de listas globales no reemplaza la lista completa de compras', async ({ page }) => {
    test.setTimeout(120_000);
    const P = (id, nombre, stock) => ({ id, id_stock_producto: id, nombre, stock, sku: `PWMOCK${id}`, precio: 100, precio_costo: 50, precios: [], variantes: [], tiene_variantes: 0, unidad_abreviatura: 'u', unidad_permite_decimales: 0 });
    const todos = [P(990001, 'PWMOCK STOCK POSITIVO', 20), P(990002, 'PWMOCK STOCK CERO', 0), P(990003, 'PWMOCK STOCK NEGATIVO', -3)];
    const vendibles = todos.filter((p) => p.stock > 0);
    // El marcador sólo existe en la recarga global tardía: verlo en el DOM
    // demuestra que React ya procesó esa respuesta, no sólo que llegó por HTTP.
    const marcador = P(990004, 'PWMOCK RECARGA GLOBAL', 5);
    const todosRecargados = [...todos, marcador];
    let aperturaIniciada = false;
    let liberarRecarga;
    const esperarLiberacion = new Promise((resolve) => { liberarRecarga = resolve; });
    let basePromise;

    await page.route('**/api.php?*', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') !== 'global_obtener_listas' || route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const esCompras = ['compra', 'compras'].includes(url.searchParams.get('contexto') || '') || url.searchParams.get('include_sin_stock') === '1';
      const esRecarga = aperturaIniciada && !esCompras;
      // Sólo una lectura real para conservar proveedores, medios y demás datos.
      // Las respuestas siguientes no dependen de la latencia variable de Hostinger.
      basePromise ??= (async () => {
        const response = await route.fetch({ timeout: 30_000 });
        expect(response.ok(), 'respuesta base para el mock de listas').toBe(true);
        const real = await response.json();
        expect(real?.exito, 'la respuesta base debe ser válida').toBe(true);
        return { response, real };
      })();
      const { response, real } = await basePromise;
      if (esRecarga) await esperarLiberacion;
      // La carga inicial sólo tiene el producto positivo; la carga puntual de
      // Compras incorpora los tres y recién después llega el contexto global.
      const completos = esCompras ? todos : esRecarga ? todosRecargados : vendibles;
      const stock = esRecarga ? [...vendibles, marcador] : vendibles;
      const aliases = { detalles_compras: completos, detallesCompras: completos, detalles_todos: completos, detallesTodos: completos };
      const listas = { ...(real.listas || {}), detalles: esCompras ? completos : stock, detalles_stock: stock, detallesStock: stock, ...aliases };
      await route.fulfill({ response, json: { ...real, exito: true, listas, ...aliases } });
    });

    try {
      await gotoPanelReady(page, '/panel/compras', page.getByTitle('Crear nueva compra'));
      aperturaIniciada = true;
      await page.getByTitle('Crear nueva compra').click();
      const dialog = await waitDialog(page, 'Nueva Compra');
      const row = dialog.getByTestId('compra-row').first();
      const input = row.locator('input[placeholder*="producto" i]').first();
      await input.fill('PWMOCK');
      const opciones = page.locator('#psa-portal-list .psa-item .psa-label');
      // La lista puntual debe estar realmente renderizada ANTES de liberar el
      // contexto. Un portal visible pero vacío no alcanza.
      await expect(opciones, 'lista puntual de compras antes de la recarga').toHaveText(todos.map((p) => p.nombre), { timeout: 25_000 });
      liberarRecarga();
      // El marcador obliga a observar el render posterior a la recarga y evita
      // pasar por leer el estado anterior. Las tres opciones originales siguen.
      await expect(opciones, 'lista completa después de aplicar la recarga global').toHaveText(todosRecargados.map((p) => p.nombre), { timeout: 25_000 });
      await input.fill('');
      await dialog.getByRole('button', { name: /Cancelar|Cerrar/i }).first().click();
      await expect(dialog).toBeHidden();
    } finally {
      // No dejar requests bloqueados si falla una aserción anterior.
      liberarRecarga();
    }
  });
});

test.describe('@movimientos @compras @mutations Compras con Mueve stock incluye productos sin stock', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(10 * 60_000);

  test('API: listas por contexto, compra de producto sin stock, cantidades mayores y Ventas intacto', async ({ page }) => {
    await requireMutations(test, page);
    const lists = await getLists(page, 'compras');
    const cc = tipoVentaId(lists, 'CUENTA CORRIENTE');
    const proveedor = await createParty(page, 'provider', 'PROV-SIN-STOCK');
    const cliente = await createParty(page, 'client', 'CLI-SIN-STOCK');
    const unit = await getDefaultStockUnit(page);

    const conStock = await producto(page, 'COMPRA-STOCK-20', 'C67A20', { stock: 20 });
    const sinStock = await producto(page, 'COMPRA-STOCK-0', 'C67A0', { stock: 0, cost: 400, price: 700 });
    const conVariantes = await producto(page, 'COMPRA-VAR-0', 'C67AV0', {
      stock: 0,
      variants: (sku) => [{ nombre_variante: 'ROJA', sku: `${sku}R`, stock: 0, unitId: Number(unit.id_stock_unidad), atributos: [{ atributo: 'COLOR', valor: 'ROJA' }] }],
    });
    const deBaja = await producto(page, 'COMPRA-BAJA-10', 'C67AB10', { stock: 10 });
    expectApiSuccess(await authenticatedApi(page, 'stock_producto_dar_baja', { method: 'POST', body: { id: deBaja.id } }), 'No se pudo dar de baja el fixture');

    const hoy = todayISO();
    const movs = [];
    try {
      // 1-3, 8, 10 · Compras recibe todos los activos (incluye stock 0 y variantes sin stock); nunca los dados de baja.
      const compras = await listasCrudas(page, { contexto: 'compras', include_sin_stock: 1 });
      const idsCompras = ids(compras.detalles_compras);
      expect(idsCompras.has(conStock.id), 'stock positivo').toBe(true);
      expect(idsCompras.has(sinStock.id), 'stock cero').toBe(true);
      expect(idsCompras.has(conVariantes.id), 'producto con variantes sin stock').toBe(true);
      expect(idsCompras.has(deBaja.id), 'dado de baja no aparece').toBe(false);
      expect(ids(compras.detalles).has(sinStock.id), '`detalles` en contexto compras también completo').toBe(true);
      const variantes = (compras.detalles_compras.find((p) => Number(p.id) === conVariantes.id)?.variantes) || [];
      expect(variantes.length, 'la variante con stock 0 se ofrece en compras').toBeGreaterThan(0);

      // 13, 19 · Sin contexto (Ventas/Presupuestos): `detalles` sigue siendo la lista vendible.
      const ventas = await listasCrudas(page, {});
      expect(ids(ventas.detalles).has(conStock.id)).toBe(true);
      expect(ids(ventas.detalles).has(sinStock.id), 'Ventas no ofrece productos sin stock').toBe(false);
      expect(ids(ventas.detalles).has(deBaja.id)).toBe(false);
      expect(ids(ventas.detalles_compras).has(sinStock.id), 'la lista completa sigue disponible para Compras').toBe(true);

      // 5-7 · Compra de un producto con stock 0 por más unidades que su stock: suma correctamente.
      const c1 = movementId(expectApiSuccess(await authenticatedApi(page, 'compras_crear_batch', {
        method: 'POST', body: { fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items: [item(sinStock.id, 7, 500)] },
      }), 'No se pudo comprar un producto sin stock'));
      movs.push(['compras_eliminar', c1]);
      close(await stockDe(page, sinStock.sku), 7, 'la compra suma 7 al producto sin stock');

      // 17 · La compra actualiza el costo de catálogo (política de última compra).
      const precios = expectApiSuccess(await authenticatedApi(page, 'stock_precios_obtener', { query: { id_stock_producto: sinStock.id, _: Date.now() } }));
      const costo = (precios.precios || precios.data?.precios || []).find((p) => /COSTO/i.test(String(p.tipo_nombre || p.nombre || '')));
      close(costo?.monto, 500, 'costo de catálogo = precio de la última compra');

      // 12 · Compra NO MUEVE STOCK: mismo comportamiento que antes (no suma).
      const c2 = movementId(expectApiSuccess(await authenticatedApi(page, 'compras_crear_batch', {
        method: 'POST', body: { fecha: hoy, id_tipo_venta: cc, id_proveedor: proveedor.id, items: [item(conStock.id, 3, 100, { tipo_movimiento_stock: NO_MUEVE, mueve_stock: 0 })] },
      })));
      movs.push(['compras_eliminar', c2]);
      close(await stockDe(page, conStock.sku), 20, 'NO MUEVE STOCK no suma');

      // 14 · Ventas sigue rechazando cantidades mayores a la disponibilidad.
      expectRejected(await authenticatedApi(page, 'ventas_crear_batch', {
        method: 'POST', body: { fecha: hoy, id_tipo_venta: cc, id_cliente: cliente.id, items: [item(sinStock.id, 8, 900)] },
      }), /stock|existencia/i);
      close(await stockDe(page, sinStock.sku), 7, 'la venta rechazada no descuenta');

      // 18 · Una venta válida descuenta y puede revertirse.
      const v1 = movementId(expectApiSuccess(await authenticatedApi(page, 'ventas_crear_batch', {
        method: 'POST', body: { fecha: hoy, id_tipo_venta: cc, id_cliente: cliente.id, medios_pago: [], items: [item(sinStock.id, 2, 900)] },
      })));
      movs.push(['ventas_eliminar', v1]);
      close(await stockDe(page, sinStock.sku), 5, 'la venta descuenta 2');
    } finally {
      for (const [action, id] of movs.reverse()) await deleteMovement(page, action, id);
    }
    close(await stockDe(page, sinStock.sku), 0, 'eliminar los movimientos revierte el stock');
  });

  test('UI: Nueva Compra busca, selecciona y guarda un producto con stock 0; Nueva Venta no lo ofrece', async ({ page }) => {
    await requireMutations(test, page);
    const proveedor = await createParty(page, 'provider', 'PROV-SIN-STOCK-UI');
    const sinStock = await producto(page, 'COMPRA-UI-STOCK-0', 'C67U0', { stock: 0, cost: 250, price: 400 });
    const conStock = await producto(page, 'COMPRA-UI-STOCK-5', 'C67U5', { stock: 5, cost: 250, price: 400 });
    let idCompra = 0;
    try {
      const dialog = await abrirNuevaCompra(page, { esperarListas: true });
      const row = dialog.getByTestId('compra-row').first();
      const selector = row.getByTestId('tipo-movimiento-stock');
      await expect(selector).toHaveValue(MUEVE);

      // 11 · Activar/desactivar Mueve stock no cambia la lista ofrecida.
      // Ambas listas ya respondieron: el producto sin stock tiene que seguir ofrecido.
      await esperarOpcion(page, row, sinStock.name);
      await selector.selectOption(NO_MUEVE);
      expect(await opcionesVisibles(page, row, sinStock.name)).toContain(sinStock.name);
      await selector.selectOption(MUEVE);
      expect(await opcionesVisibles(page, row, sinStock.name)).toContain(sinStock.name);
      expect(await opcionesVisibles(page, row, conStock.name)).toContain(conStock.name);

      // 4 · Se selecciona y 7 · se compra más que el stock actual.
      await selectProduct(row, sinStock.name);
      const qty = row.locator('input[type="number"]').first();
      await qty.fill('12');
      await qty.blur();
      await expect(qty).toHaveValue('12');
      const price = row.locator('input[inputmode="decimal"]').first();
      await price.click();
      await price.fill('300');
      await price.blur();

      await selectFirstAutocomplete(dialog, 'Proveedor', proveedor.name);
      await selectMovementMode(dialog, 'Forma de compra', /CUENTA\s*CORRIENTE/i);
      const responsePromise = page.waitForResponse((r) => r.request().method() === 'POST'
        && new URL(r.url()).searchParams.get('action') === 'compras_crear_batch', { timeout: 60_000 });
      await clickSaveAndWait(dialog, /Guardar compra/i, { timeout: 60_000 });
      const response = await responsePromise;
      const payload = response.request().postDataJSON();
      expect(payload.items[0]).toMatchObject({ id_stock_producto: sinStock.id, tipo_movimiento_stock: MUEVE, mueve_stock: 1 });
      idCompra = movementId(await response.json());
      expect(idCompra).toBeGreaterThan(0);
      close(await stockDe(page, sinStock.sku), 12, '6 · la compra desde la interfaz suma 12');

      // 13 · Ventas conserva su filtro: un producto sin stock no se ofrece.
      const otroSinStock = await producto(page, 'VENTA-UI-STOCK-0', 'C67V0', { stock: 0 });
      await gotoPanelReady(page, '/panel/ventas', page.getByRole('button', { name: /Nueva Venta/i }).first());
      await page.getByRole('button', { name: /Nueva Venta/i }).first().click();
      const venta = await waitDialog(page, 'Nueva Venta');
      const vRow = venta.getByTestId('venta-row').first();
      // Primero se espera que la lista vendible esté cargada (producto con stock),
      // recién después se comprueba la ausencia del producto sin stock.
      await esperarOpcion(page, vRow, conStock.name);
      expect(await opcionesVisibles(page, vRow, otroSinStock.name)).not.toContain(otroSinStock.name);
      await venta.getByRole('button', { name: 'Cerrar' }).first().click();
      await expect(venta).toBeHidden();
    } finally {
      await deleteMovement(page, 'compras_eliminar', idCompra);
    }
  });
});
