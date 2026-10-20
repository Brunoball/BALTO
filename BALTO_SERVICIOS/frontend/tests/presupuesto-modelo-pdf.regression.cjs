// Regresión del encabezado compacto y de paginación del presupuesto.
// No modifica datos ni necesita Hostinger.
// Ejecutar desde frontend/: node tests/presupuesto-modelo-pdf.regression.cjs
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
  rect(x, y, w, h, mode = 'S') {
    this.rects[this.page].push({ x, y, w, h, mode }); return this;
  }
  line() { return this; }
  getTextWidth(txt) { return String(txt).length * this.fontSize * 0.48; }
  text(value, x, y) {
    this.pages[this.page].push({ text: String(value), x, y, fontSize: this.fontSize });
    return this;
  }
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
vm.runInNewContext(`${source}\nthis.buildPresupuestoPdf = buildPresupuestoPdf;`, context, {
  filename: builderPath,
});

const sampleItem = (idx, extra = {}) => ({
  descripcion: `MATERIAL PRUEBA ${idx}`, cantidad: 1, precio: 100,
  subtotal: 100, iva_pct: 21, iva_monto: 21, total: 121,
  desglose_servicio: true, grupo_servicio: 'MUEBLE ROBLE', grupo_clave: '1', ...extra,
});
const basicData = {
  fecha_cbte_iso: '2026-10-15',
  numero_presupuesto: 42,
  cliente_nombre: 'CLIENTE PRUEBA',
  emisor_nombre: 'BALTO',
  items: [sampleItem(1)],
};
const texts = (doc, page = 0) => doc.pages[page].map((row) => row.text);
const allTexts = (doc) => doc.pages.flatMap((page) => page.map((row) => row.text));

