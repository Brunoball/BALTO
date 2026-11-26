import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { uniqueName, uniqueSku } from '../support/data.js';
import { createStockProductFixture } from '../support/stock-fixtures.js';
import { getStockProductBySku, waitStockEditorUnitsReady } from '../support/stock-units.js';
import { openStockEditorTab } from '../support/stock-editor.js';
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
 *
 * Reclamo del cliente (video del 24/11/2026): en "Editar producto" no se podía
 * escribir la coma del precio de costo. El input controlado se reformateaba con
 * parseFloat en cada tecla: "5162" + "," + "50" quedaba en 516250 y el precio
 * sugerido y los márgenes se calculaban sobre un costo 100 veces mayor.
 *
 * Dos tipos de prueba, separados a propósito:
 * - "@mock": interfaz con respuestas SIMULADAS del coeficiente/configuración
 *   (page.route). No escriben datos. Verifican cálculo visible, carreras y que
 *   la utilidad deseada no se persista mientras se escribe.
 * - "@mutations": integración REAL con el backend en el tenant E2E
 *   (requireMutations). Crean un producto PW-*, lo editan desde la interfaz,
 *   guardan, reabren y verifican lo almacenado; al final lo eliminan.
 * Pasar con mocks NO alcanza para dar por resuelto el problema real: la prueba
 * de integración es la que confirma la persistencia.
 */

const amount = (v) => Number(v || 0);
const close = (actual, expected, reason) => expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);

function moneyText(value) {
  // "$ 15.889,97" -> 15889.97
  const raw = String(value || '').replace(/[^\d,.-]/g, '');
  if (!raw) return null;
  return Number(raw.replace(/\./g, '').replace(',', '.'));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function lastCompleteMonth() {
  const now = new Date();
  return monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
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

/** Coeficiente simulado y determinista para las pruebas de interfaz. */
async function simularCoeficiente(page, { coeficiente = 1.6, demoraPorUtilidad = {}, guardados = null } = {}) {
  await page.route('**/api.php?*', async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (action === 'stock_precios_configuracion_obtener') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exito: true, configuracion: { utilidad_deseada_pct: 10 } }) });
      return;
    }
    if (action === 'stock_precios_configuracion_guardar') {
      // Nunca se escribe la configuración real del tenant desde una prueba con mocks.
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch { body = {}; }
      if (guardados) guardados.push(Number(body.utilidad_deseada_pct));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exito: true, configuracion: { utilidad_deseada_pct: Number(body.utilidad_deseada_pct) } }) });
      return;
    }
    if (action === 'stock_coeficiente_ponderado') {
      const utilidad = Number(url.searchParams.get('utilidad_pct') || 10);
      const demora = Number(demoraPorUtilidad[utilidad] || 0);
      if (demora) await new Promise((resolve) => setTimeout(resolve, demora));
      const periodo = url.searchParams.get('periodo') || lastCompleteMonth();
      const coef = coeficiente + (utilidad - 10) / 100;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exito: true, data: {
          periodo, periodo_predeterminado: lastCompleteMonth(), mes_en_curso: false, disponible: true,
          compras_mercaderia: 1000, gastos_fijos: (coeficiente - 1.1) * 1000, gastos_variables: 0,
          incidencia_estructura_pct: (coeficiente - 1.1) * 100, utilidad_deseada_pct: utilidad,
          coeficiente_ponderado: coef, advertencia: null,
        } }),
      });
      return;
    }
    await route.continue();
  });
}

async function abrirAltaPrecios(page) {
  // Mismo acceso que el resto de la suite de Stock: tolera el corte transitorio
  // del gate de sesión de Hostinger usando sólo su botón real "Reintentar".
  const agregar = await openStockPanelWithSessionRecovery(page);
  await agregar.click();
  const dialog = await waitDialog(page, 'Productos');
  await openStockEditorTab(dialog, 'prices');
  await expect(dialog.getByTestId('stock-coeficiente-ponderado')).toBeVisible();
  await expect(dialog.getByTestId('stock-coeficiente-valor')).not.toHaveText(/Calculando/i);
  return dialog;
}

