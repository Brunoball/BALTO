import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';

/**
 * Dashboard / Caja actual: solo lectura. NUNCA modifica ventas, cheques ni saldos.
 * - La caja líquida debe coincidir con Tesorería (AF / Flujo de Caja).
 * - Los cheques/eCheqs se toman únicamente de documentos EN_CARTERA.
 * - Todos los medios monetarios configurados, incluso nuevos bancos o inactivos,
 *   aparecen individualmente. El total = suma exacta del desglose.
 * - La UI muestra un número variable de medios, en escritorio y móvil.
 */
const amount = (v) => Number(v ?? 0);
const close = (actual, expected, message) => {
  expect(amount(actual), message).toBeCloseTo(amount(expected), 2);
};

async function dashboardPayload(page, query = {}) {
  return expectApiSuccess(await authenticatedApi(page, 'dashboard_resumen', { query }),
    'El Dashboard debe responder correctamente');
}

async function sumarDocumentosEnCartera(page, action, key) {
  let sum = 0;
  let count = 0;
  let offset = 0;
  // Paginación por 200, sin suponer que un cliente tiene pocos cheques.
  for (let pagina = 0; pagina < 100; pagina += 1) {
    const body = expectApiSuccess(await authenticatedApi(page, action, {
      query: { limit: 200, offset },
    }), `No se pudo obtener ${action}, offset ${offset}`);
    const documentos = body[key];
    expect(Array.isArray(documentos), `${action} debe devolver ${key}`).toBeTruthy();
    for (const documento of documentos) {
      expect(String(documento.estado).toUpperCase(), 'Un documento listado en cartera debe estar EN_CARTERA').toBe('EN_CARTERA');
      sum += amount(documento.importe);
      count += 1;
    }
    if (!body.has_more) return { sum, count };
    expect(documentos.length, `${action} no debe devolver páginas vacías cuando hay más`).toBeGreaterThan(0);
    offset += documentos.length;
  }
  throw new Error(`${action}: más de 20.000 documentos en cartera; ampliar el límite del test`);
}

test('@dashboard @caja @critical la suma de TODOS los medios concilia con AF y nunca duplica documentos', async ({ page }) => {
  const dash = await dashboardPayload(page);
  const k = dash.kpis;
  const medios = k.saldo_caja_medios;
  expect(Array.isArray(medios), 'El desglose debe ser dinámico, no un objeto de tres medios').toBeTruthy();
  expect(medios.length).toBeGreaterThanOrEqual(2);

  const ids = medios.map((m) => `${m.tipo}:${m.id_medio_pago || m.nombre}`);
  expect(new Set(ids).size, 'Cada medio debe mostrarse una sola vez').toBe(ids.length);
  for (const medio of medios) {
    expect(medio.nombre?.trim()).toBeTruthy();
    expect(['monetario', 'documento']).toContain(medio.tipo);
    expect(Number.isFinite(amount(medio.saldo)), `Saldo de ${medio.nombre} finito`).toBeTruthy();
  }
  const liquid = medios.filter((m) => m.tipo === 'monetario');
  const docs = medios.filter((m) => m.tipo === 'documento');
  close(k.saldo_caja_liquido, liquid.reduce((s, m) => s + amount(m.saldo), 0), 'Subtotal monetario');
  close(k.saldo_caja_documentos, docs.reduce((s, m) => s + amount(m.saldo), 0), 'Subtotal de documentos');
  close(k.saldo_caja_actual, medios.reduce((s, m) => s + amount(m.saldo), 0), 'Total de Caja actual');
  close(k.saldo_caja_actual, amount(k.saldo_caja_liquido) + amount(k.saldo_caja_documentos), 'Subtotales reconciliados');

  const fecha = String(k.saldo_caja_fecha_corte);
  expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const af = expectApiSuccess(await authenticatedApi(page, 'analisis_financiero_resumen', {
    query: { fecha_desde: fecha, fecha_hasta: fecha },
  }), 'Análisis Financiero debe devolver la misma Tesorería');
  close(k.saldo_caja_liquido, af.tesoreria.saldo_final, 'Caja monetaria = Tesorería / AF');
  expect(liquid.length).toBe(af.tesoreria.medios.length);
  for (const medioAF of af.tesoreria.medios) {
    const medio = liquid.find((m) => Number(m.id_medio_pago) === Number(medioAF.id));
    expect(medio, `Debe aparecer el medio monetario ${medioAF.nombre}, incluso si está inactivo`).toBeTruthy();
    expect(medio.nombre).toBe(medioAF.nombre);
    close(medio.saldo, medioAF.saldo_final, `Conciliación del medio ${medioAF.nombre}`);
  }
});

