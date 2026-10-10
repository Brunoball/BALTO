import { test, expect } from './support/test.js';
import { todayISO, uniqueName } from './support/data.js';
import { requireMutations, waitDialog, waitForBusyToFinish, fillMovementRow, selectFirstAutocomplete, selectMovementMode } from './support/ui.js';
import { createServiceArticleFixture, deleteServiceArticleFixture, getServiceStock } from './support/services.js';
import { createParty, deletePurchase, directAuthenticatedApi, findAccountCurrentType, getLists, extractMovementId, getPurchaseDetail } from './internal/support/internal-api.js';

// Cada fila nueva comienza en la primera opción del selector (ARTICULO).
// El tipo elegido determina el comportamiento: catálogo no se convierte silenciosamente en manual.
test('@smoke compras: fila nueva inicia en catálogo y detalle manual requiere elección explícita', async ({ page }) => {
  await page.goto('/panel/compras');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Compra/i }).click();
  const dialog = await waitDialog(page, 'Nueva Compra');
  await dialog.getByRole('button', { name: /Agregar fila/i }).click();
  const rows = dialog.locator('.gm-table-body .gm-table-row');
  await expect(rows).toHaveCount(2);
  const segunda = rows.nth(1);
  const tipo = segunda.getByRole('combobox', { name: 'Tipo de ítem de compra' });
  await expect(tipo).toHaveValue('ARTICULO');

  // El catálogo es el estado inicial y no debe ofrecer acciones de conversión automática.
  const buscador = segunda.locator('input.psa-input');
  await buscador.fill('aaaaaaa');
  await expect(tipo).toHaveValue('ARTICULO');
  await expect(dialog.getByRole('button', { name: /Usar este texto como detalle manual/i })).toHaveCount(0);

  // Solo al elegir Manual se puede escribir libremente.
  await tipo.selectOption('MANUAL');
  await segunda.getByPlaceholder('Escribí un detalle manual…').fill('flete personalizado');
  await expect(tipo).toHaveValue('MANUAL');
  await expect(segunda.getByPlaceholder('Escribí un detalle manual…')).toHaveValue('FLETE PERSONALIZADO');
  await dialog.getByRole('button', { name: 'Cerrar' }).first().click();
});

test('@critical @internal compras: artículo válido y manual sin precio bloquean TODO; válido guarda ambos', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const productoNombre = uniqueName('INT-COMPRA-MANUAL-ATOMICA', 120);
  const manualNombre = uniqueName('INT-COMPRA-FLETE-ATOMICO', 120);
  const proveedor = await createParty(page, 'provider', uniqueName('INT-COMPRA-PROV-ATOMICO', 120));
  const articulo = await createServiceArticleFixture(page, { type: 'MATERIAL', name: productoNombre, stock: 7, cost: 90, price: 140 });
  const tipoCuenta = findAccountCurrentType(await getLists(page, 'compras'));
  let compraId = 0;
  try {
    const invalid = await directAuthenticatedApi(page, 'compras_crear_batch', {
      method: 'POST', body: { fecha: todayISO(), id_proveedor: proveedor.id, id_tipo_venta: tipoCuenta, medios_pago: [],
        items: [
          { tipo_item: 'ARTICULO', id_articulo: articulo.id_articulo, descripcion: productoNombre, cantidad: 1, precio: 90, total: 90 },
          { tipo_item: 'MANUAL', descripcion: manualNombre, cantidad: 1, precio: 0, total: 250 },
        ],
      },
    });
    expect(invalid.body?.exito, 'Backend no puede aceptar la compra parcial').toBe(false);
    expect(extractMovementId(invalid.body)).toBe(0);
    expect(await getServiceStock(page, productoNombre)).toBeCloseTo(7, 6);

    await page.goto('/panel/compras');
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Nueva Compra/i }).click();
    const dialog = await waitDialog(page, 'Nueva Compra');
    await fillMovementRow(dialog, { productName: productoNombre, quantity: 1, price: 90 });
    await selectFirstAutocomplete(dialog, 'Proveedor', proveedor.name);
    await selectMovementMode(dialog, 'Forma de compra', /CUENTA\s*CORRIENTE/i);
    await dialog.getByRole('button', { name: /Agregar fila/i }).click();
    const rows = dialog.locator('.gm-table-body .gm-table-row');
    const manual = rows.nth(1);
    const tipoManual = manual.getByRole('combobox', { name: 'Tipo de ítem de compra' });
    await expect(tipoManual).toHaveValue('ARTICULO');
    await tipoManual.selectOption('MANUAL');
    await manual.getByPlaceholder('Escribí un detalle manual…').fill(manualNombre);

    let blocked = 0;
    const guard = async (route) => {
      blocked++;
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ exito: false, mensaje: 'TEST: NO GUARDAR' }) });
    };
    await page.route(/action=compras_crear_batch/, guard);
    try {
      await dialog.getByRole('button', { name: /Guardar compra/i }).last().click();
      await expect(page.getByText(/Completá o eliminá las filas incompletas/i).first()).toBeVisible();
      await expect(dialog).toBeVisible();
      expect(blocked, 'No debe enviarse un POST con un detalle sin precio').toBe(0);
    } finally {
      await page.unroute(/action=compras_crear_batch/, guard);
    }

    const precio = manual.locator('input[inputmode="decimal"]');
    await precio.fill('250');
    await precio.blur();
    let itemsEnviados = null;
    const listener = (req) => {
      if (req.method() === 'POST' && new URL(req.url()).searchParams.get('action') === 'compras_crear_batch') {
        itemsEnviados = req.postDataJSON()?.items;
      }
    };
    page.on('request', listener);
    try {
      const responsePromise = page.waitForResponse((res) => res.request().method() === 'POST'
        && new URL(res.url()).searchParams.get('action') === 'compras_crear_batch', { timeout: 60_000 });
      await dialog.getByRole('button', { name: /Guardar compra/i }).last().click();
      const response = await responsePromise;
      const json = await response.json();
      expect(json?.exito, JSON.stringify(json)).toBe(true);
      compraId = extractMovementId(json);
      expect(compraId).toBeGreaterThan(0);
      expect(itemsEnviados).toHaveLength(2);
      expect(itemsEnviados.map((i) => i.tipo_item)).toEqual(['ARTICULO', 'MANUAL']);
      const compra = await getPurchaseDetail(page, compraId);
      const items = (compra.items_detalle || []).filter((it) => it.tipo_item_db !== 'CONSUMO_ARTICULO');
      expect(items).toHaveLength(2);
      expect(items.some((i) => String(i.descripcion).includes(manualNombre) && Number(i.precio) === 250)).toBe(true);
      expect(await getServiceStock(page, productoNombre)).toBeCloseTo(8, 6);
    } finally {
      page.off('request', listener);
    }
  } finally {
    if (compraId) await deletePurchase(page, compraId);
    await deleteServiceArticleFixture(page, productoNombre, { tolerateHistoricalUse: true }).catch(() => null);
  }
});
