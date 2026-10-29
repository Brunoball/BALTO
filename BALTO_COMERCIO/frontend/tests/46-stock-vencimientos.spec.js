import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { createVariantStockProduct } from './support/barcodes.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { getStockE2EFixtureUnit } from './support/stock-units.js';
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
  const fraccionable = await getStockE2EFixtureUnit(page);
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
  const u = await getStockE2EFixtureUnit(page);
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
    let consultasProducto = 0;
    const esConsulta = (url) => {
      const parsed = new URL(url);
      return parsed.searchParams.get('action') === 'stock_vencimientos_consultar'
        && Number(parsed.searchParams.get('id_stock_producto')) === id;
    };
    const onRequest = (request) => { if (esConsulta(request.url())) consultasProducto += 1; };
    page.on('request', onRequest);
    // Vencimientos comienza a precargarse al abrir el editor, sin esperar al tab.
    const precarga = page.waitForResponse((response) => esConsulta(response.url()), { timeout: 30000 });
    await row.getByTitle('Editar').click();
    await precarga;
    const edit=page.getByRole('dialog').filter({has:page.getByText('Editar producto',{exact:true})}).last();
    await expect(edit).toBeVisible();
    // La API expone DECIMAL(.,3) (p.ej. "5.000"), pero el input debe mostrar "5".
    await expect(edit.locator('input[name="stock"]')).toHaveValue('5');
    await edit.getByRole('tab',{name:'Vencimientos'}).click();
    await expect(edit.getByText('Partidas registradas')).toBeVisible();
    expect(consultasProducto, 'Al abrir Vencimientos no debe duplicarse la consulta inicial').toBe(1);
    page.off('request', onRequest);
    const tabla = edit.getByRole('table', { name: 'Partidas con vencimiento' });
    await expect(tabla.locator('.sv-gridDataRow')).toHaveCount(1);
    const partida = tabla.locator('.sv-gridDataRow').first();
    await expect(partida).toContainText('2');
    // La edición usa un modal propio en un portal, y los botones tienen
    // nombres accesibles con la fecha de cada partida.
    await partida.getByRole('button', { name: /Editar partida del/i }).click();
    const modalEdicion = page.getByRole('dialog', { name: 'Editar vencimiento' });
    await expect(modalEdicion.getByLabel('Cantidad *')).toHaveValue('2');
    await modalEdicion.getByLabel('Cantidad *').fill('99');
    await modalEdicion.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(modalEdicion).toBeVisible();
    await expect(page.locator('.toast-container.toast-error')).toContainText('La cantidad supera el stock disponible');
    await expect(modalEdicion.locator('.sv-partida-error')).toHaveCount(0);
    await modalEdicion.getByLabel('Cantidad *').fill('2');
    await modalEdicion.getByLabel('Referencia (opcional)').fill('lote prueba');
    await modalEdicion.getByLabel('Observación (opcional)').fill('proveedor local');
    await expect(modalEdicion.getByLabel('Referencia (opcional)')).toHaveValue('LOTE PRUEBA');
    await expect(modalEdicion.getByLabel('Observación (opcional)')).toHaveValue('PROVEEDOR LOCAL');
    await modalEdicion.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(modalEdicion).toBeHidden();
    await expect(page.locator('.toast-container.toast-exito')).toContainText('Vencimiento actualizado correctamente');
    const persistida = (await vencimientos(page, id))[0];
    expect(persistida.referencia).toBe('LOTE PRUEBA');
    expect(persistida.observaciones).toBe('PROVEEDOR LOCAL');
    await partida.getByRole('button', { name: /Retirar stock de partida del/i }).click();
    // ModalEliminar también se monta en document.body, fuera del editor.
    const retiro = page.getByRole('dialog', { name: 'Retirar unidades del inventario' });
    await expect(retiro.getByLabel('Cantidad a retirar *')).toHaveValue('2');
    await retiro.getByLabel('Cantidad a retirar *').fill('99');
    await retiro.getByRole('button', { name: 'Confirmar retiro' }).click();
    await expect(page.locator('.toast-container.toast-error')).toContainText('Revisá la cantidad a retirar');
    await expect(retiro.locator('.sv-retire-error')).toHaveCount(0);
    await retiro.getByLabel('Cantidad a retirar *').fill('1');
    await retiro.getByLabel('Motivo del retiro *').fill('retiro de prueba');
    await expect(retiro.getByLabel('Motivo del retiro *')).toHaveValue('RETIRO DE PRUEBA');
    const respuestaRetiro = page.waitForResponse((r) =>
      r.request().method() === 'POST' && new URL(r.url()).searchParams.get('action') === 'stock_vencimientos_retirar',
      { timeout: 30_000 });
    await retiro.getByRole('button', { name: 'Confirmar retiro' }).click();
    const resRetiro = await respuestaRetiro;
    expect(resRetiro.status(), 'El retiro local debe confirmarse por API').toBeLessThan(400);
    await expect(retiro).toBeHidden();
    await expect(page.locator('.toast-container.toast-exito')).toContainText('Unidades retiradas correctamente.');
    const despues = await vencimientos(page, id);
    expect(despues).toHaveLength(1);
    expect(Number(despues[0].cantidad_disponible)).toBe(1);
    await partida.getByRole('button', { name: /Quitar partida del/i }).click();
    const quitar = page.getByRole('dialog', { name: 'Quitar fecha de vencimiento' });
    await quitar.getByRole('button', { name: 'Quitar fecha' }).click();
    await expect(quitar).toBeHidden();
    await expect(page.locator('.toast-container.toast-exito')).toContainText('Fecha de vencimiento quitada correctamente.');
    expect(await vencimientos(page, id)).toHaveLength(0);
    await edit.getByRole('button',{name:'Cancelar',exact:true}).click();
  } finally {if(created) await deleteUnusedStockProduct(page,name);}
});
