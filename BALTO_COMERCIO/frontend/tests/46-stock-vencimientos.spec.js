import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { createVariantStockProduct } from './support/barcodes.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { listStockUnits } from './support/stock-units.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { requireMutations } from './support/ui.js';

const data = (res) => res?.data && typeof res.data === 'object' ? { ...res.data, ...res } : res || {};
const localDay = (offset = 0) => {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/Argentina/Cordoba',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Date.now() + offset * 86400000));
  const obj = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
};
async function api(page, action, body = null, query = null) {
  return data(expectApiSuccess(await authenticatedApi(page, action, body ? {method:'POST',body} : {query:query || {}}), `Falló ${action}`));
}
async function vencimientos(page, id) {
  return (await api(page,'stock_vencimientos_consultar',null,{id_stock_producto:id})).vencimientos || [];
}

// No ejecutar estas mutaciones en tenants reales. requireMutations exige E2E habilitado y aislado.
test('@stock @vencimientos @critical cantidades, alertas, validación y FEFO en producto simple', async ({page}) => {
  await requireMutations(test,page);
  test.setTimeout(180000);
  const name = uniqueName('VENC-SIMPLE');
  const units = await listStockUnits(page,'todos');
  const fraccionable = units.find(u => Number(u.activo ?? 1)===1 && Number(u.permite_decimales)===1 && Number(u.es_default)!==1);
  expect(fraccionable,'Se necesita unidad fraccionable para no sincronizar fixtures TN').toBeTruthy();
  let creado = false;
  try {
    const created = data(await createStockProductFixture(page,{name,sku:uniqueSku('VENC'),stock:10,cost:20,price:50,unitId:Number(fraccionable.id_stock_unidad)}));
    const id = Number(created?.producto?.id_stock_producto || created?.producto?.id || 0);
    expect(id).toBeGreaterThan(0);
    creado = true;

    const first = await api(page,'stock_vencimientos_guardar',{id_stock_producto:id,fecha_vencimiento:localDay(2),cantidad:4,referencia:'LOTE PROXIMO'});
    const second = await api(page,'stock_vencimientos_guardar',{id_stock_producto:id,fecha_vencimiento:localDay(50),cantidad:3,referencia:'LOTE POSTERIOR'});
    expect(Number(first.id_vencimiento)).toBeGreaterThan(0);
    expect(Number(second.id_vencimiento)).toBeGreaterThan(0);
    expect((await vencimientos(page,id)).map(v => Number(v.cantidad_disponible))).toEqual([4,3]);

    const rejectOver = await authenticatedApi(page,'stock_vencimientos_guardar',{method:'POST',body:{id_stock_producto:id,fecha_vencimiento:localDay(5),cantidad:4}});
    expect(rejectOver.status,'No debe aceptar 11 unidades registradas si hay 10').toBe(409);

    const alerts = (await api(page,'stock_vencimientos_alertas',null,{dias_aviso:7})).alertas;
    expect(alerts.some(v => Number(v.id_vencimiento) === Number(first.id_vencimiento))).toBe(true);
    expect(alerts.some(v => Number(v.id_vencimiento) === Number(second.id_vencimiento))).toBe(false);

    await api(page,'stock_impactar_salida',{id_stock_producto:id,cantidad:5});
    const after = await vencimientos(page,id);
    expect(Number(after.find(v=>Number(v.id_vencimiento)===Number(first.id_vencimiento)).cantidad_disponible)).toBe(0);
    expect(Number(after.find(v=>Number(v.id_vencimiento)===Number(second.id_vencimiento)).cantidad_disponible)).toBe(2);
    const alertsAfter = (await api(page,'stock_vencimientos_alertas',null,{dias_aviso:7})).alertas;
    expect(alertsAfter.some(v=>Number(v.id_vencimiento)===Number(first.id_vencimiento))).toBe(false);

    await api(page,'stock_impactar_entrada',{id_stock_producto:id,cantidad:2});
    const afterRestock = await vencimientos(page,id);
    expect(Number(afterRestock.find(v=>Number(v.id_vencimiento)===Number(first.id_vencimiento)).cantidad_disponible)).toBe(0);
    await api(page,'stock_vencimientos_guardar',{id_stock_producto:id,id_vencimiento:second.id_vencimiento,fecha_vencimiento:localDay(60),cantidad:3});
    expect(Number((await vencimientos(page,id)).find(v=>Number(v.id_vencimiento)===Number(second.id_vencimiento)).cantidad_disponible)).toBe(3);
    await api(page,'stock_vencimientos_quitar',{id_vencimiento:second.id_vencimiento});
    expect((await vencimientos(page,id)).some(v=>Number(v.id_vencimiento)===Number(second.id_vencimiento))).toBe(false);
  } finally {
    if (creado) await deleteUnusedStockProduct(page,name);
  }
});

