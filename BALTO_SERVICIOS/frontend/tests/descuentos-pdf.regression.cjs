// Regresión pura de los PDFs con descuento general (presupuesto, venta no
// facturada y factura). Verifica el TEXTO dibujado con un jsPDF de prueba:
// precios originales, descuento informado una sola vez, total final correcto,
// columna Bonif. y que etiquetas e importes no se superpongan.
// Ejecutar desde frontend/:  node tests/descuentos-pdf.regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeJsPDF {
  constructor() {
    this.pages = [[]]; this.page = 0; this.fontSize = 10;
    this.internal = { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 }, getNumberOfPages: () => this.pages.length };
  }
  setFont() { return this; } setFontSize(n) { this.fontSize = n; return this; } getFontSize() { return this.fontSize; }
  setLineWidth() { return this; } setFillColor() { return this; } setDrawColor() { return this; } setTextColor() { return this; }
  setLineDashPattern() { return this; } rect() { return this; } roundedRect() { return this; } line() { return this; } addImage() { return this; }
  getTextWidth(t) { return String(t ?? '').length * this.fontSize * 0.5; }
  splitTextToSize(t) { return [String(t ?? '')]; }
  text(value, x, y, opt = {}) { this.pages[this.page].push({ text: String(value), x, y, size: this.fontSize, align: opt?.align || 'left' }); return this; }
  addPage() { this.pages.push([]); this.page = this.pages.length - 1; return this; }
  setPage(n) { this.page = n - 1; return this; } getNumberOfPages() { return this.pages.length; }
  output() { return { __doc: this }; }
}

function loadBuilder(name, exported) {
  const file = path.resolve(__dirname, `../src/utils/${name}.js`);
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import jsPDF from "jspdf";\s*$/m, '')
    .replace(/^import QRCode from "qrcode";\s*$/m, '')
    .replace(/^import BASE_URL from "\.\.\/config\/config";\s*$/m, '')
    .replace(/^export (async )?function /gm, '$1function ');
  const ctx = {
    jsPDF: FakeJsPDF, QRCode: { toDataURL: async () => '' }, BASE_URL: 'http://localhost:8000/', URL, URLSearchParams,
    fetch: async () => { throw new Error('sin red'); }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console, setTimeout, clearTimeout,
    document: { createElement: () => ({}) }, Image: function Image() {}, FileReader: function FileReader() {},
  };
  ctx.window = ctx;
  vm.runInNewContext(`${source}\nthis.__fn = ${exported};`, ctx, { filename: file });
  return ctx.__fn;
}

const textos = (doc) => doc.pages.flat().map((r) => r.text);
const totalImpreso = (doc) => { const t = textos(doc); return t[t.findIndex((x) => /^Importe Total/.test(x)) + 1]; };
function sinSuperposicion(doc) {
  const recs = doc.pages.flat();
  for (const val of recs.filter((r) => r.align === 'right' && /^-? ?[\d.]+,\d{2}$/.test(r.text))) {
    const label = recs.find((r) => r.align === 'left' && Math.abs(r.y - val.y) < 0.5 && /\$$/.test(r.text));
    if (!label) continue;
    assert.ok(label.x + label.text.length * label.size * 0.56 < val.x - val.text.length * val.size * 0.56,
      `superposición: "${label.text}" con "${val.text}"`);
  }
}

