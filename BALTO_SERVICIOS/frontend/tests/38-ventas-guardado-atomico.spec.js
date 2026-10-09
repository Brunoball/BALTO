import { test, expect } from './support/test.js';
import { uniqueName, todayISO } from './support/data.js';
import { requireMutations, fillMovementRow, selectFirstAutocomplete, waitDialog, waitForBusyToFinish } from './support/ui.js';
import { createServiceFixture, deleteServiceFixture } from './support/services.js';
import { createParty, deleteSale, directAuthenticatedApi, extractMovementId, findAccountCurrentType, getLists, getSaleDetail } from './internal/support/internal-api.js';

/**
 * Regresión del bug: servicio válido + detalle MANUAL sin precio NO debe
 * registrar solo el servicio. No se permite un guardado parcial ni generar
 * documentos sobre datos incompletos. Sin precio = cero requests de venta.
 */
test('@critical @regression ventas: una fila manual sin precio bloquea TODO el guardado', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);

  const serviceName = uniqueName('E2E-SERVICIO-VENTA-ATOMICA', 120);
  const manualText = uniqueName('E2E-DETALLE-MANUAL-ATOMICO', 120);
  const cliente = await createParty(page, 'client', uniqueName('E2E-CLI-ATOMICO', 120));
  const servicio = await createServiceFixture(page, { name: serviceName, price: 170, baseCost: 30 });
  const typeId = findAccountCurrentType(await getLists(page, 'ventas'));
  let saleId = 0;

  try {
    // Defensa de servidor: incluso forzando un total inventado, no acepta
    // el segundo renglón con precio cero ni crea la venta.
    const invalidApi = await directAuthenticatedApi(page, 'ventas_crear_batch', {
      method: 'POST',
      body: {
        fecha: todayISO(), id_tipo_venta: typeId, id_cliente: cliente.id, medios_pago: [],
        items: [
          { fecha: todayISO(), id_tipo_venta: typeId, id_cliente: cliente.id,
            tipo_item: 'SERVICIO', id_servicio: servicio.id_servicio,
            descripcion: serviceName, cantidad: 1, precio: 170, total: 170 },
          { tipo_item: 'MANUAL', descripcion: manualText,
            cantidad: 1, precio: 0, total: 250 },
        ],
      },
    });
    expect(invalidApi.body?.exito, 'El backend debe rechazar el batch completo').toBe(false);
    expect(extractMovementId(invalidApi.body), 'No puede devolver ID de venta').toBe(0);

    await page.goto('/panel/ventas');
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Nueva Venta/i }).click();
    const dialog = await waitDialog(page, 'Nueva Venta');
    const rowServicio = await fillMovementRow(dialog, { serviceName, quantity: 1 });
    await expect(rowServicio.locator('input.psa-input').first()).toHaveValue(serviceName);
    await selectFirstAutocomplete(dialog, 'Cliente', cliente.name);
    await dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first()
      .locator('select').selectOption(String(typeId));

    await dialog.getByRole('button', { name: /Agregar fila/i }).click();
    const rows = dialog.locator('.gm-table-body .gm-table-row');
    await expect(rows).toHaveCount(2);
    const rowManual = rows.nth(1);
    await rowManual.locator('select[aria-label^="Tipo de ítem fila"]').selectOption('MANUAL');
    await rowManual.getByPlaceholder('Escribí un detalle manual…').fill(manualText);
    // El precio queda expresamente en cero; es la situación real del bug.
    await expect(rowManual.locator('input[inputmode="decimal"]')).toHaveValue(/0,00/);

    // Interceptar cualquier POST evita que incluso una versión rota genere
    // movimientos reales; además permite afirmar que no hubo intento de guardado.
    let invalidRequests = 0;
    const guard = async (route) => {
      invalidRequests += 1;
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ exito: false, mensaje: 'BLOQUEADO POR TEST - GUARDADO PARCIAL' }),
      });
    };
    await page.route(/action=ventas_crear_batch/, guard);
    try {
      await dialog.getByRole('button', { name: /Guardar venta/i }).last().click();
      await expect(page.getByText(/Completá o eliminá las filas incompletas/i).first()).toBeVisible();
      await expect(dialog).toBeVisible();
      expect(invalidRequests, 'No debe existir ningún POST mientras haya una fila sin precio').toBe(0);
    } finally {
      await page.unroute(/action=ventas_crear_batch/, guard);
    }

    // Completar el mismo renglón: ahora debe persistir LOS DOS y no uno solo.
    const price = rowManual.locator('input[inputmode="decimal"]');
    await price.fill('250');
    await price.blur();
    let submittedItems = null;
    const onRequest = (req) => {
      if (req.method() === 'POST' && new URL(req.url()).searchParams.get('action') === 'ventas_crear_batch') {
        submittedItems = req.postDataJSON()?.items;
      }
    };
    page.on('request', onRequest);
    try {
      const responsePromise = page.waitForResponse((res) => res.request().method() === 'POST'
        && new URL(res.url()).searchParams.get('action') === 'ventas_crear_batch', { timeout: 60_000 });
      await dialog.getByRole('button', { name: /Guardar venta/i }).last().click();
      const response = await responsePromise;
      const json = await response.json();
      expect(json?.exito, JSON.stringify(json)).toBe(true);
      saleId = extractMovementId(json);
      expect(saleId).toBeGreaterThan(0);
      expect(submittedItems).toHaveLength(2);
      expect(submittedItems.map((i) => i.tipo_item)).toEqual(['SERVICIO', 'MANUAL']);
      const venta = await getSaleDetail(page, saleId);
      const items = (venta.items_detalle || []).filter((i) => i.tipo_item_db !== 'CONSUMO_ARTICULO');
      expect(items).toHaveLength(2);
      expect(items.some((i) => String(i.descripcion).includes(manualText) && Number(i.precio) === 250)).toBe(true);
    } finally {
      page.off('request', onRequest);
    }
  } finally {
    if (saleId) await deleteSale(page, saleId);
    await deleteServiceFixture(page, servicio.id_servicio);
  }
});
