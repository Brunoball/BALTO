// Pruebas unitarias de la rentabilidad bruta de Stock (alta y edición de productos).
// Ejecutar:  node tests/unit/stock-gross-profitability.unit.mjs
//
// grossProfitability.js importa ./moneyInput: ambos se copian a un directorio
// temporal como .mjs (mismo criterio que stock-money-input.unit.mjs).
//
// Contrato (retiro del coeficiente ponderado, 26/11/2026):
//   Ganancia = PV − PC | Margen = (PV − PC) / PV | Recargo = (PV − PC) / PC
//   Costo y precio -> rentabilidad. Desde el 27/11/2026 la ganancia, el margen
//   y el recargo también se editan a mano y recalculan SÓLO el precio:
//   PV = PC + G | PV = PC / (1 − M/100) | PV = PC × (1 + R/100)
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const utilsDir = process.env.BALTO_SRC_DIR
  ? join(process.env.BALTO_SRC_DIR, 'components/Stock/utils')
  : resolve(here, '../../src/components/Stock/utils');
const dir = mkdtempSync(join(tmpdir(), 'balto-rentabilidad-'));
writeFileSync(join(dir, 'moneyInput.mjs'), readFileSync(join(utilsDir, 'moneyInput.js'), 'utf8'));
const source = readFileSync(join(utilsDir, 'grossProfitability.js'), 'utf8')
  .replace(/from\s+["']\.\/moneyInput["']/, 'from "./moneyInput.mjs"');
writeFileSync(join(dir, 'grossProfitability.mjs'), source);
const g = await import(pathToFileURL(join(dir, 'grossProfitability.mjs')).href);
const m = await import(pathToFileURL(join(dir, 'moneyInput.mjs')).href);

let ok = 0;
const t = (name, fn) => { fn(); ok += 1; console.log(`[OK] ${name}`); };

const show = (cost, price) => {
  const r = g.calculateGrossProfitability(cost, price);
  return [g.formatProfitMoney(r.profit), g.formatProfitPercent(r.marginPct), g.formatProfitPercent(r.markupPct)];
};

t('tabla de comprobaciones obligatorias del pedido', () => {
  const casos = [
    ['7.372,73', '14.000', ['$ 6.627,27', '47,34%', '89,89%']],
    ['7.372,73', '15.000', ['$ 7.627,27', '50,85%', '103,45%']],
    ['10.000', '14.000', ['$ 4.000,00', '28,57%', '40,00%']],
    ['10.000', '8.000', ['-$ 2.000,00', '-25,00%', '-20,00%']],
    ['10.000', '10.000', ['$ 0,00', '0,00%', '0,00%']],
    ['0', '10.000', ['$ 10.000,00', '100,00%', '—']],
  ];
  for (const [cost, price, esperado] of casos) {
    assert.deepEqual(show(cost, price), esperado, `${cost} / ${price}`);
  }
});

t('promoción 12.000 con costo 7.372,73: $ 4.627,27 y 38,56%', () => {
  const r = g.calculateGrossProfitability('7.372,73', '12000');
  assert.equal(g.formatProfitMoney(r.profit), '$ 4.627,27');
  assert.equal(g.formatProfitPercent(r.marginPct), '38,56%');
  assert.equal(r.belowCost, false);
});

t('formatos de escritura del costo: 7372,73 | 7372.73 | 7.372,73 dan el mismo resultado', () => {
  for (const cost of ['7372,73', '7372.73', '7.372,73', '$ 7.372,73']) {
    assert.deepEqual(show(cost, '14000'), ['$ 6.627,27', '47,34%', '89,89%'], cost);
  }
  assert.deepEqual(show('9870,50', '12000'), show('9870.5', '12000'));
  assert.deepEqual(show('5162,50', '10000'), show(5162.5, 10000));
});

t('escritura parcial y borrado de centavos (como llega desde normalizeMoneyInput)', () => {
  const pasos = ['9', '98', '987', '9870', '9870,', '9870,5', '9870,50', '9870,5', '9870,', '9870'];
  for (const paso of pasos) {
    const r = g.calculateGrossProfitability(m.normalizeMoneyInput(paso), '12000');
    assert.ok(r.profit !== null && Number.isFinite(r.profit), paso);
  }
  assert.equal(g.calculateGrossProfitability('9870,', '12000').profit, 2130);
});

t('pegado de importes formateados', () => {
  const pegado = m.normalizeMoneyInput('$ 7.372,73');
  assert.equal(pegado, '7372,73');
  assert.deepEqual(show(pegado, '14.000,00'), ['$ 6.627,27', '47,34%', '89,89%']);
});

t('vacío no es cero: sin costo o sin venta -> todos los indicadores en —', () => {
  for (const [cost, price] of [['', '14000'], ['7000', ''], [null, '1'], ['1', undefined], ['', '']]) {
    const r = g.calculateGrossProfitability(cost, price);
    assert.equal(r.profit, null);
    assert.equal(r.marginPct, null);
    assert.equal(r.markupPct, null);
    assert.equal(r.belowCost, false);
  }
  assert.deepEqual(show('', '14000'), ['—', '—', '—']);
});

t('venta cero: margen — (división por cero) y el resto válido', () => {
  const r = g.calculateGrossProfitability('10000', '0');
  assert.equal(r.profit, -10000);
  assert.equal(r.marginPct, null);
  assert.equal(r.markupPct, -100);
  assert.equal(r.belowCost, true);
  assert.deepEqual(show('10000', '0'), ['-$ 10.000,00', '—', '-100,00%']);
  assert.deepEqual(show('0', '0'), ['$ 0,00', '—', '—']);
});

t('importes negativos en los campos no se aceptan como precio', () => {
  assert.equal(g.parsePriceAmount('-5'), null);
  assert.equal(g.parsePriceAmount(-5), null);
  assert.deepEqual(show('-100', '200'), ['—', '—', '—']);
});

t('nunca NaN, Infinity ni undefined en la salida', () => {
  const raros = ['abc', ',', '-', '.', NaN, Infinity, -Infinity, {}, [], '1e400'];
  for (const a of raros) {
    for (const b of [...raros, '100', 0]) {
      for (const text of show(a, b)) {
        assert.ok(!/NaN|Infinity|undefined/.test(text), `${String(a)} / ${String(b)} -> ${text}`);
      }
    }
  }
});

t('valores grandes dentro de DECIMAL(12,2)', () => {
  const r = g.calculateGrossProfitability('9999999999.99', '9999999999.99');
  assert.equal(r.profit, 0);
  assert.deepEqual(show('1.000.000,00', '9.999.999.999,99'), ['$ 9.998.999.999,99', '99,99%', '999.900,00%']);
});

t('margen mostrado sale de los importes completos (no de valores redondeados)', () => {
  const r = g.calculateGrossProfitability('7372.73', '14000');
  assert.ok(Math.abs(r.marginPct - 47.33764285714286) < 1e-9);
});

t('profitabilityToApi devuelve márgenes coherentes con precio y costo', () => {
  assert.deepEqual(g.profitabilityToApi('7.372,73', '14000'), { margen_porcentaje: '47.34', margen_valor: '6627.27' });
  assert.deepEqual(g.profitabilityToApi('', '14000'), { margen_porcentaje: '', margen_valor: '' });
  assert.deepEqual(g.profitabilityToApi('10000', '0'), { margen_porcentaje: '', margen_valor: '-10000.00' });
});

t('función pura: no depende de gastos, coeficientes ni utilidad deseada', () => {
  const src = readFileSync(join(utilsDir, 'grossProfitability.js'), 'utf8').toLowerCase();
  // Sólo puede mencionarlos en el comentario que explica que NO intervienen.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const palabra of ['coeficiente', 'utilidad', 'gasto', 'fetch(', 'stockapi']) {
    assert.ok(!code.includes(palabra), palabra);
  }
});

t('edición inversa: margen, recargo y ganancia -> precio de venta (caso de la captura)', () => {
  // Costo 8.500: margen 60% -> 21.250; recargo 152,25% -> 21.441,25; ganancia 12.941,32 -> 21.441,32.
  assert.deepEqual(g.priceFromProfitability('marginPct', '8500,00', '60'), { price: 21250, error: null });
  assert.deepEqual(g.priceFromProfitability('markupPct', '8500,00', '152,25'), { price: 21441.25, error: null });
  assert.deepEqual(g.priceFromProfitability('profit', '8500,00', '12941,32'), { price: 21441.32, error: null });
  // Punto del teclado numérico como decimal y símbolos pegados.
  assert.equal(g.priceFromProfitability('marginPct', '8500', '60.5').price, 21518.99);
  assert.equal(g.priceFromProfitability('markupPct', '8500', '50 %').price, 12750);
  assert.equal(g.priceFromProfitability('profit', '8.500,00', '$ 1.000,50').price, 9500.5);
});

t('edición inversa: ida y vuelta consistente a centavos', () => {
  // El margen/recargo recalculado con el precio redondeado muestra lo que se escribió.
  for (const [cost, pct, texto] of [['7372,73', '47,34', '47,34%'], ['10000', '33', '33,00%'], ['1250,5', '12,5', '12,50%'], ['8500', '60', '60,00%']]) {
    const { price } = g.priceFromProfitability('marginPct', cost, pct);
    assert.equal(g.formatProfitPercent(g.calculateGrossProfitability(cost, price).marginPct), texto, `margen ${cost}/${pct}`);
    const rec = g.priceFromProfitability('markupPct', cost, pct);
    assert.equal(g.formatProfitPercent(g.calculateGrossProfitability(cost, rec.price).markupPct), texto, `recargo ${cost}/${pct}`);
  }
  assert.equal(g.priceFromProfitability('markupPct', '7372,73', '89,89').price, 14000.08);
  // Margen 0 / recargo 0 / ganancia 0 -> precio = costo.
  for (const kind of ['marginPct', 'markupPct', 'profit']) {
    assert.equal(g.priceFromProfitability(kind, '8500', '0').price, 8500, kind);
  }
});

t('edición inversa: límites y errores, nunca NaN ni Infinity', () => {
  const E = g.PROFIT_EDIT_ERRORS;
  assert.deepEqual(g.priceFromProfitability('marginPct', '8500', '100'), { price: null, error: E.margenMaximo });
  assert.deepEqual(g.priceFromProfitability('marginPct', '8500', '150'), { price: null, error: E.margenMaximo });
  assert.equal(g.priceFromProfitability('marginPct', '8500', '99,99').price, 85000000);
  assert.deepEqual(g.priceFromProfitability('marginPct', '', '60'), { price: null, error: E.sinCosto });
  assert.deepEqual(g.priceFromProfitability('markupPct', '0', '60'), { price: null, error: E.sinCosto });
  assert.deepEqual(g.priceFromProfitability('marginPct', '0', '60'), { price: null, error: E.sinCosto });
  // La ganancia sí admite costo 0 (PV = G), pero no costo vacío.
  assert.equal(g.priceFromProfitability('profit', '0', '500').price, 500);
  assert.deepEqual(g.priceFromProfitability('profit', '', '500'), { price: null, error: E.sinCosto });
  assert.deepEqual(g.priceFromProfitability('profit', '8500', ''), { price: null, error: E.invalido });
  assert.deepEqual(g.priceFromProfitability('profit', '8500', '-5'), { price: null, error: E.invalido });
  assert.deepEqual(g.priceFromProfitability('nada', '8500', '5'), { price: null, error: E.invalido });
  // Tope DECIMAL(12,2) del backend.
  assert.deepEqual(g.priceFromProfitability('markupPct', '9999999999', '50'), { price: null, error: E.maximo });
  assert.equal(g.priceFromProfitability('profit', '9999999998,99', '1').price, 9999999999.99);
});

t('formatos de edición: input de precio e indicador plano', () => {
  assert.equal(g.formatPriceForInput(21250), '21250,00');
  assert.equal(g.formatPriceForInput(21441.32), '21441,32');
  assert.equal(g.formatPriceForInput(null), '');
  assert.equal(g.formatPriceForInput(NaN), '');
  assert.equal(g.formatIndicatorForEdit(60.3612), '60,36');
  assert.equal(g.formatIndicatorForEdit(152.2508), '152,25');
  assert.equal(g.formatIndicatorForEdit(12941.32), '12941,32');
  assert.equal(g.formatIndicatorForEdit(-0.001), '0,00');
  assert.equal(g.formatIndicatorForEdit(null), '');
  // Lo que se muestra al editar vuelve a leerse igual.
  assert.equal(m.parseMoneyInput(g.formatIndicatorForEdit(12941.32)), 12941.32);
});

console.log(`\n${ok} pruebas OK`);
