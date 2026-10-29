import { expect } from '@playwright/test';

// Stock mantiene los datos de cada sección montados pero oculta los campos de
// las pestañas inactivas. Playwright debe abrir la pestaña antes de escribir.
export async function openStockEditorTab(dialog, tab) {
  const labels = {
    general: /^Datos generales$/i,
    prices: /^Precios$/i,
    variants: /^Variantes$/i,
    expiry: /^Vencimientos$/i,
    barcodes: /^Códigos$/i,
  };
  const label = labels[tab];
  if (!label) throw new Error(`Pestaña de Stock desconocida: ${tab}`);
  const button = dialog.getByRole('tab', { name: label });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-selected', 'true');
  return button;
}

export async function fillStockPrices(dialog, { cost, price }) {
  await openStockEditorTab(dialog, 'prices');
  if (cost !== undefined) {
    const input = dialog.locator('input[name="precio_costo"]');
    await expect(input).toBeVisible();
    await input.fill(String(cost));
    await input.blur();
  }
  if (price !== undefined) {
    const input = dialog.locator('input[name="precio"]');
    await expect(input).toBeVisible();
    await input.fill(String(price));
    await input.blur();
  }
}
