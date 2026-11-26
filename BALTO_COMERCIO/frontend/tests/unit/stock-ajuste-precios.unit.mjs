// Pruebas unitarias del cálculo del modal "Ajuste de precios" (Stock).
// Ejecutar:  node tests/unit/stock-ajuste-precios.unit.mjs
// ajustePreciosCalc.js no importa nada: se copia a un .mjs temporal y se importa.
//
// Reclamo de producción (26/11/2026): con un porcentaje cargado y sólo algunos
// productos seleccionados, la tabla mostraba aumento y precio final también en
// los productos DESMARCADOS. El guardado ya enviaba sólo los seleccionados; el
// error era de la vista previa, que no consideraba la selección.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env.BALTO_SRC_DIR
  ? join(process.env.BALTO_SRC_DIR, 'components/Stock/utils/ajustePreciosCalc.js')
  : resolve(here, '../../src/components/Stock/utils/ajustePreciosCalc.js');
const tmp = join(mkdtempSync(join(tmpdir(), 'balto-ajuste-')), 'ajustePreciosCalc.mjs');
writeFileSync(tmp, readFileSync(src, 'utf8'));
const u = await import(pathToFileURL(tmp).href);

let ok = 0;
const t = (name, fn) => { fn(); ok += 1; console.log(`[OK] ${name}`); };

const opciones = [
  { id_stock_producto: 1, id_stock_variante: null, producto_nombre: 'UNO', precio_actual: 1000, precio_heredado: 0 },
  { id_stock_producto: 2, id_stock_variante: null, producto_nombre: 'DOS', precio_actual: 2500.5, precio_heredado: 0 },
  { id_stock_producto: 3, id_stock_variante: null, producto_nombre: 'TRES', precio_actual: 333.33, precio_heredado: 0 },
  { id_stock_producto: 4, id_stock_variante: null, producto_nombre: 'CUATRO', tiene_variantes: 1, precio_actual: 500, precio_heredado: 0 },
  { id_stock_producto: 4, id_stock_variante: 41, producto_nombre: 'CUATRO', variante_nombre: 'ROJO', precio_actual: 600, precio_heredado: 0 },
  { id_stock_producto: 4, id_stock_variante: 42, producto_nombre: 'CUATRO', variante_nombre: 'AZUL', precio_actual: 500, precio_heredado: 1 },
];
const sel = (...keys) => Object.fromEntries(keys.map((k) => [k, true]));

t('fila NO seleccionada: sin ajuste y precio final = actual (reclamo de producción)', () => {
  const v = u.normalizarValorAjuste('porcentaje', '5');
  const r = u.calcularFila(opciones[2], { seleccionado: false, modo: 'porcentaje', valor: v });
  assert.deepEqual(r, { anterior: 333.33, nuevo: 333.33, diferencia: 0, aplica: false });
});

t('fila seleccionada: 5% sobre 2500,50 = 2625,53 (redondeo a centavos)', () => {
  const v = u.normalizarValorAjuste('porcentaje', '5');
  const r = u.calcularFila(opciones[1], { seleccionado: true, modo: 'porcentaje', valor: v });
  assert.deepEqual(r, { anterior: 2500.5, nuevo: 2625.53, diferencia: 125.03, aplica: true });
});

t('resumen exacto sólo con seleccionados', () => {
  const v = u.normalizarValorAjuste('porcentaje', '5');
  const r = u.resumirSeleccion(opciones, sel('1:base', '2:base'), 'porcentaje', v);
  assert.deepEqual(r, { cantidad: 2, conCambio: 2, anterior: 3500.5, nuevo: 3675.53, diferencia: 175.03 });
});

t('payload: exclusivamente filas seleccionadas y elegibles (la heredada se ignora)', () => {
  const items = u.itemsPayload(opciones, sel('1:base', '4:41', '4:42'));
  assert.deepEqual(items, [
    { id_stock_producto: 1, id_stock_variante: null },
    { id_stock_producto: 4, id_stock_variante: 41 },
  ]);
  assert.deepEqual(u.itemsPayload(opciones, {}), []);
});

t('variantes heredadas: impacto informado sólo si el base seleccionado cambia', () => {
  const v = u.normalizarValorAjuste('porcentaje', '5');
  const m = u.impactoHeredado(opciones, sel('4:base'), 'porcentaje', v);
  assert.deepEqual([...m.entries()], [['4:42', { anteriorBase: 500, nuevoBase: 525 }]]);
  assert.equal(u.impactoHeredado(opciones, sel('4:41'), 'porcentaje', v).size, 0);
  assert.equal(u.impactoHeredado(opciones, sel('4:base'), 'porcentaje', null).size, 0);
});

