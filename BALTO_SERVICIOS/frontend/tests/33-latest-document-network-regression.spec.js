import { test, expect } from './support/test.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticatedApi } from './support/api.js';
import { waitForBusyToFinish } from './support/ui.js';

test('@critical @documentos contrato PDF: el renglón conserva el nombre del servicio, agrega la composición sin precios internos y usa el servicio en el nombre del archivo', async () => {
  const root = process.cwd();
  const saleSource = await fs.readFile(
    path.join(root, 'src/components/Mov_Subsection/Ventas/modales/ModalNuevaVenta.jsx'),
    'utf8',
  );
  const budgetSource = await fs.readFile(
    path.join(root, 'src/components/Mov_Subsection/Documentos_Comerciales/modales/ModalNuevoPresupuesto.jsx'),
    'utf8',
  );
  const facturaSource = await fs.readFile(path.join(root, 'src/utils/FacturaPdfBuilder.js'), 'utf8');
  const remitoSource = await fs.readFile(path.join(root, 'src/utils/RemitoPdfBuilder.js'), 'utf8');
  const internalSource = await fs.readFile(path.join(root, 'src/utils/VentaNoFacturadaPdfBuilder.js'), 'utf8');

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

  const budgetStart = budgetSource.indexOf('function buildServiceDocumentDescription');
  const budgetEnd = budgetSource.indexOf('function normalizeText', budgetStart);
  expect(budgetStart).toBeGreaterThanOrEqual(0);
  expect(budgetEnd).toBeGreaterThan(budgetStart);
  const budgetDescriptionContract = budgetSource.slice(budgetStart, budgetEnd);
  expect(budgetDescriptionContract).toContain('normalizeServiceStockComponents(row?.consumos_snapshot)');
  expect(budgetDescriptionContract).toContain('Incluye:');
  expect(budgetDescriptionContract).toMatch(/cantidad_por_unidad/);
  expect(budgetDescriptionContract).toMatch(/unidad_simbolo/);
  expect(budgetDescriptionContract).not.toMatch(/costo_unitario|precio_unitario|precio_venta|monto/i);
  expect(budgetSource).toContain('const pdfItems = buildPdfItemsPayload();');
  expect(budgetSource).toContain('uploadPresupuestoPdf({ idMovimiento, payload, items: pdfItems })');

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
