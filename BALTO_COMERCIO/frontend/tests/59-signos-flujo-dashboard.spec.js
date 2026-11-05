import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { todayISO } from './support/data.js';

/**
 * Regresión visual y contable: los saldos NEGATIVOS no pueden convertirse en
 * positivos al formatearlos; el Dashboard no puede mostrar importes parciales
 * mientras otras tarjetas ya muestran el valor final.
 * Tests de sólo lectura / mocks: no crean ni modifican datos.
 */
const close = (actual, expected, message) =>
  expect(Number(actual ?? 0), message).toBeCloseTo(Number(expected ?? 0), 2);

const hasNegativeSign = (value) => /[-\u2212]/.test(String(value ?? ''));

async function mockAction(page, action, payload) {
  await page.route((url) => url.pathname.endsWith('/api.php') && url.searchParams.get('action') === action,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exito: true, ...payload }) }));
}

test('@flujo @ui @critical la tarjeta BANCO y el saldo diario respetan el signo negativo (mock)', async ({ page }) => {
  const hoy = todayISO();
  await mockAction(page, 'flujo_caja_resumen', {
    saldo_actual: -28558.68,
    fecha_saldo_actual: hoy,
    periodo: hoy.slice(0, 7),
    rango: { desde: hoy, hasta: hoy },
    medios_pago_grupos: [],
    ajustes_saldo: { habilitado: false, puede_gestionar: false },
    tiendas: [{
      id_tienda: 0, nombre: 'GENERAL', saldo_base: -28558.68,
      rows: [{
        fecha: hoy, ingresos: 0, egresos: 0, saldo: -28558.68,
        saldo_inicial_aplicado: 0, ajustes_internos: 0, ajustes_manuales: 0,
        medios_pago: [
          { key: 'efectivo', label: 'EFECTIVO', ingresos: 0, egresos: 0, ajustes: 0, saldo: 100000, medios: [{ id_medio_pago: 1, nombre: 'EFECTIVO' }] },
          { key: 'banco', label: 'BANCO', ingresos: 0, egresos: 0, ajustes: 0, saldo: -28558.68, medios: [{ id_medio_pago: 4, nombre: 'BANCO' }] },
        ],
      }],
    }],
  });

  await page.goto('/panel/flujo-de-caja');
  await expect(page.locator('.fc-dayRow').first()).toBeVisible();
  const banco = page.locator('.fc-payCard').filter({ has: page.locator('.fc-payCard__title', { hasText: 'BANCO' }) });
  await expect(banco).toBeVisible();
  const saldoBanco = banco.locator('.fc-payCard__amount');
  await expect(saldoBanco).toHaveClass(/is-negative/);
  expect(await saldoBanco.textContent()).toContain('28.558,68');
  expect(hasNegativeSign(await saldoBanco.textContent()), 'BANCO no puede perder el signo menos').toBe(true);

  const saldoDiario = page.locator('.fc-dayRow').first().locator('.fc-saldo');
  await expect(saldoDiario).toHaveClass(/fc-saldo--neg/);
  expect(hasNegativeSign(await saldoDiario.textContent()), 'La tabla tampoco puede ocultar saldos negativos').toBe(true);
  expect(await saldoDiario.textContent()).toContain('28.558,68');

  // La cabecera del período debe usar el mismo criterio de signo.
  const textoPagina = await page.locator('.mov-page--flujoCaja').textContent();
  expect(textoPagina).toMatch(/Saldo base al inicio del período:/);
  expect(textoPagina).toMatch(/[-\u2212]\s*\$\s*28\.558,68|\$\s*[-\u2212]\s*28\.558,68/);
});