t('modos: importe +/-, porcentaje negativo, precio fijo, nunca negativo', () => {
  assert.equal(u.calcNuevoPrecio(333.33, 'valor', u.normalizarValorAjuste('valor', '-100,5')), 232.83);
  assert.equal(u.calcNuevoPrecio(1000, 'valor', u.normalizarValorAjuste('valor', '1.234,56')), 2234.56);
  assert.equal(u.calcNuevoPrecio(333.33, 'porcentaje', u.normalizarValorAjuste('porcentaje', '-12,5')), 291.66);
  assert.equal(u.calcNuevoPrecio(10, 'fijo', u.normalizarValorAjuste('fijo', '999,99')), 999.99);
  assert.equal(u.calcNuevoPrecio(100, 'valor', -150), 0);
  assert.equal(u.calcNuevoPrecio(100, 'porcentaje', -150), 0);
});

t('valor enviado al backend = valor usado en la vista previa', () => {
  assert.equal(u.valorAjusteParaApi('porcentaje', '5'), '5.0000');
  assert.equal(u.valorAjusteParaApi('porcentaje', '-12,5'), '-12.5000');
  assert.equal(u.valorAjusteParaApi('porcentaje', '5,12345'), '5.1235');
  assert.equal(u.valorAjusteParaApi('valor', '-100,5'), '-100.50');
  assert.equal(u.valorAjusteParaApi('fijo', '1.234,567'), '1234.57');
  assert.equal(u.valorAjusteParaApi('valor', ''), '');
  assert.equal(u.normalizarValorAjuste('valor', '-'), null);
  assert.equal(u.normalizarValorAjuste('valor', 'abc'), null);
});

t('redondeo equivalente a round() de PHP (casos frontera)', () => {
  // Valores verificados con PHP 8.3: round(1.005, 2) = 1.01; round(105.105, 2) = 105.11.
  assert.equal(u.roundMoney(1.005), 1.01);
  assert.equal(u.roundMoney(105.105), 105.11);
  assert.equal(u.roundMoney(-1.005), -1.01);
  assert.equal(u.roundMoney(2625.525), 2625.53);
  assert.equal(u.roundMoney(0.1 + 0.2), 0.3);
  assert.equal(Object.is(u.roundMoney(-0.001), -0), false);
});

t('Seleccionar visibles: el filtro + elegibilidad excluye heredadas', () => {
  const visibles = u.filtrarOpciones(opciones, 'cuatro').filter(u.esSeleccionable).map(u.targetKey);
  assert.deepEqual(visibles, ['4:base', '4:41']);
});

t('agrupa cada producto con sus variantes sin alterar el orden relativo', () => {
  // El backend devuelve primero todos los productos base y después todas las variantes.
  const backend = [opciones[0], opciones[3], opciones[1], opciones[2], opciones[4], opciones[5]];
  assert.deepEqual(
    u.ordenarOpciones(backend).map(u.targetKey),
    ['1:base', '4:base', '4:41', '4:42', '2:base', '3:base']
  );
});

t('tipos de precio: normaliza endpoint y ListasContext, descarta inválidos/inactivos y ordena por ID', () => {
  const desdeListas = u.normalizarTiposPrecio([{ id: 2, nombre: 'VENTA' }, { id: 1, nombre: 'COSTO' }, { id: 0, nombre: 'X' }]);
  assert.deepEqual(desdeListas, [{ id_tipo_precio_stock: 1, nombre: 'COSTO' }, { id_tipo_precio_stock: 2, nombre: 'VENTA' }]);
  const desdeEndpoint = u.normalizarTiposPrecio([{ id_tipo_precio_stock: 5, nombre: 'L', activo: 0 }, { id_tipo_precio_stock: 3, nombre: 'M', activo: 1 }]);
  assert.deepEqual(desdeEndpoint, [{ id_tipo_precio_stock: 3, nombre: 'M' }]);
  assert.deepEqual(u.normalizarTiposPrecio(null), []);
});

t('clave de fila: variante 0/"" se trata como producto base', () => {
  assert.equal(u.targetKey({ id_stock_producto: 7, id_stock_variante: 0 }), '7:base');
  assert.equal(u.targetKey({ id_stock_producto: 7, id_stock_variante: '' }), '7:base');
  assert.equal(u.targetKey({ id_stock_producto: 7, id_stock_variante: '9' }), '7:9');
});

console.log(`\n${ok} pruebas OK`);
