import { expect } from '@playwright/test';
import { authenticatedApi, expectApiSuccess } from './api.js';
import { ENV } from './env.js';
import { RUN_PREFIX } from './data.js';
import {
  fillMovementRow,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  selectProduct,
  waitDialog,
  waitForBusyToFinish,
} from './ui.js';
import { selectPortfolioCheque } from './cheques.js';

function requestAction(request) {
  try {
    return new URL(request.url()).searchParams.get('action') || '';
  } catch {
    return '';
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isStagingInternalTarget() {
  try {
    return new URL(ENV.apiURL).hostname.toLowerCase() === 'balto.3devsnet.com';
  } catch {
    return false;
  }
}

/**
 * Captura el JSON real que genera la UI sin dejar que esa request llegue al
 * backend. Después los tests internos pueden enviar exactamente ese contrato
 * por authenticatedApi para provocar carreras o payloads hostiles de forma
 * determinista. La respuesta 409 existe sólo dentro de Playwright.
 */
async function captureMutationPayload(page, action, trigger) {
  let resolvePayload;
  let rejectPayload;
  const payloadPromise = new Promise((resolve, reject) => {
    resolvePayload = resolve;
    rejectPayload = reject;
  });

  let captured = false;
  const handler = async (route) => {
    const request = route.request();
    if (captured || request.method() !== 'POST' || requestAction(request) !== action) {
      await route.fallback();
      return;
    }

    captured = true;
    try {
      const body = request.postDataJSON();
      if (!body || typeof body !== 'object') throw new Error(`Payload ${action} vacío o inválido.`);
      resolvePayload(clone(body));
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ exito: false, mensaje: 'PW_CAPTURE_ONLY' }),
      });
    } catch (error) {
      rejectPayload(error);
      await route.abort('failed').catch(() => null);
    }
  };

  await page.route('**/api.php**', handler);
  try {
    await trigger();
    return await Promise.race([
      payloadPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`No se capturó ${action}.`)), 30_000)),
    ]);
  } finally {
    await page.unroute('**/api.php**', handler).catch(() => null);
  }
}

async function fillSaleRows(dialog, items) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (index > 0) {
      const before = await dialog.locator('.gm-table-body .gm-table-row').count();
      await dialog.getByRole('button', { name: /Agregar fila/i }).click();
      await expect(dialog.locator('.gm-table-body .gm-table-row')).toHaveCount(before + 1, { timeout: 10_000 });
    }

    const row = dialog.locator('.gm-table-body .gm-table-row').nth(index);
    await expect(row).toBeVisible();
    await selectProduct(row, item.productName);

    const qty = row.locator('input[type="number"]').first();
    await qty.fill(String(item.quantity ?? 1));
    await qty.blur();

    if (item.price !== undefined) {
      const expectedPrice = Number(item.price);
      expect(Number.isFinite(expectedPrice), 'El precio esperado de la venta debe ser numérico').toBeTruthy();

      // Compatibilidad con el contrato viejo (precio editable) y el actual
      // (selector de tipo de precio). El frontend de Ventas ya no expone un
      // input decimal cuando el producto tiene precios configurados.
      const legacyPriceInput = row.locator('input[inputmode="decimal"]').first();
      if (await legacyPriceInput.count()) {
        await legacyPriceInput.fill(String(item.price));
        await legacyPriceInput.blur();
        await expect.poll(async () => Number(String(await legacyPriceInput.inputValue()).replace(',', '.')) || 0, {
          timeout: 10_000,
        }).toBeCloseTo(expectedPrice, 2);
      } else {
        const priceCell = row.locator('.gm-table-cell').nth(2);
        const priceSelector = priceCell.getByRole('button').first();
        await expect(priceSelector, 'La fila de venta debe exponer el selector de precio actual').toBeVisible();

        const readSelectedPrice = async () => {
          const text = String(await priceSelector.innerText()).replace(/\u00a0/g, ' ');
          const matches = text.match(/-?\d[\d.]*,\d{1,2}|-?\d+(?:\.\d+)?/g) || [];
          const raw = matches.at(-1) || '';
          const normalized = raw.includes(',')
            ? raw.replace(/\./g, '').replace(',', '.')
            : raw;
          const value = Number(normalized);
          return Number.isFinite(value) ? value : NaN;
        };

        // Normalmente el producto recién creado ya abre en Precio de Venta.
        // Si en el futuro cambia el precio por defecto, recorremos las opciones
        // con el contrato de teclado del selector hasta hallar el monto esperado.
        const seen = new Set();
        let matched = false;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const selectedText = String(await priceSelector.innerText()).trim();
          const selectedPrice = await readSelectedPrice();
          if (Number.isFinite(selectedPrice) && Math.abs(selectedPrice - expectedPrice) < 0.005) {
            matched = true;
            break;
          }
          if (seen.has(selectedText)) break;
          seen.add(selectedText);
          await priceSelector.press('ArrowRight');
        }

        expect(
          matched,
          `La venta debe ofrecer un precio de ${expectedPrice}; selector actual: ${String(await priceSelector.innerText()).trim()}`,
        ).toBeTruthy();
      }
    }

    if (item.ivaPct !== undefined) {
      const iva = row.locator('select.gm-cell-input--select').first();
      await expect(iva).toBeVisible();
      const target = String(item.ivaPct);
      const options = await iva.locator('option').evaluateAll((nodes) => nodes.map((node) => String(node.value)));
      expect(options, `La venta debe permitir IVA ${target}`).toContain(target);
      await iva.selectOption(target);
      await expect(iva).toHaveValue(target);
    }
  }
}