test('@dashboard @ui @critical cifras monetarias exactas desde el primer render, sin contador parcial (mock)', async ({ page }) => {
  const hoy = todayISO();
  await mockAction(page, 'dashboard_resumen', {
    rango: { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy, periodo: hoy.slice(0, 7), label: 'Mes actual' },
    kpis: {
      saldo_caja_actual: 272443.32, saldo_caja_liquido: 272443.32, saldo_caja_documentos: 0,
      saldo_caja_medios: [
        { id_medio_pago: 1, nombre: 'EFECTIVO', tipo: 'monetario', saldo: 100000, activo: true },
        { id_medio_pago: 2, nombre: 'MERCADO PAGO', tipo: 'monetario', saldo: 201000, activo: true },
        { id_medio_pago: 4, nombre: 'BANCO', tipo: 'monetario', saldo: -28558.68, activo: true },
        { id_medio_pago: 7, nombre: 'PERSONAL PAY', tipo: 'monetario', saldo: 2, activo: true },
        { id_medio_pago: 5, nombre: 'CHEQUE', tipo: 'documento', saldo: 0, cantidad: 0, activo: true },
        { id_medio_pago: 6, nombre: 'ECHEQ', tipo: 'documento', saldo: 0, cantidad: 0, activo: true },
      ],
      ingresos_periodo: 0, egresos_periodo: 50000, saldo_periodo: -50000,
      movimientos_periodo: 1, stock_valorizado: 7655974, productos_con_stock: 8,
      clientes_activos: 8, saldo_clientes_cc: 0, proveedores_activos: 3, saldo_proveedores_cc: 0,
    },
    series_diaria: [{ fecha: hoy, label: 'Hoy', ingresos: 0, egresos: 50000, movimientos: 1, saldo: 272443.32 }],
  });

  await page.goto('/panel/dashboard');
  await expect(page.locator('.db[data-balto-dashboard-ready="true"]')).toBeVisible();
  const caja = page.locator('.db-kpi').filter({ hasText: 'Caja actual' }).locator('.db-kpi__value');
  const stock = page.locator('.db-kpi').filter({ hasText: 'Stock valorizado' }).locator('.db-kpi__value');
  const resultado = page.locator('.db-ind-resultado .db-ind-value');
  // La comprobación es inmediata: la animación anterior contaba desde cero
  // durante 850 ms y hacía parecer que los reportes no conciliaban.
  expect(await caja.textContent(), 'Caja debe coincidir INMEDIATAMENTE con el desglose').toContain('272.443,32');
  expect(await stock.textContent(), 'El stock tampoco debe mostrar importes intermedios').toContain('7.655.974,00');
  expect(await resultado.textContent(), 'El flujo neto no debe mostrar valores parciales').toContain('50.000,00');
  expect(hasNegativeSign(await resultado.textContent()), 'Flujo neto negativo debe conservar el signo').toBe(true);
  const banco = page.locator('.db-caja-breakdown [data-medio-id="4"]');
  await expect(banco).toContainText('28.558,68');
  expect(hasNegativeSign(await banco.textContent())).toBe(true);
});

test('@flujo @dashboard @analisis-financiero @critical mismos saldos reales por medio, sin cambiar signos (solo lectura)', async ({ page }) => {
  const hoy = todayISO();
  const query = { fecha_desde: hoy, fecha_hasta: hoy };
  const flujo = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_resumen', { query }));
  const dash = expectApiSuccess(await authenticatedApi(page, 'dashboard_resumen'));
  const af = expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', { query }));

  const fila = flujo?.tiendas?.[0]?.rows?.find((r) => r.fecha === hoy);
  expect(fila, 'Flujo de Caja debe traer el día actual').toBeTruthy();
  const monetarios = (dash.kpis?.saldo_caja_medios || []).filter((m) => m.tipo === 'monetario');
  close(flujo.saldo_actual, dash.kpis.saldo_caja_liquido, 'Total líquido de Flujo y Dashboard');
  close(af.tesoreria.saldo_actual, dash.kpis.saldo_caja_liquido, 'Total líquido de Análisis Financiero y Dashboard');
  for (const card of fila.medios_pago || []) {
    const ids = new Set((card.medios || []).map((m) => Number(m.id_medio_pago)));
    const saldoDashboard = monetarios.filter((m) => ids.has(Number(m.id_medio_pago)))
      .reduce((s, m) => s + Number(m.saldo || 0), 0);
    close(card.saldo, saldoDashboard, `Saldo FIRMADO de ${card.label} igual en ambas pantallas`);
  }
  close(dash.kpis.saldo_caja_actual,
    (dash.kpis.saldo_caja_medios || []).reduce((s, m) => s + Number(m.saldo || 0), 0),
    'La Caja actual incluye efectivo, bancos, billeteras y documentos sin ocultar signos');
});
