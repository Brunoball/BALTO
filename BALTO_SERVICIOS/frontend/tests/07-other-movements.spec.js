import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { requireMutations, searchRow, waitDialog } from './support/ui.js';
import {
  applyOtherIncomeCreditNote,
  createOtherIncome,
  createOtherIncomeWithProduct,
  createOtherExpense,
  createStockProduct,
  deleteUnusedStockProduct,
  detectOtherIncomeInvoiceStep,
  editOtherMovement,
  deleteOtherMovement,
  expectOtherIncomeCreditTrace,
  expectOtherIncomeInvoiceSummary,
} from './support/flows.js';
import { expectServiceStock } from './support/services.js';

const REAL_ARCA_ACTIONS = new Set(['wsfe_emitir', 'factura_emitir', 'arca_wsfe_emitir']);

test.beforeEach(async ({ page }) => {
  // Este archivo valida solamente el circuito local/interno. Aunque quede una
  // variable de entorno mal configurada, ninguna emisión fiscal puede salir.
  await page.route('**/api.php**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const action = String(url.searchParams.get('action') || '').toLowerCase();
    const isDirectWsfeFile = /\/wsfe_emitir\.php$/i.test(url.pathname);
    if (REAL_ARCA_ACTIONS.has(action) || isDirectWsfeFile) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          exito: false,
          codigo: 'PLAYWRIGHT_LOCAL_ONLY',
          mensaje: 'Emisión ARCA bloqueada por el test local de Otros ingresos.',
        }),
      });
      return;
    }
    await route.fallback();
  });
});

async function mockSelectedClientFiscalState(page, state) {
  await page.route('**/api.php**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.searchParams.get('action') !== 'cliente_fiscal_get') {
      await route.fallback();
      return;
    }

    const idCliente = Number(url.searchParams.get('id_cliente') || 0);
    if (state === 'missing') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exito: true, existe: false, cliente_fiscal: null }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        exito: true,
        existe: true,
        cliente_fiscal: {
          id_cliente: idCliente,
          doc_tipo: 80,
          doc_nro: '20123456786',
          cuit: '20123456786',
          razon_social: 'CLIENTE FISCAL PLAYWRIGHT',
          condicion_iva: 'CONSUMIDOR FINAL',
          domicilio: 'DOMICILIO DE PRUEBA',
        },
      }),
    });
  });
}

test('@crud otros ingresos: cliente + resumen fiscal global sin guardar antes de emitir', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  await mockSelectedClientFiscalState(page, 'existing');
  const diagnostics = installDiagnostics(page);
  const description = uniqueName('OTRO-INGRESO');
  const createRequests = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).searchParams.get('action') === 'otros_ingresos_crear'
    ) {
      createRequests.push(request);
    }
  });

  const { incomeDialog } = await createOtherIncome(page, {
    description,
    amount: 350,
    freeText: true,
    finalAction: 'facturar',
  });
  const invoiceStep = await detectOtherIncomeInvoiceStep(page);

  expect(invoiceStep.kind, 'Un cliente con ficha fiscal debe ir directo al resumen global.').toBe('summary');
  await expectOtherIncomeInvoiceSummary(invoiceStep.dialog, {
    items: [description],
  });
  await expect(invoiceStep.dialog).toContainText(/CLIENTE FISCAL PLAYWRIGHT/i);
  await invoiceStep.dialog.getByRole('button', { name: /Volver/i }).last().click();
  await expect(invoiceStep.dialog).toBeHidden();

  // Abrir y cancelar cualquiera de los pasos fiscales no debe persistir nada.
  expect(createRequests, 'No debe existir POST de alta antes de confirmar la factura.').toHaveLength(0);
  await expect(incomeDialog).toBeVisible();
  await incomeDialog.getByRole('button', { name: /^Guardar ingreso$/i }).click();
  await expect(incomeDialog).toBeHidden({ timeout: 60_000 });

  const incomeRow = await searchRow(page, description, /Buscar por descripción/i);
  await expect(incomeRow.getByTitle('Facturar ingreso')).toHaveCount(0);
  await expect(incomeRow.getByRole('button', { name: /Facturar/i })).toHaveCount(0);
  await expect(incomeRow.getByTitle('Editar')).toBeVisible();
  await editOtherMovement(page, 'income', description, 420);
  await deleteOtherMovement(page, 'income', description);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/comprobante/i] });
});

