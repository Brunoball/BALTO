// Genera los casos de paridad React ↔ PHP del descuento general.
// Uso: node tests/unit/generar-paridad-descuentos.mjs <salida.json>
// El JSON resultante lo consume modules/movimientos/tests/PresupuestosDescuentoGeneralTest.php
// (segundo argumento),
// que exige que el backend obtenga EXACTAMENTE los mismos centavos.
import { writeFileSync } from 'node:fs';
import { loadDescuentoUtil } from './_load-descuento-util.mjs';

const out = process.argv[2];
if (!out) { console.error('Indicá el archivo de salida.'); process.exit(2); }
const u = await loadDescuentoUtil();

let seed = 20261110;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ivas = [0, 10.5, 21, 27];
const casos = [];

const push = (rows, tipo, valor) => {
  const base = u.calcularRenglonesBrutos(rows);
  const d = u.calcularDescuentoGeneral(base, tipo, valor);
  const lines = u.prorratearDescuentoGeneral(base, d);
  casos.push({
    rows: rows.map((r) => ({ cantidad: r.cantidad, precio: r.precio, iva_pct: r.ivaPct })),
    tipo,
    valor: Number(u.parseDescuentoInput(valor).valor),
    esperado: {
      activo: d.activo,
      monto: d.monto,
      total_bruto: d.totalBruto,
      total_final: d.totalFinal,
      lineas: d.activo ? lines.map((l) => ({ precio: l.precio, subtotal: l.subtotal, iva_monto: l.ivaMonto, total: l.total })) : [],
    },
  });
};

push([{ cantidad: 1, precio: 100000, ivaPct: 0 }], 'PORCENTAJE', '10');
push([{ cantidad: 1, precio: 278000, ivaPct: 0 }], 'MONTO', '28000');
push([{ cantidad: 1, precio: 278000, ivaPct: 21 }], 'MONTO', '28000');
push([{ cantidad: 3, precio: 0.33, ivaPct: 21 }, { cantidad: 1, precio: 0.01, ivaPct: 0 }], 'PORCENTAJE', '33.33');
for (let i = 0; i < 1500; i += 1) {
  const n = 1 + Math.floor(rnd() * 6);
  const rows = Array.from({ length: n }, () => ({
    cantidad: Math.round((0.25 + rnd() * 15) * 1000) / 1000,
    precio: Math.round(1 + rnd() * 900000) / 100,
    ivaPct: ivas[Math.floor(rnd() * 4)],
  }));
  const base = u.calcularRenglonesBrutos(rows);
  const tb = u.roundMoney(base.reduce((a, r) => a + r.totalBruto, 0));
  if (rnd() < 0.5) push(rows, 'PORCENTAJE', String(Math.round(1 + rnd() * 9897) / 100));
  else push(rows, 'MONTO', String(Math.max(0.01, Math.round(rnd() * (tb - 0.02) * 100) / 100)));
}
writeFileSync(out, JSON.stringify({ generado_por: 'src/utils/descuentoGeneral.js', casos }, null, 0));
console.log(`${casos.length} casos escritos en ${out}`);