async function runRegression() {
  const presupuesto = loadBuilder('PresupuestoPdfBuilder', 'buildPresupuestoPdf');
  const venta = loadBuilder('VentaNoFacturadaPdfBuilder', 'buildVentaNoFacturadaPdf');
  const factura = loadBuilder('FacturaPdfBuilder', 'buildBaltoInvoicePdf');
  const desc = { descuento_tipo: 'MONTO', descuento_valor: 28000, descuento_monto: 28000, total_bruto: 278000 };

  // Presupuesto $278.000 − $28.000 = $250.000 (renglón con precio original).
  let doc = await presupuesto({ data: { ...desc, subtotal_ars: 250000, iva_ars: 0, total_ars: 250000,
    items_facturacion: [{ descripcion: 'PINTURA', cantidad: 1, precio: 278000, iva_pct: 0, subtotal: 278000, iva_monto: 0, total: 278000 }] } });
  let t = textos(doc);
  assert.ok(t.includes('Total original: $') && t.includes('278.000,00') && t.includes('- 28.000,00'));
  assert.ok(t.includes('(equiv. 10,07 % sobre el total original)'));
  assert.equal(totalImpreso(doc), '250.000,00');
  assert.ok(!t.includes('222.000,00'), 'el descuento no debe restarse dos veces');

  // Presupuesto sin descuento: sin cambios.
  doc = await presupuesto({ data: { items_facturacion: [{ descripcion: 'X', cantidad: 2, precio: 100, iva_pct: 21, subtotal: 200, iva_monto: 42, total: 242 }] } });
  assert.ok(!textos(doc).includes('Total original: $')); assert.equal(totalImpreso(doc), '242,00');

  // Presupuesto con servicio desglosado en materiales y mano de obra.
  doc = await presupuesto({ data: { descuento_tipo: 'PORCENTAJE', descuento_valor: 10, descuento_monto: 28556, total_bruto: 285556,
    subtotal_ars: 212396.69, iva_ars: 44603.31, total_ars: 257000, items_facturacion: [
      { descripcion: 'PINTURA', cantidad: 4, precio: 50000, iva_pct: 21, subtotal: 200000, iva_monto: 42000, total: 242000, desglose_servicio: true, grupo_servicio: 'PINTURA DE AMBIENTE' },
      { descripcion: 'MANO DE OBRA', cantidad: 8, precio: 4500, iva_pct: 21, subtotal: 36000, iva_monto: 7560, total: 43560, desglose_servicio: true, grupo_servicio: 'PINTURA DE AMBIENTE' },
    ] } });
  t = textos(doc);
  assert.ok(t.includes('MANO DE OBRA') && t.includes('(10,00 % sobre el total original)'));
  assert.equal(totalImpreso(doc), '257.000,00');

  // Venta no facturada: columna Bonif. y total final.
  doc = await venta({ data: { ...desc, total_ars: 250000, items_facturacion: [{ descripcion: 'PINTURA', cantidad: 1, precio_unitario: 278000, impBonif: 28000, subtotal: 250000, total: 250000 }] } });
  t = textos(doc);
  assert.ok(t.includes('Bonif.') && t.includes('-28.000,00') && t.includes('Total original: $'));
  assert.equal(totalImpreso(doc), '250.000,00');
  doc = await venta({ data: { total_ars: 100, items_facturacion: [{ descripcion: 'X', cantidad: 1, precio: 100, subtotal: 100, total: 100 }] } });
  assert.ok(!textos(doc).includes('Bonif.'));

  // Factura: total = importe autorizado, bonificación por renglón.
  doc = await factura({ data: { ...desc, monto: 250000, importe: 250000, total_ars: 250000, cbte_tipo: 11, pto_vta: 2,
    items_facturacion: [{ descripcion: 'PINTURA', cantidad: 1, precio_unitario: 278000, impBonif: 28000, subtotal: 250000, total: 250000 }] },
  fact: { cae: '1', cae_vto: '20261120', cbte_nro: 1, cbte_tipo: 11, pto_vta: 2, imp_total: 250000 } });
  t = textos(doc);
  assert.ok(t.includes('Bonif.') && t.some((x) => /^Descuento general \(equiv\. 10,07 %\)/.test(x)));
  assert.equal(totalImpreso(doc), '250.000,00');

  // Importes grandes: etiquetas y valores no se superponen.
  const grande = { descuento_tipo: 'MONTO', descuento_valor: 1234567.89, descuento_monto: 1234567.89, total_bruto: 9876543.21, total_ars: 8641975.32, subtotal_ars: 7142128.36, iva_ars: 1499846.96 };
  sinSuperposicion(await presupuesto({ data: { ...grande, items_facturacion: [{ descripcion: 'OBRA', cantidad: 1, precio: 8162432.4, iva_pct: 21, subtotal: 8162432.4, iva_monto: 1714110.81, total: 9876543.21 }] } }));
  sinSuperposicion(await venta({ data: { ...grande, items_facturacion: [{ descripcion: 'OBRA', cantidad: 1, precio_unitario: 8162432.4, impBonif: 1020304.04, subtotal: 7142128.36, total: 8641975.32 }] } }));
  return true;
}

module.exports = runRegression;
if (require.main === module) {
  runRegression()
    .then(() => process.stdout.write('OK: PDFs con descuento general (presupuesto, desglose, venta no facturada, factura, superposición).\n'))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
