import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { requireMutations, waitDialog, waitForBusyToFinish } from './support/ui.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { listStockUnits } from './support/stock-units.js';
import { uniqueName, uniqueSku } from './support/data.js';

const getData = (res) => res?.data && typeof res.data === 'object' ? { ...res.data, ...res } : res || {};
const fecha = (offset = 0) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + offset * 86400000));
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
};
async function vencimientos(page, id) {
  const res = await authenticatedApi(page, 'stock_vencimientos_consultar', { query: { id_stock_producto: id } });
  return getData(expectApiSuccess(res)).vencimientos || [];
}
function productoBase(nombre, sku, unidadId, stock = 10) {
  return {
    nombre, sku, precio_costo: '10', precio: '20', stock: String(stock),
    id_stock_unidad: String(unidadId), diferir_sync: '1', origen_sync: 'playwright_e2e',
  };
}

test('@stock @vencimientos @critical alta simple registra partidas de manera atómica y valida cantidades', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(150000);
  const unidades = await listStockUnits(page, 'todos');
  const unidad = unidades.find(u => Number(u.activo ?? 1) === 1 && Number(u.permite_decimales) === 1 && Number(u.es_default) !== 1);
  expect(unidad, 'Se necesita unidad fraccionable y aislada de Tienda Nube').toBeTruthy();
  const name = uniqueName('VENC-ALTA-SIMPLE');
  const payload = {
    ...productoBase(name, uniqueSku('VAA'), Number(unidad.id_stock_unidad)),
    vencimientos: [
      { fecha_vencimiento: fecha(14), cantidad: 4, referencia: 'PARTIDA A' },
      { fecha_vencimiento: fecha(45), cantidad: 3, referencia: 'PARTIDA B' },
    ],
  };
  let creado = false;
  try {
    const invalid = await authenticatedApi(page, 'stock_productos_crear', {
      method: 'POST', body: { ...payload, vencimientos: [{ fecha_vencimiento: fecha(14), cantidad: 11 }] },
    });
    expect(invalid.status, '11 unidades no pueden asignarse a stock 10').toBe(400);
    const ok = getData(expectApiSuccess(await authenticatedApi(page, 'stock_productos_crear', { method: 'POST', body: payload })));
    creado = true;
    const id = Number(ok.producto?.id_stock_producto);
    expect(id).toBeGreaterThan(0);
    expect(Number(ok.vencimientos_registrados)).toBe(2);
    const rows = await vencimientos(page, id);
    expect(rows).toHaveLength(2);
    expect(rows.map(v => Number(v.cantidad_disponible))).toEqual([4, 3]);
    expect(rows.map(v => v.fecha_vencimiento?.slice(0, 10))).toEqual([fecha(14), fecha(45)]);
  } finally { if (creado) await deleteUnusedStockProduct(page, name); }
});

test('@stock @vencimientos @critical alta con variantes asocia cada vencimiento a su propia variante', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(150000);
  const unidades = await listStockUnits(page, 'todos');
  const unidad = unidades.find(u => Number(u.activo ?? 1) === 1 && Number(u.permite_decimales) === 1 && Number(u.es_default) !== 1);
  expect(unidad).toBeTruthy();
  const name = uniqueName('VENC-ALTA-VARIANTE');
  const base = productoBase(name, uniqueSku('VAV'), Number(unidad.id_stock_unidad), 0);
  const variantes = [
    { nombre_variante: 'PRESENTACION A', stock: 5, id_stock_unidad: Number(unidad.id_stock_unidad), precios: [{ id_tipo_precio_stock: 2, precio: '100' }], vencimientos: [{ fecha_vencimiento: fecha(16), cantidad: 2 }] },
    { nombre_variante: 'PRESENTACION B', stock: 6, id_stock_unidad: Number(unidad.id_stock_unidad), precios: [{ id_tipo_precio_stock: 2, precio: '120' }], vencimientos: [{ fecha_vencimiento: fecha(34), cantidad: 3 }, { fecha_vencimiento: fecha(60), cantidad: 1 }] },
  ];
  let creado = false;
  try {
    const ok = getData(expectApiSuccess(await authenticatedApi(page, 'stock_productos_crear', { method: 'POST', body: { ...base, tiene_variantes: '1', variantes } })));
    creado = true;
    const id = Number(ok.producto?.id_stock_producto);
    expect(id).toBeGreaterThan(0);
    expect(Number(ok.vencimientos_registrados)).toBe(3);
    const variantRows = ok.producto?.variantes || [];
    expect(variantRows).toHaveLength(2);
    const idA = Number(variantRows.find(v => v.nombre_variante === 'PRESENTACION A')?.id_stock_variante);
    const idB = Number(variantRows.find(v => v.nombre_variante === 'PRESENTACION B')?.id_stock_variante);
    expect(idA).toBeGreaterThan(0);
    expect(idB).toBeGreaterThan(0);
    const rows = await vencimientos(page, id);
    expect(rows.filter(v => Number(v.id_stock_variante) === idA)).toHaveLength(1);
    expect(rows.filter(v => Number(v.id_stock_variante) === idB)).toHaveLength(2);
  } finally { if (creado) await deleteUnusedStockProduct(page, name); }
});

test('@stock @vencimientos @ui Agregar producto muestra fecha en simple y en variantes y persiste el alta', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(180000);
  const name = uniqueName('VENC-UI-ALTA');
  let creado = false;
  try {
    await page.goto('/panel/stock');
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Agregar producto/i }).first().click();
    const dialog = await waitDialog(page, 'Productos');
    const simple = dialog.getByRole('region', { name: 'Fechas de vencimiento del producto' });
    await expect(simple.getByRole('button', { name: /Agregar vencimiento/i })).toBeVisible();
    await simple.getByRole('button', { name: /Agregar vencimiento/i }).click();
    await simple.getByRole('textbox', { name: 'Cantidad con vencimiento #1' }).fill('3');
    await simple.getByLabel('Fecha de vencimiento #1').fill(fecha(22));
    await dialog.locator('input[name="nombre"]').fill(name);
    await dialog.locator('input[name="sku"]').fill(uniqueSku('VUI'));
    await dialog.locator('input[name="stock"]').fill('6');
    await dialog.locator('input[name="precio_costo"]').fill('10');
    await dialog.locator('input[name="precio_costo"]').blur();
    await dialog.locator('input[name="precio"]').fill('20');
    await dialog.locator('input[name="precio"]').blur();

    // Variantes tienen sus campos propios (sin duplicar las fechas del padre).
    await dialog.getByRole('tab', { name: 'Variantes' }).click();
    await dialog.getByRole('checkbox', { name: 'Tiene variantes' }).check();
    const variantRegion = dialog.getByRole('region', { name: /Fechas de vencimiento · Variante #1/ });
    await expect(variantRegion.getByRole('button', { name: /Agregar vencimiento/i })).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Tiene variantes' }).uncheck();
    await dialog.getByRole('tab', { name: /Producto original/ }).click();
    await expect(simple.getByLabel('Fecha de vencimiento #1')).toHaveValue(fecha(22));

    const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).searchParams.get('action') === 'stock_productos_crear', { timeout: 120000 });
    await dialog.getByRole('button', { name: /Guardar producto/i }).last().click();
    const create = await response;
    const body = getData(expectApiSuccess({ status: create.status(), body: await create.json() }));
    creado = true;
    expect(Number(body.vencimientos_registrados)).toBe(1);
    expect((await vencimientos(page, Number(body.producto?.id_stock_producto))).map(v => Number(v.cantidad_disponible))).toEqual([3]);
  } finally { if (creado) await deleteUnusedStockProduct(page, name); }
});
