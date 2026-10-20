// Pruebas del PDF de presupuestos de BALTO Comercio, sin backend ni escrituras.
// Ejecutar desde frontend/: node tests/presupuesto-comercio-pdf.regression.cjs
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
  const base = await context.buildPresupuestoPdf({ data: basic });
  assert.ok(!allTexts(base).some((t) => t.startsWith('PRESUPUESTO: ')), 'Presupuesto común sin modelo no debe inventar un título');
  assert.ok(allTexts(base).includes('Subtotal'), 'Mantener columna de subtotal de Comercio');
  assert.ok(allTexts(base).includes('250,00'), 'Mantener subtotal por ítem');
  assert.ok(allTexts(base).includes('302,50'), 'Mantener importe total con IVA');
  assert.ok(allTexts(base).includes('21,00'), 'Mantener porcentaje IVA');
  assert.ok(allTexts(base).includes('2'), 'Mantener cantidad');

  const modelo = await context.buildPresupuestoPdf({ data: { ...basic, id_modelo_origen: 3, nombre_modelo_origen: 'AA' } });
  const texts = pageTexts(modelo);
  const title = texts.find((t) => t.startsWith('PRESUPUESTO: AA'));
  assert.equal(title, 'PRESUPUESTO: AA', 'Título de modelo en una única barra compacta');
  assert.ok(texts.indexOf(title) < texts.indexOf('Producto / Servicio'), 'Título del modelo antes de la tabla');
  const titleRow = modelo.pages[0].find((t) => t.text === title);
  assert.ok(modelo.rects[0].some((r) => r.x === 10 && r.w > 570 && r.h === 22 && Math.abs(r.y + 15 - titleRow.y) < .1), 'Barra compacta de 22 puntos');
  assert.equal(allTexts(modelo).filter((t) => t === '250,00').length, 2, 'Subtotal del producto y subtotal final sin alteraciones');

  const nuevoModelo = await context.buildPresupuestoPdf({ data: { ...basic, guardar_como_modelo: 1, modelo_nombre: 'CATALOGO NUEVO' } });
  assert.ok(allTexts(nuevoModelo).includes('PRESUPUESTO: CATALOGO NUEVO'));
  const desdeOrigen = await context.buildPresupuestoPdf({ data: { ...basic, guardar_como_modelo: 1, modelo_nombre: 'NO DEBE APARECER', nombre_modelo_origen: 'MODELO ORIGINAL' } });
  assert.ok(allTexts(desdeOrigen).includes('PRESUPUESTO: MODELO ORIGINAL'));
  assert.ok(!allTexts(desdeOrigen).includes('PRESUPUESTO: NO DEBE APARECER'));

  const largo = 'PROVISION DE INSUMOS EQUIPOS HERRAMIENTAS MATERIALES Y ACCESORIOS CON ENTREGA PROGRAMADA A SUCURSALES EN DISTINTAS PROVINCIAS ARGENTINAS';
  const tituloLargo = await context.buildPresupuestoPdf({ data: { ...basic, nombre_modelo_origen: largo } });
  const firstColumn = tituloLargo.pages[0].find((t) => t.text === 'Producto / Servicio');
  const lines = tituloLargo.pages[0].filter((t) => t.y < firstColumn.y && (t.text.includes('PRESUPUESTO:') || t.text.includes('PROVINCIAS') || t.text.includes('ARGENTINAS')));
  assert.ok(lines.length >= 2, 'Título largo debe ocupar múltiples líneas');
  assert.ok(lines.map((t) => t.text).join(' ').includes('ARGENTINAS'), 'El título no debe cortarse');
  assert.ok(lines.every((t) => t.y < firstColumn.y), 'Título completo antes de la tabla');

  const many = await context.buildPresupuestoPdf({ data: {
    ...basic, nombre_modelo_origen: 'CATALOGO DE SUCURSAL',
    items: Array.from({ length: 40 }, (_, i) => sampleItem(i + 1, { descripcion: `ITEM_UNICO_${i + 1}` })),
  } });
  assert.ok(many.pages.length > 1, '40 renglones deben paginar');
  for (const page of many.pages) {
    assert.ok(page.some((r) => r.text === 'PRESUPUESTO: CATALOGO DE SUCURSAL'), 'El título debe repetirse por página');
    assert.ok(page.some((r) => r.text === 'Producto / Servicio'), 'Encabezado de columnas en cada página');
  }
  for (let i = 1; i <= 40; i++) {
    assert.equal(allTexts(many).filter((t) => t === `ITEM_UNICO_${i}`).length, 1, `Ítem ${i} ausente o duplicado`);
  }

  const descripcionLarga = 'INICIO_UNICO ' + Array.from({ length: 350 }, (_, i) => `PIEZA${i}`).join(' ') + ' FINAL_UNICO';
  const overflow = await context.buildPresupuestoPdf({ data: { ...basic, nombre_modelo_origen: 'AA', items: [sampleItem(1, { descripcion: descripcionLarga })] } });
  assert.ok(overflow.pages.length > 1);
  const joined = allTexts(overflow).join(' ');
  assert.ok(joined.includes('INICIO_UNICO') && joined.includes('FINAL_UNICO'), 'La descripción debe conservar el comienzo y el final');
  assert.equal(allTexts(overflow).filter((t) => t === '250,00').length, 2, 'Subtotal sólo en la fila original y resumen final');
  for (const page of overflow.pages) {
    assert.ok(page.some((r) => r.text === 'PRESUPUESTO: AA'));
  }
  return true;
}
module.exports = testPdf;
if (require.main === module) {
  testPdf()
    .then(() => console.log('OK: Comercio - modelo, barra compacta, importes, IVA, paginación y descripciones largas.'))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
