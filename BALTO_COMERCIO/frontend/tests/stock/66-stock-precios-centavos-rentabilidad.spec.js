import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { uniqueName, uniqueSku } from '../support/data.js';
import { createStockProductFixture } from '../support/stock-fixtures.js';
import { getStockProductBySku, waitStockEditorUnitsReady } from '../support/stock-units.js';
import { expectStockProfitability, openStockEditorTab, stockProfitability } from '../support/stock-editor.js';
import { deleteUnusedStockProduct, openStockPanelWithSessionRecovery } from '../support/flows.js';
import {
  clickSaveAndWait,
  requireMutations,
  searchRow,
  waitDialog,
  waitForBusyToFinish,
} from '../support/ui.js';

/**
 * BALTO Comercio · Stock → pestaña Precios (alta individual y edición).
 * (antes 66-stock-precios-centavos-coeficiente.spec.js)
 *
 * Reclamo del cliente (video del 24/11/2026): en "Editar producto" no se podía
 * escribir la coma del precio de costo. El input controlado se reformateaba con
 * parseFloat en cada tecla: "5162" + "," + "50" quedaba en 516250 y los
 * márgenes se calculaban sobre un costo 100 veces mayor.
 *
 * El coeficiente ponderado y el precio sugerido fueron retirados (26/11/2026):
 * ahora se verifica que comas, puntos y centavos lleguen intactos al recuadro de
 * RENTABILIDAD BRUTA y a lo persistido.
 *
 * - "@ui": interfaz del alta sin escrituras (se cancela el diálogo).
 * - "@mutations": integración REAL con el backend en el tenant E2E
 *   (requireMutations). Crea un producto PW-*, lo edita desde la interfaz,
 *   guarda, reabre y verifica lo almacenado; al final lo elimina.
 */

const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);

function moneyText(value) {
  // "$ 15.889,97" -> 15889.97 · "-$ 2.000,00" -> -2000
  const raw = String(value || '').replace(/[^\d,.-]/g, '');
  if (!raw) return null;
  return Number(raw.replace(/\./g, '').replace(',', '.'));
}

async function preciosDe(page, idProducto) {
  const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_obtener', {
    query: { id_stock_producto: idProducto, _: Date.now() },
  }), 'No se pudieron consultar los precios del producto');
  return body?.precios || body?.data?.precios || [];
}

const montoTipo = (precios, pattern) => {
  const fila = precios.find((p) => pattern.test(String(p.tipo_nombre || p.nombre || '')));
  return fila ? amount(fila.monto) : null;
};

async function abrirAltaPrecios(page) {
  // Mismo acceso que el resto de la suite de Stock: tolera el corte transitorio
  // del gate de sesión de Hostinger usando sólo su botón real "Reintentar".
  const agregar = await openStockPanelWithSessionRecovery(page);
  await agregar.click();
  const dialog = await waitDialog(page, 'Productos');
  await openStockEditorTab(dialog, 'prices');
  await expect(dialog.getByTestId('stock-pricing-panel')).toBeVisible();
  return dialog;
}

async function cerrarDialogo(dialog) {
  await dialog.getByRole('button', { name: /Cancelar/i }).last().click();
  await expect(dialog).toBeHidden();
}

test.describe('@stock @pricing @ui precios: comas, centavos y rentabilidad en la interfaz', () => {
  test('alta: coma decimal, re-edición del costo formateado y punto del teclado numérico', async ({ page }) => {
    const dialog = await abrirAltaPrecios(page);
    const cost = dialog.locator('input[name="precio_costo"]');
    const price = dialog.locator('input[name="precio"]');
    const r = stockProfitability(dialog);

    await price.click();
    await price.pressSequentially('20000');

    await cost.click();
    await cost.pressSequentially('9870,50');
    await expect.poll(async () => moneyText(await r.profit.inputValue())).toBeCloseTo(20000 - 9870.5, 2);
    await price.click();
    await expect(cost).toHaveValue(/9\.870,50/);

    // Re-edición del valor ya formateado ("$ 9.870,50"): antes se interpretaba 9,87.
    await cost.click();
    await cost.press('End');
    await cost.press('Backspace');
    await cost.pressSequentially('9');
    await expect.poll(async () => moneyText(await r.profit.inputValue())).toBeCloseTo(20000 - 9870.59, 2);
    await price.click();
    await expect(cost).toHaveValue(/9\.870,59/);

    // Punto del teclado numérico como separador decimal.
    await cost.fill('');
    await cost.pressSequentially('1250.5');
    await price.click();
    await expect(cost).toHaveValue(/1\.250,50/);
    await expect.poll(async () => moneyText(await r.profit.inputValue())).toBeCloseTo(20000 - 1250.5, 2);
    await expect.poll(async () => moneyText(await r.margin.inputValue()))
      .toBeCloseTo(Number((((20000 - 1250.5) / 20000) * 100).toFixed(2)), 2);

    // Un precio de venta cargado a mano no se pisa al cambiar el costo.
    await price.fill('3000');
    await price.blur();
    await cost.fill('1300');
    await cost.blur();
    await expect(price).toHaveValue(/3\.000,00/);
    await expect(r.margin).toHaveValue('56,67%');
    await expect(r.markup).toHaveValue('130,77%');

    // Escritura parcial: "5162," muestra 5162 y no se pierde la coma.
    await cost.click();
    await cost.fill('');
    await cost.pressSequentially('5162,');
    await expect(cost).toHaveValue('5162,');
    await expect(r.profit).toHaveValue('-$ 2.162,00');
    await cost.pressSequentially('50');
    await expect(cost).toHaveValue('5162,50');
    await expect(r.profit).toHaveValue('-$ 2.162,50');

    await cerrarDialogo(dialog);
  });
});

