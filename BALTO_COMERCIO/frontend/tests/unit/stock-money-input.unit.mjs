// Pruebas unitarias de la entrada de importes de Stock (alta, edición y panel de rentabilidad).
// Ejecutar:  node tests/unit/stock-money-input.unit.mjs
// moneyInput.js no importa nada: se copia a un .mjs temporal y se importa.
//
// Reclamo del cliente (video 24/11/2026): en "Editar producto" la coma del precio
// de costo no se podía escribir ("5162" + "," + "50" terminaba en 516250).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env.BALTO_SRC_DIR
  ? join(process.env.BALTO_SRC_DIR, 'components/Stock/utils/moneyInput.js')
  : resolve(here, '../../src/components/Stock/utils/moneyInput.js');
const tmp = join(mkdtempSync(join(tmpdir(), 'balto-money-')), 'moneyInput.mjs');
writeFileSync(tmp, readFileSync(src, 'utf8'));
const u = await import(pathToFileURL(tmp).href);

let ok = 0;
const t = (name, fn) => { fn(); ok += 1; console.log(`[OK] ${name}`); };

t('escritura parcial: la coma y los ceros finales se conservan mientras se escribe', () => {
  const pasos = ['5', '51', '516', '5162', '5162,', '5162,5', '5162,50'];
  for (const paso of pasos) assert.equal(u.normalizeMoneyInput(paso), paso);
});
t('punto del teclado numérico = coma decimal', () => {
  assert.equal(u.normalizeMoneyInput('5162.'), '5162,');
  assert.equal(u.normalizeMoneyInput('5162.75'), '5162,75');
});
t('máximo dos decimales y una sola coma', () => {
  assert.equal(u.normalizeMoneyInput('10300,999'), '10300,99');
  assert.equal(u.normalizeMoneyInput('1,2,3'), '1,23');
});
t('re-edición de un importe ya formateado no se reinterpreta como 9,87', () => {
  assert.equal(u.normalizeMoneyInput('$ 9.870,50'), '9870,50');
  assert.equal(u.normalizeMoneyInput('9.870,501'), '9870,50');
  assert.equal(u.normalizeMoneyInput('1.234.567,8'), '1234567,8');
});
t('márgenes: signo negativo sólo cuando se permite', () => {
  assert.equal(u.normalizeTypedDecimal('-12,5', { allowNegative: true }), '-12,5');
  assert.equal(u.normalizeTypedDecimal('-', { allowNegative: true }), '-');
  assert.equal(u.normalizeTypedDecimal('-12,5'), '12,5');
  assert.equal(u.normalizeTypedDecimal('49,88 %', { allowNegative: true }), '49,88');
});
t('parseMoneyInput: interfaz y API con el mismo criterio', () => {
  const casos = [
    ['9870,50', 9870.5], ['9.870,50', 9870.5], ['$ 9.870,50', 9870.5],
    ['5162.50', 5162.5], ['5162.500', 5162.5], ['5162', 5162], ['5.162', 5162],
    ['1.234.567', 1234567], ['5162,', 5162], ['-12,5', -12.5], [0, 0], [10300.9, 10300.9],
  ];
  for (const [entrada, esperado] of casos) assert.equal(u.parseMoneyInput(entrada), esperado, String(entrada));
  for (const vacio of ['', null, undefined, ',', '-', 'abc']) assert.equal(u.parseMoneyInput(vacio), null, String(vacio));
});
t('importe del video escrito por partes: 5162,50 se interpreta como 5162.5 (sin coeficiente)', () => {
  // El coeficiente ponderado fue retirado. Se conserva la verificación de que
  // el costo escrito por partes llega entero al cálculo de rentabilidad.
  const costo = u.parseMoneyInput(u.normalizeMoneyInput('5162,50'));
  assert.equal(costo, 5162.5);
  assert.equal(u.parseMoneyInput(u.normalizeMoneyInput('9870,')), 9870);
});

console.log(`\n${ok} pruebas OK`);
