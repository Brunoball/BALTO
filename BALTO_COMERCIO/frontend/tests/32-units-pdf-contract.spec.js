import { test, expect } from './support/test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const sourcePath = (...parts) => path.resolve(process.cwd(), 'src', ...parts);

const SOURCE_FILES = {
  factura: sourcePath('utils', 'FacturaPdfBuilder.js'),
  ventaNoFacturada: sourcePath('utils', 'VentaNoFacturadaPdfBuilder.js'),
  remito: sourcePath('utils', 'RemitoPdfBuilder.js'),
  presupuesto: sourcePath('utils', 'PresupuestoPdfBuilder.js'),
  notaCredito: sourcePath('utils', 'NotaCreditoPdfBuilder.js'),
  ventaModal: sourcePath('components', 'Mov_Subsection', 'Ventas', 'modales', 'ModalNuevaVenta.jsx'),
  presupuestoModal: sourcePath('components', 'Mov_Subsection', 'Documentos_Comerciales', 'modales', 'ModalNuevoPresupuesto.jsx'),
  facturaDatos: sourcePath('components', 'Mov_Subsection', 'Facturacion', 'ModalFacturaDatos.jsx'),
};

async function readSource(filePath) {
  return fs.readFile(filePath, 'utf8');
}


function expectThreeDecimalQuantityFormatter(source, label) {
  expect(source, `${label}: debe existir qtyEs para cantidades`).toMatch(/function\s+qtyEs\s*\(/);
  expect(source, `${label}: qtyEs debe conservar hasta 3 decimales`).toMatch(
    /function\s+qtyEs\s*\([^)]*\)\s*\{[\s\S]{0,500}?maximumFractionDigits\s*:\s*3/,
  );
  expect(source, `${label}: las cantidades impresas deben pasar por qtyEs`).toMatch(/qtyEs\([^\n]*cantidad/);
}

test('@pdf @unidades @contract PDFs conservan 0,125 y reciben la unidad real del producto', async () => {
  const [factura, ventaNoFacturada, remito, presupuesto, notaCredito, ventaModal, presupuestoModal, facturaDatos] = await Promise.all(
    Object.values(SOURCE_FILES).map(readSource),
  );

  expectThreeDecimalQuantityFormatter(factura, 'Factura');
  expectThreeDecimalQuantityFormatter(ventaNoFacturada, 'Venta no facturada');
  expectThreeDecimalQuantityFormatter(remito, 'Remito');
  expectThreeDecimalQuantityFormatter(presupuesto, 'Presupuesto');

  // La NC imprime la cantidad exacta recibida; evita volver a redondearla con el formateador monetario de 2 decimales.
  expect(notaCredito).toMatch(/cantidad\s*:\s*Number\(it\?\.cantidad\s*\?\?\s*1\)/);
  expect(notaCredito).toMatch(/doc\.text\(String\(it\.cantidad\)/);

  // Contrato de payload: un producto real lleva su abreviatura (kg/g/ml/etc.); "u" queda sólo como fallback.
  expect(ventaModal).toMatch(/unidad\s*:\s*safeStr\(r\.unidad_abreviatura\s*\|\|\s*["']u["']\)/);
  expect(presupuestoModal).toMatch(/unidad\s*:\s*r\.unidad_abreviatura\s*\|\|\s*["']u["']/);
  expect(facturaDatos).toMatch(/it\?\.unidad\s*\|\|\s*it\?\.unidad_abreviatura\s*\|\|\s*it\?\.unidad_nombre/);
});
