import { expect } from '@playwright/test';
import { ENV, assertExpectedTenant, assertSafeMutationConfiguration } from './env.js';
import { RUN_PREFIX } from './data.js';

export async function gotoAndWait(page, path, expected) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/$/);
  if (expected) {
    await expect(page.getByText(expected, { exact: false }).first()).toBeVisible();
  }
  await waitForBusyToFinish(page);
}

export async function waitForBusyToFinish(scope) {
  const busy = scope.locator('[aria-busy="true"], .mov-skeletonWrap, .gif-carga-container');
  try {
    await busy.first().waitFor({ state: 'hidden', timeout: 15_000 });
  } catch {
    // Algunas pantallas no renderizan loaders o los reemplazan muy rápido.
  }
}

export function dialogByTitle(page, title) {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByText(title, { exact: false }) })
    .last();
}

export async function waitDialog(page, title) {
  const dialog = dialogByTitle(page, title);
  await expect(dialog).toBeVisible();
  return dialog;
}

export function dialogByHeading(page, title, { exact = true } = {}) {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: title, exact }) })
    .last();
}

export async function waitDialogByHeading(page, title, options = {}) {
  const dialog = dialogByHeading(page, title, options);
  await expect(dialog).toBeVisible();
  return dialog;
}


function actionFromUrl(url) {
  try {
    return new URL(url).searchParams.get('action') || '';
  } catch {
    return '';
  }
}

/**
 * Ejecuta una acción que abre/rehidrata un modal y espera las respuestas GET
 * que reconstruyen su estado. En suites largas Hostinger puede tardar >1 s y
 * React llega a pintar controles utilizables antes de aplicar esas respuestas;
 * interactuar en esa ventana hace que selección/medio de pago se vuelvan a 0.
 */
export async function triggerAndWaitForHydration(page, trigger, actions, { timeout = 20_000 } = {}) {
  const wanted = [...new Set((actions || []).filter(Boolean))];
  const startedAt = Date.now();

  const waits = wanted.map((action) =>
    page.waitForResponse(
      (response) => {
        if (response.request().method() !== 'GET') return false;
        if (actionFromUrl(response.url()) !== action) return false;

        // Evita que una respuesta vieja, iniciada antes de abrir el modal,
        // satisfaga la espera cuando la suite completa tiene requests en vuelo.
        try {
          const requestStart = Number(response.request().timing().startTime || 0);
          if (requestStart && requestStart < startedAt) return false;
        } catch {
          // Si timing no estuviera disponible, el action exacto sigue siendo una
          // señal suficientemente específica.
        }
        return true;
      },
      { timeout },
    ),
  );

  await trigger();
  const responses = await Promise.all(waits);
  for (const response of responses) {
    expect(
      response.status(),
      `La hidratación ${actionFromUrl(response.url())} respondió HTTP ${response.status()}`,
    ).toBeLessThan(400);
  }
  return responses;
}

export async function closeDialog(dialog) {
  const cancel = dialog.getByRole('button', { name: /cancelar/i }).last();
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
    await expect(dialog).toBeHidden();
    return;
  }

  const close = dialog.getByRole('button', { name: /cerrar/i }).last();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await expect(dialog).toBeHidden();
  }
}


export async function selectOptionValues(select) {
  await expect(select).toBeVisible();
  return select.locator('option').evaluateAll((nodes) =>
    nodes
      .filter((node) => node.value !== '')
      .map((node) => String(node.value))
  );
}

async function readSelectOptions(select) {
  return select.locator('option').evaluateAll((nodes) =>
    nodes.map((node) => ({
      value: String(node.value || ''),
      text: (node.textContent || '').trim(),
      disabled: Boolean(node.disabled),
    }))
  );
}

