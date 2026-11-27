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

// Recuadro "Rentabilidad bruta del producto" de la pestaña Precios.
// Desde el 27/11/2026 ganancia, margen y recargo (y ganancia/margen de la promo)
// son INPUTS editables: fuera de foco su valor es el texto formateado
// ("$ 6.627,27", "47,34%", "—"), por eso se leen con toHaveValue / inputValue.
export function stockProfitability(dialog) {
  const box = dialog.getByTestId('stock-rentabilidad');
  return {
    box,
    profit: dialog.getByTestId('stock-rentabilidad-ganancia'),
    margin: dialog.getByTestId('stock-rentabilidad-margen'),
    markup: dialog.getByTestId('stock-rentabilidad-recargo'),
    warning: dialog.getByTestId('stock-rentabilidad-alerta'),
    loss: dialog.getByTestId('stock-rentabilidad-perdida'),
    promoBox: dialog.getByTestId('stock-rentabilidad-promo'),
    promoProfit: dialog.getByTestId('stock-rentabilidad-promo-ganancia'),
    promoMargin: dialog.getByTestId('stock-rentabilidad-promo-margen'),
    promoWarning: dialog.getByTestId('stock-rentabilidad-promo-alerta'),
  };
}

export async function expectStockProfitability(dialog, { profit, margin, markup }) {
  const r = stockProfitability(dialog);
  if (profit !== undefined) await expect(r.profit).toHaveValue(profit);
  if (margin !== undefined) await expect(r.margin).toHaveValue(margin);
  if (markup !== undefined) await expect(r.markup).toHaveValue(markup);
}

/**
 * Edita un indicador de rentabilidad como lo haría el comerciante: foco,
 * borra, escribe tecla por tecla y confirma con Enter (o deja el foco si
 * `confirm` es false). El precio del bloque se recalcula en vivo.
 */
export async function editStockProfitability(indicator, text, { confirm = 'Enter' } = {}) {
  await expect(indicator).toBeEditable();
  await indicator.click();
  await indicator.fill('');
  await indicator.pressSequentially(String(text));
  if (confirm) await indicator.press(confirm);
}

/** Acciones retiradas junto con el coeficiente ponderado (2026-11-26). */
export const RETIRED_PRICE_ACTIONS = [
  'stock_coeficiente_ponderado',
  'stock_precios_configuracion_obtener',
  'stock_precios_configuracion_guardar',
  'stock_precios_revision_pendiente',
  'stock_precios_revision_aplicar',
  'stock_precios_revision_rechazar',
];

/** Registra las peticiones del navegador a acciones retiradas (deben quedar en 0). */
export function trackRetiredPriceRequests(page) {
  const hits = [];
  page.on('request', (request) => {
    try {
      const action = new URL(request.url()).searchParams.get('action') || '';
      if (RETIRED_PRICE_ACTIONS.includes(action)) hits.push(action);
    } catch {
      // URL no parseable (data:, blob:): no es una llamada a la API.
    }
  });
  return hits;
}
