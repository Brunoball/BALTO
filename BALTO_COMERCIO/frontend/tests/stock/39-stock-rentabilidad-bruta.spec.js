import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { uniqueName, uniqueSku } from '../support/data.js';
import {
  expectStockProfitability,
  fillStockPrices,
  openStockEditorTab,
  stockProfitability,
  trackRetiredPriceRequests,
} from '../support/stock-editor.js';
import { createStockProduct, deleteUnusedStockProduct, openStockPanelWithSessionRecovery } from '../support/flows.js';
import { getStockProductBySku, waitStockEditorUnitsReady } from '../support/stock-units.js';
import { requireMutations, searchRow, waitDialog, waitForBusyToFinish } from '../support/ui.js';

/**
 * BALTO Comercio · Stock → pestaña Precios: rentabilidad bruta (reemplaza al
 * coeficiente ponderado, retirado el 26/11/2026).
 *
 * Contrato:
 *   Ganancia = PV − PC · Margen = (PV − PC) / PV · Recargo = (PV − PC) / PC
 *   Costo y precio -> rentabilidad. Nunca rentabilidad -> precio.
 *   Los indicadores son de lectura y se actualizan mientras se escribe.
 *
 * - Las pruebas "@ui" sólo abren el alta y la cancelan: no escriben datos.
 * - La prueba "@mutations" crea un producto PW-*, lo guarda, lo reabre y lo elimina.
 */

const amount = (v) => Number(v || 0);

async function abrirAltaPrecios(page) {
  const agregar = await openStockPanelWithSessionRecovery(page);
  await agregar.click();
  const dialog = await waitDialog(page, 'Productos');
  await openStockEditorTab(dialog, 'prices');
  return dialog;
}

async function cancelar(dialog) {
  await dialog.getByRole('button', { name: /Cancelar/i }).last().click();
  await expect(dialog).toBeHidden();
}

/** Escribe sin salir del campo (sin Enter ni blur): el cálculo debe ser inmediato. */
async function escribir(input, texto) {
  await input.click();
  await input.fill('');
  await input.pressSequentially(String(texto));
}