async function cerrarDialogo(dialog) {
  await dialog.getByRole('button', { name: /Cancelar/i }).last().click();
  await expect(dialog).toBeHidden();
}

test.describe('@stock @pricing @mock precios: comas, centavos y coeficiente en la interfaz', () => {
  test('alta: coma decimal, re-edición del costo formateado y precio sugerido', async ({ page }) => {
    await simularCoeficiente(page, { coeficiente: 1.6 });
    const dialog = await abrirAltaPrecios(page);
    const cost = dialog.locator('input[name="precio_costo"]');
    const price = dialog.locator('input[name="precio"]');
    const sugerido = dialog.getByTestId('stock-precio-sugerido');

    await cost.click();
    await cost.pressSequentially('9870,50');
    await price.click();
    await expect(cost).toHaveValue(/9\.870,50/);
    await expect.poll(async () => moneyText(await sugerido.innerText())).toBeCloseTo(9870.5 * 1.6, 2);

    // Re-edición del valor ya formateado ("$ 9.870,50"): antes se interpretaba 9,87.
    await cost.click();
    await cost.press('End');
    await cost.press('Backspace');
    await cost.pressSequentially('9');
    await expect.poll(async () => moneyText(await sugerido.innerText())).toBeCloseTo(9870.59 * 1.6, 2);
    await price.click();
    await expect(cost).toHaveValue(/9\.870,59/);

    // Punto del teclado numérico como separador decimal.
    await cost.fill('');
    await cost.pressSequentially('1250.5');
    await price.click();
    await expect(cost).toHaveValue(/1\.250,50/);

    // Aplicar el precio sugerido y verificar el margen REAL sobre precio de venta.
    await dialog.getByRole('button', { name: /Aplicar al precio de venta/i }).click();
    const esperado = Number((1250.5 * 1.6).toFixed(2));
    await expect.poll(async () => moneyText(await price.inputValue())).toBeCloseTo(esperado, 2);
    const marginPct = dialog.locator('input[name="margen_venta_porcentaje"]');
    const marginValue = dialog.locator('input[name="margen_venta_valor"]');
    expect(moneyText(await marginPct.inputValue())).toBeCloseTo(((esperado - 1250.5) / esperado) * 100, 2);
    expect(moneyText(await marginValue.inputValue())).toBeCloseTo(esperado - 1250.5, 2);

    // Un precio de venta cargado a mano no se pisa al cambiar el costo.
    await price.fill('3000');
    await price.blur();
    await cost.fill('1300');
    await cost.blur();
    await expect(price).toHaveValue(/3\.000,00/);
    expect(moneyText(await marginPct.inputValue())).toBeCloseTo(((3000 - 1300) / 3000) * 100, 2);

    await cerrarDialogo(dialog);
  });

  test('mes base predeterminado = último mes completo y no se ofrecen meses futuros', async ({ page }) => {
    await simularCoeficiente(page);
    const pedidos = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.searchParams.get('action') === 'stock_coeficiente_ponderado') pedidos.push(url.searchParams.get('periodo'));
    });
    const dialog = await abrirAltaPrecios(page);
    const mes = dialog.getByTestId('stock-coeficiente-mes');
    await expect(mes).toHaveValue(lastCompleteMonth());
    await expect(mes).toHaveAttribute('max', monthKey(new Date()));
    // Sin elección explícita el frontend no envía `periodo`: decide el backend.
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.every((p) => p === null)).toBe(true);
    await cerrarDialogo(dialog);
  });

  test('utilidad deseada: no pierde teclas, ignora respuestas viejas y sólo se guarda al confirmar', async ({ page }) => {
    const guardados = [];
    // La respuesta para la utilidad intermedia "1" llega DESPUÉS que la de "15".
    await simularCoeficiente(page, { coeficiente: 1.6, demoraPorUtilidad: { 1: 2_000 }, guardados });
    const dialog = await abrirAltaPrecios(page);
    const cost = dialog.locator('input[name="precio_costo"]');
    await cost.fill('1000');
    await cost.blur();

    const utilidad = dialog.getByTestId('stock-coeficiente-utilidad');
    await utilidad.click();
    await utilidad.fill('');
    await utilidad.pressSequentially('1');
    // Más que el debounce del cálculo: el input no debe deshabilitarse ni perder foco.
    await expect(dialog.getByTestId('stock-coeficiente-valor')).toHaveText(/Calculando/i);
    await expect(utilidad).toBeFocused();
    await utilidad.pressSequentially('5');
    await expect(utilidad).toHaveValue('15');
    await expect(utilidad).toBeFocused();

    // Coeficiente esperado con 15%: 1,6 + 0,05 = 1,65. La respuesta tardía de "1" no lo pisa.
    const sugerido = dialog.getByTestId('stock-precio-sugerido');
    await expect.poll(async () => moneyText(await sugerido.innerText()), { timeout: 10_000 }).toBeCloseTo(1650, 2);
    await page.waitForTimeout(2_200); // deja llegar la respuesta lenta de "1" (verificación negativa)
    expect(moneyText(await sugerido.innerText())).toBeCloseTo(1650, 2);
    expect(guardados, 'la utilidad no se persiste mientras se escribe').toEqual([]);

    await utilidad.press('Enter');
    await expect.poll(() => guardados.slice()).toEqual([15]);
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

    const coefBody = expectApiSuccess(await authenticatedApi(page, 'stock_coeficiente_ponderado', { query: { _: Date.now() } }));
    const coef = coefBody?.data || coefBody || {};

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

      if (coef.disponible) {
        const esperado = Number((5162.5 * Number(coef.coeficiente_ponderado)).toFixed(2));
        await expect.poll(async () => moneyText(await dialog.getByTestId('stock-precio-sugerido').innerText()))
          .toBeCloseTo(esperado, 2);
      }

      await price.click();
      await expect(cost).toHaveValue('5162,50');
      await expect(price).toHaveValue(/^10300(,00)?$/);
      expect(moneyText(await dialog.locator('input[name="margen_venta_porcentaje"]').inputValue()))
        .toBeCloseTo(((10300 - 5162.5) / 10300) * 100, 2);
      expect(moneyText(await dialog.locator('input[name="margen_venta_valor"]').inputValue()))
        .toBeCloseTo(10300 - 5162.5, 2);

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
      await dialog2.getByRole('button', { name: /Cancelar/i }).last().click();
      await expect(dialog2).toBeHidden();
    } finally {
      await deleteUnusedStockProduct(page, name).catch(() => null);
    }
  });
});

