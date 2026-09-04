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

    // Algunos formularios reconstruyen el <select> inmediatamente después del
    // onChange. La comprobación anterior puede alcanzar al nodo viejo y dar un
    // falso positivo. Esperamos un instante y verificamos de nuevo el locator
    // (que resuelve el nodo React actual) antes de considerar estable la selección.
    await select.page().waitForTimeout(180);
    await expect(select).toHaveValue(candidate.value, { timeout: 2_500 });

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
  let selected = null;

  // En Recibos/OP el bloque de pagos se hidrata en paralelo y React puede
  // reemplazar el selector justo después de elegir una opción. Reintentamos la
  // selección completa y exigimos que permanezca estable sobre el nodo actual.
  await expect(async () => {
    const select = scope.locator('.gm-payment-row--method select').first();
    selected = await waitAndSelectOption(
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

    await scope.page().waitForTimeout(350);
    const freshSelect = scope.locator('.gm-payment-row--method select').first();
    await expect(freshSelect).toHaveValue(selected.value, { timeout: 3_000 });
  }).toPass({
    timeout: 30_000,
    intervals: [200, 400, 800, 1_200],
  });

  return selected;
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

export async function selectProduct(scope, productName, options = {}) {
  const productInput = scope
    .locator([
      'input[placeholder*="producto" i]',
      'input[placeholder*="material" i]',
      'input[placeholder*="descripción" i]',
      'input[placeholder*="detalle" i]',
    ].join(','))
    .first();

  await expect(productInput).toBeVisible();
  await productInput.fill(productName);

  const list = scope.page().locator('#psa-portal-list');
  await expect(list).toBeVisible({ timeout: 12_000 });

  const item = list
    .locator('.psa-item, li')
    .filter({ hasText: productName })
    .first();

  await expect(
    item,
    `Debe aparecer el producto "${productName}" en el autocompletado`
  ).toBeVisible({ timeout: 15_000 });

  await item.click();

  if (options.expectSelected !== false) {
    await expect(productInput).toHaveValue(new RegExp(productName, 'i'));
  }
  return productInput;
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

export async function fillMovementRow(dialog, data) {
  const row = dialog.locator('.gm-table-body .gm-table-row').first();
  await expect(row).toBeVisible();

  if (data.productName) {
    await selectProduct(row, data.productName);
  } else if (data.description) {
    const input = row
      .locator('input[placeholder*="descripción" i], input[placeholder*="detalle" i]')
      .first();
    await input.fill(data.description);
  }

  const qty = row.locator('input[type="number"]').first();
  if (await qty.isVisible().catch(() => false)) {
    await qty.fill(String(data.quantity ?? 1));
    await qty.blur();
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

export async function searchRow(page, query, placeholderPattern = /Buscar/i) {
  const queryText = String(query ?? '').trim();
  const isStockPage = /\/panel\/stock(?:[/?#]|$)/i.test(page.url());
  const rows = () => page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)');

  const assertNoBackendError = async () => {
    const backendError = page.locator('body').getByText(
      /SQLSTATE|Invalid parameter number|Error interno|Fatal error/i,
    ).first();
    await expect(backendError).toHaveCount(0);
  };

  const resolveVisibleRow = async (timeout = 7_000) => {
    const currentRows = rows();
    const rowWithVisibleText = currentRows.filter({ hasText: queryText }).first();

    if (
      queryText &&
      await rowWithVisibleText.isVisible({ timeout: Math.min(2_500, timeout) }).catch(() => false)
    ) {
      return rowWithVisibleText;
    }

    // Algunos listados buscan por datos que no quedan impresos literalmente en
    // la fila. En esos casos la primera fila del resultado filtrado es válida.
    const firstFilteredRow = currentRows.first();
    if (await firstFilteredRow.isVisible({ timeout }).catch(() => false)) {
      return firstFilteredRow;
    }

    return null;
  };

  const stockModeIsInactive = async () => {
    if (!isStockPage) return false;
    return page
      .getByRole('button', { name: /Ver activos/i })
      .first()
      .isVisible()
      .catch(() => false);
  };

  const waitStockListResponse = (expectedInactive, expectedQuery = null, timeout = 7_000) => {
    if (!isStockPage) return null;

    return page.waitForResponse(
      (response) => {
        try {
          if (response.request().method() !== 'GET') return false;
          const url = new URL(response.url());
          if (url.searchParams.get('action') !== 'stock_productos_listar') return false;
          if (url.searchParams.get('activo') !== (expectedInactive ? '0' : '1')) return false;

          if (expectedQuery !== null) {
            return String(url.searchParams.get('buscar') || '').trim() === String(expectedQuery).trim();
          }

          return true;
        } catch {
          return false;
        }
      },
      { timeout },
    ).catch(() => null);
  };

  const performSearch = async ({ force = false, timeout = 7_000 } = {}) => {
    const search = page.getByPlaceholder(placeholderPattern).first();
    await expect(search).toBeVisible({ timeout: 5_000 });

    const inactive = await stockModeIsInactive();
    const currentValue = String(await search.inputValue().catch(() => '')).trim();
    let responsePromise = null;

    // Stock usa debounce + requestId para descartar respuestas viejas. No hay que
    // reescribir el buscador en un bucle: cada escritura puede invalidar la
    // respuesta que estaba por llegar. Sólo disparamos una consulta nueva cuando
    // realmente cambió el valor (o en la recuperación explícita).
    if (isStockPage && (force || currentValue !== queryText)) {
      responsePromise = waitStockListResponse(inactive, queryText, timeout);
    }

    if (force || currentValue !== queryText) {
      if (force && currentValue === queryText) {
        await search.fill('');
        await page.waitForTimeout(50);
      }
      await search.fill(queryText);
      await search.press('Enter').catch(() => {});
    }

    if (responsePromise) {
      const response = await responsePromise;
      if (response && !response.ok()) {
        throw new Error(`La búsqueda de Stock respondió HTTP ${response.status()}.`);
      }
    } else if (isStockPage) {
      // Si el texto ya estaba escrito, el cambio Activos/Bajas es quien dispara
      // el fetch. Dejamos que el debounce/request en curso se estabilice sin
      // volver a tocar el input.
      await page.waitForTimeout(450);
    }

    await waitForBusyToFinish(page);
    await assertNoBackendError();
    return resolveVisibleRow(timeout);
  };

  let row = await performSearch({ timeout: 6_000 });
  if (row) return row;

  if (isStockPage) {
    // Recuperación única y consciente del modo. Un refresh limpia requests React
    // viejas; si estábamos viendo bajas, restauramos ese estado antes de buscar.
    const wasInactive = await stockModeIsInactive();
    await page.reload({ waitUntil: 'domcontentloaded' });

    const searchAfterReload = page.getByPlaceholder(placeholderPattern).first();
    await expect(searchAfterReload).toBeVisible({ timeout: 7_000 });

    if (wasInactive) {
      const showInactive = page.getByRole('button', { name: /Ver dados de baja/i }).first();
      await expect(showInactive).toBeVisible({ timeout: 5_000 });
      const inactiveResponsePromise = waitStockListResponse(true, null, 7_000);
      await showInactive.click();
      const inactiveResponse = await inactiveResponsePromise;
      if (inactiveResponse && !inactiveResponse.ok()) {
        throw new Error(`El listado de productos dados de baja respondió HTTP ${inactiveResponse.status()}.`);
      }
      await expect(page.getByRole('button', { name: /Ver activos/i }).first()).toBeVisible({ timeout: 5_000 });
    }

    await waitForBusyToFinish(page);
    row = await performSearch({ force: true, timeout: 7_000 });
    if (row) return row;
  }

  // Fallo real: no escondemos un backend vacío detrás de reintentos infinitos.
  const firstFilteredRow = rows().first();
  await expect(firstFilteredRow).toBeVisible({ timeout: 3_000 });
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
  // reales. Si PW_SKIP_TIENDA_NUBE=1 también se conserva el bloqueo de sync.
  if (page) {
    await page.context().route('**/api.php**', async (route) => {
      const request = route.request();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        await route.continue();
        return;
      }

      const url = new URL(request.url());
      if (ENV.skipTiendaNube) url.searchParams.set('skip_tiendanube_sync', '1');
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
