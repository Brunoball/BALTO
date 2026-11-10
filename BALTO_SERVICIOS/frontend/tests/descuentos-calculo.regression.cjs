// Regresión pura del cálculo de descuento general (src/utils/descuentoGeneral.js).
// No necesita backend ni navegador. Ejecutar desde frontend/:
//   node tests/descuentos-calculo.regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadUtil() {
  const file = path.resolve(__dirname, '../src/utils/descuentoGeneral.js');
  const source = fs.readFileSync(file, 'utf8').replace(/^export\s+/gm, '');
  const names = [...source.matchAll(/^(?:const|function)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  const ctx = {};
  vm.runInNewContext(`${source}\nthis.__u = { ${names.join(', ')} };`, ctx, { filename: file });
  return ctx.__u;
}

async function runRegression() {
  const u = loadUtil();
  const calc = (rows, tipo, valor) => {
    const base = u.calcularRenglonesBrutos(rows);
    const d = u.calcularDescuentoGeneral(base, tipo, valor);
    const lines = u.prorratearDescuentoGeneral(base, d);
    return { d, lines, r: u.calcularResumenOperacion(lines, d) };
  };
  const sum = (arr, k) => u.roundMoney(arr.reduce((a, x) => a + Number(x[k] || 0), 0));

  // 1. Sin descuento: comportamiento actual.
  let c = calc([{ cantidad: 2, precio: 1500, ivaPct: 21 }], 'PORCENTAJE', '');
  assert.equal(c.d.activo, false); assert.equal(c.r.total, 3630); assert.equal(c.lines[0].precio, 1500);
  assert.equal(u.descuentoPayload(c.r).descuento_monto, 0);

  // 2. 10 % sobre $100.000.
  c = calc([{ cantidad: 1, precio: 100000, ivaPct: 0 }], 'PORCENTAJE', '10');
  assert.equal(c.d.monto, 10000); assert.equal(c.r.total, 90000);

  // 3. Monto $28.000 sobre $278.000 (≈ 10,07 %).
  c = calc([{ cantidad: 1, precio: 278000, ivaPct: 0 }], 'MONTO', '28.000');
  assert.equal(c.r.total, 250000); assert.equal(u.formatPorcentaje(c.d.porcentajeEfectivo), '10,07');

  // 4. IVA 0 / 10,5 / 21 / 27, cantidades decimales y porcentaje no entero.
  c = calc([
    { cantidad: 3, precio: 1234.57, ivaPct: 21 }, { cantidad: 2.5, precio: 999.99, ivaPct: 10.5 },
    { cantidad: 1, precio: 333.33, ivaPct: 27 }, { cantidad: 7, precio: 12.34, ivaPct: 0 },
  ], 'PORCENTAJE', '7,35');
  assert.equal(sum(c.lines, 'total'), c.d.totalFinal);
  for (const l of c.lines) assert.equal(u.roundMoney(l.subtotal + l.ivaMonto), l.total);

  // 5. Inválidos: negativo, ≥100 %, monto ≥ total, no numérico, infinito.
  for (const [tipo, valor] of [['PORCENTAJE', '-5'], ['PORCENTAJE', '100'], ['MONTO', '1210'], ['MONTO', '5000'], ['MONTO', 'abc'], ['MONTO', 'Infinity']]) {
    c = calc([{ cantidad: 1, precio: 1000, ivaPct: 21 }], tipo, valor);
    assert.equal(c.d.activo, false, `${tipo} ${valor}`); assert.ok(c.d.error, `${tipo} ${valor}`); assert.equal(c.r.total, 1210);
  }

  // 6. Quitar descuento.
  c = calc([{ cantidad: 1, precio: 1000, ivaPct: 0 }], 'MONTO', '');
  assert.equal(c.r.total, 1000); assert.equal(c.d.error, '');

  // 7. Estrés: los renglones netos siempre cierran exacto.
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 1500; i += 1) {
    const rows = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => ({
      cantidad: Math.round((0.5 + rnd() * 20) * 1000) / 1000, precio: Math.round(rnd() * 500000) / 100 + 0.01, ivaPct: [0, 10.5, 21, 27][Math.floor(rnd() * 4)],
    }));
    c = calc(rows, rnd() < 0.5 ? 'PORCENTAJE' : 'MONTO', String(Math.round(rnd() * 9999) / 100));
    if (!c.d.activo) continue;
    assert.equal(sum(c.lines, 'total'), c.d.totalFinal);
    assert.equal(c.r.total, u.roundMoney(c.d.totalBruto - c.d.monto));
  }
  return true;
}

module.exports = runRegression;
module.exports.loadUtil = loadUtil;
if (require.main === module) {
  runRegression()
    .then(() => process.stdout.write('OK: cálculo de descuento general (sin descuento, %, monto, IVA mixto, inválidos, estrés).\n'))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
