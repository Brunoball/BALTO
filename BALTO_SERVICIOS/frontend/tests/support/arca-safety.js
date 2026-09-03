import { expect } from '@playwright/test';

const REAL_ARCA_ACTIONS = new Set([
  'wsfe_emitir',
  'factura_emitir',
  'arca_wsfe_emitir',
]);

const attemptsByPage = new WeakMap();

/**
 * Impide que la suite normal consuma numeración fiscal real. Si un cambio de
 * UI intenta emitir accidentalmente, la petición se corta antes de llegar al
 * backend y el afterEach informa la acción exacta.
 */
export async function installArcaSafetyGuard(page) {
  const attempts = [];
  attemptsByPage.set(page, attempts);

  await page.route('**/api.php**', async (route) => {
    const url = new URL(route.request().url());
    const action = String(url.searchParams.get('action') || '').toLowerCase();

    if (!REAL_ARCA_ACTIONS.has(action)) {
      await route.fallback();
      return;
    }

    attempts.push({
      action,
      method: route.request().method(),
      url: url.pathname,
    });

    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        exito: false,
        ok: false,
        mensaje: `Emisión ARCA bloqueada por Playwright: ${action}`,
      }),
    });
  });

  return attempts;
}

export function assertNoArcaEmissionAttempt(page) {
  const attempts = attemptsByPage.get(page) || [];
  expect(
    attempts,
    `La suite local intentó emitir comprobantes reales: ${JSON.stringify(attempts)}`,
  ).toEqual([]);
}