test('@crud otros ingresos: cliente sin ficha fiscal abre el modal global de CUIT y cancelar no guarda', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  await mockSelectedClientFiscalState(page, 'missing');
  const diagnostics = installDiagnostics(page);
  const description = uniqueName('INGRESO-CUIT');
  const createRequests = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).searchParams.get('action') === 'otros_ingresos_crear'
    ) {
      createRequests.push(request);
    }
  });

  const { incomeDialog } = await createOtherIncome(page, {
    description,
    amount: 100,
    freeText: true,
    finalAction: 'facturar',
  });
  const invoiceStep = await detectOtherIncomeInvoiceStep(page);
  expect(invoiceStep.kind, 'Un cliente sin ficha fiscal debe abrir el buscador por CUIT.').toBe('fiscal');
  await expect(invoiceStep.dialog).toContainText(/Datos fiscales para facturar/i);
  await expect(invoiceStep.dialog).toContainText(/Factura por CUIT/i);
  await expect(invoiceStep.dialog).toContainText(/Consulta ARCA/i);
  await expect(invoiceStep.dialog.locator('input[inputmode="numeric"]')).toBeVisible();
  await expect(invoiceStep.dialog.getByRole('button', { name: /Confirmar y facturar/i })).toBeDisabled();
  await invoiceStep.dialog.getByRole('button', { name: /Cancelar/i }).click();
  await expect(invoiceStep.dialog).toBeHidden();
  expect(createRequests, 'Cancelar el paso de CUIT no debe crear el ingreso.').toHaveLength(0);

  await incomeDialog.getByRole('button', { name: /Cerrar/i }).click();
  await expect(incomeDialog).toBeHidden();
  await expect(
    page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: description }),
  ).toHaveCount(0);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/comprobante/i] });
});

test('@crud @critical otros ingresos: producto impacta stock y NC revierte exactamente', async ({ page }, testInfo) => {
  test.setTimeout(4 * 60_000);
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('INGRESO-STOCK');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('INGSTK'),
    stock: 10,
    cost: 100,
    price: 250,
  });

  let incomeRow;
  try {
    incomeRow = await createOtherIncomeWithProduct(page, {
      productName,
      quantity: 2,
      price: 250,
    });
  } catch (error) {
    const knownCatalogBug = /Debe aparecer el stock/i.test(String(error?.message || ''))
      && await page.getByText(/No hay artículos con stock/i).isVisible().catch(() => false);
    if (!knownCatalogBug) throw error;

    // El backend sí entrega el material con stock positivo (lo verifica el fixture),
    // pero ModalNuevoIngreso + ProductStockAutocomplete hoy lo filtra. Se mantiene
    // ejecutado como expected failure hasta que el frontend lo acepte nuevamente.
    await expectServiceStock(page, productName, 10);
    const openDialog = page.getByRole('dialog').filter({ has: page.getByText('Nuevo Ingreso') }).last();
    const close = openDialog.getByRole('button', { name: /Cerrar/i }).last();
    if (await close.isVisible().catch(() => false)) await close.click();
    await deleteUnusedStockProduct(page, productName).catch(() => null);

    test.fail(true, 'BUG FRONTEND CONOCIDO: Otros Ingresos no muestra artículos de Servicios con stock positivo.');
    expect(
      true,
      'BUG FRONTEND CONOCIDO: el catálogo de stock de Otros Ingresos queda vacío aunque el backend devuelve el artículo con stock.',
    ).toBe(false);
    return;
  }
  await expect(incomeRow.locator('[role="cell"]').nth(2)).toContainText('500');

  const editableIncomeRow = await searchRow(page, productName, /Buscar por descripción/i);
  await editableIncomeRow.getByTitle('Editar').click();
  const editDialog = await waitDialog(page, 'Editar ingreso');
  await expect(editDialog.getByLabel('Tipo de ítem fila 1')).toHaveValue('producto');
  await editDialog.getByRole('button', { name: /Cancelar/i }).click();
  await expect(editDialog).toBeHidden();

  await expectServiceStock(page, productName, 8);

  await page.goto('/panel/Otrosingresos');
  await applyOtherIncomeCreditNote(page, productName, { quantity: 1 });

  const creditedIncomeRow = await searchRow(page, productName, /Buscar por descripción/i);
  await expect(creditedIncomeRow.locator('[role="cell"]').nth(2)).toContainText('250');
  await expect(creditedIncomeRow.getByTitle('Editar')).toHaveCount(0);
  await expect(creditedIncomeRow.getByTitle(/Facturar ingreso/i)).toHaveCount(0);
  await expectOtherIncomeCreditTrace(page, productName, { item: productName });

  await expectServiceStock(page, productName, 9);

  await page.goto('/panel/Otrosingresos');
  await deleteOtherMovement(page, 'income', productName);

  await expectServiceStock(page, productName, 10);
  await deleteUnusedStockProduct(page, productName);

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [/comprobante/i, /PDF/i],
  });
});

test('@crud otros egresos: crea descripción, registra, edita y elimina', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const description = uniqueName('OTRO-EGRESO');

  await createOtherExpense(page, { description, amount: 280 });
  await editOtherMovement(page, 'expense', description, 310);
  await deleteOtherMovement(page, 'expense', description);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/comprobante/i] });
});
