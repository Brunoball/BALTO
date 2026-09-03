import { expect } from '@playwright/test';
import { ENV } from './env.js';
import { RUN_PREFIX } from './data.js';
import { searchRow, waitDialog, waitForBusyToFinish } from './ui.js';

function apiPhpUrl() {
  const base = String(ENV.apiURL || '').replace(/\/+$/, '');
  return `${base}/api.php`;
}

export function barcodeEndpointUrl(query = {}) {
  const endpoint = new URL('../modules/stock/codigos_barra/endpoint.php', apiPhpUrl());
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      endpoint.searchParams.set(key, String(value));
    }
  });
  return endpoint.toString();
}

export async function barcodeApi(page, op, options = {}) {
  const method = String(options.method || (options.body ? 'POST' : 'GET')).toUpperCase();
  const query = { ...(options.query || {}), op };
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    query.e2e_run = RUN_PREFIX;
    if (ENV.skipTiendaNube) query.skip_tiendanube_sync = '1';
  }
  const url = barcodeEndpointUrl(query);

  return page.evaluate(async ({ requestUrl, requestMethod, requestBody }) => {
    const sessionKey =
      localStorage.getItem('session_key') ||
      localStorage.getItem('sessionKey') ||
      localStorage.getItem('X-Session') ||
      localStorage.getItem('x_session') ||
      '';
    const token = localStorage.getItem('token') || localStorage.getItem('auth_token') || '';
    const headers = { Accept: 'application/json' };
    if (sessionKey) headers['X-Session'] = sessionKey;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (requestBody !== null) headers['Content-Type'] = 'application/json';

    const response = await fetch(requestUrl, {
      method: requestMethod,
      headers,
      cache: 'no-store',
      body: requestBody === null ? undefined : JSON.stringify(requestBody),
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { status: response.status, ok: response.ok, body, text };
  }, {
    requestUrl: url,
    requestMethod: method,
    requestBody: options.body ?? null,
  });
}

export function expectBarcodeSuccess(result, message = 'La operación de código de barra debe finalizar correctamente') {
  expect(result.status, `${message}: HTTP ${result.status} ${result.text || ''}`).toBeLessThan(400);
  expect(
    result.body?.exito !== false && result.body?.success !== false,
    result.body?.mensaje || result.body?.message || message,
  ).toBeTruthy();
  return result.body;
}

export async function getBarcodeProduct(page, productId) {
  const result = await barcodeApi(page, 'obtener', {
    query: { id_stock_producto: Number(productId) },
  });
  return expectBarcodeSuccess(result, `No se pudieron obtener los códigos del producto #${productId}`);
}

export function uniqueExternalBarcode(kind = 'EXT') {
  const safe = String(kind || 'EXT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 12);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  // Lleva PW- para que cualquier auditoría generada también quede identificada
  // por el limpiador E2E, pero sigue siendo un valor CODE128 válido.
  return `${RUN_PREFIX}-${safe}-${stamp}`.slice(0, 80);
}

export async function simulateBarcodeScan(page, code, options = {}) {
  const terminator = options.terminator === undefined ? 'Enter' : options.terminator;
  const idleMs = Number(options.idleMs ?? 260);
  const extraTerminators = Array.isArray(options.extraTerminators) ? options.extraTerminators : [];

  // page.keyboard.type cruza CDP por cada tecla y su timing puede crecer mucho en
  // modales React pesados (en los traces llegó a tardar ~900 ms para 8 caracteres).
  // Eso no representa una pistola keyboard-wedge y puede partir BL-V-29 en "V-29".
  // Disparamos los keydown dentro del browser en una misma ráfaga y emulamos el
  // efecto de escritura sobre el control enfocado para seguir comprobando que el
  // hook restaura cantidad/precio/cliente después de confirmar la lectura.
  await page.evaluate(async ({ text, suffix, extras }) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const nativeValueSetter = (element, value) => {
      const proto = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor?.set) descriptor.set.call(element, value);
      else element.value = value;
    };

    const emulateDefaultTextInsertion = (target, char, event) => {
      if (event.defaultPrevented) return;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target.disabled || target.readOnly) return;
      if (target instanceof HTMLInputElement) {
        const type = String(target.type || 'text').toLowerCase();
        if (!['text', 'search', 'tel', 'url', 'email', 'password', ''].includes(type)) return;
      }

      const current = String(target.value || '');
      const start = typeof target.selectionStart === 'number' ? target.selectionStart : current.length;
      const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
      const next = `${current.slice(0, start)}${char}${current.slice(end)}`;
      nativeValueSetter(target, next);
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        data: char,
        inputType: 'insertText',
      }));
      try { target.setSelectionRange(start + char.length, start + char.length); } catch {}
    };

    const dispatchKey = (key, emulateText = false) => {
      const target = document.activeElement instanceof Element ? document.activeElement : document.body;
      const down = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      target.dispatchEvent(down);
      if (emulateText) emulateDefaultTextInsertion(target, key, down);
      const up = new KeyboardEvent('keyup', {
        key,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      target.dispatchEvent(up);
    };

    for (const char of String(text)) dispatchKey(char, true);
    if (suffix) dispatchKey(suffix, false);
    for (const extra of extras) dispatchKey(extra, false);
  }, {
    text: String(code),
    suffix: terminator || '',
    extras: extraTerminators.filter(Boolean),
  });

  if (!terminator) {
    // El hook finaliza lectoras sin Enter/Tab por silencio (135 ms actualmente).
    await page.waitForTimeout(idleMs);
  }
}