export async function captureSalePayload(page, { items, clientName = '' }) {
  const normalized = Array.isArray(items) ? items : [];
  expect(normalized.length, 'La captura de venta necesita al menos un ítem').toBeGreaterThan(0);

  await page.goto('/panel/ventas');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const dialog = await waitDialog(page, 'Nueva Venta');
  await fillSaleRows(dialog, normalized);

  await selectFirstAutocomplete(dialog, 'Cliente', clientName);
  const typeSelect = dialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).locator('select').first();
  const selected = await selectFirstNonEmpty(typeSelect, /CUENTA\s*CORRIENTE/i);
  expect(selected.text).toMatch(/CUENTA\s*CORRIENTE/i);

  const payload = await captureMutationPayload(page, 'ventas_crear_batch', async () => {
    const save = dialog.getByRole('button', { name: /Guardar venta/i }).last();
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();
  });

  await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
  return payload;
}

export async function capturePurchasePayloadWithCheque(page, { productName, quantity = 1, price, cheque }) {
  await page.goto('/panel/compras');
  await waitForBusyToFinish(page);
  await page.getByTitle('Crear nueva compra').click();
  const dialog = await waitDialog(page, 'Nueva Compra');

  await fillMovementRow(dialog, { productName, quantity, price });
  await selectFirstAutocomplete(dialog, 'Proveedor');
  const mode = dialog.locator('.gm-field').filter({ hasText: 'Forma de compra' }).locator('select').first();
  const selected = await selectFirstNonEmpty(mode, /CONTADO/i);
  expect(selected.text).toMatch(/CONTADO/i);
  await selectPortfolioCheque(dialog, cheque.numero, cheque.tipo || 'CHEQUE');

  const payload = await captureMutationPayload(page, 'compras_crear_batch', async () => {
    const save = dialog.getByRole('button', { name: /Guardar compra/i }).last();
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();
  });

  await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
  return payload;
}

export function tamperFinancialTotals(payload) {
  const next = clone(payload);
  next.total_bruto = 987654.32;
  next.descuento_monto = 0;
  next.descuento_valor = 0;
  next.descuento_tipo = null;
  next.items = (next.items || []).map((item, index) => ({
    ...item,
    subtotal: 700000 + index,
    iva_monto: 800000 + index,
    total: 900000 + index,
    monto_total: 900000 + index,
  }));
  return next;
}

export function appendInsufficientDuplicateItem(payload, quantity = 999) {
  const next = clone(payload);
  const first = next.items?.[0];
  if (!first) throw new Error('No hay ítem base para provocar rollback.');
  const duplicate = {
    ...clone(first),
    cantidad: quantity,
    subtotal: 1,
    iva_monto: 1,
    total: 2,
    monto_total: 2,
  };
  next.items = [first, duplicate];
  return next;
}

export async function postMutation(page, action, body) {
  return authenticatedApi(page, action, { method: 'POST', body: clone(body) });
}

export function resultSucceeded(result) {
  return Number(result?.status || 0) >= 200
    && Number(result?.status || 0) < 400
    && result?.body?.exito !== false
    && result?.body?.success !== false;
}

export function expectExactlyOneSuccess(results, label) {
  const successes = results.filter(resultSucceeded);
  const failures = results.filter((result) => !resultSucceeded(result));
  expect(successes, `${label}: debe existir exactamente una operación ganadora`).toHaveLength(1);
  expect(failures, `${label}: la segunda operación debe ser rechazada`).toHaveLength(1);
  expect(Number(failures[0]?.status || 0), `${label}: el perdedor debe ser un rechazo HTTP`).toBeGreaterThanOrEqual(400);
  return { success: successes[0], failure: failures[0] };
}

export async function runConcurrentMutation(page, action, body) {
  const secondPage = await page.context().newPage();
  try {
    await secondPage.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
    return await Promise.all([
      postMutation(page, action, body),
      postMutation(secondPage, action, body),
    ]);
  } finally {
    await secondPage.close().catch(() => null);
  }
}

export async function runSequentialMutations(page, action, body, count) {
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const result = await postMutation(page, action, body);
    expectApiSuccess(result, `${action} #${index + 1} del stress determinista`);
    results.push(result);
  }
  return results;
}

export function tagForAudit(value) {
  return `${RUN_PREFIX}-${String(value || 'INTERNAL').replace(/[^A-Z0-9]+/gi, '-').toUpperCase()}`.slice(0, 70);
}