test.describe('@stock @pricing @ui rentabilidad bruta en el alta de productos', () => {
  test('sin coeficiente: no hay panel, mes base, utilidad, precio sugerido ni márgenes editables', async ({ page }) => {
    const retiradas = trackRetiredPriceRequests(page);
    const dialog = await abrirAltaPrecios(page);

    await expect(dialog.getByTestId('stock-pricing-panel')).toBeVisible();
    await expect(dialog.getByText('Precios principales').first()).toBeVisible();
    await expect(dialog.getByText(/La rentabilidad bruta del producto se calculará automáticamente/i)).toBeVisible();

    await expect(dialog.getByTestId('stock-coeficiente-ponderado')).toHaveCount(0);
    await expect(dialog.getByText(/Coeficiente ponderado|Mes base|Utilidad deseada|Precio sugerido|Incidencia estructura/i)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Aplicar al precio de venta/i })).toHaveCount(0);
    for (const name of ['margen_venta_porcentaje', 'margen_venta_valor', 'margen_promo_porcentaje', 'margen_promo_valor']) {
      await expect(dialog.locator(`input[name="${name}"]`)).toHaveCount(0);
    }
    // Los tres indicadores son texto: ningún input dentro del recuadro.
    const r = stockProfitability(dialog);
    await expect(r.box).toBeVisible();
    await expect(r.box.locator('input, textarea, select')).toHaveCount(0);

    await cancelar(dialog);
    expect(retiradas, 'El frontend no debe consultar endpoints del coeficiente').toEqual([]);
  });

  test('7.372,73 / 14.000 y 15.000: cálculo en tiempo real, sin Enter ni blur', async ({ page }) => {
    const dialog = await abrirAltaPrecios(page);
    const cost = dialog.locator('input[name="precio_costo"]');
    const price = dialog.locator('input[name="precio"]');

    await escribir(cost, '7372,73');
    await escribir(price, '14000');
    await expect(price).toBeFocused();
    await expectStockProfitability(dialog, { profit: '$ 6.627,27', margin: '47,34%', markup: '89,89%' });

    // Cambio de precio: actualización inmediata.
    await escribir(price, '15000');
    await expectStockProfitability(dialog, { profit: '$ 7.627,27', margin: '50,85%', markup: '103,45%' });

    // Cambiar el costo NO modifica el precio de venta.
    await price.blur();
    await expect(price).toHaveValue(/15\.000,00/);
    await escribir(cost, '10000');
    await cost.blur();
    await expect(price).toHaveValue(/15\.000,00/);
    await expectStockProfitability(dialog, { profit: '$ 5.000,00', margin: '33,33%', markup: '50,00%' });

    await cancelar(dialog);
  });

  test('tabla de comprobaciones obligatorias y separadores decimales', async ({ page }) => {
    const dialog = await abrirAltaPrecios(page);
    const cost = dialog.locator('input[name="precio_costo"]');
    const price = dialog.locator('input[name="precio"]');
    const r = stockProfitability(dialog);

    const casos = [
      ['7372,73', '14000', '$ 6.627,27', '47,34%', '89,89%'],
      ['7372.73', '15000', '$ 7.627,27', '50,85%', '103,45%'],
      ['10000', '14000', '$ 4.000,00', '28,57%', '40,00%'],
      ['10000', '8000', '-$ 2.000,00', '-25,00%', '-20,00%'],
      ['10000', '10000', '$ 0,00', '0,00%', '0,00%'],
      ['0', '10000', '$ 10.000,00', '100,00%', '—'],
    ];
    for (const [c, p, ganancia, margen, recargo] of casos) {
      await escribir(cost, c);
      await escribir(price, p);
      await expectStockProfitability(dialog, { profit: ganancia, margin: margen, markup: recargo });
    }

    // Venta inferior al costo: advertencia textual + insignia (no sólo color).
    await escribir(cost, '10000');
    await escribir(price, '8000');
    await expect(r.warning).toHaveText('Atención: el precio de venta es inferior al costo de adquisición del producto.');
    await expect(r.loss).toContainText(/Pérdida/);

    // Re-edición del costo ya formateado ("$ 7.372,73") y pegado de un importe formateado.
    await cost.fill('7.372,73');
    await cost.blur();
    await expect(cost).toHaveValue(/7\.372,73/);
    await escribir(price, '14000');
    await expectStockProfitability(dialog, { profit: '$ 6.627,27', margin: '47,34%', markup: '89,89%' });
    await expect(r.warning).toHaveCount(0);

    // Escritura parcial y borrado de centavos.
    await escribir(cost, '9870,');
    await expectStockProfitability(dialog, { profit: '$ 4.130,00' });
    await cost.pressSequentially('50');
    await expectStockProfitability(dialog, { profit: '$ 4.129,50' });
    await cost.press('Backspace');
    await cost.press('Backspace');
    await expectStockProfitability(dialog, { profit: '$ 4.130,00' });

    // Campo vacío (no es cero): todos los indicadores en —.
    await cost.fill('');
    await expectStockProfitability(dialog, { profit: '—', margin: '—', markup: '—' });
    await expect(dialog.getByText(/Cargá el precio de costo para ver la rentabilidad/i)).toBeVisible();

    // Venta cero: sólo el margen (división por cero) queda en —.
    await escribir(cost, '10000');
    await escribir(price, '0');
    await expectStockProfitability(dialog, { profit: '-$ 10.000,00', margin: '—', markup: '-100,00%' });

    // Importes negativos: el input no acepta el signo (500 se toma positivo).
    await escribir(price, '-500');
    await expect(price).not.toHaveValue(/-/);
    await expectStockProfitability(dialog, { profit: '-$ 9.500,00', margin: '-1.900,00%', markup: '-95,00%' });
    await price.blur();
    await expect(price).not.toHaveValue(/-/);

    for (const text of await r.box.allInnerTexts()) {
      expect(text).not.toMatch(/NaN|Infinity|undefined/);
    }
    await cancelar(dialog);
  });

  test('promoción: indicadores propios, advertencia bajo costo y eliminación', async ({ page }) => {
    const dialog = await abrirAltaPrecios(page);
    const cost = dialog.locator('input[name="precio_costo"]');
    const price = dialog.locator('input[name="precio"]');
    const promo = dialog.locator('input[name="precio_promo"]');
    const r = stockProfitability(dialog);

    await escribir(cost, '7372,73');
    await escribir(price, '14000');
    await expect(r.promoBox).toHaveCount(0);

    await escribir(promo, '12000');
    await expect(r.promoProfit).toHaveText('$ 4.627,27');
    await expect(r.promoMargin).toHaveText('38,56%');
    await expect(r.promoWarning).toHaveCount(0);

    await escribir(promo, '5000');
    await expect(r.promoProfit).toHaveText('-$ 2.372,73');
    await expect(r.promoMargin).toHaveText('-47,45%');
    await expect(r.promoWarning).toHaveText('Atención: el precio promocional es inferior al costo de adquisición del producto.');

    // Cambiar el costo no genera ni modifica el precio promocional.
    await promo.blur();
    await escribir(cost, '4000');
    await cost.blur();
    await expect(promo).toHaveValue(/5\.000,00/);
    await expect(price).toHaveValue(/14\.000,00/);

    // Eliminar la promoción oculta sus indicadores.
    await promo.fill('');
    await promo.blur();
    await expect(r.promoBox).toHaveCount(0);
    await expect(r.promoWarning).toHaveCount(0);

    await cancelar(dialog);
  });
});