async function waitAndSelectOption(select, findCandidate, errorMessage) {
  let selected = null;

  // Las listas globales y los datos del movimiento se cargan en paralelo. En una
  // suite larga React puede mostrar el select con sólo el placeholder durante
  // algunos instantes. Reconsultamos el DOM real en cada intento.
  await expect(async () => {
    await expect(select).toBeVisible({ timeout: 5_000 });
    const options = await readSelectOptions(select);
    const candidate = findCandidate(options);
    if (!candidate) throw new Error(errorMessage);

    await select.selectOption(candidate.value, { timeout: 5_000 });
    await expect(select).toHaveValue(candidate.value, { timeout: 5_000 });
    selected = candidate;
  }).toPass({
    timeout: 30_000,
    intervals: [150, 300, 600, 1_000],
  });

  return selected;
}

export async function selectFirstNonEmpty(select, preferredPattern) {
  return waitAndSelectOption(
    select,
    (options) => {
      const usable = options.filter((option) => option.value && !option.disabled);
      if (preferredPattern) {
        const preferred = usable.find((option) => preferredPattern.test(option.text));
        if (preferred) return preferred;
      }
      return usable[0] || null;
    },
    'El selector no tiene opciones utilizables.',
  );
}

export async function selectSafePaymentMethod(scope) {
  const select = scope.locator('.gm-payment-row--method select').first();
  return waitAndSelectOption(
    select,
    (options) => {
      const usable = options.filter((option) => option.value && !option.disabled);
      return (
        usable.find((option) => /EFECTIVO|TRANSFERENCIA|BANCO|TARJETA/i.test(option.text) && !/CHEQ/i.test(option.text)) ||
        usable.find((option) => !/CHEQ/i.test(option.text)) ||
        usable[0] ||
        null
      );
    },
    'No hay medios de pago disponibles.',
  );
}

