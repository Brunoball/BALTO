import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess, expectChequeEvents, expectChequeState } from '../support/api.js';
import { ENV } from '../support/env.js';
import { RUN_PREFIX, todayISO, uniqueChequeNumber, uniqueName, uniqueSku } from '../support/data.js';
import { auditEndpoint, expectCheckOk, loadInternalAudit } from '../support/internal-audit.js';
import { requireMutations } from '../support/ui.js';
import { createPurchase, createSale, createStockProduct, deletePurchase, deleteSale, payPayable, payReceivable } from '../support/flows.js';
import { createOtherIncomeWithIncomingCheque, createPurchaseWithPortfolioCheque } from '../support/cheques.js';
import { expectProductStock } from '../support/stock-units.js';
import {
  appendInsufficientDuplicateItem,
  capturePurchasePayloadWithCheque,
  captureSalePayload,
  expectExactlyOneSuccess,
  isStagingInternalTarget,
  postMutation,
  resultSucceeded,
  runConcurrentMutation,
  runSequentialMutations,
  tamperFinancialTotals,
} from '../support/internal-active.js';

let audit;

test.describe.serial('@internal BALTO Comercio · Etapa 4 · freeze', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      // El fixture por test valida sesión; beforeAll necesita abrir una página real
      // para que el primer test cargue la auditoría con la sesión ya preparada.
      audit = null;
    } finally {
      await page.close();
    }
  });

  async function ensureAudit(page, fresh = false) {
    if (fresh || !audit) audit = await loadInternalAudit(page);
    return audit;
  }

  async function requireActiveInternal(page) {
    test.skip(!isStagingInternalTarget(), 'Los escenarios internos mutantes sólo se ejecutan en staging.');
    await requireMutations(test, page);
  }

  function buildCheque(label, importe, tipo = 'CHEQUE') {
    return {
      numero: uniqueChequeNumber(),
      emisor: uniqueName(`INT-${label}`, 42).replace(/[^A-Z0-9]/g, ''),
      importe,
      tipo,
      fechaEmision: todayISO(),
      fechaPago: todayISO(),
    };
  }

  test('00 · preflight: herramientas internas habilitadas sólo con sesión admin', async ({ page }) => {
    const status = await authenticatedApi(page, 'config_testing_e2e_status', {
      query: { scope: 'prefix', prefix: RUN_PREFIX },
    });
    expect(status.status).toBeLessThan(400);
    expect(status.body?.exito).not.toBe(false);
    const a = await ensureAudit(page);
    expect(a.request_id).toBeTruthy();
  });

  test('01A · importes: subtotal/IVA/total persistidos respetan matemática backend', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'financial_item_math');
  });

  test('01B · CC cliente: saldo coincide con ledger independiente', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'cc_client_math');
  });

  test('02 · rollback: no quedan ítems huérfanos tras fallos/reversiones', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'orphan_items');
  });

  test('03 · concurrencia stock: nunca termina con stock negativo de producto', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'negative_product_stock');
  });

  test('04 · concurrencia cheque: número global no puede duplicarse', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'duplicate_cheque_number');
  });

  test('05A · integridad SQL: pagos siempre conservan movimiento padre', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'orphan_payments');
  });

  test('05B · integridad SQL: pagos con cheque conservan cheque real', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'orphan_cheque_payment');
  });

  test('06A · CC proveedor: saldo coincide con ledger independiente', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'cc_provider_math');
  });

  test('06B · proveedor: varias compras/OP no rompen el modelo acumulado', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'cc_provider_math');
    expectCheckOk(await ensureAudit(page), 'invalid_grouped_payment_id');
  });

  test('07A · stock exacto: stock actual de producto coincide con último historial', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'product_stock_vs_history');
  });

  test('07B · stock negativo: variantes tampoco pueden quedar debajo de cero', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'negative_variant_stock');
  });

  test('07C · historial stock: continuidad fila a fila', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'stock_history_continuity');
  });

  test('08A · eCheq/cheque: flujo no puede apuntar a un cheque inexistente', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'cheque_flow_orphans');
  });

  test('08B · eCheq/cheque: unicidad global del número', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'duplicate_cheque_number');
  });

  test('08C · eCheq/cheque: aplicaciones conservan integridad de cartera', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'orphan_cheque_payment');
    expectCheckOk(await ensureAudit(page), 'cheque_flow_orphans');
  });

  test('09A · reversión venta/NC: relaciones de nota de crédito quedan completas', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'credit_note_orphans');
  });

  test('09B · reversión compra/NC: idempotencia no deja duplicados', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'credit_note_idempotency');
  });

  test('10A · multiítem/IVA: todos los ítems conservan cálculo exacto', async ({ page }) => {
    expectCheckOk(await ensureAudit(page), 'financial_item_math');
  });

  test('10B · stress determinista: invariantes globales siguen en cero', async ({ page }) => {
    const a = await ensureAudit(page);
    expect(Number(a.violations_total || 0), JSON.stringify(a.checks)).toBe(0);
  });


  test('10C · ACTIVO · importes manipulados: backend ignora subtotal/IVA/total del navegador', async ({ page }, testInfo) => {
    testInfo.setTimeout(6 * 60_000);
    await requireActiveInternal(page);

    const name = uniqueName('INT-TOTALES');
    const sku = uniqueSku('INTTOTAL');
    await createStockProduct(page, { name, sku, stock: 3, cost: 50, price: 100 });

    const payload = await captureSalePayload(page, {
      items: [{ productName: name, quantity: 1, price: 100, ivaPct: 21 }],
    });
    const result = await postMutation(page, 'ventas_crear_batch', tamperFinancialTotals(payload));
    expectApiSuccess(result, 'El backend debe aceptar la venta recalculando importes críticos');
    await expectProductStock(page, sku, 2);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'financial_item_math');
    expectCheckOk(fresh, 'product_stock_vs_history');
  });

  test('10D · ACTIVO · rollback real: segundo ítem sin stock revierte el primero completo', async ({ page }, testInfo) => {
    testInfo.setTimeout(6 * 60_000);
    await requireActiveInternal(page);

    const name = uniqueName('INT-ROLLBACK');
    const sku = uniqueSku('INTROLL');
    await createStockProduct(page, { name, sku, stock: 1, cost: 40, price: 90 });

    const payload = await captureSalePayload(page, {
      items: [{ productName: name, quantity: 1, price: 90, ivaPct: 0 }],
    });
    const hostile = appendInsufficientDuplicateItem(payload, 2);
    const result = await postMutation(page, 'ventas_crear_batch', hostile);

    expect(resultSucceeded(result), `La venta inválida no puede confirmar: ${result.text || JSON.stringify(result.body)}`).toBe(false);
    expect(Number(result.status || 0)).toBeGreaterThanOrEqual(400);
    expect(Number(result.status || 0)).toBeLessThan(500);
    await expectProductStock(page, sku, 1);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'orphan_items');
    expectCheckOk(fresh, 'negative_product_stock');
    expectCheckOk(fresh, 'stock_history_continuity');
  });

  test('10E · ACTIVO · concurrencia stock: dos ventas pelean por la última unidad y sólo una gana', async ({ page }, testInfo) => {
    testInfo.setTimeout(6 * 60_000);
    await requireActiveInternal(page);

    const name = uniqueName('INT-RACE-STOCK');
    const sku = uniqueSku('INTRACESTK');
    await createStockProduct(page, { name, sku, stock: 1, cost: 30, price: 80 });
    const payload = await captureSalePayload(page, {
      items: [{ productName: name, quantity: 1, price: 80, ivaPct: 0 }],
    });

    const results = await runConcurrentMutation(page, 'ventas_crear_batch', payload);
    const { failure } = expectExactlyOneSuccess(results, 'Carrera de stock');
    expect(Number(failure.status || 0), 'La carrera debe resolverse como conflicto de negocio, no 500').toBeLessThan(500);
    await expectProductStock(page, sku, 0);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'negative_product_stock');
    expectCheckOk(fresh, 'product_stock_vs_history');
    expectCheckOk(fresh, 'stock_history_continuity');
  });

  test('10F · ACTIVO · concurrencia cheque: dos compras usan el mismo cheque y sólo una puede egresarlo', async ({ page }, testInfo) => {
    testInfo.setTimeout(8 * 60_000);
    await requireActiveInternal(page);

    const cheque = buildCheque('RACE-CHQ', 154, 'CHEQUE');
    const source = uniqueName('INT-FONDO-CHQ');
    const product = uniqueName('INT-RACE-CHQ-PROD');
    const sku = uniqueSku('INTRACECHQ');

    await createOtherIncomeWithIncomingCheque(page, { description: source, amount: 154 }, cheque);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA', 'CHEQUE');
    await createStockProduct(page, { name: product, sku, stock: 1, cost: 154, price: 200 });

    const payload = await capturePurchasePayloadWithCheque(page, {
      productName: product,
      quantity: 1,
      price: 154,
      cheque,
    });
    const results = await runConcurrentMutation(page, 'compras_crear_batch', payload);
    const { failure } = expectExactlyOneSuccess(results, 'Carrera de cheque');
    expect(Number(failure.status || 0), 'La carrera de cheque debe fallar cerrado sin HTTP 500').toBeLessThan(500);
    await expectChequeState(page, cheque.numero, 'EGRESADO_CARTERA', 'CHEQUE');

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'duplicate_cheque_number');
    expectCheckOk(fresh, 'orphan_cheque_payment');
    expectCheckOk(fresh, 'cheque_flow_orphans');
  });

  test('10G · ACTIVO · eCheq: ingreso, egreso y reversión restauran EN_CARTERA', async ({ page }, testInfo) => {
    testInfo.setTimeout(8 * 60_000);
    await requireActiveInternal(page);

    const cheque = buildCheque('ECHEQ', 165, 'ECHEQ');
    const source = uniqueName('INT-FONDO-ECHEQ');
    const product = uniqueName('INT-ECHEQ-PROD');
    const sku = uniqueSku('INTECHEQ');

    await createOtherIncomeWithIncomingCheque(page, { description: source, amount: 165 }, cheque);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA', 'ECHEQ');
    await expectChequeEvents(page, cheque.numero, ['INGRESO_CARTERA'], 'ECHEQ');

    await createStockProduct(page, { name: product, sku, stock: 1, cost: 165, price: 210 });
    await createPurchaseWithPortfolioCheque(page, { productName: product, quantity: 1, price: 165 }, cheque);
    await expectChequeState(page, cheque.numero, 'EGRESADO_CARTERA', 'ECHEQ');

    await page.goto('/panel/compras');
    await deletePurchase(page, product);
    await expectChequeState(page, cheque.numero, 'EN_CARTERA', 'ECHEQ');
    await expectProductStock(page, sku, 1);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'orphan_cheque_payment');
    expectCheckOk(fresh, 'cheque_flow_orphans');
  });

  test('10H · ACTIVO · reversiones exactas: compra y venta restauran el stock original', async ({ page }, testInfo) => {
    testInfo.setTimeout(8 * 60_000);
    await requireActiveInternal(page);

    const name = uniqueName('INT-REVERSION');
    const sku = uniqueSku('INTREV');
    await createStockProduct(page, { name, sku, stock: 5, cost: 100, price: 150 });

    await createPurchase(page, { productName: name, quantity: 2, price: 100 });
    await expectProductStock(page, sku, 7);
    await page.goto('/panel/compras');
    await deletePurchase(page, name);
    await expectProductStock(page, sku, 5);

    await createSale(page, { productName: name, quantity: 2, price: 150 });
    await expectProductStock(page, sku, 3);
    await page.goto('/panel/ventas');
    await deleteSale(page, name);
    await expectProductStock(page, sku, 5);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'product_stock_vs_history');
    expectCheckOk(fresh, 'stock_history_continuity');
    expectCheckOk(fresh, 'cc_client_math');
    expectCheckOk(fresh, 'cc_provider_math');
  });

  test('10I · ACTIVO · multiítem/IVA: dos productos con alícuotas distintas persisten matemática y stock exactos', async ({ page }, testInfo) => {
    testInfo.setTimeout(8 * 60_000);
    await requireActiveInternal(page);

    const a = uniqueName('INT-MULTI-A');
    const b = uniqueName('INT-MULTI-B');
    const skuA = uniqueSku('INTMULTIA');
    const skuB = uniqueSku('INTMULTIB');
    await createStockProduct(page, { name: a, sku: skuA, stock: 3, cost: 50, price: 100 });
    await createStockProduct(page, { name: b, sku: skuB, stock: 3, cost: 30, price: 50 });

    const payload = await captureSalePayload(page, {
      items: [
        { productName: a, quantity: 1, price: 100, ivaPct: 21 },
        { productName: b, quantity: 2, price: 50, ivaPct: 10.5 },
      ],
    });
    const result = await postMutation(page, 'ventas_crear_batch', payload);
    expectApiSuccess(result, 'La venta multiítem debe confirmarse');
    await expectProductStock(page, skuA, 2);
    await expectProductStock(page, skuB, 1);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'financial_item_math');
    expectCheckOk(fresh, 'product_stock_vs_history');
    expectCheckOk(fresh, 'stock_history_continuity');
  });

  test('10J · ACTIVO · stress determinista: cinco ventas consecutivas mantienen stock y ledger exactos', async ({ page }, testInfo) => {
    testInfo.setTimeout(8 * 60_000);
    await requireActiveInternal(page);

    const name = uniqueName('INT-STRESS');
    const sku = uniqueSku('INTSTRESS');
    await createStockProduct(page, { name, sku, stock: 10, cost: 25, price: 50 });
    const payload = await captureSalePayload(page, {
      items: [{ productName: name, quantity: 1, price: 50, ivaPct: 0 }],
    });

    await runSequentialMutations(page, 'ventas_crear_batch', payload, 5);
    await expectProductStock(page, sku, 5);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'cc_client_math');
    expectCheckOk(fresh, 'financial_item_math');
    expectCheckOk(fresh, 'product_stock_vs_history');
    expectCheckOk(fresh, 'stock_history_continuity');
    expect(Number(fresh.violations_total || 0), JSON.stringify(fresh.checks)).toBe(0);
  });


  test('10K · ACTIVO · CC cliente: venta + recibo real mantienen el ledger independiente', async ({ page }, testInfo) => {
    testInfo.setTimeout(8 * 60_000);
    await requireActiveInternal(page);

    const name = uniqueName('INT-CC-CLIENTE');
    const sku = uniqueSku('INTCCCLI');
    await createStockProduct(page, { name, sku, stock: 4, cost: 40, price: 100 });
    await createSale(page, { productName: name, quantity: 1, price: 100 });
    await payReceivable(page, name);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'cc_client_math');
    expectCheckOk(fresh, 'orphan_payments');
    expectCheckOk(fresh, 'financial_item_math');
  });

  test('10L · ACTIVO · CC proveedor: compra + OP real mantienen el ledger independiente', async ({ page }, testInfo) => {
    testInfo.setTimeout(8 * 60_000);
    await requireActiveInternal(page);

    const name = uniqueName('INT-CC-PROVEEDOR');
    const sku = uniqueSku('INTCCPROV');
    await createStockProduct(page, { name, sku, stock: 1, cost: 75, price: 120 });
    await createPurchase(page, { productName: name, quantity: 1, price: 75 });
    await payPayable(page, name);

    const fresh = await ensureAudit(page, true);
    expectCheckOk(fresh, 'cc_provider_math');
    expectCheckOk(fresh, 'orphan_payments');
    expectCheckOk(fresh, 'financial_item_math');
  });

  test('11A · seguridad tools: request anónima nunca obtiene auditoría interna', async ({ page }) => {
    const context = await page.context().browser().newContext();
    try {
      const response = await context.request.get(auditEndpoint(), { headers: { Accept: 'application/json' } });
      expect([401, 403, 404]).toContain(response.status());
    } finally {
      await context.close();
    }
  });

  test('11B · seguridad tools: scope fuera de la huella PW es rechazado', async ({ page }) => {
    const result = await authenticatedApi(page, 'config_testing_e2e_status', {
      query: { scope: 'prefix', prefix: 'NO-ES-PW' },
    });
    expect(result.status).toBe(400);
    expect(result.body?.exito).toBe(false);
  });

  test('12 · cierre: ARCA, presupuestos, saldos y catálogos conservan invariantes', async ({ page }) => {
    const a = await ensureAudit(page, true);
    for (const id of [
      'arca_idempotency',
      'budget_conversion_orphans',
      'duplicate_cc_initial_balance',
      'duplicate_treasury_initial_balance',
      'duplicate_payment_method_name',
      'orphan_fiscal_relation',
    ]) expectCheckOk(a, id);
    expect(Number(a.violations_total || 0), JSON.stringify(a.checks)).toBe(0);
  });
});
