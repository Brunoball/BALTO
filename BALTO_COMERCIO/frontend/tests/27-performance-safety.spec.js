import { test, expect } from './support/test.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { waitForBusyToFinish } from './support/ui.js';

function actionFromUrl(value) {
  try {
    return new URL(value).searchParams.get('action') || '';
  } catch {
    return '';
  }
}

function createGetProbe(page, watchedActions) {
  const watched = new Set(watchedActions);
  const active = new Map();
  const counts = new Map();
  const concurrentDuplicates = [];

  const onRequest = (request) => {
    if (request.method() !== 'GET') return;
    const action = actionFromUrl(request.url());
    if (!watched.has(action)) return;

    counts.set(action, (counts.get(action) || 0) + 1);

    // Single-flight debe evitar que DOS GET con la URL exacta lleguen a la red
    // mientras el primero sigue pendiente. Una repetición posterior, una vez
    // terminada la anterior, es válida y no se considera caché ni error.
    const key = request.url();
    if ((active.get(key) || 0) > 0) {
      concurrentDuplicates.push({ action, url: key });
    }
    active.set(key, (active.get(key) || 0) + 1);
  };

  const finish = (request) => {
    if (request.method() !== 'GET') return;
    const action = actionFromUrl(request.url());
    if (!watched.has(action)) return;

    const key = request.url();
    const next = (active.get(key) || 0) - 1;
    if (next > 0) active.set(key, next);
    else active.delete(key);
  };

  page.on('request', onRequest);
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);

  return {
    count(action) {
      return counts.get(action) || 0;
    },
    duplicates() {
      return [...concurrentDuplicates];
    },
    stop() {
      page.off('request', onRequest);
      page.off('requestfinished', finish);
      page.off('requestfailed', finish);
    },
  };
}

async function openAndVerifySingleFlight(page, {
  route,
  action,
  visibleText,
  extraActions = [],
}) {
  const watched = [action, ...extraActions];
  const probe = createGetProbe(page, watched);
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'GET' && actionFromUrl(response.url()) === action,
    { timeout: 45_000 },
  );

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded' });

    const response = await responsePromise;
    expect(
      response.status(),
      `${action} respondió HTTP ${response.status()} al abrir ${route}`,
    ).toBeLessThan(400);

    await waitForBusyToFinish(page);
    if (visibleText) {
      await expect(page.locator('body')).toContainText(visibleText, { timeout: 30_000 });
    }

    // Da un margen corto a efectos React que se disparan inmediatamente después
    // de pintar la pantalla, sin convertir esta prueba en un benchmark de tiempo.
    await page.waitForTimeout(500);

    expect(
      probe.duplicates(),
      `No debe haber GET idénticos concurrentes al abrir ${route}`,
    ).toEqual([]);

    expect(
      probe.count(action),
      `${route} debe consultar ${action} al menos una vez`,
    ).toBeGreaterThanOrEqual(1);

    return probe;
  } catch (error) {
    probe.stop();
    throw error;
  }
}

test('@smoke @performance Dashboard: textos actuales y carga sin requests duplicadas', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page);
  const probe = await openAndVerifySingleFlight(page, {
    route: '/panel/dashboard',
    action: 'dashboard_resumen',
    visibleText: 'Panel Contable',
    extraActions: ['global_obtener_listas'],
  });

  try {
    await expect(page.getByText('Caja actual', { exact: true })).toBeVisible();
    await expect(page.getByText('Ingresos mes actual', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Ingresos y egresos del mes actual', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Ventas y egresos/i)).toHaveCount(0);

    // Dashboard ya no debe forzar una segunda carga de listas globales.
    expect(
      probe.count('global_obtener_listas'),
      'Dashboard no debe pedir global_obtener_listas más de una vez durante su carga inicial',
    ).toBeLessThanOrEqual(1);

    // Tampoco corresponde disparar dos resúmenes durante el mismo montaje.
    expect(
      probe.count('dashboard_resumen'),
      'Dashboard no debe pedir dashboard_resumen más de una vez durante su carga inicial',
    ).toBeLessThanOrEqual(1);

    await assertNoCriticalErrors(diagnostics, testInfo);
  } finally {
    probe.stop();
  }
});

test('@smoke @performance lecturas principales no duplican GET simultáneos', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page);

  const cases = [
    {
      route: '/panel/movimientos',
      action: 'movimientos_listar',
      visibleText: 'Movimientos',
    },
    {
      route: '/panel/ventas',
      action: 'ventas_listar',
      visibleText: 'Movs · Ventas',
    },
    {
      route: '/panel/cuentas-corrientes/clientes',
      action: 'cc_saldos_clientes',
      visibleText: 'Clientes',
    },
    {
      route: '/panel/stock',
      action: 'stock_productos_listar',
      visibleText: 'Stock · Productos',
    },
  ];

  for (const current of cases) {
    const probe = await openAndVerifySingleFlight(page, current);
    probe.stop();
  }

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [/Tienda Nube/i, /imagen/i],
  });
});