function moneyInputValue(value) {
  const normalized = String(value || '')
    .replace(/\s/g, '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function completeRemainingAmount(scope) {
  const amount = scope.locator('.gm-payment-row--amount input').first();
  await expect(amount).toBeVisible();

  // “Rest.” también se usa al editar: el campo puede contener el importe viejo
  // (> 0) y todavía quedar una diferencia pendiente. Por eso no alcanza con
  // comprobar que haya un valor; el botón debe quedar deshabilitado (saldo 0).
  // React puede reemplazar botón e input durante el recálculo, así que todos los
  // locators se vuelven a resolver en cada intento.
  await expect(async () => {
    const currentAmount = moneyInputValue(await amount.inputValue());
    const complete = scope.getByTitle(/Completar importe restante/i).first();
    const visible = await complete.isVisible().catch(() => false);

    if (!visible) {
      if (currentAmount > 0) return;
      throw new Error('No apareció el botón para completar el importe restante.');
    }

    const enabled = await complete.isEnabled().catch(() => false);
    if (!enabled) {
      if (currentAmount > 0) return;
      throw new Error('El importe restante todavía no puede completarse.');
    }

    const before = currentAmount;
    await complete.click({ timeout: 5_000 });

    await expect.poll(
      async () => {
        const freshAmount = scope.locator('.gm-payment-row--amount input').first();
        const freshComplete = scope.getByTitle(/Completar importe restante/i).first();
        const value = moneyInputValue(await freshAmount.inputValue());
        const stillEnabled = await freshComplete.isEnabled().catch(() => false);
        return value > before || (value > 0 && !stillEnabled);
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    ).toBeTruthy();
  }).toPass({
    timeout: 20_000,
    intervals: [150, 300, 600, 1_000],
  });
}

export async function fillPayment(scope) {
  await selectSafePaymentMethod(scope);
  await completeRemainingAmount(scope);
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function selectFirstAutocomplete(scope, labelText, preferredText = '') {
  const candidates = scope.locator('.ga-wrap');
  const count = await candidates.count();
  let wrap = null;

  for (let index = 0; index < count; index += 1) {
    const current = candidates.nth(index);
    const parentText = await current.locator('xpath=..').innerText().catch(() => '');
    const ownText = await current.innerText().catch(() => '');
    if (new RegExp(labelText, 'i').test(`${parentText} ${ownText}`)) {
      wrap = current;
      break;
    }
  }
  if (!wrap) wrap = candidates.first();

  const input = wrap.locator('input').first();
  await expect(input).toBeVisible();
  await input.click();

  const requested = String(preferredText || '').trim();
  if (requested) await input.fill(requested);

  const options = scope.page().locator('#ga-portal-list .ga-item:not(.is-empty)');
  await expect(options.first()).toBeVisible({ timeout: 12_000 });

  let option = null;
  let text = '';

  if (requested) {
    const matching = options
      .filter({ hasText: new RegExp(escapeRegExp(requested), 'i') })
      .filter({ hasNotText: /agregar/i })
      .first();
    await expect(
      matching,
      `Debe existir ${labelText} "${requested}" en el autocompletado`,
    ).toBeVisible({ timeout: 15_000 });
    option = matching;
    text = (await matching.innerText()).trim();
  } else {
    // La opción de alta se renderiza de inmediato, pero las listas globales pueden
    // terminar de hidratarse unos instantes después de abrir el modal. Esperamos
    // explícitamente una opción real para no confundir esa carga asincrónica con
    // una base sin clientes/proveedores existentes.
    const existingOptions = options.filter({ hasNotText: /agregar/i });
    await expect(
      existingOptions.first(),
      `Debe existir al menos un ${labelText} real en el autocompletado`,
    ).toBeVisible({ timeout: 30_000 });

    option = existingOptions.first();
    text = (await option.innerText()).trim();
  }

  if (!option) {
    throw new Error(`No hay ${labelText} existentes para seleccionar; sólo aparece la opción de alta.`);
  }

  await option.click();
  return text;
}

async function selectCatalogItem(scope, itemName, kind, options = {}) {
  // Ventas y Otros Ingresos exponen un selector explícito de tipo de ítem.
  // Elegimos primero la categoría para que el input/autocomplete correcto esté montado.
  const typeSelect = scope.locator('select[aria-label^="Tipo de ítem fila"]').first();
  if (await typeSelect.isVisible().catch(() => false)) {
    const desiredValue = await typeSelect.locator('option').evaluateAll((opts, requestedKind) => {
      const matcher = String(requestedKind || '').toLowerCase() === 'servicio'
        ? /servicio/i
        : /stock|material|insumo|producto|art[ií]culo/i;
      const match = opts.find((opt) => matcher.test(String(opt.textContent || '')));
      return match?.value || '';
    }, kind);

    if (desiredValue) {
      await typeSelect.selectOption(desiredValue);
    }
  }

  const productInput = scope
    .locator([
      'input.psa-input',
      'input[placeholder*="servicio" i]',
      'input[placeholder*="stock" i]',
      'input[placeholder*="producto" i]',
      'input[placeholder*="material" i]',
      'input[placeholder*="insumo" i]',
      'input[placeholder*="artículo" i]',
      'input[placeholder*="descripción" i]',
      'input[placeholder*="detalle" i]',
    ].join(','))
    .first();

  await expect(productInput).toBeVisible({ timeout: 15_000 });

  const wrap = productInput
    .locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " psa-wrap ")]')
    .first();
  const kindButton = wrap
    .getByRole('button', { name: new RegExp(`^${kind}$`, 'i') })
    .first();

  // Ventas usa un catálogo combinado y arranca en "Servicio". El toggle recién
  // aparece cuando terminaron de hidratarse ambos catálogos; el helper anterior
  // lo comprobaba durante 800 ms y escribía en Servicio antes de que apareciera
  // "Stock". En inputs exclusivos (Compras/Otros ingresos) no hay toggle.
  const placeholder = String(await productInput.getAttribute('placeholder') || '');
  const combinedCatalog = /servicio.*stock|stock.*servicio/i.test(placeholder);
  if (combinedCatalog) {
    await expect(
      kindButton,
      `Debe habilitarse el selector de tipo "${kind}" en el catálogo combinado`,
    ).toBeVisible({ timeout: 15_000 });

    const isActive = await kindButton.evaluate((button) => button.classList.contains('is-active'));
    if (!isActive) await kindButton.click();
    await expect(kindButton).toHaveClass(/is-active/, { timeout: 10_000 });
  }

  await productInput.click();
  await productInput.fill(itemName);

  const list = scope.page().locator('#psa-portal-list');
  await expect(list).toBeVisible({ timeout: 15_000 });

  const item = list
    .locator('.psa-item, li')
    .filter({ hasText: itemName })
    .first();

  await expect(
    item,
    `Debe aparecer el ${kind.toLowerCase()} "${itemName}" en el autocompletado`,
  ).toBeVisible({ timeout: 20_000 });

  await item.click();

  if (options.expectSelected !== false) {
    await expect(productInput).toHaveValue(new RegExp(itemName, 'i'), { timeout: 10_000 });
  }

  // Espera el commit de onSelect antes de tocar cantidad/precio en la misma fila.
  await productInput.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  return productInput;
}

export async function selectProduct(scope, productName, options = {}) {
  return selectCatalogItem(scope, productName, 'Stock', options);
}

export async function selectService(scope, serviceName, options = {}) {
  return selectCatalogItem(scope, serviceName, 'Servicio', options);
}

function parseDisplayedDecimal(value) {
  const clean = String(value ?? '')
    .replace(/\s/g, '')
    .replace(/\$/g, '');

  if (!clean) return 0;

  // Los inputs monetarios de Balto muestran formato argentino al perder foco
  // (1.234,56), pero durante la edición también pueden exponer 1234.56.
  const normalized = clean.includes(',')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean;
  return Number(normalized);
}

async function fillControlledDecimal(input, value) {
  const expected = Number(value);
  expect(Number.isFinite(expected), `El valor decimal ${value} debe ser numérico`).toBe(true);

  await expect(input).toBeVisible();
  await input.click();
  await expect(input).toBeFocused();

  // Los componentes monetarios cambian de `monto` formateado a `montoDraft`
  // dentro de onFocus. Si Playwright escribe antes de que React confirme ese
  // cambio, el valor anterior puede reaparecer o concatenarse (p. ej. 100100).
  // Dos frames esperan el commit y el repintado sin introducir un sleep fijo.
  await input.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));

  await input.fill(String(value));
  await expect(input).toHaveValue(String(value));
  await input.blur();

  await expect
    .poll(
      async () => parseDisplayedDecimal(await input.inputValue()),
      {
        message: `El input debe conservar el importe ${value} después del recálculo de React`,
        timeout: 10_000,
      },
    )
    .toBeCloseTo(expected, 2);
}

