// Descuento general en el PDF de presupuestos de BALTO Comercio (igual que
// BALTO Servicios), sin backend ni escrituras.
// Ejecutar desde frontend/: node tests/presupuesto-descuento-pdf.regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeJsPDF {
  constructor() {
    this.pages = [[]];
    this.rects = [[]];
    this.page = 0;
    this.fontSize = 10;
    this.internal = {
      pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 },
      getNumberOfPages: () => this.pages.length,
    };
  }
  setFont() { return this; }
  setFontSize(n) { this.fontSize = n; return this; }
  setLineWidth() { return this; }
  setFillColor() { return this; }
  rect(x, y, w, h, mode = 'S') { this.rects[this.page].push({ x, y, w, h, mode }); return this; }
  line() { return this; }
  getTextWidth(t) { return String(t).length * this.fontSize * 0.48; }
  text(value, x, y) { this.pages[this.page].push({ text: String(value), x, y, fontSize: this.fontSize }); return this; }
  addPage() { this.pages.push([]); this.rects.push([]); this.page = this.pages.length - 1; return this; }
  setPage(n) { this.page = n - 1; return this; }
  addImage() { return this; }
}

const builderPath = path.resolve(__dirname, '../src/utils/PresupuestoPdfBuilder.js');
const source = fs.readFileSync(builderPath, 'utf8')
  .replace(/^import jsPDF from "jspdf";\s*$/m, '')
  .replace(/^import BASE_URL from "\.\.\/config\/config";\s*$/m, '')
  .replace(/^export async function /gm, 'async function ');
const context = { jsPDF: FakeJsPDF, BASE_URL: 'http://localhost:8000/', URL, URLSearchParams };
vm.runInNewContext(`${source}\nthis.buildPresupuestoPdf = buildPresupuestoPdf;`, context, { filename: builderPath });

const sampleItem = (idx, extras = {}) => ({
  codigo: `COD${idx}`,
  descripcion: `PRODUCTO PRUEBA ${idx}`,
  cantidad: 2,
  precio: 125,
  subtotal: 250,
  iva_pct: 21,
  iva_monto: 52.5,
  total: 302.5,
  unidad: 'u',
  ...extras,
});
const basic = {
  fecha_cbte_iso: '2026-10-15',
  numero_presupuesto: 42,
  cliente_nombre: 'CLIENTE PRUEBA',
  emisor_nombre: 'BALTO',
  items: [sampleItem(1)],
};
const pageTexts = (pdf, page = 0) => pdf.pages[page].map((entry) => entry.text);
const allTexts = (pdf) => pdf.pages.flatMap((page) => page.map((entry) => entry.text));


async function testPdf() {
  // Sin descuento: mismo PDF de siempre.
  const sin = await context.buildPresupuestoPdf({ data: basic });
  assert.ok(!allTexts(sin).some((t) => /Descuento general/.test(t)), 'Sin descuento no aparece la línea de descuento');
  assert.ok(allTexts(sin).includes('Subtotal: $') && allTexts(sin).includes('302,50'));

  // $278.000 − $28.000 = $250.000. Renglones con importes ORIGINALES.
  const items = [
    sampleItem(1, { descripcion: 'EQUIPO', cantidad: 2, precio: 100000, subtotal: 200000, iva_pct: 21, iva_monto: 42000, total: 242000 }),
    sampleItem(2, { descripcion: 'MANO DE OBRA', cantidad: 1, precio: 36000, subtotal: 36000, iva_pct: 0, iva_monto: 0, total: 36000 }),
  ];
  const data = {
    ...basic, items,
    subtotal_ars: 211035.26, iva_ars: 38964.74, total_ars: 250000,
    descuento_tipo: 'MONTO', descuento_valor: 28000, descuento_monto: 28000, total_bruto: 278000,
  };
  const pdf = await context.buildPresupuestoPdf({ data });
  const t = allTexts(pdf);
  assert.ok(t.includes('Total original: $') && t.includes('278.000,00'), 'Total original');
  assert.ok(t.includes('Descuento general: $') && t.includes('- 28.000,00'), 'Descuento informado una sola vez');
  assert.ok(t.some((x) => /^\(equiv\. 10,07 % sobre el total original\)$/.test(x)), 'Equivalente porcentual del monto fijo');
  assert.ok(t.includes('Subtotal neto: $') && t.includes('211.035,26'), 'Subtotal neto');
  assert.ok(t.includes('38.964,74'), 'IVA neto');
  assert.ok(t.includes('Importe Total: $') && t.includes('250.000,00'), 'Total final');
  assert.ok(t.includes('100.000,00') && t.includes('200.000,00'), 'Renglón con precio y subtotal originales');
  assert.equal(t.filter((x) => x === '- 28.000,00').length, 1, 'El descuento no se resta dos veces');

  // Porcentaje.
  const pct = await context.buildPresupuestoPdf({ data: { ...data, descuento_tipo: 'PORCENTAJE', descuento_valor: 10, descuento_monto: 27800, total_ars: 250200, iva_ars: 39000 } });
  assert.ok(allTexts(pct).includes('(10,00 % sobre el total original)'), 'Etiqueta de porcentaje');

  // Paginación: con el cuadro de totales más alto nada se superpone ni se pierde.
  const many = await context.buildPresupuestoPdf({ data: {
    ...data,
    items: Array.from({ length: 45 }, (_, i) => sampleItem(i + 1, { descripcion: `ITEM_DESC_${i + 1}` })),
  } });
  assert.ok(many.pages.length > 1, '45 renglones paginan');
  for (let i = 1; i <= 45; i++) {
    assert.equal(allTexts(many).filter((x) => x === `ITEM_DESC_${i}`).length, 1, `Ítem ${i} ausente o duplicado`);
  }
  const last = many.pages[many.pages.length - 1];
  const totalOriginal = last.find((r) => r.text === 'Total original: $');
  const lastItem = last.filter((r) => /^ITEM_DESC_/.test(r.text)).pop();
  assert.ok(totalOriginal, 'Totales en la última hoja');
  if (lastItem) assert.ok(lastItem.y < totalOriginal.y, 'Los totales no se superponen con los renglones');
  return true;
}
module.exports = testPdf;
if (require.main === module) {
  testPdf()
    .then(() => console.log('OK: PDF de presupuesto con descuento general (monto, porcentaje, sin descuento y paginación).'))
    .catch((err) => { console.error(err); process.exit(1); });
}