test.describe('@stock @pricing @mutations @critical alta + edición con rentabilidad', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(6 * 60_000);

  test('alta 7.372,73 / 15.000, guarda, reabre: precios persistidos e indicadores recalculados', async ({ page }) => {
    await requireMutations(test, page);
    const sku = uniqueSku('RENTAB');
    const name = uniqueName('RENTABILIDAD-ALTA', 70).toUpperCase();
    try {
      await createStockProduct(page, { name, sku, stock: 1, cost: '7372,73', price: '15000' });
      const producto = await getStockProductBySku(page, sku);
      const id = Number(producto.id_stock_producto);
      const body = expectApiSuccess(await authenticatedApi(page, 'stock_precios_obtener', {
        query: { id_stock_producto: id, _: Date.now() },
      }));
      const precios = body?.precios || body?.data?.precios || [];
      const fila = (re) => precios.find((p) => re.test(String(p.tipo_nombre || '')));
      expect(amount(fila(/COSTO/i)?.monto)).toBeCloseTo(7372.73, 2);
      expect(amount(fila(/VENTA/i)?.monto)).toBeCloseTo(15000, 2);
      // Márgenes persistidos coherentes (el backend los recalcula).
      expect(amount(fila(/VENTA/i)?.margen_valor)).toBeCloseTo(7627.27, 2);
      expect(amount(fila(/VENTA/i)?.margen_porcentaje)).toBeCloseTo(50.85, 2);

      const row = await searchRow(page, sku, /Buscar por nombre, SKU o variante/i);
      await row.locator('button[title="Editar"]').click();
      const dialog = await waitDialog(page, 'Editar producto');
      await waitStockEditorUnitsReady(page, dialog);
      await openStockEditorTab(dialog, 'prices');
      await expectStockProfitability(dialog, { profit: '$ 7.627,27', margin: '50,85%', markup: '103,45%' });

      // Edición: cambiar el costo no cambia venta ni promoción.
      await fillStockPrices(dialog, { cost: '10000' });
      await expect(dialog.locator('input[name="precio"]')).toHaveValue(/15\.000|15000/);
      await expectStockProfitability(dialog, { profit: '$ 5.000,00', margin: '33,33%', markup: '50,00%' });
      await expect(stockProfitability(dialog).box.locator('input')).toHaveCount(0);
      await dialog.getByRole('button', { name: /Cancelar/i }).last().click();
      await expect(dialog).toBeHidden();
    } finally {
      await page.goto('/panel/stock').catch(() => null);
      await waitForBusyToFinish(page).catch(() => null);
      await deleteUnusedStockProduct(page, name).catch(() => null);
    }
  });
});

test.describe('@stock @pricing @api endpoints del coeficiente retirados', () => {
  test('las acciones retiradas responden "no encontrada" y no modifican precios', async ({ page }) => {
    // Sólo lectura sobre precios: las acciones ya no existen en el router, por lo
    // que ni siquiera llegan a ejecutar lógica. Se envían como lo haría un
    // frontend antiguo o una petición manual.
    for (const action of [
      'stock_coeficiente_ponderado',
      'stock_precios_configuracion_obtener',
      'stock_precios_revision_pendiente',
    ]) {
      const res = await authenticatedApi(page, action, { query: { _: Date.now() } });
      expect(res.status, `${action} debe estar retirada (acción inexistente)`).toBeGreaterThanOrEqual(400);
      expect(res.body?.exito === true || res.body?.success === true, `${action} no debe responder éxito`).toBe(false);
    }
    for (const action of [
      'stock_precios_configuracion_guardar',
      'stock_precios_revision_aplicar',
      'stock_precios_revision_rechazar',
    ]) {
      const res = await authenticatedApi(page, action, {
        method: 'POST',
        body: { id_revision: 1, utilidad_deseada_pct: 10 },
      });
      expect(res.status, `${action} debe estar retirada (acción inexistente)`).toBeGreaterThanOrEqual(400);
      expect(res.body?.exito === true || res.body?.success === true, `${action} no debe responder éxito`).toBe(false);
    }
  });
});