function servicePricePattern(kind) {
  const normalized = String(kind || 'sale').trim().toLowerCase();
  if (['cost', 'costo', 'precio-costo', 'precio_de_costo'].includes(normalized)) {
    return /P\.\s*de\s*COSTO|PRECIO\s+DE\s+COSTO/i;
  }
  return /P\.\s*VENTA|PRECIO\s+DE\s+VENTA/i;
}

export async function selectServicePriceInMovementRow(row, kind = 'sale') {
  const priceCell = row.locator('.gm-table-cell').nth(2);
  const button = priceCell.locator('button').first();
  await expect(button, 'El servicio debe exponer el selector de precio en la tercera columna').toBeVisible({ timeout: 15_000 });
  await expect(button).toBeEnabled();

  const expected = servicePricePattern(kind);
  const matches = async () => expected.test(String(await button.innerText()).replace(/\s+/g, ' '));
  if (await matches()) return button;

  // El selector de Ventas/Presupuestos implementa ArrowLeft/ArrowRight para
  // cambiar de precio sin depender de estilos internos del menú desplegable.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await button.press('ArrowRight');
    await expect.poll(matches, { timeout: 3_000, intervals: [50, 100, 200] }).toBeTruthy().catch(() => null);
    if (await matches()) return button;
  }

  throw new Error(`No se pudo seleccionar el precio de servicio "${kind}". Opciones visibles: ${await priceCell.innerText()}`);
}

