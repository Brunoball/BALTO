import { test, expect } from './support/test.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticatedApi } from './support/api.js';
import { waitForBusyToFinish } from './support/ui.js';

test('@critical @documentos contratos PDF: venta conserva composición informativa y presupuesto agrupa/desglosa el servicio', async () => {
  const root = process.cwd();
  const saleSource = await fs.readFile(
    path.join(root, 'src/components/Mov_Subsection/Ventas/modales/ModalNuevaVenta.jsx'),
    'utf8',
  );
  const budgetSource = await fs.readFile(
    path.join(root, 'src/components/Mov_Subsection/Documentos_Comerciales/modales/ModalNuevoPresupuesto.jsx'),
    'utf8',
  );
  const budgetBuilderSource = await fs.readFile(path.join(root, 'src/utils/PresupuestoPdfBuilder.js'), 'utf8');
  const facturaSource = await fs.readFile(path.join(root, 'src/utils/FacturaPdfBuilder.js'), 'utf8');
  const remitoSource = await fs.readFile(path.join(root, 'src/utils/RemitoPdfBuilder.js'), 'utf8');
  const internalSource = await fs.readFile(path.join(root, 'src/utils/VentaNoFacturadaPdfBuilder.js'), 'utf8');

  // Venta/factura/remito siguen usando una descripción informativa del servicio:
  // nombre + composición, sin exponer costos/precios internos de la receta.
  const start = saleSource.indexOf('function buildServiceDocumentDescription');
  const end = saleSource.indexOf('function getServiceFilenameLabel', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const descriptionContract = saleSource.slice(start, end);

  expect(descriptionContract).toContain('normalizeServiceStockComponents(row?.consumos_snapshot)');
  expect(descriptionContract).toContain('Incluye:');
  expect(descriptionContract).toMatch(/cantidad_por_unidad/);
  expect(descriptionContract).toMatch(/unidad_simbolo/);
  expect(descriptionContract).not.toMatch(/costo_unitario|precio_unitario|precio_venta|monto/i);

  // Presupuestos cambió de contrato: ya NO arma "SERVICIO | Incluye: ...".
  // Expande visualmente el servicio en renglones (materiales/insumos + mano de obra),
  // los marca como un mismo grupo y conserva importes/IVA por componente para el PDF.
  const budgetStart = budgetSource.indexOf('function buildPdfItemsForBudgetRow');
  const budgetEnd = budgetSource.indexOf('function normalizeText', budgetStart);
  expect(budgetStart).toBeGreaterThanOrEqual(0);
  expect(budgetEnd).toBeGreaterThan(budgetStart);
  const budgetPdfContract = budgetSource.slice(budgetStart, budgetEnd);

  expect(budgetPdfContract).toContain('normalizeServiceStockComponents(row?.consumos_snapshot)');
  expect(budgetPdfContract).toMatch(/cantidad_por_unidad/);
  expect(budgetPdfContract).toMatch(/unidad_simbolo/);
  expect(budgetPdfContract).toContain('MANO DE OBRA');
  expect(budgetPdfContract).toContain('desglose_servicio: true');
  expect(budgetPdfContract).toContain('grupo_servicio: nombre');
  expect(budgetPdfContract).toMatch(/iva_pct:\s*itemIvaPct/);
  expect(budgetPdfContract).not.toContain('Incluye:');

  expect(budgetSource).toContain('const pdfItems = buildPdfItemsPayload();');
  expect(budgetSource).toContain('uploadPresupuestoPdf({ idMovimiento, payload, items: pdfItems })');

  // El builder del presupuesto debe reconocer los metadatos del grupo y dibujar
  // una sola cabecera del servicio antes de sus componentes.
  expect(budgetBuilderSource).toMatch(/grupoServicio:\s*sanitizePdfText/);
  expect(budgetBuilderSource).toMatch(/grupoClave:\s*sanitizePdfText/);
  expect(budgetBuilderSource).toContain('function drawServiceBlockTitle');
  expect(budgetBuilderSource).toContain('const title = drawServiceBlockTitle(doc, firstItem, y, bottomLimit);');
  expect(budgetBuilderSource).toContain('const blocks = groupBudgetItems(items);');

  expect(saleSource.match(/nombre_servicio_archivo:\s*getServiceFilenameLabel\(rowsCalc\)/g)?.length || 0).toBeGreaterThanOrEqual(2);
  expect(facturaSource).toMatch(/nombre_servicio_archivo/);
  expect(remitoSource).toMatch(/nombre_servicio_archivo/);
  expect(internalSource).toMatch(/nombre_servicio_archivo/);
});

test('@critical @network contrato de reconexión: después de validar estabilidad la app hace un único reload tipo F5', async () => {
  const source = await fs.readFile(path.join(process.cwd(), 'src/context/NetworkContext.jsx'), 'utf8');
  expect(source).toMatch(/SUCCESSES_TO_UNLOCK\s*=\s*3/);
  expect(source).toMatch(/prev\s*===\s*true\s*&&\s*offline\s*===\s*false/);
  expect(source).toMatch(/window\.location\.reload\(\)/);
  expect(source).toMatch(/prevOfflineRef\.current\s*=\s*offline/);
});

test('@critical @documentos padron ARCA está enrutable en la estructura nueva y un CUIT inválido falla controlado sin intentar emitir', async ({ page }) => {
  await page.goto('/panel/facturacion', { waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);

  const result = await authenticatedApi(page, 'padron_cuit', {
    query: { cuit: '123', _: Date.now() },
  });
  expect(result.status, `padron_cuit no debe explotar con HTTP 500: ${result.text || ''}`).toBe(422);
  expect(String(result.body?.error || result.body?.mensaje || result.body?.message || '')).toMatch(/CUIT inválido.*11 dígitos/i);
});