test('@dashboard @cheques @critical documentos en Caja = únicamente cheques y eCheqs en cartera (sin doble conteo)', async ({ page }) => {
  const dash = await dashboardPayload(page);
  const docs = dash.kpis.saldo_caja_medios.filter((m) => m.tipo === 'documento');
  expect(docs.length, 'El Dashboard incluye dos tipos de documentos').toBe(2);
  const cheques = docs.find((m) => /CHEQ/i.test(m.nombre) && !/ECHEQ|E-CHEQ|E_CHEQ/i.test(m.nombre));
  const echeqs = docs.find((m) => /ECHEQ|E-CHEQ|E_CHEQ/i.test(m.nombre));
  expect(cheques, 'Debe aparecer CHEQUE').toBeTruthy();
  expect(echeqs, 'Debe aparecer ECHEQ').toBeTruthy();

  const [cartCheques, cartEcheqs] = await Promise.all([
    sumarDocumentosEnCartera(page, 'cheques_cartera_listar', 'cheques'),
    sumarDocumentosEnCartera(page, 'echeq_cartera_listar', 'echeqs'),
  ]);
  close(cheques.saldo, cartCheques.sum, 'Solo valor nominal de cheques en cartera');
  close(echeqs.saldo, cartEcheqs.sum, 'Solo valor nominal de eCheqs en cartera');
  expect(cheques.cantidad).toBe(cartCheques.count);
  expect(echeqs.cantidad).toBe(cartEcheqs.count);
  close(dash.kpis.saldo_caja_documentos, cartCheques.sum + cartEcheqs.sum,
    'Documentos no deben incluir depositados, egresados ni rechazados');
});

const fakeMedios = [
  { id_medio_pago: 1, nombre: 'EFECTIVO', activo: true, tipo: 'monetario', saldo: 50000 },
  { id_medio_pago: 2, nombre: 'MERCADO PAGO', activo: true, tipo: 'monetario', saldo: 12000 },
  { id_medio_pago: 4, nombre: 'BANCO', activo: true, tipo: 'monetario', saldo: -2000 },
  { id_medio_pago: 7, nombre: 'PERSONAL PAY', activo: true, tipo: 'monetario', saldo: 1000 },
  { id_medio_pago: 99, nombre: 'BANCO SANTANDER', activo: false, tipo: 'monetario', saldo: 4000 },
  { id_medio_pago: 5, nombre: 'CHEQUE', activo: true, tipo: 'documento', saldo: 16000, cantidad: 2 },
  { id_medio_pago: 6, nombre: 'ECHEQ', activo: true, tipo: 'documento', saldo: 10000, cantidad: 1 },
];

test('@dashboard @ui todos los medios y futuros bancos se despliegan en desktop y móvil (mock, sin escrituras)', async ({ page }) => {
  const liquido = fakeMedios.filter((m) => m.tipo === 'monetario').reduce((n, m) => n + m.saldo, 0);
  const docs = fakeMedios.filter((m) => m.tipo === 'documento').reduce((n, m) => n + m.saldo, 0);
  await page.route((url) => url.pathname.endsWith('/api.php') && url.searchParams.get('action') === 'dashboard_resumen',
    (route) => route.fulfill({ json: {
      exito: true,
      rango: { desde: '2026-11-01', hasta: '2026-11-30', periodo: '2026-11', label: 'Mes actual' },
      kpis: {
        saldo_caja_actual: liquido + docs,
        saldo_caja_liquido: liquido,
        saldo_caja_documentos: docs,
        saldo_caja_medios: fakeMedios,
        ingresos_periodo: 12000, egresos_periodo: 2000,
        saldo_periodo: 10000, movimientos_periodo: 3,
        stock_valorizado: 100000, clientes_activos: 2, productos_con_stock: 3,
      },
      series_diaria: [{ fecha: '2026-11-05', label: '05/11', ingresos: 12000, egresos: 2000, saldo: liquido, movimientos: 3 }],
    } }));

  await page.goto('/panel/dashboard');
  await expect(page.locator('.db[data-balto-dashboard-ready="true"]')).toBeVisible();
  // Rediseño: cada medio es una tarjeta del carrusel superior de KPI.
  const breakdown = page.getByRole('region', { name: 'Indicadores y desglose de Caja actual' });
  await expect(breakdown).toBeVisible();
  const medioCard = (id) => breakdown.locator(`.db-kpi-carousel-card--medio[data-medio-id="${id}"]`);
  const medioCards = breakdown.locator('.db-kpi-carousel-card--medio');
  await expect(medioCards).toHaveCount(fakeMedios.length);
  for (const medio of fakeMedios) {
    const card = medioCard(medio.id_medio_pago);
    await expect(card).toContainText(medio.nombre === 'EFECTIVO' ? 'Caja (Efectivo)' : medio.nombre);
    // La UI utiliza formatMoney(): moneda ARS, no solamente el número.
    // Por ejemplo: -2000 se representa como "-$ 2.000,00", no "-2.000,00".
    // Verificar el <strong> exacto evita un falso positivo por texto del nombre.
    const importeEsperado = new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(medio.saldo);
    const importeVisible = card.locator('strong');
    await expect(importeVisible).toHaveText(importeEsperado);
    if (medio.saldo < 0) {
      await expect(importeVisible).toHaveClass(/is-negative/);
    }
    await expect(card).toHaveAttribute('data-medio-tipo', medio.tipo);
  }
  // Cheques/eCheqs: sólo documentos en cartera, con su cantidad.
  await expect(medioCard(5)).toContainText('En cartera · 2 doc.');
  await expect(medioCard(6)).toContainText('En cartera · 1 doc.');

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(medioCards).toHaveCount(fakeMedios.length);
  for (const id of [99, 6]) {
    await medioCard(id).scrollIntoViewIfNeeded();
    await expect(medioCard(id)).toBeVisible();
  }
});