export async function fillMovementRow(dialog, data) {
  const row = dialog.locator('.gm-table-body .gm-table-row').first();
  await expect(row).toBeVisible();

  if (data.serviceName) {
    await selectService(row, data.serviceName);
  } else if (data.productName) {
    await selectProduct(row, data.productName);
  } else if (data.description) {
    const typeSelect = row.locator('select[aria-label^="Tipo de ítem fila"]').first();
    if (await typeSelect.isVisible().catch(() => false)) {
      const manualValue = await typeSelect.locator('option').evaluateAll((opts) => {
        const match = opts.find((opt) => /detalle manual|detalle|descripci[oó]n/i.test(String(opt.textContent || '')));
        return match?.value || '';
      });
      if (manualValue) await typeSelect.selectOption(manualValue);
    }

    const input = row
      .locator('input[placeholder*="descripción" i], input[placeholder*="detalle" i]')
      .first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(data.description);
  }

  const qty = row.locator('input[type="number"]').first();
  if (await qty.isVisible().catch(() => false)) {
    await qty.fill(String(data.quantity ?? 1));
    await qty.blur();
  }

  if (data.serviceName && data.servicePriceKind) {
    await selectServicePriceInMovementRow(row, data.servicePriceKind);
  }

  if (data.price !== undefined) {
    const price = row.locator('input[inputmode="decimal"]').first();
    if (await price.isVisible().catch(() => false)) {
      await fillControlledDecimal(price, data.price);
    }
  }

  return row;
}

export async function selectMovementMode(dialog, labelText, preferredPattern) {
  const field = dialog.locator('.gm-field').filter({ hasText: labelText }).first();
  const select = field.locator('select').first();
  return selectFirstNonEmpty(select, preferredPattern);
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es-AR');
}

async function findRowByDetail(page, rows, query, maxRows = 100) {
  const needle = normalizeSearchText(query);
  const count = Math.min(await rows.count(), maxRows);
  for (let index = 0; index < count; index += 1) {
    const candidate = rows.nth(index);
    const info = candidate
      .getByTitle(/Ver información completa|Ver detalle|Información completa/i)
      .first();
    if (!(await info.isVisible({ timeout: 350 }).catch(() => false))) continue;

    await info.click();
    const detail = page.getByRole('dialog').last();
    if (!(await detail.isVisible({ timeout: 3_000 }).catch(() => false))) continue;

    const text = normalizeSearchText(await detail.innerText().catch(() => ''));
    const matches = text.includes(needle);
    const close = detail.getByRole('button', { name: /Cerrar|✕/i }).last();
    if (await close.isVisible({ timeout: 350 }).catch(() => false)) {
      await close.click();
      await expect(detail).toBeHidden({ timeout: 10_000 }).catch(() => null);
    }

    if (matches) return rows.nth(index);
  }
  return null;
}

async function findMovementRowWithoutBrokenSearch(page, query, search) {
  // q= está roto en varios endpoints del backend actual (HY093). Recargamos la
  // ruta para reconstruir la grilla sin q y buscamos el fixture dentro de los
  // detalles, nunca devolviendo "la primera fila" a ciegas.
  const placeholder = String(await search.getAttribute('placeholder') || '');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);

  const freshSearch = placeholder
    ? page.getByPlaceholder(placeholder).first()
    : page.getByPlaceholder(/Buscar/i).first();
  if (await freshSearch.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await freshSearch.fill('');
  }

  const freshRows = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)');
  const direct = freshRows.filter({ hasText: query }).first();
  if (await direct.isVisible({ timeout: 1_500 }).catch(() => false)) return direct;

  return findRowByDetail(page, freshRows, query, 150);
}

