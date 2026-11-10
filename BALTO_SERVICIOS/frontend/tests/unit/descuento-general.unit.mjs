// Pruebas unitarias del cálculo de descuento general (React).
// Ejecutar:  node tests/unit/descuento-general.unit.mjs
// (opcional) BALTO_SRC_DIR=/ruta/al/src node tests/unit/descuento-general.unit.mjs
import assert from 'node:assert/strict';
import { loadDescuentoUtil } from './_load-descuento-util.mjs';

const u = await loadDescuentoUtil();
let ok = 0;
const t = (name, fn) => { fn(); ok += 1; console.log(`[OK] ${name}`); };

const calc = (rows, tipo, valor) => {
  const base = u.calcularRenglonesBrutos(rows);
  const d = u.calcularDescuentoGeneral(base, tipo, valor);
  const lines = u.prorratearDescuentoGeneral(base, d);
  const r = u.calcularResumenOperacion(lines, d);
  return { base, d, lines, r };
};
const sum = (arr, k) => u.roundMoney(arr.reduce((a, x) => a + Number(x[k] || 0), 0));

t('sin descuento: comportamiento actual', () => {
  const { d, r, lines } = calc([{ cantidad: 2, precio: 1500, ivaPct: 21 }], 'PORCENTAJE', '');
  assert.equal(d.activo, false);
  assert.equal(d.error, '');
  assert.equal(r.total, 3630);
  assert.equal(r.descuento, 0);
  assert.equal(lines[0].precio, 1500);
  assert.deepEqual(u.descuentoPayload(r), { descuento_tipo: null, descuento_valor: 0, descuento_monto: 0, total_bruto: 3630 });
});

t('10 % sobre $100.000 → $90.000', () => {
  const { d, r } = calc([{ cantidad: 1, precio: 100000, ivaPct: 0 }], 'PORCENTAJE', '10');
  assert.equal(d.monto, 10000);
  assert.equal(r.total, 90000);
  assert.equal(r.totalBruto, 100000);
});

t('monto $28.000 sobre $278.000 → $250.000 (≈10,07 %)', () => {
  const { d, r, lines } = calc([{ cantidad: 1, precio: 278000, ivaPct: 0 }], 'MONTO', '28.000');
  assert.equal(d.monto, 28000);
  assert.equal(r.total, 250000);
  assert.equal(u.formatPorcentaje(d.porcentajeEfectivo), '10,07');
  assert.equal(lines.length, 1);
});

t('mezcla de IVA 0 / 10,5 / 21 / 27: renglones cierran al centavo', () => {
  const rows = [
    { cantidad: 3, precio: 1234.57, ivaPct: 21 },
    { cantidad: 2.5, precio: 999.99, ivaPct: 10.5 },
    { cantidad: 1, precio: 333.33, ivaPct: 27 },
    { cantidad: 7, precio: 12.34, ivaPct: 0 },
  ];
  const { d, r, lines } = calc(rows, 'PORCENTAJE', '7,35');
  assert.equal(d.activo, true);
  assert.equal(r.total, d.totalFinal);
  assert.equal(sum(lines, 'total'), d.totalFinal);
  assert.equal(u.roundMoney(d.totalBruto - d.monto), d.totalFinal);
  for (const l of lines) assert.equal(u.roundMoney(l.subtotal + l.ivaMonto), l.total);
});

t('montos inválidos bloquean y no aplican', () => {
  const rows = [{ cantidad: 1, precio: 1000, ivaPct: 21 }];
  for (const [tipo, valor] of [['PORCENTAJE', '-5'], ['PORCENTAJE', '100'], ['PORCENTAJE', '150'], ['MONTO', '1210'], ['MONTO', '5000'], ['MONTO', 'abc'], ['MONTO', 'Infinity']]) {
    const { d, r } = calc(rows, tipo, valor);
    assert.equal(d.activo, false, `${tipo} ${valor}`);
    assert.notEqual(d.error, '', `${tipo} ${valor} debe informar error`);
    assert.equal(r.total, 1210);
  }
});

t('porcentaje que redondea a menos de $0,01 se rechaza', () => {
  const { d, r } = calc([{ cantidad: 1, precio: 10, ivaPct: 0 }], 'PORCENTAJE', '0,01');
  assert.equal(d.activo, false);
  assert.match(d.error, /0,01/);
  assert.equal(r.total, 10);
});

t('quitar el descuento (valor 0) vuelve al total original', () => {
  const { d, r } = calc([{ cantidad: 1, precio: 1000, ivaPct: 0 }], 'MONTO', '0');
  assert.equal(d.activo, false);
  assert.equal(d.error, '');
  assert.equal(r.total, 1000);
});

t('parseo de importes en formato argentino', () => {
  assert.equal(u.parseDescuentoInput('1.234,56').valor, 1234.56);
  assert.equal(u.parseDescuentoInput('10,5').valor, 10.5);
  assert.equal(u.parseDescuentoInput('10.5').valor, 10.5);
  assert.equal(u.parseDescuentoInput('28.000').valor, 28000);
  assert.equal(u.parseDescuentoInput('').vacio, true);
  assert.equal(u.parseDescuentoInput('1e3').valido, false);
});

t('descuentoDesdeMovimiento no resta dos veces', () => {
  const d = u.descuentoDesdeMovimiento({ descuento_tipo: 'MONTO', descuento_valor: 28000, descuento_monto: 28000, total_bruto: 278000, monto_total: 250000 });
  assert.equal(d.totalFinal, 250000);
  assert.equal(d.totalBruto, 278000);
  assert.equal(u.descuentoDesdeMovimiento({ descuento_monto: 0, monto_total: 10 }), null);
});

t('itemsConBonificacion: precio original + bonificación, sin tocar netos', () => {
  const [it] = u.itemsConBonificacion([{ cantidad: 1, precio: 250000, precio_lista: 278000, subtotal: 250000, total: 250000 }]);
  assert.equal(it.precio_unitario, 278000);
  assert.equal(it.impBonif, 28000);
  assert.equal(it.total, 250000);
});

t('estrés: 2000 casos aleatorios cierran exacto', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ivas = [0, 10.5, 21, 27];
  for (let i = 0; i < 2000; i += 1) {
    const n = 1 + Math.floor(rnd() * 6);
    const rows = Array.from({ length: n }, () => ({
      cantidad: Math.round((0.5 + rnd() * 20) * 1000) / 1000,
      precio: Math.round(rnd() * 500000) / 100 + 0.01,
      ivaPct: ivas[Math.floor(rnd() * 4)],
    }));
    const base = u.calcularRenglonesBrutos(rows);
    const tb = u.roundMoney(base.reduce((a, r) => a + r.totalBruto, 0));
    const usePct = rnd() < 0.5;
    const valor = usePct ? String(Math.round(rnd() * 9999) / 100) : String(Math.round(rnd() * tb * 100) / 100);
    const { d, r, lines } = calc(rows, usePct ? 'PORCENTAJE' : 'MONTO', valor);
    if (!d.activo) continue;
    assert.equal(sum(lines, 'total'), d.totalFinal);
    assert.equal(r.total, u.roundMoney(d.totalBruto - d.monto));
    for (const l of lines) {
      assert.equal(u.roundMoney(l.subtotal + l.ivaMonto), l.total);
      assert.ok(l.total >= 0);
    }
  }
});

console.log(`\n${ok} pruebas OK (${u.__source})`);