test('@stock @vencimientos @critical variantes separadas y salida de variante', async ({page}) => {
  await requireMutations(test,page);
  test.setTimeout(180000);
  const name=uniqueName('VENC-VARIANTES');
  let creado = false;
  try {
    const product=await createVariantStockProduct(page,{
      name,sku:uniqueSku('VVAR'),variants:[{name:'TALLE M',stock:5,price:100},{name:'TALLE L',stock:6,price:110}],
    });
    creado=true;
    const id=product.productId;
    const variants=product.variants;
    expect(variants).toHaveLength(2);
    const a=Number(variants[0].id_stock_variante || variants[0].id || 0);
    const b=Number(variants[1].id_stock_variante || variants[1].id || 0);
    expect(a).toBeGreaterThan(0);expect(b).toBeGreaterThan(0);
    await api(page,'stock_vencimientos_guardar',{id_stock_producto:id,id_stock_variante:a,fecha_vencimiento:localDay(1),cantidad:2});
    await api(page,'stock_vencimientos_guardar',{id_stock_producto:id,id_stock_variante:b,fecha_vencimiento:localDay(40),cantidad:3});
    const invalid = await authenticatedApi(page,'stock_vencimientos_guardar',{method:'POST',body:{id_stock_producto:id,fecha_vencimiento:localDay(2),cantidad:1}});
    expect(invalid.status,'Las variantes no pueden registrar vencimientos en el padre').toBe(409);
    await api(page,'stock_impactar_salida',{id_stock_producto:id,id_stock_variante:a,cantidad:1});
    const records = await vencimientos(page,id);
    expect(Number(records.find(v=>Number(v.id_stock_variante)===a).cantidad_disponible)).toBe(1);
    expect(Number(records.find(v=>Number(v.id_stock_variante)===b).cantidad_disponible)).toBe(3);
  } finally {if(creado) await deleteUnusedStockProduct(page,name);}
});

test('@stock @vencimientos @ui @notificaciones-ui popup y pestaña de edición muestran partidas reales', async ({page}) => {
  await requireMutations(test,page);
  test.setTimeout(150000);
  const name=uniqueName('VENC-POPUP');
  const units=await listStockUnits(page,'todos');
  const u=units.find(row=>Number(row.activo??1)===1 && Number(row.permite_decimales)===1 && Number(row.es_default)!==1);
  expect(u).toBeTruthy();
  let created=false;
  try {
    const res=data(await createStockProductFixture(page,{name,sku:uniqueSku('ALERT'),stock:5,cost:15,price:30,unitId:Number(u.id_stock_unidad)}));
    const id=Number(res.producto?.id_stock_producto || res.producto?.id || 0);
    expect(id).toBeGreaterThan(0);
    created=true;
    await api(page,'stock_vencimientos_guardar',{id_stock_producto:id,fecha_vencimiento:localDay(1),cantidad:2});

    await page.goto('/panel/stock');
    const popup=page.getByRole('dialog',{name:'Notificaciones de Stock'});
    if (!await popup.isVisible().catch(() => false)) {
      await page.getByRole('button',{name:/Notificaciones de Stock/i}).click();
    }
    await expect(popup).toBeVisible({timeout:20000});
    await expect(popup).toContainText(name);
    await popup.getByRole('button',{name:'Cerrar notificaciones'}).click();

    const {searchRow} = await import('./support/ui.js');
    const row=await searchRow(page,name,/Buscar por nombre, SKU o variante/i);
    await row.getByTitle('Editar').click();
    const edit=page.getByRole('dialog').filter({has:page.getByText('Editar producto',{exact:true})}).last();
    await expect(edit).toBeVisible();
    // La API expone DECIMAL(.,3) (p.ej. "5.000"), pero el input debe mostrar "5".
    await expect(edit.locator('input[name="stock"]')).toHaveValue('5');
    await edit.getByRole('tab',{name:'Vencimientos'}).click();
    await expect(edit.getByText('Partidas registradas')).toBeVisible();
    await expect(edit.locator('.sv-table tbody tr')).toHaveCount(1);
    await expect(edit.getByText('Con vencimiento registrado')).toBeVisible();
    const partida = edit.locator('.sv-table tbody tr').first();
    await partida.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(edit.locator('.sv-form input[type="number"]')).toHaveValue('2');
    await partida.getByRole('button', { name: 'Retirar stock' }).click();
    const retiro = edit.getByRole('dialog', {name:'Confirmar retiro de stock vencido'});
    await expect(retiro.locator('input[type="number"]')).toHaveValue('2');
    await retiro.locator('input[type="number"]').fill('1');
    await retiro.getByRole('button', { name: 'Confirmar retiro' }).click();
    // El retiro local debe confirmarse. Si el backend informa un error de
    // sincronización externa, la UI conserva una advertencia más larga,
    // que no debe confundirse con un fallo del descuento local.
    await expect(page.getByText(/^Stock retirado correctamente(?:\. Revisá la sincronización con Tienda Nube\.)?$/)).toBeVisible();
    const despues = await vencimientos(page, id);
    expect(despues).toHaveLength(1);
    expect(Number(despues[0].cantidad_disponible)).toBe(1);
    await edit.getByRole('button',{name:'Cancelar',exact:true}).click();
  } finally {if(created) await deleteUnusedStockProduct(page,name);}
});