test.describe('@stock @pricing @api coeficiente ponderado (sólo lectura, backend real)', () => {
  test('mes base predeterminado = último mes completo y fórmula del contador intacta', async ({ page }) => {
    // Sólo lectura: no requiere mutaciones. Requiere el backend_fix desplegado.
    const body = expectApiSuccess(await authenticatedApi(page, 'stock_coeficiente_ponderado', { query: { _: Date.now() } }));
    const c = body?.data || body || {};
    expect(c.periodo).toBe(lastCompleteMonth());
    expect(c.periodo_predeterminado).toBe(lastCompleteMonth());
    expect(c.mes_en_curso).toBe(false);
    if (c.disponible) {
      const esperado = 1 + (amount(c.gastos_fijos) + amount(c.gastos_variables)) / amount(c.compras_mercaderia)
        + amount(c.utilidad_deseada_pct) / 100;
      expect(amount(c.coeficiente_ponderado)).toBeCloseTo(esperado, 5);
    }

    const actual = monthKey(new Date());
    const enCurso = expectApiSuccess(await authenticatedApi(page, 'stock_coeficiente_ponderado', { query: { periodo: actual, _: Date.now() } }));
    const e = enCurso?.data || enCurso || {};
    expect(e.periodo).toBe(actual);
    expect(e.mes_en_curso).toBe(true);
    if (e.disponible) expect(String(e.advertencia || '')).toMatch(/en curso/i);
  });
});
