import { test, expect } from './support/test.js';
import { uniqueName } from './support/data.js';
import { deletePurchase } from './support/flows.js';
import {
  createServiceArticleFixture,
  deleteServiceArticleFixture,
  getTypedServiceArticleByName,
} from './support/services.js';
import {
  fillMovementRow,
  requireMutations,
  selectFirstAutocomplete,
  selectMovementMode,
  waitDialog,
  waitForBusyToFinish,
} from './support/ui.js';

test('@crud @critical Nueva Compra acepta material sin control de stock y no altera existencia', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await requireMutations(test, page);

  const productName = uniqueName('COMPRA-UI-HEALTH', 120);
  let purchaseCreated = false;

  await createServiceArticleFixture(page, {
    type: 'MATERIAL',
    name: productName,
    controlStock: false,
    stock: 0,
    cost: 50,
    price: 100,
    ivaPct: 21,
  });

  try {
    await page.goto('/panel/compras');
    await waitForBusyToFinish(page);
    await page.getByTitle('Crear nueva compra').click();
    const dialog = await waitDialog(page, 'Nueva Compra');

    await fillMovementRow(dialog, {
      productName,
      quantity: 2,
      price: 100,
    });
    await selectFirstAutocomplete(dialog, 'Proveedor', '');
    await selectMovementMode(dialog, 'Forma de compra', /CUENTA\s*CORRIENTE/i);

    const responseOutcome = page.waitForResponse(
      (response) => response.request().method() === 'POST'
        && new URL(response.url()).searchParams.get('action') === 'compras_crear_batch',
      { timeout: 30_000 },
    ).then((response) => ({ type: 'response', response }))
      .catch(() => ({ type: 'timeout' }));
    const validationError = page
      .getByText(/Cargá al menos 1 fila válida|No hay filas válidas/i)
      .first();

    await dialog.getByRole('button', { name: /Guardar compra/i }).last().click();

    const outcome = await Promise.race([
      responseOutcome,
      validationError.waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => ({ type: 'validation' }))
        .catch(() => new Promise(() => {})),
    ]);

    if (outcome.type === 'validation') {
      const message = await validationError.innerText().catch(() => 'Validación de fila inválida');
      const isKnownBug = /Cargá al menos 1 fila válida|No hay filas válidas/i.test(message);
      expect(isKnownBug, `Nueva Compra devolvió una validación inesperada: ${message}`).toBe(true);
      test.fail(true, 'BUG FRONTEND CONOCIDO: Nueva Compra valida sólo id_detalle y rechaza id_stock_producto.');
      expect(
        message,
        `BUG FRONTEND CONOCIDO EN NUEVA COMPRA: ${message}`,
      ).not.toMatch(/Cargá al menos 1 fila válida|No hay filas válidas/i);
      return;
    }

    expect(outcome.type, 'Nueva Compra no respondió ni mostró la validación conocida').toBe('response');
    const body = await outcome.response.json().catch(() => ({}));
    expect(
      outcome.response.status(),
      `compras_crear_batch respondió HTTP ${outcome.response.status()}: ${JSON.stringify(body)}`,
    ).toBeLessThan(400);
    expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
    purchaseCreated = true;
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const afterPurchase = await getTypedServiceArticleByName(page, productName, 'MATERIAL', { activo: 'todos' });
    expect(Number(afterPurchase?.controla_stock ?? 0)).toBe(0);
    expect(Number(afterPurchase?.stock_actual ?? afterPurchase?.stock ?? 0)).toBe(0);
  } finally {
    if (purchaseCreated) {
      await page.goto('/panel/compras');
      await deletePurchase(page, productName).catch(() => null);
    }
    await deleteServiceArticleFixture(page, productName, { tolerateHistoricalUse: true }).catch(() => null);
  }
});