async function runRegression() {
  // Caso real del usuario: presupuesto y servicio en UNA línea, una sola franja.
  const model = await context.buildPresupuestoPdf({
    data: { ...basicData, id_modelo_origen: 3, nombre_modelo_origen: 'AA' },
  });
  const rendered = texts(model);
  const compactTitle = rendered.find((value) => value.includes('PRESUPUESTO: AA'));
  const titlePos = rendered.indexOf(compactTitle);
  const columnsPos = rendered.indexOf('Producto / Servicio');
  assert.match(compactTitle, /PRESUPUESTO: AA\s+\|\s+SERVICIO: MUEBLE ROBLE/,
    'Presupuesto y servicio cortos deben compartir UNA fila');
  assert.ok(columnsPos > titlePos, 'El título debe aparecer antes de la tabla');
  assert.ok(rendered.includes('121,00'), 'No se deben alterar los importes');
  const titleRow = model.pages[0].find((row) => row.text === compactTitle);
  const bar = model.rects[0].find((row) => row.x === 10 && row.w > 570 && row.h === 22 && Math.abs(row.y + 15 - titleRow.y) < 0.1);
  assert.ok(bar, 'El título corto usa una franja de sólo 22 puntos, sin caja doble');

  // Sin modelo se conserva el servicio; el encabezado no queda vacío.
  const normal = await context.buildPresupuestoPdf({ data: basicData });
  assert.ok(!texts(normal).some((value) => value.startsWith('PRESUPUESTO: ')));
  assert.ok(texts(normal).includes('SERVICIO: MUEBLE ROBLE'));

  // Sin servicio desglosado, el título del modelo sigue visible.
  const standalone = await context.buildPresupuestoPdf({
    data: { ...basicData, items: [sampleItem(1, { desglose_servicio: false, grupo_servicio: '', grupo_clave: '' })], nombre_modelo_origen: 'MANTENIMIENTO' },
  });
  assert.ok(texts(standalone).includes('PRESUPUESTO: MANTENIMIENTO'));

  // Guardar modelo en el alta continúa mostrando el título.
  const newModel = await context.buildPresupuestoPdf({
    data: { ...basicData, guardar_como_modelo: 1, modelo_nombre: 'COLOCACIÓN DE EQUIPOS' },
  });
  assert.ok(texts(newModel).some((value) => value.includes('PRESUPUESTO: COLOCACIÓN DE EQUIPOS')));

  // Nombre largo: dos o más líneas EN UNA caja, conservando todo el servicio.
  const longName = 'PROVISIÓN INSTALACIÓN Y MANTENIMIENTO PREVENTIVO Y CORRECTIVO DE EQUIPOS ELÉCTRICOS INDUSTRIALES EN PLANTA Y OFICINAS';
  const long = await context.buildPresupuestoPdf({
    data: { ...basicData, nombre_modelo_origen: longName },
  });
  const tablaY = long.pages[0].find((row) => row.text === 'Producto / Servicio')?.y;
  const headingLines = long.pages[0].filter((row) => row.y < tablaY && /PRESUPUESTO:|PROVISIÓN|MANTENIMIENTO|INDUSTRIALES|OFICINAS|SERVICIO: MUEBLE ROBLE/.test(row.text));
  assert.ok(headingLines.length >= 2, 'Los títulos largos deben ocupar las líneas necesarias');
  assert.ok(headingLines.every((row) => row.y < tablaY), 'El título no puede superponerse a las columnas');
  assert.ok(headingLines.some((row) => row.text === 'SERVICIO: MUEBLE ROBLE'), 'El servicio largo/conjunto debe ser visible entero');
  assert.ok(headingLines.map((row) => row.text).join(' ').includes('OFICINAS'), 'No debe cortar el fin del nombre del modelo');

  // Varios servicios: en la primera franja se combina el nombre del modelo;
  // los siguientes servicios no repiten la etiqueta innecesariamente.
  const multipleServices = await context.buildPresupuestoPdf({
    data: { ...basicData, nombre_modelo_origen: 'AA', items: [sampleItem(1), sampleItem(2, { grupo_servicio: 'SERVICIO DOS', grupo_clave: '2' })] },
  });
  assert.equal(allTexts(multipleServices).filter((value) => value.includes('PRESUPUESTO: AA')).length, multipleServices.pages.length);
  assert.ok(allTexts(multipleServices).includes('SERVICIO: SERVICIO DOS'));

  // Muchas descripciones: paginación normal, encabezados por hoja y sin omisiones.
  const multi = await context.buildPresupuestoPdf({
    data: { ...basicData, nombre_modelo_origen: 'MODELO REPETIDO', items: Array.from({ length: 40 }, (_, idx) => ({
      descripcion: `PRODUCTO_UNICO_${idx + 1}`, cantidad: 1, precio: 100,
      subtotal: 100, iva_pct: 0, iva_monto: 0, total: 100,
    })) },
  });
  assert.ok(multi.pages.length > 1);
  for (const page of multi.pages) {
    assert.ok(page.some((row) => row.text.includes('PRESUPUESTO: MODELO REPETIDO')), 'Cada hoja debe identificar el presupuesto');
  }
  for (let i = 1; i <= 40; i += 1) {
    assert.equal(allTexts(multi).filter((value) => value === `PRODUCTO_UNICO_${i}`).length, 1, `Renglón ${i} ausente o duplicado`);
  }

  // Un solo renglón más largo que una hoja se parte, pero nunca desaparece.
  const veryLong = 'INICIO_UNICO ' + Array.from({ length: 350 }, (_, idx) => `PIEZA${idx}`).join(' ') + ' FINAL_UNICO';
  const split = await context.buildPresupuestoPdf({
    data: { ...basicData, nombre_modelo_origen: 'AA', items: [sampleItem(1, { descripcion: veryLong })] },
  });
  assert.ok(split.pages.length > 1, 'El renglón extremadamente largo necesita varias páginas');
  const splitText = allTexts(split).join(' ');
  assert.ok(splitText.includes('INICIO_UNICO') && splitText.includes('FINAL_UNICO'),
    'Debe imprimirse tanto el principio como el final de la descripción');
  assert.equal(allTexts(split).filter((value) => value === '121,00').length, 2,
    'El total del ítem y el total general se imprimen una sola vez cada uno');

  return true;
}

module.exports = runRegression;
if (require.main === module) {
  runRegression()
    .then(() => process.stdout.write('OK: encabezado compacto, modelo, servicios, múltiples hojas y descripciones largas.\n'))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