test.describe('@stock @pricing @mutations @critical edición: centavos del costo (reclamo del cliente)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(6 * 60_000);

  test('reproduce el video: costo 5162 + ",50" en Editar producto, guarda y reabre', async ({ page }) => {
    await requireMutations(test, page);
    const sku = uniqueSku('CENTAVOS');
    const name = uniqueName('PRECIO-CENTAVOS', 70).toUpperCase();
    await createStockProductFixture(page, { name, sku, stock: 1, cost: 5162, price: 10300 });
    const producto = await getStockProductBySku(page, sku);
    const id = Number(producto.id_stock_producto);
    const preciosAntes = await preciosDe(page, id);
    close(montoTipo(preciosAntes, /COSTO/i), 5162, 'costo inicial del fixture');
    const otrosAntes = preciosAntes
      .filter((p) => !/COSTO|VENTA/i.test(String(p.tipo_nombre || p.nombre || '')))
      .map((p) => `${p.id_tipo_precio_stock}:${amount(p.monto).toFixed(2)}`).sort();


    try {
      await page.goto('/panel/stock');
      await waitForBusyToFinish(page);
      const row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
      await row.locator('button[title="Editar"]').click();
      const dialog = await waitDialog(page, 'Editar producto');
      await waitStockEditorUnitsReady(page, dialog);
      await openStockEditorTab(dialog, 'prices');

      const cost = dialog.locator('input[name="precio_costo"]');
      const price = dialog.locator('input[name="precio"]');
      await expect(cost).toHaveValue('5162');

      // Exactamente lo que hace el cliente: cursor al final y tecla coma.
      await cost.click();
      await cost.press('End');
      await cost.press(',');
      await expect(cost, 'la coma debe quedar escrita').toHaveValue('5162,');
      await cost.pressSequentially('50');
      await expect(cost).toHaveValue('5162,50');

      // La rentabilidad se recalcula mientras se escribe, con el costo con centavos.
      await expectStockProfitability(dialog, { profit: '$ 5.137,50', margin: '49,88%', markup: '99,52%' });

      await price.click();
      await expect(cost).toHaveValue('5162,50');
      // Escribir el costo no dispara la edición inversa: el precio sigue siendo el cargado.
      await expect(price).toHaveValue(/^10300(,00)?$/);

      const guardado = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).searchParams.get('action') === 'stock_productos_actualizar',
      { timeout: 120_000 });
      await clickSaveAndWait(dialog, /Guardar cambios/i, { timeout: 90_000 });
      expect((await guardado).status()).toBeLessThan(400);

      // Persistencia real.
      const preciosDespues = await preciosDe(page, id);
      close(montoTipo(preciosDespues, /COSTO/i), 5162.5, 'el costo se guarda con centavos');
      close(montoTipo(preciosDespues, /VENTA/i), 10300, 'el precio de venta no cambia');
      const otrosDespues = preciosDespues
        .filter((p) => !/COSTO|VENTA/i.test(String(p.tipo_nombre || p.nombre || '')))
        .map((p) => `${p.id_tipo_precio_stock}:${amount(p.monto).toFixed(2)}`).sort();
      expect(otrosDespues, 'promocional y listas adicionales intactos').toEqual(otrosAntes);

      // Reabrir: el formulario muestra lo almacenado.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForBusyToFinish(page);
      const row2 = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
      await row2.locator('button[title="Editar"]').click();
      const dialog2 = await waitDialog(page, 'Editar producto');
      await waitStockEditorUnitsReady(page, dialog2);
      await openStockEditorTab(dialog2, 'prices');
      await expect(dialog2.locator('input[name="precio_costo"]')).toHaveValue('5162,5');
      // Al reabrir, los indicadores salen de los precios vigentes (no de márgenes guardados).
      await expectStockProfitability(dialog2, { profit: '$ 5.137,50', margin: '49,88%', markup: '99,52%' });
      await dialog2.getByRole('button', { name: /Cancelar/i }).last().click();
      await expect(dialog2).toBeHidden();
    } finally {
      await deleteUnusedStockProduct(page, name).catch(() => null);
    }
  });
});