export async function searchRow(page, query, placeholderPattern = /Buscar/i) {
  const search = page.getByPlaceholder(placeholderPattern).first();
  await expect(search).toBeVisible();
  await search.fill(query);
  await search.press('Enter');

  await page.waitForTimeout(450);
  await waitForBusyToFinish(page);

  const rows = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)');
  const rowWithVisibleText = rows.filter({ hasText: query }).first();

  if (await rowWithVisibleText.isVisible({ timeout: 2_000 }).catch(() => false)) {
    return rowWithVisibleText;
  }

  const backendError = page.locator('body').getByText(
    /SQLSTATE|Invalid parameter number|Error interno|Fatal error/i,
  ).first();
  const errorText = await backendError.isVisible({ timeout: 500 })
    .then(async (visible) => (visible ? backendError.innerText() : ''))
    .catch(() => '');

  if (/HY093|Invalid parameter number/i.test(errorText)) {
    const fallback = await findMovementRowWithoutBrokenSearch(page, query, search);
    if (fallback) return fallback;
    throw new Error(
      `La búsqueda del módulo falló con ${errorText} y no se pudo localizar de forma segura el registro "${query}" sin usar q.`,
    );
  }

  await expect(backendError).toHaveCount(0);

  // Varias grillas muestran "1 PRODUCTO" en vez del nombre. Además una respuesta
  // sin q puede ganar la carrera y dejar filas extra aunque la API filtrada haya
  // respondido bien. Confirmamos el fixture leyendo el detalle de cada fila.
  const byDetail = await findRowByDetail(page, rows, query, 100);
  if (byDetail) return byDetail;

  const firstFilteredRow = rows.first();
  await expect(firstFilteredRow).toBeVisible({ timeout: 20_000 });
  return firstFilteredRow;
}

export async function clickAndWaitForDialog(button, page, title) {
  await button.click();
  return waitDialog(page, title);
}

export async function clickSaveAndWait(dialog, buttonName, options = {}) {
  const button = dialog.getByRole('button', { name: buttonName }).last();
  await expect(button).toBeEnabled();
  await button.click();
  if (options.waitForClose !== false) {
    await expect(dialog).toBeHidden({ timeout: options.timeout || 45_000 });
  }
}

export async function requireMutations(test, page) {
  test.skip(!ENV.allowMutations, 'PW_ALLOW_MUTATIONS no está habilitado.');
  assertSafeMutationConfiguration();
  await assertExpectedTenant(page);

  // Todas las mutaciones de Playwright llevan e2e_run=PW-... para que la
  // auditoría y el limpiador puedan reconocerlas sin confundirlas con datos
  // reales del tenant de BALTO Servicios.
  if (page) {
    await page.context().route('**/api.php**', async (route) => {
      const request = route.request();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        await route.continue();
        return;
      }

      const url = new URL(request.url());
      url.searchParams.set('e2e_run', RUN_PREFIX);
      await route.continue({ url: url.toString() });
    });
  }
}

export async function assertFrontendUsesConfiguredBackend(page) {
  const expectedHost = new URL(ENV.apiURL).host;
  await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });

  const apiResource = await expect
    .poll(
      async () => {
        const resources = await page.evaluate(() =>
          performance.getEntriesByType('resource').map((entry) => entry.name)
        );
        return resources.find((url) => url.includes('/api.php')) || '';
      },
      {
        message: 'El frontend debe realizar al menos una petición a api.php',
        timeout: 15_000,
      }
    )
    .not.toBe('')
    .then(async () => {
      const resources = await page.evaluate(() =>
        performance.getEntriesByType('resource').map((entry) => entry.name)
      );
      return resources.find((url) => url.includes('/api.php')) || '';
    });

  expect(new URL(apiResource).host).toBe(expectedHost);
}
