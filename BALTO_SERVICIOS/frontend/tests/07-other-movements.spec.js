import { test, expect } from './support/test.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { requireMutations, searchRow, waitDialog } from './support/ui.js';
import {
  createOtherIncome,
  createOtherExpense,
  createStockProduct,
  deleteUnusedStockProduct,
  detectOtherIncomeInvoiceStep,
  editOtherMovement,
  deleteOtherMovement,
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

test('@crud otros ingresos: cliente sólo fiscal + resumen global sin asociarlo al movimiento', async ({ page }, testInfo) => {
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
    selectClient: true,
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

  expect(createRequests, 'Guardar debe crear exactamente un Otro Ingreso.').toHaveLength(1);
  const savedPayload = createRequests[0].postDataJSON();
  expect(savedPayload, 'El payload debe declarar explícitamente id_cliente = null.').toHaveProperty('id_cliente', null);
  expect(savedPayload, 'El payload tampoco debe persistir cliente_nombre.').toHaveProperty('cliente_nombre', null);

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
    selectClient: true,
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

test('@crud @critical otros ingresos: guardar es libre y Facturar exige cliente', async ({ page }, testInfo) => {
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const description = uniqueName('INGRESO-SIN-CLIENTE');
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
    amount: 175,
    freeText: true,
    finalAction: 'none',
  });

  await expect(incomeDialog).toContainText(/Cliente para facturar \(opcional\)/i);
  const clientInput = incomeDialog.locator('.oi-cliente-wrap input').first();
  await expect(clientInput).toBeVisible();
  await expect(clientInput).toHaveValue('');

  // Facturar sí necesita receptor fiscal, pero no debe crear ni persistir nada
  // mientras el cliente siga vacío.
  await incomeDialog.getByRole('button', { name: /^Facturar$/i }).click();
  await expect(
    page.locator('.toast-message').filter({ hasText: /Seleccioná un cliente antes de facturar/i }).last(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(incomeDialog).toBeVisible();
  expect(createRequests, 'Intentar facturar sin cliente no debe crear el ingreso.').toHaveLength(0);
  await expect(page.getByRole('dialog').filter({ hasText: /Datos fiscales para facturar|Resumen antes de emitir/i })).toHaveCount(0);

  // Guardar, en cambio, debe funcionar sin cliente y persistir explícitamente NULL.
  await incomeDialog.getByRole('button', { name: /^Guardar ingreso$/i }).click();
  await expect(incomeDialog).toBeHidden({ timeout: 60_000 });
  expect(createRequests, 'Guardar sin cliente debe crear exactamente un ingreso.').toHaveLength(1);
  const payload = createRequests[0].postDataJSON();
  expect(payload).toHaveProperty('id_cliente', null);
  expect(payload).toHaveProperty('cliente_nombre', null);

  const row = await searchRow(page, description, /Buscar por descripción/i);
  await expect(row).toBeVisible();
  await deleteOtherMovement(page, 'income', description);

  await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/comprobante/i] });
});

test('@crud @critical otros ingresos: sólo detalle manual y nunca mueve stock', async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const diagnostics = installDiagnostics(page);
  const productName = uniqueName('INGRESO-INDEPENDIENTE');
  const description = uniqueName('INGRESO-MANUAL');

  await createStockProduct(page, {
    name: productName,
    sku: uniqueSku('INGMAN'),
    stock: 10,
    cost: 100,
    price: 250,
  });

  try {
    await page.goto('/panel/Otrosingresos');
    await page.getByTitle('Crear nuevo ingreso').click();
    const probeDialog = await waitDialog(page, 'Nuevo Ingreso');
    await expect(probeDialog.locator('select[aria-label^="Tipo de ítem fila"]')).toHaveCount(0);
    await expect(probeDialog).not.toContainText(/Stock \/ material \/ insumo|Servicio del catálogo/i);
    await probeDialog.getByRole('button', { name: /Cerrar/i }).last().click();
    await expect(probeDialog).toBeHidden();

    await createOtherIncome(page, { description, amount: 300, freeText: true });
    await expectServiceStock(page, productName, 10);

    await editOtherMovement(page, 'income', description, 350);
    await expectServiceStock(page, productName, 10);

    await deleteOtherMovement(page, 'income', description);
    await expectServiceStock(page, productName, 10);
  } finally {
    await deleteUnusedStockProduct(page, productName).catch(() => null);
  }

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