export async function expectDialogSelectedProduct(dialog, expectedText) {
  const expected = String(expectedText || '').trim().toUpperCase();
  expect(expected).not.toBe('');

  await expect.poll(async () => {
    const values = await dialog.locator('input').evaluateAll((nodes) =>
      nodes.map((node) => String(node.value || '').trim().toUpperCase())
    );
    return values.some((value) => value.includes(expected));
  }, {
    timeout: 20_000,
    intervals: [100, 250, 500, 1_000],
    message: `El modal debe seleccionar automáticamente el producto/variante "${expectedText}" después del escaneo.`,
  }).toBe(true);
}

async function waitStockAction(page, action, trigger) {
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== 'POST') return false;
    const url = new URL(response.url());
    let requestAction = url.searchParams.get('action') || '';
    if (!requestAction) {
      try {
        requestAction = response.request().postDataJSON()?.action || '';
      } catch {
        requestAction = '';
      }
    }
    return requestAction === action;
  }, { timeout: 120_000 });

  await trigger();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
  expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
  return body;
}

export async function createVariantStockProduct(page, product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  expect(variants.length, 'El helper de variantes necesita al menos una variante').toBeGreaterThan(0);

  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  await page.getByRole('button', { name: /Agregar producto/i }).first().click();
  const dialog = await waitDialog(page, 'Productos');

  await dialog.locator('input[name="nombre"]').fill(product.name);
  await dialog.locator('input[name="sku"]').fill(product.sku);
  await dialog.getByLabel('Tiene variantes').check();

  for (let index = 0; index < variants.length; index += 1) {
    if (index > 0) await dialog.getByRole('button', { name: /Agregar variante/i }).click();
    const card = dialog.locator('.cmi-v2-variantCard').nth(index);
    const variant = variants[index];
    await expect(card).toBeVisible();
    await card.getByPlaceholder(/TALLE M \/ NEGRO/i).fill(variant.name);
    await card.getByPlaceholder('SKU', { exact: true }).fill(variant.sku);
    await card.locator('input[inputmode="numeric"]').first().fill(String(variant.stock ?? 5));
    const priceField = card.locator('.cmi-floatingField, .fl-field').filter({ hasText: /Precio de venta/i }).first();
    await priceField.locator('input').fill(String(variant.price ?? 250));
    await priceField.locator('input').blur();
  }

  await waitStockAction(page, 'stock_productos_crear', async () => {
    await dialog.getByRole('button', { name: /Guardar producto/i }).click();
  });
  await expect(dialog).toBeHidden({ timeout: 120_000 });

  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, product.sku, /Buscar por nombre, SKU o variante/i);
  const productId = Number(await row.getAttribute('data-stock-product-id'));
  expect(productId, `El producto ${product.name} debe exponer su ID real`).toBeGreaterThan(0);

  const barcode = await getBarcodeProduct(page, productId);
  const storedVariants = Array.isArray(barcode?.variantes) ? barcode.variantes : [];
  expect(storedVariants.length).toBe(variants.length);

  return { row, productId, barcode, variants: storedVariants };
}

export async function setVariantActiveState(page, parentSku, variantSku, active) {
  await page.goto('/panel/stock');
  await waitForBusyToFinish(page);
  const row = await searchRow(page, parentSku, /Buscar por nombre, SKU o variante/i);
  await row.click();
  const variantRow = page.locator('.prod-variantsMiniTable__row').filter({ hasText: variantSku }).first();
  await expect(variantRow).toBeVisible({ timeout: 45_000 });

  if (active) {
    await waitStockAction(page, 'stock_variante_reactivar', async () => {
      await variantRow.getByTitle('Dar de alta variante').click();
    });
  } else {
    await variantRow.getByTitle('Dar de baja variante').click();
    const dialog = await waitDialog(page, 'Dar de baja variante');
    await waitStockAction(page, 'stock_variante_dar_baja', async () => {
      await dialog.getByRole('button', { name: /^Dar de baja$/i }).click();
    });
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  }
}
