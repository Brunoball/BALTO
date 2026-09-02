import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { deleteUnusedStockProduct } from './support/flows.js';
import { requireMutations, searchRow, waitDialog, waitForBusyToFinish } from './support/ui.js';

function requestAction(request) {
  const fromUrl = new URL(request.url()).searchParams.get('action');
  if (fromUrl) return fromUrl;
  try {
    return request.postDataJSON()?.action || '';
  } catch {
    const raw = request.postData() || '';
    const match = raw.match(/(?:^|[&\r\n])action(?:=|%3D)([^&\r\n]+)/i);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
  }
}

async function waitAction(page, action, trigger) {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && requestAction(response.request()) === action,
    { timeout: 120_000 },
  );
  await trigger();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
  return body;
}

async function openVariants(page, parentSku, variantSku) {
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, parentSku, /Buscar por nombre, SKU o variante/i);
  await row.click();
  const variantRow = page.locator('.prod-variantsMiniTable__row').filter({ hasText: variantSku }).first();
  await expect(variantRow).toBeVisible({ timeout: 45_000 });
  return variantRow;
}

test('@stock @crud variantes: alta, atributos, baja, reactivación y eliminación', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(4 * 60_000);
  const productName = uniqueName('STOCK-VARIANTES');
  const parentSku = uniqueSku('PADRE');
  const variantName = uniqueName('VARIANTE-M', 40);
  const variantEditedName = `${variantName}-EDITADA`.slice(0, 55);
  const variantSku = uniqueSku('VARM');
  const attributeName = uniqueName('ATRIBUTO', 32);
  const attributeValue = uniqueName('VALOR', 32);

  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Agregar producto/i }).first().click();
  const dialog = await waitDialog(page, 'Productos');

  await dialog.locator('input[name="nombre"]').fill(productName);
  await dialog.locator('input[name="sku"]').fill(parentSku);
  await dialog.getByLabel('Tiene variantes').check();

  const variantCard = dialog.locator('.cmi-v2-variantCard').first();
  await variantCard.getByPlaceholder(/TALLE M \/ NEGRO/i).fill(variantName);
  await variantCard.getByPlaceholder('SKU', { exact: true }).fill(variantSku);
  await variantCard.locator('input[inputmode="numeric"]').first().fill('6');

  const salePriceField = variantCard.locator('.fl-field').filter({ hasText: /Precio de venta/i }).first();
  await salePriceField.locator('input').fill('250');
  await salePriceField.locator('input').blur();

  await variantCard.getByPlaceholder(/TALLE \/ COLOR \/ MEDIDA/i).fill(attributeName);
  await variantCard.getByPlaceholder(/M \/ NEGRO \/ 80X200/i).fill(attributeValue);

  await waitAction(page, 'stock_productos_crear', async () => {
    await dialog.getByRole('button', { name: /Guardar producto/i }).click();
  });
  await expect(dialog).toBeHidden({ timeout: 120_000 });

  let variantRow = await openVariants(page, parentSku, variantSku);
  await expect(variantRow).toContainText(variantName);
  await expect(variantRow).toContainText(attributeName);
  await expect(variantRow).toContainText(attributeValue);

  // Edición real desde el mismo botón que usa el usuario en Stock.
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  let parentRow = await searchRow(page, parentSku, /Buscar por nombre, SKU o variante/i);
  await parentRow.getByTitle('Editar').click();
  const editDialog = await waitDialog(page, 'Editar producto');
  const variantsTab = editDialog.getByRole('button', { name: /^Variantes$/i });
  if (await variantsTab.isVisible().catch(() => false)) await variantsTab.click();
  const editVariantCard = editDialog
    .locator('.cmi-v2-variantCard')
    .filter({ has: page.locator(`input[value="${variantSku}"]`) })
    .first();
  await expect(editVariantCard).toBeVisible();
  await editVariantCard.getByPlaceholder(/TALLE M \/ NEGRO/i).fill(variantEditedName);
  await editVariantCard.locator('input[inputmode="numeric"]').first().fill('8');
  await waitAction(page, 'stock_productos_actualizar', async () => {
    await editDialog.getByRole('button', { name: /Guardar cambios/i }).click();
  });
  await expect(editDialog).toBeHidden({ timeout: 120_000 });

  variantRow = await openVariants(page, parentSku, variantSku);
  await expect(variantRow).toContainText(variantEditedName);
  await expect(variantRow).toContainText('8');

  await variantRow.getByTitle('Dar de baja variante').click();
  let actionDialog = await waitDialog(page, 'Dar de baja variante');
  await waitAction(page, 'stock_variante_dar_baja', async () => {
    await actionDialog.getByRole('button', { name: /^Dar de baja$/i }).click();
  });

  variantRow = await openVariants(page, parentSku, variantSku);
  await expect(variantRow).toContainText(/Dada de baja/i);
  await waitAction(page, 'stock_variante_reactivar', async () => {
    await variantRow.getByTitle('Dar de alta variante').click();
  });

  variantRow = await openVariants(page, parentSku, variantSku);
  await expect(variantRow).toContainText(/Activa/i);
  await variantRow.getByTitle('Eliminar variante definitivamente').click();
  actionDialog = await waitDialog(page, 'Eliminar variante definitivamente');
  const deleteVariantButton = actionDialog.getByRole('button', {
    name: /^Eliminar definitivamente$/i,
  });
  await expect(deleteVariantButton).toBeEnabled({ timeout: 45_000 });
  await deleteVariantButton.click();
  const finalDialog = await waitDialog(page, 'Confirmación final');
  await waitAction(page, 'stock_variante_eliminar_permanente', async () => {
    await finalDialog.getByRole('button', { name: /Sí, eliminar para siempre/i }).click();
  });

  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  parentRow = await searchRow(page, parentSku, /Buscar por nombre, SKU o variante/i);
  await expect(parentRow).toContainText(productName);
  await deleteUnusedStockProduct(page, productName);
});
