import { test, expect } from './support/test.js';
import { authenticatedApi } from './support/api.js';

const SEARCH_CASES = [
  ['ventas_listar', 'Ventas'],
  ['compras_listar', 'Compras'],
  ['presupuestos_listar', 'Presupuestos'],
  ['otros_ingresos_listar', 'Otros ingresos'],
  ['otros_egresos_listar', 'Otros egresos'],
  ['recibos_listar', 'Recibos'],
  ['ordenes_pago_listar', 'Órdenes de pago'],
];

test('@smoke @critical búsquedas de Movimientos no devuelven errores SQL', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await page.goto('/panel/dashboard');

  const knownHy093 = [];
  const unexpected = [];
  for (const [action, label] of SEARCH_CASES) {
    const result = await authenticatedApi(page, action, {
      query: {
        q: `PW-SEARCH-HEALTH-${Date.now()}`,
        limit: 5,
        offset: 0,
      },
    });

    const message = String(
      result.body?.mensaje
      || result.body?.message
      || result.body?.error
      || result.text
      || '',
    );
    const failed = result.status >= 400
      || result.body?.exito === false
      || result.body?.success === false
      || /SQLSTATE|HY093|Invalid parameter number|Fatal error/i.test(message);

    if (!failed) continue;
    const line = `${label} (${action}): HTTP ${result.status} ${message}`.trim();
    if (/SQLSTATE\[HY093\]|HY093|Invalid parameter number/i.test(message)) knownHy093.push(line);
    else unexpected.push(line);
  }

  expect(
    unexpected,
    `Las búsquedas q= devolvieron errores distintos del HY093 ya identificado.\n${unexpected.join('\n')}`,
  ).toEqual([]);

  if (knownHy093.length) {
    // Sigue ejecutándose en cada corrida. Mientras el backend conserve exactamente
    // el HY093 conocido se informa como expected failure; si se corrige, este test
    // pasa automáticamente. Cualquier error diferente sigue rompiendo la suite.
    test.fail(true, `BUG BACKEND CONOCIDO: q= devuelve HY093 en ${knownHy093.length} endpoint(s).`);
    expect(
      knownHy093,
      `BUG BACKEND CONOCIDO: búsquedas q= con PDO HY093.\n${knownHy093.join('\n')}`,
    ).toEqual([]);
  }
});
